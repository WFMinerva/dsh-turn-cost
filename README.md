# dsh-turn-cost

[![featured in awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-featured-2ea44f)](https://github.com/beancookie/awesome-dsh-plugin)

在 DeepSeek Harness（dsh）Web UI 里显示**每轮与整会话的预估费用**：按 provider 上报的真实 token 用量与本地费率表计价，人民币结算、峰谷自动分档。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) web plugin that shows an estimated cost per turn and per conversation, priced from provider-reported token usage with a local rate table — the built-in official DeepSeek CNY card, optionally overlaid with your own.

## 功能

**每轮费用**：每条 AI 最终回复的操作行里多一行灰色小字。

```
本轮 ¥0.67 · 332万 token · 缓存读 100%
```

**会话累计**：输入框下方（与 dsh 官方统计条同一带）显示整会话汇总，并带上该会话实际用过的模型名。

```
deepseek-flash · 本会话 ¥15.42 · 3280万 token · 缓存读 99%
```

- **用量取自 provider 上报值**：未缓存输入、缓存读、缓存写、输出四桶分别统计，不是按文本估算 token。
- **一条用户消息算一轮**：中间的模型与工具步骤合并计为一轮，不重复计费。
- **打开历史会话同样显示**：每一轮照常标注，会话累计覆盖该会话的全部历史。
- **没有单价的模型不编造金额**：只显示 token 数，并计入「未计价」，不会按 0 元冒充已知价格。
- 金额精确到分，不足半分显示 `<¥0.01`；缓存读占比 = 缓存命中 token ÷（缓存命中 + 未命中输入）。

## 计费口径与边界

| 项 | 口径 |
|---|---|
| 一轮 | 用户一条消息 → AI 最终回复（中间工具步骤合并） |
| 计费 | Σ 各步（未缓存输入 × 单价 + 缓存读 × 单价 + 缓存写 × 单价 + 输出 × 单价） |
| 单价 | 人民币 / 百万 token；内置 [DeepSeek 官方价目](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，可用自定义费率表叠加 |
| 时段 | 高峰 = 北京时间**周一至周五** 9:00–12:00、14:00–18:00，且**不含中国法定节假日**；其余时段、周末与法定节假日全天均为空闲价；跨时段的一轮按每步实际时点分别取价 |
| 节假日 | 法定节假日按国务院当年安排（内置 2026 年安排）；**调休上班的周末仍按空闲价**；未收录的年份按普通工作日计价，属已知边界 |
| 用量来源 | 本机 dsh 会话日志中 provider 上报的 usage，按（轮, 步）折叠，同一步后到的样本覆盖先到的 |
| 不计 | 脚本直连 API 产生的调用、其它机器上的会话、费率表里没有单价的模型 |

界面上的金额是**预估**，不是账单：它等于 provider 上报的 token 数乘以本地费率表单价，实际结算以平台为准。

## 安装

通过 dsh 官方的插件机制安装，以下四种地址形式等价。

| 地址形式 | 命令 |
|---|---|
| npm 包名 | `dsh plugin --profile <profile> add dsh-turn-cost` |
| Git 仓库 | `dsh plugin --profile <profile> add github:WFMinerva/dsh-turn-cost` |
| 本地目录 | `dsh plugin --profile <profile> add <绝对路径>` |
| tarball | `dsh plugin --profile <profile> add <绝对路径>.tgz` |

也可以在应用内侧边栏的「插件」页用**添加插件**，填入上面任一形式的地址。

- 把 `<profile>` 换成目标 profile 名，例如桌面版为 `desktop`。
- 本地目录会被装成 `link:`（指向检出目录），改完代码重启即生效；npm 与 tarball 形式是复制安装，适合固定版本。
- **安装后需要重启该 profile 才生效**：插件成员在启动时确定（`dsh web` 重新启动，桌面应用完全退出后重新打开）。
- 卸载：`dsh plugin --profile <profile> remove dsh-turn-cost`。

## 自定义费率表

内置价目只覆盖 DeepSeek 官方模型。其它模型（自部署、代理转发、按套餐计费等）用一份本机 JSON 叠加：

1. 复制 [`rates.example.json`](./rates.example.json) 到本机任意位置，按各条的 `note` 说明填写；
2. 在目标 profile 的 `cordis.patch.yml` 里给本插件加一段配置：

   ```yaml
   - id: turn-cost
     name: dsh-turn-cost
     config:
       ratesPath: <费率表 JSON 的绝对路径>
   ```

3. 重启该 profile 生效。

费率表字段：

- `models.<模型名>`：平价条目 `{ input, cacheRead, cacheWrite?, output }`，或峰谷条目 `{ peak: {...}, offPeak: {...} }`；单位为元 / 百万 token，未写的字段按 0 计。
- 模型名可写成 `<provider>/<model>`，用于区分同一模型在不同来源上的单价。
- `aliases`：模型名归一化，处理同一模型的多种写法。
- 没有 token 单价的套餐，把四个单价都写 0 并加 `note` 说明——token 照常显示，金额恒为 0，不编造价格。
- 文件缺失或损坏时自动回退内置价目，插件照常工作。

## 隐私

- 用量取自本机 dsh 会话日志，单价取自本机费率表 JSON；两者都只在本机读取，不外发。
- 不读取、不复制、不记录任何 API Key 或凭据。
- 官方价目随包内置，不联网获取价格。

## License

[MIT](./LICENSE)
