/**
 * dsh-turn-cost browser bundle.
 *
 * Registers one entry in the `conversation.chat.assistant-actions` strip (the
 * icon-action row under the closing assistant message of every turn): a small
 * gray line like "本轮 ¥0.23 · 1.2万 token · 缓存读 98%".
 *
 * The turn number is recovered by scanning the conversation snapshot for the
 * node whose closing message id matches the owner-provided `messageId`; the
 * host `turnCost/query` endpoint then prices that turn from provider-reported
 * usage at the official DeepSeek CNY peak/off-peak rates. Failures render
 * nothing — the badge is informational and never blocks the UI.
 *
 * Built by hand in the client module format (lazy CJS factory registered
 * through window.__ModuleLoader__) — no bundler step is needed.
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
			"badge.title": "本轮预计费用（人民币，官方峰谷价）",
		};
		/** English dictionary (same key set). */
		const en = {
			"badge.line": "Turn {cost} · {tokens} tokens · {cache} cached",
			"badge.title": "Estimated turn cost (CNY, official peak/off-peak rates)",
		};
		//#endregion

		//#region lib/client/styles
		const css = ".dsh-turn-cost-badge{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:20px;white-space:nowrap;font-variant-numeric:tabular-nums;margin:0 8px}";
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
		function TurnCostBadge({ messageId, sessionId, useSession, t, queryCost }) {
			const turn = useSession((snapshot) => turnForMessage(snapshot, messageId));
			const [result, setResult] = react.useState(null);
			react.useEffect(() => {
				if (turn === null || sessionId === undefined) {
					setResult(null);
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
				return () => {
					live = false;
				};
			}, [turn, sessionId, queryCost]);
			if (result === null || typeof result?.cost !== "number") return null;
			const tokens = formatTokens(result.inputTokens + result.cacheReadTokens + result.outputTokens);
			const cache = formatCacheHit(result.cacheHitRate) ?? "--";
			const line = t("badge.line", { cost: formatCost(result.cost), tokens, cache });
			return react_jsx_runtime.jsx("span", {
				className: "dsh-turn-cost-badge",
				title: t("badge.title"),
				children: line,
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
		 * Client plugin body: register dictionaries and styles, then the
		 * assistant-actions entry (leftmost in the strip, before the feedback
		 * buttons).
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-turn-cost: dictionaries");
			ctx.effect(() => injectStyles(), "dsh-turn-cost: styles");
			const queryCost = async (sessionId, turn) => {
				// The gateway's SRC descriptor exposes the single `request`
				// parameter by its wire name; the envelope is `{ args: { request } }`
				// and the response is `{ ok, value | error }` (same carrier the
				// generated Remote namespaces use).
				const result = await ctx.connection.rpc.call("/api", "turnCost/query", {
					args: { request: { sessionId, turn } },
				});
				if (result !== null && typeof result === "object" && result.ok === true) {
					return result.value;
				}
				return null;
			};
			ctx.slots.inject("conversation.chat.assistant-actions", () => {
				const dispose = ctx.slots.register({
					name: "conversation.chat.assistant-actions",
					id: "turn-cost",
					order: -100,
					locale: NS,
					inject: () => ({
						queryCost,
					}),
				}, TurnCostBadge);
				return dispose;
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
