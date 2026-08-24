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
			"badge.title": "本轮预计费用（人民币，本地费率表，不构成账单）；订阅路由按 0 价登记只显 token",
			"badge.quota": "本轮 {tokens} token · 5h 已用 {used} · 剩余 {remaining}",
			"badge.quotaTitle": "Kimi 订阅：5 小时窗口已用/剩余为官方 Kimi Code 本地 OAuth 服务实时读数；官方未提供可靠的单轮消耗归因",
			"badge.qwen": "本轮 {tokens} token · 剩余 {remaining}",
			"badge.qwenTitle": "阿里 Token Plan：7 天限额剩余比例（官方读数）；单轮 Credits 无法精确归因，故不显示消耗百分比",
			"dock.line": "{models} · 本会话 {cost} · {tokens} token · 缓存读 {cache}",
			"dock.tokensOnly": "{models} · 本会话 {tokens} token · 缓存读 {cache}",
			"dock.title": "本会话累计（模型名读自对话日志，token 口径与官方统计条一致）；官方按量路由显示金额，订阅路由只显 token",
			"dock.quota": " · 5h 已用 {used} · 剩余 {remaining}",
			"dock.quotaTitle": "Kimi 订阅 5 小时窗口：官方 Kimi Code 本地 OAuth 服务实时读数，不把请求次数伪装成额度消耗",
			"summary.button": "额度汇总",
			"summary.title": "对话额度汇总",
			"summary.loading": "汇总中……",
			"summary.empty": "暂无会话用量",
			"summary.error": "汇总读取失败，可关闭后重试（不影响会话）",
			"summary.total": "共 {count} 个会话 · {tokens} token · 约 {cost}",
			"summary.totalTokens": "共 {count} 个会话 · {tokens} token",
			"summary.byModel": "按模型",
			"summary.byDay": "按天（近 {days} 天）",
			"summary.col.model": "模型",
			"summary.col.day": "日期",
			"summary.col.tokens": "token",
			"summary.col.cost": "估算金额",
			"summary.col.sessions": "会话数",
			"summary.note": "token 口径：provider 上报 usage；金额口径：×本地费率表（默认隐藏），不构成账单；订阅制模型按 0 价登记，只计 token。",
			"summary.close": "关闭",
			"quota.section": "订阅额度窗口",
			"quota.route.kimi-coding": "Kimi 订阅（Allegro）",
			"quota.route.qwen-token-plan-cn": "阿里 Token Plan",
			"quota.window.line": "{name}：已用 {usedPct} · 剩余 {remainingPct} · {resetAt} 重置",
			"quota.booster": "加油包：余额 ¥{balance} · 本月已用 ¥{used} / 上限 ¥{limit}",
			"quota.aliyun.line": "7 天限额：已用 {usedPct} · 剩余 {remainingPct}",
			"quota.aliyun.expire": "最近到期：{expireAt}",
			"quota.unavailable": "暂读不到（{error}）",
			"quota.blHint": "阿里侧需安装并登录百炼官方 CLI：npm i -g bailian-cli 后按提示完成控制台登录",
		};
		/** English dictionary (same key set). */
		const en = {
			"badge.line": "Turn {cost} · {tokens} tokens · {cache} cached",
			"badge.tokensOnly": "Turn {tokens} tokens · {cache} cached",
			"badge.title": "Estimated turn cost (CNY, local rate table — not a bill); subscription routes are registered at 0 and only count tokens",
			"badge.quota": "Turn {tokens} tokens · 5h used {used} · {remaining} left",
			"badge.quotaTitle": "Kimi subscription: live 5-hour used/remaining reading from the official local OAuth service; the official API does not provide reliable per-turn attribution",
			"badge.qwen": "Turn {tokens} tokens · {remaining} left",
			"badge.qwenTitle": "Alibaba Token Plan: 7-day quota remaining share (official reading); per-turn Credits can't be attributed, so no consumption share is shown",
			"dock.line": "{models} · Session {cost} · {tokens} tokens · {cache} cached",
			"dock.tokensOnly": "{models} · Session {tokens} tokens · {cache} cached",
			"dock.title": "Whole-session totals (model names read from the conversation log; token accounting matches the shipped stats line); pay-as-you-go routes show money, subscription routes show tokens only",
			"dock.quota": " · 5h used {used} · {remaining} left",
			"dock.quotaTitle": "Kimi subscription 5-hour window: live official local OAuth reading; request counts are not presented as quota consumption",
			"summary.button": "Usage summary",
			"summary.title": "Session usage summary",
			"summary.loading": "Summarizing…",
			"summary.empty": "No session usage yet",
			"summary.error": "Summary failed to load — close and retry (sessions unaffected)",
			"summary.total": "{count} sessions · {tokens} tokens · ≈{cost}",
			"summary.totalTokens": "{count} sessions · {tokens} tokens",
			"summary.byModel": "By model",
			"summary.byDay": "By day (last {days} days)",
			"summary.col.model": "Model",
			"summary.col.day": "Day",
			"summary.col.tokens": "Tokens",
			"summary.col.cost": "Est. cost",
			"summary.col.sessions": "Sessions",
			"summary.note": "Tokens: provider-reported usage. Money: × local rate table (hidden by default), never a bill. Subscription models are registered at 0 and only count tokens.",
			"summary.close": "Close",
			"quota.section": "Subscription quota windows",
			"quota.route.kimi-coding": "Kimi subscription (Allegro)",
			"quota.route.qwen-token-plan-cn": "Alibaba Token Plan",
			"quota.window.line": "{name}: used {usedPct} · {remainingPct} left · resets {resetAt}",
			"quota.booster": "Booster wallet: ¥{balance} left · this month ¥{used} / ¥{limit}",
			"quota.aliyun.line": "7-day quota: used {usedPct} · {remainingPct} left",
			"quota.aliyun.expire": "Nearest expiry: {expireAt}",
			"quota.unavailable": "Unavailable ({error})",
			"quota.blHint": "Alibaba side needs the official Model Studio CLI: npm i -g bailian-cli, then complete console login",
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
		/** Window share as a percent string ("<1%" for tiny nonzero shares). */
		function formatShare(share) {
			if (typeof share !== "number" || !Number.isFinite(share)) return "--";
			const pct = share * 100;
			if (pct > 0 && pct < 1) return "<1%";
			return `${Math.round(pct)}%`;
		}
		/** ISO timestamp → local "HH:mm";跨天时带日期（7 天窗口重置常在数日后）。 */
		function formatClock(iso) {
			const ms = Date.parse(iso);
			if (!Number.isFinite(ms)) return "--";
			const d = new Date(ms);
			const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
			const today = new Date();
			if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) return hm;
			return `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
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
				const win5h = route?.ok === true ? (route.windows ?? []).find((w) => w.name === "5h") : undefined;
				if (win5h !== undefined) {
					const used = win5h.limit > 0 ? win5h.used / win5h.limit : null;
					const remaining = win5h.limit > 0 ? win5h.remaining / win5h.limit : null;
					return react_jsx_runtime.jsx("span", {
						className: "dsh-turn-cost-badge",
						title: t("badge.quotaTitle"),
						children: t("badge.quota", { tokens, used: formatShare(used), remaining: formatShare(remaining) }),
					});
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
			// Kimi-route sessions get the live 5h window appended; the official
			// account service does not expose reliable per-session attribution.
			let quotaText = null;
			const sessionProviders = quota?.session?.providers ?? [];
			for (const routeId of sessionProviders) {
				const route = quota?.routes?.[routeId];
				if (route?.kind !== "kimi-usages" || route.ok !== true) continue;
				const window5h = (route.windows ?? []).find((w) => w.name === "5h");
				if (window5h === undefined) continue;
				quotaText = t("dock.quota", {
					used: formatShare(window5h.limit > 0 ? window5h.used / window5h.limit : null),
					remaining: formatShare(window5h.limit > 0 ? window5h.remaining / window5h.limit : null),
				});
				break;
			}
			return react_jsx_runtime.jsxs("span", {
				className: "dsh-turn-cost-dock",
				children: [
					react_jsx_runtime.jsx("span", { title: t("dock.title"), children: line }),
					quotaText !== null
						? react_jsx_runtime.jsx("span", { title: t("dock.quotaTitle"), children: quotaText })
						: null,
				],
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
						children: jsxs("tr", {
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

		/** Quota-panel route label: known ids get a translated name, others stay raw. */
		function routeLabel(id, t) {
			if (id === "kimi-coding" || id === "qwen-token-plan-cn") return t(`quota.route.${id}`);
			return id;
		}

		/**
		 * The subscription-quota section of the summary panel (门二 v2: 面板
		 * 显全部窗口). One block per configured route; failing routes show a
		 * quiet note, never throw.
		 */
		function QuotaSection({ quota, t }) {
			const jsx = react_jsx_runtime.jsx;
			const jsxs = react_jsx_runtime.jsxs;
			const routes = quota?.routes;
			if (routes === null || routes === undefined || Object.keys(routes).length === 0) return null;
			const blocks = [];
			for (const routeId of Object.keys(routes)) {
				const route = routes[routeId];
				const lines = [];
				if (route?.ok === true && route.kind === "kimi-usages") {
					for (const w of route.windows ?? []) {
						lines.push(jsx("div", {
							children: t("quota.window.line", {
								name: w.name,
								usedPct: formatShare(w.limit > 0 ? w.used / w.limit : null),
								remainingPct: formatShare(w.limit > 0 ? w.remaining / w.limit : null),
								resetAt: formatClock(w.resetAt),
							}),
						}, w.name));
					}
					if (route.booster !== undefined && route.booster !== null) {
						lines.push(jsx("div", {
							children: t("quota.booster", {
								balance: formatCny(route.booster.balanceCny),
								used: formatCny(route.booster.monthlyUsedCny),
								limit: formatCny(route.booster.monthlyLimitCny),
							}),
						}, "booster"));
					}
				} else if (route?.ok === true && route.kind === "aliyun-bl") {
					lines.push(jsx("div", {
						children: t("quota.aliyun.line", {
							usedPct: formatShare(route.usedPercent),
							remainingPct: formatShare(route.remainingPercent),
						}),
					}, "aliyun"));
					if (typeof route.expireAt === "string") {
						lines.push(jsx("div", { children: t("quota.aliyun.expire", { expireAt: formatClock(route.expireAt) }) }, "expire"));
					}
				} else {
					lines.push(jsx("div", {
						children: t("quota.unavailable", { error: String(route?.error ?? "unknown") }),
					}, "error"));
					if (route?.error === "bl-not-found") {
						lines.push(jsx("div", { children: t("quota.blHint") }, "hint"));
					}
				}
				blocks.push(jsxs("div", {
					children: [jsx("strong", { children: routeLabel(routeId, t) }), ...lines],
				}, routeId));
			}
			return jsxs(react.Fragment, {
				children: [jsx("h4", { children: t("quota.section") }), ...blocks],
			});
		}

		/**
		 * The header button + overlay panel. The panel fetches
		 * `turnCost/summary` each time it opens (host folds are
		 * signature-cached, so repeat opens are cheap) and renders totals,
		 * by-model and by-day tables. Every failure path shows a quiet note
		 * instead of throwing.
		 */
		function SummaryButton({ t, querySummary, queryQuota }) {
			const jsx = react_jsx_runtime.jsx;
			const jsxs = react_jsx_runtime.jsxs;
			const [open, setOpen] = react.useState(false);
			const [state, setState] = react.useState({ kind: "idle" });
			const [quota, setQuota] = react.useState(null);
			react.useEffect(() => {
				if (!open) return undefined;
				let live = true;
				setState({ kind: "loading" });
				setQuota(null);
				querySummary().then((value) => {
					if (!live) return;
					setState(value === null ? { kind: "error" } : { kind: "ready", value });
				}).catch(() => {
					if (live) setState({ kind: "error" });
				});
				// Quota is an add-on section: its failure never fails the panel.
				queryQuota(undefined).then((value) => {
					if (live && value !== null) setQuota(value);
				}).catch(() => { /* quiet */ });
				return () => {
					live = false;
				};
			}, [open, querySummary, queryQuota]);

			const panelBody = () => {
				if (state.kind === "loading" || state.kind === "idle") {
					return jsx("p", { children: t("summary.loading") });
				}
				if (state.kind === "error") {
					return jsx("p", { children: t("summary.error") });
				}
				const value = state.value;
				if (!value || value.sessionCount === 0 || value.totals === null) {
					return jsxs(react.Fragment, {
						children: [
							jsx("p", { children: t("summary.empty") }),
							jsx(QuotaSection, { quota, t }),
						],
					});
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
						jsx(QuotaSection, { quota, t }),
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
			ctx.slots.inject("conversation.session.header.actions", () => {
				const dispose = ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "turn-cost-summary",
					order: 100,
					locale: NS,
					inject: () => ({
						querySummary,
						queryQuota,
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
