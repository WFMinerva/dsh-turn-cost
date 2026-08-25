dsh-turn-cost Windows 一键部署包

1. 退出正在运行的 DSH。
2. 双击“安装.cmd”。安装器会校验插件包、备份 web profile、安装插件并准备私有 Kimi/百炼 CLI。
3. 双击“配置额度登录.cmd”，由你在官方页面完成 Kimi Code OAuth 与百炼控制台 OAuth；若百炼 CLI 未自动打开浏览器，请复制它打印的完整 https:// 链接。
4. 启动 DSH，在“设置 → 模型”中添加内置 kimi-coding 与 qwen-token-plan-cn，并手动输入各自 API Key。模型 Key 与额度 OAuth 是两层凭据，不能互相替代。
5. 日常双击 ~/.dsh/turn-cost-launcher/“启动 DSH（含额度）.cmd”。

安装器不会读取或复制 .credentials.yaml，不修改代理、防火墙、WSL、Docker、执行策略或开机任务。
离线时插件仍可安装；Kimi/Qwen 额度所需的私有 CLI 若未补齐，会显示 CLI_PENDING，联网后双击“补齐额度CLI.cmd”。
回滚和卸载只处理安装器拥有的文件，不删除会话、settings、模型 API Key 或 OAuth 登录。
