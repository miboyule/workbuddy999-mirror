#!/bin/bash

set -euo pipefail

API_BASE_URL="https://api.buddy.miaotui.cc/v1"
SETUP_ENDPOINT="${API_BASE_URL%/}/models"
CAPABILITIES_URL="https://buddy.modelzoo.tech/setup/model-capabilities.txt"
# 内置默认模型列表（与 /v1/models 同构）+ 内置模型能力：在线拉取失败或返回
# 空列表时的兜底，让配置不依赖网络也能完成。清单与 web/src/data/models.ts
# 保持同步；能力（图片输入 + token 限制）与 model-capabilities.txt 一致
# （格式 模型id|图片输入|最大输入|最大输出，查找键统一小写）。
FALLBACK_MODELS_JSON='{"object":"list","data":[{"id":"auto"},{"id":"glm-5.3"},{"id":"glm-5.3-flash"},{"id":"deepseek-v4.1-flash"},{"id":"deepseek-v4-pro"},{"id":"minimax-m3"},{"id":"minimax-m3.1-flash"},{"id":"qwen3.8-flash"},{"id":"mimo-v2.6-pro"},{"id":"mimo-v2.6-flash"},{"id":"glm-5.2"},{"id":"step-5-preview"}]}'
# 仅手动配置的模型（逗号分隔）：一键配置【不写入】，用户可在客户端手动添加使用
# （服务端白名单仍放行，手动配置教程/手动 Tab 仍可见）。从 /v1/models 在线清单
# 与内置兜底清单里统一排除。
SETUP_EXCLUDED_MODELS='glm-5-turbo,kimi-k3,deepseek-v4-flash,kimi-k2.7-code,hy4-preview'
FALLBACK_CAPABILITIES='# WorkBuddy 内置模型能力（离线兜底，与 web/src/data/models.ts 同步；
# glm-5-turbo / kimi-k3 / deepseek-v4-flash / kimi-k2.7-code / hy4-preview
# 为手动专属模型，不入一键配置，故不在此表（glm-5.2 于 2026-10-12 恢复一键写入，
# 前端卡片仍不展示）
auto|false|200000|65536
glm-5.3|false|1048576|131072
glm-5.3-flash|true|1048576|131072
deepseek-v4.1-flash|false|1048576|393216
deepseek-v4-pro|false|1048576|393216
minimax-m3|true|1048576|131072
minimax-m3.1-flash|true|1048576|131072
qwen3.8-flash|true|262144|65536
mimo-v2.6-pro|true|1048576|131072
mimo-v2.6-flash|true|1048576|131072
glm-5.2|false|262144|131072
step-5-preview|true|1048576|65536'
CONFIG_DIR="${HOME}/.workbuddy"
CONFIG_FILE="${CONFIG_DIR}/models.json"
BACKUP_FILE=""
TEMP_DIR=""
TEMP_CONFIG=""

print_error() {
  printf '\n配置失败：%s\n' "$1" >&2
}

cleanup() {
  if [ -n "${TEMP_CONFIG}" ] && [ -f "${TEMP_CONFIG}" ]; then
    rm -f "${TEMP_CONFIG}"
  fi
  if [ -n "${TEMP_DIR}" ] && [ -d "${TEMP_DIR}" ]; then
    rm -rf "${TEMP_DIR}"
  fi
}

trap cleanup EXIT INT TERM

if [ "$(uname -s)" != "Darwin" ]; then
  print_error "这个脚本仅支持 macOS。"
  exit 1
fi

if [ ! -x /usr/bin/osascript ]; then
  print_error "系统缺少 /usr/bin/osascript，无法安全修改 JSON 配置。"
  exit 1
fi

if [ ! -x /usr/bin/curl ]; then
  print_error "系统缺少 /usr/bin/curl，无法读取模型配置。"
  exit 1
fi

if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
  print_error "没有可用的终端，请在 Mac 的“终端”应用中运行此脚本。"
  exit 1
fi

printf '\nWorkBuddy 模型一键配置\n'
printf '配置：%s\n\n' "${CONFIG_FILE}"
printf '请输入 API Key：' > /dev/tty
IFS= read -r API_KEY < /dev/tty || true

# 去首尾空白（read 已去掉换行，这里兜住粘贴带入的首尾空格与 \r）
API_KEY="${API_KEY#"${API_KEY%%[![:space:]]*}"}"
API_KEY="${API_KEY%"${API_KEY##*[![:space:]]}"}"
if [ -z "${API_KEY}" ]; then
  print_error "API Key 不能为空。"
  exit 1
fi

case "${API_KEY}" in
  sk-*) ;;
  *)
    print_error "API Key 应以 sk- 开头，请到网页控制台复制完整的 API Key 后重新运行。"
    exit 1
    ;;
