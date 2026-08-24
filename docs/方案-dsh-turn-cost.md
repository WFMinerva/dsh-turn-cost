# dsh-turn-cost 维护变更记录

## 变更记录 #1（2026-08-23）

### 状态

门一已确认；维护实施完成；K3 双层复检通过；门三已确认，正式交付（2026-08-23）。

### 需求

- 适配 DeepSeek 于 2026-08-23 生效的周末计费规则：周六、周日全天按空闲价。
- 保留新规生效前的历史计费口径，避免打开旧会话时发生追溯性改价。
- 不调整模型单价、usage 折叠、插件 UI、其它 provider 或发布方式。

### 基线

- 基线提交：`861f1ba`（`docs: 顶部加 awesome-dsh-plugin 收录徽章`）。
- 基线工作区：干净。
- 基线验证：`node --test`，8 项通过、0 项失败。
- 原行为：每天北京时间 9:00–12:00、14:00–18:00 均判为高峰，没有周末例外；实现依赖宿主机本地时区等于北京时间。

### 方案

- 新增周末新规的绝对生效时间常量：2026-08-23 00:00 北京时间。
- `isPeak(ms)` 显式把 UTC 时间戳换算为北京时间；生效时间起，星期六和星期日直接返回空闲，其余情况沿用原高峰窗口。
- 生效时间前不套用周末例外，保证历史会话重算结果不变。
- 增加工作日边界、历史周末、首个生效周日、后续完整周末与宿主时区无关性测试。

### 验收标准

1. 2026-08-22（周六）10:00 北京时间仍按旧规则判为高峰。
2. 2026-08-23（周日）10:00 以及其后周末任意时刻均按空闲价。
3. 新规后的周一至周五仍只在 9:00–12:00、14:00–18:00 判为高峰。
4. 判断结果不随宿主机时区变化。
5. 全部原有测试与新增测试通过，README、开发指南、CHANGELOG 和版本号同步。

### 回滚

回退本次单一维护提交即可恢复 0.1.1 行为；本次不改变日志或配置格式，无数据迁移与清理步骤。

### 验证与 K3 复检

- `git diff --check`：通过，仅有仓库既有的 Windows 换行提示。
- `node --test`：10 项通过、0 项失败；分别在 `Asia/Shanghai`、`America/Los_Angeles`、`UTC` 三种宿主时区复跑，结果均为 10/10。
- 计费边界：2026-08-22 周六 10:00 仍为高峰；2026-08-23 首个生效周日及后续完整周末全天空闲；工作日两个半开高峰区间不变。
- `npm pack --dry-run --cache .npm-cache`：成功，包版本 0.1.2，发布清单 7 个文件；临时缓存已清理。首次使用默认 npm 缓存因沙箱无权写入而报 `EPERM`，不属于代码或包结构失败。
- 驾驶舱 `python tools/checks.py --json`：C1–C6、C8 PASS，C7 WARN（工作区有本次及用户既有未提交文件），合计 0 FAIL。
- K3 独立模型第 1 轮：结论“需修改”，唯一问题是本节尚未补录实际验证结果；实现、边界、时区、版本与文档同步均审计通过，已按意见补齐。
- K3 独立模型第 2 轮：结论“通过”；确认上一轮唯一阻断项已完整修复，未发现新问题，未修改文件。

### 发布记录

- 2026-08-23：机主明确授权“推送 GitHub，发布 npm”。
- GitHub：维护提交 `dffd7e5` 已推送至 `origin/master`，远端 SHA 核验为 `dffd7e51677386f19e98952c8f2c45cffac3ed33`。
- npm：`dsh-turn-cost@0.1.2` 已发布为公共包；公开 registry 核验 `version=0.1.2`、`latest=0.1.2`。
- 临时 npm 缓存已清理；目标仓库工作区干净并与 `origin/master` 同步。
- 机主于 2026-08-23 明确回复“确认交付”，门三通过；推送与 npm 发布均已完成。

## 变更记录 #2（2026-08-24）

