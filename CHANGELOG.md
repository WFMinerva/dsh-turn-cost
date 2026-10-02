# Changelog

本文件按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 维护，版本号遵循语义化版本。

## [0.6.2] - 2026-10-03

**主题：补齐中国法定节假日的全天闲时规则——0.6.1 的 `isPeak` 只认周末，把 2026-10-01 10:00、10-02 15:00、10-05 10:00 这类时点错判为高峰。**

### Fixed

- **法定节假日全天按空闲价**（官方定价页脚注 2，2026-10-03 实抓）：「北京时间周一至周五（**不含中国法定节假日**）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段」。0.6.1 只给周末开了例外，**工作日假期**的 9:00–12:00、14:00–18:00 仍按高峰计价——一律偏高。
  - 新增 `STATUTORY_HOLIDAY_RANGES` / `STATUTORY_HOLIDAYS` / `isStatutoryHoliday(ms)`，数据源《国务院办公厅关于2026年部分节假日安排的通知》（国办发明电〔2025〕7 号，2025-11-04 发布）：元旦 1/1–1/3、春节 2/15–2/23（**9 天**）、清明 4/4–4/6、劳动节 5/1–5/5、端午 6/19–6/21、中秋 9/25–9/27、国庆 10/1–10/7，共 33 天。
  - **调休上班的周末仍按空闲价**：`MAKEUP_WORKDAY_WEEKENDS`（1/4、2/14、2/28、5/9、9/20、10/10）只作审计记录，**计价不读它**——周末规则已让它们全天空闲，拿它建工作日日历会把官方明确按空闲价计费的日子算成高峰。
  - 生效边界 `HOLIDAY_OFF_PEAK_EFFECTIVE_MS = 2026-09-19 00:00 北京时间`（周末规则 2026-08-23、峰谷机制 2026-08-17 的既有边界不动）；生效点前保留当时规则，**历史金额不被重算**。
- **清除失效的 Pro 注释**：`deepseek-v4-pro` 条目里「自 2026-09-14 12:00 起路由到 V4.1 Flash 并按 Flash 价计费」与官方不符——2026-09-10 官方更新日志原文为「我们决定在 2026 年 9 月 14 日之后继续提供 DeepSeek V4 Pro 的 API 调用服务，**计费方式保持不变**」，2026-10-03 实抓定价页也仍把 `deepseek-v4-pro` 列为 V4-Pro-0813、按 Pro 价（高峰 9.0 / 0.3 / 27.0、空闲 4.5 / 0.15 / 13.5）计费。**该切价不存在，无需编码**；`docs/DEVELOPMENT.md` 的同条待办一并撤掉并记下教训。

### Added

- `test/fold.test.mjs` **+5 组（86 → 91 项全绿）**：① 表保真——逐区间、33 天总数、区间不重叠、调休日全在周末且不在节假日表内；② 机主报的三个误判时点，加中秋/国庆每个高峰窗口整点全天空闲；③ 调休周末——生效点后的 9/20、10/10 全天空闲，生效点前的 1/4、2/14、5/9 保留当时的每日峰谷规则；④ 生效边界与普通工作日——节前最后一个工作日、假期最后一刻、假后首个工作日、假期之间的工作日；⑤ 假期→工作日跨档按每步时点计价，并断言 Pro 价未受假日规则影响。
- **分歧窗口不变式用例**：遍历全部 33 个假日，断言每个要么整体早于峰谷机制起始（2026-08-17），要么整体不早于 `HOLIDAY_OFF_PEAK_EFFECTIVE_MS`——即「节假日子句生效时刻」的两种读法对 2026 年任何一天都没有差别；将来补表时若出现落在分歧窗口里的假日，用例先失败，逼回官方源核实。

### Notes

- **核实到哪一步、哪一步确认不了**：DeepSeek 只在定价页写口径、**不给节假日子句的生效时刻**（官方更新日志（`/zh-cn/updates`）无对应条目，`/zh-cn/news/news260919` 不存在，只有 2026-09-19 的媒体报道）。本实现取公告日 2026-09-19 00:00；该选择**不可观测**——2026 年的法定假期要么整体早于峰谷机制（元旦/春节/清明/劳动/端午），要么整体晚于该常量（中秋/国庆），上述不变式用例把这条钉住。另：2026 年春节官方通知是 **2/15–2/23 共 9 天**，媒体报道摘要里的「8 天」与该通知不符，以 gov.cn 原文为准。
- **2027 年及以后未收录**：次年安排尚未公布。未收录年份里的法定节假日会按普通工作日计价（偏高），属**已知边界**；国务院公布后按 `docs/DEVELOPMENT.md` §三 补表（含补测试）。
- **修正前后差额（真实数据，本机 887 个会话 / 630 MiB / 34823 个已计价步）**：
  - 全机：0.6.1 = 0.6.2 = **¥632.51587032**，**差额 ¥0.00000000**，窗口判定发生变化的步数 **0**。
  - 本会话 `session-4a4f6dfb-…`（643 步，全部落在 2026-10-03 **周六** 03:19–05:12）：**¥7.35674600 → ¥7.35674600，差额 ¥0.00000000**；其中 turn 1–4 与 0.6.1 发布包验证时的逐轮读数**逐位相同**（2.52076228 / 1.80360808 / 1.65231392 / 0.43785796），证明修正没有改写历史。
  - **差额为 0 的原因（不是规则没生效）**：全机 7279 个样本落在假期日（9/25、9/26、9/27、10/1、10/2、10/3），其中 3102 个是**已计价**样本、**没有一个**落在高峰窗口内（本机已计价流量集中在 00:00–06:00 北京时间，本就是空闲价）；真正落在高峰窗口内的假期样本有 **644 个**，全部是**无单价的订阅路由**（`kimi-coding/k3` 498 个、`zai-coding-cn/glm-5.3` 146 个），0.6.1 本来就没为它们计价，0.6.2 同样不计价。
  - **缺陷的金额量级**（同一批 644 步、10834 万 token，若走内置 DeepSeek Flash 卡）：0.6.1 高峰 **¥13.07089960** vs 0.6.2 空闲 **¥6.53544980**，**多算 ¥6.53544980（恰 50%）**。机主举的三个时点里，10-01 10:00（12 个样本）与 10-02 15:00（42 个样本）在本机真实日志中存在、且都命中该缺陷；10-05 10:00 本机无样本，仅作规则示例。
