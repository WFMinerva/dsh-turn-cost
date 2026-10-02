# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。
>
> **状态口径**：只写「已用命令/工具核到的事实」，并标明核对的时点与机器。凡未经核实一律写进「未验证项」，不写成完成；**「装得上」「dump-config 正常」「HTTP 200」「界面有渲染」都不算「跑起来了」**。

- **当前分支**：master
- **HEAD**：**最后一次实质提交**是 `1b81104`（`docs(readme): 加界面截图（会话累计 + 每轮费用），并把 assets 纳入 npm 包`）。同一轮链路：`e13fe3d`（0.6.2 修复）→ `5cde0d1`（0.6.2 发布记录）→ `1b81104`（截图）→ **本文档的记录提交**（它只能记录自己之前的提交，写不进自身哈希，所以**永远比上面这条再领先一格**；查实际 HEAD 一律以 `git log` 为准）。`29b38d8`／`839db31` 属 0.6.1 轮。
- **工作树**：干净（无未提交改动；`node_modules/`、`*.tgz`、`.tmp-*` 按 `.gitignore` 排除）
- **发布状态**：**npm `dsh-turn-cost@0.6.2` 已发布**，`dist-tags.latest = 0.6.2`；**0.6.1 未被改写**（仍在 registry 上、让位给 0.6.2）。
- **对外动作**：已向精选列表 `awesome-dsh-plugin/awesome-dsh-plugin` 提条目 PR **[#6441](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6441)**（CI pass、MERGEABLE，待维护者合并）；GitHub 仓库描述已更新；截图已发布到本仓库（见 §十）。
- **本轮授权范围**：0.6.2 修复轮「按新版本完成修复 → 提交 → 推送 → CI 通过后发布 npm；不得覆盖已发布的 0.6.1」；随后机主分别授权「由我提市场条目 PR」「更新仓库描述」「裁掉截图上半部分再推 + 嵌 README 并把 assets 纳入 npm 包」「提交、推送本状态记录」。桌面 profile 的 `link:` 安装**保持不动**。

## 一、本轮（0.6.2）修了什么 —— 假日计费缺陷（Codex 独立发现）

### 真因：`isPeak` 只给周末开了例外，工作日假期仍按高峰计价

- 0.6.1 的 `isPeak` 只有两条：周末（2026-08-23 起）全天空闲 + 每日 9:00–12:00、14:00–18:00 为高峰。**中国法定节假日没有进入判断**，于是工作日假期落在这两个窗口里的调用被算成高峰价——用官方口径衡量即**一律偏高**。
- 机主举的三个时点（2026-10-01 10:00、10-02 15:00、10-05 10:00）都在国庆假期内：10/1 周四、10/2 周五、10/5 周一，0.6.1 全部判为高峰。
- 官方现行口径（**2026-10-03 实抓** [定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 脚注 2，原文）：「北京时间周一至周五（**不含中国法定节假日**）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段」。

### 修法

| 改动 | 内容 |
|---|---|
| 节假日表 | 新增 `STATUTORY_HOLIDAY_RANGES` / `STATUTORY_HOLIDAYS` / `isStatutoryHoliday(ms)`，数据源是 [《国务院办公厅关于2026年部分节假日安排的通知》](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)（国办发明电〔2025〕7 号，2025-11-04）：元旦 1/1–1/3、春节 2/15–2/23（**9 天**）、清明 4/4–4/6、劳动节 5/1–5/5、端午 6/19–6/21、中秋 9/25–9/27、国庆 10/1–10/7，共 33 天。 |
| 调休周末 | `MAKEUP_WORKDAY_WEEKENDS`（1/4、2/14、2/28、5/9、9/20、10/10）**只作审计记录，计价不读它**：官方明确调休上班的周末仍按空闲价，周末规则已覆盖；若拿它建「工作日日历」反而会把官方按空闲价计费的日子算成高峰。 |
| 生效边界 | `HOLIDAY_OFF_PEAK_EFFECTIVE_MS = 2026-09-19 00:00 北京时间`；生效点前保留当时规则（周末 2026-08-23、峰谷机制起始 2026-08-17 两条既有边界不动），**历史金额不被重算**。 |
| 失效注释 | 删除 `deepseek-v4-pro` 条目里「自 2026-09-14 12:00 起路由到 V4.1 Flash 并按 Flash 价计费」的注释——与官方不符（见下），该切价**不存在**；`docs/DEVELOPMENT.md` 的同条待办一并撤掉。 |
| 测试 | `test/fold.test.mjs` +5 组（86 → **91** 项全绿）：表保真、三个误判时点与整假期逐窗口、调休周末（含生效点前历史行为）、生效边界与普通工作日、假期→工作日跨档按步计价（含 Pro 价未变）。 |

### 核实到哪一步、哪一步确认不了（不要合并成一句话）

1. **口径已核实**：官方定价页脚注 2 原文如上（2026-10-03 实抓）。
2. **节假日日期已核实**：以 gov.cn 通知原文为准（**春节是 2/15–2/23 共 9 天**；部分媒体摘要写「8 天」，与通知不符）。
3. **Pro 切价说法已证伪**：官方 [更新日志 2026-09-10](https://api-docs.deepseek.com/zh-cn/updates) 原文「我们决定在 2026 年 9 月 14 日之后继续提供 DeepSeek V4 Pro 的 API 调用服务，**计费方式保持不变**」；定价页至今仍把 `deepseek-v4-pro` 列为 V4-Pro-0813、按 Pro 价计费。此前仓库里的「将改按 Flash 价」记载**作废**。
4. **生效时刻确认不了**：官方**不给**节假日子句的生效时刻——更新日志无对应条目、`/zh-cn/news/news260919` 不存在（只有 2026-09-19 的媒体报道，且报道只说「发布说明」、未给时刻）。本实现取公告日 2026-09-19 00:00，并用**分歧窗口不变式用例**证明该选择**不可观测**：2026 年的法定假期要么整体早于峰谷机制（元旦/春节/清明/劳动/端午），要么整体晚于该常量（中秋/国庆），两种读法对 2026 年任何一天都没有差别。
5. **2027 年及以后未收录**：次年安排尚未公布。未收录年份里的法定节假日会按普通工作日计价（偏高），属**已知边界**，见 §六。

## 二、验证证据（0.6.2，2026-10-03 家用机）

### 1）本地门禁

```
npm test            → 91/91 PASS / 0 FAIL   （0.6.1 是 86/86，本轮 +5 组）
npm run check       → lib/*.js 语法全过
node tools/peer-compat.mjs --runtime 0.2.0-rc.2 → exit 0
git diff --check    → 干净
```

### 2）真实数据按步骤重算（本轮的核心证据）

同一脚本对**每一个样本**分别按「0.6.1 规则（只认周末）」与「0.6.2 规则（周末 + 法定节假日）」算两遍，并逐样本断言复算结果与 `costOfStep`（真实代码路径）**逐位一致**：

| 范围 | 0.6.1 | 0.6.2 | 差额 | 窗口判定变化的步数 |
|---|---|---|---|---|
| 本会话 `session-4a4f6dfb-…`（643 步） | ¥7.35674600 | ¥7.35674600 | **¥0.00000000** | **0 / 643** |
| 全机 887 个会话（630 MiB、34823 个已计价步） | ¥632.51587032 | ¥632.51587032 | **¥0.00000000** | **0** |

本会话逐轮（与 0.6.1 发布包验证时的读数对照）：

| turn | 步数 | 0.6.1 | 0.6.2 |
|---|---|---|---|
| 1 | 246 | ¥2.52076228 | ¥2.52076228 |
| 2 | 128 | ¥1.80360808 | ¥1.80360808 |
| 3 | 160 | ¥1.65231392 | ¥1.65231392 |
| 4 | 36 | ¥0.43785796 | ¥0.43785796 |
| 5 | 35 | ¥0.44086068 | ¥0.44086068 |
| 6 | 17 | ¥0.24160248 | ¥0.24160248 |
| 7 | 21 | ¥0.25974060 | ¥0.25974060 |

- **turn 1–4 与 0.6.1 发布包验证时的逐轮读数逐位相同**（当时 585 步读到的是 2.52076228 / 1.80360808 / 1.65231392 / 0.43785796），即修正没有改写历史；turn 5 之后变大是会话在两次核对之间继续增长（585 → 643 步）。
- 本会话 643 步**全部落在 2026-10-03（周六）03:19:34–05:12:16 北京时间**，周末规则早已让它全天空闲——所以这条会话的假日差额**必然是 0**。

### 3）差额为什么是 0（不是规则没生效）

| 事实 | 数量 |
|---|---|
| 落在假期日的样本（9/25、9/26、9/27、10/1、10/2、10/3） | **7279** |
| 其中**已计价**样本 | 3102 |
| 其中**已计价且落在高峰窗口**（0.6.1 会算高峰的） | **0**（本机已计价流量集中在 00:00–06:00 北京时间，本就是空闲价） |
| 落在高峰窗口的假期样本（全部是**无单价的订阅路由**） | **644**：`kimi-coding/k3` 498、`zai-coding-cn/glm-5.3` 146 |
| 这 644 步的金额差额（0.6.1 / 0.6.2） | **¥0.00000000 / ¥0.00000000**（订阅路由不按 token 计价，两个版本都没为它们计价） |
| 同 644 步、10834 万 token **若走内置 DeepSeek Flash 卡** | 0.6.1 高峰 **¥13.07089960** vs 0.6.2 空闲 **¥6.53544980** → **多算 ¥6.53544980（恰 50%）** |

- 也就是说：**本机金额差额为 ¥0 是可解释的真实结果**——假期里真正落在高峰窗口的流量恰好全在订阅路由上；缺陷的金额影响由「同 token 走按量卡」的量级（¥6.54）与单测固定。
- 机主举的三个时点里，**10-01 10:00（12 个样本）与 10-02 15:00（42 个样本）在本机真实日志中存在**且都命中该缺陷；**10-05 10:00 本机没有样本**，仅作规则示例。

### 4）已发布包的官方路径验证（隔离宿主，2026-10-03）

```
$env:DSH_HOME='C:\Temp\dsh-tc-pub2'
dsh pub2 --from-default-profile web --dump-config        # 官方模板建隔离 profile
copy .dsh\storages、.dsh\sessions\--F-Workspaces-dsh-turn-cost--\<sessionId>   → 隔离 home
dsh plugin --profile pub2 add dsh-turn-cost@0.6.2        # registry 安装（非 link:）
dsh --profile pub2 --no-open --port 19403                # 打印带 token 的本地 URL
node rpc.mjs "<带 token 的 URL>" <sessionId>             # 官方 wire：POST /api/turnCost/*
```

| 项 | 结果 |
|---|---|
| 安装形态 | `dependencies: {"dsh-turn-cost":"0.6.2"}`（**非 `link:`**）、安装目录 `LinkType` 为空、`dsh.profile.bundles` 自动追加；pnpm 从 registry 解析下载 |
| 包内容 | 已安装的 **10 个文件与仓库逐文件 SHA256 全部 MATCH**（含 `README.md`） |
| `turnCost/sessionTotals` | `cost=7.70550156, steps=681, priced=681, unpriced=0, models=["deepseek-flash"]`；标题读自日志 |
| 逐轮 `turnCost/query` | `2.52076228 + 1.80360808 + 1.65231392 + 0.43785796 + 0.44086068 + 0.24160248 + 0.60849616 = 7.70550156`，**恰等于会话汇总**（差 ¥0.00000000） |
| `{messageId}` 定位 | 消息 `36c3e026-…` → turn 1，`¥2.52076228`；与同一消息所在 `{turn:1}` 定位**同值** |
| 与独立实现互校 | 同一份会话副本（681 步）用仓库 `lib/fold.js` 独立重算 = **¥7.70550156**，逐轮数字与宿主 RPC **逐项相同** |
| 界面层 | **本轮未重新目检**；`lib/client.js` 与已目检过的 0.6.1 **逐字节相同**（SHA256 `C7089174…`），本轮只改宿主半（`lib/fold.js` SHA256 `4295C36E…` → `2908F04E…`） |

> 注意：这条会话是**周六**（2026-10-03）跑的，两版规则给出的金额本来就相同（643 → 681 步两次读取均如此）；它在本轮的作用是**证明发布包能算出正确的数**，不是证明假日规则生效——假日规则由单测与 §二.2/§二.3 的全量重算证明。

## 三、上一轮（0.6.1）记录摘要

详见 `CHANGELOG.md` 的 `[0.6.1]`。要点：

- **真因**：`foldFor` 自己读内存会话的 `live.events`，而 `Session` **没有 `events` 属性**（只有私有 `log` 与官方 `snapshotEvents()`）→ 折叠为空 → `costOfSession([]) → null`。**只要会话被 UI 打开，金额就恒为 `?`**；客户端又把失败吞掉并回退官方 `tokenUsage`，于是渲染成一行看似正常的 token 统计（`? · 本会话 … token · 缓存读 100%`）。
- **修法**：完整日志**只**取自官方 `ctx.sessionQuery.readSession()`；缓存只用来省读取、绝不作为数据来源；每轮徽章改由宿主用 `messageTurnsOf` 把 `messageId` 映射到 `turn`；`rpc()` 失败返回稳定错误码并 `console.warn`，读数条区分「有数字／查询失败／未计费／查询中」四态，**失败时不再借用官方 token 数伪装**。
- **证据**：同一会话修前 `? · 本会话 16479万 token · 缓存读 100%`、零徽章 → 修后 `deepseek-flash · 本会话 ¥4.97 · … · 缓存读 99.6%` + 逐轮徽章；分桶与逐轮费用算术逐项相等。
- **机主目检**：重启桌面端后当前会话显示**约 ¥5.98**（**估算费用**，不是账单；与隔离宿主的 ¥4.97 是同一条会话在不同时刻的读数，**不构成互校**）。
- **发布**：提交 `29b38d8` → CI run `37062612009` ✓ → `npm publish`（机主在终端用 `--otp` 完成）→ `dist-tags.latest = 0.6.1`、`shasum 28425d80…`；已发布包在隔离宿主里用官方 `dsh plugin --profile pub add dsh-turn-cost@0.6.1` 安装并复算通过。
- **0.6.1 的教训**：组合（`--dump-config`）／host 挂载（`Config.listConfigs`）／client 注册（`Slots.listSubTree`）三层全绿时金额仍可以是 `?`——它们只证明「挂上了、注册了」，**不证明取到了数**。

## 四、三个必须分清的事实（不要合并成一句话）

1. **桌面 profile 现在装有本插件**（机主自行安装并保持安装：`link:F:/Workspaces/dsh-turn-cost`，在 `dsh.profile.bundles` 里），**本轮未改动、未重启**。
2. **旧 Web profile 装了但被拒载**：`~/.dsh/profiles/web/node_modules/dsh-turn-cost`（0.5.2）在 dsh 0.2.0-rc.2 下被 `incompatible-version` 拒载（原文 `skipping profile bundle "dsh-turn-cost"`）。该 profile 当前没有在跑。
3. **隔离宿主曾「挂载失败」是 harness 的缺陷，不是插件缺陷**：0.6.1 轮已用官方 `--from-default-profile web` 建出可用隔离宿主并端到端跑通，该问题关闭。

## 五、桌面 profile 的自定义费率表：需要关联，但**我没有改**

- 事实：桌面 profile 的 `include:turn-cost` 条目**没有 config**，所以 `ratesPath` 未设 → `~/.dsh/turn-cost-rates.json`（机主自己维护的那张表）**被静默忽略**。
- 影响面有限（实测）：内置官方 CNY 卡覆盖 DeepSeek 按量路由（本轮全机 ¥632.52 就是在**没有**该文件的情况下算出来的），内置额度路由也与文件里的 `quota` 块等价（`builtinQuotaRoutes()` 已含 `kimi-coding` / `qwen-token-plan-cn`）。配它的意义是让那张表真的生效。
- 官方配置入口（用户补丁层，与其它插件配置同处）：

  ```yaml
  # ~/.dsh/profiles/desktop/cordis.patch.yml
  - id: turn-cost
    name: dsh-turn-cost
    config:
      ratesPath: %USERPROFILE%\.dsh\turn-cost-rates.json
  ```

- **未执行**：按 `AGENTS.md` 红线 3（未经机主同意不改动正在使用的 profile），只做核对并给出可直接粘贴的一行。改完需重启宿主才生效。
- 与本轮的关系：官方按量路由的假日价**不依赖**这张表（内置卡已含假日规则），所以不配它也不影响本轮修正生效。

## 六、未验证项 / 边界（不要当成已完成）

- ~~桌面宿主需要重启~~ / ~~界面观感未目检~~：0.6.1 轮已由机主重启并目检通过（约 ¥5.98，估算费用）。**0.6.2 的界面层未重新目检**：本轮只改宿主半，`lib/client.js` 与 0.6.1 逐字节相同（SHA256 已核），而桌面宿主仍在跑启动时加载的 0.6.1 代码——**插件以 `link:` 指向检出目录，机主重启桌面端后即加载 0.6.2**（本轮未重启，按红线 3 不擅自重启正在使用的宿主）。
- **2027 年及以后的法定节假日未收录**：未收录年份的假期会按普通工作日计价（偏高）。属已知边界，国务院公布后按 `docs/DEVELOPMENT.md` §三 补表 + 补测试。
- **调休上班的周末没有独立测试数据**：本机日志里 9/20 有 131 个样本（`kimi-coding/k3`，无单价）、10/10 尚无样本；「调休周末按空闲价」目前由周末规则 + 单测覆盖，**无实机金额证据**。
- **Kimi / 阿里两条订阅额度读数仍未实测**：隔离宿主里两条路由都返回 `ok:false`（该环境没有 loopback OAuth 服务、没有 `bl` CLI）；插件侧只有「路由配置 → 端点归一化」的单测覆盖（`normalizeKimiLocalUsage` / `normalizeAliyunBl`），**没有端到端实机读数**，因此**不声称额度读数可用**。
- **`github:` 形式的「添加插件」仍未实机跑**：npm 形式已在 0.6.1 发布后由隔离环境实测通过（见 §九）；Git 形式只满足包结构要求（`main` + `exports["./client"]` + 无构建步骤），未实测。
- **市场条目是否被合并未定**：PR #6441 通过 CI 后**由维护者读仓库决定**（其文档明确「CI 是前置条件，不是结论」）。最大风险是评审第 4 条「是否已被现有条目覆盖」——见 §十 的风险登记。若被打回，按其规则只需改描述那一行再推同一分支。
- **市场的截图渲染与「市场内一键安装」未验证**：条目尚未进入 `plugins.json`，市场里还没有这一条，因此**「卡片真的显示这两张图」「从市场一键装」都只是按约定推断，没有实测**。图片本身的可达性与字节已核（见 §十）。
- **npm 页面上的 README 图未生效**：`assets/` 已进 npm 包的 `files`，但**要等下一次发布**（如 0.6.3）才会带上；已发布的 0.6.2 页面仍是纯文字 README（它那份 README 无图，因此**不会**出现坏图）。
- **桌面 profile 的 `ratesPath` 仍未关联**（§五），改完需重启宿主。
- **订阅路由（k3 / glm-5.3 等）的金额恒为 0**：费率表里没有单价 → `unpriced`，只显 token。这是设计（不编造价格），不是缺口。

## 七、环境事实（2026-10-03 家用机）

- 正在使用的宿主是**桌面应用**：内嵌运行时 `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`，GUI `127.0.0.1:19387`，profile = `desktop`；插件以 `link:F:/Workspaces/dsh-turn-cost` 安装（**保持不动**，未被 npm 版本覆盖）。
- 构建机 Node `v24.18.0` / npm `11.16.0`；宿主运行时 Node 24.21.0 / pnpm 11.7.0。`dsh --version` = **0.2.0-rc.2**（CLI 不在 PATH，桌面应用自带 `...\resources\runtime\cli\bin\dsh.cmd`）。
- 会话根 `~/.dsh/sessions`：**887** 个会话日志、**630 MiB**，本轮全量重算**全部可读**（0 个失败）。
- 本机流量分布（对本轮结论重要）：**已计价**（DeepSeek 按量）流量集中在 **00:00–06:00 北京时间**；白天的高峰窗口流量主要落在**订阅路由**（`kimi-coding/k3`、`zai-coding-cn/glm-5.3`）上，无单价。
- **不可同步数据**：`node_modules/`；个人费率表（`~/.dsh/turn-cost-rates.json`，不在仓库内）；`%TEMP%\dsh-tc-inspect` 下的核对脚本——本轮实际保留：`recompute-session.mjs`（单会话按步骤重算）、`scan-holidays.mjs`（全量重算）、`scan-holiday-days.mjs` / `scan-holiday-hours.mjs` / `scan-holiday-models.mjs` / `scan-holiday-scale.mjs`（假期样本取证）、`rpc.mjs` / `turns.mjs`（官方 wire 查询，`method` 必须写**完整端点名** `turnCost/<方法>`，否则网关回 `method … does not match endpoint`）。0.6.1 轮的 `cdp.mjs` / `cdp-net.mjs` / `inspect-session.mjs` 等在当轮清理时已删除，本轮未重建（界面层未重新目检，理由见 §六）。

## 八、已验证机器

家用机（市场条目投稿 + README 截图发布 + 仓库描述更新，2026-10-03）；家用机（0.6.2 假日规则 + 全量重算 + 官方源实抓 + 发布包隔离验证，2026-10-03）；家用机（0.6.1 真因定位 + 隔离宿主端到端 + 无头浏览器逐轮核对 + 机主目检，2026-10-03）；家用机（0.6.0 官方接入改造 / 官方路径三层验证 / 80 项测试，2026-10-03）；家用机（0.5.3 / 0.5.2 / K3 双层复检，2026-09）；单位机（0.5.1，2026-09-10）；单位机（0.5.0，2026-09-02）

## 九、0.6.2 发布记录（2026-10-03）

| 环节 | 结果 |
|---|---|
| 提交 | **`e13fe3d`** `fix: 0.6.2 — 补齐中国法定节假日全天闲时规则，清除失效的 Pro 切价注释`（8 文件，+334 / −100；`git diff --check` 干净；无临时文件、个人配置或凭据进入版本库） |
| 推送 | `839db31..e13fe3d  master -> master` |
| CI | run **[37065886501](https://github.com/WFMinerva/dsh-turn-cost/actions/runs/37065886501)** job `npm ci + tests` ✓（`headSha` 与提交一致） |
| 发布 | `npm publish` 被 EOTP 拦住（同 0.6.1：npm 11 默认 web 认证，浏览器 URL 里 `authId` 被打成 `***`，无法转交），**由机主在自己终端完成 2FA 发布**；registry 在轮询 80 s 内出现 0.6.2 |
| registry | `dist-tags.latest = 0.6.2`；`dist.shasum = 2799f424d162372b0ad42e4d7e75966c1f8fc0b0`（与发布前 dry-run 指纹**逐位一致**）；**0.6.1 仍在 registry 上、未被改写** |
| 包内容 | 隔离宿主安装的 10 个文件与仓库**逐文件 SHA256 全部 MATCH**；`README.md` 是新的 93 行版本 → **npm 页面 README 不再是旧的 186 行版**（`npm view dsh-turn-cost@0.6.2 readme` = 93 行、含新增「节假日」行、不再含「订阅额度」章节），0.6.1 留下的 README 不一致问题随之关闭 |
| 官方安装 | 隔离宿主（`$DSH_HOME=C:\Temp\dsh-tc-pub2`，官方 `--from-default-profile web`）执行 `dsh plugin --profile pub2 add dsh-turn-cost@0.6.2`：`dependencies` 写成 `"0.6.2"`（**非 `link:`**）、安装目录 `LinkType` 为空、pnpm 从 registry 下载、`dsh.profile.bundles` 自动追加 |
| 已发布包的费用查询 | 见 §二.4：`turnCost/sessionTotals` = `7.70550156`（681 步、全计价），逐轮求和与之**恰等**，`{messageId}` 与 `{turn}` 定位同值，且与仓库 `lib/fold.js` 的独立重算**逐项相同** |
| 清理 | 隔离宿主已关停（19403 无监听）、临时 home 与 0.6.1 tarball 解包目录已删除；**桌面 profile 未重启、未改动**（实测仍是 `Junction → F:\Workspaces\dsh-turn-cost`） |

> 观察到的**噪声**（不影响结论）：官方 `dsh plugin add` 在此组合下会打印一条 pnpm 的 `Issues with peer dependencies found` 警告——因为官方 bundle（`@deepseek-ai/dsh-*`）由应用运行时提供、不在 profile 的 node_modules 里，pnpm 看不到它们。dsh 自己的兼容性门禁只判 `@deepseek-ai/dsh*` 的 `peerDependencies`，本插件全为 `"*"`；启动无 `skipping`、host 与 client 均正常挂载即为证。

## 十、DSH Market 上架投稿与截图（2026-10-03）

### 入口在哪：不在 DSH Market 本身

DSH Market（[dshmarket.com](https://dshmarket.com/zh/)，npm `dshmarket`）自己的 README 写明「**这个仓库是市场应用本身，不是插件目录**」，插件列表来自精选列表 **`awesome-dsh-plugin/awesome-dsh-plugin`**（网站 awesome-dsh-plugin.com 的 `plugins.json`），且市场**只允许安装该列表内的来源**。所以「上架」= 向那个列表提 PR。

⚠️ 存在**同名但完全独立的第二个列表** `beancookie/awesome-dsh-plugin`（156★；与 org 仓库**没有** fork 关系，两者都是非 fork 的独立仓库）。本插件**早在 0.1.x 期就已被那个列表收录**，所以 README 的 `featured in awesome-dsh-plugin` 徽章属实——但它**不会**让插件出现在市场里。以后看到该徽章别误判为「已上架市场」。

### 硬门槛逐条核对（contributing.md）——全过

| 要求 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `dsh.bundle.patch: ./cordis.patch.yml`，且补丁形状与官方示例一致（`- insert: - id: turn-cost / name: 'dsh-turn-cost'`） |
| 真实可用代码 / 非聚合包 | ✅ host + web client 两半、91 测试、无第三方 bundle 依赖 |
| 仓库创建满 1 天 | ✅ 2026-08-17 |
| 活跃维护 | ✅ 最后推送 2026-10-02、已发 0.6.2 |
| `dsh-plugin` topic | ✅ 已有（另有 cost-tracking 等 7 个） |
| MIT | ✅ |
| 描述属实、无营销词、中英各一句 | ✅ 条目文件里 `description.en` / `zh` |
| 分类 | ✅ `category: usage`（用量与计费） |
| 条目数 ≤ 3 | ✅ 1 条 |
| npm（推荐项） | ✅ 0.6.2 已发布，且包的 `repository` 指回本仓库 → 下载量自动关联；**条目内不能写 `npm:`**（手写会被校验拒） |

### 投稿物与 PR

- 文件：`data/plugins/WFMinerva__dsh-turn-cost.yml`（+6，**只加这一个文件**，不碰任何别人的条目）。
- 校验：用 **js-yaml 实解析**（与它 CI 的解析一致）——4 个键、`category` 合法、中英描述均以句号收尾、**不含「冒号+空格」**（官方点名的 YAML 坑，英文里用 `—` 绕开）、无营销词。
- PR：**[#6441](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6441)** `Add WFMinerva/dsh-turn-cost`；head `WFMinerva/awesome-dsh-plugin-1:add-dsh-turn-cost` → base `main`。fork 名带 `-1` 是因为 8-17 已存在一个 beancookie 列表的 fork；用 GitHub API 建分支+提交（仓库 142 MB，不整仓克隆）。提交后用 API 取回远端文件与本地**逐字节比对**（948 bytes, identical）。
- CI：check **pass（8m9s）**，run [37068896375](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/actions/runs/37068896375)；PR 状态 **OPEN / MERGEABLE**，`reviewDecision` 为空 → **待维护者读仓库后决定**。
- 合并后：网站自动重建 → `plugins.json` 收录 → 市场下次刷新出现在「用量与计费」并可在市场内一键装。

### 已如实登记的风险（不要粉饰）

评审第 4 条是「**是否已被现有条目覆盖**」，而 `usage` 分类里同时讲峰谷+费用的条目有 **58 条**。关键事实：**节假日闲时不是本插件的独有卖点**——`Han-1413141/dsh-cost-meter`（★361）已实现周末 + 中国法定节假日全天闲时（其 `lib/pricing.js` 有 `DEFAULT_PEAK_HOLIDAYS`、`holidayZoneAt()`，README 明写含调休周末），且功能更宽（余额、额度、90+ 模型价目、价格一键同步）。PR 正文**主动写明**了这处重叠，并声明本插件的差异是**范围**（只算成本、只用本机会话日志、不调余额 API、无需 API Key、可叠加自定义费率表），且若维护者判定过近、被拒也接受。另：`future007s/dsh-peak-indicator`、`rayadesune/...-chat-billing`、`jkStars/dsh-token-usage-stats` 三条同类**未搜到**假日相关代码，但代码搜索只覆盖默认分支，**不可据此断言它们没有**。

### 截图（按官方约定放在自己仓库）

`screenshots.json` 列 1–8 张**相对路径**（不得以 `/` 开头、不得含 `..`）；市场详情页读它，以后换图推自己仓库即可，不必再向列表仓库提 PR。

| 文件 | 来源与处理 |
|---|---|
| `assets/screenshots/session-total.png`（998×42） | 机主截图原样：插件会话累计行与官方统计条并列（`deepseek-flash · 本会话 ¥8.26 · 26004万 token · 缓存读 99.7%`） |
| `assets/screenshots/per-turn-cost.png`（623×27） | **从机主截图裁出底部操作行**：原图（623×180）上半是「已编辑 2 个文件」工具卡，含本机临时路径 `C:/temp/dsh-tc-inspect/...` 与投稿元信息，不对外。裁剪按**行墨迹**自动定位（检出 4 条墨迹带，保留第 4 条 ±4px），裁前出预览确认未切字 |

- README 新增「界面」节嵌这两张图；`package.json` 的 `files` 加 `assets/`（否则 npm 页面的 README 图会是坏的，npm 页渲染的是发布包里的 README）→ 发布包 **10 → 12 文件**、**35.3 → 51.6 KB**。
- 提交/推送：**`1b81104`**（`5cde0d1..1b81104` **快进**，未 force-push、未改写已推送历史——amend 掉的是从未推送的本地提交）→ CI run **37070637746** ✓。
- 线上核验：`screenshots.json` 与两张 PNG 经 `https://raw.githubusercontent.com/WFMinerva/dsh-turn-cost/HEAD/...` 取回均 **HTTP 200**，PNG 魔数正确，且与本地**逐字节相同**（9807 / 5258 bytes）。
- 仓库元数据：GitHub 仓库描述已改为与 README/代码一致（含「会话累计」与「周末与中国法定节假日全天按空闲价」）。
- **未验证**：卡片是否真的渲染出这两张图、市场内能否一键安装（条目尚未合并，市场里还没有这一条）——见 §六。
