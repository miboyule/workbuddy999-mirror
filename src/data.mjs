import { pricingById } from '../shared/model-pricing.mjs';
import { modelLabel, modelProfile } from '../shared/workbuddy-catalog.mjs';
import { MODEL_API_BASE_URL } from '../shared/endpoints.mjs';
export { creditPlans } from '../shared/billing.mjs';
import importedFaq from './faq-imported.json';
// Sources and field-level limits: docs/reference/README.md.
export const SITE = {
  name: 'WorkBuddy 积分兑换与模型配置服务', domain: 'www.workbuddy999.top', contact: '36612995',
  logo: '/brand/workbuddy.png', icon: '/brand/workbuddy-icon.png', qr: '/wechat-qr.png',
  baseUrl: import.meta.env?.DEV && import.meta.env?.VITE_MODEL_BASE_URL ? import.meta.env.VITE_MODEL_BASE_URL : MODEL_API_BASE_URL,
  // Live BFF/NewAPI is the default. Set VITE_PORTAL_MODE=preview only for a
  // deliberately isolated browser-only demo without a running backend.
  preview: import.meta.env?.VITE_PORTAL_MODE === 'preview',
};
export const providers = [
  { id: 'zhipu', name: '智谱 AI', sub: 'GLM 系列', mark: 'Z', desc: '复杂推理、编程与视觉理解' },
  { id: 'deepseek', name: 'DeepSeek', sub: '深度求索', mark: 'D', desc: '深度思考与高效代码生成' },
  { id: 'minimax', name: 'MiniMax', sub: '稀宇科技', mark: 'M', desc: '长文档、多模态与轻量任务' },
  { id: 'kimi', name: 'Kimi', sub: '月之暗面', mark: 'K', desc: '研究分析与复杂任务协作' },
  { id: 'tencent', name: '腾讯混元', sub: 'Hunyuan', mark: 'H', desc: '通用智能与日常办公' },
  { id: 'step', name: '阶跃星辰', sub: 'StepFun', mark: 'S', desc: '编程与专业知识工作' },
  { id: 'qwen', name: '通义千问', sub: '阿里云 · Qwen', mark: 'Q', desc: '日常编程与多模态问答' },
  { id: 'mimo', name: '小米 MiMo', sub: 'Xiaomi', mark: 'mi', desc: '复杂推理与高效任务处理' },
  { id: 'space', name: 'Space-Bunny', sub: '客户端模型', mark: 'B', desc: 'WorkBuddy 客户端收录；厂家待核实' },
  { id: 'auto', name: 'Auto 智能选择', sub: '自动选择模型', mark: '✦', desc: '不确定选哪个？从 auto 开始' },
];
const model = (id, name, provider, extra = {}) => ({ id, name, provider, source: 'reference', ...extra, pricing: pricingById[id] });
export const models = [
  model('glm-5.3', 'GLM-5.3', 'zhipu', { input: 1048576, output: 131072, vision: false, tag: '旗舰推理', scene: '复杂逻辑、深度推理与高难度编程' }),
  model('glm-5.3-flash', 'GLM-5.3-Flash', 'zhipu', { input: 1048576, output: 131072, vision: true, tag: '日常主力', scene: '写代码、改 Bug、理解截图' }),
  model('glm-5.2', 'GLM-5.2', 'zhipu', { input: 262144, output: 131072, vision: false, source: 'capabilities', scene: '参考站配置清单收录' }),
  model('glm-5.1', 'GLM-5.1', 'zhipu', { source: 'screenshot' }),
  model('glm-5v-turbo', 'GLM-5v-Turbo', 'zhipu', { source: 'screenshot' }),
  model('glm-5-turbo', 'GLM-5-Turbo', 'zhipu', { source: 'manual', scene: '参考站手动配置专属' }),
  model('deepseek-v4.1-flash', 'Deepseek-V4.1-Flash', 'deepseek', { input: 1048576, output: 393216, vision: true, tag: '高效轻量', scene: '日常问答、简单修改与快速响应' }),
  model('deepseek-v4-pro', 'Deepseek-V4-Pro', 'deepseek', { input: 1048576, output: 393216, vision: false, scene: '复杂项目、疑难 Bug 与深度推理' }),
  model('deepseek-v4-flash', 'WBAI-d02-0.17x', 'deepseek', { input: 1048576, output: 393216, vision: false, source: 'manual' }),
  model('minimax-m3.1-flash', 'MiniMax-M3.1-Flash', 'minimax', { input: 1048576, output: 131072, vision: true, scene: '日常问答、看图识别，速度优先' }),
  model('minimax-m3', 'MiniMax-M3', 'minimax', { input: 1048576, output: 131072, vision: true, scene: '理解截图、视频和超长文档' }),
  model('kimi-k3.1-pro', 'Kimi-K3.1-Pro', 'kimi', { source: 'screenshot' }),
  model('kimi-k3', 'Kimi-K3', 'kimi', { input: 262144, output: 65536, vision: true, source: 'manual' }),
  model('kimi-k2.8-preview', 'Kimi-K2.8-Preview', 'kimi', { source: 'screenshot' }),
  model('kimi-k2.7-code', 'Kimi-K2.7-Code', 'kimi', { input: 262144, output: 65536, vision: false, source: 'manual' }),
  model('hy4-preview', 'Hy4 preview', 'tencent', { input: 983040, output: 65536, vision: false, source: 'manual' }),
  model('hy3', 'Hy3', 'tencent', { source: 'screenshot' }),
  model('step-5-preview', 'Step-5-Preview', 'step', { input: 1048576, output: 65536, vision: true, tag: '专业工作', scene: '编程、专业知识工作与多模态看图' }),
  model('qwen3.8-flash', 'Qwen3.8-Flash', 'qwen', { input: 262144, output: 65536, vision: true, scene: '日常编程、看图与问答' }),
  model('mimo-v2.6-pro', 'Xiaomi MiMo-V2.6-Pro', 'mimo', { input: 1048576, output: 131072, vision: true, scene: '深度推理与复杂任务' }),
  model('mimo-v2.6-flash', 'Xiaomi MiMo-V2.6-Flash', 'mimo', { input: 1048576, output: 131072, vision: true, tag: '轻量省心', scene: '日常编程、看图问答' }),
  model('space-bunny', 'Space-Bunny', 'space', { source: 'screenshot' }),
  model('kimi-k2.6', 'Kimi-K2.6', 'kimi', { source: 'capabilities' }),
  model('kimi-k2.7', 'Kimi-K2.7（渠道别名）', 'kimi', { source: 'capabilities' }),
  model('kimi-k3-1', 'Kimi-K3-1（渠道别名）', 'kimi', { source: 'capabilities' }),
  model('minimax-m2.7', 'MiniMax-M2.7', 'minimax', { source: 'capabilities' }),
  model('auto', 'Auto', 'auto', { input: 200000, output: 65536, vision: true, tag: '新手推荐', scene: '由服务端自动选择模型' }),
];
export const setupModels = models.filter(m => m.source === 'reference');
export const products = [
  { id: 'workbuddy', name: 'WorkBuddy', tagline: '全场景 AI 办公', detail: '桌面工作台 · 自定义模型', subtitle: '把 API Key 填入 WorkBuddy 桌面客户端', download: 'https://www.workbuddy.cn/#download-section', icon: 'Monitor', modes: ['windows', 'macos', 'manual', 'ai'] },
  { id: 'codebuddy', name: 'CodeBuddy', tagline: '你的 AI 编程搭档', detail: 'IDE / CLI · 国内与国际版', subtitle: '配置 CodeBuddy IDE / CLI 的自定义模型', icon: 'CodeXml', modes: ['windows', 'macos', 'manual', 'ai'] },
  { id: 'traework', name: 'TraeWork', tagline: '工作、代码与设计', detail: '桌面端 · 多模型协作', subtitle: '在 TraeWork 桌面端添加 OpenAI 兼容模型', download: 'https://www.trae.cn/work', icon: 'Zap', modes: ['manual'] },
  { id: 'coze', name: '扣子', tagline: '让想法变成工作流', detail: '网页 / 桌面 · 自定义接入', subtitle: '网页版和桌面客户端均支持，操作一致', download: 'https://www.coze.cn/', icon: 'MessagesSquare', modes: ['manual'] },
  { id: 'zcode', name: 'ZCode', tagline: 'AI 编程工作台', detail: '编辑器 · OpenAI 兼容接口', subtitle: '在 ZCode 中接入 WorkBuddy 模型服务', download: 'https://zcode.z.ai/cn/docs/install', icon: 'CodeXml', modes: ['manual', 'ai'] },
];
// Login page content is intentionally hosted in this project. The selected set rotates by day
// so the page feels fresh without linking visitors away to third-party sites.
export const dailyInsights = [
  { kicker: '人工智能观察', title: '从一个模型到一套工作流：如何选择合适的默认模型', summary: '先用自动选择快速开始，再按任务类型切换推理、编程与视觉模型。' },
  { kicker: '效率技巧', title: '让人工智能更好地理解你的项目：上下文整理的三个步骤', summary: '先给目标，再给约束，最后附上可验证的完成标准。' },
  { kicker: '模型指南', title: '长文档、代码与图片任务，分别应该关注哪些能力', summary: '上下文长度、工具调用和视觉输入，是配置自定义模型时的关键指标。' },
  { kicker: '工作方法', title: '把重复操作交给一键配置，给创造性工作留出时间', summary: '备份、合并、校验和重启提醒，都可以在配置流程中一次完成。' },
  { kicker: '排错清单', title: '遇到 401、403、504 时，按顺序检查这四项配置', summary: '接口地址、密钥、模型编号和账户余额，通常能快速定位问题。' },
  { kicker: '提示工程', title: '一个清晰的任务提示词，应该包含哪些信息', summary: '背景、目标、输入、限制和输出格式，能让模型更稳定地执行。' },
  { kicker: '多端协同', title: '同一套接口配置，如何在桌面客户端之间保持一致', summary: '使用统一的模型编号与接口地址，再根据客户端界面逐项核对。' },
];
// Recent Bing wallpapers provide a deterministic fallback when a browser blocks the
// Bing metadata request. The live request still replaces this image with today's one.
export const bingFallbackImages = [
  'https://www.bing.com/th?id=OHR.SitovoWaterfall_ZH-CN8495214046_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.MaligneFest_ZH-CN8343066766_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.PortugueseLibrary_ZH-CN7096893027_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.YellowstoneWolves_ZH-CN6767268961_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.NaejangsanNP_ZH-CN6538893004_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.VietnamBridge_ZH-CN6134321119_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.BrownSloth_ZH-CN5776383136_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
  'https://www.bing.com/th?id=OHR.VeniceSunrise_ZH-CN5251815339_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp',
];
const baseFaq = [
  { q: '积分是怎么消耗的？', category: '积分与计费', a: '本站按上游返回的实际积分1:1结算，费用随输入、输出、缓存和活动变化，0积分不收费。模型倍率已包含在实际消耗中，不重复相乘。一次任务可能包含多次请求，20积分面值对应人民币1元，实际扣费可在使用记录核对。', link: 'models', linkText: '查看模型与计费说明' },
  { q: '支持哪些模型？', category: '模型与配置', a: '支持列表按厂家整理，包含智谱 GLM、DeepSeek、MiniMax、Kimi、腾讯混元、阶跃星辰、通义千问、小米 MiMo，以及 Auto 与 Space-Bunny。模型中心可查看模型 ID、上下文、图片输入和配置方式。', link: 'models', linkText: '查看完整模型列表' },
  { q: '首次运行报错「自定义模型错误」该如何解决？', category: '故障排查', a: '依次尝试：新建任务 → 切换模型 → 重启软件。如果仍报错，打开该模型的自定义配置，核对接口地址、API Key、模型 ID，以及图片输入和上下文设置。', link: 'workbuddy?mode=manual', linkText: '核对手动配置' },
  { q: '模型配置完了，为什么模型列表仍然没有列出自定义模型？', category: '模型与配置', a: '一键配置工具应输出写入的模型名称才算完成。随后重启 WorkBuddy；如果一键配置失败，可改用手动配置。CodeBuddy 国内版使用 .codebuddycn，国际版使用 .codebuddy，请先核对版本。', link: 'workbuddy?mode=manual', linkText: '打开配置教程' },
  { q: '仍提示「您账户下可用的积分额度已耗尽，升级会员继续完成任务」？', category: '故障排查', a: '请核对选中的模型。首字母大写的 Auto 是客户端内置模型；本服务通过自定义模型使用，需要选择小写的 auto，或你添加的自定义模型 ID。', link: 'workbuddy', linkText: '查看模型选择说明' },
  { q: '可以用在哪些客户端？', category: '模型与配置', a: '本站提供 WorkBuddy、CodeBuddy、TraeWork、TraeCode、扣子等兼容 OpenAI 接口的客户端。TraeWork 自定义模型仅支持桌面版；扣子添加自定义模型需要付费版。不同客户端的配置步骤见各产品页。' },
  { q: 'WorkBuddy 客户端错误码是什么含义？', category: '故障排查', a: '401：鉴权失败，请核对接口地址、API Key 与模型名称。403：积分不足，请核对余额后充值。504：调用模型超时，请稍后重试。', codes: true },
];

