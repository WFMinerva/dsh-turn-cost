/**
 * dsh-turn-cost host plugin.
 *
 * A Typert Remote service (`turnCost`) answering three questions from
 * provider-reported usage in the durable session logs merged with the live
 * in-memory session events: the cost of one turn (`turnCost/query`), of a
 * whole session (`turnCost/sessionTotals`), and a cross-session summary
 * grouped by day and by model (`turnCost/summary`). Pricing uses the
 * built-in official DeepSeek CNY card, optionally overlaid with a custom
 * rate table (`ratesPath` config — JSON, never committed, see README).
 * The web GUI reaches the service through the standard `/api` Remote
 * gateway (SRC discovery — no generated typert manifest).
 */
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Service } from "@deepseek-ai/cordis";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { beijingDay, builtinRates, costOfSession, costOfTurn, findSessionFile, foldEvents, isValidSessionId, listSessions, mergeRates, quotaConfigOf, readSessionEntry, readSessionSamples, requestsInWindow } from "./fold.js";

const execFileAsync = promisify(execFile);

/**
 * Effective plugin file: rate table (built-in card overlaid with the user's
 * rates file) plus the optional `display`/`quota` blocks living in the same
 * JSON. An unreadable/malformed file degrades to the built-in card and
 * default display/quota config (with a log line) — the plugin keeps working
 * rather than dying.
 */
function loadPluginFile(ratesPath, warn) {
  const loaded = { rates: builtinRates(), display: { showCost: false }, quota: {} };
  if (typeof ratesPath !== "string" || ratesPath.length === 0) return loaded;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(ratesPath, "utf8"));
  } catch (error) {
    warn?.(`rates file unreadable (${String(error?.message ?? error)}); built-in CNY card only`);
    return loaded;
  }
  loaded.rates = mergeRates(loaded.rates, parsed);
  const { display, quota } = quotaConfigOf(parsed);
  loaded.display = display;
  loaded.quota = quota;
  return loaded;
}

/**
 * Resolve one credential reference (e.g. `KIMI_CODING_API_KEY`) from the
 * harness home's `.credentials.yaml` (`refs:` block, `NAME: value` lines).
 * Deliberately a tiny line parser for this one known file shape — no YAML
 * dependency. The value is returned in memory only: never logged, never
 * written anywhere.
 */
function resolveCredentialValue(credentialsFile, refName) {
  if (typeof refName !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(refName)) return undefined;
  let text;
  try {
    text = readFileSync(credentialsFile, "utf8");
  } catch {
    return undefined;
  }
  let inRefs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) { inRefs = true; continue; }
    if (inRefs && /^\S/.test(line)) break; // left the refs block
    if (!inRefs) continue;
    const match = line.match(/^\s+([A-Z][A-Z0-9_]*):\s*(\S+)\s*$/);
    if (match?.[1] === refName) {
      // Strip one pair of surrounding quotes if present.
      return match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
  return undefined;
}

/** fetch JSON with a hard timeout; rejects on transport or non-2xx. */
async function fetchJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: abort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

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
 * booster wallet. Verified live 2026-08-24 (see tool-library 立项档案 §8.1):
 * `usage` = 7-day window, `limits[]` = sub-windows (5h), amounts in the
 * booster wallet are nano-CNY (1e-8), monthly figures are cents (1e-2).
 */
function normalizeKimiUsages(payload) {
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
 * Normalize `bl usage token-plan --output json` output. The exact shape is
 * verified against the real CLI at deploy time (门三机主配合项); until then
 * accept the common key spellings (console-gateway style and plain style).
 * Unrecognized output degrades to ok:false with a truncated raw excerpt.
 */
function normalizeAliyunBl(payload) {
  const pick = (...keys) => {
    for (const key of keys) {
      if (payload !== null && typeof payload === "object" && Object.hasOwn(payload, key)) return payload[key];
    }
    return undefined;
  };
  const total = toInt(pick("total", "totalValue", "TotalValue", "limit"));
  const used = toInt(pick("used", "usedValue", "UsedValue"));
  const remaining = toInt(pick("remaining", "surplus", "totalSurplusValue", "TotalSurplusValue"));
  const expireRaw = pick("expireAt", "nearestExpireDate", "NearestExpireDate");
  if (total === null && used === null && remaining === null) return null;
  return {
    total, used, remaining,
    expireAt: typeof expireRaw === "string" ? expireRaw : undefined,
  };
}

// ── decorator support (stage-3 decorators, transpiled — Node has none) ─────
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) {
      if (kind === "field") initializers.unshift(_);
      else descriptor[key] = _;
    }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var __runInitializers = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  }
  return useValue ? value : void 0;
};

