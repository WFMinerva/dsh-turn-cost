# dsh-turn-cost 诊断表（固定错误码 → 原因 → 处置）

> 报告与日志只出现本表错误码与一行摘要，不出现自由堆栈。新增错误码必须同步本表。
> 命令入口与完整契约：仓库根 `maintenance.ps1`；通用层文档见 vendor 来源仓库 `docs/使用说明-统一维护入口.md`。

## 验收/维护链（maintenance.ps1）

| 错误码 | 含义 | 常见原因 | 处置 |
|---|---|---|---|
| `VENDOR_MISSING` / `MISSING_CORE` | 通用层缺失 | 未发布 vendor | 在 tool-library 仓库运行 `publish-vendor -Target 本仓库` |
| `ADAPTER_NOT_FOUND` | 适配层钩子缺失 | 在非接入仓库运行项目命令 | 到 dsh-turn-cost 仓库根运行 |
| `DIRTY_TREE` | tools/maintenance 有未提交改动 | 试图从未提交内容发布 vendor | 先提交通用层再发布 |
| `VENDOR_CONTENT_REJECTED` | 通用层文件命中敏感模式 | 源码含密钥/个人路径 | 清理后重新发布 |
| `PORT_BUSY` | 3080/58627 被占用 | DSH/Kimi 仍在运行 | 正常退出后再跑（工具不杀任何进程）；acceptance 必须在 DSH 之外执行 |
| `BUILD_FIRST` | dist/ 没有 ZIP | 未构建 | 先运行 `maintenance.ps1 build` |
| `BUILD_FAILED` / `TESTS_FAILED` / `NPM_PACK_FAILED` / `PACK_OUTPUT_MISSING` | 构建失败 | 测试未过/打包异常 | 逐项看构建输出；先修复测试 |
| `REPRODUCIBILITY_FAILED` | 双构建整包哈希不等 | 打包输入不确定 | 按方案降级条款退回内容清单口径并记录证据 |
| `PNPM_BUNDLED_MISSING` | 找不到 DSH 自带 pnpm | DSH 未安装/路径异常 | 安装 DSH 或检查 `$DSH_HOME\bin\pnpm.cmd` |
| `PNPM_LOCKFILE_FAILED` / `NPM_LOCKFILE_FAILED` / `NPM_CLI_MISSING` | lockfile 重生成失败 | 离线/版本冲突 | 联网重试；核对 versions.json |
| `INSTALL_FAILED` / `REINSTALL_FAILED` / `REINSTALL_AFTER_ROLLBACK_FAILED` | 安装阶段失败 | 见安装器错误码 | 按下方安装器表定位 |
| `ROLLBACK_POINT_DRIFT` | 幂等重跑改变回滚点 | 状态文件被外力修改 | 核对 state.json 历史 |
| `ROLLBACK_FAILED` / `ROLLBACK_HASH_MISMATCH` | 回滚失败/哈希不等 | 备份被破坏 | 用备份目录手工核对；必要时卸载重装 |
| `DSH_HTTP_FAILED` / `DSH_HTTP_STATUS` / `DSH_START_FAILED` / `DSH_STOP_FAILED` | DSH 服务探测失败 | 启动超时/端口被占 | 看 DSH 自身日志；确认 3080 无他占 |
| `KIMI_META_FAILED` / `KIMI_USAGE_FAILED` | Kimi loopback 探测失败 | 未登录/接口形状变化（experimental） | 先 `kimi login`；安静降级不阻塞对话 |
| `PORT_RESIDUE` | 退出后端口残留 | 进程未完全退出 | 等待重试；仍残留则人工核对监听进程 |
| `CLEANUP_FAILED` | 验收清理失败 | 服务/临时目录未恢复 | 按报告 cleanup.detail 人工核对 |
| `ARTIFACT_PATH_REJECTED` | 制品路径非仓库相对路径 | 钩子返回异常路径 | 修正适配层 Get-Artifacts |

## 安装器（installer/Install.ps1）

| 错误码 | 含义 | 常见原因 | 处置 |
|---|---|---|---|
| `DSH_RUNNING` | 3080 正在监听 | DSH 未退出 | 退出 DSH 后重试（不杀进程） |
| `PAYLOAD_MISSING` / `PAYLOAD_HASH_MISMATCH` | 载荷缺失/校验失败 | ZIP 损坏/被篡改 | 重新获取安装包并核对 content-sha256.json |
| `MANIFEST_INVALID` / `STAGED_MANIFEST_INVALID` | 清单不可读 | 包结构损坏 | 同上 |
| `DSH_VERSION_UNRECOGNIZED` / `DSH_CLI_VERSION_MISMATCH` / `DSH_CLI_ASSET_INVALID` | 固定版本链断裂 | 清单与派生文件不同步 | 在本仓库运行 `verify` 定位不等项 |
| `PNPM_NOT_FOUND` / `DSH_CLI_INSTALL_FAILED` / `DSH_CLI_BIN_MISSING` | 隔离 DSH CLI 建立失败 | 离线/pnpm 异常 | 联网重试；仍失败看输出末行 |
| `DSH_PLUGIN_ADD_FAILED` / `DSH_DUMP_FAILED` / `DSH_BUNDLE_NOT_ACTIVE` / `DSH_BUNDLE_NOT_REGISTERED` | 插件安装/激活失败 | DSH 命令失败 | 自动回滚已执行；按 DSH 输出处理 |
| `BACKUP_INVALID` / `BACKUP_OUTSIDE_DSH_HOME` / `STATE_NOT_FOUND` / `STATE_INVALID` | 备份/状态不可信 | 手工改动过安装器状态 | 不猜测恢复；人工核对后再决定 |
| `PATH_OUTSIDE_DSH_HOME` / `LAUNCHER_ROOT_NOT_PERSISTENT` / `INSTALLER_PACKAGE_MISSING` | 路径越界/载荷不持久 | 从临时目录运行启动/回滚 | 用正式安装入口 |
| `CLI_PENDING`（提示，非失败） | 私有额度 CLI 未就位 | 离线安装 | 联网后双击「补齐额度CLI.cmd」 |

## 启动器（installer/Launch.ps1）

| 错误码 | 含义 | 常见原因 | 处置 |
|---|---|---|---|
| `KIMI_CLI_MISSING` | 私有 kimi CLI 缺失 | 离线安装未补齐 | 运行「补齐额度CLI.cmd」 |
| `KIMI_SERVER_START_FAILED` | 58627 未出现健康响应 | Kimi 启动异常 | 手工 `kimi web --no-open` 观察输出 |
| `KIMI_SERVER_TOKEN_NOT_FOUND` | 无本地 server token | 未登录 | 运行 `kimi login` |
| `KIMI_SERVER_IDENTITY_FAILED` | 58627 不是可认证的 Kimi | 端口被他占 | 释放端口（不杀进程原则：先确认归属） |
| `KIMI_SHUTDOWN_REJECTED` | 官方 shutdown 拒绝 | 接口异常 | 人工检查 58627 |
| `DSH_EXIT_<n>` | DSH 退出码非零 | 视 n 而定 | 查 DSH 日志 |