export const faq = [...baseFaq, ...importedFaq];
export const tutorials = {
  workbuddy: [
    ['打开模型设置', '进入「设置 → 模型 / 自定义模型」，或从对话框右下角的模型菜单进入。', 'workbuddy-manual-1-open.png'],
    ['添加自定义模型', '点击「添加模型」，提供商选择「其他 / 自定义 / Custom」。', 'workbuddy-manual-2-provider.png'],
    ['填入配置并保存', '接口地址和当前套餐密钥已在本页自动填入，确认模型 ID 后保存。遇到自定义模型错误时，核对图片输入、输入与输出长度等高级配置。', 'workbuddy-manual-3-fill.png', 'config'],
    ['选择模型，开始任务', '新建任务，在对话框右下角选择刚添加的自定义模型；例如选择小写 auto。若模型未显示，重启客户端。', 'workbuddy-select-model.png'],
  ],
  traework: [
    ['打开 TraeWork 桌面客户端', '启动客户端，进入主界面；Work / Code / Design 任一模式均可。', 'traework-1-open.png'],
    ['进入设置', '点击左下角头像，在弹出菜单中选择「设置」。', 'traework-2-settings.png'],
    ['打开模型管理', '在设置窗口左侧选择「模型」，点击右侧「+ 添加模型」。', 'traework-3-models.png'],
    ['选择「自定义模型」', '选择添加窗口顶部的「自定义模型」，不要选择下方的预设服务商。', 'traework-4-custom.png'],
    ['填写配置并添加', 'API 格式选择 OpenAI Chat Completions。「完整 URL」保持关闭，客户端会补上 /chat/completions。高级配置可留空，也可按模型能力设置。点击「添加模型」后会进行连通性测试，可能消耗少量积分；多个模型需要逐个添加。', 'traework-5-form.png', 'config'],
    ['选择模型开始使用', '回到主界面，点击输入框右下角的「Auto Mode」，在「自定义模型」分组中选择刚添加的模型。', 'traework-6-automode.png'],
    ['确认已选中自定义模型', '建议先添加常用的 1–2 个模型，之后可随时返回模型管理添加。', 'traework-7-select.png'],
  ],
  coze: [
    ['打开扣子', '登录扣子网页版或桌面客户端，进入主界面。以下图示以桌面版为例。', 'coze-1-home.png'],
    ['打开模型菜单', '点击输入框右下角「Auto ▾」，在菜单底部点击「＋ 添加自定义模型」。', 'coze-2-model-menu.png'],
    ['切换到「自定义接入」', '在弹窗顶部选择「自定义接入」。默认的「服务商接入」不能填写自定义接口地址。', 'coze-3-custom-tab.png'],
    ['填写配置并添加', '展示名称和模型 ID 可先填写 auto，协议选择 Chat API。API URL 填到 /v1，客户端会补全 /chat/completions；参考站的 auto 示例输入长度为 262144、回复长度为 131072，高级配置保持默认。其他模型按能力表填写。', 'coze-4-form.png', 'config'],
    ['选择模型开始使用', '点击「添加」，回到对话框，展开 Auto 菜单，在「自定义模型」分组中选择刚添加的 auto。添加其他模型时，重复上述步骤并更换模型 ID。', 'coze-5-select.png'],
  ],
  zcode: [
    ['打开模型设置', '点击对话框中的模型名称，在模型选择器底部点击「管理模型」，进入「设置 → 模型设置」。首次启动也可以选择「使用 API Key」。', 'zcode-model-menu.png'],
    ['添加本站供应商', '在左侧供应商列表底部点击「添加供应商」，名称填写 WorkBuddy积分充值兑换平台。选择 OpenAI 兼容协议，在 OpenAI 接口地址中填写本页地址。', null, 'config'],
    ['确认密钥，添加模型', '本页已自动显示当前套餐密钥。点击「添加模型」，填写账户已开通的准确模型 ID，保存后打开供应商启用开关。高级输出长度默认留空，按模型实际能力设置。', null, 'config'],
    ['验证并开始使用', '在对话框模型选择器中选中本站供应商的模型，发送简短问题验证。401 检查密钥；无可用模型时检查渠道；修改 ZCode 的 HTTP 代理后请重启。自定义配置保存在 ~/.zcode/v2/config.json，不使用 WorkBuddy 的 models.json。', null],
  ],
};
export function modelConfig(apiKey, baseUrl = SITE.baseUrl) {
  return { models: setupModels.map(model => {
    const profile = modelProfile(model.id);
    return { id: model.id, name: modelLabel(model.id), vendor: 'Custom', url: baseUrl.replace(/\/$/, '') + '/chat/completions', apiKey: apiKey || '', supportsToolCall: profile.supportsToolCall ?? true, supportsImages: profile.supportsImages ?? model.vision, supportsReasoning: profile.supportsReasoning ?? false, ...(profile.onlyReasoning === undefined ? {} : { onlyReasoning: profile.onlyReasoning }), ...(profile.reasoning ? { reasoning: profile.reasoning } : {}), useCustomProtocol: false, maxInputTokens: profile.maxInputTokens ?? model.input, maxOutputTokens: profile.maxOutputTokens ?? model.output };
  }) };
}
export function aiPrompt(product, region, apiKey, baseUrl = SITE.baseUrl) {
  if (product === 'zcode') return '请帮我配置 ZCode 自定义模型。先核对官方说明 https://zcode.z.ai/cn/docs/configuration ，使用设置 → 模型设置 → 添加供应商。供应商名称：WorkBuddy积分充值兑换平台；OpenAI 接口地址：'+baseUrl+'；API Key：'+(apiKey||'')+'。请求该地址的 /models，只使用返回的可用模型 ID。添加模型、保存并启用供应商，发送简短问题验证。若采用文件方式，先读取并备份 ~/.zcode/v2/config.json，遵循当前版本实际结构合并 providers，不创建 .workbuddy/models.json，不猜测未知参数。';
  const directory = product === 'codebuddy' ? (region === 'cn' ? '.codebuddycn' : '.codebuddy') : '.workbuddy';
  return `请为我配置 ${product === 'codebuddy' ? 'CodeBuddy' : 'WorkBuddy'} 的自定义模型。\n\n1. 判断操作系统。macOS/Linux 配置文件为 ~/${directory}/models.json；Windows 为 %USERPROFILE%\\${directory}\\models.json。\n2. 使用接口地址 ${baseUrl}，API Key：${apiKey || ''}。\n3. 请求 ${baseUrl}/models，以 Authorization: Bearer 当前套餐密钥鉴权；仅使用服务端返回的可用模型 ID，去空并去重。\n4. 按下面的 JSON 结构生成配置，url 必须指向 /v1/chat/completions。模型能力以服务端最新信息为准；未知能力不要臆测。\n5. 修改前备份现有配置为带时间戳的 .backup 文件。保留其他模型与设置，按 id 合并；原文件不是有效 JSON 时停止，不覆盖。\n6. macOS/Linux 配置目录权限设为 700，文件权限设为 600。\n7. 完成后告知配置路径、模型名称和备份位置，并提示我重启客户端后选择自定义模型。\n\n配置结构：\n${JSON.stringify(modelConfig(apiKey, baseUrl), null, 2)}`;
}
