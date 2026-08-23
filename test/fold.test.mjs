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
  foldEvents,
  costOfStep,
  costOfTurn,
} from "../lib/fold.js";

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
