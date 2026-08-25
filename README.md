# dsh-turn-cost

[![featured in awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-featured-2ea44f)](https://github.com/beancookie/awesome-dsh-plugin)

DeepSeek Harness（dsh）Web UI 插件：**按对话实际用的路由分流显示**——官方按量模型（DeepSeek）显示金额（¥），Kimi 订阅显示「本轮 token + 5h 窗口剩余次数」，阿里 Token Plan 订阅显示「本轮 token + 7 天限额剩余比例」；另有会话级/跨对话汇总。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) web plugin that shows, per conversation and per turn, **which route the model actually used**: pay-as-you-go DeepSeek turns show money (¥) while Kimi subscription turns show tokens plus the 5-hour window remaining count, and Alibaba Token Plan turns show tokens plus the 7-day quota remaining share; session-level and cross-session summaries round it out. Ships the [official DeepSeek CNY peak/off-peak rates](https://api-docs.deepseek.com/quick_start/pricing/) and accepts your own rate table.

> 官方按量：本轮 ¥0.23 · 1.2万 token · 缓存读 98% ／ Kimi 订阅：本轮 12.3万 token · 5h 还剩 47 次 ／ Qwen 订阅：本轮 3.4万 token · 剩余 40%

- **订阅额度窗口（0.4.0）**：Kimi 订阅走官方 `GET /coding/v1/usages` 端点读 5 小时/7 天窗口的已用/上限/剩余/重置时间与加油包余额（凭据取 `.credentials.yaml` 的 `KIMI_CODING_API_KEY`，打开即用；也可配 loopback baseUrl 走 Kimi Code 本地 OAuth）；阿里 Token Plan 走官方 `bl usage token-plan` CLI——见下文「订阅额度窗口」
- **单对话/单轮占比**：Kimi 路由显示「本轮 token · 5h 还剩 N 次」（剩余次数为官方实时读数）；阿里侧因 Credits 无法精确归因，只显示剩余比例（不编造消耗百分比）
- **人民币计价**，内置 [DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（峰谷按北京时间）——官方按量路由显示金额，订阅路由按 0 价登记只显 token
- **自定义费率表**：任意模型可配单价（含缓存写），订阅制模型按 0 价登记只显 token
- 金额基于 **provider 上报的真实 usage**（未缓存输入 / 缓存读 / 输出分桶计费），不是估算 token 数
- 一条用户消息引发的整轮（含中间工具步骤）合并计为一轮，绝不重复计
- 打开旧会话时，历史每一轮同样显示；会话级与汇总视图覆盖全部历史会话

## 效果

① 每条 AI 最终回复下方的图标行（复制按钮左侧）出现一行灰色小字：

```
本轮 ¥0.67 · 332万 token · 缓存读 100%
```

② 输入框下方（官方统计条同一带）出现本会话累计：

```
本会话 ¥15.42 · 3280万 token · 缓存读 99%
```

③ 会话页头动作行出现「额度汇总」按钮，点开面板看**订阅额度窗口**（Kimi 5h/7 天/加油包、阿里 Token Plan 7 天限额）与全部会话的合计、按模型分组、按天分组（近 14 天）。
- 金额精确到分，不足半分显示 `<¥0.01`（仅官方按量路由显示金额；订阅路由只显 token 与额度读数）
- token 数为总消耗（万为单位），口径与 dsh 官方统计条逐桶一致
- 缓存读占比 = 缓存命中 token ÷（缓存命中 + 未命中输入），一眼看出长对话的省钱效果

## 订阅额度窗口（0.4.0）

订阅路由**内置默认**（`kimi-coding` → kimi-usages、`qwen-token-plan-cn` → aliyun-bl），不写配置也会尝试读取；费率表 `quota` 块用于覆盖默认（如换凭据引用名、换端点、`enabled: false` 显式关闭）：

```json
"quota": {
  "kimi-coding": { "kind": "kimi-usages", "credentialRef": "KIMI_CODING_API_KEY" },
  "qwen-token-plan-cn": { "kind": "aliyun-bl", "command": "bl" }
}
```

- **kimi-usages**：默认走官方 `GET https://api.kimi.com/coding/v1/usages`（Kimi Code 官方端点），凭据从 `<dsh-home>/.credentials.yaml` 的 `KIMI_CODING_API_KEY` 内存解析（可用 `credentialRef` 换引用名，`baseUrl` 换端点）；返回 5 小时/7 天窗口 + 加油包，host 端 60 秒 TTL 缓存。**打开即用，无需本地服务**。也可显式配 loopback `baseUrl`（如 `http://127.0.0.1:58627`）改走 Kimi Code 本地 OAuth 服务（读 `~/.kimi-code/server.token`）
- **aliyun-bl**：调官方百炼 CLI `bl usage token-plan --output json`（`npm i -g bailian-cli` 后 `bl auth login --console` 登录一次；再用 `bl auth login --open-api --access-key-id <id> --access-key-secret <secret>` 存 AK/SK，console token 过期自动续期、免手动登录；可用 `command` 改可执行名）。未安装/未登录/输出不认得都安静降级为「暂读不到」
- **占比口径**：Kimi 徽章与面板显**剩余次数**（官方实时读数，不把请求次数伪装成额度消耗）；「本会话占比」不再显示——5h 窗口按请求数计的旧口径（#6/#3）已在 0.4.0 移除
- 阿里 Token Plan 以动态 Credits 计量且官方未公开系数表，**不做单对话占比**（不编造），只显示窗口「已用/还剩」

平台读数失败的窗口在面板上显示「暂读不到（原因）」，永不阻塞界面。

## 原理

```
本机会话日志（zstd JSONL）
   └─ 按 (轮, 步) 折叠 provider usage（后到的同轮步样本覆盖先到的，不重复计）
        └─ 每步按费率表取价（内置官方 CNY 峰谷卡；rates.json 可叠加自定义模型价）
             ├─ 该轮求和 → 回复下方
             ├─ 整会话求和 → 输入框下方
             └─ 全部会话枚举 + 分组 → 页头「额度汇总」面板
```

- host 端：扫描 dsh 会话日志（`<dsh-home>/sessions/**/session.jsonl.zstd`），与运行中的 live 会话事件合并折叠；通过 Typert Remote 网关暴露 `turnCost/query`、`turnCost/sessionTotals`、`turnCost/summary` 端点，带签名缓存（汇总按会话粒度增量重算）
- client 端：注册官方 slot `conversation.chat.assistant-actions`（每轮金额）、`conversation.composer.dock`（会话累计，与官方统计条同带）、`conversation.session.header.actions`（汇总面板入口）

## 自定义费率表

内置价表只覆盖 DeepSeek 官方按量模型。其它模型（自部署、中转、订阅制）用本机 JSON 文件叠加：

1. 复制 [rates.example.json](./rates.example.json) 到本机任意位置（如 `<dsh-home>/turn-cost-rates.json`），按注释口径改；
2. 在 `<dsh-home>/profiles/web/cordis.patch.yml` 用同 id 覆盖插件配置（用户层后应用、同 id 行胜出）：

```yaml
- id: turn-cost
  name: dsh-turn-cost
  config:
    ratesPath: C:\Users\Admin\.dsh\turn-cost-rates.json   # 改成你的实际路径
```

3. 重启 dsh web 生效。

费率表口径：

- `models.<模型名>`：平价条目 `{ input, cacheRead, cacheWrite?, output }`（每百万 token 的元数，缺省按 0）；或峰谷条目 `{ peak: {...}, offPeak: {...} }`（按北京时间官方峰谷窗口取档）
- `aliases`：模型名归一化（如 `"k3": "k3-256k"`），解决同一模型多种写法
- **订阅制模型**（包月/额度套餐，无 token 单价）：四个单价都配 0 并写 `note`——token 照显，金额恒 0，不编造价格
- 未在表里的模型照旧计入 `unpriced`，绝不编造；文件缺失或损坏自动回退内置官方卡

## 隐私

**只读本机数据；Kimi 额度默认只读访问官方 `api.kimi.com`，也可显式改用 loopback 官方服务；阿里额度由本机官方 CLI 访问其服务。**

- token 账与金额来自本机 dsh 会话日志与本机费率表 JSON，不出本机
- 0.4.0 起订阅路由默认启用：Kimi 路由会向 `api.kimi.com`（或你自配的 https/loopback baseUrl）发只读 `GET /usages`；阿里路由由本机官方 `bl` CLI 与其控制台会话通信——除此之外无任何网络访问、无任何上报
- 订阅 API 密钥只在内存里从 dsh 自己的受管凭据库（`.credentials.yaml`）解析后用于上述请求，**不打印、不落盘、不转发给任何第三方**
- 界面上的金额是**估计值**（provider 上报 token 数 × 费率表单价），仅供个人参考，不构成账单；订阅套餐的实际额度以平台官方读数为准

## 计费口径与边界

| 项 | 口径 |
|---|---|
| 一轮 | 用户一条消息 → AI 最终回复（中间工具步骤合并） |
| 计费 | Σ 各步（未缓存输入×单价 + 缓存读×单价 + 缓存写×单价 + 输出×单价），峰谷条目按步时点取档 |
| 时段 | 北京时间；2026-08-23 起周末全天空闲价，生效前历史调用仍按旧规则 |
| 模型 | 按 `request/header` 记录的模型查费率表（内置 Pro / Flash / Flash-Vision 三档官方 CNY 价；自定义模型走 rates.json，支持别名） |
| 不计 | 脚本直连 API 的调用、其它机器的会话、费率表里没有的模型（计 unpriced，不编造） |
| 汇总 | 跨对话汇总按样本实际发生时间归北京时间日历日；按模型分组以日志记录的模型名为准 |

## 安装

### 方式一：Windows 一键包（推荐）

1. 解压 `dsh-turn-cost-setup-0.4.0-win-x64.zip`，双击 `安装.cmd`；不要直接在 ZIP 预览器里运行。
2. 安装器会备份 web profile、安装固定插件包与隔离的 DSH/Kimi/百炼 CLI，并生成 `~/.dsh/turn-cost-launcher/启动 DSH（含额度）.cmd`。
3. API Key 仍由你在 DSH「设置 → 模型」里手动输入；Kimi 官方 API 额度会复用 DSH 托管的 `KIMI_CODING_API_KEY`，无需另跑 `kimi login`（只有显式改用 loopback 时才需启动并登录 Kimi Code 本地服务）。Qwen 额度需 `bl auth login --console --console-site domestic`，并建议再用 `bl auth login --open-api` 保存 AK/SK 供 console token 自动续期。安装器本身不会读取或写入 `.credentials.yaml`。
4. 日常从“启动 DSH（含额度）”启动；需要恢复时运行同目录的“回滚上一次安装”或“卸载”。

安装器不需要管理员权限，不改全局 npm、代理、防火墙、系统执行策略或开机任务。完整说明见 ZIP 内 `README-安装说明.txt`。

### 方式二：npm

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
