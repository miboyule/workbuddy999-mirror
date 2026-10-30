# 一键配置 · 本地集成

仅在 `ONECLICK_LOCAL_ENABLED=1` 时启动配置助手；默认主站行为不变。原项目的精确文件备份保存在 `backups/oneclick-integration-20261029-011208/`。

## 启动与体验

在项目根目录执行 `powershell -ExecutionPolicy Bypass -File .\scripts\start-oneclick-local.ps1`，访问 `http://127.0.0.1:8787/setup/` 或 `http://localhost:8787/setup/`。浏览器始终通过 `8787` 访问一键配置页面和下载接口，Node BFF 内部代理到随机 Go 子服务端口，因此不会因为重启服务后旧随机端口失效而出现 `Failed to fetch`。输入**已持有且允许测试的真实兑换码**，勾选确认；首次激活会立即开始套餐计时。跳转后的页面直接用该兑换码对应会员的密钥访问 `https://api.workbuddy999.top/v1/models`，安装到客户端的 API Base URL 也是 `https://api.workbuddy999.top/v1`，不依赖用户电脑一直运行本地 BFF 来调用模型。第三方站点模式也可手动输入 HTTPS 地址和密钥。

选择模型、客户端和系统后，还必须选择安装方式：默认“临时目录测试”只验证接口和写入虚拟配置，**不会修改/重启真实 WorkBuddy**；要配置本机，切换为“安装到这台电脑”，保存客户端工作内容并勾选确认，再重新生成并运行**新下载**的脚本。真实安装会先备份配置、写入默认模型，验证授权并尝试重启选中的客户端。本地测试任务有效期为 24 小时；旧脚本仍不能通过重复运行升级为真实安装，服务重启后也需要重新生成脚本。

Windows 控制台脚本启用 UTF-8 代码页；如果字符仍乱码，查看脚本末尾的英文 `SANDBOX TEST finished` 或 `REAL INSTALL finished`。运行结果同时保存在 `%USERPROFILE%\.newapi-oneclick\last-result.json`（真实安装）或脚本显示的 `SANDBOX HOME` 中（测试模式）。检查其中 `success`、`model`、`restart_attempted`、`restarted` 和 `backup_dir`；若 `restart_attempted` 为 true 但 `restarted` 未包含 WorkBuddy，手动退出并重开 WorkBuddy。使用本机程序及备份目录执行恢复：`oneclick\public\bin\setup-windows-amd64.exe --home "$HOME" --restore "备份目录"`。恢复前需确认备份目录确实由本次安装产生。

生成脚本后网页先显示“等待运行”，安装器完成后通过短期任务地址回传**不包含 API Key** 的执行结果；只有收到回报才显示测试通过或真实配置写入。页面关闭、任务过期或网络异常时，请以本机 `last-result.json` 为准。网页显示的“已发出重启命令”只表示启动命令返回成功，不等同于确认软件已经正常打开，仍需在客户端手动确认默认模型和发送一条测试消息。

主站的“API 密钥”页也提供入口。可把 `http://127.0.0.1:8787/setup/?code=兑换码` 发给同一台电脑的测试用户；兑换码预填后从地址栏移除。公网部署不直接使用该本地测试脚本或本地服务端口。

本机数据库与网关依赖原有 Docker Compose。若 BFF 启动时提示数据库 `127.0.0.1:5433` 拒绝连接，先启动 Docker Desktop 和 `new-api/` 原有容器，不需要创建新数据库。已有有效套餐的自动化闭环验证：`node scripts/verify-oneclick-local.mjs`；它会验证实际模型列表、下载后的 `.cmd` 运行、虚拟用户默认模型和备份恢复，不会使用未兑换的新码。

## 边界

- 合并规则：其他供应商、未选中旧模型和附加字段保留；当前供应商相同模型 ID 更新。ZCode、DSH、Hermes 使用按接口地址隔离的供应商标识，第三方站点也不会共用同一密钥变量。ZCode 的模型显示名使用真实模型 ID，供应商名为 `WBAI微:36612995`。
- WorkBuddy/CodeBuddy 的模型文件只有全局模型 ID，没有供应商级唯一标识。选中 ID 已属于其他接口时，安装停止并保留原配置，不写入重复 ID；可以取消冲突模型或改用 ZCode/DSH/Hermes。同平台旧 `www` / 新 `api` 地址视为同一供应商。支持 CodeBuddy 国内版 `.codebuddycn` 和国际版 `.codebuddy`。
- 无数据库也能执行完整隔离验收：先构建 `oneclick/bin/server-local.exe` 与 Windows 安装器，再运行 `node scripts/verify-oneclick-isolated.mjs`。它会启动临时模型服务，实际下载并运行 `.cmd`，验证五客户端多模型、默认项、回传、手动恢复及多客户端失败自动恢复；测试服务结束后关闭，临时配置目录用于检查。
- `scripts/start-oneclick-local.ps1` 启动依赖原数据库的主站集成；`oneclick/start-local.ps1` 是独立 Go 演示服务，不提供主站 `/setup/` 兑换入口，两者不要同时占用 8787。

- Go 配置子服务由 Node 门户服务启动，监听随机 `127.0.0.1` 端口，会员临时授权 30 分钟后失效；已生成的安装任务有效期为 24 小时，配置最多获取三次；子服务停止后任务失效。任务配置接口仍会对持有短期任务地址的程序返回密钥。安装器本身以本机可读取的形式写入客户端配置，无法对客户电脑主人保密。
- 本地网页不能扫描用户电脑应用；手选客户端。安装器只修改已经存在配置目录的所选软件，TRAE 仍需人工配置。macOS 只有交叉编译版，尚未实机验证。
- 如需取消集成：停止测试进程，使用备份目录中的同名文件恢复 `server.mjs`、`vite.config.mjs`、`.gitignore`、`README.md`、`src/MemberPages.jsx`；关闭服务后可删除新增的 `oneclick/`、`server/oneclick.mjs`、`scripts/start-oneclick-local.ps1`、`oneclick/start-local.ps1`、本说明。恢复前核对目标路径仍在本项目目录内，避免影响后续修改。项目数据库和现有客户配置文件无需回滚；**已经兑换的测试码不会因代码回滚而恢复为未兑换**。
