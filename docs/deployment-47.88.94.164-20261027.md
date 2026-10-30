# WorkBuddy 正式部署记录 · 2026-10-27

已将本机最新版前端、BFF、定制 NewAPI 和数据库快照部署至 `47.88.94.164`。

| 用途 | 地址 |
| --- | --- |
| 用户网站 | https://www.workbuddy999.top |
| 模型接口 | https://api.workbuddy999.top/v1 |
| API 健康检查 | https://api.workbuddy999.top/health |
| NewAPI 管理后台 | https://yeradminer.workbuddy999.top |

## 环境与数据

- 实测 SSH 管理端口为 **2228**，使用既有密钥成功登录 root；2288 连接超时。
- 面板 30720 的 UFW 规则只允许原有两个来源 IP；本次 SSH 出口 `115.150.70.14` 已在其中，没有扩大面板访问范围。未确认公网面板入口可达。
- 程序目录 `/opt/workbuddy-prod`，独立 Docker Compose 项目 `workbuddy-prod`。
- 五个服务：`wb-web`、`wb-bff`、`wb-new-api`、`wb-postgres`、`wb-redis`。
- 应用监听仅绑定本机 8088、8787、3002；数据库与 Redis 仅在 Docker 网络内访问。
- 数据来源为本机 2026-10-27 00:57 UTC 的 PostgreSQL 一致性快照。新服务器此前没有 WorkBuddy 数据库；原有 PHP 网站及数据库保留。
- 恢复并核对 **70,000 个兑换码、7 个门户账户、9 个有效存续密钥**。原有 33 条成功调用日志保留，上线实测新增 2 条，之后正常调用继续累积。
- 保留本机 `PORTAL_SECRET` 以兼容已有加密字段，数据库、Redis 和 NewAPI 会话签名使用独立部署密钥。凭据位于服务器 `.env`，未写入本文。

## 计费验收

生产网关镜像为 `workbuddy-newapi:credit-20261027`，`/api/status` 包含 `upstream_credit_billing=true`。

二进制 SHA256：`410110da3e9da41347e9ceec0075a7c0f6ba34577b5a99dd7c84c5e98184e6c0`。

WorkBuddy 渠道按 `usage.credit` 1:1 实扣，48 个模型别名已移除旧按次收费配置。20 积分对应 ¥1 面值。保留原余额与历史流水，不回补旧消费差额。

通过正式 `api` 域名和内部测试密钥完成两次真实请求：

| 请求 | 上游积分 | NewAPI 内部 quota | 门户消费记录 |
| --- | ---: | ---: | ---: |
| 普通 JSON | 0.05 | 179 | 0.05 |
| 流式 SSE | 0 | 0 | 0 |

已验证密钥余额差额、消费日志、上游原始 credit 三者一致；通过用户网站实际登录回读上述两条消费记录，均为 settled。

## 登录会话修复

验收发现旧 BFF 并发读取账户时重复登录，测试账户达到 NewAPI 50 个活动会话上限并返回 `AUTH_SESSION_LIMIT`。

已将后台会话加密保存至 `portal_upstream_sessions`，按真实过期时间复用，通过刷新令牌续期；进程内合并并发登录，数据库锁协调不同进程。已有额度及模型 API 密钥不受此表影响。

由于本次 NewAPI 签名密钥已更换，恢复快照中的旧后台登录凭据无法继续验证，已撤销快照时间之前的 157 个活动后台会话，保留审计记录。门户会员登录状态与模型密钥未批量撤销。

验证结果：

- 12 个并发调用只发起 1 次登录；重建模块后复用持久化会话。
- 本地集成测试验证过期刷新及新刷新令牌的加密保存。
- 正式环境强制刷新保持原会话 SID，不增加会话数；重启 BFF 后继续正常登录。
- 内部测试账户和最新会员均通过正式网站 API Key 登录，返回 39 个可用模型；管理员登录验证通过。
- 历史测试账户 `portal_accounts.id=1` 的内部密码不匹配问题在迁移前本机也存在，本次保留原状；未验证所有历史测试账户的登录。

## 域名、HTTPS 与下载

三个域名均经 Cloudflare 回源至新服务器。已逐一验证公网访问和绕过 Cloudflare 的源站 HTTPS 返回 200。

Let's Encrypt 证书覆盖三个域名，路径 `/etc/letsencrypt/live/workbuddy999.top/`，有效期至 2027-01-25。自动续期任务已启用，续期后通过 deploy hook 校验并重载 `chengyao-nginx`。

Nginx 配置文件 `/www/server/panel/vhost/nginx/workbuddy999.top.conf`。模型接口关闭代理缓冲，读取超时为 300 秒，已通过 SSE 实测。

一键配置启动器下载路径 `/setup/workbuddy-setup.cmd` 已通过 HTTPS 下载验证。BFF 与网站共享 public 数据，使新闻刷新能显示到网站。

## 备份与维护

服务器备份：

- `/var/backups/workbuddy/nginx-before-20261027.tgz`：部署前虚拟主机配置。
- `/var/backups/workbuddy/database-local-20261027.dump`：原始迁移快照。
- `/var/backups/workbuddy/database-live-20261027.dump`：上线验收后的数据库快照。
- `/opt/workbuddy-prod/backups/upstream-credit-*.json`：计费迁移配置快照。

常用检查：

```sh
cd /opt/workbuddy-prod
docker compose ps
docker compose logs --tail=80 wb-bff wb-new-api
docker exec wb-bff node scripts/production-smoke.mjs
curl -fsS https://api.workbuddy999.top/health
```

`start-release.sh` 仅用于空数据库初始化，检测到已有表会中止，不能作为日常重启命令。日常重启使用 `docker compose restart`。

更新前先做数据库备份，保留当前镜像标签及 `.env`。不得用官方 NewAPI 镜像直接替换定制镜像，否则上游积分设置不会按本次逻辑结算。若需暂停新站，可停止 `wb-web`、`wb-bff`、`wb-new-api`，保留数据库与 Redis 存储卷；域名回切需要同步调整 Cloudflare。不要执行 `docker compose down -v`。

旧服务器 `8.163.82.23` 未在本次迁移中取得访问，因此未与其数据库合并；若该旧环境另有迁移快照之后的真实交易，需要另行对账。
