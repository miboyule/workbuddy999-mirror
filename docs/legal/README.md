# 本站协议维护记录

版本：2026-10-26-v2；发布与生效日期：2026年10月26日。

用户指定参考：

- https://tokenhub.wetok.ai/user-agreement
- https://tokenhub.wetok.ai/privacy-policy

2026-10-26 从上述页面公开接口读取完整正文，原文快照位于 `docs/reference/tokenhub-user-agreement-source.md` 和 `docs/reference/tokenhub-privacy-policy-source.md`。保留原章节内容并按本站功能调整；最终用户协议14章，隐私政策11章。

用户确认暂时没有公司名称，使用“WorkBuddy积分充值兑换平台运营方”。网站为 `www.workbuddy999.top`，客服及隐私联系为微信/QQ：36612995，不填造公司名称、地址、邮箱或特定法院所在地。

调整内容包括：兑换码登录、账户关联和套餐密钥；20积分=人民币1元面值及按成功请求计费；自然月有效期；商城实付与面值区分；微信绑定预留状态；Cookie和会话；同步转发、必要错误诊断及异步任务的区别；Bing图片、外部商城、客户端及配置工具；通过客服申请注销与个人信息权利。原文未填的保存期限以当前实际保留方式及处理目的说明替代，未虚构自动删除机制，未把一般登录同意表述为跨境处理的单独同意。

维护步骤：

1. 修改 `scripts/import-legal.mjs` 中平台信息或原文适配内容，执行 `node scripts/import-legal.mjs`，生成本站Markdown及 `src/legal.json`。
2. 执行 `node scripts/sync-legal.mjs`，使用本地配置的管理员接口更新 NewAPI 两个法律设置。脚本先备份原内容到 `backups/legal-newapi-*.json`，再更新并回读核对，不修改其他设置。
3. 重启会员服务，确保新登录会话记录 `src/legal.json` 中的版本号；不追溯修改已有会话的历史版本。
4. 执行前端构建并检查协议链接及移动端。主路径为 `/terms`、`/privacy`，兼容 `/user-agreement`、`/privacy-policy`。

验证记录：前端构建通过；用户协议14章、隐私政策11章及9个小节正确渲染，目录锚点全部存在，粗体和编号列表正确显示，390px手机无横向溢出。NewAPI的两个公开协议接口均与本站Markdown全文一致。会员登录接口未勾选协议返回400，勾选后返回200并记录版本 `2026-10-26-v2`，账户读取正常；验证使用已激活测试兑换码，没有新增激活或扣费。

历史门户文稿备份：`backups/legal-before-20261026-v2.json`。此次只更新本地工程及本地NewAPI，正式服务器部署尚未执行。