- 版本：`package.json` / `package-lock.json` 0.6.1 → **0.6.2**（patch）；**已发布的 0.6.1 未被改写**。
- 发布记录（2026-10-03）：提交 `e13fe3d` → CI `Test` run 37065886501 ✓ → `npm publish` 经机主完成 2FA 后得 `dsh-turn-cost@0.6.2`（`dist-tags.latest = 0.6.2`、`shasum 2799f424d162372b0ad42e4d7e75966c1f8fc0b0`，与发布前 dry-run 指纹**逐位一致**）。已发布包在隔离宿主里用官方 `dsh plugin --profile <名字> add dsh-turn-cost@0.6.2` 安装（**registry 安装、非 `link:`**），10 个文件与仓库逐文件 SHA256 全部 MATCH；对同一条真实会话（681 步）复算 `turnCost/sessionTotals = 7.70550156`，逐轮 `2.52076228 + 1.80360808 + 1.65231392 + 0.43785796 + 0.44086068 + 0.24160248 + 0.60849616` 恰等，`{messageId}` 与 `{turn}` 定位同值，并与仓库 `lib/fold.js` 的独立重算逐项相同。`lib/client.js` 与 0.6.1 **逐字节相同**（本轮只改宿主半，界面层未重新目检）。npm 页面 README 随之更新为新的 93 行版本。

## [0.6.1] - 2026-10-03

**主题：修掉「界面只显示 token、金额恒为 `?`」的真因——它不在费率表，而在会话日志的读取方式。**

### Fixed

- **`foldFor` 的自建 live 路径读的是不存在的字段，导致所有已打开会话的费用恒为空**（真因，实测定位）：
  - `Session` 的事件存在**私有 `log`** 里，对外只有官方访问器 **`snapshotEvents()`**；`Session` **没有 `events` 属性**（见 `packages/session/session` 的 `class Session`：`log = []`、`get seq() { return SessionLogOffset(this.log.length) }`、`snapshotEvents(fromSeq, toSeqExclusive)`）。
  - 0.6.0 的解析顺序把「live 内存日志」放在第一位并读取 `live.events` → 恒为 `undefined` → 按空日志折叠 → `costOfSession([])` 返回 `null`。于是**只要该会话被 UI 打开（正在使用时必然如此）**，`turnCost/query` 与 `turnCost/sessionTotals` 都返回 `null`；未被打开的会话走官方读取反而正常——这就是「历史会话能算、正在用的会话算不出」的不对称。
  - **不再自建 live 路径**：完整日志一律取自官方 `ctx.sessionQuery.readSession(sessionId)`（官方口径即 **live 优先**：内存中的会话由 `snapshotLive()` → `session.snapshotEvents()` 给出，历史会话由持久层给出，两者都是脱离副本 + 重放校验）。只有**没有** `sessionQuery` 后端、或官方读取抛错时才回退自扫日志；该兜底的 live 合并同样改用 `snapshotEvents()`。
  - 缓存改为**只用来省掉重复读取，绝不作为数据来源**：`ctx.sessions.get(id).seq`（官方契约 `seq === log.length`，零 I/O）未变则复用缓存折叠；读回的日志 `sessionLogSignature`（事件数 + 最大 `seq`）相同则复用上一个折叠，而不是重新计价 447 步。删除了原先自造的 `logMovedPast` 签名解析。

- **每轮徽章此前根本不渲染**（同轮实测发现）：它用 `useSession` 在浏览器里遍历 `snapshot.chat.nodes` 反推「这条消息属于第几轮」，字段形状是猜的，实测恒为 `null`。现在把槽位属主给的 **`messageId`** 直接交给宿主，由宿主在自己的事件日志里把消息 id 映射到 `turn`（`messageTurnsOf`）——浏览器不再重复推导对话树。`turnCost/query` 因此同时接受 `{ turn }` 与 `{ messageId }`。

