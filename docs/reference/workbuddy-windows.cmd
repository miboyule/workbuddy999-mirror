@echo off
setlocal EnableExtensions
chcp 65001 >nul
title WorkBuddy 模型一键配置工具

set "WORKBUDDY_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%WORKBUDDY_POWERSHELL%" (
  set "WORKBUDDY_POWERSHELL=powershell.exe"
  where powershell.exe >nul 2>&1
  if errorlevel 1 (
    echo.
    echo 系统未找到 Windows PowerShell，无法运行配置工具。
    echo.
    echo 按任意键退出……
    pause >nul
    exit /b 1
  )
)

"%WORKBUDDY_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "if (-not $PSVersionTable -or $PSVersionTable.PSVersion.Major -lt 3) { exit 3 }"
set "WORKBUDDY_PS_CHECK=%ERRORLEVEL%"
if "%WORKBUDDY_PS_CHECK%"=="3" (
  echo.
  echo Windows PowerShell 版本过低，需要 3.0 或更高版本。
  echo Windows 7 用户建议安装 Windows Management Framework 5.1。
  echo.
  echo 按任意键退出……
  pause >nul
  exit /b 1
)
if not "%WORKBUDDY_PS_CHECK%"=="0" (
  echo.
  echo 无法启动 Windows PowerShell，请检查系统组件是否完整。
  echo.
  echo 按任意键退出……
  pause >nul
  exit /b 1
)

set "WORKBUDDY_PS1=%TEMP%\workbuddy-install-%RANDOM%-%RANDOM%.ps1"
set "WORKBUDDY_SOURCE=%~f0"

"%WORKBUDDY_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$source=$env:WORKBUDDY_SOURCE; $target=$env:WORKBUDDY_PS1; $lines=Get-Content -LiteralPath $source -Encoding UTF8; $marker=[Array]::IndexOf($lines, '# WORKBUDDY_POWERSHELL_START'); if($marker -lt 0){exit 2}; $lines[($marker+1)..($lines.Count-1)] | Set-Content -LiteralPath $target -Encoding UTF8"
if errorlevel 1 (
  del /f /q "%WORKBUDDY_PS1%" >nul 2>&1
  echo.
  echo 无法读取配置脚本，请重新下载后再试。
  echo.
  echo 按任意键退出……
  pause >nul
  exit /b 1
)

"%WORKBUDDY_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%WORKBUDDY_PS1%"
set "WORKBUDDY_EXIT_CODE=%ERRORLEVEL%"
del /f /q "%WORKBUDDY_PS1%" >nul 2>&1

echo.
echo 按任意键退出……
pause >nul
exit /b %WORKBUDDY_EXIT_CODE%

