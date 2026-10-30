import { MODEL_API_BASE_URL } from '../shared/endpoints.mjs';

export function setupLauncher(product, platform, region, apiKey) {
  if (!['workbuddy', 'codebuddy'].includes(product) || !['windows', 'macos'].includes(platform) || !['cn', 'global'].includes(region) || !apiKey) {
    throw new Error('缺少有效的配置工具参数或当前套餐密钥');
  }
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(apiKey)));
  const apiUrl = MODEL_API_BASE_URL;
  const siteUrl = 'https://www.workbuddy999.top';
  if (platform === 'windows') {
    return `@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\nset "WORKBUDDY_API_URL=${apiUrl}"\r\nset "WORKBUDDY_API_KEY_B64=${encoded}"\r\nset "WB_SETUP_PS1=%TEMP%\\${product}-setup-%RANDOM%.ps1"\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '${siteUrl}/setup/${product}-setup.ps1' -OutFile $env:WB_SETUP_PS1"\r\nif errorlevel 1 goto fail\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%WB_SETUP_PS1%"${product === 'codebuddy' ? ` -CodeBuddy -Region ${region}` : ''}\r\nset "WB_SETUP_EXIT=%ERRORLEVEL%"\r\ndel /q "%WB_SETUP_PS1%" 2>nul\r\npause\r\nexit /b %WB_SETUP_EXIT%\r\n:fail\r\necho Failed to download setup script.\r\npause\r\nexit /b 1\r\n`;
  }
  return `#!/usr/bin/env bash\nset -euo pipefail\numask 077\nexport WORKBUDDY_API_URL='${apiUrl}'\nexport WORKBUDDY_API_KEY="$(python3 -c 'import base64; print(base64.b64decode("${encoded}").decode())')"\ntmp="${'${TMPDIR:-/tmp}'}/${product}-setup-$$.sh"\ntrap 'rm -f "$tmp"; unset WORKBUDDY_API_KEY' EXIT\ncurl -fsSL '${siteUrl}/setup/${product}-setup.sh' -o "$tmp"\nbash "$tmp"${product === 'codebuddy' ? ` ${region}` : ''}\n`;
}
