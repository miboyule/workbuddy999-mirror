# 参考站采集与实现说明

本目录保存了对 `https://workbuddy.miaotui.cc/` 已登录页面、公开入口和 `https://www.workbuddy.cn/` 官方品牌页的结构化采集结果。采集内容只用于本地前端的内容核对与信息架构设计，账户 API Key、登录兑换码和真实密钥均已脱敏。

## 已覆盖的页面和状态

- 公开登录页：兑换码入口、条款/隐私同意、客服二维码入口。
- 控制台：余额、兑换表单、充值入口、公告、客户端入口、模型概览。
- WorkBuddy：Windows、macOS、手动、AI 配置模式。
- CodeBuddy：国内版 / 国际版 × Windows / macOS / 手动 / AI 配置模式。
- TraeWork：桌面端配置限制、六个逻辑步骤及模型能力表。
- 扣子：网页版 / 桌面端、自定义接入、付费版提示与五个步骤。
- 常见问题：7 个问题及展开答案、错误码说明。
- 兑换记录、充值记录、使用记录、微信绑定弹窗、服务条款、隐私政策。

本地前端对应路由为 `/console`、`/console/models`、`/console/recharge`、`/console/workbuddy`、`/console/codebuddy`、`/console/traework`、`/console/coze`、`/console/faq`、`/console/redeems`、`/console/orders`、`/console/usage`、`/terms` 和 `/privacy`。

## 素材和模型

- 官方 Logo：`public/brand/workbuddy.png`；图标：`public/brand/workbuddy-icon.png`。
- 客服二维码：`public/wechat-qr.png`，页面中侧栏使用约 112px，弹窗使用约 228px，并支持点击放大。
- 教程图片 16 张位于 `public/tutorials/`，参考操作视频 3 个位于 `public/videos/`。
- 参考站公开配置清单包含 11 个一键配置模型；客户端截图和能力资料补充后，首页与模型中心展示 23 个模型。未知接口 ID、参数和价格保留为“待同步”，没有凭空补全。

## 前端与后端边界

前台已经通过本地 BFF 接入 NewAPI：兑换码登录会创建独立会员账户和 API 密钥，兑换码首次登录或首次调用 `/v1` 时激活，激活后按自然月有效；数据看板、密钥、兑换记录、充值记录和用量记录从 NewAPI 读取。充值订单会记录商城跳转状态，实际支付仍由 `https://wzyp.cn/shop/qiyue888` 完成。

本地服务地址为：前台 `http://localhost:5173`、BFF `http://127.0.0.1:8787`、NewAPI 管理后台 `http://localhost:3001`。生产接口地址默认使用 `https://www.workbuddy999.top/v1`，可由环境变量覆盖。NewAPI 的模型列表只有在管理后台配置上游渠道后才会出现。

`public/setup/` 下的配置工具会向接口的 `/models` 读取模型，备份已有 `models.json`，保留无冲突模型并按 ID 合并；检测到无效 JSON 会停止且不覆盖。工具不会内置任何 API Key。

## 运行和验证

```powershell
npm install
npm run dev
npm run build
```

本地可用 `data/exports/` 中的未使用兑换码登录；兑换码登录、条款校验、账户数据、密钥生成和 `/v1/models` 代理已经通过真实 NewAPI 回归。正式上线仍需配置服务器反向代理、HTTPS、支付回调、微信开放平台绑定和真实上游渠道凭证。

一键入口包括 Windows `.cmd`、PowerShell `.ps1`、macOS/Linux `.command` 和 bash `.sh`。Windows/macOS 启动器默认从 `https://www.workbuddy999.top/setup/` 拉取脚本，也可通过 `WORKBUDDY_SETUP_BASE_URL` 指向测试服务器；配置前会提示接口地址和 API Key，不会把密钥写入网页或启动器。WorkBuddy 的 Windows、macOS、手动操作视频已下载到 `public/videos/`，教程页使用本地 `/videos/*.mp4` 播放并提供下载按钮。
