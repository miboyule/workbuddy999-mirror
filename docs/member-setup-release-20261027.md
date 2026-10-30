# 会员一键配置与模型价格更新（2026-10-27）

生产地址：https://www.workbuddy999.top 。本次更新沿用 `/opt/workbuddy-prod` 的定制 NewAPI 网关，没有替换 `workbuddy-newapi:credit-20261027`。

## 已上线

- 已登录首页直接显示当前有效 API Key，并提供复制按钮。账户恢复期间显示加载状态，刷新不会短暂展示登录页；非 401 错误提供重试。
- WorkBuddy Windows 教程向已登录会员提供专属 `workbuddy-setup.cmd`。下载文件包含该会员的 API Key（Base64 只是传输编码），不可转发。双击时自动下载最新 PowerShell 安装器；安装器从本人 `/v1/models` 与站点渠道清单取交集，按客户端公开倍率从低到高写入模型。原 `models.json` 会先备份，并保留其他设置和模型。
- 可见模型 39 个渠道 ID，去除 `cn:` 同名别名后安装清单为 24 个；能力参数只写已从客户端元数据确认的值。未确认倍率的模型不标虚假的 `x` 数字，排在已知倍率之后。
- 给有明确厂商参考价的 21 个渠道 ID（含别名）写入 NewAPI `ModelRatio` 与 `CompletionRatio`，按每百万 Token 的人民币输入/输出价格折算。7 个会员账号开启显示未定价模型，确保其他模型仍可见。未知官方型号对应关系的模型继续标记待核实，不填猜测价格。
- 实际会员消费仍由 `usage.credit` 1:1 结算；模型参考价、人民币面值与上游积分采购成本是不同口径。客户端自定义 OpenAI 接口没有已验证的第三方原生余额展示入口，余额和消费在本站会员中心实时查看。

## 验证与备份

- 本地 `node --test tests/workbuddy-setup.test.mjs`：目录去重、倍率排序、无输入安装、旧配置备份与保留、UTF-8 无 BOM 均通过。
- 生产 `node scripts/verify-member-setup.mjs`：39 个可见渠道 ID、24 个客户端模型、21 个参考定价 ID、会员会话与专属下载均通过。
- 浏览器验证：首页密钥可见，刷新时未观察到登录页；模型中心显示 24 项，桌面与 390px 手机没有页面级横向溢出。静态 CSS 已校验 MIME 为 `text/css`。
- `scripts/production-smoke.mjs` 通过；五个容器均运行。数据库保留 70,000 个兑换码、7 个会员账户和 9 个存续密钥。
- 参考价更新后，`deepseek-v4-pro` 一笔真实请求的上游 `usage.credit` 为 0.03，消费日志 `upstream_credit` 同为 0.03。
- 更新前数据库快照：`/var/backups/workbuddy/database-pre-member-setup-20261027.dump`。更新前主要应用文件快照：`/var/backups/workbuddy/app-pre-member-setup-20261027.tgz`；当前完整 BFF 源码和前端资源快照：`/var/backups/workbuddy/app-member-setup-20261027.tgz`。

模型官方参考价及来源见 `shared/model-pricing.mjs`；客户端倍率和能力快照见 `shared/workbuddy-catalog.mjs`。参考价随厂商变更需要定期核对；有分时价时 NewAPI 目前采用该文件列出的第一档作静态参考，实际会员积分扣费不使用该静态档位。
