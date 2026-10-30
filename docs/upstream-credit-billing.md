# WorkBuddy 实扣积分结算（2026-10-27）

上游 `https://work.qiyue999.com/v1/chat/completions` 的响应包含 `usage.credit`。实测 SSE 最终 usage 返回数值，明确的 `0` 也有意义。客户端模型列表中的 `x0.08` 是倍率，不是每次请求的积分价格。不能从截图中的总 Token 数推导各模型完整价格，也不应套用模型厂商 API 价格。

新规则：本站消耗积分 = 上游 `usage.credit`，不叠加分组倍率、Token 费用或工具调用附加费；底层额度 = round(积分 × 500000 ÷ 7 ÷ 20)。20积分=¥1面值与套餐有效期保持原约定。0.51积分对应1821额度，0.52积分对应1857额度，0积分对应0额度。钱包使用整数额度，每次存在不足0.00014积分的舍入差；记录保留原始上游积分用于核对。

所有映射到已配置 WorkBuddy 渠道的模型和 `cn:` 别名使用同一规则，包括未出现在静态目录的模型。默认渠道不启用这一行为，只有可信上游渠道的 `setting.upstream_credit_quota` 配置为当前每积分额度时启用。`usage.credit` 从上游响应读取，不从客户端请求读取。

每次请求预留约1积分，正常结算时按实扣退补。没有返回 credit、数值无效或流被提前中断且未收到计费帧时保留实际预留额度，并写入 `billing_status=missing_credit/invalid_credit`，门户显示“待核对”，不将预留伪装为已结算消耗。管理员需按请求及上游账单人工核对这些记录；本版不自动猜价或批量补扣。余额不足1积分可能无法发起请求。

## 启用

1. 备份数据库和当前网关镜像；停止外部模型请求，避免迁移窗口中的旧缓存扣费。
2. 构建本项目定制 NewAPI，保留原镜像用于回滚。定制版本 `/api/status` 返回 `data.upstream_credit_billing=true`。
3. 先运行 `node scripts/enable-upstream-credit.mjs` 预览，再运行 `node scripts/enable-upstream-credit.mjs --apply`。脚本以事务保存渠道 JSON，删除渠道模型及别名的旧固定价格，备份旧配置到 `backups/upstream-credit-*.json`。不改兑换码、余额或历史消费。
4. 立即重启 NewAPI 刷新配置缓存，再重启 BFF，构建部署门户前端。恢复请求前验证 JSON 和 SSE 的 credit、钱包、Token及使用记录一致。
5. 历史消费维持原记录。截图中的0.51、0.52不会追溯改写为新扣费，避免无授权补扣。

本地构建使用 `bun run build`（new-api/web），再在 new-api 目录设置 `GOOS=linux`、`GOARCH=amd64`、`CGO_ENABLED=0` 后执行 `go build -o ../deploy/new-api-credit .`。`deploy/Dockerfile.credit` 基于原网关镜像替换二进制。生产更新还应同步门户 dist、BFF server/shared 和迁移脚本。

本版适用于 `/v1/chat/completions` 的 JSON 和 SSE 请求。启用实扣积分的渠道会在发送前拒绝其他端点，避免不支持的端点落回旧价格。所有该渠道上的模型及别名共用该机制，不需要逐模型填写猜测的 Token 单价。

本地使用 `docker build -f deploy/Dockerfile.credit -t workbuddy-newapi:credit-20261027 deploy` 构建，然后 `docker compose -f new-api/docker-compose.yml -f deploy/local.override.yml -f deploy/local.credit.yml up -d --no-deps new-api` 切换。后续本地重建也要带 `local.credit.yml`，否则可能恢复官方镜像而失去实扣结算能力。

## 本轮验证

- `go test ./relay/helper ./relay/channel/openai` 通过；JSON、SSE、显式0积分与分帧用量均覆盖。
- `go test ./service -run 'TestUpstreamCredit|TestFixedPriceBillingDatabaseMatrix|TestPostTextConsumeQuotaLogsMissingUsage' -count=1` 通过；其中既有数据库矩阵未配置的 MySQL/PostgreSQL 分支自动跳过，不代表完成三库矩阵。新积分用例验证预留退补、钱包/Token扣费、重复结算和异常数值。
- relaykit 在 `GOWORK=off` 下独立构建及 credit 字段合并测试通过。门户测试及前端构建通过。
- 本地真实 PostgreSQL 联调：非流式请求返回0.05积分，扣179额度；SSE请求返回0积分，扣0额度；钱包、Token与消费日志一致。门户账户接口显示0.05与0积分。
- 数据库备份：`backups/workbuddy-before-credit.dump`；配置备份：`backups/upstream-credit-*.json`；原镜像保留为 `workbuddy-newapi:before-credit-20261027`。
- 可用 `node scripts/verify-upstream-credit.mjs --token-id=内部测试密钥ID` 重跑真实上游联调，测试会产生少量消耗。不要使用客户密钥执行测试。
- 本次只切换本地环境，未向生产服务器上传或替换容器；生产需要按启用步骤同步定制网关和门户。官方原版镜像不识别该渠道字段，不能只上传前端或只运行迁移。

## 回滚

先暂停入口并保留新消费日志。按备份恢复渠道 setting 和定价 options，重启原镜像；不恢复整库覆盖新消费。缺失字段的待核对记录需按上游账单单独处理。历史单位迁移脚本 `unify-billing.mjs` 已停用，不能用它重置现有余额。