esac

if [ -L "${CONFIG_DIR}" ]; then
  print_error "${CONFIG_DIR} 是符号链接，为避免误写入已停止操作。"
  exit 1
fi

if [ -L "${CONFIG_FILE}" ]; then
  print_error "${CONFIG_FILE} 是符号链接，为避免误写入已停止操作。"
  exit 1
fi

umask 077
mkdir -p "${CONFIG_DIR}"
chmod 700 "${CONFIG_DIR}"

if [ -f "${CONFIG_FILE}" ]; then
  BACKUP_FILE="${CONFIG_FILE}.backup-$(date '+%Y%m%d-%H%M%S')-$$"
  cp -p "${CONFIG_FILE}" "${BACKUP_FILE}"
  chmod 600 "${BACKUP_FILE}"
fi

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/workbuddy-install.XXXXXX")
chmod 700 "${TEMP_DIR}"
KEY_FILE="${TEMP_DIR}/api-key"
JXA_FILE="${TEMP_DIR}/update-models.js"
SETUP_FILE="${TEMP_DIR}/setup.json"
FALLBACK_FILE="${TEMP_DIR}/fallback-models.json"
CAPABILITIES_FILE="${TEMP_DIR}/model-capabilities.txt"
CURL_CONFIG="${TEMP_DIR}/curl.conf"
TEMP_CONFIG="${CONFIG_DIR}/.models.json.tmp.$$"

printf '%s' "${API_KEY}" > "${KEY_FILE}"
chmod 600 "${KEY_FILE}"
printf '%s' "${FALLBACK_MODELS_JSON}" > "${FALLBACK_FILE}"
chmod 600 "${FALLBACK_FILE}"
printf 'header = "Authorization: Bearer %s"\n' "${API_KEY}" > "${CURL_CONFIG}"
chmod 600 "${CURL_CONFIG}"

printf '\n正在读取可用模型列表...\n'
# 不区分失败类型：连接失败与 HTTP 非 200（401/403 等可能是 API Key 问题）一律降级到
# 内置默认清单（写入 SETUP_FILE，走与在线结果完全相同的后续解析）；HTTP 200 但空/无效
# 列表的情况由下方 JXA 再兜一层。保证配置总能离线完成，而不是失败退出。
MODELS_FETCH_FAILED=0
if ! HTTP_STATUS=$(/usr/bin/curl --silent --show-error --location \
  --connect-timeout 10 --max-time 30 \
  --output "${SETUP_FILE}" --write-out '%{http_code}' \
  --config "${CURL_CONFIG}" "${SETUP_ENDPOINT}"); then
  MODELS_FETCH_FAILED=1
elif [ "${HTTP_STATUS}" != "200" ]; then
  MODELS_FETCH_FAILED=1
fi
API_KEY=""
if [ "${MODELS_FETCH_FAILED}" = "1" ]; then
  case "${HTTP_STATUS:-}" in
    ""|000) MODELS_FAIL_REASON="无法连接配置服务" ;;
    *) MODELS_FAIL_REASON="配置服务返回 HTTP ${HTTP_STATUS}" ;;
  esac
  printf '警告：无法在线获取模型列表（%s），已改用内置默认模型列表。\n' "${MODELS_FAIL_REASON}" >&2
  printf '%s' "${FALLBACK_MODELS_JSON}" > "${SETUP_FILE}"
fi
chmod 600 "${SETUP_FILE}"

if [ "${MODELS_FETCH_FAILED}" = "1" ]; then
  # 兜底模式：连接层已不可用，在线能力配置同样拉不到，直接用内置模型能力。
  printf '%s\n' "${FALLBACK_CAPABILITIES}" > "${CAPABILITIES_FILE}"
else
  printf '正在读取模型能力配置...\n'
  : > "${CAPABILITIES_FILE}"
  if CAPABILITIES_HTTP_STATUS=$(/usr/bin/curl --silent --show-error --location \
    --connect-timeout 10 --max-time 30 \
    --header 'Cache-Control: no-cache' \
    --output "${CAPABILITIES_FILE}" --write-out '%{http_code}' \
    "${CAPABILITIES_URL}"); then
    if [ "${CAPABILITIES_HTTP_STATUS}" != "200" ]; then
      : > "${CAPABILITIES_FILE}"
      printf '警告：模型能力配置返回 HTTP %s，所有模型将默认关闭图片输入并使用默认输入/输出限制。\n' "${CAPABILITIES_HTTP_STATUS}" >&2
    fi
  else
    : > "${CAPABILITIES_FILE}"
    printf '警告：无法读取模型能力配置，所有模型将默认关闭图片输入并使用默认输入/输出限制。\n' >&2
  fi