# WORKBUDDY_POWERSHELL_START
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$setupApiBaseUrl = 'https://api.buddy.miaotui.cc/v1'
$setupEndpoint = $setupApiBaseUrl + '/models'
$capabilitiesUrl = 'https://buddy.modelzoo.tech/setup/model-capabilities.txt'
# 内置默认模型列表：在线拉取 /models 失败时（连接层问题或 401/403 等任何错误）的兜底，
# 让配置不依赖网络也能写入。清单与 web/src/data/models.ts 保持同步；
# 能力（图片输入 + token 限制）与 model-capabilities.txt 一致
# （格式 模型id|图片输入|最大输入|最大输出，查找键统一小写）。
# 仅手动配置的模型：一键配置【不写入】，用户可在客户端手动添加使用（服务端白名单
# 仍放行，手动配置教程/手动 Tab 仍可见）。从 /v1/models 在线清单与内置清单里统一排除。
$excludedModelIDs = @(
    'glm-5-turbo',
    'kimi-k3',
    'deepseek-v4-flash',
    'kimi-k2.7-code',
    'hy4-preview'
)
$excludedModelIDSet = @($excludedModelIDs | ForEach-Object { $_.Trim().ToLowerInvariant() })
$fallbackModelIDs = @(
    'auto',
    'glm-5.3',
    'glm-5.3-flash',
    'deepseek-v4.1-flash',
    'deepseek-v4-pro',
    'minimax-m3',
    'minimax-m3.1-flash',
    'qwen3.8-flash',
    'mimo-v2.6-pro',
    'mimo-v2.6-flash',
    'glm-5.2',
    'step-5-preview'
)
$fallbackCapabilities = @{
    'auto'              = @{ images = $false; maxInputTokens = 200000;  maxOutputTokens = 65536 }
    'glm-5.3'           = @{ images = $false; maxInputTokens = 1048576; maxOutputTokens = 131072 }
    'glm-5.3-flash'     = @{ images = $true;  maxInputTokens = 1048576; maxOutputTokens = 131072 }
    'deepseek-v4.1-flash'   = @{ images = $false; maxInputTokens = 1048576; maxOutputTokens = 393216 }
    'deepseek-v4-pro'   = @{ images = $false; maxInputTokens = 1048576; maxOutputTokens = 393216 }
    'minimax-m3'        = @{ images = $true;  maxInputTokens = 1048576; maxOutputTokens = 131072 }
    'minimax-m3.1-flash'   = @{ images = $true;  maxInputTokens = 1048576; maxOutputTokens = 131072 }
    'qwen3.8-flash'     = @{ images = $true;  maxInputTokens = 262144;  maxOutputTokens = 65536 }
    'mimo-v2.6-pro'     = @{ images = $true;  maxInputTokens = 1048576; maxOutputTokens = 131072 }
    'mimo-v2.6-flash'   = @{ images = $true;  maxInputTokens = 1048576; maxOutputTokens = 131072 }
    'glm-5.2'            = @{ images = $false; maxInputTokens = 262144;  maxOutputTokens = 131072 }
    'step-5-preview'     = @{ images = $true;  maxInputTokens = 1048576; maxOutputTokens = 65536 }
}
$userProfile = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
if ([string]::IsNullOrWhiteSpace($userProfile)) { $userProfile = $env:USERPROFILE }
if ([string]::IsNullOrWhiteSpace($userProfile)) {
    Write-Host '配置失败：无法确定当前用户目录。' -ForegroundColor Red
    exit 1
}
$configDirectory = Join-Path $userProfile '.workbuddy'
$configFile = Join-Path $configDirectory 'models.json'
$backupFile = $null
$temporaryFile = Join-Path $configDirectory ('.models.json.tmp.' + [Guid]::NewGuid().ToString('N'))
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

function Write-Title {
    Write-Host ''
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host '      WorkBuddy 模型一键配置工具' -ForegroundColor Cyan
    Write-Host '========================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host ('配置服务：{0}' -f $setupEndpoint) -ForegroundColor DarkGray
    Write-Host ('模型能力：{0}' -f $capabilitiesUrl) -ForegroundColor DarkGray
    Write-Host ('配置文件：{0}' -f $configFile) -ForegroundColor DarkGray
    Write-Host ''
}

function New-FixedModel {
    param(
        [Parameter(Mandatory = $true)][string]$ModelID,
        [Parameter(Mandatory = $true)][string]$ApiKey,
        [Parameter(Mandatory = $true)][bool]$SupportsImages,
        [Parameter(Mandatory = $true)][int]$MaxInputTokens,
        [Parameter(Mandatory = $true)][int]$MaxOutputTokens
    )

    return [PSCustomObject][ordered]@{
        id = $ModelID
        name = $ModelID
        vendor = 'Custom'
        url = $apiBaseUrl
        apiKey = $ApiKey
        supportsToolCall = $supportsToolCall
        supportsImages = $SupportsImages
        supportsReasoning = $supportsReasoning
        useCustomProtocol = $useCustomProtocol
        maxInputTokens = $MaxInputTokens
        maxOutputTokens = $MaxOutputTokens
    }
}

