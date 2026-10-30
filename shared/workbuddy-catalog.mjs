// Ratios and limits checked against the upstream CN model catalog (2026-10-27).
// Older channel-only models retain previously verified values; unknowns stay unknown.
const profiles = {
  'deepseek-v4-pro': [0.51, 1000000, 128000, true, true],
  'deepseek-v4-flash': [0.17, 1000000, 50000, true, true],
  'deepseek-v4.1-flash': [0.11, 1000000, 128000, true, true],
  'glm-5.3': [0.69, 1000000, 64000, true, true],
  'glm-5.3-flash': [0.08, 1000000, 131072, true, true],
  'glm-5.2': [0.79, 1000000, 64000, false, true],
  'glm-5.1': [0.79, 200000, 48000, null, true],
  'glm-5v-turbo': [0.71, 200000, 64000, true, true],
  'hy3': [0, 192000, 64000, true, true],
  'hy3-x': [0.05, 192000, 64000, true, true],
  'hy4-preview': [0.29, 960000, 64000, true, true],
  'kimi-k2.5': [null, null, null, null, null],
  'kimi-k2.6': [null, 256000, 32000, true, true],
  'kimi-k2.7': [0.57, 256000, 32000, true, true],
  'kimi-k2.8-preview': [0.77, 1000000, 64000, true, true],
  'kimi-k3-1': [1.62, 1000000, 32000, true, true],
  'kimi-k3.1-pro': [0.97, 1000000, 32000, true, true],
  'minimax-m2.5': [null, 200000, 48000, true, true],
  'minimax-m2.7': [null, 200000, 48000, true, true],
  'minimax-m3': [0.25, 512000, 64000, true, true],
  'minimax-m3.1-flash': [0.08, 1000000, 128000, true, true],
  'mimo-v2.6-pro': [0.13, 1000000, 128000, true, true],
  'space-bunny': [0.08, 1000000, 128000, true, true],
  'step-5-preview': [0.33, 1000000, 64000, true, true],
};
const codes = {
  auto: 'a01',
  'deepseek-v4.1-flash': 'd01', 'deepseek-v4-flash': 'd02', 'deepseek-v4-pro': 'd03',
  'glm-5.2': 'g01', 'glm-5.3': 'g02', 'glm-5.3-flash': 'g03', 'glm-5.1': 'g04', 'glm-5v-turbo': 'g05',
  hy3: 'h01', 'hy3-x': 'h02', 'hy4-preview': 'h03',
  'kimi-k2.5': 'k01', 'kimi-k2.6': 'k02', 'kimi-k2.7': 'k03', 'kimi-k2.8-preview': 'k04', 'kimi-k3-1': 'k05', 'kimi-k3.1-pro': 'k06',
  'minimax-m2.5': 'm01', 'minimax-m2.7': 'm02', 'minimax-m3': 'm03', 'minimax-m3.1-flash': 'm04', 'mimo-v2.6-pro': 'm05',
  'space-bunny': 's01', 'step-5-preview': 's02',
};
const reasoningProfiles = {
  'hy4-preview': [['high'], 'high', true],
  hy3: [['low', 'high'], 'high', true], 'hy3-x': [['low', 'high'], 'high', true],
  'deepseek-v4.1-flash': [['low', 'high', 'max'], 'high', true],
  'step-5-preview': [['low', 'medium', 'high'], 'high', true],
  'glm-5.3': [['low', 'high', 'max'], 'high', true],
  'glm-5.3-flash': [['low', 'high', 'max'], 'high', true],
  'glm-5.2': [['high', 'xhigh'], 'high', true],
  'glm-5.1': [['medium'], null, true], 'glm-5v-turbo': [['medium'], null, true],
  'space-bunny': [['low', 'medium', 'high', 'xhigh', 'max'], 'max', true],
  'minimax-m3.1-flash': [['low', 'medium', 'high', 'xhigh', 'max'], 'max', true],
  'minimax-m3': [['medium'], null, true],
  'kimi-k3.1-pro': [['low', 'high', 'max'], 'high', true],
  'kimi-k3-1': [['low', 'high', 'xhigh'], 'high', true],
  'kimi-k2.8-preview': [['low', 'high', 'max'], 'high', true],
  'deepseek-v4-pro': [['high', 'xhigh'], 'high', false],
  'mimo-v2.6-pro': [[], null, true],
};
const canonicalId = id => String(id).replace(/^cn:/, '');
const modelCodes = ids => {
  const allocated = new Set(Object.values(codes));
  const result = new Map();
  for (const id of [...new Set(ids.map(canonicalId))].sort()) {
    if (codes[id]) { result.set(id, codes[id]); continue; }
    const initial = /^[a-z]/i.test(id) ? id[0].toLowerCase() : 'x';
    let index = [...id].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 99, 0) + 1;
    let code;
    for (let attempt = 0; attempt < 99; attempt++) {
      code = `${initial}${String(index).padStart(2, '0')}`;
      if (!allocated.has(code)) break;
      index = index % 99 + 1;
    }
    if (allocated.has(code)) throw new Error(`模型编号已满：${initial}`);
    allocated.add(code);
    result.set(id, code);
  }
  return result;
};
export const modelProfile = id => {
  const name = canonicalId(id);
  const [ratio, input, output, images, reasoning] = profiles[name] || [];
  const effort = reasoningProfiles[name];
  return {
    ratio: ratio ?? null, maxInputTokens: input ?? null, maxOutputTokens: output ?? null,
    supportsToolCall: input == null ? null : true, supportsImages: images ?? null, supportsReasoning: reasoning ?? null,
    ...(effort ? { onlyReasoning: effort[2], reasoning: { supportedEfforts: [...effort[0]], ...(effort[1] ? { defaultEffort: effort[1] } : {}), ...(effort[2] ? { canDisableThinking: false } : {}) } } : {}),
  };
};
export const modelLabel = (id, code = modelCodes([id]).get(canonicalId(id))) => {
  const { ratio } = modelProfile(id);
  return `WBAI-${code}-${ratio === null ? (canonicalId(id) === 'auto' ? '动态' : '待核实') : ratio.toFixed(2) + 'x'}`;
};
export const sortedModelIds = ids => {
  const canonical = new Map();
  for (const value of ids) {
    const id = String(value), name = id.replace(/^cn:/, '');
    if (!canonical.has(name) || !id.startsWith('cn:')) canonical.set(name, id);
  }
  return [...canonical.values()].sort((a, b) => {
    const left = modelProfile(a).ratio, right = modelProfile(b).ratio;
    return (left ?? Infinity) - (right ?? Infinity) || a.localeCompare(b);
  });
};
export const catalogEntries = ids => {
  const sorted = sortedModelIds(ids);
  const assigned = modelCodes(sorted);
  return sorted.map(id => ({ id, name: modelLabel(id, assigned.get(canonicalId(id))), ...modelProfile(id) }));
};
