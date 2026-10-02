/**
 * dsh-turn-cost — pure fold/pricing core (no cordis imports, so it can be
 * tested directly with node against real session logs).
 *
 * Two event sources feed {@link foldEvents}, and they are the same shape:
 *
 * 1. **Official** (preferred): `ctx.sessionQuery.readSession(id).events`, the
 *    harness-sanctioned session-history read (detached clones, replay
 *    validated, live-preferred). The host service uses this whenever the
 *    service is composed, so log-file naming and compression are the
 *    harness's problem, not ours.
 * 2. **Direct log scan** (fallback): this module's own zstd multi-frame JSONL
 *    reader over `<dsh-home>/sessions/**`. Kept only for compositions without
 *    a `sessionQuery` backend; anything reachable through the service must
 *    not need it.
 *
 * Replays one session's durable log exactly like the harness token-meter
 * / dsh-spend fold: usage chunks provide early samples, the final
 * `assistant/message` replaces the earlier sample for the same (turn, step),
 * so a step is never double-counted. Pricing uses the official DeepSeek CNY
 * rate card (api-docs.deepseek.com/zh-cn/quick_start/pricing/, effective
 * 2026-08-17): peak = Monday–Friday 9:00–12:00 and 14:00–18:00 Beijing time.
 * From 2026-08-23 00:00 Beijing time weekends are off-peak all day, and from
 * 2026-09-19 Chinese statutory holidays are off-peak all day as well (the
 * official footnote excludes them from the weekday peak window). Calls before
 * each cutoff retain the schedule that was in force then, for historical
 * accuracy.
 * From 2026-09-10 12:00 Beijing time the flash family was repriced (V4.1 Flash
 * launch): old flash samples keep the superseded card via each entry's
 * `history`, so historical sessions stay accurate.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";

/** zstd frame magic (little-endian 0xFD2FB528). */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Flash-family repricing (official, effective 2026-09-10 12:00 Beijing time):
 * DeepSeek-V4.1-Flash launched and `deepseek-flash` became the canonical model
 * id. The retired flash ids are still callable but are served by V4.1 Flash and
 * billed at the new Flash prices, so all three names carry this cutoff.
 */
export const FLASH_REPRICE_EFFECTIVE_MS = Date.UTC(2026, 8, 10, 4, 0, 0);

/**
 * The superseded 2026-08-17 flash card, kept as each flash entry's `history`
 * so samples recorded before {@link FLASH_REPRICE_EFFECTIVE_MS} still price at
 * the rates that were actually in force when they ran.
 */
const FLASH_CARD_2026_08_17 = {
  peak: { input: 3.0, cacheRead: 0.1, output: 9.0 },
  offPeak: { input: 1.5, cacheRead: 0.05, output: 4.5 },
};

/**
 * Official DeepSeek CNY rates, yuan per million tokens.
 *
 * An entry is either flat or tiered (`peak`/`offPeak`), and may carry a
 * `history` list of superseded cards — each `{ before, peak, offPeak }` applies
 * to samples strictly before its own `before` timestamp; the entry's top-level
 * prices apply from the latest `before` onward (see {@link effectiveRateEntry}).
 */
export const OFFICIAL_CNY = {
  "deepseek-v4-pro": {
    // Unchanged by the 2026-09-10 repricing, and still served by V4-Pro: the
    // official 2026-09-10 changelog keeps the Pro API service, billing
    // unchanged ("计费方式保持不变"), and the pricing page still lists
    // deepseek-v4-pro as V4-Pro-0813 at the rates below (both re-verified
    // 2026-10-03). There is no Pro→Flash repricing cutover to encode.
    peak: { input: 9.0, cacheRead: 0.3, output: 27.0 },
    offPeak: { input: 4.5, cacheRead: 0.15, output: 13.5 },
  },
  "deepseek-flash": {
    // DeepSeek-V4.1-Flash — canonical id since 2026-09-10; no earlier card.
    peak: { input: 2.0, cacheRead: 0.04, output: 8.0 },
    offPeak: { input: 1.0, cacheRead: 0.02, output: 4.0 },
  },
  "deepseek-v4-flash": {
    // Retired id, served by V4.1 Flash at the new Flash prices since the cutoff.
    peak: { input: 2.0, cacheRead: 0.04, output: 8.0 },
    offPeak: { input: 1.0, cacheRead: 0.02, output: 4.0 },
    history: [{ before: FLASH_REPRICE_EFFECTIVE_MS, ...FLASH_CARD_2026_08_17 }],
  },
  "deepseek-v4-flash-vision-exp": {
    // same official CNY card as the other flash names (vision launched at Flash price)
    peak: { input: 2.0, cacheRead: 0.04, output: 8.0 },
    offPeak: { input: 1.0, cacheRead: 0.02, output: 4.0 },
    history: [{ before: FLASH_REPRICE_EFFECTIVE_MS, ...FLASH_CARD_2026_08_17 }],
  },
};

