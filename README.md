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

- host 端：扫描 dsh 会话日志（`<dsh-home>/sessions/**/session.jsonl.zstd`），与运行中的 live 会话事件合并折叠；通过 Typert Remote 网关暴露 `turnCost/query`、`turnCost/sessionTotals`、`turnCost/quota` 端点
- client 端：注册官方 slot `conversation.chat.assistant-actions`（每轮金额/额度读数）、`conversation.composer.dock`（会话累计，与官方统计条同带）

## 自定义费率表

内置价表只覆盖 DeepSeek 官方按量模型。其它模型（自部署、中转、订阅制）用本机 JSON 文件叠加：

1. 复制 [rates.example.json](./rates.example.json) 到本机任意位置（如 `<dsh-home>/turn-cost-rates.json`），按注释口径改；
2. 在 `<dsh-home>/profiles/web/cordis.patch.yml` 用同 id 覆盖插件配置（用户层后应用、同 id 行胜出）：

```yaml
- id: turn-cost
  name: dsh-turn-cost
  config:
    ratesPath: <dsh-home>\turn-cost-rates.json   # 改成你的实际路径
```

3. 重启 dsh web 生效。

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
| 时段 | 北京时间；2026-08-23 起周末全天空闲价，生效前历史调用仍按旧规则 |
| 模型 | 按 `request/header` 记录的模型查费率表（内置 Pro / Flash / Flash-Vision 三档官方 CNY 价；自定义模型走 rates.json，支持别名） |
| 不计 | 脚本直连 API 的调用、其它机器的会话、费率表里没有的模型（计 unpriced，不编造） |
| 额度读数 | Kimi 7 天周额度剩余 + 加油包余额（官方 loopback 实时读数）；阿里 7 天 Credits 窗口剩余比例（官方 bl CLI 读数）；订阅制模型不计金额 |

## 安装

### 方式一：Windows 一键包（推荐）

1. 从 [Releases](https://github.com/WFMinerva/dsh-turn-cost/releases) 下载最新版 `dsh-turn-cost-setup-*-win-x64.zip`，解压后双击 `安装.cmd`；不要直接在 ZIP 预览器里运行。
2. 安装器会备份 web profile、安装固定插件包与隔离的 DSH/Kimi/百炼 CLI，并生成 `~/.dsh/turn-cost-launcher/启动 DSH（含额度）.cmd`。
3. 先运行“配置额度登录”：由你在官方页面完成 `kimi login` 与百炼控制台 OAuth。模型 API Key 仍由你在 DSH「设置 → 模型」里手动输入；两层凭据不能互相替代，安装器不会读取或写入 `.credentials.yaml`。
4. 日常从“启动 DSH（含额度）”启动；它会按需启动 Kimi loopback 服务，再启动 DSH。需要恢复时运行同目录的“回滚上一次安装”或“卸载”。

安装器不需要管理员权限，不改全局 npm、代理、防火墙、系统执行策略或开机任务。完整说明见 ZIP 内 `README-安装说明.txt`。

### 方式二：npm

> ⚠️ npm 上目前仅发布到 0.1.3（基础金额显示），订阅额度窗口、Kimi 自动拉起等 0.5.0 功能尚未发布。如需最新功能请用方式一或方式三。

```bash
dsh plugin --profile web add dsh-turn-cost
# 在 profile 的 package.json 的 dsh.profile.bundles 里追加 "dsh-turn-cost"
```

然后重启 dsh web 并刷新页面。

### 方式三：本地文件式

1. 把本仓库整个目录放到 `<dsh-home>/profiles/web/node_modules/dsh-turn-cost/`
2. 在 `<dsh-home>/profiles/web/package.json` 的 `dsh.profile.bundles` 数组末尾追加 `"dsh-turn-cost"`
3. 重启 dsh web 并刷新页面

## 开发与维护

本项目持续维护中。接手开发（包括新开一个对话的 AI）请先读：

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — 完整地图：仓库结构、DSH 插件机制的关键坑、计费口径不变式、发布流程
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- [Issues](https://github.com/WFMinerva/dsh-turn-cost/issues) — 维护 backlog

本地维护统一入口（推荐；Codex / Kimi Code / Claude Code / DSH / 纯人工 PowerShell 同一口径）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File maintenance.ps1 verify                     # 确定性静态门禁（退出 0 才可交付）
powershell -NoProfile -ExecutionPolicy Bypass -File maintenance.ps1 build -ReproducibilityCheck
powershell -NoProfile -ExecutionPolicy Bypass -File maintenance.ps1 doctor                     # 只读环境体检
powershell -NoProfile -ExecutionPolicy Bypass -File maintenance.ps1 acceptance                 # 实机验收（必须在 DSH 之外运行；原始报告不入库）
```

裸测试仍可单跑：先 `npm ci --ignore-scripts --no-audit --no-fund`，再 `node --test`；Windows 安装器夹具 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\test\windows-installer.test.ps1`（端口注入隔离宿主，无需关闭 DSH）。

## License

[MIT](./LICENSE)
