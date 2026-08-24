import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TurnCostService } from "../lib/index.js";
import { costOfTurn, foldEvents, quotaConfigOf, requestsInWindow } from "../lib/fold.js";
import { normalizeAliyunBl, normalizeKimiUsages } from "../lib/quota.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/three-routes.json", import.meta.url), "utf8"));

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

test("Kimi usages normalizes the 5h window and remaining count", () => {
  const resetAt = "2030-01-01T05:00:00.000Z";
  const normalized = normalizeKimiUsages({
    usage: { limit: "10000", used: "3500", remaining: "6500", resetTime: "2030-01-07T00:00:00.000Z" },
    limits: [{
      window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" },
      detail: { limit: "100", used: "37", remaining: "63", resetTime: resetAt },
    }],
  });

  const fiveHour = normalized.windows.find((window) => window.name === "5h");
  assert.ok(fiveHour, "the Kimi 5h window must be present");
  assert.equal(fiveHour.limit, 100);
  assert.equal(fiveHour.used, 37);
  assert.equal(fiveHour.remaining, 63);
  assert.equal(fiveHour.resetAt, resetAt);
  assert.equal(normalized.windows.find((window) => window.name === "7d")?.remaining, 6500);
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
      throw new Error("redacted Kimi endpoint failure");
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
  assert.equal(snapshot.routes["kimi-coding"].error, "redacted Kimi endpoint failure");
  assert.equal(snapshot.routes["qwen-token-plan-cn"].ok, true);
  assert.equal(snapshot.routes["qwen-token-plan-cn"].remainingPercent, 0.625);
});
