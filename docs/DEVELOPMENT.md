# dsh-turn-cost 开发与维护指南

> 给接手维护这个项目的人（包括新开一个对话的 AI）看的完整地图：仓库结构、DSH 插件机制的关键坑、计费口径的不变式、发布流程。**改代码前先通读本文。**

## 一、仓库结构与职责

| 文件 | 职责 | 注意 |
|---|---|---|
| `lib/fold.js` | 纯计费核心：zstd 日志解帧、按 (轮,步) 折叠 usage、峰谷计价 | **零依赖**，可直接被 node 单测；所有金额口径都在这里 |
| `lib/index.js` | host 端服务：`TurnCostService`，Typert Remote 端点 `turnCost/query` | 顶部 `__esDecorate` 是手工转译的 stage-3 装饰器，**不要删** |
| `lib/client.js` | 浏览器 bundle：`assistant-actions` 槽位里的灰色金额行 | 手工写的 `window.__ModuleLoader__` CJS 格式，**不需要打包器** |
| `cordis.patch.yml` | bundle patch：往 profile 插入一行 `turn-cost` | 用户层可用同 id 覆盖（用户层后应用、同 id 行胜出） |
| `test/fold.test.mjs` | `fold.js` 的纯函数单测 | `node --test test/` 运行，无网络无依赖 |
| `package.json` | 双重身份：npm 包清单 + DSH bundle 清单（`dsh` 字段） | `files` 白名单只有 `lib` 和 `cordis.patch.yml`；docs/test 只进 GitHub 不进 npm（有意为之） |

## 二、DSH 插件机制（本插件踩过的关键点）

### 一个插件的三件套

1. **bundle patch**（`cordis.patch.yml`）：`- insert: - id: turn-cost / name: 'dsh-turn-cost'`，让 profile 加载这个包。
2. **host 服务**（`lib/index.js`，包的 main）：跑在 DSH 进程里，能读磁盘上的会话日志。
3. **client bundle**（`lib/client.js`，`dsh.client` 字段指向）：跑在浏览器里，渲染 UI。