- **客户端不再吞掉查询失败**（机主指出的问题：显示统计条不代表费用查询成功）：
  - `rpc()` 不再把一切失败折叠成 `null`，而是返回 `{ ok:false, code, message }` 并 `console.warn` 出网关的**稳定错误码**；成功返回 `{ ok:true, value }`。
  - 读数条区分四种状态并各自说明：宿主给出数字（`模型名 · 本会话 ¥X · …`）／**查询失败**（`费用查询失败 · …`，悬停标题含错误码）／宿主答「该会话没有可计费用量」（`未计费 · …`）／仍在查询（`查询中 · …`）。此前失败时会**借用官方统计条的 token 数**渲染成一行看似正常的读数，这正是「看起来在工作、其实没算」的来源。
  - 会话切换立即查询（不再等 1.2 s 防抖），避免流式输出期间投影持续变化把首次查询无限推迟。
  - 缓存读比例不再把真实的未命中四舍五入成整 `100%`（99.65% 现在显示 `99.6%`，与官方统计条一致）。

### Added

- `test/session-source.test.mjs` 的**回归用例与官方形状夹具**：假会话现在只暴露官方访问器（私有 `log` + `snapshotEvents()` + `seq`），并显式断言 `"events" in session === false`——直接用 `events` 数组的旧夹具正是这个缺陷逃过测试的原因。新增 `{ messageId }` 定位、空 live 会话不编数、折叠签名与 `messageTurns` 形状等用例（共 11 项）。
- `test/client-quota.test.mjs` 新增四个诚实性用例：失败时徽章**什么都不渲染**、成功时渲染金额行、读数条**绝不把官方 token 当作自己的金额**（失败／未计费／查询中三种文案各自带错误码或说明）。

### Notes

- 0.6.0 从未提交、从未发布，其 tarball 已被本版取代；0.6.0 changelog 里「live 内存日志最权威」的说法**是错的**，本版更正。
- 发布记录（2026-10-03）：提交 `29b38d8` → CI `Test` run 37062612009 ✓ → `npm publish` 得 `dsh-turn-cost@0.6.1`（`dist-tags.latest = 0.6.1`，`shasum 28425d80bae4ce68e46384962f4a4191a42f5a36`，与发布前 dry-run 指纹一致）。已发布包在隔离宿主里用官方 `dsh plugin --profile <名字> add dsh-turn-cost@0.6.1` 安装（**registry 安装，非 `link:`**），对同一条真实会话复算：逐轮 `¥2.52076228 + ¥1.80360808 + ¥1.65231392 + ¥0.43785796 + ¥0.19982028 = ¥6.61436252`，恰等于 `turnCost/sessionTotals` 的会话汇总；界面读数与之一致。桌面 profile 的本地 `link:` 安装未被替换。
- 实测证据（同一真实会话 `session-4a4f6dfb-…`，447 步）：三档 token 分桶逐项相加恰等于会话汇总（`578756 + 278308 + 163934720 = 164791784`，即读数条的「16479万 token」），三轮费用 `¥2.5208 + ¥1.8036 + ¥0.6463 = ¥4.9707` 恰等于会话汇总；模型名读自日志（`deepseek-flash`，provider `deepseek-account`）。徽章与读数条显示值与原始 RPC 返回逐项一致。

## [0.6.0] - 2026-10-03

**主题：把项目整理成能通过官方「添加插件」直接接入的标准插件，删掉官方已负责的一切重复实现。**

### Changed

- **接入方式唯一化**：只认官方机制——`dsh plugin --profile <name> add <npm 包名 | github:owner/repo | 本地目录 | tarball>`，或应用内侧边栏「插件」页的**添加插件**。官方会自己完成安装、依赖解析、把包名追加进 `dsh.profile.bundles`、profile 补丁分层，以及卸载时的注册清理；**不再手写 profile 清单，也不再重建安装器**。
- **peer 模型改为官方推荐形态，彻底消除兼容性判定面**：宿主提供的包（`@deepseek-ai/cordis`、`dsh-home-paths`、`dsh-typert-protocol`）在 `peerDependencies` 里声明为 **`"*"`**。`"*"` 对任何版本都成立，所以 **dsh 的兼容性门禁不可能再因版本区间拒载本插件**——0.5.2 的 `^0.1.0-rc.6` 正是被 0.2.0-rc.2 整包拒载的原因，而 0.5.3 用的「猜一个够宽的上界」只是把同一个陷阱推迟。被复核过的**精确**版本改由 `devDependencies` 记录（`cordis@4.0.4`、`dsh-home-paths@0.2.0-rc.2`、`dsh-typert-protocol@0.2.0-rc.2`，与桌面运行时逐项一致），本地测试因此直接跑在真实宿主版本上。此形态与本机官方可安装参考件 `dsh-notion` 一致。
- **`tools/peer-compat.mjs` 重写**：不再自造「支持的版本窗口」，改为守住 peer 模型（`"*"` peer + 精确 dev pin + pin 必须等于已复核版本），范围数学**全部交给标准 `semver` 包**并使用官方同款 `{ includePrerelease: true }`。上一版自实现的 semver 在「`^` 基数本身是预发布」与「上界与预发布比较」两处与标准库不一致。
- **`lib/index.d.ts` 新增（手写声明）+ `types` 字段**：实现是纯 JS，故声明手工维护；包因此具备与官方可安装插件一致的入口/类型契约（`main: lib/index.js`、`exports["./client"]`、`types`）。
- **`package.json` 对齐可安装 bundle 形态**：补 `engines`（`^22.19.0 || >=24.0.0`）、`packageManager`、关键词 `dsh-plugin`；`files` 增补 `README.md`；scripts 收敛为 `test` / `check`。
- **README / AGENTS.md / docs/DEVELOPMENT.md 重写**：清除全部失效指令（一键包、`maintenance.ps1 verify/acceptance`、固定 3080、`profiles/web` 假设、安装器验收表），改为官方接入方式 + 官方三层验证表（组合 / host 挂载 / client 注册）。
- **CI 简化**：删除 `windows-installer` job（它跑的是已删除的 `maintenance.ps1 verify`），只保留 `npm ci` + `npm test` + `npm run check` + peer 模型检查。

