# dsh-turn-cost

[![featured in awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-featured-2ea44f)](https://github.com/beancookie/awesome-dsh-plugin)

DeepSeek Harness（dsh）Web UI 插件：在每一条 AI 回复下方的操作行里，显示**这一轮对话花了多少钱**。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) web plugin that shows **how much one turn of conversation really cost**, right under every assistant reply — in CNY at the [official DeepSeek peak/off-peak rates](https://api-docs.deepseek.com/quick_start/pricing/).

> 本轮 ¥0.23 · 1.2万 token · 缓存读 98%

- **人民币计价**，采用 [DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（工作日高峰为 9:00–12:00、14:00–18:00 北京时间；2026-08-23 起周六、周日全天按空闲价；跨时段的一轮按各步实际发生时间分别计价）
- 金额基于 **provider 上报的真实 usage**（未缓存输入 / 缓存读 / 输出分桶计费），不是估算 token 数
- 一条用户消息引发的整轮（含中间工具步骤）合并计为一轮，绝不重复计
- 打开旧会话时，历史每一轮同样显示

## 效果

在每条 AI 最终回复下方的图标行（复制按钮左侧）出现一行灰色小字：

```
本轮 ¥0.67 · 332万 token · 缓存读 100%
```

- 金额精确到分，不足半分显示 `<¥0.01`
- token 数为该轮总消耗（万为单位）
- 缓存读占比 = 缓存命中 token ÷（缓存命中 + 未命中输入），一眼看出长对话的省钱效果

## 原理

```
本机会话日志（zstd JSONL）
   └─ 按 (轮, 步) 折叠 provider usage（后到的同轮步样本覆盖先到的，不重复计）
        └─ 每步按实际时间取峰/谷价 × 官方 CNY 单价
             └─ 该轮求和 → 显示在回复下方
```

- host 端：扫描 dsh 会话日志（`<dsh-home>/sessions/**/session.jsonl.zstd`），与运行中的 live 会话事件合并折叠；通过 Typert Remote 网关暴露 `turnCost/query` 端点，带签名缓存
- client 端：注册官方 slot `conversation.chat.assistant-actions`（每轮收尾消息恰好渲染一次，与产物条、反馈按钮等其它插件共存），从会话快照反查轮号后查询并渲染

## 隐私

**完全本地，零网络，零上报。**

- 不调用任何 API、不需要也不会读取任何 API 密钥
- 只读本机 dsh 自己的会话日志文件
- 不向任何服务器发送任何数据（连价格表都是内置的）
- 界面上的金额是**估计值**（provider 上报 token 数 × 官方单价），仅供个人参考，不构成账单

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

## 计费口径与边界

| 项 | 口径 |
|---|---|
| 一轮 | 用户一条消息 → AI 最终回复（中间工具步骤合并） |
| 计费 | Σ 各步（未缓存输入×单价 + 缓存读×单价 + 输出×单价），跨峰谷按步时点 |
| 时段 | 北京时间；2026-08-23 起周末全天空闲价，生效前历史调用仍按旧规则 |
| 模型 | 按 `request/header` 记录的模型取价（内置 Pro / Flash 两档官方 CNY 价） |
| 不计 | 脚本直连 API 的调用、其它机器的会话、无官方 CNY 价的模型 |

## 开发与维护

本项目持续维护中。接手开发（包括新开一个对话的 AI）请先读：

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — 完整地图：仓库结构、DSH 插件机制的关键坑、计费口径不变式、发布流程
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- [Issues](https://github.com/WFMinerva/dsh-turn-cost/issues) — 维护 backlog

本地跑测试：`node --test`（纯函数，零依赖零网络）。

## License

[MIT](./LICENSE)
