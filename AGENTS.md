# AGENTS.md — dsh-turn-cost 项目总入口

<!-- startup-policy-version: 1 -->

本文件是本仓库所有编码 Agent 的项目级启动入口。dsh-turn-cost 是一个**标准 dsh bundle**（host 半 + Web client 半），通过官方「添加插件」接入，按路由显示每轮/每会话的预估费用与订阅额度读数。功能与安装见 `README.md`，版本历史见 `CHANGELOG.md`，维护地图见 `docs/DEVELOPMENT.md`。

## 红线

1. **推送纪律**：仅当机主明确说「推送」才 `git push`；其余一律只本地提交。
2. **接入唯一化**：本插件只走官方机制——`dsh plugin --profile <name> add <npm 名|github:owner/repo|本地目录|tarball>`，或应用内「插件」页的「添加插件」。**不重建安装器、启动脚本、宿主版本固定或验收链**；官方已负责安装、依赖、配置、profile 补丁与生命周期，重做即为重复建设。
3. **部署纪律**：不得直接改已部署副本；不得在未获机主同意时改动/重启**正在使用的**宿主 profile（验证可在官方路径上做，但必须卸载还原并如实登记）。
4. **凭据红线**：不读取、不复制、不记录 DSH `.credentials.yaml`、Kimi `server.token`、任何 API Key / AK-SK；额度取数只走本机官方 loopback 服务或官方 CLI。
5. **版本不可变**：已发布版本不就地改；任何修正升版本号。
6. **中文文件**：不用 PowerShell 管道改写（GBK 解码假象；用编辑工具）；提交前 `git diff --check`。
7. **peer 模型红线**：宿主提供的包在 `peerDependencies` 里必须是 `"*"`（这样 dsh 的兼容性门禁**永不**因版本区间拒载本插件），被复核过的精确版本写在 `devDependencies` 里。改这两处必须同步改 `tools/peer-compat.mjs` 的 `HOST_PACKAGES`/`REVIEWED_RUNTIME` 并跑通测试。

## 收到流程触发词时

先输出一行：`启动回执：已读取 AGENTS.md；流程=<A/A-半自主/B/C>；当前=<门一/轻流程对齐>；尚未执行任务本体。` 流程分级、三扇门与交付标准以 tool-library 权威文档为准（`..\tool-library\docs\立项程序.md`、`..\tool-library\docs\开发流程.md`）。

## 开工顺序

1. 读本仓库 `CURRENT_STATE.md`（恢复点，含未验证项）→ 读 `..\tool-library\AGENTS.md` → 按需读 `docs/DEVELOPMENT.md`。
2. **本地参考实现**：`..\tool-library\dsh-notion` 是本机按当前官方机制接入的插件（本地路径 → `link:`、`dsh.bundle` + `cordis.patch.yml`、精确钉版）。只参考其**通用工程与安装方式**，不照搬其权限/凭据/业务逻辑。
3. 涉及宿主行为：以**当前安装版本对应的**官方文档与运行时为准（`deepseek-ai/deepseek-harness` 的对应 tag、桌面应用 `app.asar` 内的实际实现、官方 Inspect Provider）。

## 统一验证入口（提交态可运行）

```powershell
npm test                                                  # 全部单元/行为测试（node --test）
npm run check                                             # lib/*.js 语法
node tools/peer-compat.mjs --runtime <dsh --version>       # peer 模型 + 宿主版本核对
```
