# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威（里程碑快照在 tool-library `projects/README.md`，仅为静态快照）。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。

- **当前分支**：master
- **state_based_on_commit**：`546fc59`（0.5.2 适配 DSH 会话格式 V3 的版本化日志文件名；**未推送**）
- **dirty**：无（工作区干净）
- **最近完成**：
  - **0.5.2 + K3 双层复检通过（2026-09-11，家用机）**——机主要求把本轮普通变更升级为全量复检：机器验（`node --test` 73/73、`maintenance.ps1 verify` 6/6、tool-library `checks.py` C1–C6/C8/C9 PASS、C7 WARN、C-bat/C-js 两项 FAIL 经核为既有问题）＋独立模型审（DSH 隔离 subagent 后端 + `kimi-coding/k3` 路由；本串为 standard preset、无 `subagent_codex`，按 `docs/开发流程.md` 未裸调 `codex exec`）→ 结论 **「通过」**，无阻断项；审阅方另给 3 条不阻断观察（`sessionLogBaseName` 为对外 helper 而非内部调用、符号链接日志理论行为差异、仓外 `ledger_dsh.mjs` 同源缺口）。K3 两层结果留档于 tool-library `docs/调研-DSH-0.1.5升级影响面-2026-09-10.md` 追加记录第 3 轮。
  - **0.5.2 会话格式 V3 文件名适配（2026-09-11，家用机）**——本机 DSH 于当日 00:52 由 `0.1.2-rc.1` 升级到 `0.1.5-rc.1`，会话数据格式升至 **v3**，日志名由 `session.jsonl.zstd` 变为 `session.v<N>.jsonl.zstd`；本插件把裸名硬编码在 `findSessionFile` / `listSessions` 两处 → **升级后新建会话的成本与 quota 本地计数全部失源**（枚举静默少列、按 id 查返回 undefined）。修法：新增并导出 `sessionLogBaseName(generation)` 与 `pickSessionLogName(sessionDir, suffix)`（读目录、认两代命名、**取最高版本**；一个会话目录仍只产出一条记录，迁移会话 v0 原件 + v3 新件并存时取 v3，不重复计数；未来 v4 由同一正则兼容），两处调用点改用它。流程=普通变更（机主一句话对齐范围；同步做了代码修复 + 打包部署 + 宿主重启），详见 `CHANGELOG.md` [0.5.2]。
  - **0.5.1 官方 Flash 重定价适配（2026-09-10，单位机）**——官方 2026-09-10 12:00 北京时间调价：V4.1 Flash 发布、`deepseek-flash` 成规范名，两个退役 id 由 V4.1 Flash 兜底服务并按新 Flash 价计费。内置 `OFFICIAL_CNY` 改新价（高峰 2.0 / 0.04 / 8.0，空闲 1.0 / 0.02 / 4.0 元每百万 token），新增 per-model `history` 历史档 + `effectiveRateEntry()` 选档 → **切点前的历史样本仍按 2026-08-17 旧卡计价，不被新价重算**；`deepseek-v4-pro` 价未动并标注官方 09-14 12:00 路由切价待办。流程=高风险变更三停（门一范围 / 门二方案 B 档「时间分档」/ 门三交付），详见 `docs/方案-dsh-turn-cost.md` 变更记录 #15。
  - **0.5.0 已开发、部署、门三确认并推送（2026-09-02，单位机）**——见 `CHANGELOG.md` [0.5.0] 与变更记录 #14。
- **下一步唯一动作**：**推送 0.5.2**（`546fc59` + `5a506c2` → origin/master；推送仅凭机主明说「推送」；K3 双层复检已通过，推前无待办）→ 之后按需 `npm publish`（触发 2FA 网页认证，须机主在能点网页的终端跑）与单位机部署（`npm pack` 后覆盖 `~/.dsh/profiles/web/node_modules/dsh-turn-cost` 的 `lib/`+`package.json`，**保留** profile `cordis.patch.yml` 里的 `ratesPath` 覆盖，随后重启 dsh web）。另：官方 `deepseek-v4-pro` 于 2026-09-14 12:00 路由到 V4.1 Flash 的切价需再走一轮维护；`sessionLogBaseName` 与扫描正则的双份真相留待下次升版合并。
- **阻塞**：无
- **验证命令与结果**（提交态入口，不依赖 package.json scripts）：
  - `node --test` → **73/73 PASS / 0 FAIL**（exit 0；0.5.1 为 70 项，本轮 +3 组命名两代/混合目录/v3-only 用例）——2026-09-11 家用机实际运行
  - `.\maintenance.ps1 verify` → **6/6 PASS**（vendor-integrity / ps-syntax-bom / node-tests 73 / versions-equality / windows-fixture / privacy-scan），退出码 0——2026-09-11 家用机实际运行
  - `node --check`：`lib/fold.js`、`lib/index.js`、`lib/client.js` 全过
  - **真日志抽查**（只读，本机 367 会话 / 12 个 vN 版文件）：① 重启后新建会话（v3-only）`findSessionFile` 命中 `session.v3.jsonl.zstd`；② 当前会话 100 个样本**全部可计价**，`costOfSession = 0.859298 CNY`（`deepseek-flash`，0.5.1 内置新价在部署后生效）；③ v0+v3 并存的迁移目录取到 v3，未重复计数
  - **部署与生效**：`dsh-turn-cost-0.5.2.tgz` 已部署进 `~/.dsh/profiles/web`（`file:` 依赖改指该 tgz），宿主已重启（PID 24280，`0.1.5-rc.1`，2026-09-11 01:11:31 起），重启后新会话可读可计价
- **已验证机器**：家用机（0.5.2 修复 / 门禁 / 真日志抽查 / 部署 / 宿主重启生效 / K3 双层复检，2026-09-11）；单位机（0.5.1 开发 / 门禁 / 真日志抽查，2026-09-10）；家用机（0.4.2 门三）；单位机（0.5.0 开发 / 门禁 / 部署 / 四条链路实测 / 机主目检 + CI 修复，2026-09-02）
- **本机专属依赖**：node v24.18.0 / npm 11.16.0（家用机）；单位机 node 同源可跑门禁；dsh 宿主（单位机由 PowerShell 循环自动拉起、3080 常驻 → 升级只能走手动部署，见 tool-library `machines/单位机.md` 与方案 #14）；Kimi loopback 服务 / `bl` CLI 仅为额度功能的可选依赖
- **不可同步数据**：`node_modules/`；个人费率表（若有）；`evidence/` 实机验收原始报告（脱敏后也不入库）
- **推送状态**：0.5.2 提交 `546fc59` + `5a506c2` + `e9b91b0` **已推送**（2026-09-11，机主明说「推送」；`7b1bab2..e9b91b0`），GitHub Actions Test workflow run **#22 双 job 全绿**（`npm ci + host/config + tests` 13s success；`Windows unified maintenance verify` 42s success，与本地同一入口）。**npm 未发布**（npm 上仍是 0.1.3）。**交接提示**：家用机的「启动 DSH（含额度）」启动器 `state.json` 已由 `isolated-pnpm` 固定副本（0.1.1-rc.2）改为指向 npx 缓存（`kind: npx-cache`，node + `_npx\...\dsh\lib\bin.js`），故该路径今后随 npx 缓存版本走；单位机未做此改动。
