/**
 * dsh-turn-cost browser bundle.
 *
 * Three surfaces, all fed by provider-reported usage priced at the host's
 * effective rate table (built-in official DeepSeek CNY card, optionally
 * overlaid by the user's rates.json):
 *
 * 1. `conversation.chat.assistant-actions` — per-turn gray cost line under
 *    every closing assistant message (the original badge).
 * 2. `conversation.composer.dock` — whole-session readout beside the shipped
 *    stats line ("本会话 ¥X.XX · N token · 缓存读 N%").
 * 3. `conversation.session.header.actions` — a "额度汇总" button opening the
 *    cross-session summary panel (totals, by model, by day).
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
			"badge.title": "本轮预计费用（人民币，官方峰谷价）；订阅制模型按 0 价登记，只显 token",
			"dock.line": "本会话 {cost} · {tokens} token · 缓存读 {cache}",
			"dock.tokensOnly": "本会话 {tokens} token · 缓存读 {cache}",
			"dock.title": "本会话累计估算（按本地费率表，不构成账单）；token 口径与官方统计条一致",
			"summary.button": "额度汇总",
			"summary.title": "对话额度汇总（估算）",
			"summary.loading": "汇总中……",
			"summary.empty": "暂无会话用量",
			"summary.error": "汇总读取失败，可关闭后重试（不影响会话）",
			"summary.total": "共 {count} 个会话 · {tokens} token · 约 {cost}",
			"summary.byModel": "按模型",
			"summary.byDay": "按天（近 {days} 天）",
			"summary.col.model": "模型",
			"summary.col.day": "日期",
			"summary.col.tokens": "token",
			"summary.col.cost": "估算金额",
			"summary.col.sessions": "会话数",
			"summary.note": "估算口径：provider 上报 usage × 本地费率表，不构成账单；订阅制模型按 0 价登记，只计 token。",
			"summary.close": "关闭",
		};
		/** English dictionary (same key set). */
		const en = {
			"badge.line": "Turn {cost} · {tokens} tokens · {cache} cached",
			"badge.tokensOnly": "Turn {tokens} tokens · {cache} cached",
			"badge.title": "Estimated turn cost (CNY, official peak/off-peak rates); subscription models are registered at 0 and only count tokens",
			"dock.line": "Session {cost} · {tokens} tokens · {cache} cached",
			"dock.tokensOnly": "Session {tokens} tokens · {cache} cached",
			"dock.title": "Whole-session estimate (local rate table; not a bill) — token accounting matches the shipped stats line",
			"summary.button": "Usage summary",
			"summary.title": "Session usage summary (estimate)",
			"summary.loading": "Summarizing…",
			"summary.empty": "No session usage yet",
			"summary.error": "Summary failed to load — close and retry (sessions unaffected)",
			"summary.total": "{count} sessions · {tokens} tokens · ≈{cost}",
			"summary.byModel": "By model",
			"summary.byDay": "By day (last {days} days)",
			"summary.col.model": "Model",
			"summary.col.day": "Day",
			"summary.col.tokens": "Tokens",
			"summary.col.cost": "Est. cost",
			"summary.col.sessions": "Sessions",
			"summary.note": "Estimate: provider-reported usage × local rate table — not a bill. Subscription models are registered at 0 and only count tokens.",
			"summary.close": "Close",
		};
		//#endregion

		//#region lib/client/styles
		const css = ".dsh-turn-cost-badge{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:20px;white-space:nowrap;font-variant-numeric:tabular-nums;margin:0 8px}"
			+ ".dsh-turn-cost-dock{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:20px;white-space:nowrap;font-variant-numeric:tabular-nums}"
			+ ".dsh-turn-cost-summary-btn{font-size:12px;padding:2px 8px;border:1px solid var(--dsw-alias-border-default,#444);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa4b0);cursor:pointer}"
			+ ".dsh-turn-cost-summary-btn:hover{color:var(--dsw-alias-label-primary,#e6edf3)}"
			+ ".dsh-turn-cost-panel-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center}"
			+ ".dsh-turn-cost-panel{background:var(--dsw-alias-surface-primary,#1c2128);color:var(--dsw-alias-label-primary,#e6edf3);border:1px solid var(--dsw-alias-border-default,#444);border-radius:10px;padding:16px 20px;max-width:720px;width:90vw;max-height:80vh;overflow:auto;font-size:13px;font-variant-numeric:tabular-nums}"
			+ ".dsh-turn-cost-panel h3{margin:0 0 8px;font-size:15px}"
			+ ".dsh-turn-cost-panel h4{margin:14px 0 6px;font-size:13px;color:var(--dsw-alias-label-secondary,#9aa4b0)}"
			+ ".dsh-turn-cost-panel table{width:100%;border-collapse:collapse}"
			+ ".dsh-turn-cost-panel th,.dsh-turn-cost-panel td{text-align:right;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-muted,#2d333b);white-space:nowrap}"
			+ ".dsh-turn-cost-panel th:first-child,.dsh-turn-cost-panel td:first-child{text-align:left}"
			+ ".dsh-turn-cost-panel .dsh-turn-cost-note{margin-top:12px;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:1.6}"
			+ ".dsh-turn-cost-panel .dsh-turn-cost-close{margin-top:10px}";
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
			// Zero-cost turn (subscription route registered at 0, or nothing
			// priced): show tokens only, never a misleading ¥0.00.
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
		 * stats line lives in). Token counts come from the host fold via
		 * `turnCost/sessionTotals` — re-fetched when the live `tokenUsage`
		 * projection moves (debounced); when money is unavailable the line
		 * degrades to tokens only, and when nothing is available it renders
		 * nothing.
		 */
		function SessionDockLine({ sessionId, useProjection, t, querySessionTotals }) {
			// useProjection is framework-provided for session-scope slots; the
			// guard only matters in a stripped-down assembly (absent forever,
			// never mid-life, so hook order stays constant).
			const usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
			const stamp = usageTotal(usage);
			const [result, setResult] = react.useState(null);
			const prevSession = react.useRef(undefined);
			react.useEffect(() => {
				if (sessionId === undefined) return;
				// A session switch must not show the previous session's figure
				// while the new fetch is in flight.
				if (prevSession.current !== sessionId) {
					prevSession.current = sessionId;
					setResult(null);
				}
				let live = true;
				const timer = setTimeout(() => {
					querySessionTotals(sessionId).then((value) => {
						if (live && value !== null) setResult(value);
					}).catch(() => { /* informational only — keep the previous figure */ });
				}, 1200);
				return () => {
					live = false;
					clearTimeout(timer);
				};
			}, [sessionId, stamp, querySessionTotals]);
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
			const line = typeof totals.cost === "number" && totals.cost > 0
				? t("dock.line", { cost: formatCost(totals.cost), tokens, cache })
				: t("dock.tokensOnly", { tokens, cache });
			return react_jsx_runtime.jsx("span", {
				className: "dsh-turn-cost-dock",
				title: t("dock.title"),
				children: line,
			});
		}
		//#endregion

		//#region lib/client/SummaryPanel
		const SUMMARY_DAYS = 14;

		/** One aggregate table (by-model or by-day rows share the shape). */
		function SummaryTable({ head, rows, t }) {
			const jsx = react_jsx_runtime.jsx;
			const jsxs = react_jsx_runtime.jsxs;
			return jsxs("table", {
				children: [
					jsx("thead", {
						children: jsx("tr", {
							children: [
								jsx("th", { children: head }),
								jsx("th", { children: t("summary.col.tokens") }),
								jsx("th", { children: t("summary.col.cost") }),
							],
						}),
					}),
					jsx("tbody", {
						children: rows.map((row) => jsxs("tr", {
							children: [
								jsx("td", { children: row.label }),
								jsx("td", { children: formatTokens(row.tokens) }),
								jsx("td", { children: row.priced > 0 ? formatCost(row.cost) : "—" }),
							],
						}, row.label)),
					}),
				],
			});
		}

		/**
		 * The header button + overlay panel. The panel fetches
		 * `turnCost/summary` each time it opens (host folds are
		 * signature-cached, so repeat opens are cheap) and renders totals,
		 * by-model and by-day tables. Every failure path shows a quiet note
		 * instead of throwing.
		 */
		function SummaryButton({ t, querySummary }) {
			const jsx = react_jsx_runtime.jsx;
			const jsxs = react_jsx_runtime.jsxs;
			const [open, setOpen] = react.useState(false);
			const [state, setState] = react.useState({ kind: "idle" });
			react.useEffect(() => {
				if (!open) return undefined;
				let live = true;
				setState({ kind: "loading" });
				querySummary().then((value) => {
					if (!live) return;
					setState(value === null ? { kind: "error" } : { kind: "ready", value });
				}).catch(() => {
					if (live) setState({ kind: "error" });
				});
				return () => {
					live = false;
				};
			}, [open, querySummary]);

			const panelBody = () => {
				if (state.kind === "loading" || state.kind === "idle") {
					return jsx("p", { children: t("summary.loading") });
				}
				if (state.kind === "error") {
					return jsx("p", { children: t("summary.error") });
				}
				const value = state.value;
				if (!value || value.sessionCount === 0 || value.totals === null) {
					return jsx("p", { children: t("summary.empty") });
				}
				const modelRows = (value.byModel ?? []).map((row) => ({
					label: row.model,
					tokens: row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens,
					cost: row.cost,
					priced: row.priced,
				}));
				const dayRows = (value.byDay ?? []).slice(0, SUMMARY_DAYS).map((row) => ({
					label: row.day,
					tokens: row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens + row.outputTokens,
					cost: row.cost,
					priced: row.priced,
				}));
				return jsxs(react.Fragment, {
					children: [
						jsx("p", {
							children: t("summary.total", {
								count: value.sessionCount,
								tokens: formatTokens(value.totals.inputTokens + value.totals.cacheReadTokens + value.totals.cacheWriteTokens + value.totals.outputTokens),
								cost: formatCost(value.totals.cost),
							}),
						}),
						jsx("h4", { children: t("summary.byModel") }),
						jsx(SummaryTable, { head: t("summary.col.model"), rows: modelRows, t }),
						jsx("h4", { children: t("summary.byDay", { days: SUMMARY_DAYS }) }),
						jsx(SummaryTable, { head: t("summary.col.day"), rows: dayRows, t }),
						jsx("p", { className: "dsh-turn-cost-note", children: t("summary.note") }),
					],
				});
			};

			return jsxs(react.Fragment, {
				children: [
					jsx("button", {
						type: "button",
						className: "dsh-turn-cost-summary-btn",
						onClick: () => setOpen(true),
						children: t("summary.button"),
					}),
					open
						? jsx("div", {
							className: "dsh-turn-cost-panel-backdrop",
							onClick: (event) => {
								if (event.target === event.currentTarget) setOpen(false);
							},
							children: jsxs("div", {
								className: "dsh-turn-cost-panel",
								children: [
									jsx("h3", { children: t("summary.title") }),
									panelBody(),
									jsx("button", {
										type: "button",
										className: "dsh-turn-cost-summary-btn dsh-turn-cost-close",
										onClick: () => setOpen(false),
										children: t("summary.close"),
									}),
								],
							}),
						})
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
		 * Client plugin body: register dictionaries and styles, then the three
		 * surfaces (assistant-actions badge, composer-dock session line,
		 * header summary button).
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-turn-cost: dictionaries");
			ctx.effect(() => injectStyles(), "dsh-turn-cost: styles");
			// One RPC carrier for all three endpoints. The gateway's SRC
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
			const querySummary = () => rpc("turnCost/summary", {});
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
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "turn-cost-dock",
					order: 100,
					locale: NS,
					inject: () => ({
						querySessionTotals,
					}),
				}, SessionDockLine);
				return dispose;
			});
			ctx.slots.inject("conversation.session.header.actions", () => {
				const dispose = ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "turn-cost-summary",
					order: 100,
					locale: NS,
					inject: () => ({
						querySummary,
					}),
				}, SummaryButton);
				return dispose;
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
