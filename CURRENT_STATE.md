# CURRENT_STATE.md — dsh-turn-cost 实时状态

> 本文件是本仓库实时状态的唯一权威。跨机/跨会话交接：先读本文件，再按 `AGENTS.md` 开工顺序执行。
>
> **状态口径**：只写「已用命令/工具核到的事实」，并标明核对的时点与机器。凡未经核实一律写进「未验证项」，不写成完成；**「装得上」「dump-config 正常」「HTTP 200」「界面有渲染」都不算「跑起来了」**。

- **当前分支**：master
- **HEAD**：`29b38d8`（`release: 0.6.1 …`；已推送，`origin/master` 同步）
- **工作树**：干净（无未提交改动；`node_modules/`、`*.tgz`、`.tmp-*` 按 `.gitignore` 排除）
- **发布状态**：**npm `dsh-turn-cost@0.6.1` 已发布**，`dist-tags.latest = 0.6.1`（此前 latest 是 0.1.3）。0.6.0 从未提交、从未发布，其 tarball 已被 0.6.1 取代。
- **本轮授权范围**：机主授权提交 → 推送 → 等 CI → 发布 npm → 隔离环境验证已发布包；桌面 profile 的 `link:` 安装**保持不动**。

## 一、本轮（0.6.1）修了什么 —— 机主报「界面显示 `? · 本会话 15041万 token · 缓存读 100%`」

### 真因：`foldFor` 自己读内存会话的事件，而那个字段不存在

- `Session` 把事件放在**私有 `log`**，对外只有官方访问器 **`snapshotEvents()`**；**`Session` 没有 `events` 属性**（0.2.0-rc.2 源码：`packages/session/session` 的 `class Session { log = []; get seq() {...} snapshotEvents(...) {...} }`）。
- 0.6.0 的解析顺序把「live 内存日志」放第一优先并读 `live.events` → 恒为 `undefined` → 折叠出空样本 → `costOfSession([])` 返回 `null`。**后果：只要该会话被 UI 打开（正在使用时必然如此），`turnCost/query` 与 `turnCost/sessionTotals` 一律返回 `null`**；而没被打开的会话走官方读取反而正常——这就是「金额时而能算、正在用的会话算不出」的不对称。
- **客户端随后把失败吞掉并回退官方 `tokenUsage` 投影**，于是读数条渲染成一行看起来正常的 token 统计（`? · 本会话 … token · 缓存读 …%`），金额恒为 `?`。**显示统计条 ≠ 费用查询成功**，这正是机主指出的问题。
- 同一轮实测还发现**每轮徽章根本不渲染**：它在前端扫 `snapshot.chat.nodes` 猜 `node.location.turn.turn`，形状是猜的，实测恒为 `null`。

### 修法（官方能力优先，删掉自建路径）

| 改动 | 内容 |
|---|---|
| 取数唯一化 | 完整日志**只**来自官方 `ctx.sessionQuery.readSession()`（官方即 live 优先：内存会话由 `snapshotLive()` → `snapshotEvents()` 给出，历史会话由持久层给出，都是脱离副本 + 重放校验）。自建 live 路径删除。 |
| 缓存 | 只用于省读取、不作数据来源：① `ctx.sessions.get(id).seq`（官方契约 `seq === log.length`，零 I/O）相同则复用折叠；② 读回日志的 `sessionLogSignature`（事件数 + 最大 `seq`）相同则复用折叠，不再重算 447 步。删除自造的 `logMovedPast`。 |
| 兜底 | 仅当没有 `sessionQuery` 后端或官方读取抛错时扫日志；其 live 合并改用 `snapshotEvents()`。 |
| 每轮读数 | 徽章不再自己推导轮号：把槽位属主给的 `messageId` 交给宿主，宿主用 `messageTurnsOf` 在事件日志里映射到 `turn`；`turnCost/query` 同时接受 `{ turn }` / `{ messageId }`。 |
| 失败可见 | `rpc()` 返回 `{ ok, value }` / `{ ok:false, code, message }` 并 `console.warn` 出网关错误码；读数条区分「有数字 / 查询失败 / 未计费 / 查询中」四种文案，**失败时不再借用官方 token 数伪装成正常读数**；会话切换立即查询，不受 1.2 s 防抖拖累；缓存读比例不再把 99.65% 四舍五入成 `100%`。 |
| 测试 | `test/session-source.test.mjs` 换成**官方形状夹具**（私有 `log` + `snapshotEvents()`，并断言 `"events" in session === false`）——旧夹具用 `events` 数组正是缺陷逃过测试的原因；新增 `{messageId}` 定位、空 live 会话、签名/`messageTurns` 形状等（11 项）。`test/client-quota.test.mjs` 新增四个诚实性用例。 |

