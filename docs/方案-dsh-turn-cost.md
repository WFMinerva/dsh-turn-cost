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
- **端点级实测（2026-08-24 机主第二次重启后，真实 dsh web 进程内 `/api` 直调）**：
  1. `turnCost/query` DeepSeek turn：provider=deepseek-official, cost=¥0.2629, requests=13 ✅ 金额恢复
  2. `turnCost/query` Kimi turn：provider=kimi-coding, cost=0, requests=62 ✅ 徽章走 quota 分支
  3. `turnCost/query` Qwen turn：provider=qwen-token-plan（旧 id）, cost=0, requests=1 ✅ 兼容旧 id
  4. `turnCost/sessionTotals` 混合会话：cost=¥0.2629 ✅ 金额恢复
  5. `turnCost/quota`：Kimi 5h 53/100 remaining=47；**Qwen ok=True usedPct=15.5% remainingPct=84.5% expire=2026-08-31** ✅ bl CLI 登录成功，阿里路由首次端到端打通

### 门禁

机主对金额/额度口径已逐项拍板（本节「机主重述」）；端点级实测三条路由全通；待机主 GUI 目检收尾门三。推送与 npm 发布仍待机主指令。

## 变更记录 #7（2026-08-25，B 轻流程·改 bug：0.4.0 一键安装包 Install.ps1 启动即崩）

### 事故

机主运行 `dsh-turn-cost-setup-0.4.0-win-x64.zip`（解压后双击 `安装.cmd`）报错：

```
Install.ps1 : Exception calling "GetFullPath" with "1" argument(s): "Illegal characters in path."
FullyQualifiedErrorId : ArgumentException,Install.ps1
```

### 根因（双层）

1. **cmd `\"` 转义**：`安装.cmd` 传 `-PackageRoot "%~dp0"`，`%~dp0` 以反斜杠结尾 → 展开为 `"...win-x64\"`，Windows CRT 参数解析把结尾 `\"` 当转义引号，PowerShell 实际收到 `C:\...\win-x64"`（含字面引号、反斜杠丢失）。`"` 是非法路径字符 → `[IO.Path]::GetFullPath` 抛 ArgumentException。已用探针脚本逐字节证实。
2. **PS 5.1 默认参数坑**：去掉 `-PackageRoot` 后仍崩（错误变为 `The path is not of a legal form.`）——`[CmdletBinding()]` 脚本以 `-File` 方式启动时，param 默认值 `$PackageRoot = $PSScriptRoot` 求值为空（探针 5 证实：有 CmdletBinding 则空、无则正常）。空字符串同样让 GetFullPath 抛异常。

### 修复

- `安装.cmd`：`-PackageRoot "%~dp0"` → `-PackageRoot "%~dp0."`（以 `.` 结尾，不再触发 `\"` 转义；GetFullPath 规范化后等价）。
- `Install.ps1`：param 块后加兜底 `if ([string]::IsNullOrWhiteSpace($PackageRoot)) { $PackageRoot = $PSScriptRoot }`，防直接调用再踩 PS 5.1 默认参数坑。
- `content-sha256.json`：同步更新 `安装.cmd` 与 `Install.ps1` 两项哈希。
- 已重新打包 `dsh-turn-cost-setup-0.4.0-win-x64-fixed.zip`（桌面，16 条目结构与原包一致）。

### 复检

- 原错误稳定复现（修改前必现 GetFullPath 异常）。
- 修复后实跑 `安装.cmd`：GetFullPath 全过，正确推进到预期守卫 `DSH_RUNNING: 3080 正在监听，请先退出 DSH 再安装`（当时 DSH 正运行，属预期拦截而非报错）。
- 新 zip 解压后 15/15 文件 SHA-256 与 content-sha256.json 全一致。
- 完整安装链路（插件安装/备份/回滚）未实跑——需机主退出 DSH 后双击安装验证；安装器其余 4 个 .cmd 传参不以反斜杠结尾，未受影响。

### 遗留观察（非阻断）

- 一键包生成源（`installer/Install.ps1`、`scripts/build-windows-installer.ps1`）尚未入库到 dsh-turn-cost 或 tool-library 的任何已提交路径（TL-135 登记的嵌套仓库 `work/dsh-turn-cost` 当前不存在）；本次修复直接落在桌面产物上。建议把生成源与 `.cmd` 模板入库，否则下次打包仍会重踩 cmd `\"` 转义与 PS 5.1 默认参数两个坑。

### 门禁

B 轻流程（改 bug）：门一已对齐范围；改动仅 3 个产物文件 + 1 份文档；未触发风险阈值（不设门二）；待机主在退出 DSH 后实装验证收尾。推送与发布待机主指令。

## 变更记录 #8（2026-08-25，B 轻流程·改 bug：Kimi 额度显示口径——不再 ÷limit 算百分比，直接显官方余额次数）

### 事故

机主反馈：Kimi 订阅额度显示"算错了"。codex 复核口径：官方 usages 端点给的是**次数**（5h used=53 / remaining=47，上限 100 次），而 client 渲染把 `remaining ÷ limit` 换算成百分比（47%）显示——"除 100 是不对的，应该显示余额"。

### 根因

- 0.4.0 部署副本 `lib/client.js` 三处渲染（徽章 badge、会话行 dock、汇总面板 quota.window.line）都做了 `w.remaining / w.limit` 的百分比换算；
- 但 `lib/quota.js` 的 `normalizeKimiLocalUsage` 已返回原始次数（`used`/`remaining` 字段），host 端没有错——错在 client 渲染层多除了一次上限；
- 且旧版（0.3.0）徽章还用过本地请求数 `requests / limit`（62/100=62%）当消耗占比，与官方 used=53 不一致，属同一"用本地数除上限伪装成官方消耗"的错误口径（已在 0.4.0 移除本地请求数，但残留了 ÷limit 转百分比）。

### 修复

- `lib/client.js`：
  - 徽章 `badge.quota`：`本轮 {tokens} token · 5h 还剩 {remaining} 次`（remaining 直接用官方次数，不再 ÷limit）；
  - 会话行 `dock.quota`：` · 5h 还剩 {remaining} 次`；
  - 汇总面板 `quota.window.line`：`已用 {used}/{limit} 次 · 还剩 {remaining} 次 · {resetAt} 重置`（次数口径）；
  - zh/en locale 同步；title 文案说明"剩余次数为官方实时读数，不把请求次数伪装成额度消耗"。
- 阿里 qwen 段不变（官方给的就是 usedPercent/remainingPercent 比例，且 Credits 无法精确归因，保持百分比口径）。
- 同步物：部署副本 `C:\Users\Admin\.dsh\profiles\web\node_modules\dsh-turn-cost\lib\client.js`（当前 DSH 加载的就是它）、`~/.dsh/turn-cost-installer-package/payload/dsh-turn-cost-0.4.0.tgz`、桌面解压目录 payload 与 manifest/content-sha256 哈希、桌面 `dsh-turn-cost-setup-0.4.0-win-x64-fixed.zip` 重打包（15/15 哈希校验通过）。

### 复检

- `node --check`：client.js/quota.js/index.js 全过；仓库 `node --test` 26/26 通过（fold/quota 逻辑未动，回归无碍）。
- zip 解压后 15/15 文件 SHA-256 与 content-sha256.json 一致；tgz 内 client.js 含新文案、旧 `÷limit` 逻辑已移除。
- 待机主重启 dsh web 后目检：Kimi 徽章应显示「5h 还剩 47 次」而非「5h 已用 53% · 剩余 47%」。

### 门禁

B 轻流程（改 bug）：门一已对齐范围（机主确认"只显官方余额次数"）；改动仅 client 渲染层 + locale + 产物哈希；未触发风险阈值（不设门二）；待机主重启 dsh web 目检收尾。推送与发布待机主指令。