### 状态

门一已确认；维护实施完成；K3 双层复检通过（机器验 0 FAIL + 独立模型审「通过」）；待门三（推送/发布待机主指令）。

### 需求

- 补充 DeepSeek 新上线的 `deepseek-v4-flash-vision-exp` 视觉模型价目：官方确认其价格与 V4 Flash 完全一致。
- 修复该模型会话每轮金额显示 0.00（模型不在价目表 → 全部样本 unpriced → cost 恒 0）。
- 不改变既有 Pro / Flash 单价、峰谷时段、usage 折叠、UI 或发布方式。

### 方案

- `OFFICIAL_CNY` 新增 `deepseek-v4-flash-vision-exp` 条目，peak/offPeak 与 `deepseek-v4-flash` 逐字段一致（input 3.0/1.5、cacheRead 0.1/0.05、output 9.0/4.5）。
- 新增单测：断言该模型峰/谷输入单价分别为 3.0 / 1.5（钉住「会被计价」）。
- 版本 0.1.2 → 0.1.3（patch）；CHANGELOG、README 计费口径同步。

### 验证与 K3 复检

- `node --test`：11 项通过、0 项失败（含新增用例）。
- 真实会话复验：模型 `deepseek-v4-flash-vision-exp` 的每轮由 `priced=0/unpriced=N` 变为 `priced=N/unpriced=0`、金额非 0（turn1=¥0.078 … turn10=¥1.79）。
- K3 独立模型审：结论「通过」；非阻断提示 3 条——①测试仅覆盖 input 单价的峰/谷，未断言 cacheRead/output；②模型匹配为精确字符串、无别名归一化；③flash/vision 两份独立字面量存在日后调价漂移风险。

### 发布记录