## 二、验证证据（0.6.1，2026-10-03 家用机）

### 1）本地门禁

```
npm test            → 86/86 PASS / 0 FAIL
npm run check       → 5 个 lib/*.js 语法全过
node tools/peer-compat.mjs --runtime 0.2.0-rc.2 → exit 0
git diff --check    → 干净
```

### 2）隔离宿主 + 真实会话 + 无头浏览器（第 4 层，0.6.1 起新增的验证手段）

命令（不碰正在用的 desktop profile）：

```powershell
$env:DSH_HOME='C:\Temp\dsh-tc-iso'
dsh iso --from-default-profile web --dump-config      # 官方模板建隔离 profile
dsh plugin --profile iso add F:\Workspaces\dsh-turn-cost
# 复制真实数据（复制而非 junction：宿主可能迁移日志）
copy .dsh\storages            → $DSH_HOME\storages
copy .dsh\sessions\<工作区>\<sessionId> → $DSH_HOME\sessions\<工作区>\
dsh --profile iso --no-open --port 19401              # 打印带 token 的本地 URL
chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<临时目录>
# CDP：Network 抓 POST /api/turnCost/* 的请求体与响应体；Runtime.evaluate 读 DOM 与 React fiber props
```

结果（同一真实会话 `session-4a4f6dfb-7f18-4852-a4f4-56fcbde3bf8e`，「维护 dsh-turn-cost 插件并核对状态」）：

| 项 | 修前 | 修后（原始 RPC 返回 / 界面文本） |
|---|---|---|
| 读数条 | `? · 本会话 16479万 token · 缓存读 100%` | `deepseek-flash · 本会话 ¥4.97 · 16479万 token · 缓存读 99.6%` |
| 每轮徽章 | **一个都不渲染** | `本轮 ¥1.80 · 6827万 token · 缓存读 99.9%`、`本轮 ¥0.65 · 1438万 token · 缓存读 99%`（列表虚拟化，只挂载可见消息） |
| 官方统计条 | `3 轮 447 步·291 tok/s / 165M tok·缓存命中 99.6%` | 同上（作为对照） |

**算术核对（逐项相等，不是「看着差不多」）**：

- 分桶：`input 346717+78650+153389 = 578756`、`output 135231+90732+52345 = 278308`、`cacheRead 81656064+68101504+14177152 = 163934720`，合计 `164791784` = 读数条的「16479万 token」。
- 费用：`¥2.5207622799999996 + ¥1.803608080000001 + ¥0.6463120400000002 = ¥4.9706824` = 会话汇总 `¥4.9706823999999985`。
- 模型名读自会话日志（`deepseek-flash`，provider `deepseek-account`），不是当前预设的猜测。
- 每轮 `{messageId}` 定位（`turnCost/query`）与 `{turn}` 定位返回同一轮同一数字。
- 有 `usage` 的 438 个 `assistant/message` 事件 → 447 个 `(turn, step)` 样本（同一步的流式 chunk 样本被最终 message 覆盖），`priced: 447 / unpriced: 0`。

### 3）仍然是「官方路径 + 官方 Inspect」的三层验证（0.6.0 已核，本轮未变）

组合（`--dump-config` 出现 `- id: turn-cost / name: dsh-turn-cost`，无 `skipping`）／host 挂载（`Config.listConfigs` → `include:turn-cost`、`status: "schema"`、`packageDir` 指向该 profile 的 `node_modules\dsh-turn-cost`、投影出插件自己的 Config schema）／client 注册（`Slots.listSubTree {"root":"conversation.chat.assistant-actions"}` 的 `occupants` 含 `{id:"turn-cost", active:true}`）。

> 0.6.1 的教训：这三层全绿时金额仍可以是 `?`。它们只证明「挂上了、注册了」，**不证明取到了数**。

### 4）机主目检（2026-10-03，桌面端重启后）

机主重启桌面端后确认：**当前会话显示约 ¥5.98 的费用**。这是 0.6.1 唯一的「人眼看」证据，补上了 §二.2 只能由脚本读取的那一层——**金额渲染确实回来了**。

两点写清楚，免得被当成账单或精确对账：

- 这是**估算费用**：`provider 上报 token 数 × 本地费率表单价`，不构成账单；订阅制路由按 0 价登记只显示 token。
- ¥5.98 与 §二.2 隔离宿主的 ¥4.97 是**同一条会话在不同时刻**的读数（核对期间会话仍在增长，多出约两轮），二者**不构成互校**，只共同证明「金额出现了、量级一致」。逐轮与分桶的严格对账以 §二.2 的算术为准。