/** Weekend off-peak rule effective at 2026-08-23 00:00 Beijing time. */
export const WEEKEND_OFF_PEAK_EFFECTIVE_MS = Date.UTC(2026, 7, 22, 16, 0, 0);

/**
 * Statutory-holiday off-peak rule. The official pricing footnote reads
 * "北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
 * 其余时段，包括周末及中国法定节假日全天均为空闲时段".
 *
 * DeepSeek publishes no instant for the holiday clause itself; 2026-09-19
 * 00:00 Beijing is the date of the announcement that introduced it (press
 * reports of that day — the docs site carries no news page and the 更新日志 has
 * no entry for it). The choice is observationally free: the earliest statutory
 * holiday after the weekend cutoff is 2026-09-25, so no encoded date falls in
 * the ambiguous window (a test guards that invariant) and no sample can price
 * differently under either reading.
 */
export const HOLIDAY_OFF_PEAK_EFFECTIVE_MS = Date.UTC(2026, 8, 18, 16, 0, 0);

/**
 * Chinese statutory holidays as inclusive Beijing-calendar ranges, per
 * 《国务院办公厅关于2026年部分节假日安排的通知》(国办发明电〔2025〕7号，2025-11-04
 * 发布) — the arrangement the pricing footnote points at. 2026 is the only year
 * the peak/off-peak mechanism has been in force for; later years are **not**
 * encoded, so a holiday outside this table is priced as an ordinary weekday
 * until the table is extended (see docs/DEVELOPMENT.md §三).
 */
export const STATUTORY_HOLIDAY_RANGES = Object.freeze([
  Object.freeze(["2026-01-01", "2026-01-03"]), // 元旦 3 天
  Object.freeze(["2026-02-15", "2026-02-23"]), // 春节 9 天
  Object.freeze(["2026-04-04", "2026-04-06"]), // 清明节 3 天
  Object.freeze(["2026-05-01", "2026-05-05"]), // 劳动节 5 天
  Object.freeze(["2026-06-19", "2026-06-21"]), // 端午节 3 天
  Object.freeze(["2026-09-25", "2026-09-27"]), // 中秋节 3 天
  Object.freeze(["2026-10-01", "2026-10-07"]), // 国庆节 7 天
]);

/**
 * Makeup workdays that fall on a weekend ("调休上班"), same notice. Recorded
 * for auditability only — **pricing never consults this list**: the weekend
 * rule above already makes every Saturday/Sunday off-peak, and the official
 * note keeps makeup weekends off-peak, so building a "workday calendar" out of
 * this list would be wrong. Kept in step with {@link STATUTORY_HOLIDAY_RANGES}.
 */
export const MAKEUP_WORKDAY_WEEKENDS = Object.freeze([
  "2026-01-04", // 元旦调休（周日）
  "2026-02-14", // 春节调休（周六）
  "2026-02-28", // 春节调休（周六）
  "2026-05-09", // 劳动节调休（周六）
  "2026-09-20", // 国庆调休（周日）
  "2026-10-10", // 国庆调休（周六）
]);

/** Expand an inclusive ISO date range into its day keys, inclusive both ends. */
function dayKeysBetween(from, to) {
  const keys = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= end; ms += 24 * 60 * 60 * 1000) {
    keys.push(new Date(ms).toISOString().slice(0, 10));
  }
  return keys;
}

