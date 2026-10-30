# 自然搜索内容与发布检查

## 页面定位

- `/guide/workbuddy-credits/` 回答“workbuddy 积分购买、价格、获取、领取、消耗、充值、兑换、token、积分不够用”。同义词按用户问题自然组织，不建只有关键词没有答案的落地页。
- `/guide/workbuddy-setup/` 解释自定义模型、API Key、余额和常见报错；只引用会员中心当前可用的模型 ID。
- `/guide/workbuddy-news/` 展示第三方公开 RSS 的标题、短摘要、原文出处和日期。`server.mjs` 每小时检查一次上海日期，最多每天更新一次；若来源失败保留旧内容。发布前 `npm run build` 会用现有 JSON 生成静态资讯页，生产更新由 BFF 写入共享 `public` 目录，由 Nginx 的 `/guide/workbuddy-news/` 别名实时提供。
- 本站为独立兑换与模型接入服务。不要用“官方直营充值”“与官方售价相同”或“免费无限领取积分”等未经证实的承诺；页面明确区分本站面值、支付实付及官方内置模型额度。

## 发布与收录

1. 构建后确认 `dist/guide/.../index.html` 含正文和唯一 title、canonical，`dist/robots.txt`、`dist/sitemap.xml` 返回正确 MIME 类型，不是 SPA 回退的首页 HTML。
2. 上线后在 Google Search Console 和百度搜索资源平台完成域名验证，分别提交 `https://www.workbuddy999.top/sitemap.xml`；验证方式按平台提供的 DNS TXT 记录操作，不要把验证码提交到仓库。
3. 用平台的 URL 检查工具分别测试三页抓取、可索引状态和实际选择的规范网址。站点是会员 SPA，`/console` 不加入 sitemap，也不要索引账户页。
4. 每周查看自然搜索曝光、点击、搜索词和收录情况；优先完善能够回答真实问题的内容，不按搜索热词自动生成薄内容，不承诺收录时间或自然搜索排名。
5. 新闻自动采集只更新公共资讯页，不自动伪造价格或积分公告；官方套餐/价格变化应核对官方页面和本站订单后人工更新指南。
