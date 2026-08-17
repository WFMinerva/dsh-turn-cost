# Changelog

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 维护，版本号遵循语义化版本。

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
