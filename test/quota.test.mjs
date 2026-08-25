/**
 * dsh-turn-cost — pure-function tests for lib/quota.js.
 * No deps, no network: `node --test` from the repo root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKimiUsages, normalizeKimiLocalUsage, normalizeAliyunBl } from "../lib/quota.js";

// Live official coding API payload shape (verified 2026-08-25):
// `usage` = 7-day window, `limits[]` = sub-windows (5h), booster wallet
// amounts are nano-CNY (1e-8), monthly figures are cents (1e-2).
const OFFICIAL_USAGES = {
  usage: { limit: "100", used: "34", remaining: "66", resetTime: "2026-08-25T10:39:26.713247Z" },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: { limit: "100", used: "2", remaining: "98", resetTime: "2026-08-25T05:39:26.713247Z" },
    },
  ],
  parallel: { limit: "30" },
  boosterWallet: {
    balance: { amountLeft: "2879308600" },
    monthlyUsed: { priceInCents: "87121" },
    monthlyChargeLimit: { priceInCents: "100000" },
  },
};

test("normalizeKimiUsages: official coding API payload → windows + booster + parallel", () => {
  const out = normalizeKimiUsages(OFFICIAL_USAGES);
  assert.ok(out !== null);
  assert.deepEqual(out.windows.map((w) => w.name), ["7d", "5h"]);
  const week = out.windows.find((w) => w.name === "7d");
  assert.deepEqual(
    { limit: week.limit, used: week.used, remaining: week.remaining, resetAt: week.resetAt },
    { limit: 100, used: 34, remaining: 66, resetAt: "2026-08-25T10:39:26.713247Z" },
  );
  const fiveHour = out.windows.find((w) => w.name === "5h");
  assert.equal(fiveHour.limit, 100);
  assert.equal(fiveHour.used, 2);
  assert.equal(fiveHour.remaining, 98);
  // Booster: nano-CNY (1e-8) → ¥; monthly: cents (1e-2) → ¥.
  assert.equal(out.booster.balanceCny, 28.793086);
  assert.equal(out.booster.monthlyUsedCny, 871.21);
  assert.equal(out.booster.monthlyLimitCny, 1000);
  assert.equal(out.parallel, 30);
});

test("normalizeKimiUsages: garbage degrades to null, never throws", () => {
  assert.equal(normalizeKimiUsages(null), null);
  assert.equal(normalizeKimiUsages(undefined), null);
  assert.equal(normalizeKimiUsages("junk"), null);
  assert.equal(normalizeKimiUsages({}), null);
  assert.equal(normalizeKimiUsages({ usage: {} }), null);
});

test("normalizeKimiLocalUsage: loopback OAuth envelope → windows; garbage → null", () => {
  const payload = {
    data: {
      kind: "ok",
      summary: { limit: 100, used: 53, window: { duration: 5, timeUnit: "hour" }, reset_at: "2026-08-25T05:39:26Z" },
      limits: [{ limit: 100, used: 2, window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" } }],
      extra_usage: { balance_cents: 2879, monthly_used_cents: 87121, monthly_charge_limit_cents: 100000 },
    },
  };
  const out = normalizeKimiLocalUsage(payload, Date.UTC(2026, 7, 25, 4, 0, 0));
  assert.ok(out !== null);
  assert.deepEqual(out.windows.map((w) => w.name), ["5h", "5h"]);
  assert.equal(out.windows[0].remaining, 47);
  assert.equal(out.booster.balanceCny, 28.79);
  assert.equal(normalizeKimiLocalUsage({ data: { kind: "err" } }), null);
  assert.equal(normalizeKimiLocalUsage(null), null);
});

test("normalizeAliyunBl: per-week percentage shape and Credits fallback", () => {
  const pct = normalizeAliyunBl({ per1WeekPercentage: 0.155, per1WeekResetTime: 1786022400000 });
  assert.ok(pct !== null);
  assert.equal(pct.usedPercent, 0.155);
  assert.equal(pct.remainingPercent, 0.845);
  assert.ok(typeof pct.expireAt === "string");
  const credits = normalizeAliyunBl({ total: 1000, used: 400, remaining: 600, expireAt: "2026-08-31" });
  assert.equal(credits.usedPercent, 0.4);
  assert.equal(credits.remainingPercent, 0.6);
  assert.equal(credits.expireAt, "2026-08-31");
  assert.equal(normalizeAliyunBl({}), null);
  assert.equal(normalizeAliyunBl(null), null);
});
