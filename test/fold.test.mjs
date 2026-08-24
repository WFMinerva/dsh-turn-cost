/**
 * dsh-turn-cost — pure-function tests for lib/fold.js.
 * No deps, no network: `node --test` from the repo root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ZSTD_MAGIC,
  WEEKEND_OFF_PEAK_EFFECTIVE_MS,
  isPeak,
  beijingDay,
  foldEvents,
  costOfStep,
  costOfTurn,
  costOfSession,
  builtinRates,
  mergeRates,
  resolveRateEntry,
  sessionTitleOf,
  listSessions,
  isValidSessionId,
  findSessionFile,
  requestsInWindow,
  builtinQuotaRoutes,
  mergeQuotaRoutes,
  quotaConfigOf,
  QUOTA_KINDS,
} from "../lib/fold.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const atBeijing = (year, month, day, hour, minute = 0) =>
  Date.UTC(year, month - 1, day, hour - 8, minute);
const T_PEAK = atBeijing(2026, 8, 17, 10); // Monday 10:00 Beijing
const T_OFF_PEAK = atBeijing(2026, 8, 17, 13); // Monday 13:00 Beijing

test("zstd magic is the documented little-endian frame magic", () => {
  assert.deepEqual([...ZSTD_MAGIC], [0x28, 0xb5, 0x2f, 0xfd]);
});

test("isPeak: weekday 9–12 and 14–18 Beijing time are peak, boundaries excluded", () => {
  const at = (h, m = 0) => atBeijing(2026, 8, 24, h, m);
  assert.equal(isPeak(at(8, 59)), false);
  assert.equal(isPeak(at(9, 0)), true);
  assert.equal(isPeak(at(11, 59)), true);
  assert.equal(isPeak(at(12, 0)), false);
  assert.equal(isPeak(at(13, 59)), false);
  assert.equal(isPeak(at(14, 0)), true);
  assert.equal(isPeak(at(17, 59)), true);
  assert.equal(isPeak(at(18, 0)), false);
});

test("isPeak: weekend becomes all off-peak at the official cutoff without rewriting history", () => {
  assert.equal(WEEKEND_OFF_PEAK_EFFECTIVE_MS, atBeijing(2026, 8, 23, 0));
  assert.equal(isPeak(atBeijing(2026, 8, 22, 10)), true); // Saturday before cutoff: old rule
  assert.equal(isPeak(atBeijing(2026, 8, 23, 10)), false); // first effective Sunday
  assert.equal(isPeak(atBeijing(2026, 8, 29, 10)), false); // Saturday after cutoff
  assert.equal(isPeak(atBeijing(2026, 8, 30, 15)), false); // Sunday after cutoff
  assert.equal(isPeak(atBeijing(2026, 8, 28, 10)), true); // Friday unchanged
  assert.equal(isPeak(atBeijing(2026, 8, 31, 15)), true); // Monday unchanged
});

test("isPeak: Beijing schedule is independent of the host timezone", () => {
  assert.equal(isPeak(Date.UTC(2026, 7, 24, 0, 59)), false); // 08:59 Beijing
  assert.equal(isPeak(Date.UTC(2026, 7, 24, 1, 0)), true); // 09:00 Beijing
});

test("foldEvents: a later sample for the same (turn, step) replaces the earlier", () => {
  const events = [
    { type: "request/header", data: { header: { config: { provider: "deepseek", model: "deepseek-v4-pro" } } } },
    { type: "assistant/chunk", time: T_PEAK, data: { chunk: { type: "usage", usage: { inputTokens: 100, outputTokens: 10 } }, turn: 1, step: 1 } },
    { type: "assistant/message", time: T_PEAK, data: { usage: { inputTokens: 200, outputTokens: 20 }, turn: 1, step: 1 } },
  ];
  const samples = foldEvents(events);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].inputTokens, 200);
  assert.equal(samples[0].outputTokens, 20);
  assert.equal(samples[0].model, "deepseek-v4-pro");
  assert.equal(samples[0].provider, "deepseek");
});

test("foldEvents: header can also arrive as request/context", () => {
  const events = [
    { type: "request/context", data: { provider: "x", model: "deepseek-v4-flash" } },
    { type: "assistant/chunk", time: T_PEAK, data: { chunk: { type: "usage", usage: { inputTokens: 1 } }, turn: 0, step: 0 } },
  ];
  const samples = foldEvents(events);
  assert.equal(samples[0].model, "deepseek-v4-flash");
  assert.equal(samples[0].provider, "x");
});

test("costOfStep: peak vs off-peak at official CNY rates", () => {
  const base = { model: "deepseek-v4-pro", turn: 1, step: 1, inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
  // peak input 9.0 yuan / 1M
  assert.ok(Math.abs(costOfStep({ ...base, time: T_PEAK }) - 9.0) < 1e-9);
  // off-peak input 4.5 yuan / 1M
  assert.ok(Math.abs(costOfStep({ ...base, time: T_OFF_PEAK }) - 4.5) < 1e-9);
  // the same Saturday-morning call changes tier only after the new rule takes effect
  assert.ok(Math.abs(costOfStep({ ...base, time: atBeijing(2026, 8, 22, 10) }) - 9.0) < 1e-9);
  assert.ok(Math.abs(costOfStep({ ...base, time: atBeijing(2026, 8, 29, 10) }) - 4.5) < 1e-9);
});

test("costOfStep: deepseek-v4-flash-vision-exp is priced at V4 Flash rates", () => {
  const base = { model: "deepseek-v4-flash-vision-exp", turn: 1, step: 1, inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
  assert.ok(Math.abs(costOfStep({ ...base, time: T_PEAK }) - 3.0) < 1e-9);
  assert.ok(Math.abs(costOfStep({ ...base, time: T_OFF_PEAK }) - 1.5) < 1e-9);
});

test("costOfStep: unknown model or missing time yields null, never a fabricated price", () => {
  assert.equal(costOfStep({ model: "some-unknown-model", time: T_PEAK, turn: 1, step: 1, inputTokens: 1e6 }), null);
  assert.equal(costOfStep({ model: "deepseek-v4-pro", turn: 1, step: 1, inputTokens: 1e6 }), null);
});

test("costOfTurn: sums buckets, separates priced from unpriced steps", () => {
  const samples = [
    { model: "deepseek-v4-pro", time: T_PEAK, turn: 2, step: 1, inputTokens: 1e6, cacheReadTokens: 1e6, outputTokens: 1e6, cacheWriteTokens: 0 },
    { model: "no-rate-model", time: T_PEAK, turn: 2, step: 2, inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
  ];
  const r = costOfTurn(samples, 2);
  // peak pro: 9.0 (input) + 0.3 (cache read) + 27.0 (output) = 36.3
  assert.ok(Math.abs(r.cost - 36.3) < 1e-9);
  assert.equal(r.steps, 2);
  assert.equal(r.priced, 1);
  assert.equal(r.unpriced, 1);
  assert.equal(r.inputTokens, 2e6);
  assert.equal(r.outputTokens, 1e6);
  assert.equal(r.cacheReadTokens, 1e6);
  // cache hit = aggregate cacheRead 1e6 / (aggregate input 2e6 + cacheRead 1e6) = 1/3
  assert.ok(Math.abs(r.cacheHitRate - 1 / 3) < 1e-9);
});

test("costOfTurn: no samples for the turn → null", () => {
  assert.equal(costOfTurn([], 3), null);
  assert.equal(costOfTurn([{ turn: 1, step: 1, model: "deepseek-v4-pro", time: T_PEAK, inputTokens: 1 }], 3), null);
});

// ── K3 round-1 regression (变更 #3 复检) ─────────────────────────────────

test("resolveRateEntry: prototype names never resolve (own-key guarded)", () => {
  const rates = mergeRates(builtinRates(), CUSTOM_RATES);
  assert.equal(resolveRateEntry(rates, "__proto__"), undefined);
  assert.equal(resolveRateEntry(rates, "constructor"), undefined);
  assert.equal(resolveRateEntry(rates, "toString"), undefined);
  assert.equal(costOfStep({ model: "__proto__", turn: 1, step: 1, inputTokens: 1e6 }, rates), null);
});

test("findSessionFile: rejects traversal session ids and stays inside the root", async () => {
  assert.equal(isValidSessionId("session-0283766c-a4c7"), true);
  assert.equal(isValidSessionId("../escape"), false);
  assert.equal(isValidSessionId("a/b"), false);
  assert.equal(isValidSessionId(""), false);
  assert.equal(isValidSessionId(undefined), false);
  const root = await mkdtemp(join(tmpdir(), "dsh-turn-cost-"));
  try {
    await mkdir(join(root, "ws", "s-1"), { recursive: true });
    await writeFile(join(root, "ws", "s-1", "session.jsonl.zstd"), "x");
    assert.ok((await findSessionFile(root, "s-1")) !== undefined);
    assert.equal(await findSessionFile(root, "../../etc/passwd"), undefined);
    assert.equal(await findSessionFile(root, ".."), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── rate-table injection (变更 #3) ────────────────────────────────────────

const CUSTOM_RATES = {
  version: 1,
  currency: "CNY",
  models: {
    "k3-256k": { input: 0, cacheRead: 0, output: 0, note: "订阅制，仅展示 token" },
    "qwen3.7-max": { input: 2.0, cacheRead: 0.4, cacheWrite: 2.0, output: 6.0 },
  },
  aliases: { "k3": "k3-256k" },
};

test("costOfStep: custom flat rate prices all four buckets and needs no time", () => {
  const rates = mergeRates(builtinRates(), CUSTOM_RATES);
  const sample = { model: "qwen3.7-max", turn: 1, step: 1, inputTokens: 1e6, cacheReadTokens: 1e6, cacheWriteTokens: 1e6, outputTokens: 1e6 };
  // 2.0 + 0.4 + 2.0 + 6.0 = 10.4 — cacheWrite included, no time on the sample
  assert.ok(Math.abs(costOfStep(sample, rates) - 10.4) < 1e-9);
});

test("costOfStep: alias resolves to the canonical model's rate", () => {
  const rates = mergeRates(builtinRates(), CUSTOM_RATES);
  const sample = { model: "k3", turn: 1, step: 1, inputTokens: 1e6, outputTokens: 1e6 };
  assert.equal(costOfStep(sample, rates), 0); // known price: zero (subscription)
  assert.equal(resolveRateEntry(rates, "k3")?.note, "订阅制，仅展示 token");
});

test("costOfStep: provider-scoped key wins over the bare model name (same model, different route)", () => {
  const rates = mergeRates(builtinRates(), {
    models: { "qwen-token-plan-cn/deepseek-v4-pro": { input: 0, cacheRead: 0, output: 0, note: "Token Plan 抵扣" } },
  });
  const base = { model: "deepseek-v4-pro", time: T_PEAK, turn: 1, step: 1, inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
  // official route keeps the official peak price…
  assert.ok(Math.abs(costOfStep({ ...base, provider: "deepseek-official" }, rates) - 9.0) < 1e-9);
  // …while the same model through the Token Plan pool prices at subscription zero
  assert.equal(costOfStep({ ...base, provider: "qwen-token-plan-cn" }, rates), 0);
  // alias hop also resolves under the scoped key
  const aliased = mergeRates(rates, { aliases: { "v4-pro": "deepseek-v4-pro" } });
  assert.equal(costOfStep({ ...base, model: "v4-pro", provider: "qwen-token-plan-cn" }, aliased), 0);
});

test("costOfStep: custom table never fabricates — unknown model and tiered-without-time stay null", () => {
  const rates = mergeRates(builtinRates(), CUSTOM_RATES);
  assert.equal(costOfStep({ model: "mystery", turn: 1, step: 1, inputTokens: 1 }, rates), null);
  assert.equal(costOfStep({ model: "deepseek-v4-pro", turn: 1, step: 1, inputTokens: 1e6 }, rates), null);
});

test("mergeRates: custom entries overlay built-ins per key; malformed override degrades to base", () => {
  const base = builtinRates();
  const override = mergeRates(base, { models: { "deepseek-v4-pro": { input: 1, output: 1 } } });
  assert.equal(override.models["deepseek-v4-pro"].input, 1); // flat replaces tiered
  assert.equal(override.models["deepseek-v4-flash"].peak.input, 3.0); // untouched
  assert.equal(mergeRates(base, null), base);
  assert.equal(mergeRates(base, "junk"), base);
  assert.equal(mergeRates(base, { models: "junk" }).models["deepseek-v4-pro"].peak.input, 9.0);
});

test("costOfSession: aggregates every turn and reports models and time span", () => {
  const rates = mergeRates(builtinRates(), CUSTOM_RATES);
  const samples = [
    { model: "deepseek-v4-pro", time: T_PEAK, turn: 1, step: 1, inputTokens: 1e6, cacheReadTokens: 0, outputTokens: 0, cacheWriteTokens: 0 },
    { model: "k3-256k", time: T_OFF_PEAK, turn: 2, step: 1, inputTokens: 5e5, cacheReadTokens: 0, outputTokens: 1e5, cacheWriteTokens: 0 },
    { model: "no-rate", time: T_OFF_PEAK, turn: 3, step: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ];
  const r = costOfSession(samples, rates);
  assert.ok(Math.abs(r.cost - 9.0) < 1e-9); // pro peak input only; k3 flat zero; no-rate excluded
  assert.equal(r.steps, 3);
  assert.equal(r.priced, 2); // zero-priced counts as priced — the price is known
  assert.equal(r.unpriced, 1);
  assert.deepEqual(new Set(r.models), new Set(["deepseek-v4-pro", "k3-256k", "no-rate"]));
  assert.equal(r.firstTime, Math.min(T_PEAK, T_OFF_PEAK));
  assert.equal(r.lastTime, Math.max(T_PEAK, T_OFF_PEAK));
  assert.equal(costOfSession([], rates), null);
});

test("beijingDay: Beijing-calendar day key, host-timezone independent", () => {
  assert.equal(beijingDay(atBeijing(2026, 8, 24, 0, 30)), "2026-08-24");
  assert.equal(beijingDay(atBeijing(2026, 8, 24, 23, 59)), "2026-08-24");
  assert.equal(beijingDay(atBeijing(2026, 8, 25, 0, 0)), "2026-08-25");
  assert.equal(beijingDay(undefined), null);
});

test("sessionTitleOf: last session/title wins; none → undefined", () => {
  assert.equal(sessionTitleOf([
    { type: "session/title", data: { title: "旧标题" } },
    { type: "assistant/message", data: {} },
    { type: "session/title", data: { title: "新标题" } },
  ]), "新标题");
  assert.equal(sessionTitleOf([{ type: "user/message", data: {} }]), undefined);
});

test("listSessions: enumerates <root>/<workspace>/<sessionId>/session.jsonl.zstd, degrades on junk", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-turn-cost-"));
  try {
    await mkdir(join(root, "ws-a", "s-1"), { recursive: true });
    await mkdir(join(root, "ws-a", "s-2"), { recursive: true });
    await mkdir(join(root, "ws-b", "s-3"), { recursive: true });
    await writeFile(join(root, "ws-a", "s-1", "session.jsonl.zstd"), "x");
    await writeFile(join(root, "ws-a", "s-2", "other.txt"), "x"); // wrong name — skipped
    await writeFile(join(root, "ws-b", "s-3", "session.jsonl.zstd"), "x");
    await writeFile(join(root, "loose-file"), "x"); // not a directory — skipped
    const found = await listSessions(root);
    assert.deepEqual(
      found.map((f) => `${f.workspace}/${f.sessionId}`).sort(),
      ["ws-a/s-1", "ws-b/s-3"],
    );
    assert.deepEqual(await listSessions(join(root, "does-not-exist")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── quota (v2 / 0.3.0) ──────────────────────────────────────────────────────

test("requestsInWindow: counts one provider's samples inside [start, end)", () => {
  const samples = [
    { provider: "kimi-coding", time: 1000, turn: 1, step: 1 },
    { provider: "kimi-coding", time: 2000, turn: 1, step: 2 },
    { provider: "kimi-coding", time: 3000, turn: 2, step: 1 },
    { provider: "qwen-token-plan-cn", time: 1500, turn: 1, step: 3 },
    { provider: "kimi-coding", turn: 9, step: 9 },           // no time — never matches
    { time: 2500, turn: 3, step: 1 },                        // no provider — never matches
  ];
  assert.equal(requestsInWindow(samples, "kimi-coding", 0, 4000), 3);
  assert.equal(requestsInWindow(samples, "kimi-coding", 1000, 3000), 2); // end exclusive
  assert.equal(requestsInWindow(samples, "kimi-coding", 2001, 4000), 1);
  assert.equal(requestsInWindow(samples, "qwen-token-plan-cn", 0, 4000), 1);
  assert.equal(requestsInWindow(samples, "deepseek-official", 0, 4000), 0);
});

test("requestsInWindow: garbage inputs degrade to 0, never throw", () => {
  assert.equal(requestsInWindow(undefined, "kimi-coding", 0, 1), 0);
  assert.equal(requestsInWindow(null, "kimi-coding", 0, 1), 0);
  assert.equal(requestsInWindow([], "", 0, 1), 0);
  assert.equal(requestsInWindow([], "kimi-coding", Number.NaN, 1), 0);
  assert.equal(requestsInWindow([], "kimi-coding", 100, 100), 0);   // empty window
  assert.equal(requestsInWindow([], "kimi-coding", 100, 50), 0);   // inverted window
  assert.equal(requestsInWindow([], "kimi-coding", 0, Number.POSITIVE_INFINITY), 0);
  // non-iterable samples must not throw (K3 复检第 3 条)
  assert.equal(requestsInWindow(7, "kimi-coding", 0, 1), 0);
  assert.equal(requestsInWindow("kimi-coding", "kimi-coding", 0, 1), 0);
  assert.equal(requestsInWindow({ 0: { provider: "kimi-coding" } }, "kimi-coding", 0, 1), 0);
});

test("quotaConfigOf: quota routes validated; absent blocks → empty table", () => {
  assert.deepEqual(quotaConfigOf({ version: 1, models: {} }), {});
  assert.deepEqual(quotaConfigOf(null), {});
  assert.deepEqual(quotaConfigOf("junk"), {});
  const quota = quotaConfigOf({
    quota: {
      "kimi-coding": { kind: "kimi-usages", baseUrl: "http://127.0.0.1:58627" },
      "qwen-token-plan-cn": { kind: "aliyun-bl", command: "bl" },
      "bad-kind": { kind: "nonsense" },            // unknown kind — skipped
      "not-object": "nope",                        // malformed — skipped
      "obsolete-ref": { kind: "kimi-usages", credentialRef: "KIMI_CODING_API_KEY" }, // old field ignored
      "remote-base": { kind: "kimi-usages", baseUrl: "https://api.kimi.com/coding/v1" }, // loopback only
      "foreign-http": { kind: "kimi-usages", baseUrl: "http://192.0.2.1:58627" }, // loopback only
      "evil-cmd": { kind: "aliyun-bl", command: "bl && echo pwned" },  // shell metacharacters rejected
      "nested-cmd": { kind: "aliyun-bl", command: "cmd /c echo NESTED" }, // arguments rejected
      "path-cmd": { kind: "aliyun-bl", command: "C:\\Program Files\\bl.cmd" }, // paths rejected
    },
  });
  assert.deepEqual(quota["kimi-coding"], { kind: "kimi-usages", baseUrl: "http://127.0.0.1:58627" });
  assert.deepEqual(quota["qwen-token-plan-cn"], { kind: "aliyun-bl", command: "bl" });
  assert.equal(Object.hasOwn(quota, "bad-kind"), false);
  assert.equal(Object.hasOwn(quota, "not-object"), false);
  assert.deepEqual(quota["obsolete-ref"], { kind: "kimi-usages" });
  assert.deepEqual(quota["remote-base"], { kind: "kimi-usages" });
  assert.deepEqual(quota["foreign-http"], { kind: "kimi-usages" });
  assert.deepEqual(quota["evil-cmd"], { kind: "aliyun-bl" }); // command dropped, route kept
  assert.deepEqual(quota["nested-cmd"], { kind: "aliyun-bl" });
  assert.deepEqual(quota["path-cmd"], { kind: "aliyun-bl" });
  assert.ok(QUOTA_KINDS.has("kimi-usages") && QUOTA_KINDS.has("aliyun-bl"));
});

test("quotaConfigOf: prototype-name keys never leak", () => {
  const parsed = JSON.parse(`{"quota":{"__proto__":{"kind":"kimi-usages"},"constructor":{"kind":"aliyun-bl"}}}`);
  assert.deepEqual(Object.keys(quotaConfigOf(parsed)), []);
});

test("built-in quota routes work without a per-machine rates file", () => {
  assert.deepEqual(builtinQuotaRoutes(), {
    "kimi-coding": { kind: "kimi-usages" },
    "qwen-token-plan-cn": { kind: "aliyun-bl" },
  });
  assert.notEqual(builtinQuotaRoutes(), builtinQuotaRoutes());
});

test("mergeQuotaRoutes: valid overrides win and enabled=false opts out", () => {
  const merged = mergeQuotaRoutes(builtinQuotaRoutes(), { quota: {
    "kimi-coding": { kind: "kimi-usages", baseUrl: "http://localhost:58628" },
    "qwen-token-plan-cn": { enabled: false },
    private: { kind: "aliyun-bl", command: "bl-private" },
    malformed: { kind: "unknown" },
  } });
  assert.deepEqual(merged, {
    "kimi-coding": { kind: "kimi-usages", baseUrl: "http://localhost:58628" },
    private: { kind: "aliyun-bl", command: "bl-private" },
  });
});