## 三、三个必须分清的事实（不要合并成一句话）

1. **桌面 profile 现在装有本插件**（机主本轮自行安装并保持安装：`link:F:/Workspaces/dsh-turn-cost`，在 `dsh.profile.bundles` 里）。**该 profile 在 0.6.0 轮之前从未装过本插件**；上一轮我临时装过、验证后卸载还原。
2. **旧 Web profile 装了但被拒载**：`~/.dsh/profiles/web/node_modules/dsh-turn-cost`（0.5.2）在 dsh 0.2.0-rc.2 下被 `incompatible-version` 拒载（原文 `skipping profile bundle "dsh-turn-cost"`）。该 profile 当前没有在跑。
3. **隔离宿主曾「挂载失败」是我 harness 的缺陷，不是插件缺陷**：当时用空 profile + `--patch` 绝对路径（官方文档里的**仓库内教程式**回路）且缺应用层。**本轮已用官方 `--from-default-profile web` 建出可用隔离宿主并端到端跑通**（见 §二.2），该问题彻底关闭。

## 四、桌面 profile 的自定义费率表：需要关联，但**我没有改**

- 事实：桌面 profile 的 `include:turn-cost` 条目**没有 config**，所以 `ratesPath` 未设 → `~/.dsh/turn-cost-rates.json`（机主自己维护的那张表，含订阅路由 0 价与 `quota` 块）**被静默忽略**。
- 影响面有限（实测）：内置官方 CNY 卡覆盖 DeepSeek 按量路由（本轮 ¥4.97 就是在**没有**该文件的情况下算出来的），内置额度路由也与文件里的 `quota` 块等价（`builtinQuotaRoutes()` 已含 `kimi-coding` / `qwen-token-plan-cn`）。**配它的意义是让那张表真的生效**，而不是让金额算出来。
- 官方配置入口（一行，用户补丁层，与其它插件配置同处）：

  ```yaml
  # ~/.dsh/profiles/desktop/cordis.patch.yml
  - id: turn-cost
    name: dsh-turn-cost
    config:
      ratesPath: %USERPROFILE%\.dsh\turn-cost-rates.json
  ```

- **未执行**：按 `AGENTS.md` 红线 3（未经机主同意不改动正在使用的 profile），我只做了核对并给出可直接粘贴的一行，等机主决定。改完需重启宿主才生效。

## 五、未验证项 / 边界（不要当成已完成）

- ~~桌面宿主需要重启~~：**机主已重启并目检通过**（见 §二.4）。
- ~~界面观感未目检~~：**已由机主目检**（桌面端当前会话显示约 ¥5.98，估算费用）。
- **Kimi / 阿里两条订阅额度读数仍未实测**（口径未变）：隔离宿主里两条路由都返回 `ok:false`（该环境没有 loopback OAuth 服务、没有 `bl` CLI）；插件侧只有「路由配置 → 端点归一化」的单测覆盖（`normalizeKimiLocalUsage` / `normalizeAliyunBl`），**没有端到端实机读数**，因此**不声称额度读数可用**。
- **`github:` 形式的「添加插件」仍未实机跑**：**npm 形式已在 0.6.1 发布后由隔离环境实测通过**（见 §八）；Git 形式只满足包结构要求（`main` + `exports["./client"]` + 无构建步骤），未实测。- 桌面 profile 的 `ratesPath` 仍未关联（§四），改完需重启宿主。

## 六、环境事实（2026-10-03 家用机）

- 正在使用的宿主是**桌面应用**：内嵌运行时 `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`，GUI `127.0.0.1:19387`，profile = `desktop`；插件以 `link:F:/Workspaces/dsh-turn-cost` 安装（**保持不动**，未被 npm 版本覆盖）。
- dsh CLI 不在 PATH；桌面应用自带入口 `...\resources\runtime\cli\bin\dsh.cmd`。`dsh --version` = **0.2.0-rc.2**（Node 24.21.0 / pnpm 11.7.0）。
- 会话根 `~/.dsh/sessions`：**885** 个会话目录（v0 353 / v3 313 / v4 219），全部可解析。
- 隔离宿主 harness：`$DSH_HOME` 指向临时目录，用官方 `--from-default-profile web` 建 profile；CDP 驱动脚本在 `%TEMP%\dsh-tc-inspect`（验证结束后临时数据已删）。
- **不可同步数据**：`node_modules/`；个人费率表（`~/.dsh/turn-cost-rates.json`，不在仓库内）；本机 `.tmp-*` 草稿。

