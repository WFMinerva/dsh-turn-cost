/**
 * dsh-turn-cost host plugin.
 *
 * A Typert Remote service (`turnCost`) that answers one question: how much
 * (in CNY, official DeepSeek peak/off-peak rates) did one turn of one session
 * cost, from provider-reported usage in the durable session logs merged with
 * the live in-memory session events. The web GUI reaches it through the
 * standard `/api` Remote gateway (SRC discovery — no generated typert
 * manifest), and renders the answer in the per-message action strip.
 */
import { Service } from "@deepseek-ai/cordis";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { costOfTurn, findSessionFile, foldEvents, readSessionSamples } from "./fold.js";

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
      if (_metadata) Object.defineProperty(this, Symbol.metadata, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: _metadata
      });
    }

    /** Required services: the live-session registry (durable logs are scanned directly). */
    static inject = ["sessions"];

    /** No deployment configuration: rates are the official CNY card, built in. */
    static Config = z.object({});

    sessionsRoot;
    /** `sessionId -> { signature, samples }` cache; invalidated when the log changes. */
    cache = new Map();

    /**
     * @param ctx - host context.
     * @param config - validated plugin configuration.
     */
    constructor(ctx, config = {}) {
      super(ctx, "turnCost");
      __runInitializers(this, _instanceExtraInitializers);
      this.sessionsRoot = dshHomePath("sessions");
      // Drop the cached folds when the plugin is reconfigured/reloaded.
      ctx.effect(() => () => {
        this.cache = new Map();
      }, "dsh-turn-cost: reset cache on unload");
    }

    /** Latest fold of one session: durable log merged with the live events. */
    async foldFor(sessionId) {
      const live = this.ctx.sessions.list().find((session) => session.id === sessionId);
      const liveEvents = live?.events ?? [];
      const found = await findSessionFile(this.sessionsRoot, sessionId);
      const signature = `${found === undefined ? "missing" : `${found.size}:${found.mtimeMs}`}|live:${liveEvents.length}`;
      const cached = this.cache.get(sessionId);
      if (cached !== undefined && cached.signature === signature) return cached.samples;

      const durable = found === undefined
        ? { samples: [] }
        : await readSessionSamples(this.sessionsRoot, sessionId);      // Merge durable + live: a later live sample for the same (turn, step)
      // replaces the durable one, so the merge is idempotent.
      const merged = new Map();
      for (const sample of durable.samples) merged.set(`${sample.turn}:${sample.step}`, sample);
      for (const sample of foldEvents(liveEvents)) merged.set(`${sample.turn}:${sample.step}`, sample);
      const samples = [...merged.values()];
      this.cache.set(sessionId, { signature, samples });
      return samples;
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
      if (typeof sessionId !== "string" || sessionId.length === 0 || typeof turn !== "number") return null;
      let samples;
      try {
        samples = await this.foldFor(sessionId);
      } catch {
        return null;
      }
      const result = costOfTurn(samples, turn);
      if (result === null) return null;
      return { sessionId, turn, ...result };
    }
  };
})();

export { TurnCostService, TurnCostService as default };