### Removed

- `installer/`（15 文件：一键安装/启动/回滚/卸载 + 固定 CLI lockfile）、`scripts/build-windows-installer.ps1`
- `versions.json` 与派生的 `installer/dsh-package*.json` / `tools-package*.json`——**固定宿主版本**这一做法本身被废弃
- `maintenance.ps1`、`maintenance/`、`vendor/maintenance/`（+ `vendor/manifest.json`）
- `test/windows-installer.test.ps1`、`test/installer-contract.test.mjs`
- `evidence/example-report.json`（`acceptance` 链已删除）
- 仓库根的 `peerDependencies` 精确区间模型与 0.5.3 的 `REVIEWED_MINOR_LINES` 机制

> 删除理由与「读旧文档时该忽略什么」见 [`docs/迁移说明-0.6.0接入方式.md`](./docs/迁移说明-0.6.0接入方式.md)。`docs/方案-dsh-turn-cost.md` 里的**计费口径 / 费率分档 / 额度归因边界 / 隐私边界**等设计决策仍然有效。

### Fixed

- **`foldFor` 的解析顺序与缓存语义**（行为测试发现的两个真实缺陷）：① 官方路径此前**每次调用都重读持久历史**，缓存只省下折叠而没省下读取；② 缓存只在 live 路径被查询，而一处已被缓存的**不可变**折叠会在该会话重新变为 live 后被继续沿用。现在顺序为「live 内存日志 → 官方 `ctx.sessionQuery` → 日志扫描兜底」，并用 `session.seq`（live 日志自身长度，零 I/O）与缓存的 `sq:<n>:<seq>` 签名比较来决定是否重读；签名形状不认识的一律重读，宁可多读不冒陈旧风险。

### Added

- **真实服务行为测试**（`test/session-source.test.mjs`，9 项）：用最小 Cordis 上下文实例化真实 `TurnCostService` 并**实际调用** `foldFor` / `sessionTotals` / `query`，覆盖官方 `sessionQuery` **正常**、**缺失**、**读取抛错**三条路径，以及 live 缓存/增长、无 usage 返回 null、非法 sessionId 拒绝、卸载后缓存清空。此前的用例只断言源码字符串，不能证明官方服务路径真的工作。
- `docs/迁移说明-0.6.0接入方式.md`：本轮删除清单、理由、以及旧文档的有效/失效边界。

### Notes

- **验证证据（2026-10-03，家用机，桌面宿主 0.2.0-rc.2）**：`npm test` **80/80 PASS**；`npm run check` 四个 `lib/*.js` 全过；`git diff --check` 干净；`node tools/peer-compat.mjs --runtime 0.2.0-rc.2` exit 0。
  - **官方安装路径（真实宿主，官方 Plugin Manager）**：`plugin_manager install_bundle` → `application: "applied"`，装成 `link:` 并自动追加进 `dsh.profile.bundles`。
  - **host 半真正挂载**（官方 Inspect Provider）：`Config.listConfigs` 出现 `include:turn-cost` → `status: "schema"`、`packageDir` 指向该 profile 的 `node_modules\dsh-turn-cost`、并投影出插件自己的 Config JSON Schema。
  - **client 半真正注册**（官方 client Inspect Provider）：`Slots.listSubTree {"root":"conversation.chat.assistant-actions"}` 的 `occupants` 里出现 `{ id: "turn-cost", active: true }`，与官方 `feedback` 并列。
  - 验证用的安装已 `remove_bundle` 卸载，`profiles/desktop/package.json` 已回到安装前内容，遗留 junction 已删除；**未改动、未重启正在使用的宿主**。
- **未验证项**：界面渲染**未人工目检**（组件已注册进官方槽位 ≠ 看起来对）；Kimi/阿里两条订阅额度读数本轮未实测。详见 `CURRENT_STATE.md`。
- **上一版（0.5.3）的隔离宿主「未挂载」结论已更正**：那是我自建 harness 的缺陷——`dsh plugin add` 在空 profile 上只装入 `dsh-base` + 本插件，**该 profile 没有宿主/客户端应用层**，所以什么都不挂载；补装 `dsh-web-app` 时又被 pnpm 构建脚本策略拦下，从未构成有效应用组合。早前那轮用 `--patch` + 绝对路径的做法，按官方文档只是**仓库内教程式**开发回路，从来不是第三方插件的接入路径。

