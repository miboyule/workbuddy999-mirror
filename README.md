# WorkBuddy 官方积分充值兑换平台

本项目是 WorkBuddy 官方积分充值兑换平台的本地前端与 NewAPI 联调工程，使用 React + Vite 构建。页面参考 `workbuddy.miaotui.cc` 的真实流程与教程内容，并采用 WorkBuddy 官方 Logo 与品牌配色。

## 本地运行

```powershell
npm install
npm run dev
```

打开 <http://localhost:5173/> 进入前台。当前已启用 live 模式，兑换码会通过本地 BFF 连接 NewAPI；可使用下方列出的未兑换测试码验证流程。

一键配置 Agent 的**本地集成测试入口**为 <http://127.0.0.1:8787/setup/>。在项目根目录运行 `powershell -ExecutionPolicy Bypass -File .\scripts\start-oneclick-local.ps1`，输入已激活且仍有效的兑换码，即可选择模型和客户端并下载隔离安装助手。完整测试、回滚步骤见 `docs/oneclick-local-integration.md`；默认启动主站时不启用该入口，不改动现有客户配置。

## 当前范围

已实现登录入口、兑换码激活、充值订单、兑换/充值/用量记录、模型中心、WorkBuddy/CodeBuddy/TraeWork/ZCode/扣子教程、FAQ、法律页面、客服二维码和响应式移动端布局。登录页的中文资讯共 20 条，固定显示约 5 行，自动从下向上循环且隐藏滚动条；每日采集任务会更新中文人工智能与 WorkBuddy 相关标题。

域名配置目标：`www.workbuddy999.top`。

## 镜像部署

本仓库同时包含前台、BFF、一键配置助手、定制 NewAPI 网关的构建入口，以及 `yeradminer.workbuddy999.top` 对应的后台容器编排。源码仓库不提交 `.env`、兑换码、数据库备份和 136 MB 的网关二进制；网关二进制作为 GitHub Release 资产发布，安装脚本会在服务器上下载。

在新服务器上安装 Docker、Git 和 curl 后执行：

```bash
git clone https://github.com/miboyule/workbuddy999-mirror.git ~/workbuddy999-mirror
cd ~/workbuddy999-mirror
sudo ./install.sh
```

如果要恢复当前服务器的账户、兑换码、余额和模型配置，先把 PostgreSQL `pg_dump -Fc` 文件放到服务器，然后执行：

```bash
sudo ./install.sh --db-backup /var/backups/workbuddy/database-live.dump
```

后续同步只需在仓库目录执行 `git pull` 后再次运行 `sudo ./install.sh --dir /opt/workbuddy-prod`。脚本会保留 `.env` 和 Docker 数据卷，更新前台/BFF/网关并执行本地健康检查。域名证书和外层 Nginx 由 `deploy/prod/configure-host-nginx.py` 配置；如果服务器没有宝塔面板，可把三个域名反代到本机 8088、8787、3002 端口。

## 本地 NewAPI

`new-api/` 使用官方 `calciumion/new-api:latest` 镜像，已通过 Docker Compose 启动 PostgreSQL、Redis 和 NewAPI。由于本机 3000 端口已被占用，NewAPI 映射到 <http://localhost:3001>，容器内部仍使用 3000；当前容器状态为 healthy。

```powershell
cd new-api
docker compose up -d
docker compose ps
```

后台地址：<http://localhost:3001>  
管理员账号：`wbadmin`  
管理员密码请使用本地 `.env` 或部署服务器上的密码，不写入仓库。

生产环境部署前请替换 Compose 中的数据库/Redis 密码和 `SESSION_SECRET`，再将域名反向代理到容器端口。

## 本地对接服务

前端开发服务：<http://localhost:5173>  
BFF 服务：`http://127.0.0.1:8787`  
前端会通过 `/api/portal/*` 代理到 BFF，兑换码登录、账户余额、兑换记录、订单和退出登录都已接入 NewAPI。

门户通过 `shared/billing.mjs` 统一积分、人民币和 NewAPI 额度：20积分=¥1面值，USD/CNY内部记账汇率7，1积分约3571.428571额度（最终取整）。一位客户对应一个 NewAPI 会员账户，每张兑换码绑定到该账户并生成一把独立 Token；后续兑换码在会员中心追加到同一账户。兑换码也可以直接作为 `/v1` 的 Bearer Key，本地首次请求时自动激活。

## 兑换码批次

兑换码格式为“前缀-16 位小写十六进制随机串”。已生成并导入 NewAPI：

| 前缀 | 面值 | 数量 |
| --- | ---: | ---: |
| `wb200` | 200 积分 | 20,000 |
| `wb1k` | 1,000 积分 | 10,000 |
| `wb5k` | 5,000 积分 | 10,000 |
| `wb1w` | 10,000 积分 | 10,000 |
| `wb2w` | 20,000 积分 | 5,000 |
| `wb3w` | 30,000 积分 | 5,000 |
| `wb5w` | 50,000 积分 | 5,000 |
| `wb10w` | 100,000 积分 | 5,000 |

未兑换测试码示例：

```text
wb200-0011a5ca79729311
wb1w-0002f26ccf1080a6
```

兑换码数据文件位于 `data/redemptions.csv`、`data/redemption-index.json` 和 `data/exports/`。全部套餐均已导入 NewAPI，兑换码为首次登录或首次连接接口时激活，激活后按自然月有效一个月；未激活不计时。运行 `node scripts/create-redemptions.mjs` 可幂等补齐目标数量并刷新导出文件。

教程页内置 WorkBuddy Windows、macOS、手动配置视频，视频从本地 `/public/videos/` 提供播放和下载。Windows/macOS 配置入口同时提供一键启动器与脚本源码，启动器默认从 `www.workbuddy999.top` 下载脚本，可用 `WORKBUDDY_SETUP_BASE_URL` 覆盖为测试地址。

计费统一（2026-10-27）：所有 WorkBuddy 渠道模型按响应 `usage.credit` 实际积分1:1结算，保留20积分=¥1和现有套餐额度。需要使用本项目定制网关，先构建及启用定制网关，再运行 `node scripts/enable-upstream-credit.mjs --apply`（默认仅预览）。该脚本只配置渠道计费并移除旧固定价格，不缩放余额、不修改历史消费、不补扣。上线和回滚步骤见 `docs/upstream-credit-billing.md`。
