# AGENTS.md — dsh-turn-cost 项目总入口

<!-- startup-policy-version: 1 -->

本文件是本仓库所有编码 Agent 的项目级启动入口。dsh-turn-cost 是装在 dsh Web UI 里的**生产件**插件（按路由显示每轮费用/订阅额度）。功能与安装见 `README.md`，版本历史见 `CHANGELOG.md`，维护链见 `docs/DEVELOPMENT.md` 与 `maintenance.ps1`，立项与历次维护记录见 `docs/方案-dsh-turn-cost.md`。

## 红线

1. **推送纪律**：仅当机主明确说「推送」才 `git push`；其余一律只本地提交。
2. **生产件纪律**：本插件装在正在使用的 DSH 里；代码改动必须过统一验证入口，涉及安装/宿主行为的改动另走 `maintenance.ps1 acceptance` 实机验收链；不得直接改已部署副本，部署只走仓库内安装器。
3. **凭据红线**：不读取、不复制、不记录 DSH `.credentials.yaml`、Kimi `server.token`、任何 API Key / AK-SK；额度取数只走本机官方 loopback 服务或官方 CLI。
4. **版本不可变**：已发布版本不就地改；任何修正升版本号（0.4.1 教训见 `CHANGELOG.md`）。
5. **中文文件**：不用 PowerShell 管道改写（GBK 解码假象；用编辑工具）；提交前 `git diff --check`。

## 收到流程触发词时

先输出一行：`启动回执：已读取 AGENTS.md；流程=<A/A-半自主/B/C>；当前=<门一/轻流程对齐>；尚未执行任务本体。` 流程分级、三扇门与交付标准以 tool-library 权威文档为准（`..\tool-library\docs\立项程序.md`、`..\tool-library\docs\开发流程.md`）。

## 开工顺序

1. 读本仓库 `CURRENT_STATE.md`（恢复点）→ 读 `..\tool-library\AGENTS.md` → 按需读 `docs/方案-dsh-turn-cost.md`、`docs/DEVELOPMENT.md`。
2. 涉及本地安装/编译/服务：先读 `..\tool-library\本机环境一句话.md` 识别机器，再读对应 `machines/` 页。
3. 交付/复检前：跑统一验证入口 + tool-library 机器验（`python tools/checks.py --json`，在 `..\tool-library` 下运行）。

## 统一验证入口（提交态可运行，不依赖 package.json scripts；交付/复检前必跑）

```powershell
node --test "test/*.test.mjs"   # 单元测试（node 直接调用，当前 61 项）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File test/windows-installer.test.ps1  # Windows 安装器测试
.\maintenance.ps1 verify        # 完整交付门禁（确定性静态门禁：单测/合同/PS 语法/版本一致/安装夹具）
# 安装或宿主行为改动另走：.\maintenance.ps1 acceptance（实机验收链，按需）
```