## [0.5.3] - 2026-10-03

### Fixed

- **修复 DSH 0.2.x 拒载（`incompatible-version`）**：插件 `peerDependencies` 里的 `@deepseek-ai/dsh-home-paths` / `@deepseek-ai/dsh-typert-protocol` 此前钉在 `^0.1.0-rc.6`，而官方 dsh 自 0.2.0 起在启动与安装时用 semver 校验这些 peer，不满足即**整包拒载**（`Error: Plugin dsh-turn-cost@0.5.2 is incompatible with dsh 0.2.0-rc.2`，需 `dsh plugin allow-version` 豁免才能起）。桌面应用升级到 `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2` 后，插件实际处于「装着但起不来」状态。
  - 两个 peer 范围改为 `>=0.1.0-rc.6 <0.3.0-0`：下界保持 0.1 线可装，上界用 `-0` 预发布哨兵——官方按 `includePrerelease` 求值，普通的 `<0.3.0` **会放进 `0.3.0-rc.1`**（已对本机运行时的 semver 7.8.5 实测确认），加 `-0` 才真正排他。
  - 宿主侧 API 未变更：`dshHomePath`、`Remote`、`TypertRemoteService`、`Service`、官方 slot `conversation.chat.assistant-actions` / `conversation.composer.dock` 在 0.2.0-rc.2 全部存在（逐个核对运行时导出与实时 slot 树）。

### Changed

- **会话历史改走官方 `ctx.sessionQuery`**：host 端折叠一个会话时先用官方会话查询服务（`readSession(id).events`，live 优先、带重放校验、返回脱离副本），不再自行解析 `<dsh-home>/sessions/**` 的 zstd 多帧 JSONL 与日志文件名。日志命名代次（v0/v2/v3/v4…）、压缩格式与「持久日志 + 运行中会话」的合并从此归宿主维护——0.5.2 修的 V3 文件名适配就是这类漂移的一次实例。
  - 新增纯函数 `foldSessionEvents(events)`：把官方事件日志折成与日志扫描完全相同的 `{ signature, samples, title }`，两条来源共用一个折叠实现（单测断言二者逐样本相等）。
  - 缓存签名由 `size:mtime` 改为 `sq:<事件数>:<最大 seq>`，不再依赖文件系统元数据。
  - `static inject` 收回到 `["sessions"]`：`sessionQuery` 由后端插件挂载，写进 inject 会让「没有该后端」的组合把整个插件挂住，而那正是兜底路径要服务的场景（官方口径：可选依赖用 `ctx.get()` 在调用点取，不进 inject）。
  - **保留最小必要兜底**：组合里没有 `sessionQuery` 后端、或官方读取抛错时，仍回退到原日志扫描（`foldFromLog`）；两条路径都有单测，官方读取失败不会让读数变空。

### Added

- **交付门禁新增 `peer-compat` 步骤**（`maintenance.ps1 verify` 第 3 项）：`tools/peer-compat.mjs` 对本机每个已知 DSH 运行时版本判定插件的 `@deepseek-ai/dsh*` peer 范围。
  - **范围数学全部交给标准 `semver` 包**，并使用与官方完全相同的选项 `{ includePrerelease: true }`；本文件不再自实现 semver。之前的自写实现在「`^` 基数本身是预发布」与「上界与预发布比较」两处与 semver 不一致，已由此消除（`test/peer-compat.test.mjs` 里有一条差分断言，逐例对照 `semver.satisfies`）。
  - 判定器：`semver.subset` 校验声明的区间**恰好等于**已复核窗口 `>=0.1.0-rc.6 <0.3.0-0`（收窄、放宽都 FAIL），并保留 `REVIEWED_MINOR_LINES = ["0.1","0.2"]` 作为「人工已复核的次版本线」清单——出现未复核的运行时线即 FAIL，而不是静默放过。
  - **发现不到任何运行时版本时返回 FAIL**（可用 `--runtime <版本>` 补，例如正在运行宿主的 `dsh --version`）：未验证的 peer 窗口不算通过，不再是「没找到就 PASS」。
  - 单测 8 项覆盖：0.5.2 现场回归、`0.3.0-rc.1` 必须被拒（含「`<0.3.0` 在 includePrerelease 下会放过它」的反证）、区间收窄/放宽必须 FAIL、无运行时必须 FAIL、与 `semver.satisfies` 的逐例一致性。

### Notes