function Enable-Tls12 {
    # 目标：确保客户端至少能协商 TLS 1.2（ai.modelzoo.tech 实测只接受 1.2+，
    # 明确拒绝 TLS 1.0/1.1）。直接覆盖默认协议，而不是与旧的 Ssl3/Tls 默认值
    # 合并——避免老协议残留，也避免 .NET 4.7+ 的 SystemDefault(0) 让 -bor 落空。
    try {
        $tls12 = [Net.SecurityProtocolType]::Tls12
        try {
            # 优先同时启用 TLS 1.3（仅 .NET 4.7+ 有该枚举）；老 .NET 会抛，退回纯 1.2。
            [Net.ServicePointManager]::SecurityProtocol = $tls12 -bor [Net.SecurityProtocolType]::Tls13
        } catch {
            [Net.ServicePointManager]::SecurityProtocol = $tls12
        }
    } catch {
        # .NET < 4.5 没有 Tls12 枚举，此处抛出被吞，后续请求会以明确的网络错误失败。
    }
}

function Install-ConfigFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw ('临时配置文件不存在：{0}' -f $Source)
    }

    if (-not (Test-Path -LiteralPath $Destination)) {
        [IO.File]::Move($Source, $Destination)
        return $null
    }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = '{0}.backup-{1}-{2}' -f $Destination, $timestamp, $PID
    try {
        [IO.File]::Replace($Source, $Destination, $backup, $true)
        return $backup
    } catch {
        $replaceError = $_.Exception.Message
    }

    # File.Replace is unavailable on some FAT/exFAT/network file systems. Fall back
    # to a backed-up overwrite while keeping restoration possible on failure.
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            if (Test-Path -LiteralPath $backup -PathType Leaf) { return $backup }
            return $null
        }
        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            try { [IO.File]::Copy($backup, $Destination, $true) } catch { }
        }
        throw ('原子替换失败且临时配置文件丢失：{0}' -f $replaceError)
    }

    try {
        if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
            [IO.File]::Copy($Destination, $backup, $false)
        }
        [IO.File]::Copy($Source, $Destination, $true)
        [IO.File]::Delete($Source)
        return $backup
    } catch {
        $fallbackError = $_.Exception.Message
        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            try { [IO.File]::Copy($backup, $Destination, $true) } catch { }
        }
        throw ('无法安全替换配置文件。原子替换失败：{0}；兼容替换失败：{1}；原配置备份：{2}' -f $replaceError, $fallbackError, $backup)
    }
}