/** Every day key (YYYY-MM-DD) covered by {@link STATUTORY_HOLIDAY_RANGES}. */
export const STATUTORY_HOLIDAYS = Object.freeze(
  STATUTORY_HOLIDAY_RANGES.flatMap(([from, to]) => dayKeysBetween(from, to)).sort(),
);

const HOLIDAY_DAY_SET = new Set(STATUTORY_HOLIDAYS);

/** True when one timestamp lands on a Chinese statutory holiday (Beijing day). */
export function isStatutoryHoliday(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return false;
  return HOLIDAY_DAY_SET.has(beijingDay(ms));
}

/**
 * Peak billing under the official Beijing-time schedule: Monday–Friday
 * 9:00–12:00 and 14:00–18:00, minus weekends (from 2026-08-23) and Chinese
 * statutory holidays (from 2026-09-19). Each cutoff only ever adds off-peak
 * time, so earlier calls keep the schedule they were billed under.
 */
export function isPeak(ms) {
  const beijing = new Date(ms + 8 * 60 * 60 * 1000);
  const weekday = beijing.getUTCDay();
  if (ms >= WEEKEND_OFF_PEAK_EFFECTIVE_MS && (weekday === 0 || weekday === 6)) {
    return false;
  }
  if (ms >= HOLIDAY_OFF_PEAK_EFFECTIVE_MS && isStatutoryHoliday(ms)) {
    return false;
  }
  const hour = beijing.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

/** Beijing-calendar day key (YYYY-MM-DD) for one timestamp; null without time. */
export function beijingDay(ms) {
  if (typeof ms !== "number") return null;
  const beijing = new Date(ms + 8 * 60 * 60 * 1000);
  const month = String(beijing.getUTCMonth() + 1).padStart(2, "0");
  const day = String(beijing.getUTCDate()).padStart(2, "0");
  return `${beijing.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Rate-table shape (the rates.json schema, version 1):
 * `{ version, currency, models: { <model>: entry }, aliases: { <alias>: <model> } }`.
 * Model keys may be provider-scoped (`"<provider>/<model>"`) — the same model
 * name can be billed differently per route (subscription pool vs. official
 * pay-per-token); scoped keys win over bare names. An entry is either flat —
 * `{ input, cacheRead, cacheWrite?, output }` in currency per million tokens
 * (missing fields price as 0) — or tiered — `{ peak: {...}, offPeak: {...} }`
 * using the official Beijing-time schedule. A flat all-zero entry with a
 * `note` is the honest way to register a subscription-model route: tokens
 * are shown, money stays 0 by definition.
 */
export const RATES_VERSION = 1;

/** Built-in rate table: the official DeepSeek CNY card, no aliases. */
export function builtinRates() {
  return { version: RATES_VERSION, currency: "CNY", models: { ...OFFICIAL_CNY }, aliases: {} };
}

/**
 * Overlay a custom rate table on top of the built-in one. Custom models and
 * aliases win per key; malformed input degrades to the base table unchanged.
 */
export function mergeRates(base, override) {
  if (override === null || typeof override !== "object") return base;
  return {
    version: RATES_VERSION,
    currency: typeof override.currency === "string" ? override.currency : base.currency,
    models: { ...base.models, ...(typeof override.models === "object" && override.models !== null ? override.models : {}) },
    aliases: { ...base.aliases, ...(typeof override.aliases === "object" && override.aliases !== null ? override.aliases : {}) },
  };
}

/**
 * Resolve one sample to its rate entry. Lookup order: provider-scoped key
 * `"<provider>/<model>"` (the same model name can be billed differently per
 * route — e.g. a model reached through a subscription pool vs. the official
 * pay-per-token route), then the bare model name, then the provider-scoped
 * alias, then the bare alias target (one hop). All lookups are own-key
 * guarded, so prototype names (`__proto__`, `constructor`) never resolve.
 */
export function resolveRateEntry(rates, model, provider) {
  if (typeof model !== "string" || rates === null || rates === undefined) return undefined;
  const models = rates.models ?? {};
  const aliases = rates.aliases ?? {};
  const scoped = typeof provider === "string" ? `${provider}/${model}` : undefined;
  if (scoped !== undefined && Object.hasOwn(models, scoped)) return models[scoped];
  if (Object.hasOwn(models, model)) return models[model];
  const canonical = Object.hasOwn(aliases, model) ? aliases[model] : undefined;
  if (typeof canonical !== "string") return undefined;
  const scopedAlias = typeof provider === "string" ? `${provider}/${canonical}` : undefined;
  if (scopedAlias !== undefined && Object.hasOwn(models, scopedAlias)) return models[scopedAlias];
  return Object.hasOwn(models, canonical) ? models[canonical] : undefined;
}

/** Cost of one sample under one flat/tier bucket set; missing prices are 0. */
function tierCost(sample, tier) {
  return (
    ((Number(sample.inputTokens) || 0) * (Number(tier.input) || 0)
      + (Number(sample.cacheReadTokens) || 0) * (Number(tier.cacheRead) || 0)
      + (Number(sample.cacheWriteTokens) || 0) * (Number(tier.cacheWrite) || 0)
      + (Number(sample.outputTokens) || 0) * (Number(tier.output) || 0)) / 1e6
  );
}

/** Yield the UTF-8 text of every zstd frame in a session log buffer. */
export function* frameTexts(buffer) {
  let search = 0;
  for (;;) {
    const at = buffer.indexOf(ZSTD_MAGIC, search);
    if (at === -1) break;
    const next = buffer.indexOf(ZSTD_MAGIC, at + 4);
    const end = next === -1 ? buffer.length : next;
    try {
      yield zstdDecompressSync(buffer.subarray(at, end)).toString("utf8");
    } catch (error) {
      throw new Error(`zstd frame at offset ${at} failed to decode: ${String(error?.message ?? error)}`, { cause: error });
    }
    search = end;
  }
}

/** Parse one JSONL line; malformed lines yield null (never throw). */
export function parseEvent(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The provider-reported usage attached to one event, if any. */
export function usageOf(event) {
  if (event?.type === "assistant/chunk" && event.data?.chunk?.type === "usage") {
    return event.data.chunk.usage;
  }
  if (event?.type === "assistant/message" && event.data?.usage !== undefined) {
    return event.data.usage;
  }
  return undefined;
}

/** Normalize one usage bucket (unknown fields default to zero). */
export function usageBuckets(usage) {
  return {
    inputTokens: Number(usage?.inputTokens) || 0,
    outputTokens: Number(usage?.outputTokens) || 0,
    cacheReadTokens: Number(usage?.cacheReadTokens) || 0,
    cacheWriteTokens: Number(usage?.cacheWriteTokens) || 0,
  };
}

/**
 * Fold an event stream into per-(turn, step) call samples.
 * A later sample for the same (turn, step) replaces the earlier one (chunk
 * samples are superseded by the step's final assistant/message usage), so
 * summing samples never double-counts.
 *
 * @param events - durable/live events (each with `.type`, `.time`, `.data`).
 * @returns samples `{ time, model, provider, turn, step, ...buckets }`.
 */
export function foldEvents(events) {
  const samples = new Map();
  let header;
  for (const event of events ?? []) {
    switch (event.type) {
      case "request/header": {
        const config = event.data?.header?.config;
        header = {
          provider: typeof config?.provider === "string" ? config.provider : undefined,
          model: typeof config?.model === "string" ? config.model : undefined,
        };
        break;
      }
      case "request/context": {
        if (header === undefined) {
          header = {
            provider: typeof event.data?.provider === "string" ? event.data.provider : undefined,
            model: typeof event.data?.model === "string" ? event.data.model : undefined,
          };
        }
        break;
      }
      default: {
        const usage = usageOf(event);
        if (usage === undefined) break;
        const turn = event.data?.turn;
        const step = event.data?.step;
        if (typeof turn !== "number" || typeof step !== "number") break;
        samples.set(`${turn}:${step}`, {
          time: typeof event.time === "number" ? event.time : undefined,
          model: header?.model,
          provider: header?.provider,
          turn,
          step,
          ...usageBuckets(usage),
        });
        break;
      }
    }
  }
  return [...samples.values()];
}

/**
 * Identity of one event log: event count plus highest `seq`. Derived from the
 * log alone (never from file metadata), so the official read and the log scan
 * produce comparable keys and a cached fold can be reused while the log holds
 * still. Cheap: one pass over the array, no pricing.
 *
 * @param events - a complete event log (any source).
 * @returns the signature string.
 */
export function sessionLogSignature(events) {
  const list = Array.isArray(events) ? events : [];
  let lastSeq = -1;
  for (const event of list) {
    const seq = event?.seq;
    if (typeof seq === "number" && Number.isFinite(seq) && seq > lastSeq) lastSeq = seq;
  }
  return `sq:${list.length}:${lastSeq}`;
}

/**
 * Map every assistant message id in one event log to the turn/step that
 * produced it, so a per-message surface can ask for its own turn without
 * re-deriving the conversation tree. The durable `assistant/message` event
 * carries both `data.message.id` and `data.turn`/`data.step`; a later event for
 * the same id wins (a re-emitted message supersedes the earlier one).
 *
 * @param events - a complete event log (any source).
 * @returns `{ [messageId]: { turn, step } }`; empty when nothing is recorded.
 */
export function messageTurnsOf(events) {
  const turns = {};
  for (const event of events ?? []) {
    if (event?.type !== "assistant/message") continue;
    const id = event.data?.message?.id;
    const turn = event.data?.turn;
    if (typeof id !== "string" || id.length === 0 || typeof turn !== "number") continue;
    const step = event.data?.step;
    turns[id] = typeof step === "number" ? { turn, step } : { turn };
  }
  return turns;
}

/**
 * Fold a complete session event log obtained from the official
 * `ctx.sessionQuery` service (`readSession(id)` / `observeSession(id)`) into
 * the same `{ signature, samples, title, messageTurns }` fold the log scanner
 * returns.
 *
 * The service returns detached, replay-validated clones whose entries carry the
 * very same `{ type, seq, time, data }` shape as the durable JSONL records, so
 * one fold serves both sources and their results stay comparable.
 *
 * @param events - the service's complete raw event log for one session.
 * @returns the fold, keyed by {@link sessionLogSignature}.
 */
export function foldSessionEvents(events) {
  const list = Array.isArray(events) ? events : [];
  return {
    signature: sessionLogSignature(list),
    samples: foldEvents(list),
    title: sessionTitleOf(list),
    messageTurns: messageTurnsOf(list),
  };
}

/**
 * Resolve the rate card in force at one sample's timestamp. Entries without a
 * `history` list are returned unchanged. With one, every `{ before, ... }`
 * generation whose `before` is strictly after `time` is a candidate; the
 * newest such generation wins, otherwise the entry's own (current) prices
 * apply. A time is required to pick a generation: an entry carrying `history`
 * without a usable `time` resolves to `undefined`, and the caller prices the
 * step as unpriced rather than guessing a generation.
 *
 * @param entry - a rate-table entry (flat or peak/offPeak, optional `history`).
 * @param time - the sample's epoch milliseconds, if recorded.
 */
export function effectiveRateEntry(entry, time) {
  if (entry === null || entry === undefined) return undefined;
  const history = entry.history;
  if (!Array.isArray(history)) return entry;
  if (typeof time !== "number" || !Number.isFinite(time)) return undefined;
  let picked;
  for (const past of history) {
    if (past === null || typeof past !== "object") continue;
    if (typeof past.before !== "number" || !Number.isFinite(past.before)) continue;
    if (time < past.before && (picked === undefined || past.before > picked.before)) picked = past;
  }
  return picked ?? entry;
}

/**
 * Cost of one step sample under a rate table; null when the model has no
 * rate entry (never fabricate a price). With `rates` omitted the built-in
 * official CNY card applies, byte-identical to the legacy behavior.
 * Tiered entries need `sample.time` to pick peak/off-peak — without a time
 * the step is unpriced rather than guessed. Flat entries need no time.
 */
export function costOfStep(sample, rates = builtinRates()) {
  const entry = sample.model === undefined ? undefined : resolveRateEntry(rates, sample.model, sample.provider);
  if (entry === undefined || entry === null) return null;
  const effective = effectiveRateEntry(entry, sample.time);
  if (effective === undefined) return null;
  if (effective.peak !== undefined && effective.offPeak !== undefined) {
    if (typeof sample.time !== "number") return null;
    return tierCost(sample, isPeak(sample.time) ? effective.peak : effective.offPeak);
  }
  return tierCost(sample, effective);
}

/**
 * Shared aggregation over a sample set: token buckets, cost, priced/unpriced
 * split, plus the model set and time span observed. Steps whose model has no
 * rate entry are excluded from `cost` and counted in `unpriced` (so a
 * partially-priced aggregate is never silently overstated or hidden).
 */
function aggregateSamples(samples, rates) {
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let priced = 0;
  let unpriced = 0;
  const models = new Set();
  let firstTime;
  let lastTime;
  for (const sample of samples) {
    inputTokens += sample.inputTokens;
    outputTokens += sample.outputTokens;
    cacheReadTokens += sample.cacheReadTokens;
    cacheWriteTokens += sample.cacheWriteTokens;
    if (typeof sample.model === "string") models.add(sample.model);
    if (typeof sample.time === "number") {
      if (firstTime === undefined || sample.time < firstTime) firstTime = sample.time;
      if (lastTime === undefined || sample.time > lastTime) lastTime = sample.time;
    }
    const stepCost = costOfStep(sample, rates);
    if (stepCost === null) {
      unpriced += 1;
      continue;
    }
    cost += stepCost;
    priced += 1;
  }
  return {
    cost,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheHitRate: inputTokens + cacheReadTokens > 0
      ? cacheReadTokens / (inputTokens + cacheReadTokens)
      : null,
    steps: samples.length,
    priced,
    unpriced,
    models: [...models],
    firstTime,
    lastTime,
  };
}

/**
 * Aggregate one turn's cost and token buckets.
 *
 * @param samples - folded samples from {@link foldEvents}.
 * @param turn - turn number.
 * @param rates - optional rate table; defaults to the built-in CNY card.
 * @returns the aggregate, or null when the turn has no usage samples at all.
 */
export function costOfTurn(samples, turn, rates) {
  const inTurn = samples.filter((sample) => sample.turn === turn);
  if (inTurn.length === 0) return null;
  return aggregateSamples(inTurn, rates);
}

/**
 * Aggregate a whole session (every turn). Same shape as {@link costOfTurn}
 * plus `models`/`firstTime`/`lastTime`; null when the session has no usage.
 */
export function costOfSession(samples, rates) {
  if (samples === undefined || samples.length === 0) return null;
  return aggregateSamples(samples, rates);
}

/** Session ids are harness-minted slugs; anything else is rejected (path safety). */
export function isValidSessionId(sessionId) {
  return typeof sessionId === "string" && /^[A-Za-z0-9._-]+$/.test(sessionId);
}

/**
 * Session-log base name for a format generation: `session.jsonl` for
 * generation 0 and `session.v<N>.jsonl` for every later one. The harness
 * switched to the versioned name with the v2 format (0.1.3-alpha.1) and kept
 * it for v3 (0.1.5), so the pre-v2 bare name only appears on logs written by
 * 0.1.2 and earlier.
 *
 * @param {number} generation - Session format version.
 * @returns {string} The base log name without the compression suffix.
 */
export function sessionLogBaseName(generation) {
  const version = Number(generation);
  return Number.isInteger(version) && version > 0 ? `session.v${version}.jsonl` : "session.jsonl";
}

/** Matches both the bare `session.jsonl` and versioned `session.v<N>.jsonl`. */
const SESSION_LOG_BASE_PATTERN = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/;

/**
 * Pick the durable log inside one session directory. Honours both naming
 * generations and prefers the highest number, because a migrated session keeps
 * its pre-migration file beside the new one and the newest generation is the
 * authoritative record. Unreadable directories yield `undefined`.
 *
 * @param {string} sessionDir - Absolute path of one session's artifact dir.
 * @param {string} [compressionSuffix] - Suffix appended to the base name.
 * @returns {Promise<string | undefined>} The log's base name, or undefined.
 */
export async function pickSessionLogName(sessionDir, compressionSuffix = ".zstd") {
  let names;
  try {
    names = await readdir(sessionDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  let best;
  let bestVersion = 0;
  for (const name of names) {
    if (!name.isFile()) continue;
    if (!name.name.endsWith(compressionSuffix)) continue;
    const stem = name.name.slice(0, -compressionSuffix.length);
    const match = SESSION_LOG_BASE_PATTERN.exec(stem);
    if (match === null) continue;
    const version = match[1] === undefined ? 0 : Number(match[1]);
    if (best === undefined || version > bestVersion) {
      best = name.name;
      bestVersion = version;
    }
  }
  return best;
}

/** Locate the durable session log for one session id under the sessions root. */
export async function findSessionFile(root, sessionId) {
  if (!isValidSessionId(sessionId)) return undefined;
  const resolvedRoot = resolve(root);
  // Drive-root roots already end with the separator; avoid "C:\" + "\" = "C:\\".
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  let workspaces;
  try {
    workspaces = await readdir(root);
  } catch {
    workspaces = [];
  }
  for (const workspace of workspaces) {
    const sessionDir = join(root, workspace, sessionId);
    const logName = await pickSessionLogName(sessionDir);
    if (logName === undefined) continue;
    const file = join(sessionDir, logName);
    // Defense in depth: the joined path must stay inside the sessions root.
    if (!resolve(file).startsWith(rootPrefix)) continue;
    try {
      const handle = await stat(file);
      if (handle.isFile()) return { file, size: handle.size, mtimeMs: handle.mtimeMs };
    } catch {
      // not found under this workspace — keep looking
    }
  }
  return undefined;
}

/**
 * Enumerate every durable session log under the sessions root
 * (`<root>/<workspace>/<sessionId>/session[.v<N>].jsonl.zstd`). Unreadable
 * directories and missing files are skipped — enumeration degrades, never
 * throws.
 */
export async function listSessions(root) {
  const found = [];
  let workspaces;
  try {
    workspaces = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = join(root, workspace.name);
    let sessions;
    try {
      sessions = await readdir(workspaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const sessionDir = join(workspaceDir, session.name);
      const logName = await pickSessionLogName(sessionDir);
      if (logName === undefined) continue;
      const file = join(sessionDir, logName);
      try {
        const handle = await stat(file);
        if (handle.isFile()) {
          found.push({ sessionId: session.name, workspace: workspace.name, file, size: handle.size, mtimeMs: handle.mtimeMs });
        }
      } catch {
        // not a readable log — keep looking
      }
    }
  }
  return found;
}

/** The session's durable title (last `session/title` event), if recorded. */
export function sessionTitleOf(events) {
  let title;
  for (const event of events ?? []) {
    if (event?.type === "session/title" && typeof event.data?.title === "string") {
      title = event.data.title;
    }
  }
  return title;
}

/** Read + fold one session's durable log (empty when the file is absent). */
export async function readSessionSamples(root, sessionId) {
  const found = await findSessionFile(root, sessionId);
  if (found === undefined) return { signature: undefined, samples: [], title: undefined, messageTurns: {} };
  const buffer = await readFile(found.file);
  const events = [];
  for (const text of frameTexts(buffer)) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const event = parseEvent(trimmed);
      if (event !== null && event.type !== "session") events.push(event);
    }
  }
  return {
    signature: sessionLogSignature(events),
    samples: foldEvents(events),
    title: sessionTitleOf(events),
    messageTurns: messageTurnsOf(events),
  };
}

/**
 * Read + fold one enumerated session entry from {@link listSessions}
 * (skips the per-id lookup the single-session path performs).
 */
export async function readSessionEntry(entry) {
  const buffer = await readFile(entry.file);
  const events = [];
  for (const text of frameTexts(buffer)) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const event = parseEvent(trimmed);
      if (event !== null && event.type !== "session") events.push(event);
    }
  }
  return {
    signature: `${entry.size}:${entry.mtimeMs}`,
    samples: foldEvents(events),
    title: sessionTitleOf(events),
    messageTurns: messageTurnsOf(events),
  };
}

// ── quota (v2): subscription-window helpers + config ──────────────────────

/**
 * Count one session's LLM calls (= provider requests) to one provider route
 * inside a time window `[startMs, endMs)`. Samples without a time or a
 * provider never match. This is the local side of "what share of the
 * subscription window did this conversation burn" — the authoritative
 * used/remaining numbers always come from the platform endpoint; the local
 * count covers only DSH-originated calls (CLI/desktop burn the same pool
 * invisibly).
 */
export function requestsInWindow(samples, provider, startMs, endMs) {
  if (!Array.isArray(samples)) return 0;
  if (typeof provider !== "string" || provider.length === 0) return 0;
  if (typeof startMs !== "number" || !Number.isFinite(startMs)) return 0;
  if (typeof endMs !== "number" || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  let count = 0;
  for (const sample of samples) {
    if (sample?.provider !== provider) continue;
    const time = sample.time;
    if (typeof time !== "number" || !Number.isFinite(time)) continue;
    if (time >= startMs && time < endMs) count += 1;
  }
  return count;
}

/** Known quota-source kinds; anything else degrades to "not configured". */
export const QUOTA_KINDS = new Set(["kimi-usages", "aliyun-bl"]);

/** Standard subscription routes shipped by DSH's built-in model catalog. */
export function builtinQuotaRoutes() {
  return {
    "kimi-coding": { kind: "kimi-usages", baseUrl: "http://127.0.0.1:58627" },
    "qwen-token-plan-cn": { kind: "aliyun-bl" },
  };
}

/**
 * Extract the optional `quota` block from the rates-file JSON (the same
 * user file carries pricing + quota config). Never throws: malformed blocks
 * degrade to an empty table.
 * - `quota.<providerId>`: `{ kind, baseUrl?, command? }`,
 *   `kind` one of QUOTA_KINDS. Non-string provider ids and unknown kinds
 *   are skipped. `Object.hasOwn` guards against prototype names.
 */
export function quotaConfigOf(parsed) {
  const quota = {};
  if (parsed === null || typeof parsed !== "object") return quota;
  const rawQuota = parsed.quota;
  if (rawQuota !== null && typeof rawQuota === "object") {
    for (const key of Object.keys(rawQuota)) {
      if (!Object.hasOwn(rawQuota, key)) continue;
      // Prototype names are never route ids: assigning `quota["__proto__"]`
      // would mutate this object's prototype instead of adding a key.
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const entry = rawQuota[key];
      if (entry === null || typeof entry !== "object") continue;
      if (!QUOTA_KINDS.has(entry.kind)) continue;
      const route = { kind: entry.kind };
      if (entry.kind === "kimi-usages") {
        // Kimi subscription usage is available only through the official
        // Kimi Code loopback OAuth server. Model API keys are deliberately
        // not accepted as quota credentials.
        if (typeof entry.baseUrl === "string"
          && /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(entry.baseUrl)) route.baseUrl = entry.baseUrl;
      }
      // Windows uses cmd.exe only to launch npm's .cmd shim. Keep this value
      // to one executable name on PATH: no paths, whitespace, or arguments.
      if (typeof entry.command === "string" && /^[A-Za-z0-9._-]+$/.test(entry.command)) route.command = entry.command;
      quota[key] = route;
    }
  }
  return quota;
}

/**
 * Overlay a rates file's quota block on built-in routes. A route with
 * `{ "enabled": false }` explicitly removes the built-in/default route;
 * malformed entries do not erase a working default.
 */
export function mergeQuotaRoutes(base, parsed) {
  const merged = {};
  if (base !== null && typeof base === "object") {
    for (const key of Object.keys(base)) {
      if (!Object.hasOwn(base, key)) continue;
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const entry = base[key];
      if (entry !== null && typeof entry === "object" && QUOTA_KINDS.has(entry.kind)) merged[key] = { ...entry };
    }
  }
  const rawQuota = parsed !== null && typeof parsed === "object" ? parsed.quota : undefined;
  if (rawQuota === null || typeof rawQuota !== "object") return merged;
  const overrides = quotaConfigOf(parsed);
  for (const key of Object.keys(rawQuota)) {
    if (!Object.hasOwn(rawQuota, key)) continue;
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const entry = rawQuota[key];
    if (entry !== null && typeof entry === "object" && entry.enabled === false) {
      delete merged[key];
      continue;
    }
    if (Object.hasOwn(overrides, key)) merged[key] = overrides[key];
  }
  return merged;
}
