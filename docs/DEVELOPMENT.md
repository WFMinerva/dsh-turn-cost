# dsh-turn-cost 开发与维护指南

> 给接手维护这个项目的人（包括新开一个对话的 AI）看的完整地图：仓库结构、DSH 插件机制的关键坑、计费口径的不变式、接入与发布。**改代码前先通读本文。**
>
> 本指南按 2026-10-03 的官方机制（dsh **0.2.0-rc.2**）重写：接入只走官方「添加插件」，仓库内**没有**安装器、启动脚本、宿主版本固定或验收链。

## 一、仓库结构与职责

| 文件 | 职责 | 注意 |
|---|---|---|
| `lib/fold.js` | 纯计费核心：官方事件折叠、zstd 日志兜底解帧、峰谷计价 | **零依赖**，可直接被 node 单测；所有金额口径都在这里 |
| `lib/index.js` | host 端服务：`TurnCostService`，Typert Remote 端点 `turnCost/query` | 顶部 `__esDecorate` 是手工转译的 stage-3 装饰器，**不要删** |
| `lib/quota.js` | host/client 测试共享的额度响应纯规范化函数 | 包内部测试接缝，未加入 `package.json` 的 `exports` |
| `lib/client.js` | 浏览器 bundle：每轮徽章 + 会话读数条 | 手工写的惰性 CJS 工厂（`window.__ModuleLoader__.load`），**不需要打包器** |
| `lib/index.d.ts` | host 半的公开类型声明 | **手写**（实现是纯 JS），与 `lib/index.js` 的公开面同步改 |
| `cordis.patch.yml` | bundle patch：往 profile 插入一行 `turn-cost` | 这一行就是「插件层」，官方安装路径靠它生效 |
| `tools/peer-compat.mjs` | peer 模型 + 宿主版本漂移守卫 | 范围数学交给标准 `semver`（官方同款选项），不自造 |
| `test/*.test.mjs` | 纯函数单测 + 真实服务行为测试 | `node --test` 运行，无网络 |
| `package.json` | 双重身份：npm 包清单 + DSH bundle 清单（`dsh` 字段） | `files` 白名单：`lib`、`cordis.patch.yml`、`rates.example.json`、`README.md` |
| `.github/workflows/test.yml` | CI：`npm ci` + 全量测试 | 不再有 Windows/PowerShell 专项 job |

**刻意不存在的东西**：安装器、启动/回滚/卸载脚本、`versions.json` 式宿主版本固定、`maintenance.ps1` 门禁与 `acceptance` 实机链、`vendor/` 通用层快照、`evidence/`。这些在 0.6.0 已随官方机制接管而删除——官方负责安装、依赖解析、配置/HMR、生命周期清理与 profile 补丁，重建它们就是重复建设，且每一处都会随宿主升级腐坏。

## 二、DSH 插件机制（本插件踩过的关键点）

### 一个插件的三件套

1. **bundle patch**（`cordis.patch.yml`）：`- insert: - id: turn-cost / name: 'dsh-turn-cost'`，让 profile 加载这个包。
2. **host 服务**（`lib/index.js`，包的 main）：跑在 DSH 进程里，能读磁盘上的会话日志。
3. **client bundle**（`lib/client.js`，`dsh.client` 字段指向）：跑在浏览器里，渲染 UI。

