# dsh-turn-cost 开发与维护指南

> 给接手维护这个项目的人（包括新开一个对话的 AI）看的完整地图：仓库结构、DSH 插件机制的关键坑、计费口径的不变式、发布流程。**改代码前先通读本文。**

## 一、仓库结构与职责

| 文件 | 职责 | 注意 |
|---|---|---|
| `lib/fold.js` | 纯计费核心：zstd 日志解帧、按 (轮,步) 折叠 usage、峰谷计价 | **零依赖**，可直接被 node 单测；所有金额口径都在这里 |
| `lib/index.js` | host 端服务：`TurnCostService`，Typert Remote 端点 `turnCost/query` | 顶部 `__esDecorate` 是手工转译的 stage-3 装饰器，**不要删** |
| `lib/client.js` | 浏览器 bundle：`assistant-actions` 槽位里的灰色金额行 | 手工写的 `window.__ModuleLoader__` CJS 格式，**不需要打包器** |
| `cordis.patch.yml` | bundle patch：往 profile 插入一行 `turn-cost` | 用户层可用同 id 覆盖（用户层后应用、同 id 行胜出） |
| `test/fold.test.mjs` | `fold.js` 的纯函数单测 | `node --test test/` 运行，无网络无依赖 |
| `package.json` | 双重身份：npm 包清单 + DSH bundle 清单（`dsh` 字段） | `files` 白名单只有 `lib` 和 `cordis.patch.yml`；docs/test 只进 GitHub 不进 npm（有意为之） |

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

- 服务类继承 `TypertRemoteService`，构造函数里 `super(ctx, "turnCost")` 定 RPC 命名空间；`static inject = ["sessions"]` 声明依赖的上下文服务。
- 方法用 `@Remote("query")` 装饰器暴露为端点 `turnCost/query`。DSH 走 SRC 发现，**不需要生成 typert 清单文件**。
- **装饰器是坑**：Node 24 不执行装饰器语法，而 typert 协议依赖装饰器留下的 metadata，所以必须保留装饰器写法并手工转译——`lib/index.js` 顶部那两段 `__esDecorate` / `__runInitializers` 就是转译产物。新增 `@Remote` 方法时，照抄 static 块里对 `__esDecorate` 的调用方式再加一行，不要改写成普通对象注册。
- 方法签名没有默认值时，网关按签名推导 wire 参数名：`async query(request)` → 客户端必须以 `request` 为参数名传（见下）。改参数名＝改 wire 协议，两边要同步。

### client 端（lib/client.js）

- 格式是手工的 `window.__ModuleLoader__.load({ id, factory })`，factory 是 lazy CJS 风格，最终 `exports.apply` / `exports.inject`。**不要改成 ESM**，不要引入打包器。
- `inject = ["slots", "locale", "connection"]` 对应 `ctx.slots` / `ctx.locale` / `ctx.connection`。
- 槽位用 `conversation.chat.assistant-actions`：**list 类**槽位，与反馈按钮等其它插件共存；每轮收尾消息渲染一次，owner 提供 `messageId`。轮号从会话快照反查：扫 `snapshot.chat.nodes`，找 `node.data.closing.finalNode.messageId === messageId` 的节点，取 `node.location.turn.turn`。
- **不要用** `conversation.chat.turnTail`：它是 chain 类槽位（先注册者独占），被 deliverables 插件占用。
- RPC 调用信封（关键）：

  ```js
  const result = await ctx.connection.rpc.call("/api", "turnCost/query", {
    args: { request: { sessionId, turn } },
  });
  // result 形如 { ok: true, value } 或 { ok: false, error }
  if (result?.ok === true) return result.value; // value 才是业务数据
  ```

- 多语言：`ctx.locale.register(NS, { zh, en })`，两个字典**键集合必须一致**，以 zh 为真源。新增文案两边都加。

### 计费核心不变式（lib/fold.js）

- 会话日志是 zstd 多帧 JSONL（`session.jsonl.zstd`），帧魔数 `28 B5 2F FD`（小端 `0xFD2FB528`），用 node 内置 `node:zlib` 的 `zstdDecompressSync` 解帧。
- **折叠规则**：按 `(turn, step)` 为键，后到的样本覆盖先到的（流式 chunk 的 usage 样本被该步最终的 `assistant/message` usage 取代）。**求和前必须先折叠**，否则同一步被重复计费。
- **峰谷价**：官方 CNY 卡（api-docs.deepseek.com/zh-cn/quick_start/pricing/，2026-08-17 起生效）内置于 `OFFICIAL_CNY`（元/百万 token）。高峰 = 9:00–12:00、14:00–18:00（服务器本地时间＝北京时间），其余谷价。跨峰谷的一轮按**每步实际时间**分别计价。
- **未知模型**：`costOfStep` 返回 null，该步计入 `unpriced`、从金额里剔除——**绝不编造价格**，宁可不计价。
- **数据源**：持久日志在 `<dsh-home>/sessions/<workspace>/<sessionId>/session.jsonl.zstd`；host 把它与运行中会话的 live 事件合并（同 `(turn, step)` live 胜出），签名缓存（`size:mtime` + live 事件数）失效重算。

## 三、官方价表更新流程

DeepSeek 调价（官网定价页变化）时：

1. 改 `lib/fold.js` 的 `OFFICIAL_CNY`（窗口变了连 `isPeak` 一起改）；
2. 同步 README「计费口径」里的生效日期与链接；
3. 写 CHANGELOG、bump 版本号；
4. 发布 npm（见下）；
5. 更新本机 profile 里的安装副本并重启 DSH web。

## 四、本地开发与验证

本机路径（机主环境）：

- 开发仓库：`D:\Workspaces\dsh-turn-cost`（origin 是 SSH：`git@github.com:WFMinerva/dsh-turn-cost.git`；本机直连 github.com 网页可能不通，**SSH 推送正常**）
- 安装副本：`C:\Users\Admin\.dsh\profiles\web\node_modules\dsh-turn-cost`（npm 装的；改完代码要发版后在此目录 `pnpm add dsh-turn-cost@最新版` 更新，或手工把 `lib/`、`package.json`、`cordis.patch.yml` 覆盖过去）
- 验证 UI：重启 DSH web，刷新 http://127.0.0.1:3080，看每条 AI 回复下方的灰色金额行

```bash
node --test              # 纯函数单测，秒级（默认 glob 自动匹配 test/*.test.mjs）
```

用真实日志抽查（node 一行脚本）：读某会话的 `session.jsonl.zstd` → `readSessionSamples("<sessions根目录>", "<sessionId>")` → `costOfTurn(samples, 轮号)`，核对 token 数与金额。

## 五、发布流程

1. `package.json` 里 bump `version`，CHANGELOG 记一笔；
2. `git add -A && git commit && git push`（SSH 通道）；
3. `npm publish`——npm 账号 `wfminerva` 开了 2FA，发布会触发交互式网页认证（"Authenticate your account at … Press ENTER"），**必须在机主能点网页的终端里跑**，AI 代办不了认证那一步；
4. 发布后更新本机安装副本（见上）并重启 DSH web。

## 六、设计取舍备忘（改之前先想清楚）

- 金额是**估计值**（provider 上报 token × 官方单价），README 明确写了「不构成账单」——不要改成调 API 查账单（违反零网络原则）。
- 徽章失败渲染为空、不弹错：信息性组件，**永不阻塞 UI**。
- 客户端有 per-(session,turn) 的 RPC promise 缓存（上限 200），失败不缓存以便重挂载重试。
- 历史 git 提交里早期 author 是中文名（改名前的），**不要改写历史**——公开仓库，已被社区 list 收录。
