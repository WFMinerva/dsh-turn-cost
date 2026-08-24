/**
 * dsh-turn-cost — pure fold/pricing core (no cordis imports, so it can be
 * tested directly with node against real session logs).
 *
 * Replays one session's durable zstd log exactly like the harness token-meter
 * / dsh-spend fold: usage chunks provide early samples, the final
 * `assistant/message` replaces the earlier sample for the same (turn, step),
 * so a step is never double-counted. Pricing uses the official DeepSeek CNY
 * rate card (api-docs.deepseek.com/zh-cn/quick_start/pricing/, effective
 * 2026-08-17): peak 9:00–12:00 and 14:00–18:00 Beijing time. From
 * 2026-08-23 00:00 Beijing time, weekends are off-peak all day. Calls before
 * that cutoff retain the original daily peak windows for historical accuracy.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";

/** zstd frame magic (little-endian 0xFD2FB528). */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Official DeepSeek CNY rates, yuan per million tokens. */
export const OFFICIAL_CNY = {
  "deepseek-v4-pro": {
    peak: { input: 9.0, cacheRead: 0.3, output: 27.0 },
    offPeak: { input: 4.5, cacheRead: 0.15, output: 13.5 },
  },
  "deepseek-v4-flash": {
    peak: { input: 3.0, cacheRead: 0.1, output: 9.0 },
    offPeak: { input: 1.5, cacheRead: 0.05, output: 4.5 },
  },
  "deepseek-v4-flash-vision-exp": {
    // same official CNY card as V4 Flash (vision model launched at Flash price)
    peak: { input: 3.0, cacheRead: 0.1, output: 9.0 },
    offPeak: { input: 1.5, cacheRead: 0.05, output: 4.5 },
  },
};

/** Weekend off-peak rule effective at 2026-08-23 00:00 Beijing time. */
export const WEEKEND_OFF_PEAK_EFFECTIVE_MS = Date.UTC(2026, 7, 22, 16, 0, 0);

/** Peak billing under the official Beijing-time schedule. */
export function isPeak(ms) {
  const beijing = new Date(ms + 8 * 60 * 60 * 1000);
  const weekday = beijing.getUTCDay();
  if (ms >= WEEKEND_OFF_PEAK_EFFECTIVE_MS && (weekday === 0 || weekday === 6)) {
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
 * Cost of one step sample under a rate table; null when the model has no
 * rate entry (never fabricate a price). With `rates` omitted the built-in
 * official CNY card applies, byte-identical to the legacy behavior.
 * Tiered entries need `sample.time` to pick peak/off-peak — without a time
 * the step is unpriced rather than guessed. Flat entries need no time.
 */
export function costOfStep(sample, rates = builtinRates()) {
  const entry = sample.model === undefined ? undefined : resolveRateEntry(rates, sample.model, sample.provider);
  if (entry === undefined || entry === null) return null;
  if (entry.peak !== undefined && entry.offPeak !== undefined) {
    if (typeof sample.time !== "number") return null;
    return tierCost(sample, isPeak(sample.time) ? entry.peak : entry.offPeak);
  }
  return tierCost(sample, entry);
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
    const file = join(root, workspace, sessionId, "session.jsonl.zstd");
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
 * (`<root>/<workspace>/<sessionId>/session.jsonl.zstd`). Unreadable
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
      const file = join(workspaceDir, session.name, "session.jsonl.zstd");
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
  if (found === undefined) return { signature: undefined, samples: [], title: undefined };
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
    signature: `${found.size}:${found.mtimeMs}`,
    samples: foldEvents(events),
    title: sessionTitleOf(events),
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
  };
}

// ── quota (v2): subscription-window attribution + config ──────────────────

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

/**
 * Extract the optional `quota` block from the rates-file JSON (the same
 * user file carries pricing + quota config). Never throws: malformed blocks
 * degrade to an empty table.
 * - `quota.<providerId>`: `{ kind, credentialRef?, baseUrl?, command? }`,
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
      if (typeof entry.credentialRef === "string" && /^[A-Z][A-Z0-9_]*$/.test(entry.credentialRef)) route.credentialRef = entry.credentialRef;
      if (typeof entry.baseUrl === "string" && /^https:\/\//.test(entry.baseUrl)) route.baseUrl = entry.baseUrl;
      // command runs via cmd (shell:true) for .cmd shims — whitelist it down
      // to names/paths so shell metacharacters (& | < > …) can never smuggle
      // a second command into the owner's own config file.
      if (typeof entry.command === "string" && /^[A-Za-z0-9_.:\\/ -]+$/.test(entry.command)) route.command = entry.command;
      quota[key] = route;
    }
  }
  return quota;
}