try {
    Write-Title

    $apiKey = Read-Host '请输入 API Key'
    $apiKey = $apiKey.Trim()
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        throw 'API Key 不能为空。'
    }
    if (-not $apiKey.StartsWith('sk-')) {
        throw 'API Key 应以 sk- 开头，请到网页控制台复制完整的 API Key 后重新运行。'
    }

    Write-Host ''
    Write-Host '正在读取可用模型列表...' -ForegroundColor DarkGray
    $modelIDs = $null
    $fetchModelError = $null
    try {
        Enable-Tls12
        $setupResponse = Invoke-RestMethod -UseBasicParsing -Method Get -Uri $setupEndpoint -Headers @{ Authorization = ('Bearer ' + $apiKey) } -TimeoutSec 30

        # HTTP 200 也可能拿不到可用清单：data 缺失/非数组（代理返回 HTML 等），
        # 或空列表（token 白名单与渠道可用模型无交集）。这类「请求成功但数据为空」
        # 不会进 catch，必须同样标记后走兜底——在这里 throw 会绕过兜底直接失败退出。
        if ($null -eq $setupResponse -or $null -eq $setupResponse.data) {
            $fetchModelError = New-Object System.Exception ('配置服务返回了无效数据')
        } else {
            # /v1/models 返回 OpenAI 格式: { object: 'list', data: [ { id: '...', ... }, ... ] }
            $modelIDs = @(
                $setupResponse.data |
                    ForEach-Object { ([string]$_.id).Trim() } |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                    Select-Object -Unique
            )
            if ($modelIDs.Count -eq 0) {
                $fetchModelError = New-Object System.Exception ('在线模型列表为空（该 API Key 暂无可用模型）')
            }
        }
    } catch {
        # 不区分失败类型：连接/TLS 层失败（旧证书链、超时、断网）与 HTTP 应答错误
        # （401/403 等，可能是 API Key 问题）一律改用内置默认模型列表兜底，
        # 保证配置总能离线完成。
        $fetchModelError = $_.Exception
    }

    if ($null -ne $fetchModelError) {
        Write-Host ''
        Write-Host ('警告：无法在线获取模型列表（{0}）。' -f $fetchModelError.Message) -ForegroundColor Yellow
        Write-Host ('已改用内置默认模型列表（{0} 个）。若 API Key 有误或个别模型不可用，相应模型会调用失败，请核对后重跑本工具或手动调整。' -f $fallbackModelIDs.Count) -ForegroundColor Yellow
        $modelIDs = $fallbackModelIDs
    }

    # 排除手动专属模型（在线清单与内置清单统一过滤）：一键不写入，用户可手动添加。
    $modelIDs = @($modelIDs | Where-Object { $excludedModelIDSet -notcontains $_.ToLowerInvariant() })

    $apiBaseUrl = $setupApiBaseUrl
    $supportsToolCall = $true
    $supportsReasoning = $false
    $useCustomProtocol = $false
    # 能力表（model-id|images|maxInputTokens|maxOutputTokens）中未列出的模型
    # （如新上架模型）回落到默认值：关闭图片输入 + 默认输入/输出限制。
    $defaultMaxInputTokens = 200000
    $defaultMaxOutputTokens = 65536

    $capabilities = @{}
    if ($null -ne $fetchModelError) {
        # 兜底模式：连接层已不可用，在线能力配置同样拉不到，直接使用内置模型能力，
        # 免去一次注定失败且要等满超时的请求。
        $capabilities = $fallbackCapabilities
    } else {
        Write-Host '正在读取模型能力配置...' -ForegroundColor DarkGray
        try {
            Enable-Tls12
            $capabilitiesResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $capabilitiesUrl -Headers @{ 'Cache-Control' = 'no-cache' } -TimeoutSec 30
            foreach ($rawLine in ([string]$capabilitiesResponse.Content -split "`r?`n")) {
                $line = $rawLine.Trim().TrimStart([char]0xFEFF)
                if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }

                # 格式：model-id|images|maxInputTokens|maxOutputTokens
                $parts = $line.Split('|')
                if ($parts.Count -ne 4) { continue }

                $capabilityModelID = $parts[0].Trim()
                if ([string]::IsNullOrWhiteSpace($capabilityModelID)) { continue }

                $capabilityMaxInput = 0
                $capabilityMaxOutput = 0
                if (-not [int]::TryParse($parts[2].Trim(), [ref]$capabilityMaxInput)) { continue }
                if (-not [int]::TryParse($parts[3].Trim(), [ref]$capabilityMaxOutput)) { continue }
                if ($capabilityMaxInput -le 0 -or $capabilityMaxOutput -le 0) { continue }

                $rawImages = $parts[1].Trim().ToLowerInvariant()
                $supportsImages = @('true', '1', 'yes', 'on') -contains $rawImages

                $capabilities[$capabilityModelID.ToLowerInvariant()] = @{
                    images = $supportsImages
                    maxInputTokens = $capabilityMaxInput
                    maxOutputTokens = $capabilityMaxOutput
                }
            }
        } catch {
            Write-Host '警告：无法读取模型能力配置，所有模型将默认关闭图片输入并使用默认输入/输出限制。' -ForegroundColor Yellow
        }
    }

    Write-Host '将配置以下模型：'
    for ($index = 0; $index -lt $modelIDs.Count; $index++) {
        Write-Host ('  {0}. {1}' -f ($index + 1), $modelIDs[$index])
    }
    Write-Host ''

    if (Test-Path -LiteralPath $configDirectory -PathType Leaf) {
        throw ('配置目录路径已被文件占用：{0}' -f $configDirectory)
    }

    if (-not (Test-Path -LiteralPath $configDirectory)) {
        New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    }

    $rootType = 'array'
    $root = $null
    $models = @()

    if (Test-Path -LiteralPath $configFile) {
        if ((Get-Item -LiteralPath $configFile).PSIsContainer) {
            throw ('配置文件路径已被文件夹占用：{0}' -f $configFile)
        }

        $source = [IO.File]::ReadAllText($configFile, [Text.Encoding]::UTF8).Trim()
        if ($source) {
            try {
                $parsed = $source | ConvertFrom-Json
            } catch {
                throw '现有 models.json 不是有效 JSON，原文件没有被覆盖。'
            }

            if ($source.TrimStart().StartsWith('[')) {
                $models = @($parsed)
            } elseif ($parsed -and $parsed.PSObject.Properties.Name -contains 'models') {
                $models = @($parsed.models)
                $rootType = 'object'
                $root = $parsed
            } else {
                throw '现有 models.json 必须是模型数组，或包含 models 数组的对象。'
            }
        }
    }

    $fixedModels = @()
    $fixedModelByID = @{}
    foreach ($modelID in $modelIDs) {
        $capabilityKey = $modelID.ToLowerInvariant()
        $modelCapability = $null
        if ($capabilities.ContainsKey($capabilityKey)) {
            $modelCapability = $capabilities[$capabilityKey]
        }
        $modelSupportsImages = $false
        $modelMaxInputTokens = $defaultMaxInputTokens
        $modelMaxOutputTokens = $defaultMaxOutputTokens
        if ($null -ne $modelCapability) {
            $modelSupportsImages = [bool]$modelCapability.images
            $modelMaxInputTokens = [int]$modelCapability.maxInputTokens
            $modelMaxOutputTokens = [int]$modelCapability.maxOutputTokens
        }
        $model = New-FixedModel -ModelID $modelID -ApiKey $apiKey -SupportsImages $modelSupportsImages -MaxInputTokens $modelMaxInputTokens -MaxOutputTokens $modelMaxOutputTokens
        $fixedModels += $model
        $fixedModelByID[$modelID] = $model
    }

    $updatedModels = New-Object System.Collections.ArrayList
    $installedIDs = @{}
    foreach ($item in @($models)) {
        $itemID = if ($null -ne $item -and $item.PSObject.Properties.Name -contains 'id') { [string]$item.id } else { '' }
        if ($itemID -and $fixedModelByID.ContainsKey($itemID)) {
            if (-not $installedIDs.ContainsKey($itemID)) {
                [void]$updatedModels.Add($fixedModelByID[$itemID])
                $installedIDs[$itemID] = $true
            }
            continue
        }
        [void]$updatedModels.Add($item)
    }

    foreach ($model in $fixedModels) {
        if (-not $installedIDs.ContainsKey($model.id)) {
            [void]$updatedModels.Add($model)
            $installedIDs[$model.id] = $true
        }
    }

    if ($rootType -eq 'object') {
        $root.models = @($updatedModels)
        $output = $root
    } else {
        $output = @($updatedModels)
    }

    $json = ConvertTo-Json -InputObject $output -Depth 30
    [IO.File]::WriteAllText($temporaryFile, $json + [Environment]::NewLine, $utf8WithoutBom)

    $backupFile = Install-ConfigFile -Source $temporaryFile -Destination $configFile

    Write-Host ''
    Write-Host '配置成功！' -ForegroundColor Green
    if ($null -ne $fetchModelError) {
        Write-Host '注：本次使用内置默认模型列表（在线列表读取失败），模型清单可能不是最新。' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host '已配置模型：'
    foreach ($modelID in $modelIDs) {
        Write-Host ('  √ {0}' -f $modelID) -ForegroundColor Green
    }
    Write-Host ''
    Write-Host ('配置文件：{0}' -f $configFile)
    if ($backupFile -and (Test-Path -LiteralPath $backupFile)) {
        Write-Host ('备份文件：{0}' -f $backupFile)
    }
    Write-Host ''
    Write-Host '如果对话框右下角没有显示自定义模型，请重新打开WorkBuddy。' -ForegroundColor Yellow
    exit 0
} catch {
    if (Test-Path -LiteralPath $temporaryFile) {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host ''
    Write-Host ('配置失败：{0}' -f $_.Exception.Message) -ForegroundColor Red
    if ($backupFile -and (Test-Path -LiteralPath $backupFile)) {
        Write-Host ('备份文件：{0}' -f $backupFile) -ForegroundColor Yellow
    }
    exit 1
}
