# Changelog

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 维护，版本号遵循语义化版本。

## [Unreleased]

## [0.3.0] - 2026-08-24

### Added

- **订阅额度窗口显示（门二 v2 五拍落地）**：新端点 `turnCost/quota`——Kimi 订阅路由经官方 `GET {baseUrl}/usages` 读 5 小时/7 天窗口的 used/limit/remaining/resetTime 与加油包余额（实测 200，凭据内存解析自 `.credentials.yaml`，永不落盘打印）；阿里 Token Plan 路由调官方 `bl usage token-plan --output json`（未装/未登录/输出不认得均安静降级）
- **按路由分流显示**：每轮徽章按该轮实际 provider 分流——官方按量（DeepSeek）显示 ¥ 金额；`kimi-coding` 显示「本轮 token · 5h 额度消耗 X% · 剩余 Y%」（消耗% = 该轮请求数 ÷ 5h 窗口上限）；`qwen-token-plan-cn` 显示「本轮 token · 剩余 Y%」（Credits 无法精确归因，不编造消耗%）
- **模型名随对话显示**：会话读数条前缀模型名（读自对话日志，不跟当前 harness 预设）
- 费率表新增可选 `quota` 顶层块（`quotaConfigOf` 解析，畸形/原型名键守卫）；汇总面板新增「订阅额度窗口」区；fold.js 新 `requestsInWindow`（窗口内按 provider 计请求数）

### Changed

- `turnCost/query` 返回增 `provider` 与 `requests`（该轮实际 provider 路由与调用数），供 client 分流渲染

### Fixed

- host 端 `Config` 的 zod 语法误用（`z.string().optional()`）在 0.2.0 部署后拖崩 dsh web 启动——schemastery 无此方法，对象字段缺省即可选（变更记录 #4，0.2.0 本机热修，0.3.0 起含在正式码线）

## [0.2.0] - 2026-08-24

### Added

- **自定义费率表**：插件配置 `ratesPath` 指向本机 JSON（模型→四桶单价，可选峰谷双档、别名归一化、订阅制 0 价登记），叠加在内置官方 CNY 卡之上；文件缺失/损坏自动回退内置价
- **会话级读数条**：`conversation.composer.dock` 槽位（官方统计条同带）显示本会话累计金额/token/缓存命中率，token 口径与官方统计条逐桶一致
- **跨对话汇总面板**：会话页头「额度汇总」按钮打开面板，展示全部会话合计、按模型分组、按天分组（近 14 天），数据来自 host 端新端点 `turnCost/summary`（枚举全部会话日志，签名缓存增量重算）
- host 端新端点 `turnCost/sessionTotals`（整会话聚合）；fold.js 新增 `listSessions` / `readSessionEntry` / `sessionTitleOf` / `costOfSession` / `beijingDay` / `builtinRates` / `mergeRates` / `resolveRateEntry`
- `rates.example.json` 费率表示例

### Changed

- `costOfStep` / `costOfTurn` 接受可选费率表参数；不传时行为与内置官方 CNY 卡逐字节一致（既有 11 项测试原样通过）

## [0.1.3] - 2026-08-24

### Fixed

- 补充 `deepseek-v4-flash-vision-exp` 视觉模型价目（官方确认与 V4 Flash 同价）；此前该模型会话的每轮金额显示 0.00

## [0.1.2] - 2026-08-23

### Added

- GitHub Actions CI：push / pull_request 触发，`actions/setup-node` + `node --test`，把计费核心回归卡在合入前（#4）

### Fixed

- 按 DeepSeek 2026-08-23 新规，周六、周日全天使用空闲价；生效前的历史调用继续按旧时段计费
- 峰谷判断改为显式换算北京时间，不再依赖运行 dsh 的宿主机时区

## [0.1.1] - 2026-08-17

### Changed

- 包元数据：author 统一为 Dong CHEN，补充 repository / homepage / bugs 字段

## [0.1.0] - 2026-08-17

### Added

- 首个版本：在每条 AI 回复下方的操作行显示本轮预计费用（人民币，DeepSeek 官方峰谷价）
- 按 (轮, 步) 折叠 provider 上报的真实 usage，持久日志与 live 事件合并，绝不重复计费
- 跨峰谷按每步实际时间分别计价；无官方 CNY 价的模型不计入金额（单独计数，不编造）
- 历史会话同样显示；中英双语；完全本地零网络

### 开发

- `docs/DEVELOPMENT.md` 开发与维护指南
- `test/fold.test.mjs` 计费核心纯函数单测
