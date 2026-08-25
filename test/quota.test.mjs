/**
 * dsh-turn-cost — pure-function tests for lib/quota.js.
 * No deps, no network: `node --test` from the repo root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKimiLocalUsage, normalizeAliyunBl } from "../lib/quota.js";

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
