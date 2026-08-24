# dsh-turn-cost

[![featured in awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-featured-2ea44f)](https://github.com/beancookie/awesome-dsh-plugin)

DeepSeek Harness（dsh）Web UI 插件：在每一条 AI 回复下方显示**这一轮花了多少钱**，在输入框下方显示**本会话累计**，在会话页头提供**跨对话额度汇总**（按模型/按天）。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) web plugin that shows **how much conversation really cost** — per turn under every assistant reply, per session beside the shipped stats line, and across all sessions in a summary panel. Ships the [official DeepSeek CNY peak/off-peak rates](https://api-docs.deepseek.com/quick_start/pricing/) and accepts your own rate table.

> 本轮 ¥0.23 · 1.2万 token · 缓存读 98% ／ 本会话 ¥15.42 · 3280万 token · 缓存读 99%

- **人民币计价**，内置 [DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（工作日高峰为 9:00–12:00、14:00–18:00 北京时间；2026-08-23 起周六、周日全天按空闲价；跨时段的一轮按各步实际发生时间分别计价）
- **自定义费率表**：任意模型可配单价（含缓存写），订阅制模型（包月/额度套餐）按 0 价登记只显 token——见下文「自定义费率表」
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

③ 会话页头动作行出现「额度汇总」按钮，点开面板看全部会话的合计、按模型分组、按天分组（近 14 天）。

- 金额精确到分，不足半分显示 `<¥0.01`
- token 数为总消耗（万为单位），口径与 dsh 官方统计条逐桶一致
- 缓存读占比 = 缓存命中 token ÷（缓存命中 + 未命中输入），一眼看出长对话的省钱效果

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

**完全本地，零网络，零上报。**

- 不调用任何 API、不需要也不会读取任何 API 密钥
- 只读本机 dsh 自己的会话日志文件与本机费率表 JSON
- 不向任何服务器发送任何数据（内置价表随包分发，自定义费率表也只存在你自己的磁盘上）
- 界面上的金额是**估计值**（provider 上报 token 数 × 费率表单价），仅供个人参考，不构成账单；订阅制套餐的实际额度消耗以平台官方页面为准

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

### 方式一：npm（推荐）

```bash
dsh plugin --profile web add dsh-turn-cost
# 在 profile 的 package.json 的 dsh.profile.bundles 里追加 "dsh-turn-cost"
```

然后重启 dsh web 并刷新页面。

### 方式二：本地文件式

1. 把本仓库整个目录放到 `<dsh-home>/profiles/web/node_modules/dsh-turn-cost/`
2. 在 `<dsh-home>/profiles/web/package.json` 的 `dsh.profile.bundles` 数组末尾追加 `"dsh-turn-cost"`
3. 重启 dsh web 并刷新页面

## 开发与维护

本项目持续维护中。接手开发（包括新开一个对话的 AI）请先读：

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — 完整地图：仓库结构、DSH 插件机制的关键坑、计费口径不变式、发布流程
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- [Issues](https://github.com/WFMinerva/dsh-turn-cost/issues) — 维护 backlog

本地跑测试：`node --test`（纯函数，零依赖零网络）。

## License

[MIT](./LICENSE)
