# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威（里程碑快照在 tool-library `projects/README.md`，仅为静态快照）。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。

- **当前分支**：master
- **state_based_on_commit**：`6c0344f`（升档补结构前业务态 = 0.4.2 发布 + PR #5 合并）
- **dirty**：`package.json` 有未提交改动（新增 `test` / `test:installer` scripts；他会话留存，2026-08-28 升档批次未纳入、未改动）；其余干净
- **最近完成**：0.4.2 发布（Kimi 额度恢复官方 loopback OAuth 链路 + 安全收口，见 `CHANGELOG.md`）；CI 固定 vendor LF 行尾；2026-08-28 由「受管理工具仓」升档正式项目，补齐 AGENTS.md / CURRENT_STATE.md（变更记录见 tool-library `docs/方案-孵化项目独立工作区与三机交接.md` 变更记录 #5）
- **下一步唯一动作**：待机主决定；例行维护按 `CHANGELOG.md` 演进（他会话的 test scripts 改动待其归属会话收尾入库）
- **阻塞**：无
- **验证命令与结果**：`npm test` → 61/61 PASS / 0 FAIL（2026-08-28 家用机，升档补结构前后各跑一次一致）；`maintenance.ps1 verify` 本批未运行（零代码改动）
- **已验证机器**：家用机（本批）；单位机（0.4.2 额度链路，`CHANGELOG.md` 载两机分别实测）
- **本机专属依赖**：node v24.18.0 / npm 11.16.0（家用机）；dsh 宿主（生产端口纪律见 tool-library 速查）；Kimi loopback 服务 / `bl` CLI 仅为额度功能的可选依赖
- **不可同步数据**：`node_modules/`；个人费率表（若有）；`evidence/` 实机验收原始报告（脱敏后也不入库）
- **推送状态**：升档补结构提交未推送（此前与 origin/master 0/0 完全同步）；推送仅凭机主明说「推送」
