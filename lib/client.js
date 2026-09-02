/**
 * dsh-turn-cost browser bundle.
 *
 * Two surfaces, both fed by provider-reported usage priced at the host's
 * effective rate table (built-in official DeepSeek CNY card, optionally
 * overlaid by the user's rates.json):
 *
 * 1. `conversation.chat.assistant-actions` — per-turn gray cost line under
 *    every closing assistant message (the original badge).
 * 2. `conversation.composer.dock` — whole-session readout beside the shipped
 *    stats line ("本会话 ¥X.XX · N token · 缓存读 N%").
 *
 * Subscription-route sessions (Kimi / Aliyun Token Plan) append the live
 * official window readout (Kimi: 7-day weekly remaining + booster wallet
 * balance in CNY; Qwen: 7-day quota remaining share).
 *
 * Failures render nothing — the plugin is informational and never blocks
 * the UI. Built by hand in the client module format (lazy CJS factory
 * registered through window.__ModuleLoader__) — no bundler step is needed.
 */
window.__ModuleLoader__.load({
	id: "dsh-turn-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		//#region lib/client/locales
		/** Dictionary namespace owned by this plugin. */
		const NS = "turnCost";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"badge.line": "本轮 {cost} · {tokens} token · 缓存读 {cache}",
			"badge.tokensOnly": "本轮 {tokens} token · 缓存读 {cache}",
			"badge.title": "本轮预计费用（人民币，本地费率表，不构成账单）；订阅路由按 0 价登记只显 token",
			"badge.quota": "本轮 {tokens} token · 7 天还剩 {remaining} 次 · 余额 ¥{balance}",
			"badge.quotaNoBooster": "本轮 {tokens} token · 7 天还剩 {remaining} 次",
			"badge.quotaTitle": "Kimi 订阅：7 天周额度剩余次数 + 加油包余额（人民币）来自本机 Kimi Code OAuth 服务；官方未提供可靠的单轮消耗归因，故不显示消耗百分比",
			"badge.qwen": "本轮 {tokens} token · 剩余 {remaining}",
			"badge.qwenTitle": "阿里 Token Plan：7 天限额剩余比例（官方读数）；单轮 Credits 无法精确归因，故不显示消耗百分比",
			"dock.line": "{models} · 本会话 {cost} · {tokens} token · 缓存读 {cache}",
			"dock.tokensOnly": "{models} · 本会话 {tokens} token · 缓存读 {cache}",
			"dock.title": "本会话累计（模型名读自对话日志，token 口径与官方统计条一致）；官方按量路由显示金额，订阅路由只显 token",
			"dock.quota": " · 7 天还剩 {remaining} 次 · 余额 ¥{balance}",
			"dock.quotaNoBooster": " · 7 天还剩 {remaining} 次",
			"dock.quotaTitle": "Kimi 订阅 7 天周额度：剩余次数与加油包余额来自本机 Kimi Code OAuth 服务，不把请求次数伪装成额度消耗",
		};
		/** English dictionary (same key set). */
		const en = {
			"badge.line": "Turn {cost} · {tokens} tokens · {cache} cached",
			"badge.tokensOnly": "Turn {tokens} tokens · {cache} cached",
			"badge.title": "Estimated turn cost (CNY, local rate table — not a bill); subscription routes are registered at 0 and only count tokens",
			"badge.quota": "Turn {tokens} tokens · 7d {remaining} left · ¥{balance} balance",
			"badge.quotaNoBooster": "Turn {tokens} tokens · 7d {remaining} left",
			"badge.quotaTitle": "Kimi subscription: 7-day weekly remaining count and booster wallet balance (CNY) come from the local Kimi Code OAuth service; no reliable per-turn attribution is available, so no consumption share is shown",
			"badge.qwen": "Turn {tokens} tokens · {remaining} left",
			"badge.qwenTitle": "Alibaba Token Plan: 7-day quota remaining share (official reading); per-turn Credits can't be attributed, so no consumption share is shown",
			"dock.line": "{models} · Session {cost} · {tokens} tokens · {cache} cached",
			"dock.tokensOnly": "{models} · Session {tokens} tokens · {cache} cached",
			"dock.title": "Whole-session totals (model names read from the conversation log; token accounting matches the shipped stats line); pay-as-you-go routes show money, subscription routes show tokens only",
			"dock.quota": " · 7d {remaining} left · ¥{balance} balance",
			"dock.quotaNoBooster": " · 7d {remaining} left",
			"dock.quotaTitle": "Kimi subscription 7-day weekly window: remaining count and booster balance come from the local Kimi Code OAuth service; request counts are not presented as quota consumption",
		};
		//#endregion

		//#region lib/client/styles
		const css = ".dsh-turn-cost-badge{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:20px;white-space:nowrap;font-variant-numeric:tabular-nums;margin:0 8px}"
			+ ".dsh-turn-cost-dock{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:20px;white-space:nowrap;font-variant-numeric:tabular-nums}";
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-turn-cost";
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion

		//#region lib/client/format
		/** CNY amount: two decimals, tiny amounts shown as <¥0.01. */
		function formatCost(cost) {
			if (!Number.isFinite(cost) || cost <= 0) return "¥0.00";
			if (cost < 0.005) return "<¥0.01";
			return `¥${cost.toFixed(2)}`;
		}
		/** Token count: 万 unit at 10k and above. */
		function formatTokens(tokens) {
			if (tokens >= 10000) {
				const wan = tokens / 10000;
				return `${wan >= 100 ? Math.round(wan) : Math.round(wan * 10) / 10}万`;
			}
			return String(Math.round(tokens));
		}
		/** Cache-hit ratio as a whole percent, or null when unknown. */
		function formatCacheHit(rate) {
			if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
			return `${Math.round(rate * 100)}%`;
		}
		/** Window share as a percent string ("<1%" for tiny nonzero shares). */
		function formatShare(share) {
			if (typeof share !== "number" || !Number.isFinite(share)) return "--";
			const pct = share * 100;
			if (pct > 0 && pct < 1) return "<1%";
			return `${Math.round(pct)}%`;
		}
		/** CNY figure from the quota endpoints (booster wallet etc.). */
		function formatCny(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "--";
			return value.toFixed(2);
		}
		//#endregion

		//#region lib/client/TurnCostBadge
		/**
		 * Find the turn number whose closing assistant message carries the
		 * given messageId, by scanning the conversation snapshot's chat nodes.
		 * @returns turn number or null.
		 */
		function turnForMessage(snapshot, messageId) {
			const nodes = snapshot?.chat?.nodes;
			if (nodes === undefined) return null;
			for (const node of nodes.values()) {
				if (node?.data?.closing?.finalNode?.messageId !== messageId) continue;
				const location = node.location;
				if (location !== undefined && (location.kind === "turn" || location.kind === "step")) {
					return location.turn.turn;
				}
				return null;
			}
			return null;
		}

		/** Per-(session, turn) RPC promise cache: the badge remounts often. */
		const rpcCache = new Map();

		/**
		 * The badge component: reads its turn through `useSession`, fetches the
		 * priced aggregate from the host, and renders one gray metadata line.
		 */
		function TurnCostBadge({ messageId, sessionId, useSession, t, queryCost, queryQuota }) {
			const turn = useSession((snapshot) => turnForMessage(snapshot, messageId));
			const [result, setResult] = react.useState(null);
			const [quota, setQuota] = react.useState(null);
			react.useEffect(() => {
				if (turn === null || sessionId === undefined) {
					setResult(null);
					setQuota(null);
					return;
				}
				const key = `${sessionId}\u0000${turn}`;
				let pending = rpcCache.get(key);
				if (pending === undefined) {
					// Failure (or a not-yet-ready null) is not cached, so a later
					// remount retries instead of pinning the badge invisible.
					pending = queryCost(sessionId, turn).then((value) => {
						if (value === null) rpcCache.delete(key);
						return value;
					}).catch(() => {
						rpcCache.delete(key);
						return null;
					});
					rpcCache.set(key, pending);
					if (rpcCache.size > 200) {
						const oldest = rpcCache.keys().next().value;
						if (oldest !== undefined) rpcCache.delete(oldest);
					}
				}
				let live = true;
				pending.then((value) => {
					if (live) setResult(value);
				});
				// Quota is session-level and host TTL-cached; needed only for the
				// subscription routes to append the window readout.
				queryQuota(sessionId).then((value) => {
					if (live && value !== null) setQuota(value);
				}).catch(() => { /* quota add-on — never hides the badge */ });
				return () => {
					live = false;
				};
			}, [turn, sessionId, queryCost, queryQuota]);
			if (result === null) return null;
			const tokens = formatTokens(result.inputTokens + result.cacheReadTokens + result.outputTokens);
			const cache = formatCacheHit(result.cacheHitRate) ?? "--";
			// Subscription routes read the quota windows; pay-as-you-go routes
			// (DeepSeek official) keep the money line.
			if (result.provider === "kimi-coding") {
				const route = quota?.routes?.["kimi-coding"];
				if (route?.ok === true) {
					const win7d = (route.windows ?? []).find((w) => w.name === "7d");
					const balance = route.booster?.balanceCny;
					if (win7d !== undefined) {
						const remaining = win7d.remaining;
						const title = t("badge.quotaTitle");
						if (typeof balance === "number" && Number.isFinite(balance)) {
							return react_jsx_runtime.jsx("span", {
								className: "dsh-turn-cost-badge",
								title,
								children: t("badge.quota", { tokens, remaining, balance: formatCny(balance) }),
							});
						}
						return react_jsx_runtime.jsx("span", {
							className: "dsh-turn-cost-badge",
							title,
							children: t("badge.quotaNoBooster", { tokens, remaining }),
						});
					}
				}
			}
			// Legacy sessions may carry the older provider id `qwen-token-plan`
			// (pre-rename); treat both as the same Token Plan route.
			if (result.provider === "qwen-token-plan-cn" || result.provider === "qwen-token-plan") {
				const route = quota?.routes?.["qwen-token-plan-cn"];
				if (route?.ok === true && typeof route.remainingPercent === "number") {
					return react_jsx_runtime.jsx("span", {
						className: "dsh-turn-cost-badge",
						title: t("badge.qwenTitle"),
						children: t("badge.qwen", { tokens, remaining: formatShare(route.remainingPercent) }),
					});
				}
			}
			const line = result.cost > 0
				? t("badge.line", { cost: formatCost(result.cost), tokens, cache })
				: t("badge.tokensOnly", { tokens, cache });
			return react_jsx_runtime.jsx("span", {
				className: "dsh-turn-cost-badge",
				title: t("badge.title"),
				children: line,
			});
		}
		//#endregion

		//#region lib/client/SessionDockLine
		/** Sum the four disjoint tokenUsage buckets (projection or host row). */
		function usageTotal(u) {
			if (u === null || typeof u !== "object") return 0;
			return (Number(u.uncachedInputTokens ?? u.inputTokens) || 0)
				+ (Number(u.cacheReadTokens) || 0)
				+ (Number(u.cacheWriteTokens) || 0)
				+ (Number(u.outputTokens) || 0);
		}
		/** Cache-hit share of prompt-side input, matching the shipped stats line. */
		function cacheRateOf(u) {
			if (u === null || typeof u !== "object") return null;
			const input = Number(u.uncachedInputTokens ?? u.inputTokens) || 0;
			const read = Number(u.cacheReadTokens) || 0;
			return input + read > 0 ? read / (input + read) : null;
		}

		/**
		 * Whole-session readout for the composer dock (the band the shipped
		 * stats line lives in): model names read from the conversation's own
		 * log (never the current harness preset), token counts from the host
		 * fold via `turnCost/sessionTotals`, and — for sessions on a Kimi
		 * subscription route — the 5-hour window share appended from
		 * `turnCost/quota`. Re-fetched when the live `tokenUsage` projection
		 * moves (debounced); pay-as-you-go money renders, subscription
		 * routes show tokens only; every failure degrades quietly.
		 */
		function SessionDockLine({ sessionId, useProjection, t, querySessionTotals, queryQuota }) {
			// useProjection is framework-provided for session-scope slots; the
			// guard only matters in a stripped-down assembly (absent forever,
			// never mid-life, so hook order stays constant).
			const usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
			const stamp = usageTotal(usage);
			const [result, setResult] = react.useState(null);
			const [quota, setQuota] = react.useState(null);
			const prevSession = react.useRef(undefined);
			react.useEffect(() => {
				if (sessionId === undefined) return;
				// A session switch must not show the previous session's figure
				// while the new fetch is in flight.
				if (prevSession.current !== sessionId) {
					prevSession.current = sessionId;
					setResult(null);
					setQuota(null);
				}
				let live = true;
				const timer = setTimeout(() => {
					querySessionTotals(sessionId).then((value) => {
						if (live && value !== null) setResult(value);
					}).catch(() => { /* informational only — keep the previous figure */ });
					queryQuota(sessionId).then((value) => {
						if (live && value !== null) setQuota(value);
					}).catch(() => { /* quota is an add-on — never blocks the line */ });
				}, 1200);
				return () => {
					live = false;
					clearTimeout(timer);
				};
			}, [sessionId, stamp, querySessionTotals, queryQuota]);
			const totals = result ?? (usage !== undefined && usage !== null ? {
				cost: null,
				inputTokens: usage.uncachedInputTokens ?? usage.inputTokens,
				outputTokens: usage.outputTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheWriteTokens,
				cacheHitRate: cacheRateOf(usage),
			} : null);
			if (totals === null) return null;
			const tokens = formatTokens(usageTotal({
				inputTokens: totals.inputTokens,
				cacheReadTokens: totals.cacheReadTokens,
				cacheWriteTokens: totals.cacheWriteTokens,
				outputTokens: totals.outputTokens,
			}));
			if (tokens === "0") return null;
			const cache = formatCacheHit(totals.cacheHitRate ?? cacheRateOf(totals)) ?? "--";
			const models = Array.isArray(totals.models) && totals.models.length > 0 ? totals.models.join("/") : "?";
			const line = typeof totals.cost === "number" && totals.cost > 0
				? t("dock.line", { models, cost: formatCost(totals.cost), tokens, cache })
				: t("dock.tokensOnly", { models, tokens, cache });
			// Kimi-route sessions get the live 7d window + booster balance
			// appended; the official account service does not expose reliable
			// per-session attribution.
			let quotaText = null;
			let quotaTitle = null;
			const sessionProviders = quota?.session?.providers ?? [];
			for (const routeId of sessionProviders) {
				const route = quota?.routes?.[routeId];
				if (route?.kind !== "kimi-usages" || route.ok !== true) continue;
				const window7d = (route.windows ?? []).find((w) => w.name === "7d");
				if (window7d === undefined) continue;
				const balance = route.booster?.balanceCny;
				quotaTitle = t("dock.quotaTitle");
				if (typeof balance === "number" && Number.isFinite(balance)) {
					quotaText = t("dock.quota", {
						remaining: window7d.remaining,
						balance: formatCny(balance),
					});
				} else {
					quotaText = t("dock.quotaNoBooster", { remaining: window7d.remaining });
				}
				break;
			}
			return react_jsx_runtime.jsxs("span", {
				className: "dsh-turn-cost-dock",
				children: [
					react_jsx_runtime.jsx("span", { title: t("dock.title"), children: line }),
					quotaText !== null
						? react_jsx_runtime.jsx("span", { title: quotaTitle, children: quotaText })
						: null,
				],
			});
		}
		//#endregion

		//#region plugin body
		/** Required services: the slot registry, the RPC carrier, and the locale service. */
		const inject = [
			"slots",
			"locale",
			"connection",
		];

		/**
		 * Client plugin body: register dictionaries and styles, then the two
		 * surfaces (assistant-actions badge, composer-dock session line).
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-turn-cost: dictionaries");
			ctx.effect(() => injectStyles(), "dsh-turn-cost: styles");
			// One RPC carrier for the two host endpoints. The gateway's SRC
			// descriptor exposes the single `request` parameter by its wire
			// name; the envelope is `{ args: { request } }` and the response
			// is `{ ok, value | error }`.
			const rpc = async (method, request) => {
				const result = await ctx.connection.rpc.call("/api", method, {
					args: { request },
				});
				if (result !== null && typeof result === "object" && result.ok === true) {
					return result.value;
				}
				return null;
			};
			const queryCost = (sessionId, turn) => rpc("turnCost/query", { sessionId, turn });
			const querySessionTotals = (sessionId) => rpc("turnCost/sessionTotals", { sessionId });
			const queryQuota = (sessionId) => rpc("turnCost/quota", typeof sessionId === "string" ? { sessionId } : {});
			ctx.slots.inject("conversation.chat.assistant-actions", () => {
				const dispose = ctx.slots.register({
					name: "conversation.chat.assistant-actions",
					id: "turn-cost",
					order: -100,
					locale: NS,
					inject: () => ({
						queryCost,
						queryQuota,
					}),
				}, TurnCostBadge);
				return dispose;
			});
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "turn-cost-dock",
					order: 100,
					locale: NS,
					inject: () => ({
						querySessionTotals,
						queryQuota,
					}),
				}, SessionDockLine);
				return dispose;
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