## 七、已验证机器

家用机（0.6.1 真因定位 + 隔离宿主端到端 + 无头浏览器逐轮核对 + 机主目检，2026-10-03）；家用机（0.6.0 官方接入改造 / 官方路径三层验证 / 80 项测试，2026-10-03）；家用机（0.5.3 / 0.5.2 / K3 双层复检，2026-09）；单位机（0.5.1，2026-09-10）；单位机（0.5.0，2026-09-02）

## 八、0.6.1 发布记录（2026-10-03）

机主明确授权后执行：提交 → 推送 → 等 CI 通过 → 发布 npm → 隔离环境验证已发布包。桌面 profile 的 `link:` 安装**未被替换**（实测仍是 `Junction → F:\Workspaces\dsh-turn-cost`）。

| 环节 | 结果 |
|---|---|
| 提交 | **`29b38d8`** `release: 0.6.1 — 走官方「添加插件」接入，并修掉「金额恒为 ?」的真因`（19 路径新增/修改 + 35 路径删除；`git diff --check` 干净；无临时文件/个人配置/凭据进入版本库） |
| 推送 | `4a191f7..29b38d8  master -> master` |
| CI | run **[37062612009](https://github.com/WFMinerva/dsh-turn-cost/actions/runs/37062612009)** job `npm ci + tests` ✓（headSha 与提交一致；唯一注解是 GitHub 的 Node 20 弃用提示） |
| 发布 | `npm publish` 先被 EOTP 拦住（npm 11 默认 `auth-type=web`，给出的浏览器 URL 里 authId 被打成 `***`，无法转交），改由机主在终端用 `npm publish --otp=<码>` 完成。发布时间 `2026-10-02T20:59:07Z`（北京时间 2026-10-03 04:59） |
| registry | `dist-tags.latest = 0.6.1`；`versions = 0.1.0…0.1.3, 0.6.1`；`dist.shasum = 28425d80bae4ce68e46384962f4a4191a42f5a36`（与发布前 dry-run 指纹**逐位一致**） |
| 包内容 | 从 registry 取回 tarball 解包，10 个文件与仓库**逐文件 SHA256 全部 MATCH**；**`README.md` 也在内**（npm 页面 README 现为 8485 字节 / 186 行，与仓库归一化后完全相同——此前页面还是 0.1.3 的 2669 字节 / 88 行旧版） |
| 官方安装 | 隔离宿主（`$DSH_HOME=C:\Temp\dsh-tc-pub`，官方 `--from-default-profile web`）执行 `dsh plugin --profile pub add dsh-turn-cost@0.6.1`：`dependencies` 写成 `"0.6.1"`（**非 `link:`**）、安装目录 `LinkType` 为空（真实目录而非 junction）、pnpm 从 registry 解析并下载、`dsh.profile.bundles` 自动追加；启动日志**没有** `skipping profile bundle` |
| 已发布包的费用查询 | 喂同一条真实会话后（`--port 19402`）：`turnCost/sessionTotals` → `cost=6.61436252, steps=585, priced=585, unpriced=0, models=["deepseek-flash"], cacheHitRate=0.9969`；`turnCost/query` 逐轮 `2.52076228(246) + 1.80360808(128) + 1.65231392(160) + 0.43785796(36) + 0.19982028(15) = 6.61436252` **恰等于会话汇总**；`{messageId}` 定位（末条消息 → turn 5）与 `{turn}` 定位返回同一数字 |
| 已发布包的界面 | 无头浏览器打开隔离宿主：读数条 `deepseek-flash · 本会话 ¥6.61 · 21792万 token · 缓存读 99.7%`、每轮徽章 `本轮 ¥0.44 …` / `本轮 ¥0.20 …`、官方统计条 `5 轮 585 步 / 218M tok·缓存命中 99.7%`，控制台无异常 |
| 清理 | 隔离宿主与无头浏览器已关停（19402/9333 无监听）、临时 home 与浏览器 profile 目录已删除；桌面宿主未重启、未改动 |

> 观察到的**噪声**（不影响结论）：官方 `dsh plugin add` 在此组合下会打印一条 pnpm 的 `Issues with peer dependencies found` 警告——因为官方 bundle（`@deepseek-ai/dsh-*`）由应用运行时提供、不在 profile 的 node_modules 里，pnpm 看不到它们。dsh 自己的兼容性门禁只判 `@deepseek-ai/dsh*` 的 `peerDependencies`，本插件全为 `"*"`；启动无 `skipping`、host 与 client 均正常挂载即为证。
