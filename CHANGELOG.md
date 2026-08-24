# Changelog

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 维护，版本号遵循语义化版本。

## [Unreleased]

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
