# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威（里程碑快照在 tool-library `projects/README.md`，仅为静态快照）。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。

- **当前分支**：master
- **state_based_on_commit**：`0242c9b`（0.5.1 Flash 家族重定价 + 价表时间分档；**已推送，CI 双 job 全绿**）
- **dirty**：无（工作区干净）
- **最近完成**：
  - **0.5.1 官方 Flash 重定价适配（2026-09-10，单位机）**——官方 2026-09-10 12:00 北京时间调价：V4.1 Flash 发布、`deepseek-flash` 成规范名，两个退役 id 由 V4.1 Flash 兜底服务并按新 Flash 价计费。内置 `OFFICIAL_CNY` 改新价（高峰 2.0 / 0.04 / 8.0，空闲 1.0 / 0.02 / 4.0 元每百万 token），新增 per-model `history` 历史档 + `effectiveRateEntry()` 选档 → **切点前的历史样本仍按 2026-08-17 旧卡计价，不被新价重算**；`deepseek-v4-pro` 价未动并标注官方 09-14 12:00 路由切价待办。流程=高风险变更三停（门一范围 / 门二方案 B 档「时间分档」/ 门三交付），详见 `docs/方案-dsh-turn-cost.md` 变更记录 #15。
  - **0.5.0 已开发、部署、门三确认并推送（2026-09-02，单位机）**——见 `CHANGELOG.md` [0.5.0] 与变更记录 #14。
- **下一步唯一动作**：**npm 发布与单位机部署暂缓**（机主门三拍板「只推送，暂不发版部署」）——需要时按序执行：`npm publish`（触发 2FA 网页认证，须机主在能点网页的终端跑）→ 单位机安装副本更新（`npm pack` 后覆盖 `~/.dsh/profiles/web/node_modules/dsh-turn-cost` 的 `lib/`+`package.json`，**保留** profile `cordis.patch.yml` 里的 `ratesPath` 覆盖）→ 重启 dsh web（会中断当前会话）。部署后待定：单位机 `~/.dsh/turn-cost-rates.json` 里 2026-09-10 临时加的三条 flash 覆盖应删除（它们没有 `history`，会顶掉内置历史档，导致切点前旧会话仍被按新价重算）。另：待机主安排其他机器（家用机/笔记本）部署 0.5.x；官方 `deepseek-v4-pro` 于 2026-09-14 12:00 路由到 V4.1 Flash 的切价需再走一轮维护。
- **阻塞**：无
- **验证命令与结果**（提交态入口，不依赖 package.json scripts）：
  - `node --test` → **70/70 PASS / 0 FAIL**（exit 0；0.5.0 为 65 项，本轮 +5 组价表分档用例）
  - `.\maintenance.ps1 verify` → **6/6 PASS**（vendor-integrity / ps-syntax-bom / node-tests 70 / versions-equality / windows-fixture / privacy-scan），退出码 0——2026-09-10 单位机实际运行；首轮曾 FAIL 两项（bump 版本漏改 `package-lock.json`），已修后复跑全绿
  - `node --check`：`lib/fold.js`、`lib/index.js`、`lib/client.js`、`lib/quota.js` 全过
  - **真日志抽查**（只读，本机 306 会话）：① 本会话（切点后）新卡计价与手算吻合（turn1 `55655×2.0 + 253952×0.04 + 9047×8` 每百万 = ¥0.1938）；② 全量扫描 296 个切点前会话 / 357.6 MB，53 个含 flash 样本 → 分档表 ¥99.6416 vs「只换数字」错做法 ¥65.8701，**避免历史失真 ¥33.77**
- **已验证机器**：单位机（0.5.1 开发 / 门禁 / 真日志抽查，2026-09-10）；家用机（0.4.2 门三）；单位机（0.5.0 开发 / 门禁 / 部署 / 四条链路实测 / 机主目检 + CI 修复，2026-09-02）
- **本机专属依赖**：node v24.18.0 / npm 11.16.0（家用机）；单位机 node 同源可跑门禁；dsh 宿主（单位机由 PowerShell 循环自动拉起、3080 常驻 → 升级只能走手动部署，见 tool-library `machines/单位机.md` 与方案 #14）；Kimi loopback 服务 / `bl` CLI 仅为额度功能的可选依赖
- **不可同步数据**：`node_modules/`；个人费率表（若有）；`evidence/` 实机验收原始报告（脱敏后也不入库）
- **推送状态**：0.5.1 提交 `5e7327e` + `0242c9b` **已推送**（2026-09-10，机主门三拍板「只推送」；`1b56df2..0242c9b`）；GitHub Actions Test workflow run **#21 双 job 全绿**（ubuntu-latest `npm ci + host/config + tests` success；windows-latest `unified maintenance verify` success）。**npm 发布与单位机部署按机主决定暂缓**——推送仅凭机主明说「推送」，这两项另行发话。
