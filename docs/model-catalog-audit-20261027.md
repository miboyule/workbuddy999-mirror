# 模型清单核对 · 2026-10-27

## 数据来源

- 本站 `GET /api/portal/setup/catalog` 从启用的 WorkBuddy 渠道读取模型 ID，去重后 24 款；不代表每一款目前都存在于上游最新目录。
- 上游已登录的 `GET https://work.qiyue999.com/api/model-catalog?realm=cn&force=false` 返回 19 款（含 `auto`）；其中 18 款与本站渠道重合。上游国际版返回 0 款，提示没有可用账号。不要把未接入渠道的 `auto` 伪装成本站可用模型。
- 上游 `credits` 形如 `x0.71`，属于上游积分倍率而非每次请求扣费。本站计费仍按响应的实际 `usage.credit` 结算，不对该数值再次乘倍率；厂商官方人民币报价不等于上游转售倍率。

## 本次更新

- 与上游目录对齐：`deepseek-v4.1-flash` 0.11x、`glm-5.3` 0.69x、`glm-5.1` 0.79x、`glm-5v-turbo` 0.71x。前两项与旧客户端截图不同，采用本次实时清单值；如果上游再次变更，应复核显示，不影响实扣结算。
- 依上游 `context_length` / `max_output_tokens` 修正 `glm-5v-turbo`、`hy4-preview`、`minimax-m3` 等上限，补齐 `kimi-k3.1-pro`、`minimax-m3.1-flash`、`space-bunny`、`step-5-preview`、`mimo-v2.6-pro`。页面展示的是模型能力上限，具体账户/客户端仍可能限制请求。
- 渠道中未出现在上游当前 19 款清单的型号：`deepseek-v4-flash`、`kimi-k2.5`、`kimi-k2.6`、`kimi-k2.7`、`minimax-m2.5`、`minimax-m2.7`。其中 `deepseek-v4-flash` 和 `kimi-k2.7` 保留历史已核实倍率；其余四款无可验证倍率，显示“倍率待核实”，不按型号猜测。`kimi-k2.5` 的输入/输出同样待核实；另三款沿用已保存的客户端参数，等待上游确认。

上线前需确保 BFF 的 `shared/workbuddy-catalog.mjs`、`shared/model-pricing.mjs` 与前端 `dist/` 同步发布；仅发布前端无法改变模型目录接口。