- 2026-08-24 机主授权「推送 + npm 发布」。
- GitHub：`d7f3a28`(fix) + `5ee8de9`(docs 变更记录#2) + `cdd2c66`(docs 发布记录) 已推送 `origin/master`，远端 SHA `cdd2c66` 核验一致。
- npm：`dsh-turn-cost@0.1.3` 已发布为公共包；registry 核验 `version=0.1.3`、`latest=0.1.3`（2026-08-24 03:20:27Z）。
- 本机 profile 副本已同步至 0.1.3（`lib/fold.js` 含 `deepseek-v4-flash-vision-exp` 价目）；待重启 dsh web 生效。

## 变更记录 #3（2026-08-24）

### 状态

门一已确认（tool-library 立项「DSH 对话额度表」，门一/门二均机主拍板 2026-08-24；判级 A→C，实施以本变更记录为准，立项档案见 tool-library `docs/方案-DSH对话额度表.md`）；实施完成；K3 双层复检通过（机器验 0 FAIL + codex 独立模型审第 2 轮「通过」）；启动事故经变更记录 #4 修复后，端点级实测通过（见下「验证与 K3 复检」末节）；**门三未通过（2026-08-24 机主拍板：所得非所需，流程问题待复盘；0.2.0 停留本地提交未推送未发布，后续处置待重新对齐）**。

### 需求

- 在 dsh Web GUI 内嵌显示**每个对话**的 token 账（四桶）+ 按自定义费率折算的估算金额，并提供**跨对话汇总**视图（按天/按模型）。
- 费率表走自定义 JSON（数据与代码分离，所有模型可配单价）；订阅制模型（Kimi Allegro 窗口制、阿里云 Token Plan 限额制，机主拍板）出厂配 0 价只显 token，不编造。
- 不改 DSH 本体代码；不做"剩余额度"查询（订阅 API 不提供）；敏感信息（密钥/账号/金额）不入库。

### 基线

- 基线提交：`0aa54e2`（`docs: 发布记录终态——npm 0.1.3 已发布`）。
- 基线工作区：干净，与 origin/master 同步。
- 基线验证：`node --test` 11 项通过、0 项失败（Node v24.18.0）。
- 原行为：仅轮级金额徽章（assistant-actions），价表硬编码 `OFFICIAL_CNY`，`Config = z.object({})` 无配置。

### 方案

- `lib/fold.js`：费率表抽象（`builtinRates`/`mergeRates`/`resolveRateEntry`，平价与峰谷双档、别名一跳归一化、cacheWrite 可计价、**`provider/模型` 作用域键**——同一模型名经订阅池与官方按量路由分别定价，实施中发现的口径修正）；`costOfStep(sample, rates?)`/`costOfTurn(samples, turn, rates?)` 价表注入（**不传时与旧行为逐字节一致**）；新增 `costOfSession`、`beijingDay`、`listSessions`、`readSessionEntry`、`sessionTitleOf`；`readSessionSamples` 返回值增 `title` 字段（additive）。
- `lib/index.js`：`Config` 接受 `ratesPath`；构造时 `loadRates` 叠加（文件缺失/损坏回退内置卡 + warn 降级）；新增端点 `turnCost/sessionTotals`（整会话聚合）、`turnCost/summary`（枚举全部会话 + 按北京时间天/按模型分组，`summaryCache` 按会话粒度签名缓存）；新端点装饰器照抄既有手工转译块模式。
- `lib/client.js`：新增 `conversation.composer.dock` 会话级读数条（token 口径与官方统计条同源；金额 RPC 防抖 1.2s 跟随 tokenUsage 投影变化；读不到金额降级为只显 token）、`conversation.session.header.actions` 「额度汇总」按钮 + 浮层面板（合计/按模型/按近 14 天三张表；每次打开重取，host 侧签名缓存兜底）；locale zh/en 键集合一致；**零金额只显 token**（K3 复检期间自查补的口径修正：订阅制 0 价或未定价时，轮级徽章与会话读数都不显示误导性的 ¥0.00，改为 tokens-only 行，新增 locale 键 badge.tokensOnly）。
- `rates.example.json` 出厂示例；README/CHANGELOG/DEVELOPMENT.md 同步；版本 0.1.3 → 0.2.0（minor：新增能力，向后兼容）。

### 验收标准

1. `node --test` 全绿（基线 11 项原样通过 + 新增 11 项：平价四桶含 cacheWrite、别名、provider 作用域键、unpriced 不编造、mergeRates 叠加与畸形回退、costOfSession 聚合与时空跨度、beijingDay 界、sessionTitleOf、listSessions 枚举与降级、`__proto__` 原型名守卫、sessionId 路径校验）。
2. 真实日志抽查：枚举本机全部会话可折叠；抽 5 个会话的四桶总量与 DSH 官方 `tokenUsage` 投影缓存逐桶一致。
3. GUI 实测（需重启 dsh web）：①每条回复下方金额照显（回归不破）；②输入框下方出现会话级读数；③页头「额度汇总」面板数字与抽查一致；④订阅制模型会话只显 token 不显示金额。
4. 卸载/降版（`pnpm add dsh-turn-cost@0.1.3`）后 GUI 恢复原样，会话数据无损。

### 回滚

- 代码：回退本变更的提交即恢复 0.1.3 行为；不改日志/配置格式，无数据迁移。
- 部署：profile 目录 `pnpm add dsh-turn-cost@0.1.3` + 重启 dsh web。

### 验证与 K3 复检

- `node --test`：22 项通过、0 项失败（基线 11 项原样通过 + 新增 11 项，复跑稳定 ~100ms）。
- `node --check`：lib/index.js、lib/client.js、lib/fold.js 语法全过；client 端另有自建无头冒烟（stub react/ctx 执行 factory + apply + 三组件首渲染，断言 slot 名、locale 键集、投影回退渲染、零用量空渲染）。
- 真实日志抽查（只读 smoke，`%TEMP%\turn-cost-smoke.mjs`）：枚举到 150 个会话全部可折叠；抽 5 个会话（含 366 步的大会话）四桶总量与 `storages/session_projcache.json` 的官方 tokenUsage 投影**逐桶 MATCH 5/5**；按天分组输出正常。
- 踩坑：①Windows 临时目录首跑触发杀软扫描，listSessions 单测首跑 ~36s、复跑 <100ms（环境噪声）；②ESM import Windows 绝对路径必须 file:// URL；③tierCost 必须容忍样本缺桶字段（Number(x)||0），否则 NaN；④**client bundle 覆盖到 profile 后无需重启即热更新**（dsh-client-hmr 常驻 stat-poll，rev 变化即重载；实测 `GET /plugins/dsh-turn-cost/client.js` 立即返回新版）——但 host 端端点仍须重启 dsh web。
- 本机部署：profile 副本已同步 0.2.0（lib/package.json/cordis.patch.yml 手工覆盖）；机主费率表已落 `C:\Users\Admin\.dsh\turn-cost-rates.json`（Allegro 四模型 + Token Plan 十三模型全 0 价登记 + qwen 池 deepseek 作用域键）；profile `cordis.patch.yml` 同 id 覆盖 ratesPath。
- **K3 独立模型审第 1 轮（codex 0.146.0，只读沙箱）**：结论「需修改」——核心五项（fold 不变式、装饰器转译、RPC wire、client 约束、summary 聚合）静态核验全过；3 项实质 + 3 项建议，逐项修复如下：
  1. package.json `files` 白名单补 `rates.example.json`（出厂示例随 npm 分发）✅
  2. sessionId 路径校验：fold.js 新增 `isValidSessionId`（`^[A-Za-z0-9._-]+$`），`findSessionFile` 加 resolve 根前缀包含检查（纵深防御），query/sessionTotals 入口改用该校验 ✅（附单测）
  3. `resolveRateEntry` 全部改 `Object.hasOwn` 守卫，`__proto__`/`constructor`/`toString` 永不命中 ✅（附单测）
  4. SessionDockLine 会话切换时 `setResult(null)`（useRef 跟踪上一 sessionId），不再短暂显示上一会话数字 ✅
  5. `summaryCache` 键改为 `workspace/sessionId` ✅
  6. 文档测试计数订正（8→11）+ `resolveRateEntry` 注释按实际查找顺序（scoped → bare → scoped alias → bare alias）改写 ✅
- **K3 独立模型审第 2 轮（codex，只读沙箱静态核验）**：结论「**通过（6/6）**」——六项修复逐项核验正确落地，无新增回归。4 条非阻断观察：①`resolveRateEntry` 对 `null` 的防御（已改 `rates == null`）；②`findSessionFile` 盘根病理配置下前缀检查误杀（已修为 `resolvedRoot.endsWith(sep)` 自适应）；③summaryCache 行内注释过时（已改）；④client 投影回退的 `uncachedInputTokens ?? inputTokens` 兜底（已补）。四条均已顺手修复并回归（22/22、client 冒烟、真实日志 MATCH 复过）。
- **端点级实测（验收 3，2026-08-24，变更记录 #4 修复后的真实 dsh web 进程内）**：经 `/api/<endpoint>` HTTP 传输直调三端点（信封 `{args:{request}}`，与 client.js 的 `ctx.connection.rpc.call("/api", …)` 同源）——
  1. `turnCost/query`（轮级徽章回归）：多轮会话逐轮取值正确分化（session-11819f17：turn1 in=26320/out=4548 ≠ turn2 in=8623/out=3800）✅
  2. `turnCost/sessionTotals`（会话读数）：k3-256k 会话 6cdab90a（62 步）四桶与官方 `tokenUsage` 投影缓存**逐桶 MATCH 4/4**（101137/17273/2974208/0，node 程序化断言）✅
  3. `turnCost/summary`（跨对话汇总）：9 模型 × 7 天分组正常；官方价模型计价（deepseek-v4-pro 合计 ¥620.55；混合模型会话 session-675ee35c ¥0.2629，priced=37 unpriced=0）✅
  4. 订阅制口径：k3-256k/kimi-for-coding/qwen3.6-flash 会话 cost=0 且 priced 计入、unpriced=0 → client 渲染 tokens-only（数据面已证；像素面机主目检随门三一并确认）✅

### 发布记录

- 版本 0.2.0 已 bump；推送与 npm 发布待机主指令（npm 2FA 必须机主本人操作）。

## 变更记录 #4（2026-08-24，B 轻流程·改 bug）

### 事故

机主报告 DSH 打不开：`npx @deepseek-ai/dsh web` 启动即崩，错误链 `plugin tree failed to load → failed to import loader entry turn-cost (dsh-turn-cost): z.string(...).optional is not a function`，崩点 `lib/index.js:133` 的 `static Config = z.object({ ratesPath: z.string().optional() })`。

### 根因

`z` 来自 `@deepseek-ai/schemastery`（3.18.1），**不是 zod**：其 schema 对象没有 `.optional()` 方法（字段缺省即"可选"，反向语义是 `.required()`）。0.2.0 新增 Config 字段时误用 zod 写法，静态初始化器在插件 import 阶段抛 TypeError，cordis 加载器因此整树拒载——**单个插件的 Config 声明错误会拖崩整个 dsh web 启动**。

### 修复

- `lib/index.js:133`：`z.string().optional()` → `z.string()`（schemastery 对象字段缺省可选，已用真实 schemastery 3.18.1 实证：`{}` 通过、`{ratesPath:"x"}` 通过、错误类型拒绝），并加注释防止再犯。
- 全库排查 `.optional()/.nullable()/.parse()/.safeParse()` 等 zod 风格调用：仅此一处。
- 部署副本（`profiles/web/node_modules/dsh-turn-cost/lib/index.js`）与源码同步，diff 归零。

### 复检

- `node --test`：22/22 通过。
- 真实启动验证：`npx @deepseek-ai/dsh web` 跑通插件树加载，输出 `dsh web: http://127.0.0.1:3080` 正常监听（验证后已停掉，无机主进程残留）。

### 遗留观察（非阻断）

- 测试盲区：22 项测试只覆盖 fold.js 纯函数与 client 无头冒烟，**没有任何用例 import host 端 index.js**（仓库无 cordis/schemastery 依赖，单测环境装不出 host 侧）；本次事故正是该盲区漏出的。后续若加 host 侧冒烟，需以真实 schemastery 断言 Config 可实例化。
- DEVELOPMENT.md 踩坑清单建议补一条：「Config/schema 只能用 schemastery 语法，禁用 zod 的 `.optional()` 等链式方法」。

### 门禁

B 轻流程（改 bug），机主一句话对齐后修复+复检；本记录按 C 口径落盘。变更记录 #3 的验收 3 已于修复后完成端点级实测（见 #3「验证与 K3 复检」末节），像素面随门三由机主目检确认。

## 变更记录 #5（2026-08-24，0.3.0：订阅额度窗口——需求 v2）

### 背景

变更记录 #3 的交付在 tool-library 立项门三被机主**拍回**（「得到的东西不是我想要的」）。机主重述需求（v2 原话）：「是该对话是哪个模型，就显示这个模型，当前 harness 预设的不变，kimi 和 Qwen 咱们找到方式计算出此次对话使用了多少比例的额度，还剩多少」。调研与拍板记录全部在 tool-library `docs/方案-DSH对话额度表.md` §七/§八/§九（本仓库不重复建档）。

### 门二（v2）拍板（2026-08-24，五项全拍）

阿里取数走**官方 bl CLI**；阿里**不做**单对话占比（不编造 Credits）；DeepSeek 余额**不做**；金额**默认隐藏可配置**（`display.showCost`）；Kimi **读数行显 5h、汇总面板显全部**（5h/7 天/加油包）。

### 基线

- 基线提交：`8723e90`（docs: 变更记录#3 端点级实测落盘）；工作区干净；`node --test` 22/22。

### 方案

- `lib/fold.js`：`requestsInWindow(samples, provider, startMs, endMs)`（窗口内按 provider 计请求数，垃圾输入归 0 不抛）；`quotaConfigOf(parsed)`（费率表新增 `display`/`quota` 顶层块的解析与守卫：showCost 必须布尔、kind 白名单、credentialRef 语法、baseUrl 限 https、`__proto__`/`constructor`/`prototype` 键拒绝）。
- `lib/index.js`：`loadPluginFile` 取代 `loadRates`（费率 + display + quota 同文件）；`resolveCredentialValue`（`.credentials.yaml` 的 refs 块行解析，值只在内存）；`fetchKimiQuota`（`GET {baseUrl}/usages`，默认 `https://api.kimi.com/coding/v1` + ref `KIMI_CODING_API_KEY`，8s 超时）；`fetchAliyunQuota`（`bl usage token-plan --output json` 子进程，20s 超时，ENOENT/非 JSON/字段不认得三档降级）；`quotaForRoute` TTL 缓存（成功 60s/失败 10s）；新端点 `turnCost/quota`（装饰器块照旧照抄）；`maskCost`——`display.showCost` 为 false 时 query/sessionTotals/summary 的 cost 一律置 null（host 侧藏，任何 client 拿不到）；summary 响应增 `showCost` 字段。
- `lib/client.js`：读数条前缀**模型名**（读自对话日志）+ Kimi 路由会话追加「5h 窗口 本会话 N 次 ≈X% · 还剩 M」；汇总面板新增「订阅额度窗口」区（Kimi 窗口/加油包、阿里 Credits 行、bl 未装提示）；showCost=false 时表格隐藏金额列、合计行走 tokens-only 键；locale zh/en 键集合同步扩到 33 键。
- `rates.example.json`/README/CHANGELOG/DEVELOPMENT.md 同步；**README 隐私节改写**：0.3.0 起唯一网络出站是机主自配的官方额度端点（原「零网络」承诺随需求 v2 变更，敏感凭据仍永不落盘打印）。
- 版本 0.2.0 → 0.3.0（minor：新增能力 + 默认行为变化有配置开关）。

### 验证

- `node --test`：26/26（基线 22 原样通过 + 新增 4 项：窗口归因边界/垃圾输入、quota 配置解析、原型名守卫）。
- `node --check`：三个 lib 文件全过；client 无头冒烟 v2（stub react/ctx：三槽位、locale 键集合相等、投影回退渲染 1700 tokens、零用量空渲染、quota 文案键全存在）。
- 部署副本（profile）与源码 diff 归零；机主费率表已加 `display`/`quota` 块（kimi-usages + aliyun-bl）。
- Kimi usages 端点在调研阶段已实测 HTTP 200（周窗口 29/100、5h 36/100、加油包 ¥28.79，与 8-22 快照互洽）。
- **端点级实测（2026-08-24 机主重启后，真实 dsh web 进程内 `/api` 直调）**：
  1. `turnCost/quota`（kimi 会话 6cdab90a）：kimi-coding ok=true——7d 32/100 剩 68、5h 53/100 剩 47、加油包 ¥28.79、月度 ¥871.21/¥1000、parallel 30；attribution 7d/5h 各 requests=62 share=0.62 ✅
  2. `turnCost/sessionTotals`（混合模型会话）：`cost=null`、priced=41、unpriced=0（maskCost 生效，金额默认隐藏）✅
  3. `turnCost/summary`：`showCost=false`、`totals.cost=null`、146 会话 ✅
  4. `qwen-token-plan-cn` 路由：`bl-failed`（bl 未装，机主配合项待补；错误文案带 GBK 乱码，非阻断）✅ 降级路径符合设计
- **诚实观察（非阻断）**：本地归因 62 次 > 平台窗口 used=53。即「本会话占比」是**估计值**——DSH 日志调用步数与平台计费请求数非严格 1:1（SDK 重试/缓存命中/续接重放的步可能不被计作新请求）。UI 用「≈」标注，README 明示「仅 DSH 侧、近似」；后续可用单请求探针标定偏差。
- **K3 独立模型审第 1 轮（codex 0.146.0，只读沙箱）**：结论「需修改」3 项 + 3 条非阻塞：
  1. 轮级徽章在金额隐藏时整条消失（`cost !== number` 即 return）→ 改为仅 `result === null` 返回、`cost > 0` 分流，cost 为 null 走 tokens-only ✅（附冒烟 RPC 用例）
  2. `command` 无字符集校验 + `shell:true` 注入面 → `quotaConfigOf` 加白名单 `^[A-Za-z0-9_.:\\/ -]+$`（拒 shell 元字符），不合规只丢 command、路由保留 ✅（附 evil-cmd 单测）
  3. `requestsInWindow` 非迭代输入会抛 TypeError → 前置 `Array.isArray` 守卫 ✅（附 number/string/普通对象 三条单测）
  非阻塞：formatClock 跨天带日期（M-D HH:mm）、文档 42 键订正 33 键，均顺手落地。
- **K3 独立模型审第 2 轮（codex，只读沙箱静态核验）**：结论「**通过**」——三处修复正确落地、无新回归；两条非阻断观察（本 K3 段落留痕、command 白名单允许 `bl --flag` 单命令带参无注入面）。

### 回滚

- 代码：回退本提交恢复 0.2.0 行为；费率表的 display/quota 块在 0.2.0 下被忽略，无数据迁移。
- 部署：profile 目录降版 + 重启 dsh web。

### 门禁

门一（v1）/门二（v1）/门一重拍（v2）/门二（v2）均已拍板；待门三。机主配合项：①重启 dsh web（host 端 quota 端点生效）；②阿里侧 `npm i -g bailian-cli` 并完成控制台登录（不装则阿里区安静降级为「暂读不到」）。推送与 npm 发布待机主指令。

## 变更记录 #6（2026-08-24，0.3.0 门三修正：金额按路由分流）

### 事故

机主实测 0.3.0 后指出：**官方按量 DeepSeek 对话的金额不见了**（显示成「本轮 234万 token · 缓存读 100%」）。这是门二 v2「金额默认隐藏」拍板被我过度实现——`maskCost` 一刀切把**所有**路由的 cost 置 null，把 0.1.3 起就该有的官方按量金额也藏掉了。

### 机主重述的正确口径（2026-08-24）

- 官方按量（DeepSeek pro/flash）→ 显示金额（¥）——这是最开始的正确功能；
- kimi / Qwen 订阅对话 → 显示「本轮多少 token + 消耗会员额度百分之几 + 剩余百分之几」；
- 拍板细节：kimi 用 5h 窗口；Qwen 只显 token + 剩余%（Credits 精确归因不可得，不编造消耗%）。

### 修复

- 撤除 `maskCost` 与 `display.showCost`（`quotaConfigOf` 只留 `quota` 块；三端点不再置 null，恢复 0.2.0 金额语义）。
- `turnCost/query` 返回值增 `provider` 与 `requests`（该轮实际路由 + 调用数）。
- client 每轮徽章按 `result.provider` 分流：`kimi-coding` → 「本轮 token · 5h 额度消耗 X% · 剩余 Y%」；`qwen-token-plan-cn` → 「本轮 token · 剩余 Y%」；其余（官方按量）→ `cost>0` 显金额、否则 tokens-only。
- locale 增 `badge.quota`/`badge.qwen` 及 title；汇总面板金额列恢复常显（订阅模型行仍 `—`）；README/CHANGELOG/DEVELOPMENT 同步，决策 #20 改写为「金额按路由分流，勿再设全局开关」。

### 验证

- `node --test` 26/26；`node --check` 三 lib 全过；client 无头冒烟过。
- 端点级实测待机主再次重启 dsh web（host 端 `query` 返回 provider/requests + 金额恢复）。

### 门禁

机主对金额/额度口径已逐项拍板（本节「机主重述」）；实施后待机主重启 + GUI 目检收尾门三。推送与 npm 发布仍待机主指令。
