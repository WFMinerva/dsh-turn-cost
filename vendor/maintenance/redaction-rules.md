# 脱敏规则（统一维护基础设施 · 通用层）

> 单一出口：报告组装器（report.ps1 Write-Report）在序列化时对**所有字符串字段**统一调用 `Invoke-Redact`；钩子层不直接写报告。任何 stdout/stderr 原文一律不进报告（只允许白名单字段：状态码/计数/版本/哈希/时延）。

## 替换规则

| 命中 | 替换为 | 正则来源 |
|---|---|---|
| 个人配置目录（`X:\Users\<名>\AppData…` / `…\Documents\Codex` / `…\Documents\ChatGPT` / `…\.codex`） | `%USERPROFILE%\` | 与 `.githooks/pre-commit.py` PERSONAL_PAT、`tools/checks.py` PERSONAL_PATH_RE 同源镜像 |
| 高置信密钥（私钥头 / AKIA / ghp_ / github_pat_ / sk-ant- / xox[bprs]-） | `[REDACTED]` | 同源 BLOCK_PAT / KEY_BLOCK_RE |
| 低置信密钥（AIza / LTAI） | `[REDACTED]` | 同源 WARN_PAT / KEY_WARN_RE |

一致性断言：`tests/maintenance/selftest.ps1` 逐片段比对 PS 镜像与两份 Python 源文件（漂移即 FAIL）。

## 报告允许与禁止

- **允许**（本地且 gitignored 的原始报告）：机器档位（home/unit/laptop/unknown）、硬件型号串、软件版本、端口占用布尔、哈希、固定错误码。
- **禁止**（任何报告与日志）：密钥/令牌原文、用户名、凭据内容（含 `.credentials.yaml`、Kimi token、bl 认证配置的任何片段）、个人绝对路径。
- **唯一例外（loopback bearer，继承 0.4.0 门三语义）**：Kimi 本地服务 token（`~/.kimi-code/server.token`）允许读入内存并立即用于 `127.0.0.1:58627` 的 bearer 请求；不打印、不进报告/日志/仓库、不复制到其他位置。报告组装层只接受白名单字段，自由文本无入口。
- **机器指纹字段白名单**：仅注册表 `SystemManufacturer`/`SystemProductName`/`BaseBoardManufacturer`/`BaseBoardProduct`/`ProcessorNameString`（与 checks.py `_hardware_fingerprint` 同源）。**显式排除**：序列号（Win32_BIOS SerialNumber 等）、UUID、MAC、机器名（Win32_ComputerSystem.Name）、用户名、SID——这些字段不得被读取。
- **artifact 路径**：只准仓库相对路径（正斜杠），组装期断言拒绝绝对路径与 `..`。

## 入库证据

原始 `acceptance-report.json` 不入库（适配仓库 `.gitignore`）。需要留档时显式复制为 `evidence/<日期>-<版本>.json`：复制前重扫脱敏（命中即拒绝写入）。仓库内示例报告使用**虚构数据**。