fi
chmod 600 "${CAPABILITIES_FILE}"

cat > "${JXA_FILE}" <<'JXA'
ObjC.import('Foundation');

function fileExists(path) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(path);
}

function readUTF8(path) {
  const value = $.NSString.stringWithContentsOfFileEncodingError(
    path,
    $.NSUTF8StringEncoding,
    null
  );
  if (value === null) {
    throw new Error('无法读取文件：' + path);
  }
  return ObjC.unwrap(value);
}

function writeUTF8(path, content) {
  const ok = $(content).writeToFileAtomicallyEncodingError(
    path,
    true,
    $.NSUTF8StringEncoding,
    null
  );
  if (!ok) {
    throw new Error('无法写入临时配置文件：' + path);
  }
}

function readModelCapabilities(path) {
  const capabilities = {};
  if (!fileExists(path)) {
    return capabilities;
  }

  readUTF8(path).split(/\r?\n/).forEach(function (rawLine) {
    const line = String(rawLine || '').replace(/^\uFEFF/, '').trim();
    if (!line || line.charAt(0) === '#') {
      return;
    }

    const separatorIndex = line.indexOf('|');
    if (separatorIndex <= 0) {
      return;
    }

    // 格式：model-id|images|maxInputTokens|maxOutputTokens
    const parts = line.split('|');
    if (parts.length !== 4) {
      return;
    }

    const modelID = parts[0].trim();
    if (!modelID) {
      return;
    }
    const rawImages = parts[1].trim().toLowerCase();
    const supportsImages =
      rawImages === 'true' || rawImages === '1' || rawImages === 'yes' || rawImages === 'on';
    const maxInputTokens = parseInt(parts[2].trim(), 10);
    const maxOutputTokens = parseInt(parts[3].trim(), 10);
    if (!isFinite(maxInputTokens) || maxInputTokens <= 0 ||
      !isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
      return;
    }
    capabilities[modelID.toLowerCase()] = {
      supportsImages: supportsImages,
      maxInputTokens: maxInputTokens,
      maxOutputTokens: maxOutputTokens
    };
  });

  return capabilities;
}