## 变更记录 #9（2026-08-25，B 轻流程·改 bug：Kimi/Qwen 额度「打开即用」——官方 API 优先 + 0.4.0 代码回库）

### 事故

机主反馈：turn 插件里 Qwen 和 Kimi 的额度功能"没实现"——打开 DSH 后 Kimi/Qwen 会话徽章永远只显示「本轮 N token · 缓存读 X%」，没有额度行。归档串（tool-library 会话 e67762b4）已查 Kimi 侧：token 计数正常，缺的是配额读数。本记录补全双平台根因并落地「打开即用」方案。

### 根因（双平台 + 结构）

1. **Kimi（部署 0.4.0 必失败）**：0.4.0 的 `fetchKimiQuota` 只走 **loopback OAuth**（读 `~/.kimi-code/server.token` + `127.0.0.1:58627`）。本机两者都不存在 → `kimi-server-token-not-found` → `ok:false` → client 徽章落到 token-only 兜底行。而 `.credentials.yaml` 里 `KIMI_CODING_API_KEY`（72 字符）在库、永久有效——0.3.0 的官方 API 方案本可打开即用，0.4.0 把它换掉了。
2. **Qwen（bl console 登录过期）**：`bl usage token-plan` 官方认证 = Console OAuth，token 会过期（实测 `Console session is not logged in or has expired`）；`bl auth login --api-key` 只存模型调用 key，不能查用量。官方文档（[Token Plan 个人版 FAQ](https://help.aliyun.com/zh/model-studio/token-plan-personal-faq.md?mode=pure)）明说用量在百炼控制台查看——无 API-key 直查接口。**但** bailian-cli 官方实现（[refresh-token.ts](https://github.com/modelstudioai/cli/blob/main/packages/core/src/auth/refresh-token.ts)）支持用存储的 OpenAPI AK/SK 自动续期 console token：`bl auth login --open-api` 配一次 AK/SK，之后 token 过期自动刷新，免手动登录。
3. **结构漂移**：部署副本 0.4.0（含 quota.js、loopback、builtinQuotaRoutes、#8 次数口径）从未入库——仓库 HEAD 停在 0.3.0（官方 API 实现，无 quota.js）。git log 无 quota.js 任何提交。tools.md 登记的嵌套仓库 `work/dsh-turn-cost` 不存在。

### 修复（合并：官方 API 优先 + loopback 兜底 + 0.4.0 回库）

- `lib/quota.js`：新增 `normalizeKimiUsages`（官方 coding API `GET /usages` 响应解析：7d/5h 窗口 + 加油包 nano-CNY + 月度 cents + parallel，实测形状 2026-08-25）；保留 `normalizeKimiLocalUsage`（loopback）。
- `lib/fold.js`：`quotaConfigOf` 的 `kimi-usages` 支持**双凭据路径**——https baseUrl + `credentialRef`（官方 API，默认 `KIMI_CODING_API_KEY`）或 loopback baseUrl（本地 OAuth）；非 loopback 的裸 http 仍拒绝。
- `lib/index.js`：`fetchKimiQuota` 按 baseUrl 分流——https（默认）→ 官方 API + `.credentials.yaml` 凭据；loopback → 本地 OAuth。恢复 `resolveCredentialValue`（.credentials.yaml refs 行解析，值只在内存）与 `credentialsFile` 字段；错误码细分为 `kimi-credential-not-found` / `kimi-api-unavailable` / `kimi-server-token-not-found` / `kimi-server-unavailable` / `kimi-output-unrecognized`。
- `lib/client.js`：仅文案——badge/dock quotaTitle 由「本地 OAuth 服务」改为「官方读数（coding API 或本地 OAuth 服务）」；渲染逻辑 0.4.0 已按 windows[].remaining 显示次数，无需改。
- **0.4.0 代码回库**：fold.js/index.js/client.js/quota.js/package.json（0.4.0）从部署副本同步回仓库，漂移消除；新增 `test/quota.test.mjs`（官方 API/loopback/aliyun 三种解析 5 项）。
- `C:\Users\Admin\.dsh\turn-cost-rates.json`：quota 块注释改新口径（kimi 官方 API 优先 + loopback 备选；qwen 需 bl console + open-api AK/SK）。
- **文档同步（机主跟进要求）**：README/CHANGELOG/DEVELOPMENT/rates.example.json 从 0.3.0 口径更新到 0.4.0——CHANGELOG 补 0.4.0 条目；README 改 Kimi 次数口径示例、补双路径与 AK/SK 自动续期说明、内置路由说明；DEVELOPMENT #17/#20 改口径 + 新增 #21 双路径决策 + §七 quota 维护要点更新；rates.example.json quota 注释同步。

### 验证

- `node --test` 31/31（基线 26 + 新 5 项）；`node --check` 四 lib 全过。
- **端点级实测（2026-08-25，真实 .credentials.yaml 凭据直连）**：`GET https://api.kimi.com/coding/v1/usages` → 7d 34/100、5h 3/100、加油包 ¥28.79、月度 ¥871.21/¥1000、parallel 30——官方 API 路径端到端打通，无需任何本地服务。
- 配置解析实测：`mergeQuotaRoutes(builtinQuotaRoutes(), turn-cost-rates.json)` → kimi `{kind, credentialRef}`、qwen `{kind, command}` 正确。
- 部署副本四 lib 与仓库逐字节一致。

### 机主配合项（一次性）

1. Qwen 侧「打开即用」：`bl auth login --console`（浏览器登录一次）+ `bl auth login --open-api --access-key-id <id> --access-key-secret <secret>`（存 AK/SK，此后 console token 自动续期）。无 AK/SK 则 Qwen 额度降级（偶尔手动登录，或只看控制台）。
2. 重启 dsh web（当前 GUI 加载的是已同步的部署副本），目检：Kimi 徽章应显示「本轮 N token · 5h 还剩 M 次」；Qwen 徽章显示「剩余 Y%」。

### 遗留观察（非阻断）

- `~/.dsh/turn-cost-installer-package/payload/dsh-turn-cost-0.4.0.tgz` 与桌面 zip 仍是旧 0.4.0（loopback-only）——下次重装/换机前需用本仓库新代码重新打包（生成源尚未入库，见 #7 遗留观察）。
- `bl usage token-plan` 实测当前 `bl-failed`（未登录）；AK/SK 配置完成后应返回 `per1WeekPercentage`（#6 曾实测 15.5%）。

### 门禁

B 轻流程（改 bug）：门一已对齐范围（机主拍板：Qwen 走 bl+AK/SK 自动续期；全量改部署+源码+配置+测试）；未触发风险阈值（不设门二）。**门三已确认（2026-08-25）：机主重启 dsh web 后目检，Kimi 与 Qwen 额度均已显示**。推送已执行（8f7a331）；发布待机主指令。

## 对齐保留：功能分支原变更记录（2026-08-25）

> 2026-08-25 合并 `origin/master` 时，master 已占用变更记录 #7–#9；以下三条为功能分支既有记录，内容不删，顺延为 #10–#12。

## 变更记录 #10（2026-08-24，Config 启动崩溃防回归维护；已实施，门三阻断）

### 需求对齐（门一，2026-08-24）

- **问题**：变更记录 #4 的 `Config` 误用 zod 链式语法，导致插件在 import 阶段崩溃并拖垮整个 dsh web 启动；应急修复已落地，但报告明确指出 host 侧测试和静态防线缺失。
- **目标**：把这次事故转化为可执行的防回归门禁，降低同类 schema/API 误用再次进入发布包的概率；“以后不会发生”按多层检测和发布前真实启动验收落实，不作绝对保证。
- **验证范围**：机主陈述单位 DSH 已新增 Qwen、Kimi 模型。本次不重新设计两条路由，而是把 DeepSeek 按量、Kimi 订阅、Qwen Token Plan 三类路由纳入兼容性矩阵；不得把机主陈述写成已由本机验证的事实。
- **不做**：不改变现有金额/额度口径，不新增全局金额开关，不修改单位 DSH 的模型配置，不推送 GitHub，不发布 npm。

### 基线与已确认事实

- 门一基线提交：`77481b1`（`docs: 变更记录#6 端点级实测落盘——三路由全通`）；该提交时工作区干净，当前分支 `master` 与 `origin/master` 同步。
- 门一基线时，嵌套仓库工作区仅有本方案文档的未提交 #10 草稿；本轮不把该草稿当作代码、CI 或依赖已实施。
- 门一基线时没有 `node_modules`、`package-lock.json` 或其他 lockfile。`package.json` 只有 `peerDependencies`，其中包括 `@deepseek-ai/schemastery`；没有 `dependencies` 或 `devDependencies`。
- 门一基线时 `.github/workflows/test.yml` 只执行 `node --test`；现有 26 项测试没有导入 host 端 `lib/index.js`，也没有 Config 上下文静态规则。
- 现有源码在 `lib/client.js` 与 `lib/index.js` 使用合法的 `Date.parse`。因此对 `.parse()` 的全库 grep 会误报，不能作为本维护的静态防线。
- **单位环境边界**：本轮未进入单位 DSH 运行态，也未验证 Qwen/Kimi 的模型可用性、路由或额度读数；这些状态当前只能记为机主陈述，不能记为本机验收通过。

### 调研与方案（门二已拍板；实施落点）

1. **运行时依赖按 Harness 官方规范落点**
   - `@deepseek-ai/schemastery` 被 `lib/index.js` 直接 import 并在运行时构造 `Config`，已从 `peerDependencies` 移到 `dependencies`（保留当前兼容版本范围，以锁文件固化）。不能用全局安装、测试 mock 或未声明依赖掩盖运行时缺口。
   - 仍由 DSH 宿主提供的 peer 依赖继续保留在 `peerDependencies`：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-typert-protocol`；三项均以相同版本范围镜像到 `devDependencies`，供 CI 的真实 host import 使用。不得只把 Schemastery 放进 devDependencies。
   - **依赖分层必须有机器门禁**：新增 `test/package-manifest-contract.test.mjs`，直接读取 `package.json`，不依赖 `node_modules`，断言 `@deepseek-ai/schemastery` 只存在于 `dependencies`（不得同时出现在 `peerDependencies`、`devDependencies` 或 `optionalDependencies`）；断言 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-typert-protocol` 继续存在于 `peerDependencies`，且各自的 `devDependencies` 字符串与 peer 范围逐字相同，并且不落入 `dependencies`/`optionalDependencies`。该契约测试必须在 CI 执行；仅做 host import 不足以发现未来把依赖放错位置，因为测试环境仍可能恰好安装到它。

2. **有明确版本口径的可重现 CI 安装与 host 校验**
   - CI Node 主版本固定为 **24**，实际 workflow 钉到 `v24.18.0`；lockfile 由 npm `11.16.0` 生成，`package.json` 的 `packageManager` 与 `docs/DEVELOPMENT.md` 已同步记录。Node/npm 精确版本与 lockfile 均已落盘，因此依赖安装口径达到本方案要求的可重现边界。
   - 已生成 `package-lock.json`（lockfileVersion 3）；CI 不使用项目级 `npm install` 或漂移安装，只执行锁定命令 `npm ci --ignore-scripts --no-audit --no-fund`。
   - GitHub Actions 已固定顺序：checkout → setup Node `24.18.0` → `npm ci --ignore-scripts --no-audit --no-fund` → package manifest contract → 真实 host import/Config 冒烟 → 静态规则与全量测试。该命令仍会因 `package.json` 与 lockfile 不一致而失败，不能通过删锁文件或改用宽松安装绕过；本地验证必须执行同一条命令。
   - host 冒烟必须直接 import `lib/index.js`，使用安装后的真实 `@deepseek-ai/schemastery` 与三项 DSH devDependency，不得注入伪造的 schemastery API。CI 的 host 冒烟通过不等于真实 dsh web 已启动。

3. **把“错误配置值校验”和“错误源码 API 拦截”拆成两类测试**
   - **运行时 Config 值语义（host 冒烟）**：单独的 `test/host-config.test.mjs` 直接验证 `TurnCostService` 可导入、`TurnCostService.Config` 可定义；`{}` 与 `{ ratesPath: "x" }` 应通过，`{ ratesPath: 1 }` 等错误类型应明确拒绝。该测试回答“配置值是否合法”，不负责扫描源码文本；它也不能替代上一项 manifest contract。
   - **Schemastery/Config 源码 API 规则（静态检查）**：单独的规则测试只在识别到 `@deepseek-ai/schemastery` 绑定及 `static Config = z.object(...)` 的 Config 区间后检查 zod 专属链式调用 `.optional()`、`.nullable()`、`.parse()`、`.safeParse()`；不能对全仓库或所有 `.parse(` 做禁用 grep。规则无法确定 Config 区间时应报规则错误，不得静默放宽范围。
   - **正反夹具**：至少提交一份合法 Config 正例（同时包含 Config 外合法的 `Date.parse(...)`，应通过）和一份 Config 内含 `z.string().optional()` 的反例（应失败）；对 `.nullable()`、`.parse()`、`.safeParse()` 的拦截分别保留可诊断的失败用例。运行时值测试失败与源码 API 规则失败必须有不同测试名称和错误信息，互不替代。

4. **脱敏三路由固定夹具**
   - 使用不含密钥、账号、原始日志、工作区路径和平台响应敏感字段的固定会话/事件夹具，覆盖 canonical provider id `deepseek-official`、`kimi-coding`、`qwen-token-plan-cn`，并单独覆盖历史兼容 id `qwen-token-plan`。
   - 夹具必须证明模型名来自会话日志而不是当前 harness 预设；执行 Kimi `usages` 规范化（含 5h/remaining）、Qwen `bl` 百分比规范化（含 `remainingPercent`），验证 DeepSeek 金额、Kimi 订阅读数分支、Qwen 剩余比例分支及额度端点失败时的安静降级。`quotaForRoute` 单路由调用异常必须收敛为 `ok:false`，同一次 `quota()` 中另一条路由仍须返回；任一路由数据异常只影响该路由/该读数，不能把 host 插件树启动拖崩。
   - client 分支必须由可执行 seam 证明：装载真实 `lib/client.js` bundle、捕获实际 assistant badge slot 并渲染 `kimi-coding`、`qwen-token-plan-cn`、历史 `qwen-token-plan` 三个 provider id；不得只 grep 源码字符串。额度纯规范化函数如需测试接缝，只能放在未列入 package exports 的内部模块，保持公开 API 与业务语义不变。
   - 夹具层零网络、零凭据、零真实 DSH 依赖；它证明业务分流与降级，不冒充单位环境的真实路由或额度验收。

### 门二验收口径重拍（2026-08-24，机主批准）

- 原方案把“单位 DSH 真实启动”设为门三硬门，混淆了通用插件启动兼容性与某台机器的部署状态。机主明确本地也要配置 Kimi/Qwen，机器间只更换各自凭据；因此不再要求必须到单位机才能证明本项目成立。
- 门三硬门改为：在**任一真实 DSH web profile** 中安装候选 `.tgz`，完成插件树启动/监听、DeepSeek 预设与本地 Kimi/Qwen 三路由验证、干净停止和回滚，即可证明本次通用修复与复用路径。家用机可作为该真实环境。
- 单位机后续只复核自己的凭据、网络和百炼 CLI 登录状态，属于部署环境冒烟，不再阻断本项目门三；未经单位实测不得声称“单位环境已通过”。
- 家用机保留既有 `qwen3-local` 路由；新增订阅/API 路由使用内置 catalog id `kimi-coding` 与 `qwen-token-plan-cn`。凭据只通过 DSH 受管凭据写入，不写进仓库或普通配置字段。

### 三层验证边界（不互相替代）

| 层级 | 环境与输入 | 必须证明 | 明确不能证明 |
|---|---|---|---|
| 1. Config 冒烟 | CI/local 的锁定依赖；真实 import；无网络、无凭据 | host 入口能 import，Schemastery `Config` 能定义，合法/错误配置值语义正确 | 三路由业务分流、真实 dsh web 插件树、单位模型可用性 |
| 2. 脱敏三路由夹具 | 固定脱敏会话/事件；无网络、无凭据、无真实 DSH | 模型取值、provider 分流、旧 Qwen id 兼容、单路由失败降级 | 真实平台额度、真实配置文件、真实 DSH 启动 |
| 3. 真实 DSH 启动 | 机主授权的任一真实 DSH 实机、实际 profile 与启动入口 | **发布前必验**：候选包真实安装，插件树完成加载并监听；DeepSeek/Kimi/Qwen 路由可用；启动后可干净停止且无残留；回滚路径成立 | CI 或夹具不能替代；通过机器只证明该机实测，不能冒充其他机器的凭据/网络已通过 |

### 实施范围与文档

- 已涉及：`package.json`、`package-lock.json`、`.github/workflows/test.yml`、`lib/index.js`、内部额度规范化模块 `lib/quota.js`、`test/package-manifest-contract.test.mjs`、`test/host-config.test.mjs`、`test/config-source-rule.test.mjs` 及正反夹具、`test/route-fixtures.test.mjs`、真实 client seam `test/client-quota.test.mjs`、`docs/DEVELOPMENT.md`、`.gitignore`。
- `docs/DEVELOPMENT.md` 已补充依赖落点、精确 `npm ci --ignore-scripts --no-audit --no-fund`/host 冒烟调用方式、manifest contract、Config API 禁用范围、三层验证边界、CI Node 24.18.0 与 npm 11.16.0 记录、单位 DSH 脱敏记录模板和回滚步骤。
- 单位 profile、模型配置、凭据、真实日志和部署副本不纳入仓库变更；真实启动只在机主明确授权后进行。

### 验收标准

- `@deepseek-ai/schemastery` 位于 `dependencies`；其余三项 DSH peer 仍在 `peerDependencies` 且同范围出现在 `devDependencies`；`package-lock.json` 与 `package.json` 一致。
- manifest contract 机器测试对上述依赖位置和逐字版本范围断言通过；CI 与本地均以完全相同的 `npm ci --ignore-scripts --no-audit --no-fund` 安装，显式执行真实 host import/Config 冒烟；`{}`/字符串配置通过，错误配置值拒绝；不得用 mock 结果代替。GitHub Actions 本身未在本轮远程实跑，不宣称 CI 已通过。
- CI 使用 Node `24.18.0`；lockfile 生成所用 npm `11.16.0` 已记录在 `packageManager` 与开发文档，不能改回只固定主版本或范围。
- 静态规则对 Config 内违规 Schemastery API 稳定失败，对合法 Config 与 Config 外 `Date.parse` 稳定通过；正反夹具均在 CI 执行。
- 脱敏夹具覆盖三种 canonical 路由和历史 Qwen id，模型来自日志；Kimi 5h/remaining、Qwen `remainingPercent`、`quotaForRoute` 单路由异常隔离均由真实执行的断言覆盖；真实 client bundle seam 证明三个 provider id 选择正确的展示数据，单路由失败安静降级且不阻断 host 启动路径。
- **发布前必验**：门三前由机主授权在任一真实 DSH profile 完成候选包安装、插件树加载/监听、DeepSeek/Kimi/Qwen 三路由、干净停止和回滚验收；未完成即门三阻断，也不得用 CI/夹具填充为通过。其他机器在各自实测前保持“未验证”。
- 实施后必须运行 `node --test`、语法检查、CI、`git diff --check` 与仓库要求的 `python tools/checks.py --json`；机器验 0 FAIL 后才进入独立模型 K3 复检。任一真实 DSH profile 的候选包启停、路由和回滚仍是门三硬门。

### 实施（门二已拍板，2026-08-24）

- `package.json`：`@deepseek-ai/schemastery` 移入 `dependencies`；`@deepseek-ai/cordis`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-typert-protocol` 保留在 `peerDependencies`，并以逐字相同范围镜像到 `devDependencies`；记录 `packageManager: npm@11.16.0`。
- 新增 `package-lock.json`（lockfileVersion 3），由 Node `v24.18.0` / npm `11.16.0` 生成；GitHub Actions 固定 Node `24.18.0`，先执行与本地完全相同的 `npm ci --ignore-scripts --no-audit --no-fund`，再执行 manifest contract、host Config 冒烟、静态规则、路由夹具、全量测试和语法检查。
- 新增内部 `lib/quota.js`，仅提取并导出额度规范化纯函数供宿主和脱敏测试共享；未加入 package exports，公开 API 不变。新增 `test/client-quota.test.mjs`，通过 VM 装载真实 client bundle 并执行实际 slot component，证明三个 provider id 的分支展示；`test/route-fixtures.test.mjs` 直接验证 Kimi/Qwen 规范化和两路由异常隔离。静态违规夹具使用文本扩展名，避免被 Node test runner 当作可执行测试；Config 区域无法唯一定位或对象级链式调用违规时静态门禁失败关闭。
- `docs/DEVELOPMENT.md` 已同步依赖/版本门禁、测试调用方式、Config 上下文范围和三层验证硬边界；`.gitignore` 忽略 `node_modules/` 与 npm debug 日志。

### 验证记录（家用机真实 DSH，门三进行中）

- `node --version` / `npm --version`：`v24.18.0` / `11.16.0`；`package-lock.json` 由该 Node/npm 组合生成，`packageManager` 记录精确 npm 版本。
- `npm ci --ignore-scripts --no-audit --no-fund`：按 CI 完全相同命令成功安装锁定依赖；GitHub Actions workflow 本身本轮未远程触发，不把本地结果写成 CI 已实跑。
- 目标回归：manifest contract、真实 host import/Config、Config 静态规则、脱敏路由夹具 **18/18 通过**；新增 Kimi 5h/remaining、Qwen `remainingPercent`、`quota()` 两路隔离，以及真实 client bundle 的三个 provider 分支执行断言。
- 全量 `node --test`：最终 **45/45 通过**；`lib/index.js`、`lib/client.js`、`lib/fold.js`、`lib/quota.js` 分别执行 `node --check` 均通过（不能把多个文件作为一次 `node --check` 调用，否则 Node 只检查第一个参数）。新增断言证明异常正文中的 `Authorization`/`Bearer`/诱饵密钥不会跨 Remote 边界，并禁止重新引入 child-process `shell:true`。
- `npm pack --dry-run --json --ignore-scripts`：独立审计在家用机复核成功；发布清单明确包含 `lib/quota.js`，确认内部规范化模块不会因打包清单遗漏而失效。
- 静态规则实证：生产 `lib/index.js` 通过；Config 外合法 `Date.parse` 正例通过；Config 内 `.optional()`、`.nullable()`、`.parse()`、`.safeParse()` 反例均被拦截。
- 根仓库 `python tools/checks.py --json`：C1–C5、C8 PASS，C6 INFO，C7 WARN（当前工作区有本次未提交变更），**0 FAIL**；命令因 WARN 返回退出码 1，未用 `--no-verify` 绕过。
- **家用机真实 DSH 已执行**：安装本地候选 `.tgz` 后，`npx @deepseek-ai/dsh web --no-open` 正常监听 `127.0.0.1:3080`，插件列表显示 `turn-cost` 已挂载/启用；模型选择器同时列出 DeepSeek、`kimi-coding`、`qwen-token-plan-cn`，并保留原 `qwen3-local`。
- **DeepSeek live 路由已通过**：新建真实会话发送“只回复 OK”，模型成功回复；turn-cost 同轮显示约 `¥0.02`、约 `1.3万 token` 和缓存读比例，证明 provider→日志→host→client→费率表整链可用。
- **Kimi live 路由部分通过**：机主在家用 DSH 手动配置新 API 后，`Kimi K3` 真实会话发送“只回复 OK”并成功回复，turn-cost 同轮显示约 `1.1万 token`。本地费率配置的旧凭据引用 `KIMI_API_KEY` 已改为实际 `KIMI_CODING_API_KEY`；随后脱敏直连探针确认 `GET https://api.kimi.com/coding/v1/usages` 返回 HTTP 401，因此额度面板稳定降级为 `kimi-usages-failed`。该 API 可聊天但无当前额度接口权限，5h 消耗/剩余仍未通过，不能记为完整门三通过。
- **Qwen live 路由完整通过**：`Qwen3.6 Flash` 真实会话两次发送“只回复 OK”均成功回复；首轮 turn-cost 显示约 `1.3万 token`。完成 `bl auth login --console` 后，`bl auth status` 为 authenticated、`bl usage token-plan --output json` 成功返回周额度字段；DSH 额度面板显示“7 天限额：已用 23% · 剩余 77%”，第二轮徽章显示“本轮 1.3万 token · 剩余 77%”。
- **新增脱敏与命令边界修复实证**：首次真实 UI 发现 `bl-failed` 拼接 CLI 原始错误正文；已改为仅返回固定错误码，移除非 JSON/不识别输出的 `raw` 字段，并移除 `execFile` 的 `shell:true`。后续复核发现 Windows 显式 `cmd.exe /c` 仍允许带空格的 `command` 形成嵌套命令且路径含空格会失效；现将配置收紧为 PATH 中的单个可执行文件名（拒绝路径、空白和参数），并增加 `cmd /c echo NESTED` 与带空格路径反例。重装最终候选后 Qwen 额度成功，错误正文未跨 Remote 边界，进程无 DEP0190 警告。
- **回滚与停止实证**：候选目录无删除地切换到备份 `0.1.2` 后，DSH 启动并返回 HTTP 200；再切回候选 `0.3.0`，四项模型配置仍在。最终停止后 3080 监听数为 0。旧副本保留在脱敏备份目录，可恢复。
- 最终本机候选包：`dsh-turn-cost-0.3.0.tgz`，SHA-256 `381B5FCBC396A794F4C8716A18B800FB8A388C7C23BF6586D80F75322AD3E9D7`；仅用于本机 profile 验证，未 npm 发布。
- **K3 边界**：历史 K3 发现与修复记录保留；本轮按机主明确指令“不跑 K3，以实测为准”，未形成新的独立模型 verdict，也不把人工/真实 DSH 实测冒充为 K3 通过。当前门三仍因 Kimi `/usages` HTTP 401 阻断。

### 回滚

- 代码、测试、CI、依赖与 lockfile：回退本次维护变更，恢复 `77481b1` 行为；不改日志格式、用户费率表或额度数据。
- 若精确 `npm ci --ignore-scripts --no-audit --no-fund`、真实 host import 或静态规则失败，保持阻断并修复依赖/测试边界，不降级为“只看纯函数通过”、全局安装或宽松安装。
- 单位环境：不自动改模型、凭据、profile 或服务；只在机主明确授权后按记录执行启动、停止或回退。

### 其他机器部署待办（原单位机清单，2026-08-25）

- [ ] 先按 tool-library `本机环境一句话.md` 读取硬件指纹，唯一匹配单位机后再读 `machines/单位机.md`；不套用家用机路径、代理或服务结论。
- [ ] 从 GitHub 候选分支 `codex/config-startup-regression-gates` 取得代码，核对候选 commit；该分支保持“未交付”状态，不直接合入 `master`。
- [ ] 执行 `node --version` / `npm --version`，应为 `v24.18.0` / `11.16.0`；随后运行 `npm ci --ignore-scripts --no-audit --no-fund`、`node --test` 和四个 `lib` 文件的逐文件 `node --check`。
- [ ] 在候选 commit 上执行 `npm pack --ignore-scripts`，记录生成包的 SHA-256；单位 DSH 安装该 `.tgz`，不直接把工作区源码覆盖到 profile。
- [ ] 安装前备份单位 DSH 当前 profile manifest/lockfile、`cordis.patch.yml` 和现用 `dsh-turn-cost` 版本，确保可恢复；敏感配置与凭据不复制、不入库。
- [ ] 启动真实 `dsh web`，确认插件树完成加载并监听；重点确认不再出现 Config/import 静态初始化崩溃。
- [ ] 用单位现有会话或脱敏新会话核对：DeepSeek 按量显示金额，Kimi 显示 5h 消耗/剩余，Qwen 显示剩余比例，历史 `qwen-token-plan` 会话仍兼容。没有实测到的项目明确记“未验证”，不得猜测为通过。
- [ ] 停止 dsh web 后检查无残留进程；按备份恢复旧版本并复启一次，再重新安装候选包，实证回滚与恢复路径。
- [ ] 只落盘脱敏证据：日期、单位机硬件匹配、候选 commit、包 SHA-256、Node/npm 版本、测试计数、监听结果、三路由结果、停止/残留和回滚结果；不记录密钥、账号、原始日志或完整 profile。
- [ ] 其他机器实测全部通过后更新本节；这只证明该机部署状态，不再阻断家用机门三。远程 Actions 只有在创建 PR 或更新 `master` 时才会触发；仅推送候选分支不得写成 CI 已通过。未经新的明确指令不合并 `master`、不发布 npm。

### 门禁

门一已确认，门二已由机主批准；家用机已完成候选安装、真实 DSH 启停、DeepSeek/Kimi/Qwen 三路 live 调用、两类额度成功读数、脱敏失败路径和回滚实证。本轮机主明确要求不跑 K3、以实测为准，因此没有新的独立模型 verdict，也不把该项写成通过。机主已于 2026-08-24 确认门三，本轮正式交付；推送与 npm 发布继续只接受机主新的明确指令。

## 变更记录 #11（Kimi 官方 OAuth 用量链路，2026-08-24）

- **问题**：官方文档复核与家用机实测证明，Kimi 模型 API key 可完成推理，但直连 `https://api.kimi.com/coding/v1/usages` 返回 401；官方公开的程序化套餐用量接口是 Kimi Code 本地服务 `GET /api/v1/oauth/usage`，依赖 `/login` 的托管 OAuth。
- **修复**：`kimi-usages` 改为只连接 `127.0.0.1|localhost` 的官方 Kimi Code Server，默认 `http://127.0.0.1:58627`；从 `~/.kimi-code/server.token` 读取 loopback bearer，不再读取 DSH `.credentials.yaml` 或模型 API key。远程 URL、外部 HTTP host 和旧 `credentialRef` 均被配置守卫丢弃。
- **口径纠正**：官方本地接口的常见 `limit=100` 是额度百分比刻度，不是 100 次请求；删除“请求数÷100”形成的本轮/本会话额度消耗估算。Kimi 每轮徽章和会话读数改为当前“5h 已用 X% · 剩余 Y%”，不再声称单轮归因。
- **机器验证**：本机已有官方 Kimi Code CLI `0.29.1`，`kimi doctor` 通过且 OAuth 已登录。官方本地接口实测 HTTP 200/`kind=ok`；安装候选后 DSH 面板显示 Kimi 7d 34%/66%、5h 0%/100%、加油包 ¥28.79/¥871.21/¥1000，Qwen 保持 23%/77%；新 Kimi K3 会话回复 OK，每轮徽章与会话读数均显示“1.1万 token · 5h 已用 0% · 剩余 100%”。
- **自动回归**：新增 loopback HTTP + server token 真实 seam；全量测试 46/46，四个 lib 文件语法检查和 `git diff --check` 通过；根 `python tools/checks.py --json` 为 0 FAIL/C7 WARN（根清单与嵌套项目均有本轮未提交改动）。最终候选 SHA-256 为 `381B5FCBC396A794F4C8716A18B800FB8A388C7C23BF6586D80F75322AD3E9D7`。
- **运行边界**：turn-cost 不擅自启动、登录或长期管理 Kimi 服务；使用 Kimi 额度显示前，由机主运行 `kimi web --no-open`。服务未运行或 token 缺失时只返回固定错误码，不影响 DSH 对话。实测结束后 DSH 3080 与 Kimi 58627 监听均为 0。
- **门禁**：机主于 2026-08-24 确认门三；本变更正式交付。未提交、未推送、未发布 npm 的状态在后续维护基线中另行记录。

## 变更记录 #12（2026-08-24，Windows 跨机一键部署包；门二已拍板）

### 状态与需求对齐（门一已确认）

- **状态**：门一与门二均由机主于 2026-08-24 确认；已进入实施，尚未形成门三交付结论。
- **目标机器**：单位机、笔记本；家用机作为首轮实现与破坏性边界验证环境。三机均为 Windows 且已有 DSH，但机器路径、代理和凭据不共享。
- **目标**：交付一个可放 U 盘的 Windows ZIP。用户双击后，自动识别 DSH home/web profile、备份旧状态、安装固定候选 `.tgz`、准备 Kimi/Qwen 额度所需 CLI、生成“启动 DSH（含 Kimi 用量）”和回滚/卸载入口，并给出脱敏验收结果。
- **人工步骤**：模型 API Key 仍由机主在 DSH“设置 → 模型”页输入；Kimi 套餐用量另走 Kimi Code OAuth，Qwen 套餐用量另走百炼控制台 OAuth。三类凭据不得混为一谈，也不得由安装器读取、代填、复制或写入日志。
- **不做**：不改 DeepSeek 和其他已有模型；不改系统代理、防火墙、WSL、Docker、系统执行策略或开机计划任务；不要求管理员；不发布 npm；未获“推送”指令不推 GitHub。
- **流程级别**：本维护跨机、涉及安装和凭据边界、预计超过 5 文件，触发门二。恢复常规 K3 双层复检；上一轮“以机主实测替代新 K3”不延续到本轮。

### 基线

- 上一轮 Kimi 官方 OAuth 修复经门三确认后，已固化为本地提交 `93bef4293249bf58943ed87157e8c74cc7f55874`（未推送）；基线 `node --test` 为 **46/46 通过**，嵌套仓库工作区干净、当前分支比远端候选分支 ahead 1。
- 根工具库的对应登记已固化为本地提交 `294cc1b`（未推送）。根仓库仍把嵌套项目目录视为未跟踪路径，这是既有仓库边界，不把嵌套仓库加入根提交。
- 当前家用机硬件指纹由注册表只读识别为 MSI B760M / Intel Core i5-14600KF，与 `machines/家用机.md` 唯一匹配；CIM 查询因当前受控会话权限不足返回“拒绝访问”，不据此否定注册表指纹。
- 当前家用 DSH web profile 的 `dsh-turn-cost` 依赖仍指向临时候选 `.tgz`；profile 用户层另有 `ratesPath` 覆盖。该状态证明现有手工部署不可跨机直接复制：临时绝对路径和用户名路径都会失效。

### 轻调研与已确认事实

1. **DSH 官方安装面**
   - DSH 官方文档规定通过 `dsh plugin --profile web add <tarball>` 管理 profile；该命令同时让 pnpm 安装依赖并维护 `dsh.profile.bundles`。profile manifest 不应由安装器手写。预构建 `.tgz` 无需授予 git `prepare` 脚本执行权。
   - 参考：[DSH 插件打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)、[DSH CLI 参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)。
2. **DSH 凭据边界**
   - 官方模型页将 API Key 写入 `$DSH_HOME/.credentials.yaml`，`settings.yaml` 只保留凭据引用；密钥为只写表单，模型变更下一次请求生效。安装器直接编辑凭据文件会绕开 DSH 的校验与写入语义，因此禁止。
   - 参考：[DSH 模型配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.zh.md)。
3. **Kimi 官方入口**
   - Windows 官方 npm 安装要求 Node `>=22.19.0`；当前 npm 包版本调研快照为 `@moonshot-ai/kimi-code@0.38.0`。`kimi login` 完成 OAuth；`kimi web --no-open` 默认只绑定 `127.0.0.1:58627`，token 存于 `~/.kimi-code/server.token`。
   - `GET /api/v1/oauth/usage` 是官方计划用量接口；但 Kimi 明确把 Server API 标为 experimental，运行版本自己的 `/openapi.json` 才是最终权威。因此安装器和插件必须保留版本/形状探测与安静降级，不能声称接口永不变化。
   - 参考：[Kimi Code 安装](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started)、[本地服务](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/server.html)、[Server API](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html)。
4. **百炼官方入口**
   - 官方 CLI 可由 npm 安装 `bailian-cli`；当前调研快照为 `1.17.0`。模型 Token Plan API Key 与控制台 OAuth 可共存；`bl usage token-plan --output json` 需要控制台登录，所以 DSH 模型 Key 不能替代 `bl auth login --console --console-site domestic`。
   - 参考：[百炼 CLI 官方仓库](https://github.com/modelstudioai/cli)、[认证命令参考](https://github.com/modelstudioai/cli/blob/main/skills/bailian-cli/reference/auth.md)。
5. **现成轮子结论**
   - TL-008 已是目标插件；DSH、Kimi Code、百炼均已有官方安装/认证入口。新代码只负责编排、事务回滚和验证，不复制三方客户端、不实现第二套凭据库、不手写 DSH profile manifest。

### 方案（待门二）

#### 1. 部署包结构与构建

- 新增 `installer/`：PowerShell 5.1 兼容的安装核心、启动器、卸载/回滚器、双击 `.cmd` 入口、中文说明、非敏感 `installer-manifest.json` 和测试夹具。
- 新增 `scripts/build-windows-installer.ps1`：先运行项目测试与 `npm pack --ignore-scripts`，计算候选 `.tgz` SHA-256，再把脚本、payload 和清单组装为 `dist/dsh-turn-cost-setup-<version>-win-x64.zip`；构建目录不提交，发布 ZIP 是否提交/上传另等机主指令。
- payload 只包含本项目 `.tgz` 与安装脚本，不包含任何 profile、API Key、OAuth token、账号、机器名或真实日志。清单记录插件版本、包哈希、安装器版本、支持的 provider id 与 CLI 固定版本。

#### 2. 事务式安装

- 入口先确认 Windows、Node `>=22.19.0`、当前用户可写 DSH home，并唯一解析 `$DSH_HOME`（未设置时为 `~/.dsh`）；仅接受 profile 名 `web`，路径必须在解析后的 DSH home 内。
- 先检查 DSH 是否正在监听/占用目标 profile；运行中则停止并提示用户自行关闭，不自动杀进程。
- 在 `$DSH_HOME/backups/dsh-turn-cost-installer/<UTC 时间>-<随机后缀>/` 备份 profile manifest、lockfile、workspace 文件、用户 patch 和既有 `dsh-turn-cost` 包快照；备份清单逐项记录 SHA-256，不读取或复制 `.credentials.yaml`。
- 校验 payload SHA-256 后，只调用官方 `dsh plugin --profile web add <绝对 tgz 路径>`。优先使用 PATH 中真实 `dsh`；否则先以机器现有的 `npx @deepseek-ai/dsh --version` 入口只读解析实际版本，再把同一精确版本用于本次安装、dump 与后续启动记录，避免一次流程内漂移。无法证明入口和版本可用时在任何 profile 写入前失败关闭。
- 安装后执行 `--dump-config`，断言 bundle 层包含 `dsh-turn-cost` 且只有一个 `turn-cost` id；再核对 profile dependency/bundles。任一检查失败，按备份恢复并给出固定错误码。
- 重复运行必须幂等：同版本同哈希只做健康检查；旧版本升级先备份；安装器不删除、不重排其他 bundle，不覆盖用户 patch。

#### 3. 正确额度配置内建

- 插件代码内置标准额度路由：`kimi-coding → kimi-usages`、`qwen-token-plan-cn → aliyun-bl`，不再要求每台机器复制 `rates.example.json` 或写用户名绝对路径才显示额度。
- 自定义 `ratesPath` 继续只作为覆盖层：用户自定义价格、别名和合法额度路由仍胜出；现有配置保持兼容。新增明确禁用语义，允许用户按 route 关闭自动额度读取，避免“内置默认值”变成不可退出的外部调用。
- Kimi 仍只访问 loopback；Qwen 仍只执行严格白名单中的裸命令名与固定参数。默认路由失败只显示“暂读不到”，不得拖垮 DSH、模型调用或另一条额度路由。

#### 4. 隔离 CLI 工具链与人工授权

- 不修改全局 npm prefix。把 `@moonshot-ai/kimi-code@0.38.0` 与 `bailian-cli@1.17.0` 作为安装器私有工具链安装到 `$DSH_HOME/turn-cost-tools/`，由专用 `package.json`/lockfile 固定直接与传递依赖；启动器仅在自身进程 PATH 前置该目录，不污染系统或其他终端。
- 已有外部 CLI 只用于只读诊断，不被覆盖。私有工具链缺失且离线时，插件安装仍可完成，但明确输出 `CLI_PENDING`，并提供联网后的“补齐 CLI”入口；不得把额度不可用误报成安装成功。
- 安装器只启动官方交互命令：`kimi login` 与 `bl auth login --console --console-site domestic`；不捕获其 stdout、不传 API Key 参数、不解析认证配置。用户可跳过，状态记为待办。
- DSH 模型 Key 由用户随后在 Web UI 添加内置 `kimi-coding`、`qwen-token-plan-cn` provider 时手动输入。安装器仅检查 `settings.yaml` 是否存在对应 provider id，不读取凭据值；缺失时打开/提示模型设置步骤。

#### 5. 日常启动与进程所有权

- 生成 `$DSH_HOME/turn-cost-launcher/启动 DSH（含额度）.cmd`。启动器先复用已在 `127.0.0.1:58627` 且通过 Kimi `healthz/meta` 验证的服务；否则用私有 CLI 启动 `kimi web --no-open --port 58627`。
- 端口被非 Kimi 服务占用时失败关闭，不跟随 Kimi 的自动递增端口，否则插件固定 loopback 地址会读错实例。
- 启动器再以前述已验证 DSH 入口启动 web profile。若 Kimi 服务由本次启动器创建，则 DSH 退出后通过带本地 bearer 的官方 `POST /api/v1/shutdown` 干净停止；复用的既有 Kimi 实例不关闭。token 只在内存中使用，不落启动日志。
- 不创建开机任务、不常驻后台、不修改防火墙；关闭 DSH 后不遗留本启动器拥有的 Kimi 进程。

#### 6. 卸载与回滚

- `回滚上一次安装.cmd` 恢复最近一次备份；`卸载.cmd` 只移除安装器拥有的当前插件/启动器/私有 CLI。若安装前已有 `dsh-turn-cost`，卸载恢复原版本而不是删除。
- 不删除 DSH sessions、settings、`.credentials.yaml`、Kimi OAuth、百炼 OAuth 或其他全局 CLI；私有工具目录只有在状态文件证明归本安装器所有时才移除。
- 删除前校验目标均位于 DSH home 下，并逐项列明；找不到可信状态文件时拒绝猜测删除。

### 验收标准

1. **静态与单测**：现有 46 项全部通过；新增默认额度路由、覆盖/禁用语义、脱敏错误码和 manifest/package 合同测试。
2. **Windows 沙箱测试**：Windows CI 使用临时 `DSH_HOME`、伪 DSH/Kimi/bl shim 验证全新安装、同版本重跑、升级、payload 篡改、命令失败回滚、保留无关 bundle、凭据/settings 字节不变、卸载所有权和路径逃逸拒绝。
3. **构建可重现性**：固定 Node/npm 与 CLI lockfile；同一提交两次构建的 payload 文件清单与每文件 SHA-256 一致。ZIP 容器时间戳差异若无法消除，不能宣称整包哈希可重现，只比较内容清单。
4. **家用机真实验证**：在备份后执行安装 → API Key 人工步骤检查 → Kimi/Qwen OAuth → 快捷启动 → DSH 插件树/3080 → DeepSeek/Kimi/Qwen 三路显示 → 退出后 3080/58627 无本启动器残留 → 回滚旧版 → 再安装候选。
5. **跨机边界**：单位机与笔记本分别运行同一 ZIP，仅记录硬件指纹、包哈希、版本、固定状态码与三路结果；不复制家用机凭据。两机未实测前只能标“待验证”，但安装器门三至少要求家用机完整事务与回滚通过。
6. **仓库门禁**：`git diff --check`、PowerShell 语法/静态检查、`node --test`、Windows CI 夹具、`npm pack --dry-run`、根 `python tools/checks.py --json` 0 FAIL 后进入独立模型 K3；K3 修到通过再停门三。

### 预计文件范围

- 生产与配置：`lib/fold.js`、`lib/index.js`、`rates.example.json`、`package.json`、`package-lock.json`。
- 安装器：`installer/**`、`scripts/build-windows-installer.ps1`。
- 测试与 CI：`test/**`、`.github/workflows/test.yml`。
- 文档与登记：`README.md`、`docs/DEVELOPMENT.md`、`CHANGELOG.md`、本方案文档；门三前同步根 `tools.md` 并重建图谱。

### 风险与回滚摘要

- **最高风险**：误写 profile/凭据、安装中断留下半状态、启动器误杀既有服务、Kimi experimental API 漂移、CLI 更新破坏输出契约。
- **控制**：官方 DSH 命令、写前备份、payload 哈希、临时 home 夹具、固定 CLI lockfile、进程所有权、loopback/固定端口、固定错误码、禁止读取凭据。
- **代码回滚**：回退本维护提交恢复基线 `93bef42`；不迁移会话或日志格式。
- **机器回滚**：使用安装前备份恢复 profile 与原插件；不回滚也不删除由用户自行完成的 API/OAuth 凭据。

### 门禁

本方案触发门二且已获机主拍板；当前进入实施。未完成机器验、K3 与门三前，不宣称 ZIP 已交付；未获“推送”指令不推送，未发布 npm。

### 实施结果（门三前）

- **代码与包**：版本升至 `0.4.0`；内置 Kimi/Qwen 标准额度路由及覆盖/`enabled:false` 禁用语义。新增 Windows 安装、启动、补齐 CLI、回滚、卸载入口，固定 DSH `0.1.1-rc.2`、Kimi Code `0.38.0`、百炼 CLI `1.17.0` 与两套 lockfile。
- **方案偏差（已收敛）**：门二方案中的 `npx` 版本探测在本机出现持续高 CPU 挂起，且受父项目 `packageManager: npm` 干扰；profile 哈希未改变。实施改为清单固定 DSH 版本，并在 `$DSH_HOME/turn-cost-dsh-cli` 用 bundled pnpm 与 frozen lock 建立隔离入口。pnpm 11.22.0 已忽略旧 `onlyBuiltDependencies`，按官方现行语义改用 `allowBuilds` 精确批准五个必要构建依赖。
- **真实安装修正**：首轮机器验发现 profile 曾指向临时解压 tgz、`npm ci` 输出混入 `toolsReady`、回滚后仅凭 bundle 名可误判幂等；均补回归并修复。最终实现先原子固化完整包到 `$DSH_HOME/turn-cost-installer-package`，profile 只引用永久载荷，状态字段保持布尔，幂等同时校验状态哈希、bundle 与永久依赖路径。
- **进程修正**：Kimi 0.38.0 的 live `/openapi.json` 证明 shutdown 为官方端点；实测无 JSON content type/body 时返回 `50001 Unsupported Media Type`。启动器已改为 bearer + `application/json` + `{}`，最终启动/退出测试后 3080、58627 均释放。机主关闭 Kimi 桌面客户端不是该错误根因：测试前 58627 未监听，进程树明确指向安装器私有 CLI。
- **自动验证**：`npm ci --ignore-scripts --no-audit --no-fund` 成功；Node 全量测试 **52/52**；Windows PowerShell 5.1 夹具通过，覆盖旧版升级、永久载荷、同哈希幂等、篡改拒绝、失败回滚、凭据/settings 不变、卸载所有权；PowerShell 语法与 UTF-8 BOM 门禁通过。
- **家用机真实验证**：安装、同哈希重跑（回滚点不变）、回滚到原 profile 精确哈希、再安装均成功；`settings.yaml` 与 `.credentials.yaml` 全程 SHA-256 不变。DSH/Kimi/百炼版本分别为 `0.1.1-rc.2`/`0.38.0`/`1.17.0`。DSH 首页 HTTP 200；Kimi meta/usage code 0；百炼返回真实 7 天额度；浏览器中每轮 Kimi 5h 徽章与汇总面板的 Kimi 7d/5h/加油包、Qwen 7 天额度同时显示，控制台 0 error/warn。
- **最终构建候选**：`dist/dsh-turn-cost-setup-0.4.0-win-x64.zip`，15 个清单文件逐项验签；ZIP SHA-256 `ECC4A505922F727E86C83F2421D691E43EF1A0C67328CAD801DBCBD5E9A30EF2`，插件 tgz SHA-256 `56AB62224B05C0D8C81BFBD1AB0BA09EF7DF33D710B9E7BB1AE6F72F88354A73`。ZIP 容器哈希不宣称跨构建可重现，内容清单才是逐文件验收依据。
- **根门禁**：`python tools/checks.py --json` 为 0 FAIL（C1–C5/C8 PASS，C6 INFO，C7 仅因本轮未提交改动与本地 ahead 产生 WARN）；图谱重建为 134 项。项目侧 `git diff --check`、四个 JS 语法、PowerShell 5.1 语法、`npm pack --dry-run` 均通过。
- **K3 状态**：2026-08-25 已启动第一层只读审计，但模型服务多轮超时，尚未形成 verdict；机主随后明确指令“k3复检取消”。因此本轮不把 K3 记为通过，按机主取消决定结束该门禁。
- **门三状态**：家用机实现与验证完成，现停门三等待机主确认。单位机、笔记本仍是同一 ZIP 的后续跨机验收，不冒充本机已验证。当前未提交、未推送、未发布 npm；门三确认不等于推送授权。

## 变更记录 #13（2026-08-25，0.4.2：纠正 Kimi 模型 Key 与额度凭据混淆）

### 错误确认

- 变更记录 #9 将一次特定凭据直连 `api.kimi.com/coding/v1/usages` 的成功错误推广为通用默认，并把 DSH 模型 API Key 当作套餐额度凭据；该结论已被单位机与家用机的实际部署结果推翻。
- 家用机重新填写模型 Key 后，Kimi/Qwen 模型调用均成功，但 Kimi 直连额度仍返回 `kimi-api-unavailable`。同机完成 `kimi login`、启动 Kimi Code loopback 并切换 `baseUrl` 后，DSH 立即显示 7d/5h/加油包/月度额度；百炼控制台 OAuth 后 Qwen 7 天额度同步显示。
- 0.4.1 又删除了日常启动器中的 Kimi 服务生命周期，构成功能回退。错误提交保留在历史中，不重写、不强推；本记录明确废止其中的默认路线结论。

### 0.4.2 修复范围

- `kimi-usages` 只接受 `127.0.0.1|localhost` loopback，内置默认固定 `http://127.0.0.1:58627`；删除 host 对 `.credentials.yaml` 的额度解析、远程 HTTPS 路径及 `normalizeKimiUsages`。
- 恢复 Windows 启动器对 Kimi Code 服务的按需启动、身份验证和受管关闭；端口被非 Kimi 服务占用时失败关闭，不终止未知进程。
- 新增“配置额度登录”入口，只编排官方 `kimi login` 与 `bl auth login --console --console-site domestic`，不接收或保存模型 Key、AK/SK。
- 版本升至 0.4.2，更新合同测试、Windows 夹具、安装说明、README、CHANGELOG 与示例报告；重新执行静态门禁、可重现构建、真实安装/回滚验收和独立模型复检。

### 推送边界

- 仅向 `codex/config-startup-regression-gates` 正常推送，不改写 `origin/master` 历史；GitHub CI 通过后再决定合并。
- 根仓库当前包含其他本地提交，本轮不推根仓库；任何凭据、本机 OAuth 配置、私有费率表和原始认证日志均不入库。

### 实施与验证结果

- Node 全量测试 **60/60**；维护验证 **5/5 PASS**，覆盖 vendor 完整性、PowerShell 语法与 BOM、版本一致性及 Windows 安装夹具。
- 家用机从已确认的 0.4.1 基线执行候选安装、同版本重装、日常启动、真实额度探测、受管退出、精确回滚、回滚后重装和清理，全部通过；3080/58627 均无残留。
- 真机探测确认 Kimi meta/usage code 0；百炼 `bl usage token-plan --output json` 的 `per1WeekPercentage` 已被适配层识别。浏览器同时显示 Kimi 7d/5h/加油包/月度与百炼 7 天剩余额度。
- 从已经安装同一候选的状态重复运行整套验收，会因保存的回滚点仍指向升级前基线而触发哈希保护；恢复 0.4.1 基线后完整事务通过。该保护未被放宽，也未用失败重跑冒充最终结果。
- 独立模型首轮复检发现并阻断两处一致性问题：README/示例费率仍残留 `--open-api` 存 AK/SK 指引；启动器/登录辅助未与 host 一致解析 `KIMI_CODE_HOME`。现已删除现行文档中的 AK/SK 路线，统一 token home，并把 Kimi CLI 非零退出降为明确 `AUTH_PENDING`（token 为空仍失败），不再误报 `AUTH_OK`。
- 修正后的最终制品为 `dist/dsh-turn-cost-setup-0.4.2-win-x64.zip`，SHA-256 `FD0FDEB2EC8017B41D9D545F61C414BE40870D79AF3604B60155678C8E5726A9`；内容清单 SHA-256 `B09E56AB9E61A7C4FCA02B3E470820C1FB20D123F7385C40B6D1BF5B4FA721D7`。`npm pack --dry-run --ignore-scripts` 通过；根仓库门禁 0 FAIL。未取得 CI 结果前不合并 `master`。
