# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威（里程碑快照在 tool-library `projects/README.md`，仅为静态快照）。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。

- **当前分支**：master
- **state_based_on_commit**：`221a9e4`（0.5.0 已推送 + CI 平台差异修复已推送）
- **dirty**：无（工作区干净，含 package.json——0.5.0 已提交，无未提交 scripts 改动）
- **最近完成**：
  - **0.5.0 已开发、部署、门三确认并推送（2026-09-02，单位机）**——移除额度汇总面板（summary 端点/面板/文案/样式）、Kimi 徽章与读数条改显 7 天周额度+加油包余额、Kimi loopback 服务自动拉起（K2）、阿里 bl 默认认死 `~/.dsh/turn-cost-tools` 固定路径；四条链路实测通过（summary 404、Kimi 7d 剩 97/余额 ¥19、Qwen 剩 73.74%、DeepSeek 金额）；见 `CHANGELOG.md` [0.5.0] 与 `docs/方案-dsh-turn-cost.md` 变更记录 #14
  - **CI 平台差异修复（221a9e4，2026-09-02）**：route-fixtures 的 pinned bl.cmd 用例标 Windows-only（非 win32 跳过）——0.5.0 引入的该用例在 ubuntu CI 无法执行 `.cmd` 导致两条 push run 失败；修复后 GitHub Test workflow 全绿（ubuntu npm job + windows verify job 均 success）。教训与测试约定已补记 `docs/DEVELOPMENT.md` §四
- **下一步唯一动作**：待机主安排其他机器（家用机/笔记本）部署 0.5.0；GitHub 解绑 QQ 邮箱（机主本人操作，见隐私加固结论）；Qwen Token Plan 升级/替代官方 API 的 Credits 实测方案仍搁置（机主决定再做）
- **阻塞**：无
- **验证命令与结果**（提交态入口，不依赖 package.json scripts）：`node --test "test/*.test.mjs"` → 65/65 PASS / 0 FAIL（exit 0）；`.\maintenance.ps1 verify` → 6 项 PASS（vendor-integrity / ps-syntax-bom / node-tests 65 / versions-equality / windows-fixture / privacy-scan），退出码 0——2026-09-02 单位机实际运行
- **已验证机器**：家用机（0.4.2 门三）；单位机（0.5.0 开发/门禁/部署/四条链路实测/机主目检 + CI 修复，2026-09-02）
- **本机专属依赖**：node v24.18.0 / npm 11.16.0（家用机）；单位机 node 同源可跑门禁；dsh 宿主（单位机由 PowerShell 循环自动拉起、3080 常驻 → 升级只能走手动部署，见 tool-library `machines/单位机.md` 与方案 #14）；Kimi loopback 服务 / `bl` CLI 仅为额度功能的可选依赖
- **不可同步数据**：`node_modules/`；个人费率表（若有）；`evidence/` 实机验收原始报告（脱敏后也不入库）
- **推送状态**：0.5.0 及 CI 修复 `221a9e4` 均已推送（master 与 origin 同步）；后续推送仅凭机主明说「推送」