`package.json` 里的 `dsh` 字段是清单：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-locale"]
  }
}
```

`client.inject` 列表决定 `apply(ctx)` 里能用哪些上下文服务（`connection` → `ctx.connection`，`locale` → `ctx.locale`）。

### host 端（lib/index.js）

- 服务类继承 `TypertRemoteService`，构造函数里 `super(ctx, "turnCost")` 定 RPC 命名空间；`static inject = ["sessions"]` 声明依赖的上下文服务。
- 方法用 `@Remote("query")` 装饰器暴露为端点 `turnCost/query`。DSH 走 SRC 发现，**不需要生成 typert 清单文件**。
- **装饰器是坑**：Node 24 不执行装饰器语法，而 typert 协议依赖装饰器留下的 metadata，所以必须保留装饰器写法并手工转译——`lib/index.js` 顶部那两段 `__esDecorate` / `__runInitializers` 就是转译产物。新增 `@Remote` 方法时，照抄 static 块里对 `__esDecorate` 的调用方式再加一行，不要改写成普通对象注册。
- 方法签名没有默认值时，网关按签名推导 wire 参数名：`async query(request)` → 客户端必须以 `request` 为参数名传（见下）。改参数名＝改 wire 协议，两边要同步。

### client 端（lib/client.js）

- 格式是手工的 `window.__ModuleLoader__.load({ id, factory })`，factory 是 lazy CJS 风格，最终 `exports.apply` / `exports.inject`。**不要改成 ESM**，不要引入打包器。
- `inject = ["slots", "locale", "connection"]` 对应 `ctx.slots` / `ctx.locale` / `ctx.connection`。
- 槽位用 `conversation.chat.assistant-actions`：**list 类**槽位，与反馈按钮等其它插件共存；每轮收尾消息渲染一次，owner 提供 `messageId`。轮号从会话快照反查：扫 `snapshot.chat.nodes`，找 `node.data.closing.finalNode.messageId === messageId` 的节点，取 `node.location.turn.turn`。
- **不要用** `conversation.chat.turnTail`：它是 chain 类槽位（先注册者独占），被 deliverables 插件占用。
- RPC 调用信封（关键）：

  ```js
  const result = await ctx.connection.rpc.call("/api", "turnCost/query", {
    args: { request: { sessionId, turn } },
  });
  // result 形如 { ok: true, value } 或 { ok: false, error }
  if (result?.ok === true) return result.value; // value 才是业务数据
  ```

- 多语言：`ctx.locale.register(NS, { zh, en })`，两个字典**键集合必须一致**，以 zh 为真源。新增文案两边都加。

### 计费核心不变式（lib/fold.js）

- 会话日志是 zstd 多帧 JSONL（`session.jsonl.zstd`），帧魔数 `28 B5 2F FD`（小端 `0xFD2FB528`），用 node 内置 `node:zlib` 的 `zstdDecompressSync` 解帧。
- **折叠规则**：按 `(turn, step)` 为键，后到的样本覆盖先到的（流式 chunk 的 usage 样本被该步最终的 `assistant/message` usage 取代）。**求和前必须先折叠**，否则同一步被重复计费。
- **峰谷价**：官方 CNY 卡（api-docs.deepseek.com/zh-cn/quick_start/pricing/，2026-08-17 起生效）内置于 `OFFICIAL_CNY`（元/百万 token）。工作日高峰 = 9:00–12:00、14:00–18:00 北京时间；2026-08-23 00:00 北京时间起，周六、周日全天为空闲价。`isPeak` 用 UTC 时间戳换算北京时间，不依赖宿主机时区；生效点前仍保留旧的每日峰谷规则。跨峰谷的一轮按**每步实际时间**分别计价。
- **未知模型**：`costOfStep` 返回 null，该步计入 `unpriced`、从金额里剔除——**绝不编造价格**，宁可不计价。
- **数据源**：持久日志在 `<dsh-home>/sessions/<workspace>/<sessionId>/session.jsonl.zstd`；host 把它与运行中会话的 live 事件合并（同 `(turn, step)` live 胜出），签名缓存（`size:mtime` + live 事件数）失效重算。

## 三、官方价表更新流程

DeepSeek 调价（官网定价页变化）时：

1. 改 `lib/fold.js` 的 `OFFICIAL_CNY`（窗口变了连 `isPeak` 与对应生效时间常量一起改，并保留历史规则）；
2. 同步 README「计费口径」里的生效日期与链接；
3. 写 CHANGELOG、bump 版本号；
4. 发布 npm（见下）；
5. 更新本机 profile 里的安装副本并重启 DSH web。

## 四、本地开发与验证

本机路径（机主环境）：

- 开发仓库：`D:\Workspaces\dsh-turn-cost`（origin 是 SSH：`git@github.com:WFMinerva/dsh-turn-cost.git`；本机直连 github.com 网页可能不通，**SSH 推送正常**）
- 安装副本：`C:\Users\Admin\.dsh\profiles\web\node_modules\dsh-turn-cost`（npm 装的；改完代码要发版后在此目录 `pnpm add dsh-turn-cost@最新版` 更新，或手工把 `lib/`、`package.json`、`cordis.patch.yml` 覆盖过去）
- 验证 UI：重启 DSH web，刷新 http://127.0.0.1:3080，看每条 AI 回复下方的灰色金额行

```bash
node --test              # 纯函数单测，秒级（默认 glob 自动匹配 test/*.test.mjs）
```

用真实日志抽查（node 一行脚本）：读某会话的 `session.jsonl.zstd` → `readSessionSamples("<sessions根目录>", "<sessionId>")` → `costOfTurn(samples, 轮号)`，核对 token 数与金额。

## 五、发布流程

1. `package.json` 里 bump `version`，CHANGELOG 记一笔；
2. `git add -A && git commit && git push`（SSH 通道）；
3. `npm publish`——npm 账号 `wfminerva` 开了 2FA，发布会触发交互式网页认证（"Authenticate your account at … Press ENTER"），**必须在机主能点网页的终端里跑**，AI 代办不了认证那一步；
4. 发布后更新本机安装副本（见上）并重启 DSH web。

## 六、设计决策记录（为什么这么做）

改任何一个决策前，先读对应的理由。

1. **为什么是独立插件，而不是在现有 token 计量插件上改？** 独立包可以零依赖共存、独立发版、互不干扰；改上游包要等合并、有维护耦合。共存已实测：`assistant-actions` 是 list 类槽位，与 deliverables 等插件的产物条互不冲突。
2. **为什么价格表内置、不联网拉官方定价？** 官方定价页没有面向机器的稳定接口；联网会破坏本插件「零网络零上报」的隐私承诺。官方调价时发版更新（流程见 §三），成本低。
3. **为什么金额是「估计值」而不是账单？** 计价原料是 provider 上报的 usage token 数；官方账单另有口径（活动折扣、账单级缓存策略等），本地日志无法复现。README 明示「不构成账单」。
4. **为什么 cacheWriteTokens 统计了却不计费？** 官方 CNY 价表只有「输入 / 缓存读 / 输出」三档单价，缓存写没有官方价；计入就等于编造价格，违反「不编造」原则。保留统计，等官方出价即可补上。
5. **为什么缓存命中率 = cacheRead ÷ (input + cacheRead)？** 衡量输入侧的缓存节省效果；分母不含 output（输出与缓存无关）。与 dsh 自带 token 计量的口径一致。
6. **为什么 0.2.0 之前没有设置界面？** 当时价格是官方口径，无可配置项，`static Config = z.object({})`。0.2.0 起 Config 接受 `ratesPath`（自定义费率表路径，见决策 11）；仍不做 GUI 设置页——费率表是低频改动的文本文件，用户层 `cordis.patch.yml` 同 id 覆盖即可（用户层后应用、同 id 行胜出）。
7. **为什么单测只测 fold.js？** 计费口径是正确性核心，fold.js 被刻意设计成零依赖纯函数，`node --test` 直接跑、无网络无安装；host/client 靠 UI 人工验证（见 §四）。
8. **为什么徽章失败渲染为空、不弹错？** 信息性组件，**永不阻塞 UI**（读日志失败、轮号反查失败都静默）。
9. **为什么客户端缓存 RPC promise 但失败不缓存？** 徽章重挂载频繁，成功结果按 (session,turn) 缓存（上限 200 条）；失败/未就绪不缓存，下次挂载自动重试，避免徽章被钉死成不可见。
10. **为什么历史 commit 的 author 是旧中文名却不改？** 公开仓库、已被社区 list 收录，改写历史会破坏 fork 与引用；新 commit 用新署名，新旧共存属正常现象。
11. **为什么费率表是"叠加"而不是"替换"？**（0.2.0）自定义 rates.json 经 `mergeRates(builtinRates(), custom)` 按模型名逐项覆盖内置官方卡：用户只写自己关心的模型，DeepSeek 官方价永远兜底；文件缺失/损坏回退内置卡并记 warn，插件不死。
12. **为什么订阅制模型在费率表里配 0 价而不是缺席？** 缺席 = `unpriced`（语义：未知价，绝不编造）；配 0 = 价格已知为 0（订阅口径）且计入 `priced`。两者在汇总里分开统计，避免"有价的 0"和"没价"混为一谈。
13. **为什么跨对话汇总走 host 端枚举日志，而不是 client 端 `useSessions` 投影？** 会话摘要行的 `projectionValues.tokenUsage` 只有四桶聚合值，**无时间戳、无模型名**；"按天/按模型"分组必须有 (time, model, buckets) 粒度的样本，只有扫日志拿得到。纯 client 路径被调研后否决（调研记录见 tool-library `docs/方案-DSH对话额度表.md`）。
14. **为什么汇总按会话粒度签名缓存，而不是整表一个签名？** 150+ 会话全量解压只有首次贵；`summaryCache` 以 `sessionId → size:mtime|live事件数` 为签名，重复打开汇总面板只重算变化过的会话。
15. **为什么会话级读数条挂 `conversation.composer.dock`？** 官方注释明确该 list 槽位就是统计条所在的环境读数带（"the shipped stats line lives here"），并列共存不替换；`conversation.chat.turnTail` 照旧禁用。
16. **为什么读数条的 token 口径可以直接对比官方统计条？** 官方 `tokenUsage` 投影的 `uncachedInputTokens` 就是 provider 上报的 `usage.inputTokens`（dsh-client-connection `tokenUsageOf` 实现），与 fold.js 的 `inputTokens` 桶同源；0.2.0 实测 5 个真实会话逐桶 MATCH。
17. **为什么「还剩多少」读平台端点、且不显示「本对话占比」？**（0.3.0 门二 v2 → 0.4.0 改口径）0.3.0 曾按请求数算「本会话占比」（本地日志里落在当前窗口的调用数 ÷ 窗口上限），但该占比是**估计值**（DSH 日志调用步数与平台计费请求数非严格 1:1，SDK 重试/缓存命中/续接重放的步可能不被计作新请求），且与官方 used 读数对不上（实测本地 62 次 vs 官方 53）。0.4.0 起**移除占比显示**，只显官方实时剩余次数/比例；剩余必须取平台实时值——同一池子还被 Kimi CLI/桌面端消耗，本地日志看不见它们。端点成功 60s TTL 缓存、失败 10s 防打爆。
18. **为什么阿里 Token Plan 不做单对话占比？** Credits 按模型分档动态抵扣（思考模式/工具调用影响），官方无公开系数表、明说「以控制台为准」，且实测 qwen 路由日志 usage 只有 token 四桶、无 Credits 字段——精确归因不可得，门二 v2 拍板不做（不编造），只显示窗口已用/剩余。
19. **为什么凭据从 `.credentials.yaml` 行解析，而不是 inject dsh-credentials 服务？** 该 seam 是 provider 抽象（`CredentialProvider.resolve`），没有暴露给第三方插件的公共解析服务；`.credentials.yaml` 是 dsh-home 内受管文件、host 插件本就有读权限；行解析器只认 `refs:` 块的 `NAME: value`（`^[A-Z][A-Z0-9_]*$`），值只在内存用于额度请求，永不打印落盘。
20. **为什么金额不设全局开关、而是按路由分流？**（0.3.0 门三修正）最初门二 v2 拍「金额默认隐藏可配置」，但机主实测发现这会把官方按量 DeepSeek 的金额也藏掉（那是 0.1.3 起就在的正确功能）。修正后：金额跟随「该轮 provider 是否按量计费」——官方按量路由 `cost>0` 即显示 ¥；订阅路由 0 价登记 → 只显 token + 额度读数。不要再引入会覆盖官方按量金额的全局开关。
21. **为什么 Kimi 额度取数有「官方 API / loopback OAuth」两条路？**（0.4.0）官方 coding API（`GET https://api.kimi.com/coding/v1/usages` + `.credentials.yaml` 的 `KIMI_CODING_API_KEY`）打开即用、无需本地服务，是默认路径；loopback OAuth（`~/.kimi-code/server.token` + `127.0.0.1:58627`）需要 Kimi Code 本地服务在跑，仅当费率表显式配了 loopback `baseUrl` 才走。baseUrl 白名单：https 任意，或 loopback http；裸 http 拒绝。

