import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnCostService } from "../lib/index.js";
import { costOfTurn, foldEvents, quotaConfigOf, requestsInWindow } from "../lib/fold.js";
import { normalizeAliyunBl, normalizeKimiLocalUsage } from "../lib/quota.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/three-routes.json", import.meta.url), "utf8"));

test("host keeps Aliyun shell mode disabled and includes both Kimi credential paths", () => {
  const hostSource = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(hostSource, /shell\s*:\s*true/);
  assert.match(hostSource, /\/api\/v1\/oauth\/usage/);
  assert.match(hostSource, /api\.kimi\.com\/coding\/v1/);
  assert.match(hostSource, /\.credentials\.yaml/);
});

for (const route of fixture.routes) {
  test(`redacted route fixture keeps log provider/model and readout lane: ${route.id}`, () => {
    const samples = foldEvents(route.events);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].provider, route.id);
    assert.equal(samples[0].model, route.model);
    assert.equal(requestsInWindow(samples, route.id, 0, 2_000_000_000_000), 1);

    const aggregate = costOfTurn(samples, 1, fixture.rates);
    assert.equal(aggregate.priced, 1);
    assert.equal(aggregate.unpriced, 0);
    if (route.readout === "cost") assert.ok(aggregate.cost > 0);
    else assert.equal(aggregate.cost, 0);
  });
}

test("redacted quota routes remain isolated when one route config is malformed", () => {
  const parsed = quotaConfigOf({ quota: {
    ...fixture.quota,
    malformed: { kind: "not-a-real-provider" },
  } });
  assert.deepEqual(Object.keys(parsed).sort(), ["kimi-coding", "qwen-token-plan-cn"]);
  assert.equal(parsed["kimi-coding"].kind, "kimi-usages");
  assert.equal(parsed["qwen-token-plan-cn"].kind, "aliyun-bl");
});

test("official local Kimi OAuth usage normalizes 5h/weekly windows and booster", () => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");
  const normalized = normalizeKimiLocalUsage({ data: {
    kind: "ok",
    summary: { label: "Weekly limit", limit: 100, used: 34, reset_hint: "resets in 2d 3h" },
    limits: [{ label: "5h limit", limit: 100, used: 7, reset_hint: "resets in 4h 10m" }],
    extra_usage: { balance_cents: 2879, monthly_used_cents: 87121, monthly_charge_limit_cents: 100000 },
  } }, now);

  const fiveHour = normalized.windows.find((window) => window.name === "5h");
  assert.ok(fiveHour, "the Kimi 5h window must be present");
  assert.equal(fiveHour.limit, 100);
  assert.equal(fiveHour.used, 7);
  assert.equal(fiveHour.remaining, 93);
  assert.equal(fiveHour.resetAt, new Date(now + 4 * 3_600_000 + 10 * 60_000).toISOString());
  assert.equal(normalized.windows.find((window) => window.name === "7d")?.remaining, 66);
  assert.equal(normalized.booster.balanceCny, 28.79);
  assert.equal(normalizeKimiLocalUsage({ data: { kind: "error", message: "secret" } }), null);
});

test("official Kimi path resolves the managed credential and sends it only as Authorization", { concurrency: false }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "turn-cost-kimi-official-"));
  const credentialsFile = join(dir, ".credentials.yaml");
  await writeFile(credentialsFile, "refs:\n  KIMI_CODING_API_KEY: local-fixture-key\n");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.kimi.com/coding/v1/usages");
    assert.equal(options.headers.Authorization, "Bearer local-fixture-key");
    return {
      ok: true,
      json: async () => ({
        usage: { limit: "100", used: "34", remaining: "66", resetTime: "2030-01-08T00:00:00.000Z" },
        limits: [{
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
          detail: { limit: "100", used: "7", remaining: "93", resetTime: "2030-01-01T05:00:00.000Z" },
        }],
      }),
    };
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  });

  const result = await TurnCostService.prototype.fetchKimiQuota.call(
    { credentialsFile },
    { kind: "kimi-usages" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.windows.find((window) => window.name === "5h")?.remaining, 93);
  assert.doesNotMatch(JSON.stringify(result), /local-fixture-key/);
});

test("Kimi quota fetch uses only the official loopback server token", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "turn-cost-kimi-"));
  const tokenFile = join(dir, "server.token");
  await writeFile(tokenFile, "local-test-token\n");
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/v1/oauth/usage");
    assert.equal(request.headers.authorization, "Bearer local-test-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: {
      kind: "ok",
      summary: { label: "Weekly limit", limit: 100, used: 34, reset_hint: "resets in 1d" },
      limits: [{ label: "5h limit", limit: 100, used: 7, reset_hint: "resets in 4h" }],
      extra_usage: null,
    } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const address = server.address();
  const result = await TurnCostService.prototype.fetchKimiQuota.call(
    { kimiServerTokenFile: tokenFile },
    { kind: "kimi-usages", baseUrl: `http://127.0.0.1:${address.port}` },
  );
  assert.equal(result.ok, true);
  assert.equal(result.windows.find((window) => window.name === "5h")?.remaining, 93);
});

test("Qwen bl normalizes the weekly percentage and remainingPercent", () => {
  const resetMs = Date.parse("2030-01-08T00:00:00.000Z");
  const normalized = normalizeAliyunBl({
    per1WeekPercentage: 0.375,
    per1WeekResetTime: resetMs,
  });

  assert.equal(normalized.usedPercent, 0.375);
  assert.equal(normalized.remainingPercent, 0.625);
  assert.equal(normalized.expireAt, new Date(resetMs).toISOString());
});

test("quota isolates one endpoint failure and still returns the other route", async () => {
  const service = {
    quotaRoutes: {
      "kimi-coding": { kind: "kimi-usages" },
      "qwen-token-plan-cn": { kind: "aliyun-bl" },
    },
    quotaCache: new Map(),
    fetchKimiQuota: async () => {
      throw new Error("secret-bearing provider failure: Authorization=Bearer do-not-render");
    },
    fetchAliyunQuota: async () => ({
      kind: "aliyun-bl",
      ok: true,
      usedPercent: 0.375,
      remainingPercent: 0.625,
    }),
    quotaForRoute: TurnCostService.prototype.quotaForRoute,
  };

  const snapshot = await TurnCostService.prototype.quota.call(service, {});
  assert.equal(snapshot.routes["kimi-coding"].ok, false);
  assert.equal(snapshot.routes["kimi-coding"].error, "kimi-usages-failed");
  assert.doesNotMatch(JSON.stringify(snapshot), /do-not-render|Authorization|Bearer/);
  assert.equal(snapshot.routes["qwen-token-plan-cn"].ok, true);
  assert.equal(snapshot.routes["qwen-token-plan-cn"].remainingPercent, 0.625);
});
