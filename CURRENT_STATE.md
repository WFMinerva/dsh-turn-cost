# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威（里程碑快照在 tool-library `projects/README.md`，仅为静态快照）。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。

- **当前分支**：master
- **state_based_on_commit**：`428dcbe`（0.4.2 门三确认最终状态同步；本批次 0.5.0 开发基于此）
- **dirty**：`package.json` 有未提交改动（新增 `test` / `test:installer` scripts；他会话留存）；本批次 0.5.0 文档补记（方案记录 #14 验证段、CURRENT_STATE 同步）已改未提交
- **最近完成**：0.4.2 发布（Kimi 额度恢复官方 loopback OAuth 链路 + 安全收口）；2026-08-28 升档正式项目 + K3 两轮通过 + 门三确认交付；**0.5.0 已开发、部署、门三确认（2026-09-02，单位机）**——移除额度汇总面板（summary 端点/面板/文案/样式）、Kimi 徽章与读数条改显 7 天周额度+加油包余额、Kimi loopback 服务自动拉起（K2）、阿里 bl 默认认死 `~/.dsh/turn-cost-tools` 固定路径；四条链路实测通过（summary 404、Kimi 7d 剩 97/余额 ¥19、Qwen 剩 73.74%、DeepSeek 金额）；见 `CHANGELOG.md` [0.5.0] 与 `docs/方案-dsh-turn-cost.md` 变更记录 #14
- **下一步唯一动作**：提交本次文档补记；待机主决定推送（推送仅凭机主明说「推送」）；其他机器（家用机/笔记本）部署 0.5.0 待机主安排
- **阻塞**：无
- **验证命令与结果**（提交态入口，不依赖 package.json scripts）：`node --test "test/*.test.mjs"` → 65/65 PASS / 0 FAIL（exit 0）；`.\maintenance.ps1 verify` → 5 项 PASS（vendor-integrity / ps-syntax-bom / node-tests 65 / versions-equality / windows-fixture），退出码 0——2026-09-02 单位机实际运行
- **已验证机器**：家用机（0.4.2 门三）；单位机（0.5.0 开发/门禁/部署/四条链路实测/机主目检，2026-09-02）
- **本机专属依赖**：node v24.18.0 / npm 11.16.0（家用机）；单位机 node 同源可跑门禁；dsh 宿主（生产端口纪律见 tool-library 速查）；Kimi loopback 服务 / `bl` CLI 仅为额度功能的可选依赖
- **不可同步数据**：`node_modules/`；个人费率表（若有）；`evidence/` 实机验收原始报告（脱敏后也不入库）
- **推送状态**：0.4.2 及此前未推送提交 + 本批 0.5.0 均未推送；推送仅凭机主明说「推送」
