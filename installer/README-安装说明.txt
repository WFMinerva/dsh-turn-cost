dsh-turn-cost Windows 一键部署包

1. 退出正在运行的 DSH。
2. 双击“安装.cmd”。安装器会校验插件包、备份 web profile、安装插件并准备私有 Kimi/百炼 CLI。
3. 启动 DSH，在“设置 → 模型”中添加内置 kimi-coding 与 qwen-token-plan-cn，并手动输入各自 API Key。
4. Kimi 官方额度默认复用 DSH 托管的 KIMI_CODING_API_KEY，无需本地服务或 kimi login。Qwen 额度需运行 bl auth login --console --console-site domestic，并建议再运行 bl auth login --open-api 供令牌自动续期。
5. 日常双击 ~/.dsh/turn-cost-launcher/“启动 DSH（含额度）.cmd”。

安装器不会读取或复制 .credentials.yaml，不修改代理、防火墙、WSL、Docker、执行策略或开机任务。
离线时插件仍可安装；Qwen 或可选 Kimi loopback 所需的私有 CLI 若未补齐，会显示 CLI_PENDING，联网后双击“补齐额度CLI.cmd”。
回滚和卸载只处理安装器拥有的文件，不删除会话、settings、模型 API Key 或 OAuth 登录。