function run(argv) {
  const configPath = argv[0];
  const outputPath = argv[1];
  const keyPath = argv[2];
  const setupPath = argv[3];
  const capabilitiesPath = argv[4];
  const apiBaseURL = String(argv[5] || '').trim();
  const fallbackPath = argv[6];
  // 仅手动配置的模型（逗号分隔）：不写入 models.json，用户可手动添加。
  const excludedModelIDs = {};
  String(argv[7] || '').split(',').forEach(function (raw) {
    const excluded = raw.trim().toLowerCase();
    if (excluded) {
      excludedModelIDs[excluded] = true;
    }
  });
  const apiKey = readUTF8(keyPath).replace(/[\r\n]+$/, '');

  if (!apiKey) {
    throw new Error('API Key 不能为空');
  }
  if (!apiBaseURL) {
    throw new Error('缺少 API 服务地址(API_BASE_URL)');
  }

  // /v1/models 返回 OpenAI 格式: { object: 'list', data: [ { id: '...', ... }, ... ] }
  const modelIDs = [];
  const seenModelIDs = {};
  // 模型白名单由 new-api token 的 model_limits 控制：/v1/models 已只返回白名单模型，
  // 这里做去空 + 去重（大小写不敏感）+ 排除手动专属模型（SETUP_EXCLUDED_MODELS）。
  function collectModelIDs(entries) {
    entries.forEach(function (entry) {
      const modelID = String((entry && entry.id) || '').trim();
      const key = modelID.toLowerCase();
      if (!modelID || seenModelIDs[key]) {
        return;
      }
      if (excludedModelIDs[key]) {
        return;
      }
      modelIDs.push(modelID);
      seenModelIDs[key] = true;
    });
  }

  let onlineData = null;
  try {
    const response = JSON.parse(readUTF8(setupPath));
    onlineData = response && Array.isArray(response.data) ? response.data : null;
  } catch (error) {
    onlineData = null;
  }
  if (onlineData) {
    collectModelIDs(onlineData);
  }

  // HTTP 200 但空/无效列表（token 白名单与渠道可用模型无交集、代理返回 HTML 等）
  // 与传输层失败一样只能拿到 0 个模型，这里降级到内置默认清单（sh 侧已把传输
  // 失败的响应替换成内置 JSON，这一层兜「请求成功但数据为空」）。
  let usedFallback = false;
  if (modelIDs.length === 0) {
    usedFallback = true;
    const fallback = JSON.parse(readUTF8(fallbackPath));
    if (!fallback || !Array.isArray(fallback.data)) {
      throw new Error('内置默认模型列表不可用');
    }
    collectModelIDs(fallback.data);
    if (modelIDs.length === 0) {
      throw new Error('内置默认模型列表为空');
    }
  }

  const supportsToolCall = true;
  const supportsReasoning = false;
  const useCustomProtocol = false;
  // 能力表（model-id|images|maxInputTokens|maxOutputTokens）中未列出的模型
  // （如新上架模型）回落到默认值：关闭图片输入 + 默认输入/输出限制。
  const defaultMaxInputTokens = 200000;
  const defaultMaxOutputTokens = 65536;
  const modelCapabilities = readModelCapabilities(capabilitiesPath);

  let root = [];
  let models = root;
  let rootType = 'array';

  if (fileExists(configPath)) {
    const source = readUTF8(configPath).trim();
    if (source) {
      try {
        root = JSON.parse(source);
      } catch (error) {
        throw new Error('现有 models.json 不是有效 JSON，已保留原文件和备份');
      }
    }

    if (Array.isArray(root)) {
      models = root;
    } else if (root && typeof root === 'object' && Array.isArray(root.models)) {
      rootType = 'object';
      models = root.models;
    } else {
      throw new Error('现有 models.json 必须是模型数组，或包含 models 数组的对象');
    }
  }

  const fixedModels = modelIDs.map(function (modelID) {
    const capabilityKey = modelID.toLowerCase();
    const modelCapability = Object.prototype.hasOwnProperty.call(modelCapabilities, capabilityKey)
      ? modelCapabilities[capabilityKey]
      : null;
    return {
      id: modelID,
      name: modelID,
      vendor: 'Custom',
      url: apiBaseURL,
      apiKey: apiKey,
      supportsToolCall: supportsToolCall,
      supportsImages: modelCapability ? modelCapability.supportsImages : false,
      supportsReasoning: supportsReasoning,
      useCustomProtocol: useCustomProtocol,
      maxInputTokens: modelCapability ? modelCapability.maxInputTokens : defaultMaxInputTokens,
      maxOutputTokens: modelCapability ? modelCapability.maxOutputTokens : defaultMaxOutputTokens
    };
  });
  const fixedModelByID = {};
  fixedModels.forEach(function (model) {
    fixedModelByID[model.id] = model;
  });

  const updatedModels = [];
  const installedIDs = {};
  models.forEach(function (item) {
    if (item && fixedModelByID[item.id]) {
      if (!installedIDs[item.id]) {
        updatedModels.push(fixedModelByID[item.id]);
        installedIDs[item.id] = true;
      }
      return;
    }
    updatedModels.push(item);
  });

  fixedModels.forEach(function (model) {
    if (!installedIDs[model.id]) {
      updatedModels.push(model);
      installedIDs[model.id] = true;
    }
  });

  if (rootType === 'object') {
    root.models = updatedModels;
  } else {
    root = updatedModels;
  }

  writeUTF8(outputPath, JSON.stringify(root, null, 2) + '\n');
  return (usedFallback ? 'FALLBACK|' : '') + modelIDs.join('、');
}
JXA

if ! INSTALLED_MODELS=$(/usr/bin/osascript -l JavaScript "${JXA_FILE}" "${CONFIG_FILE}" "${TEMP_CONFIG}" "${KEY_FILE}" "${SETUP_FILE}" "${CAPABILITIES_FILE}" "${API_BASE_URL}" "${FALLBACK_FILE}" "${SETUP_EXCLUDED_MODELS}"); then
  print_error "无法更新 ${CONFIG_FILE}。原配置没有被覆盖。"
  if [ -n "${BACKUP_FILE}" ]; then
    printf '备份文件：%s\n' "${BACKUP_FILE}" >&2
  fi
  exit 1
fi

case "${INSTALLED_MODELS}" in
  FALLBACK\|*)
    INSTALLED_MODELS=${INSTALLED_MODELS#FALLBACK|}
    printf '\n注：在线模型列表为空或不可用，本次使用内置默认模型列表，清单可能不是最新。\n'
    ;;
esac

chmod 600 "${TEMP_CONFIG}"
mv -f "${TEMP_CONFIG}" "${CONFIG_FILE}"
TEMP_CONFIG=""
chmod 600 "${CONFIG_FILE}"

printf '\n配置成功。\n'
printf '模型：%s\n' "${INSTALLED_MODELS}"
printf '文件：%s\n' "${CONFIG_FILE}"
if [ -n "${BACKUP_FILE}" ]; then
  printf '备份：%s\n' "${BACKUP_FILE}"
fi
printf '\n如果对话框右下角没有显示自定义模型，请重新打开WorkBuddy。\n'
