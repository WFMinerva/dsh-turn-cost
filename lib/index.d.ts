/**
 * Type declarations for the dsh-turn-cost host half.
 *
 * The implementation is plain JavaScript (`lib/index.js`), so these declarations
 * are maintained by hand rather than generated. They cover the public surface a
 * host consumes: the Cordis plugin entry (class form), its injected services,
 * and the Typert Remote methods the Web client calls through `ctx.remote`.
 */
import type { Context } from "@deepseek-ai/cordis";
import type Schema from "@deepseek-ai/schemastery";

/** One step's provider-reported usage, priced at the rate in force at `time`. */
export interface TurnCostBuckets {
  /** Input tokens billed at the uncached input rate. */
  inputTokens: number;
  /** Output/completion tokens. */
  outputTokens: number;
  /** Prompt tokens served from the provider's cache. */
  cacheReadTokens: number;
  /** Prompt tokens written to the provider's cache (reported, not billed). */
  cacheWriteTokens: number;
}

/** Aggregate for one turn or one whole session. */
export interface TurnCostAggregate extends TurnCostBuckets {
  /** Estimated cost in the rate table's currency. Never a bill. */
  cost: number;
  /** Cache-read share of prompt-side input, or null when there was no input. */
  cacheHitRate: number | null;
  /** Number of priced steps considered. */
  steps: number;
  /** Steps that had a rate entry. */
  priced: number;
  /** Steps excluded from `cost` because no rate entry matched. */
  unpriced: number;
  /** Model names observed across the steps. */
  models: string[];
  /** Earliest step timestamp, when recorded. */
  firstTime?: number;
  /** Latest step timestamp, when recorded. */
  lastTime?: number;
}

/** Result of `turnCost/query`. */
export interface TurnCostQueryResult extends TurnCostAggregate {
  sessionId: string;
  turn: number;
  /** Provider route that served the turn, when the log recorded one. */
  provider?: string;
  /** Provider requests the turn folded into. */
  requests: number;
}

/** Result of `turnCost/sessionTotals`. */
export interface TurnCostSessionTotals extends TurnCostAggregate {
  sessionId: string;
  /** Durable session title, when the log recorded one. */
  title?: string;
}

/** Stable failure codes the quota endpoint reports instead of throwing. */
export type QuotaErrorCode =
  | "kimi-server-token-not-found"
  | "kimi-server-unavailable"
  | "kimi-output-unrecognized"
  | "bl-not-found"
  | "bl-failed"
  | "bl-output-not-json"
  | "bl-output-unrecognized";

/** One subscription route's live reading. */
export interface QuotaRouteResult {
  kind: string;
  ok: boolean;
  error?: string | QuotaErrorCode;
  windows?: Array<{ name: string; remaining?: number; [key: string]: unknown }>;
  booster?: { balanceCny?: number; [key: string]: unknown };
  remainingPercent?: number;
  [key: string]: unknown;
}

/** Result of `turnCost/quota`. */
export interface QuotaSnapshot {
  fetchedAt: number;
  session: { sessionId: string; providers: string[] } | null;
  routes: Record<string, QuotaRouteResult>;
}

/** Validated plugin configuration (`ratesPath` is optional). */
export interface TurnCostConfig {
  /** Absolute path to a custom rate-table JSON overlaid on the built-in card. */
  ratesPath?: string;
}

/**
 * The `turnCost` host service.
 *
 * Registered as `ctx.turnCost`; the Remote gateway discovers `turnCost/query`,
 * `turnCost/sessionTotals` and `turnCost/quota` through the Typert SRC binding,
 * so no generated descriptor is needed.
 */
export declare class TurnCostService {
  static readonly inject: readonly string[];
  static readonly Config: Schema<TurnCostConfig>;

  constructor(ctx: Context, config?: TurnCostConfig);

  /**
   * Estimated cost of one turn, or null when the turn has no usage.
   *
   * Address the turn either by number (`turn`) or by the id of an assistant
   * message inside it (`messageId`), which the host resolves against the
   * session's own log.
   */
  query(request: { sessionId: string; turn?: number; messageId?: string }): Promise<TurnCostQueryResult | null>;
  /** Whole-session aggregate, or null when the session has no usage. */
  sessionTotals(request: { sessionId: string }): Promise<TurnCostSessionTotals | null>;
  /** Live subscription-window reading per configured route. */
  quota(request?: { sessionId?: string }): Promise<QuotaSnapshot>;
}

export default TurnCostService;
