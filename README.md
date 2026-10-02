# dsh-turn-cost

[![featured in awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-featured-2ea44f)](https://github.com/beancookie/awesome-dsh-plugin)

DeepSeek Harness（dsh）Web UI 插件：**按对话实际用的路由分流显示**——官方按量模型（DeepSeek）显示金额（¥），Kimi 订阅显示「本轮 token + 7 天周额度剩余次数 + 加油包余额（¥）」，阿里 Token Plan 订阅显示「本轮 token + 7 天限额剩余比例」；另有会话级累计。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) web plugin that shows, per conversation and per turn, **which route the model actually used**: pay-as-you-go DeepSeek turns show money (¥) while Kimi subscription turns show tokens plus the 7-day weekly remaining count and booster-wallet balance (CNY), and Alibaba Token Plan turns show tokens plus the 7-day quota remaining share; session-level totals round it out. Ships the [official DeepSeek CNY peak/off-peak rates](https://api-docs.deepseek.com/quick_start/pricing/) and accepts your own rate table.

> 官方按量：本轮 ¥0.23 · 1.2万 token · 缓存读 98% ／ Kimi 订阅：本轮 12.3万 token · 7 天还剩 47 次 · 余额 ¥28.79 ／ Qwen 订阅：本轮 3.4万 token · 剩余 40%

- **订阅额度窗口（0.5.0）**：Kimi 订阅只走 Kimi Code 官方 loopback OAuth 服务读取 7 天周额度窗口与加油包余额；**服务没在跑时插件自动拉起**（只管理自己启动的实例），直接启动 DSH 也能显示。阿里 Token Plan 走官方 `bl usage token-plan` CLI（默认认死 `~/.dsh/turn-cost-tools` 里固定版本的 bl，不依赖系统 PATH）——见下文「订阅额度窗口」
- **单对话/单轮占比**：Kimi 路由显示「本轮 token · 7 天还剩 N 次 · 余额 ¥X」（剩余次数与余额为官方实时读数）；阿里侧因 Credits 无法精确归因，只显示剩余比例（不编造消耗百分比）
- **人民币计价**，内置 [DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（峰谷按北京时间）——官方按量路由显示金额，订阅路由按 0 价登记只显 token
- **自定义费率表**：任意模型可配单价（含缓存写），订阅制模型按 0 价登记只显 token
- 金额基于 **provider 上报的真实 usage**（未缓存输入 / 缓存读 / 输出分桶计费），不是估算 token 数
- 一条用户消息引发的整轮（含中间工具步骤）合并计为一轮，绝不重复计
- 打开旧会话时，历史每一轮同样显示；会话级累计覆盖全部历史会话

## 效果

① 每条 AI 最终回复下方的图标行（复制按钮左侧）出现一行灰色小字：

```
本轮 ¥0.67 · 332万 token · 缓存读 100%
```

② 输入框下方（官方统计条同一带）出现本会话累计：

```
本会话 ¥15.42 · 3280万 token · 缓存读 99%
```

Kimi 订阅会话的读数条与每轮徽章会追加官方实时额度读数：

```
本轮 12.3万 token · 7 天还剩 47 次 · 余额 ¥28.79
```

- 金额精确到分，不足半分显示 `<¥0.01`（仅官方按量路由显示金额；订阅路由只显 token 与额度读数）
- token 数为总消耗（万为单位），口径与 dsh 官方统计条逐桶一致
- 缓存读占比 = 缓存命中 token ÷（缓存命中 + 未命中输入），一眼看出长对话的省钱效果

## 订阅额度窗口（0.5.0）

订阅路由**内置默认**（`kimi-coding` → 本机 Kimi Code OAuth、`qwen-token-plan-cn` → aliyun-bl），不写配置也会尝试读取；费率表 `quota` 块仅用于覆盖 loopback 端口、命令名或用 `enabled: false` 显式关闭：

```json
"quota": {
  "kimi-coding": { "kind": "kimi-usages", "baseUrl": "http://127.0.0.1:58627" },
  "qwen-token-plan-cn": { "kind": "aliyun-bl", "command": "bl" }
}
```

- **kimi-usages**：只访问 `127.0.0.1|localhost` 上的 Kimi Code 官方 OAuth 服务，默认 `GET http://127.0.0.1:58627/api/v1/oauth/usage`；读取 `${KIMI_CODE_HOME:-~/.kimi-code}/server.token` 仅用于本机 bearer 认证，host 端成功缓存 60 秒、失败缓存 10 秒。远程 HTTPS、外部 HTTP host 与旧 `credentialRef` 都会被配置守卫丢弃。**0.5.0 起**：默认端口上的服务未运行时，插件用 `~/.dsh/turn-cost-tools` 里固定版本的 kimi CLI 自动拉起（只关闭自己启动的实例），因此不经「启动 DSH（含额度）」直接启动 DSH 也能读到 Kimi 额度。
- **aliyun-bl**：调官方百炼 CLI `bl usage token-plan --output json`；运行“配置额度登录”后由 `bl auth login --console --console-site domestic` 完成浏览器 OAuth。0.5.0 起默认命令优先用 `~/.dsh/turn-cost-tools/node_modules/.bin/bl.cmd`（固定版本、不依赖系统 PATH），未安装时才回退到 PATH 上的 `bl`；未安装、控制台会话过期或输出不认得时都安静降级为「暂读不到」（可用 `command` 改可执行名）
- **占比口径**：Kimi 徽章与读数条显**7 天周额度剩余次数 + 加油包余额**（官方实时读数，不把请求次数伪装成额度消耗）；「本会话占比」不再显示
- 阿里 Token Plan 以动态 Credits 计量且官方未公开系数表，**不做单对话占比**（不编造），只显示窗口「已用/还剩」

平台读数失败时界面安静降级，永不阻塞。

## 原理

```
本机会话日志（zstd JSONL）
   └─ 按 (轮, 步) 折叠 provider usage（后到的同轮步样本覆盖先到的，不重复计）
        └─ 每步按费率表取价（内置官方 CNY 峰谷卡；rates.json 可叠加自定义模型价）
             ├─ 该轮求和 → 回复下方
             └─ 整会话求和 → 输入框下方
```

- host 端：扫描 dsh 会话日志（`<dsh-home>/sessions/**/session[.v<N>].jsonl.zstd`——v0 时代是裸名，v2 起为版本化名，本件认两代并取最高版本），与运行中的 live 会话事件合并折叠；通过 Typert Remote 网关暴露 `turnCost/query`、`turnCost/sessionTotals`、`turnCost/quota` 端点
- client 端：注册官方 slot `conversation.chat.assistant-actions`（每轮金额/额度读数）、`conversation.composer.dock`（会话累计，与官方统计条同带）

## 自定义费率表

内置价表只覆盖 DeepSeek 官方按量模型；订阅额度路由也**内置默认**，不配任何东西就能用。其它模型（自部署、中转、订阅制）用本机 JSON 文件叠加：

1. 复制 [rates.example.json](./rates.example.json) 到本机任意位置（如 `<dsh-home>/turn-cost-rates.json`），按注释口径改；
2. 在**你正在用的 profile** 的 `cordis.patch.yml` 里用同 id 覆盖插件配置（用户层后应用、同 id 行胜出）；桌面版就是 `~/.dsh/profiles/desktop/cordis.patch.yml`：

```yaml
- id: turn-cost
  name: dsh-turn-cost
  config:
    ratesPath: <dsh-home>\turn-cost-rates.json   # 改成你的实际路径
```

3. 重启宿主生效（插件组合在启动时装载）。

> **不配会怎样？** 官方 DeepSeek 按量金额与订阅额度读数照常工作（内置卡 + 内置路由）；只有**你这个文件本身被忽略**——自定义模型价、订阅路由的 0 价登记、`quota` 块里的端口/命令覆盖都不会生效。所以自己维护了这张表就一定要接上。

费率表口径：

- `models.<模型名>`：平价条目 `{ input, cacheRead, cacheWrite?, output }`（每百万 token 的元数，缺省按 0）；或峰谷条目 `{ peak: {...}, offPeak: {...} }`（按北京时间官方峰谷窗口取档）
- `aliases`：模型名归一化（如 `"k3": "k3-256k"`），解决同一模型多种写法
- **订阅制模型**（包月/额度套餐，无 token 单价）：四个单价都配 0 并写 `note`——token 照显，金额恒 0，不编造价格
- 未在表里的模型照旧计入 `unpriced`，绝不编造；文件缺失或损坏自动回退内置官方卡

## 隐私

**只读本机数据；Kimi 额度只访问本机 Kimi Code OAuth 服务，阿里额度由本机官方 CLI 访问其服务。**

- token 账与金额来自本机 dsh 会话日志与本机费率表 JSON，不出本机
- 0.4.2 起 Kimi 额度路由仅向 loopback 发只读请求；Kimi Code 与百炼 CLI 各自负责其官方 OAuth/网络通信，插件不接触模型 API Key
- Kimi server token 只在进程内用于 `127.0.0.1` 认证，**不打印、不复制、不写入报告或仓库**
- 界面上的金额是**估计值**（provider 上报 token 数 × 费率表单价），仅供个人参考，不构成账单；订阅套餐的实际额度以平台官方读数为准

## 计费口径与边界

| 项 | 口径 |
|---|---|
| 一轮 | 用户一条消息 → AI 最终回复（中间工具步骤合并） |
| 计费 | Σ 各步（未缓存输入×单价 + 缓存读×单价 + 缓存写×单价 + 输出×单价），峰谷条目按步时点取档 |
| 时段 | 北京时间；2026-08-23 起周末全天空闲价；**Flash 家族 2026-09-10 12:00 起按新价**（高峰 2.0/0.04/8.0、空闲 1.0/0.02/4.0 元每百万 token），此前历史调用仍按旧卡。两个生效点之前的历史调用一律按当时规则 |
| 模型 | 按 `request/header` 记录的模型查费率表（内置官方 CNY 价四档：Pro、**V4.1 Flash `deepseek-flash`**、退役 Flash、退役 Flash-Vision；同一官方卡按时间分档；自定义模型走 rates.json，支持别名与 `history` 历史档） |
| 不计 | 脚本直连 API 的调用、其它机器的会话、费率表里没有的模型（计 unpriced，不编造） |
| 额度读数 | Kimi 7 天周额度剩余 + 加油包余额（官方 loopback 实时读数）；阿里 7 天 Credits 窗口剩余比例（官方 bl CLI 读数）；订阅制模型不计金额 |

## 安装

本插件是**标准 dsh bundle**（`package.json` 里声明 `dsh.bundle` + `dsh.client`），安装与启用**全部由 dsh 官方负责**，本仓库不提供也不维护任何安装器、启动脚本或宿主版本固定：

| 方式 | 地址形式 | 命令 / 入口 |
|---|---|---|
| 官方 CLI | 本地工程路径 | `dsh plugin --profile <profile> add <本仓库绝对路径>` |
| 官方 CLI | npm 包名 | `dsh plugin --profile <profile> add dsh-turn-cost` |
| 官方 CLI | Git 仓库 | `dsh plugin --profile <profile> add github:WFMinerva/dsh-turn-cost` |
| 官方 CLI | 打好的 tarball | `dsh plugin --profile <profile> add <绝对路径>.tgz` |
| 应用内 | 以上任一 | 侧边栏「插件」页 → **添加插件** |

- **本地工程路径**是最省事的日常方式：pnpm 会把它装成 `link:`（指向你的检出目录），改完代码重启该 profile 即生效，不需要每次重新打包。
- `file:` 形式与裸目录路径的差别：**裸目录 → `link:`（符号链接，改代码即生效）**；`file:./路径` → 复制进 profile（等同于注册表安装，适合冻结版本）。
- 安装后 dsh 会自动把 `dsh-turn-cost` 追加进该 profile 的 `dsh.profile.bundles`——**这些你不用手写**。
- **重启该 profile 才生效**：bundle 成员是启动期决定的（`dsh web` 重新起、桌面应用完全退出再打开）。普通配置改动才走热重载。

```powershell
# 例：装进正在用的桌面 profile（桌面应用需先完全退出，装完再打开）
dsh plugin --profile desktop add F:\Workspaces\dsh-turn-cost

# 卸载
dsh plugin --profile desktop remove dsh-turn-cost
```

> **不需要构建步骤**：host 端与 client 端都是仓库里已就绪的产物（`lib/index.js` / `lib/client.js`），官方要求的是「启动时 `lib/client.js` 已存在」，本仓库始终满足。

## 兼容性

插件在 `peerDependencies` 里把宿主提供的包声明为 `"*"`，所以 **dsh 的兼容性门禁永远不会因为版本区间拒绝本插件**（官方 dsh ≥ 0.2.0 会在启动/安装时按 semver 校验 `@deepseek-ai/dsh*` peer，不满足即整包拒载并要求 `allow-version` 豁免）。

真正被钉住的是 `devDependencies`——那份**精确**版本才是本实现被复核过的宿主 API：`@deepseek-ai/cordis@4.0.4`、`@deepseek-ai/dsh-home-paths@0.2.0-rc.2`、`@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2`（与 dsh 0.2.0-rc.2 桌面运行时逐项一致）。升级宿主后要重新核对这三个包的 API 面，再调这三个 pin。

```powershell
node tools/peer-compat.mjs --runtime 0.2.0-rc.2   # 校验 peer 模型未被破坏
```

费率与额度口径见下文；本插件不联网拉价、不读凭据。



## 开发与维护

本项目持续维护中。接手开发（包括新开一个对话的 AI）请先读：

- [CURRENT_STATE.md](./CURRENT_STATE.md) — 实时状态：环境事实、已验证证据、未验证项
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — 完整地图：仓库结构、DSH 插件机制的关键坑、计费口径不变式
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- [Issues](https://github.com/WFMinerva/dsh-turn-cost/issues) — 维护 backlog

本地验证入口（`package.json` scripts 之外也能直接跑）：

```powershell
npm ci                                                   # 按 lockfile 装开发依赖（宿主包 pin 与运行时一致）
npm test                                                 # node --test，全部单元/行为测试
npm run check                                            # 四个 lib/*.js 的 node --check
node tools/peer-compat.mjs --runtime <dsh --version>      # peer 模型 + 宿主版本核对
```

**本仓库刻意不再包含的东西**（它们已归 dsh 官方，见 `docs/DEVELOPMENT.md` §二）：

- 没有安装器、启动脚本、回滚/卸载入口——用官方 `dsh plugin add/remove` 或应用内「添加插件」
- 没有固定宿主版本、没有 profile 路径假设——`dsh plugin` 自己维护 profile 与 bundle 清单
- 没有 `acceptance` 实机验收链——验收就是「按官方方式装上去、打开 UI 看读数」

## License

[MIT](./LICENSE)