## 七、0.2.0 新增件的维护要点

- **新增 `@Remote` 端点**：照抄 `lib/index.js` static 块里 `sessionTotals`/`summary` 的 `__esDecorate` 调用（先声明 `_xxx_decorators` 变量再装饰），参数名 `request` 是 wire 协议的一部分。
- **费率表 schema**（`rates.json`，version 1）：`{ currency, models: { <model>: 平价{input,cacheRead,cacheWrite?,output} | 峰谷{peak,offPeak} }, aliases }`；schema 演进时 bump `RATES_VERSION`（fold.js）并写迁移说明。
- **`listSessions` 的目录约定**：`<dsh-home>/sessions/<workspace>/<sessionId>/session.jsonl.zstd`；目录不可读/文件缺失一律跳过，枚举永不抛。
- **单测里的临时目录**：Windows 上首次 `mkdtemp`+写删可能触发杀软扫描（首跑 ~36s，之后 <100ms），属环境噪声不是回归。
- **host 端改动需重启 dsh web 生效**（web profile 禁用 host 插件 HMR）；client bundle（client.js）覆盖到 profile 后由常驻 HMR 热更新（rev 变化触发，React 状态不保留）。
- **Config/schema 只能用 schemastery 语法**：`z` 是 `@deepseek-ai/schemastery` 不是 zod——对象字段缺省即可选，**没有 `.optional()`/`.nullable()`/`.parse()` 这些 zod 链式方法**；误用会在插件 import 阶段静态初始化器抛错，cordis 整树拒载、**dsh web 启动直接崩**（2026-08-24 实锤，见方案文档变更记录 #4）。改 Config 后必须真实启动一次 dsh web 验证——单测覆盖不到 host 侧。
- **quota 端点（0.3.0 起，0.4.0 双路径）**：`turnCost/quota` 平台读数 TTL 缓存（成功 60s / 失败 10s）；Kimi 路由按 baseUrl 分流——https（默认）走官方 `GET /usages`（`normalizeKimiUsages`：加油包 1e-8 CNY、月度 cents，已与 2026-08-22/08-25 快照交叉验证 ¥28.79/¥871.21/¥1000），loopback 走 `GET /api/v1/oauth/usage`（`normalizeKimiLocalUsage`）；`normalizeAliyunBl` 在 bl CLI 真实输出未实锤前接受多种键名拼写（total/TotalValue、remaining/TotalSurplusValue…），全不认得就降级 `bl-output-unrecognized` 并带 300 字符 raw 摘录。错误码：`kimi-credential-not-found`/`kimi-api-unavailable`/`kimi-server-token-not-found`/`kimi-server-unavailable`/`kimi-output-unrecognized`/`bl-not-found`/`bl-failed`/`bl-output-not-json`/`bl-output-unrecognized`。
