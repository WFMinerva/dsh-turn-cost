const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Kimi `window {duration,timeUnit}` → milliseconds (unknown units → null). */
function kimiWindowMs(window) {
  const duration = Number(window?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  switch (window?.timeUnit) {
    case "TIME_UNIT_MINUTE": return duration * MINUTE_MS;
    case "TIME_UNIT_HOUR": return duration * HOUR_MS;
    case "TIME_UNIT_DAY": return duration * DAY_MS;
    default: return null;
  }
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Normalize the Kimi `GET {baseUrl}/usages` payload into plain windows +
 * booster wallet. The result is an internal data seam shared by the host
 * fetcher and redacted tests; it is not part of the package exports.
 */
export function normalizeKimiUsages(payload) {
  const windows = [];
  const weekly = payload?.usage;
  const weeklyLimit = toInt(weekly?.limit);
  if (weeklyLimit !== null) {
    windows.push({
      name: "7d", durationMs: 7 * DAY_MS,
      limit: weeklyLimit, used: toInt(weekly?.used) ?? 0, remaining: toInt(weekly?.remaining),
      resetAt: typeof weekly?.resetTime === "string" ? weekly.resetTime : undefined,
    });
  }
  for (const entry of payload?.limits ?? []) {
    const durationMs = kimiWindowMs(entry?.window);
    const limit = toInt(entry?.detail?.limit);
    if (durationMs === null || limit === null) continue;
    const hours = durationMs / HOUR_MS;
    windows.push({
      name: Number.isInteger(hours) ? `${hours}h` : `${durationMs / MINUTE_MS}min`,
      durationMs,
      limit, used: toInt(entry?.detail?.used) ?? 0, remaining: toInt(entry?.detail?.remaining),
      resetAt: typeof entry?.detail?.resetTime === "string" ? entry.detail.resetTime : undefined,
    });
  }
  const balance = payload?.boosterWallet?.balance;
  const booster = balance === undefined ? undefined : {
    balanceCny: toInt(balance?.amountLeft) !== null ? toInt(balance.amountLeft) / 1e8 : null,
    monthlyUsedCny: toInt(payload?.boosterWallet?.monthlyUsed?.priceInCents) !== null ? toInt(payload.boosterWallet.monthlyUsed.priceInCents) / 100 : null,
    monthlyLimitCny: toInt(payload?.boosterWallet?.monthlyChargeLimit?.priceInCents) !== null ? toInt(payload.boosterWallet.monthlyChargeLimit.priceInCents) / 100 : null,
  };
  const parallel = toInt(payload?.parallel?.limit);
  return { windows, booster, parallel: parallel ?? undefined };
}

/**
 * Normalize `bl usage token-plan --output json` output. The live CLI shape is
 * `{ per1WeekPercentage, per1WeekResetTime }`; an unrecognized shape returns
 * null so the caller can isolate it as an unavailable route.
 */
export function normalizeAliyunBl(payload) {
  if (payload === null || typeof payload !== "object") return null;
  const pct = Number(payload.per1WeekPercentage);
  const resetMs = Number(payload.per1WeekResetTime);
  if (Number.isFinite(pct) && pct >= 0 && pct <= 1) {
    return {
      usedPercent: pct,
      remainingPercent: 1 - pct,
      expireAt: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : undefined,
    };
  }
  const pick = (...keys) => {
    for (const key of keys) {
      if (Object.hasOwn(payload, key)) return payload[key];
    }
    return undefined;
  };
  const total = toInt(pick("total", "totalValue", "TotalValue", "limit"));
  const used = toInt(pick("used", "usedValue", "UsedValue"));
  const remaining = toInt(pick("remaining", "surplus", "totalSurplusValue", "TotalSurplusValue"));
  const expireRaw = pick("expireAt", "nearestExpireDate", "NearestExpireDate");
  if (total === null && used === null && remaining === null) return null;
  const t = total ?? (used !== null && remaining !== null ? used + remaining : null);
  const r = remaining ?? (t !== null && used !== null ? t - used : null);
  return {
    usedPercent: t !== null && used !== null && t > 0 ? used / t : null,
    remainingPercent: t !== null && r !== null && t > 0 ? r / t : null,
    expireAt: typeof expireRaw === "string" ? expireRaw : undefined,
  };
}