`package.json` 里的 `dsh` 字段是清单：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-locale"]
  }
}
```

`client.inject` 列表决定 `apply(ctx)` 里能用哪些上下文服务（`connection` → `ctx.connection`，`locale` → `ctx.locale`）。

### host 端（lib/index.js）

- 服务类继承 `TypertRemoteService`，构造函数里 `super(ctx, "turnCost")` 定 RPC 命名空间；`static inject = ["sessions"]` 只声明**必需**的上下文服务。`sessionQuery` **故意不进 inject**——它由后端插件挂载，写进 inject 会让「没有该后端」的组合把整个插件挂住（而那正是兜底路径存在的场景）；官方口径是「omit inject and query with `ctx.get()` at the use site」。
- 方法用 `@Remote("query")` 装饰器暴露为端点 `turnCost/query`。DSH 走 SRC 发现（`typert-protocol` 的 "Visible binding consumed by the Gateway's source-mode discovery"），**不需要生成 typert 清单文件**。
- **装饰器是坑**：Node 24 不执行装饰器语法，而 typert 协议依赖装饰器留下的 metadata，所以必须保留装饰器写法并手工转译——`lib/index.js` 顶部那两段 `__esDecorate` / `__runInitializers` 就是转译产物。新增 `@Remote` 方法时，照抄 static 块里对 `__esDecorate` 的调用方式再加一行，不要改写成普通对象注册。
- 方法签名没有默认值时，网关按签名推导 wire 参数名：`async query(request)` → 客户端必须以 `request` 为参数名传（见下）。改参数名＝改 wire 协议，两边要同步。

### 会话历史：官方 `ctx.sessionQuery`（0.5.3 起；0.6.1 起**唯一**数据来源）

**唯一取数口**：`foldFor(sessionId)` 取 `ctx.get("sessionQuery")` 后 `await readSession(sessionId)` 拿 `{ session, inheritedEventCount, events }`，交给纯函数 `foldSessionEvents(events)` 折叠。官方口径（`packages/session-query/session-query/README.md`）：

> Use `ctx.sessionQuery` from application code when you need to read or search session history without touching the session service or a storage backend directly.

它 live 优先、带重放校验、返回的全部是脱离副本，且**日志命名代次与压缩格式由宿主负责**——0.5.2 那次「V3 版本化文件名」适配断裂正是不该由本插件承担的那类维护。

> **红线（0.6.1 血债）**：**不要自己读内存里的会话事件。** `Session` 把事件放在私有 `log` 里，对外只有 `snapshotEvents()`；**`Session` 没有 `events` 属性**（`log = []`、`get seq() { return SessionLogOffset(this.log.length) }`）。0.6.0 曾把「live 内存日志」当作第一优先并读 `live.events`——它恒为 `undefined`，折叠结果为空，`costOfSession([]) → null`，于是**每个被 UI 打开的会话金额都恒为 `null`**（界面只显示官方 token 数），而没被打开的会话反而正常。若要读内存会话，只用 `ctx.sessions.get(id)` 与 `session.snapshotEvents()` 这两个官方口子。

**缓存（只为省读取，绝不作为数据来源）**：两级，键都来自官方数据。

1. `ctx.sessions.get(id).seq` 按官方契约等于 `log.length`（零 I/O）；与缓存记录的 `liveSeq` 相同即直接复用折叠，省掉一次 `readSession` 的整份克隆。
2. 读回的日志用 `sessionLogSignature(events)`（事件数 + 最大 `seq`）比对；相同则复用上一个折叠，**不再重新计价每一步**（真实会话 447 步时这是主要开销）。

`liveSeq` 读不到（无内存会话、形状不认识）只会关掉第一级短路，绝不影响结果。

**兜底**：组合里没有 `sessionQuery` 后端、或官方读取抛错时，回退 `foldFromLog(sessionId)`（扫 `<dsh-home>/sessions/**` 的 zstd 多帧 JSONL + 用 `snapshotEvents()` 合并内存会话）。这条路径**保留且有测试**，但要记住它是降级路径：任何「只有它能读到」的结论都说明官方路径有问题，先查那个。

两条路径的折叠结果由单测断言逐样本相等（`test/session-source.test.mjs`），因为官方事件与日志记录是同一个 `{ type, seq, time, data }` 形状。该测试的假会话**只暴露官方访问器**并断言 `"events" in session === false`——用 `events` 数组当夹具体正是上面那个缺陷逃过测试的原因，别再改回去。

### client 端（lib/client.js）

- 格式是手工的 `window.__ModuleLoader__.load({ id, factory })`，factory 是 lazy CJS 风格，最终 `exports.apply` / `exports.inject`。**不要改成 ESM**，不要引入打包器。
- `inject = ["slots", "locale", "connection"]` 对应 `ctx.slots` / `ctx.locale` / `ctx.connection`。
- 槽位用 `conversation.chat.assistant-actions`：**list 类**槽位，与反馈按钮等其它插件共存；每轮收尾消息渲染一次，owner 提供 `messageId`。**轮号不要在前端推导**（0.6.0 曾扫 `snapshot.chat.nodes` 猜 `node.location.turn.turn`，实测恒为 null、徽章根本不渲染）：把 `messageId` 交给宿主，由宿主用 `messageTurnsOf` 在自己的事件日志里映射到 `turn`。
- **不要用** `conversation.chat.turnTail`：它是 chain 类槽位（先注册者独占），被 deliverables 插件占用。
- RPC 调用信封（关键）：

  ```js
  const result = await ctx.connection.rpc.call("/api", "turnCost/query", {
    args: { request: { sessionId, messageId } },
  });
  // result 形如 { ok: true, value } 或 { ok: false, error: { code, message } }
  ```

- **失败必须说出来**（0.6.1）：`rpc()` 统一返回 `{ ok: true, value }` / `{ ok: false, code, message }`，并在失败时 `console.warn` 出网关错误码。组件据此区分「有数字／查询失败／未计费／查询中」四种文案；**失败时绝不能把官方统计条的 token 渲染成一行看似正常的读数**——那正是「显示统计条≠费用查询成功」的来源。徽章保持安静（不渲染），读数条显式写「费用查询失败」并带错误码。
- 多语言：`ctx.locale.register(NS, { zh, en })`，两个字典**键集合必须一致**，以 zh 为真源。新增文案两边都加。

### 计费核心不变式（lib/fold.js）

- 会话日志是 zstd 多帧 JSONL（`session[.v<N>].jsonl.zstd`；v0 时代是裸名 `session.jsonl.zstd`，v2 起为版本化名），帧魔数 `28 B5 2F FD`（小端 `0xFD2FB528`），用 node 内置 `node:zlib` 的 `zstdDecompressSync` 解帧。**这条路径自 0.5.3 起只是 `sessionQuery` 不可用时的兜底**（见上）。
- **折叠规则**：按 `(turn, step)` 为键，后到的样本覆盖先到的（流式 chunk 的 usage 样本被该步最终的 `assistant/message` usage 取代）。**求和前必须先折叠**，否则同一步被重复计费。
- **峰谷价**：官方 CNY 卡（api-docs.deepseek.com/zh-cn/quick_start/pricing/，2026-08-17 起生效）内置于 `OFFICIAL_CNY`（元/百万 token）。工作日高峰 = 9:00–12:00、14:00–18:00 北京时间；2026-08-23 00:00 北京时间起，周六、周日全天为空闲价。`isPeak` 用 UTC 时间戳换算北京时间，不依赖宿主机时区；生效点前仍保留旧的每日峰谷规则。跨峰谷的一轮按**每步实际时间**分别计价。
- **价表分档（`history`）**：条目可带 `history: [{ before, peak, offPeak }]`——`before` 之前的样本用该历史卡，其余用条目自身的当前价；`effectiveRateEntry(entry, time)` 负责选档，`costOfStep` 对带 `history` 但无 `time` 的样本返回 null（**不猜档**，与「未知模型不编造」同源）。官方案例：Flash 家族 2026-09-10 12:00 重定价，旧卡 `FLASH_CARD_2026_08_17` 挂在 `history` 里，历史会话金额不被新价重算。
- **未知模型**：`costOfStep` 返回 null，该步计入 `unpriced`、从金额里剔除——**绝不编造价格**，宁可不计价。订阅路由（Kimi/Qwen/GLM/MiniMax 等）正是靠这条走「只显 token」。
- **官方没有价表可复用**（2026-10-03 核实）：子系统索引 `docs/subsystems/README.md` 无 cost/pricing/billing 页；`packages/llm` 下只有 adapter/retry/token-meter 等，没有任何价格表；`ctx.llm` 只提供 `imageRequestPricing`（图片计价，非文本 token 单价）；`dsh-token-meter` 自述其数值「是参考值，不是账单」（"Occupancy is a reference figure, not a billing record"）。**所以内置费率卡 + 本地 `rates.json` 叠加是官方缺口下的最小必要实现，不是重复建设。**
- **计价原料仍取 provider 上报的 usage**（`assistant/message` 的 `usage` / 流式 `usage` chunk），不换成 `dsh-token-meter` 的估算：后者对「请求信封与上次成功调用一致」以外的情形走下估计启发式，口径与本插件「只用真实 usage」的承诺不同。


## 三、官方价表更新流程

DeepSeek 调价（官网定价页变化）时：

1. 改 `lib/fold.js` 的 `OFFICIAL_CNY`（窗口变了连 `isPeak` 与对应生效时间常量一起改，并保留历史规则）；
2. **保留历史规则的做法**：不要把旧价直接删掉——把当前价写进条目顶层（`peak`/`offPeak`），把**被取代的旧卡连同生效时点**塞进该条目的 `history: [{ before: <ms>, peak, offPeak }]`，并导出该时点常量（如 `FLASH_REPRICE_EFFECTIVE_MS`）。同一张官方卡覆盖的**所有模型 id 都要一起改**（含已退役但服务端仍兜底服务的旧名）；全新模型 id 直接给当前价、不要造历史档；
3. 同步 README「计费口径」里的生效日期与链接；
4. 写 CHANGELOG、bump 版本号；
5. 发布 npm（见下）；
6. 更新本机 profile 里的安装副本并重启 DSH web。

> 已知待办：官方公告 `deepseek-v4-pro` 自 2026-09-14 12:00 北京时间起路由到 V4.1 Flash 并按 Flash 价计费——该切价尚未编码（`lib/fold.js` 内有注释标记），到点前按本流程补一轮。

## 四、本地开发与验证

```bash
npm ci --ignore-scripts --no-audit --no-fund   # 按 lockfile 安装（宿主包 pin 与运行时一致）
npm test                                        # 全部单元/行为测试
npm run check                                   # 四个 lib/*.js 的 node --check
node tools/peer-compat.mjs --runtime <dsh --version>   # peer 模型 + 宿主版本核对
```

真实日志只读抽查（node 一行脚本）：`readSessionSamples("<sessions根目录>", "<sessionId>")` → `costOfTurn(samples, 轮号)`，核对 token 数与金额。注意这条走的是**兜底**日志路径；官方路径是 `ctx.sessionQuery`，两者的折叠结果由 `test/session-source.test.mjs` 断言一致。

### 接入方式（唯一路径）

本插件只通过官方机制接入，**没有仓库内的安装器/启动脚本/宿主版本固定**：

```powershell
# 本地工程路径（link:，改代码重启该 profile 即生效）——日常开发用这条
dsh plugin --profile <profile> add <本仓库绝对路径>

# npm 包名 / Git 仓库 / tarball
dsh plugin --profile <profile> add dsh-turn-cost
dsh plugin --profile <profile> add github:WFMinerva/dsh-turn-cost
dsh plugin --profile <profile> add <绝对路径>.tgz

# 应用内：侧边栏「插件」页 → 添加插件（接受包名、Git 地址、tarball、绝对本地路径）
```

官方会自己完成：安装、依赖解析、把包名追加进 `dsh.profile.bundles`、profile 补丁分层、以及插件卸载时的注册清理。**不要手写 profile 清单**。

- **bundle 成员是启动期决定的**：装完/卸完要重启该 profile（`dsh web` 重起；桌面应用完全退出再打开）。普通配置改动才走热重载。
- 桌面应用**独占** `profiles/desktop`，官方明确 CLI **不能 boot** 该 profile；管理它要先完全退出应用。
- `dsh plugin` 是 pnpm 转发器。应用启动的会话里 PATH 已注入；普通终端若被系统 corepack 拦（`[ERROR] This project is configured to use npm`），用应用自带 pnpm 做垫片即可（`<app>\resources\runtime\pnpm\bin\pnpm.mjs` + 自带 node）。

### peer 模型（0.6.0 起必读）

官方 dsh **自 0.2.0 起**在启动与安装时用 semver 校验插件的 `@deepseek-ai/dsh*` peerDependencies（`{ includePrerelease: true }`），不满足即**整包拒载**：

```
dsh: skipping profile bundle "dsh-turn-cost": Error: Plugin dsh-turn-cost@0.5.2 is
incompatible with dsh 0.2.0-rc.2: peerDependencies {...}. ... Exact-version exemption: not active.
```

0.5.2 就是这样「装着但起不来」的。**本项目的应对不是去猜一个安全区间，而是消除这个判定面**：

- 宿主提供的包（`@deepseek-ai/cordis`、`dsh-home-paths`、`dsh-typert-protocol`）在 `peerDependencies` 里声明为 **`"*"`**——`"*"` 对任何版本都成立，门禁**不可能**因区间拒载本插件。这也是本机官方可安装参考件 `dsh-notion` 的做法。
- 被复核过的**精确**版本写在 `devDependencies`（`4.0.4` / `0.2.0-rc.2` / `0.2.0-rc.2`，与桌面运行时逐项一致）。这才是「本实现针对哪个宿主 API 写的」的诚实记录。
- 升级宿主 → 重新核对这三个包的 API 面 → 改 `devDependencies` 与 `tools/peer-compat.mjs` 的 `HOST_PACKAGES`/`REVIEWED_RUNTIME` → `npm ci` 更新 lockfile → 跑测试与真实宿主验证。

顺带记住两个官方判定细节（`tools/peer-compat.mjs` 已用标准 `semver` 复现，不要自己写区间数学）：

1. **`includePrerelease` 让普通上界变弱**：`<0.3.0` **会接受 `0.3.0-rc.1`**（对本机运行时的 semver 7.8.5 实测）。
2. **`peerDependenciesMeta` 不豁免**：判定只看 `peerDependencies` 里的 `@deepseek-ai/dsh*` 键，`optional: true` 不参与。

### 怎么算「验证通过」

按官方路径装到**真实 profile**，然后用官方 Inspect 能力核对三层，缺一层都不算通过：

| 层 | 官方手段 | 通过的样子 |
|---|---|---|
| 组合 | `dsh <profile> --dump-config` | 出现 `- id: turn-cost / name: dsh-turn-cost`，且**没有** `incompatible` / `skipping` 告警 |
| host 挂载 | `cordis_inspect_query` → host `Config.listConfigs` | `include:turn-cost` → `status: "schema"`、`packageDir` 指向 profile 的 `node_modules\dsh-turn-cost`、**投影出插件自己的 Config schema** |
| client 注册 | `cordis_inspect_query` → client `Slots.listSubTree {"root":"conversation.chat.assistant-actions"}` | `selected.occupants` 里出现 `{ id: "turn-cost", active: true }` |

**「装得上」「dump-config 正常」「HTTP 200」都不算运行成功。** 上面三层只证明「挂上了、注册了」，**不证明取到了数**；还要走第 4 层。

#### 第 4 层：真实数据 + 真实浏览器（0.6.1 起，定位「界面只显示 token」那类问题的唯一有效手段）

0.6.0 的教训：三层验证全绿、界面也确实渲染了读数条，但**金额恒为 `?`**——因为主机端读错了字段。要抓这类问题，必须在能读控制台的地方跑真实会话：

1. **隔离宿主**（不碰正在用的 profile）：`$env:DSH_HOME='C:\Temp\dsh-tc-iso'; dsh <名字> --from-default-profile web --dump-config` 建 profile，再 `dsh plugin --profile <名字> add <本仓库目录>`，然后 `dsh --profile <名字> --no-open --port 19401` 起宿主。
2. **喂真实数据**：把 `<真实 DSH_HOME>\storages` 与目标会话目录（`sessions\<工作区>\<sessionId>`）**复制**进隔离 home（别用 junction，宿主可能在启动时迁移日志）。启动行会打印带 `?token=` 的 URL。
3. **无头浏览器 + CDP**：`chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<临时目录>`；用 CDP 的 `Network.enable` + `Runtime.enable` 抓 `POST /api/turnCost/*` 的**请求体与响应体**，`Runtime.evaluate` 读 DOM 文本，并可从 React fiber 上读组件**实际收到的 props**（`Object.keys(el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))].memoizedProps)`）——「props 有没有送到」这类疑问只有这一招能一次问清。
4. **核对算术**：`turnCost/sessionTotals` 的各分桶必须等于逐轮 `turnCost/query` 之和，且与界面文本一致；模型名必须来自日志而不是当前预设。
5. 官方 `sessionQuery` 的 live 优先语义、`Session.snapshotEvents()` 这些形状，以 **app.asar 内实际安装版本**的源码为准（`dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js` 等）。

隔离宿主的 client 半有 HMR：改 `lib/client.js` 会在页面里自动重载；**host 半改动必须重启隔离宿主**才生效（桌面宿主同理——它是 `link:` 到仓库，重启才加载新 `lib/index.js`）。

## 五、发布流程

1. `package.json` 里 bump `version`，CHANGELOG 记一笔，`npm install --package-lock-only` 让 lockfile 跟上；
2. `npm test` + `npm run check` + `node tools/peer-compat.mjs --runtime <宿主版本>` 全绿；
3. 按官方路径在真实 profile 上装一次，过 §四 的三层验证表；
4. `git add -A && git commit && git push`；
5. `npm publish`——npm 账号 `wfminerva` 开了 2FA，发布会触发交互式网页认证（"Authenticate your account at … Press ENTER"），**必须在机主能点网页的终端里跑**，AI 代办不了认证那一步。

> 打包注意：本包是**纯 JS + 已就绪的 client bundle**，官方要求「启动时 `lib/client.js` 已存在」，所以**没有也不需要构建步骤**。`git`/`npm` 方式拿到的是仓库/包里的 `lib/`，必须存在于提交与包内容中（`files` 白名单已覆盖）。


## 六、设计决策记录（为什么这么做）

改任何一个决策前，先读对应的理由。

1. **为什么是独立插件，而不是在现有 token 计量插件上改？** 独立包可以零依赖共存、独立发版、互不干扰；改上游包要等合并、有维护耦合。共存已实测：`assistant-actions` 是 list 类槽位，与 deliverables 等插件的产物条互不冲突。
2. **为什么价格表内置、不联网拉官方定价？** 官方定价页没有面向机器的稳定接口；联网会破坏本插件「零网络零上报」的隐私承诺。官方调价时发版更新（流程见 §三），成本低。
3. **为什么金额是「估计值」而不是账单？** 计价原料是 provider 上报的 usage token 数；官方账单另有口径（活动折扣、账单级缓存策略等），本地日志无法复现。README 明示「不构成账单」。
4. **为什么 cacheWriteTokens 统计了却不计费？** 官方 CNY 价表只有「输入 / 缓存读 / 输出」三档单价，缓存写没有官方价；计入就等于编造价格，违反「不编造」原则。保留统计，等官方出价即可补上。
5. **为什么缓存命中率 = cacheRead ÷ (input + cacheRead)？** 衡量输入侧的缓存节省效果；分母不含 output（输出与缓存无关）。与 dsh 自带 token 计量的口径一致。
6. **为什么 0.2.0 之前没有设置界面？** 当时价格是官方口径，无可配置项，`static Config = z.object({})`。0.2.0 起 Config 接受 `ratesPath`（自定义费率表路径，见决策 11）；仍不做 GUI 设置页——费率表是低频改动的文本文件，用户层 `cordis.patch.yml` 同 id 覆盖即可（用户层后应用、同 id 行胜出）：

   ```yaml
   - id: turn-cost
     name: dsh-turn-cost
     config:
       ratesPath: C:\Users\<你>\.dsh\turn-cost-rates.json
   ```

   **不配也能用**：内置官方 CNY 卡覆盖 DeepSeek 按量路由，内置额度路由（Kimi loopback / 阿里 `bl`）也不依赖该文件。配它的意义是**让你自己维护的那张表真的生效**（否则文件被静默忽略），以及给订阅路由登记 0 价（避免被计为 `unpriced`）。改完要重启宿主才生效（组合在启动时装载）。
7. **为什么单测只测 fold.js？**（0.6.1 修正）计费口径是正确性核心，fold.js 被刻意设计成零依赖纯函数，`node --test` 直接跑、无网络无安装。但**只测纯函数不够**：0.6.0 的 `foldFor` 读错字段却全绿，因为测试夹具用的是自造的 `events` 数组。现在 `test/session-source.test.mjs` 用**官方形状**的假 `Session`（私有 `log` + `snapshotEvents()`、无 `events`）真实实例化 `TurnCostService`，`test/client-quota.test.mjs` 用假 React 真实渲染两个组件；UI 的**肉眼观感**仍靠人看。
8. **为什么徽章失败渲染为空、不弹错？**（0.6.1 补充）信息性组件，**永不阻塞 UI**；但「静默」只保留在**视觉**上——失败一律 `console.warn` 出网关错误码，读数条还会显式写「费用查询失败（错误码）」。0.6.0 把失败压成 `null` 后借用官方 token 数渲染，制造了「看起来在工作」的假象，这类静默已被禁止。
9. **为什么客户端缓存 RPC promise 但失败不缓存？** 徽章重挂载频繁，成功结果按 `(sessionId, messageId)` 缓存（上限 200 条）；失败/未就绪不缓存，下次挂载自动重试，避免徽章被钉死成不可见。
10. **为什么历史 commit 的 author 是旧中文名却不改？** 公开仓库、已被社区 list 收录，改写历史会破坏 fork 与引用；新 commit 用新署名，新旧共存属正常现象。
11. **为什么费率表是"叠加"而不是"替换"？**（0.2.0）自定义 rates.json 经 `mergeRates(builtinRates(), custom)` 按模型名逐项覆盖内置官方卡：用户只写自己关心的模型，DeepSeek 官方价永远兜底；文件缺失/损坏回退内置卡并记 warn，插件不死。
12. **为什么订阅制模型在费率表里配 0 价而不是缺席？** 缺席 = `unpriced`（语义：未知价，绝不编造）；配 0 = 价格已知为 0（订阅口径）且计入 `priced`。两者在汇总里分开统计，避免"有价的 0"和"没价"混为一谈。
13. **为什么跨对话汇总走 host 端枚举日志，而不是 client 端 `useSessions` 投影？**（已废弃：0.5.0 移除汇总面板）会话摘要行的 `projectionValues.tokenUsage` 只有四桶聚合值，**无时间戳、无模型名**；"按天/按模型"分组必须有 (time, model, buckets) 粒度的样本，只有扫日志拿得到。纯 client 路径被调研后否决（调研记录见 tool-library `docs/方案-DSH对话额度表.md`）。0.5.0 起该功能整体移除——150+ 会话全量枚举约 27 秒且客户端无超时提示，机主判定无用。
14. **为什么汇总按会话粒度签名缓存，而不是整表一个签名？**（已废弃：0.5.0 移除汇总面板）150+ 会话全量解压只有首次贵；`summaryCache` 以 `sessionId → size:mtime|live事件数` 为签名，重复打开汇总面板只重算变化过的会话。
15. **为什么会话级读数条挂 `conversation.composer.dock`？** 官方注释明确该 list 槽位就是统计条所在的环境读数带（"the shipped stats line lives here"），并列共存不替换；`conversation.chat.turnTail` 照旧禁用。
16. **为什么读数条的 token 口径可以直接对比官方统计条？** 官方 `tokenUsage` 投影的 `uncachedInputTokens` 就是 provider 上报的 `usage.inputTokens`（dsh-client-connection `tokenUsageOf` 实现），与 fold.js 的 `inputTokens` 桶同源；0.2.0 实测 5 个真实会话逐桶 MATCH。
17. **为什么「还剩多少」读平台端点、且不显示「本对话占比」？**（0.3.0 门二 v2 → 0.4.0 改口径）0.3.0 曾按请求数算「本会话占比」（本地日志里落在当前窗口的调用数 ÷ 窗口上限），但该占比是**估计值**（DSH 日志调用步数与平台计费请求数非严格 1:1，SDK 重试/缓存命中/续接重放的步可能不被计作新请求），且与官方 used 读数对不上（实测本地 62 次 vs 官方 53）。0.4.0 起**移除占比显示**，只显官方实时剩余次数/比例；剩余必须取平台实时值——同一池子还被 Kimi CLI/桌面端消耗，本地日志看不见它们。端点成功 60s TTL 缓存、失败 10s 防打爆。
18. **为什么阿里 Token Plan 不做单对话占比？** Credits 按模型分档动态抵扣（思考模式/工具调用影响），官方无公开系数表、明说「以控制台为准」，且实测 qwen 路由日志 usage 只有 token 四桶、无 Credits 字段——精确归因不可得，门二 v2 拍板不做（不编造），只显示窗口已用/剩余。
19. **为什么额度插件不读 `.credentials.yaml`？**（0.4.2 纠错）DSH 中的 Kimi/Qwen API Key 是模型调用凭据，不等于套餐额度凭据。Kimi 额度由 Kimi Code OAuth loopback 提供，Qwen 额度由百炼 CLI 的控制台 OAuth 提供；插件不得解析、复制或重用模型 Key。
20. **为什么金额不设全局开关、而是按路由分流？**（0.3.0 门三修正）最初门二 v2 拍「金额默认隐藏可配置」，但机主实测发现这会把官方按量 DeepSeek 的金额也藏掉（那是 0.1.3 起就在的正确功能）。修正后：金额跟随「该轮 provider 是否按量计费」——官方按量路由 `cost>0` 即显示 ¥；订阅路由 0 价登记 → 只显 token + 额度读数。不要再引入会覆盖官方按量金额的全局开关。
21. **为什么 Kimi 额度只保留 loopback OAuth？**（0.4.2）双机实测证明模型 API Key 可以完成推理，却不能可靠读取套餐额度；此前把一次特定凭据的直连成功推广为通用默认是错误判断。唯一受支持的额度路径是 `~/.kimi-code/server.token` + `127.0.0.1:58627/api/v1/oauth/usage`。配置守卫只接受 loopback HTTP，远程 HTTPS、外部 HTTP host 与旧 `credentialRef` 都丢弃。
22. **为什么价表要按时间分档、而不是直接改数字？**（0.5.1，Flash 重定价）金额徽章对**历史会话**也要显示——直接换数字会让 2026-09-10 12:00 之前的旧会话按新价重算，把已经花掉的钱显示错。分档让「当时生效的卡」可被复现，代价只是每个改价条目多一个 `history` 数组与一组边界测试。这与周末规则「生效点前保留旧规则」是同一条原则；**不要**为了省事把旧卡删掉。

## 七、0.2.0 新增件的维护要点

- **新增 `@Remote` 端点**：照抄 `lib/index.js` static 块里 `sessionTotals`/`quota` 的 `__esDecorate` 调用（先声明 `_xxx_decorators` 变量再装饰），参数名 `request` 是 wire 协议的一部分。
- **费率表 schema**（`rates.json`，version 1）：`{ currency, models: { <model>: 平价{input,cacheRead,cacheWrite?,output} | 峰谷{peak,offPeak} }, aliases }`；schema 演进时 bump `RATES_VERSION`（fold.js）并写迁移说明。
- **费率表可选 `history`（0.5.1，纯增字段，version 不变）**：条目可再加 `history: [{ before, peak, offPeak }]`，语义与内置表一致（`before` 之前用该档）；用户写了 `history` 就与内置条目同等对待。注意**平价覆盖会连带丢掉内置历史档**——用户若只想改当前价又不想丢历史精度，应写 `history` 而不是整条替换（`rates.example.json` 的 `deepseek-v4-flash` 条目有提示文案）。
- **`listSessions` 的目录约定**：`<dsh-home>/sessions/<workspace>/<sessionId>/session[.v<N>].jsonl.zstd`；目录不可读/文件缺失一律跳过，枚举永不抛。
- **会话日志命名两代（0.5.2）**：`sessionLogBaseName(generation)` 给出基名（`0` → `session.jsonl`，`N>0` → `session.v<N>.jsonl`），`pickSessionLogName(sessionDir, suffix)` 扫目录并**偏好最高版本**（迁移后的会话目录里 v0 原件与 v3 新件并存，取新版；一个目录仍只产出一条记录，不重复计数）。宿主侧 Windows **不落 `session.lock`**（内核命名信号量），解析不依赖锁文件。新增格式代（v4…）时该正则自动兼容，无需再改。
- **单测里的临时目录**：Windows 上首次 `mkdtemp`+写删可能触发杀软扫描（首跑 ~36s，之后 <100ms），属环境噪声不是回归。
- **host 端改动需重启 dsh web 生效**（web profile 禁用 host 插件 HMR）；client bundle（client.js）覆盖到 profile 后由常驻 HMR 热更新（rev 变化触发，React 状态不保留）。
- **Config/schema 只能用 schemastery 语法**：`z` 是 `@deepseek-ai/schemastery` 不是 zod——对象字段缺省即可选，**没有 `.optional()`/`.nullable()`/`.parse()` 这些 zod 链式方法**；误用会在插件 import 阶段静态初始化器抛错，cordis 整树拒载、**dsh web 启动直接崩**（2026-08-24 实锤，见方案文档变更记录 #4）。改 Config 后必须真实启动一次 dsh web 验证——单测覆盖不到 host 侧。
- **quota 端点（0.5.0）**：`turnCost/quota` 平台读数 TTL 缓存（成功 60s / 失败 10s）；Kimi 只走 loopback `GET /api/v1/oauth/usage`（`normalizeKimiLocalUsage`），阿里走固定参数的 `bl usage token-plan --output json`（`normalizeAliyunBl`）。稳定错误码为 `kimi-server-token-not-found`/`kimi-server-unavailable`/`kimi-output-unrecognized`/`bl-not-found`/`bl-failed`/`bl-output-not-json`/`bl-output-unrecognized`。
- **Kimi 服务自动拉起（0.5.0，K2）**：`fetchKimiQuota` 前先 `ensureKimiServer(baseUrl)`——默认端口 `127.0.0.1:58627` 上服务未健康且端口未被他人占用时，用 `~/.dsh/turn-cost-tools/node_modules/.bin/kimi.cmd`（固定版本）spawn `kimi web --no-open --port 58627`，20s 内轮询 `/api/v1/healthz`；超时则关闭自己启动的实例。`kimiChild` 记录本插件启动的子进程，卸载时 `stopSelfKimiServer` 先经官方 `/api/v1/shutdown` 再 kill。非默认端口或工具缺失一律不拉起（降级为 `kimi-server-unavailable`）。
- **阿里 bl 默认路径（0.5.0，C 方案）**：`fetchAliyunQuota` 的默认命令优先 `~/.dsh/turn-cost-tools/node_modules/.bin/bl.cmd`（`toolsBin` 存在且文件在位时），否则回退 PATH 上的 `bl`；`quota` 块的 `command` 仍可覆盖。
