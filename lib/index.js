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
import { Service } from "@deepseek-ai/cordis";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { beijingDay, builtinRates, costOfSession, costOfTurn, findSessionFile, foldEvents, isValidSessionId, listSessions, mergeRates, readSessionEntry, readSessionSamples } from "./fold.js";

/**
 * Effective rate table: built-in card overlaid with the user's rates file.
 * An unreadable/malformed file degrades to the built-in card (with a log
 * line) — the plugin keeps working with official rates rather than dying.
 */
function loadRates(ratesPath, warn) {
  const base = builtinRates();
  if (typeof ratesPath !== "string" || ratesPath.length === 0) return base;
  try {
    return mergeRates(base, JSON.parse(readFileSync(ratesPath, "utf8")));
  } catch (error) {
    warn?.(`rates file unreadable (${String(error?.message ?? error)}); built-in CNY card only`);
    return base;
  }
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
    /** `sessionId -> { signature, samples, title }` cache; invalidated when the log changes. */
    cache = new Map();
    /** `workspace/sessionId -> { signature, fold }` cache for the cross-session summary. */
    summaryCache = new Map();

    /**
     * @param ctx - host context.
     * @param config - validated plugin configuration.
     */
    constructor(ctx, config = {}) {
      super(ctx, "turnCost");
      __runInitializers(this, _instanceExtraInitializers);
      this.sessionsRoot = dshHomePath("sessions");
      this.rates = loadRates(config?.ratesPath, (line) => {
        try { ctx.logger?.("dsh-turn-cost")?.warn?.(line); } catch { /* logging is best-effort */ }
      });
      // Drop the cached folds when the plugin is reconfigured/reloaded.
      ctx.effect(() => () => {
        this.cache = new Map();
        this.summaryCache = new Map();
      }, "dsh-turn-cost: reset cache on unload");
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
      return { sessionId, turn, ...result };
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
      return { sessionId, title: fold.title, ...result };
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
        rows.push({ sessionId: entry.sessionId, workspace: entry.workspace, title: fold.title, ...aggregate });
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
      const totals = costOfSession(allSamples, this.rates);
      const byDay = [...daySamples.entries()]
        .map(([day, samples]) => ({ day, ...costOfSession(samples, this.rates) }))
        .sort((a, b) => (a.day < b.day ? 1 : -1));
      const byModel = [...modelSamples.entries()]
        .map(([model, samples]) => ({ model, ...costOfSession(samples, this.rates) }))
        .sort((a, b) => (b.inputTokens + b.cacheReadTokens + b.outputTokens) - (a.inputTokens + a.cacheReadTokens + a.outputTokens));
      rows.sort((a, b) => (b.lastTime ?? 0) - (a.lastTime ?? 0));
      return {
        generatedAt: Date.now(),
        currency: this.rates.currency,
        sessionCount: rows.length,
        totals,
        sessions: rows,
        byDay,
        byModel,
      };
    }
  };
})();

export { TurnCostService, TurnCostService as default };