/**
 * Per-turn cost lookup for the web UI.
 *
 * Registered as `ctx.turnCost`; the Remote gateway discovers the
 * `turnCost/query` endpoint through the typertRemote binding + Remote
 * markers (SRC discovery), so no generated descriptor files are needed.
 */
let TurnCostService = (() => {
  let _classSuper = TypertRemoteService;
  let _instanceExtraInitializers = [];
  let _query_decorators;
  let _sessionTotals_decorators;
  let _summary_decorators;
  let _quota_decorators;
  return class TurnCostService extends _classSuper {
    static {
      const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
      _query_decorators = [Remote("query")];
      __esDecorate(this, null, _query_decorators, {
        kind: "method",
        name: "query",
        static: false,
        private: false,
        access: { has: (obj) => "query" in obj, get: (obj) => obj.query },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      _sessionTotals_decorators = [Remote("sessionTotals")];
      __esDecorate(this, null, _sessionTotals_decorators, {
        kind: "method",
        name: "sessionTotals",
        static: false,
        private: false,
        access: { has: (obj) => "sessionTotals" in obj, get: (obj) => obj.sessionTotals },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      _summary_decorators = [Remote("summary")];
      __esDecorate(this, null, _summary_decorators, {
        kind: "method",
        name: "summary",
        static: false,
        private: false,
        access: { has: (obj) => "summary" in obj, get: (obj) => obj.summary },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      _quota_decorators = [Remote("quota")];
      __esDecorate(this, null, _quota_decorators, {
        kind: "method",
        name: "quota",
        static: false,
        private: false,
        access: { has: (obj) => "quota" in obj, get: (obj) => obj.quota },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      if (_metadata) Object.defineProperty(this, Symbol.metadata, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: _metadata
      });
    }

    /** Required services: the live-session registry (durable logs are scanned directly). */
    static inject = ["sessions"];

    /** `ratesPath`: optional path to a custom rate-table JSON (overlays the built-in CNY card). */
    // schemastery (not zod): object fields are optional by default and there is no `.optional()`
    // method — calling it crashes the whole dsh plugin tree at boot. Keep this zod-ism out.
    static Config = z.object({ ratesPath: z.string() });

    sessionsRoot;
    /** Effective rate table (built-in card overlaid with the rates file). */
    rates;
    /** Display switches from the rates file (`display` block); 门二 v2: cost hidden by default. */
    display = { showCost: false };
    /** Quota route config from the rates file (`quota` block). */
    quotaRoutes = {};
    /** Absolute path of the harness credential store (values never logged). */
    credentialsFile;
    /** `sessionId -> { signature, samples, title }` cache; invalidated when the log changes. */
    cache = new Map();
    /** `workspace/sessionId -> { signature, fold }` cache for the cross-session summary. */
    summaryCache = new Map();
    /** `routeId -> { at, result }` TTL cache for platform quota reads. */
    quotaCache = new Map();

    /**
     * @param ctx - host context.
     * @param config - validated plugin configuration.
     */
    constructor(ctx, config = {}) {
      super(ctx, "turnCost");
      __runInitializers(this, _instanceExtraInitializers);
      this.sessionsRoot = dshHomePath("sessions");
      this.credentialsFile = dshHomePath(".credentials.yaml");
      const loaded = loadPluginFile(config?.ratesPath, (line) => {
        try { ctx.logger?.("dsh-turn-cost")?.warn?.(line); } catch { /* logging is best-effort */ }
      });
      this.rates = loaded.rates;
      this.display = loaded.display;
      this.quotaRoutes = loaded.quota;
      // Drop the cached folds when the plugin is reconfigured/reloaded.
      ctx.effect(() => () => {
        this.cache = new Map();
        this.summaryCache = new Map();
        this.quotaCache = new Map();
      }, "dsh-turn-cost: reset cache on unload");
    }

    /** Cost fields nulled when 门二 v2 hides money (client renders tokens-only). */
    maskCost(result) {
      if (result === null || typeof result !== "object") return result;
      if (this.display.showCost) return result;
      return { ...result, cost: null };
    }

    /** Latest fold of one session: durable log merged with the live events. */
    async foldFor(sessionId) {
      const live = this.ctx.sessions.list().find((session) => session.id === sessionId);
      const liveEvents = live?.events ?? [];
      const found = await findSessionFile(this.sessionsRoot, sessionId);
      const signature = `${found === undefined ? "missing" : `${found.size}:${found.mtimeMs}`}|live:${liveEvents.length}`;
      const cached = this.cache.get(sessionId);
      if (cached !== undefined && cached.signature === signature) return cached;

      const durable = found === undefined
        ? { samples: [], title: undefined }
        : await readSessionSamples(this.sessionsRoot, sessionId);      // Merge durable + live: a later live sample for the same (turn, step)
      // replaces the durable one, so the merge is idempotent.
      const merged = new Map();
      for (const sample of durable.samples) merged.set(`${sample.turn}:${sample.step}`, sample);
      for (const sample of foldEvents(liveEvents)) merged.set(`${sample.turn}:${sample.step}`, sample);
      const fold = { samples: [...merged.values()], title: durable.title };
      this.cache.set(sessionId, { signature, ...fold });
      return { signature, ...fold };
    }

    /** Fold of one enumerated session entry (summary path), cached per signature. */
    async foldEntry(entry) {
      const cacheKey = `${entry.workspace}/${entry.sessionId}`;
      const live = this.ctx.sessions.list().find((session) => session.id === entry.sessionId);
      const liveEvents = live?.events ?? [];
      const signature = `${entry.size}:${entry.mtimeMs}|live:${liveEvents.length}`;
      const cached = this.summaryCache.get(cacheKey);
      if (cached !== undefined && cached.signature === signature) return cached.fold;

      const durable = await readSessionEntry(entry);
      const merged = new Map();
      for (const sample of durable.samples) merged.set(`${sample.turn}:${sample.step}`, sample);
      for (const sample of foldEvents(liveEvents)) merged.set(`${sample.turn}:${sample.step}`, sample);
      const fold = { samples: [...merged.values()], title: durable.title };
      this.summaryCache.set(cacheKey, { signature, fold });
      return fold;
    }

    /**
     * Estimated CNY cost of one turn of one session.
     *
     * @param request - `{ sessionId, turn }`. No default value: the gateway
     *   derives parameters from the method signature.
     * @returns the turn aggregate (pure JSON) or null when there is nothing
     *   to price.
     */
    async query(request) {
      const sessionId = request?.sessionId;
      const turn = request?.turn;
      if (!isValidSessionId(sessionId) || typeof turn !== "number") return null;
      let samples;
      try {
        samples = (await this.foldFor(sessionId)).samples;
      } catch {
        return null;
      }
      const result = costOfTurn(samples, turn, this.rates);
      if (result === null) return null;
      return this.maskCost({ sessionId, turn, ...result });
    }

    /**
     * Whole-session aggregate (all turns) for the composer-dock readout.
     *
     * @param request - `{ sessionId }`.
     * @returns `{ sessionId, title, cost, buckets…, cacheHitRate, steps, priced, unpriced, models, firstTime, lastTime }`
     *   or null when the session has no usage at all.
     */
    async sessionTotals(request) {
      const sessionId = request?.sessionId;
      if (!isValidSessionId(sessionId)) return null;
      let fold;
      try {
        fold = await this.foldFor(sessionId);
      } catch {
        return null;
      }
      const result = costOfSession(fold.samples, this.rates);
      if (result === null) return null;
      return this.maskCost({ sessionId, title: fold.title, ...result });
    }

    /**
     * Cross-session summary for the header panel: one aggregate row per
     * session plus groupings by Beijing-calendar day and by model. Session
     * folds are signature-cached, so repeat calls only re-decode logs that
     * changed since the previous summary.
     *
     * @param request - `{}` or `{ workspace }` to restrict to one workspace.
     * @returns `{ generatedAt, currency, sessionCount, totals, sessions, byDay, byModel }`.
     */
    async summary(request) {
      const workspace = typeof request?.workspace === "string" ? request.workspace : undefined;
      let entries;
      try {
        entries = await listSessions(this.sessionsRoot);
      } catch {
        return null;
      }
      const rows = [];
      const daySamples = new Map();
      const modelSamples = new Map();
      const allSamples = [];
      for (const entry of entries) {
        if (workspace !== undefined && entry.workspace !== workspace) continue;
        let fold;
        try {
          fold = await this.foldEntry(entry);
        } catch {
          continue; // one unreadable session must not sink the whole summary
        }
        if (fold.samples.length === 0) continue;
        const aggregate = costOfSession(fold.samples, this.rates);
        rows.push(this.maskCost({ sessionId: entry.sessionId, workspace: entry.workspace, title: fold.title, ...aggregate }));
        allSamples.push(...fold.samples);
        for (const sample of fold.samples) {
          const day = beijingDay(sample.time);
          if (day !== null) {
            const bucket = daySamples.get(day) ?? [];
            bucket.push(sample);
            daySamples.set(day, bucket);
          }
          const model = typeof sample.model === "string" ? sample.model : "(unknown)";
          const byModelBucket = modelSamples.get(model) ?? [];
          byModelBucket.push(sample);
          modelSamples.set(model, byModelBucket);
        }
      }
      const totals = this.maskCost(costOfSession(allSamples, this.rates));
      const byDay = [...daySamples.entries()]
        .map(([day, samples]) => this.maskCost({ day, ...costOfSession(samples, this.rates) }))
        .sort((a, b) => (a.day < b.day ? 1 : -1));
      const byModel = [...modelSamples.entries()]
        .map(([model, samples]) => this.maskCost({ model, ...costOfSession(samples, this.rates) }))
        .sort((a, b) => (b.inputTokens + b.cacheReadTokens + b.outputTokens) - (a.inputTokens + a.cacheReadTokens + a.outputTokens));
      rows.sort((a, b) => (b.lastTime ?? 0) - (a.lastTime ?? 0));
      return {
        generatedAt: Date.now(),
        currency: this.rates.currency,
        showCost: this.display.showCost,
        sessionCount: rows.length,
        totals,
        sessions: rows,
        byDay,
        byModel,
      };
    }

    // ── quota (v2): subscription windows + per-session attribution ────────

    /**
     * Platform quota read for one configured route, TTL-cached (60s; errors
     * cached 10s so a flapping endpoint is not hammered). Never throws.
     */
    async quotaForRoute(routeId, routeCfg) {
      const cached = this.quotaCache.get(routeId);
      const now = Date.now();
      if (cached !== undefined && now - cached.at < cached.ttl) return cached.result;
      let result;
      try {
        if (routeCfg.kind === "kimi-usages") result = await this.fetchKimiQuota(routeCfg);
        else if (routeCfg.kind === "aliyun-bl") result = await this.fetchAliyunQuota(routeCfg);
        else result = { kind: routeCfg.kind, ok: false, error: "unknown-kind" };
      } catch (error) {
        result = { kind: routeCfg.kind, ok: false, error: String(error?.message ?? error) };
      }
      this.quotaCache.set(routeId, { at: now, ttl: result.ok ? 60_000 : 10_000, result });
      return result;
    }

    /**
     * Kimi subscription windows via the official coding API
     * (`GET {baseUrl}/usages`, Bearer = the route's subscription key; default
     * ref `KIMI_CODING_API_KEY` from the harness credential store). Verified
     * live 2026-08-24: weekly `usage` + 5h `limits[]` + booster wallet.
     */
    async fetchKimiQuota(routeCfg) {
      const refName = routeCfg.credentialRef ?? "KIMI_CODING_API_KEY";
      const key = resolveCredentialValue(this.credentialsFile, refName);
      if (key === undefined) return { kind: routeCfg.kind, ok: false, error: "credential-not-found" };
      const baseUrl = (routeCfg.baseUrl ?? "https://api.kimi.com/coding/v1").replace(/\/+$/, "");
      const payload = await fetchJson(`${baseUrl}/usages`, { headers: { Authorization: `Bearer ${key}` } });
      return { kind: routeCfg.kind, ok: true, ...normalizeKimiUsages(payload) };
    }

    /**
     * Aliyun Token Plan via the official Model Studio CLI
     * (`bl usage token-plan --output json`; 门二 v2 path B). The CLI owns the
     * console session — this plugin never touches cookies. Not installed /
     * not logged in / unrecognized output all degrade to ok:false.
     */
    async fetchAliyunQuota(routeCfg) {
      const command = routeCfg.command ?? "bl";
      let stdout;
      try {
        ({ stdout } = await execFileAsync(command, ["usage", "token-plan", "--output", "json"], {
          timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024, shell: true,
        }));
      } catch (error) {
        const notFound = error?.code === "ENOENT" || /不是内部或外部命令|is not recognized/i.test(String(error?.stderr ?? error?.message ?? ""));
        return { kind: routeCfg.kind, ok: false, error: notFound ? "bl-not-found" : `bl-failed: ${String(error?.message ?? error).slice(0, 120)}` };
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return { kind: routeCfg.kind, ok: false, error: "bl-output-not-json", raw: String(stdout).slice(0, 300) };
      }
      const normalized = normalizeAliyunBl(parsed);
      if (normalized === null) {
        return { kind: routeCfg.kind, ok: false, error: "bl-output-unrecognized", raw: String(stdout).slice(0, 300) };
      }
      return { kind: routeCfg.kind, ok: true, ...normalized };
    }

    /**
     * Subscription quota snapshot for the composer-dock readout and the
     * header panel (门二 v2): platform-side used/limit/remaining per
     * configured route plus — Kimi routes only — this session's local
     * request attribution inside each live window. Platform reads are
     * TTL-cached; a failing route never blocks the others or the UI.
     *
     * @param request - `{}` or `{ sessionId }` to attribute one session.
     * @returns `{ fetchedAt, showCost, session, routes }`.
     */
    async quota(request) {
      const sessionId = isValidSessionId(request?.sessionId) ? request.sessionId : undefined;
      let samples = [];
      if (sessionId !== undefined) {
        try {
          samples = (await this.foldFor(sessionId)).samples;
        } catch {
          samples = [];
        }
      }
      const sessionProviders = [...new Set(samples.map((sample) => sample.provider).filter((p) => typeof p === "string"))];
      const now = Date.now();
      const routes = {};
      for (const routeId of Object.keys(this.quotaRoutes)) {
        if (!Object.hasOwn(this.quotaRoutes, routeId)) continue;
        const result = await this.quotaForRoute(routeId, this.quotaRoutes[routeId]);
        const entry = { ...result };
        // Per-conversation share exists only where the quota unit is the
        // request (Kimi) and the session actually called this route.
        // Aliyun Token Plan measures dynamic Credits — 门二 v2: 不编造单对话占比.
        if (sessionId !== undefined && result.ok === true && result.kind === "kimi-usages" && sessionProviders.includes(routeId)) {
          const attribution = {};
          for (const window of result.windows ?? []) {
            const resetMs = typeof window.resetAt === "string" ? Date.parse(window.resetAt) : NaN;
            if (!Number.isFinite(resetMs) || typeof window.durationMs !== "number") continue;
            const requestsMade = requestsInWindow(samples, routeId, resetMs - window.durationMs, now);
            attribution[window.name] = {
              requests: requestsMade,
              share: window.limit > 0 ? requestsMade / window.limit : null,
            };
          }
          entry.attribution = attribution;
        }
        routes[routeId] = entry;
      }
      return {
        fetchedAt: now,
        showCost: this.display.showCost,
        session: sessionId === undefined ? null : { sessionId, providers: sessionProviders },
        routes,
      };
    }
  };
})();

export { TurnCostService, TurnCostService as default };