- **不改宿主、不动部署副本**：`versions.json` 的安装器固定版本仍是 `0.1.1-rc.2`（**未同步到 0.2 线**，因为 Windows 一键包/验收链尚未对 0.2 运行时重建验证）；本版只把插件的兼容范围写实，使 0.1 与 0.2 两条线都能装。
- **`versions.json` 与正在使用的宿主已脱节**：本机桌面应用携带 `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`，而安装器固定的是 `0.1.1-rc.2`。下一次一键包发布前需重新固定并重跑 `sync-versions` + 验收。
- 官方**没有**任何价表/成本/余额服务（子系统索引与 `packages/llm` 均无；`dsh-token-meter` 明说其数值「是参考值、不是账单」），因此内置费率卡与本地 `rates.json` 叠加**继续保留**——这是官方缺口，不是重复建设。`dsh-token-meter` 的估算口径也不能替代 provider 上报的逐桶 usage，故计价原料仍取 `assistant/message` 的 `usage`。
- 验证（2026-10-03，家用机）：`node --test "test/*.test.mjs"` **85/85 PASS**；`maintenance.ps1 verify` **7/7 PASS**（新增 peer-compat）；`node --check` 四个 `lib\*.js` 全过；只读真日志抽查 **885/885** 个会话目录可枚举（v0 353 / v3 313 / v4 219），`foldSessionEvents` 与日志扫描结果逐样本一致；兼容性由**运行时自身的** `evaluatePluginCompatibility` 前后对照判定（旧 peer 块 REJECTED → 新 peer 块 COMPATIBLE）。
- **隔离宿主端到端（部分通过，未完成）**：在临时目录装官方 `@deepseek-ai/dsh@0.2.0-rc.2` 建独立 `DSH_HOME`，用官方 `dsh plugin --profile t1 add <tgz>` 装本包 —— **通过**（写到 `dependencies: file:...tgz`、`dsh.profile.bundles` 追加 `dsh-turn-cost`、装到 0.5.3、`--dump-config` 组合出 `turn-cost` 行且无 `incompatible`/`skipping` 告警）；`dsh web` 起在该隔离宿主上**返回 200**。但该隔离宿主的 boot 图里**没有** `dsh-turn-cost` 客户端条目，且插入的探针行也没被执行 → **判定「隔离宿主里插件未真正挂载」，原因未查明**（该 profile 缺 `@deepseek-ai/dsh-web-app` 的 bundle 层、命令转发/加载器行为差异等均为未排除假设）。**因此本版不声称端到端验证通过**；真实宿主目检仍是未验证项，见 `CURRENT_STATE.md`。

## [0.5.2] - 2026-09-11

### Fixed

- **适配 DSH 会话格式 V3 的版本化日志文件名**（dsh 0.1.5-rc.1 于 2026-09-11 00:52 在本机落地）：会话日志自 v2 起由 `session.jsonl.zstd` 改为 `session.v<N>.jsonl.zstd`，本插件此前把裸名硬编码在 `findSessionFile` / `listSessions` 两处 → 升级后**新建会话的成本与额度读数全部失源**（`listSessions` 静默少列、`findSessionFile` 返回 undefined）。现按「读目录、认两代命名、取最高版本」解析：
  - 新增 `sessionLogBaseName(generation)`（`0` → `session.jsonl`，`N>0` → `session.v<N>.jsonl`）与 `pickSessionLogName(sessionDir, suffix)`（目录内匹配两代命名并偏好最高版本），两者均导出。
  - `findSessionFile` / `listSessions` 改用上述解析；**每个会话目录仍只产出一条记录**，迁移后 v0 原件与 v3 新件并存时取 v3（同一会话不会重复计数）。

### Notes

- 迁移会话目录同时存在 `session.jsonl.zstd` 与 `session.v3.jsonl.zstd` 时，本插件统一读 **v3**（迁移后的权威记录），旧件仅在无 vN 件时回退。实机抽查该两代文件折叠结果一致（183 样本逐样本 0 差异）。
- `sessionLogBaseName(generation)` 是**对外的公共 helper**：生产路径（`findSessionFile` / `listSessions`）走目录扫描、由 `pickSessionLogName` 按正则识别两代命名，函数内不调用它；需要由「格式代」反推文件名（例如已从日志头读到版本号）的调用方可以直接用。K3 独立复检指出它与扫描用正则是同一映射的两处表达，**本版不做就地合并**（会改动已批准且已部署的产物），留待下一次升版顺手消除双份真相。
- 0.1.5 宿主在 Windows 上**不落 `session.lock` 文件**（走内核命名信号量），故目录解析不依赖锁文件。
- 验证：`node --test "test/*.test.mjs"` **73/73 PASS**（新增 3 项：命名两代映射、混合目录偏好最高版本、v3-only 会话可见性）；真机只读抽查——`listSessions` 枚举 366 个会话（含 10 个 vN 版文件），本会话（v3-only）可读且 `costOfSession` 正常出价（0.44499368 CNY / deepseek-flash）。

## [0.5.1] - 2026-09-10

### Changed

- **官方 Flash 家族重定价（2026-09-10 12:00 北京时间生效）**：内置 `OFFICIAL_CNY` 的 Flash 档改为新价——高峰 输入 ¥2.0 / 缓存读 ¥0.04 / 输出 ¥8.0，空闲 ¥1.0 / ¥0.02 / ¥4.0（每百万 token）；`deepseek-v4-pro` 价未变（高峰 9.0 / 0.3 / 27.0）。
- **新增正名 `deepseek-flash`（DeepSeek-V4.1-Flash）**：官方以该 id 作为 V4.1 Flash 的规范模型名；两个退役 id（`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`）仍可调用，但由 V4.1 Flash 服务并按新 Flash 价计费——三个名字同步对齐新价。

### Added

