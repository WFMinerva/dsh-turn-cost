const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Kimi window → milliseconds (unknown units → null). */
function kimiWindowMs(window) {
  const duration = Number(window?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  switch (window?.timeUnit ?? window?.unit) {
    case "TIME_UNIT_MINUTE": return duration * MINUTE_MS;
    case "minute": return duration * MINUTE_MS;
    case "TIME_UNIT_HOUR": return duration * HOUR_MS;
    case "hour": return duration * HOUR_MS;
    case "TIME_UNIT_DAY": return duration * DAY_MS;
    case "day": return duration * DAY_MS;
    case "week": return duration * 7 * DAY_MS;
    default: return null;
  }
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function durationFromLabel(label) {
  if (typeof label !== "string") return null;
  const hours = label.match(/(\d+(?:\.\d+)?)\s*h\b/i);
  if (hours !== null) return Number(hours[1]) * HOUR_MS;
  if (/week/i.test(label)) return 7 * DAY_MS;
  const days = label.match(/(\d+(?:\.\d+)?)\s*d\b/i);
  return days === null ? null : Number(days[1]) * DAY_MS;
}

function resetAtFromHint(hint, nowMs) {
  if (typeof hint !== "string") return undefined;
  let delta = 0;
  for (const match of hint.matchAll(/(\d+)\s*([dhm])\b/gi)) {
    const unit = match[2].toLowerCase();
    delta += Number(match[1]) * (unit === "d" ? DAY_MS : unit === "h" ? HOUR_MS : MINUTE_MS);
  }
  return delta > 0 ? new Date(nowMs + delta).toISOString() : undefined;
}

function localUsageWindow(row, nowMs) {
  if (row === null || typeof row !== "object") return null;
  const limit = toInt(row.limit);
  const used = toInt(row.used);
  if (limit === null || limit <= 0 || used === null) return null;
  const durationMs = kimiWindowMs(row.window) ?? durationFromLabel(row.label);
  if (durationMs === null) return null;
  const hours = durationMs / HOUR_MS;
  return {
    name: durationMs === 7 * DAY_MS ? "7d" : Number.isInteger(hours) ? `${hours}h` : `${durationMs / MINUTE_MS}min`,
    durationMs,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: typeof row.reset_at === "string" ? row.reset_at : resetAtFromHint(row.reset_hint, nowMs),
  };
}

/**
 * Normalize the official local Kimi Code server's
 * `GET /api/v1/oauth/usage` envelope. This is an internal seam only.
 */
export function normalizeKimiLocalUsage(payload, nowMs = Date.now()) {
  const data = payload?.data;
  if (data?.kind !== "ok") return null;
  const windows = [];
  const summary = localUsageWindow(data.summary, nowMs);
  if (summary !== null) windows.push(summary);
  for (const row of data.limits ?? []) {
    const window = localUsageWindow(row, nowMs);
    if (window !== null) windows.push(window);
  }
  const extra = data.extra_usage;
  const booster = extra === null || typeof extra !== "object" ? undefined : {
    balanceCny: toInt(extra.balance_cents) !== null ? toInt(extra.balance_cents) / 100 : null,
    monthlyUsedCny: toInt(extra.monthly_used_cents) !== null ? toInt(extra.monthly_used_cents) / 100 : null,
    monthlyLimitCny: toInt(extra.monthly_charge_limit_cents) !== null ? toInt(extra.monthly_charge_limit_cents) / 100 : null,
  };
  return windows.length === 0 ? null : { windows, booster };
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
