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
import { join } from "node:path";
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

/** CNY cost of one step sample; null when the model has no official CNY rate. */
export function costOfStep(sample) {
  const table = sample.model === undefined ? undefined : OFFICIAL_CNY[sample.model];
  if (table === undefined || typeof sample.time !== "number") return null;
  const tier = isPeak(sample.time) ? table.peak : table.offPeak;
  return (
    (sample.inputTokens * tier.input
      + sample.cacheReadTokens * tier.cacheRead
      + sample.outputTokens * tier.output) / 1e6
  );
}

/**
 * Aggregate one turn's cost and token buckets.
 *
 * @param samples - folded samples from {@link foldEvents}.
 * @param turn - turn number.
 * @returns `{ cost, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheHitRate, steps, priced }`
 *   or null when the turn has no usage samples at all. Steps whose model has
 *   no official CNY rate are excluded from `cost` and counted in `unpriced`
 *   (so a partially-priced turn is never silently overstated or hidden).
 */
export function costOfTurn(samples, turn) {
  const inTurn = samples.filter((sample) => sample.turn === turn);
  if (inTurn.length === 0) return null;
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let priced = 0;
  let unpriced = 0;
  for (const sample of inTurn) {
    inputTokens += sample.inputTokens;
    outputTokens += sample.outputTokens;
    cacheReadTokens += sample.cacheReadTokens;
    cacheWriteTokens += sample.cacheWriteTokens;
    const stepCost = costOfStep(sample);
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
    steps: inTurn.length,
    priced,
    unpriced,
  };
}

/** Locate the durable session log for one session id under the sessions root. */
export async function findSessionFile(root, sessionId) {
  let workspaces;
  try {
    workspaces = await readdir(root);
  } catch {
    workspaces = [];
  }
  for (const workspace of workspaces) {
    const file = join(root, workspace, sessionId, "session.jsonl.zstd");
    try {
      const handle = await stat(file);
      if (handle.isFile()) return { file, size: handle.size, mtimeMs: handle.mtimeMs };
    } catch {
      // not found under this workspace — keep looking
    }
  }
  return undefined;
}

/** Read + fold one session's durable log (empty when the file is absent). */
export async function readSessionSamples(root, sessionId) {
  const found = await findSessionFile(root, sessionId);
  if (found === undefined) return { signature: undefined, samples: [] };
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
  };
}