- **内置价表按时间分档（`history`）**：条目可选带 `history: [{ before, peak, offPeak }]`，`before` 之前的样本按旧卡计价、之后按当前卡；新增 `effectiveRateEntry(entry, time)` 选档函数与 `FLASH_REPRICE_EFFECTIVE_MS` 常量。Flash 家族旧卡（2026-08-17：高峰 3.0 / 0.1 / 9.0）作为历史档保留，**历史会话金额不被新价重算**（沿用周末规则"保留历史规则"的既有原则）。
- 用户 `rates.json` schema 不变（version 1）：`history` 是可选增字段；自定义平价/峰谷条目照旧生效，并优先于内置档。

### Notes

- 官方公告：`deepseek-v4-pro` 自 **2026-09-14 12:00 北京时间**起请求全部路由到 V4.1 Flash 并按 Flash 价计费。该切价**本轮未编码**（`lib/fold.js` 内已留注释），留待下一维护轮。
- 验证：`node --test "test/*.test.mjs"` 70/70 PASS、`maintenance.ps1 verify` 6 项 PASS、四个 `lib\*.js` 通过 `node --check`，另做本机真实会话日志抽查（新旧价对照，见 `CURRENT_STATE.md`）。

## [0.5.0] - 2026-09-02

### Removed

- **移除「额度汇总」面板**（会话页头 `conversation.session.header.actions` 的「额度汇总」按钮 + 跨对话合计/按模型/按天三张表）：实测在会话量大的机器上全量枚举 150+ 会话需约 27 秒且客户端无超时提示，用户判定该功能无用。host 端 `turnCost/summary` 端点与 `summaryCache`/`foldEntry` 同步删除；`lib/client.js` 的 `SummaryButton`/`SummaryTable`/`QuotaSection`、`summary.*`/`quota.*` 文案与面板样式一并移除。

### Changed

- **Kimi 徽章与读数条口径改为 7 天周额度 + 加油包余额**：每轮徽章与会话读数条显示「7 天还剩 N 次 · 余额 ¥X」（官方 loopback 实时读数）；不再以 5h 滚动窗口为主读数（5h 窗口仍在 quota 响应中，UI 不再占用主位）。
- **Kimi loopback 服务自动拉起（K2）**：默认端口 `127.0.0.1:58627` 上服务未运行时，插件用 `~/.dsh/turn-cost-tools` 里固定版本的 kimi CLI 自动启动（`kimi web --no-open --port 58627`），只管理自己启动的实例、插件卸载时经官方 `/api/v1/shutdown` 关闭；直接启动 DSH（不经「启动 DSH（含额度）」启动器）也能读到 Kimi 额度。端口被他人占用时不触碰。
- **阿里 bl 默认认死固定路径**：`fetchAliyunQuota` 默认命令优先用 `~/.dsh/turn-cost-tools/node_modules/.bin/bl.cmd`（固定版本、不依赖系统 PATH），未安装时才回退 PATH 上的 `bl`；rates 文件 `quota` 块的 `command` 仍可覆盖。

### Security

- Kimi 服务自动拉起仅在本机 loopback 默认端口、且存在有效 `server.token` 时发生；凭证仍只在本机进程内使用，不打印、不复制、不写入报告或仓库。

## [0.4.2] - 2026-08-25

### Fixed

- **纠正 0.4.0/0.4.1 的 Kimi 额度凭据判断**：模型 API Key 只负责模型调用，不能作为可靠的套餐额度凭据；Kimi 额度恢复为已经在单位机和家用机分别实测通过的 Kimi Code OAuth loopback 路线（`127.0.0.1:58627`）。
- 删除 host 对 DSH `.credentials.yaml` 的额度读取与远程 HTTPS Kimi quota 路径；`kimi-usages` 只接受 loopback `baseUrl`，内置默认显式固定为 `http://127.0.0.1:58627`。
- 日常启动器恢复 Kimi 服务生命周期管理：启动前检查 OAuth token、拒绝占用 58627 的非 Kimi 服务、验证 `/api/v1/meta` 身份，并只关闭本启动器创建的实例。
- 新增“配置额度登录”入口，顺序调用官方 `kimi login` 与 `bl auth login --console --console-site domestic`；不接收、复制或记录 API Key、AK/SK。

### Security

- 安装器仍不读取或修改 DSH `.credentials.yaml`；Kimi loopback bearer 只在启动器/插件进程内用于本机官方服务认证，不写入报告或仓库。

## [0.4.1] - 2026-08-25

### Fixed

- Windows 候选包改用内容寻址 tgz 文件名，并在迁移时保留旧 tgz，避免 profile 的既有 `file:` 依赖在包目录切换期间断链。
- 修复同版本候选被 pnpm 复用旧 `node_modules` 的问题：正式修正版升为 0.4.1，遵守版本不可变原则，确保官方 Kimi API 默认链实际部署。
- 日常启动器不再强制启动/登录 Kimi loopback 服务；默认直接启动 DSH，只有显式配置 loopback 的用户自行管理该可选服务。
- 修复维护验收器把子进程正常日志误当退出码，以及 DSH shim 退出后未能停止真实 3080 监听进程的问题。

## [0.4.0] - 2026-08-25

### Changed

- **Kimi 额度取数双路径**：`kimi-usages` 路由默认走官方 coding API `GET https://api.kimi.com/coding/v1/usages`（凭据从 `.credentials.yaml` 的 `KIMI_CODING_API_KEY` 内存解析，打开即用、无需本地服务）；也可显式配 loopback `baseUrl` 走 Kimi Code 本地 OAuth 服务（`~/.kimi-code/server.token`）。错误码细分为 credential/api/server/output 四类（变更记录 #9）
- **Kimi 徽章口径**：剩余次数直接显示官方读数，不再 ÷limit 换算百分比（5h used=53/remaining=47 直接显「还剩 47 次」，不显 47%）；会话行与汇总面板同步次数口径（变更记录 #8）
- **订阅路由内置**：`kimi-coding` / `qwen-token-plan-cn` 内置默认路由（`builtinQuotaRoutes`），不写 `quota` 块也会尝试读取；费率表 `quota` 块用于覆盖（`credentialRef`/`baseUrl`/`command`/`enabled:false` 关闭）
- `quota.js` 从部署副本入库（`normalizeKimiUsages` / `normalizeKimiLocalUsage` / `normalizeAliyunBl` 三解析器）；`test/quota.test.mjs` 新增 5 项，`test/fold.test.mjs` 新增双路径配置用例（31/31）
- 阿里 Token Plan 仍走官方 `bl usage token-plan` CLI：配一次 `bl auth login --console` + `--open-api`（存 AK/SK）后 console token 自动续期，免手动登录

### Fixed

- 一键安装包 `Install.ps1` 启动即崩（cmd `\"` 转义 + PS 5.1 默认参数坑）——`安装.cmd` 传 `-PackageRoot "%~dp0."`，`Install.ps1` param 后补兜底（变更记录 #7）

### Added

- 统一维护入口 `maintenance.ps1`（通用层来自 tool-library，vendor 快照随仓库提交、哈希防漂移）：`verify` 确定性静态门禁（单测/合同/PS 语法+BOM/versions 相等/安装事务夹具）、`build`（确定性 ZIP + `-ReproducibilityCheck` 双构建整包哈希相等测试）、`acceptance` 实机验收链（安装→幂等重跑→启动→三路探测→退出→端口残留→回滚哈希核对→再安装，原始报告脱敏且不入库）、`doctor` 只读体检、`sync-versions`（bundled pnpm 重生成 lockfile）。
- `versions.json`：部署固定项唯一权威源；`installer/dsh-package.json`、`installer/tools-package.json` 为派生文件（合同测试断言全链相等）；插件版本唯一权威仍在 `package.json`。
- 夹具端口注入：安装事务夹具不再依赖宿主 3080 状态，守卫本身成为被测对象；生产默认仍检查真实端口。
- `maintenance/diagnostic-table.md` 固定错误码诊断表与 `evidence/example-report.json` 示例报告（虚构数据）。

## 0.4.0 候选阶段记录 - 2026-08-24

### Added

- Windows 一键部署 ZIP：事务备份、固定 DSH/Kimi/百炼 CLI、安装/启动/补齐 CLI/回滚/卸载入口，以及逐文件 SHA-256 内容清单。
- `kimi-coding` 与 `qwen-token-plan-cn` 内置额度路由；自定义路由可覆盖，`enabled: false` 可显式退出。
- Windows 临时 `DSH_HOME` 安装器夹具与 CI 门禁，覆盖幂等、永久载荷路径、篡改拒绝、失败回滚、凭据/settings 不变和卸载所有权。

### Changed

- 插件版本升至 0.4.0；安装器固定 DSH `0.1.1-rc.2`、Kimi Code `0.38.0`、百炼 CLI `1.17.0`，均使用 lockfile。
- Kimi 服务由专用启动器按需启动；仅关闭本启动器创建的实例，且官方 shutdown 请求使用 JSON content type/body。

### Fixed

- 避免 profile 依赖指向临时解压目录；安装前先把完整载荷原子固化到 `~/.dsh/turn-cost-installer-package`。
- 收紧同哈希幂等判断，防止回滚到旧插件后仅凭 bundle 名误判已安装。
- pnpm 11 使用 `allowBuilds` 明确批准 DSH 必需的五个构建依赖；PowerShell 5.1 脚本统一 UTF-8 BOM。

## [0.3.0] - 2026-08-24

### Added

- **订阅额度窗口显示（门二 v2 五拍落地）**：新端点 `turnCost/quota`——Kimi 订阅路由经官方 Kimi Code loopback OAuth Server 读取 5 小时/7 天窗口与加油包余额；阿里 Token Plan 路由调官方 `bl usage token-plan --output json`（未运行/未登录/输出不认得均安静降级）
- **按路由分流显示**：每轮徽章按该轮实际 provider 分流——官方按量（DeepSeek）显示 ¥ 金额；`kimi-coding` 显示「本轮 token · 5h 已用 X% · 剩余 Y%」；`qwen-token-plan-cn` 显示「本轮 token · 剩余 Y%」
- **模型名随对话显示**：会话读数条前缀模型名（读自对话日志，不跟当前 harness 预设）
- 费率表新增可选 `quota` 顶层块（`quotaConfigOf` 解析，畸形/原型名键守卫）；汇总面板新增「订阅额度窗口」区

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
