param(
  [string]$ApiUrl = $env:WORKBUDDY_API_URL,
  [string]$ApiKey = $env:WORKBUDDY_API_KEY,
  [switch]$CodeBuddy,
  [ValidateSet('cn','global')][string]$Region = 'global',
  [string]$ConfigPath,
  [string]$CatalogUrl = 'https://www.workbuddy999.top/api/portal/setup/catalog'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($MyInvocation.MyCommand.Name -like 'codebuddy-*') { $CodeBuddy = $true }
if (-not $ApiUrl) { $ApiUrl = 'https://api.workbuddy999.top/v1' }
if (-not $ApiKey -and $env:WORKBUDDY_API_KEY_B64) {
  try { $ApiKey = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:WORKBUDDY_API_KEY_B64)) }
  finally { Remove-Item Env:WORKBUDDY_API_KEY_B64 -ErrorAction SilentlyContinue }
}
if (-not $ApiKey) { $secure = Read-Host 'API Key' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { $ApiKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }
$ApiUrl=$ApiUrl.TrimEnd('/')
if (-not $ApiUrl -or -not $ApiKey) { throw '接口地址和 API Key 不能为空。' }
if (-not $ConfigPath) { $dir = if ($CodeBuddy) { if ($Region -eq 'cn') { '.codebuddycn' } else { '.codebuddy' } } else { '.workbuddy' }; $ConfigPath=Join-Path $HOME "$dir\models.json" }
$folder=Split-Path -Parent $ConfigPath; New-Item -ItemType Directory -Force $folder | Out-Null
Write-Host "读取模型：$ApiUrl/models"
$resp=Invoke-RestMethod -Uri "$ApiUrl/models" -Headers @{ Authorization="Bearer $ApiKey" } -Method Get -TimeoutSec 30
$items=@($resp.data); if (-not $items.Count) { $items=@($resp.models) }
$ids=@($items | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.id } } | Where-Object { $_ } | ForEach-Object { [string]$_ } | Select-Object -Unique)
if (-not $ids.Count) { throw '接口没有返回可用模型 ID，未修改配置。' }
$catalog=Invoke-RestMethod -Uri $CatalogUrl -Method Get -TimeoutSec 30
if (-not $catalog.success -or -not $catalog.data.models) { throw '模型能力清单不可用，未修改配置。' }
$available=@{}; foreach($id in $ids){$available[$id]=$true}
$selected=@($catalog.data.models | Where-Object { $available[[string]$_.id] })
if (-not $selected.Count) { throw '渠道模型与能力清单不一致，未修改配置。' }
$now=(Get-Date).ToString('yyyyMMdd-HHmmss-fff'); $backup=''
$root=[ordered]@{ models=@() }
if (Test-Path -LiteralPath $ConfigPath) { try { $old=Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json } catch { throw "现有配置不是有效 JSON，已停止且未覆盖：$ConfigPath" }; if ($old -is [pscustomobject]) { $root=[ordered]@{}; foreach($property in $old.PSObject.Properties) { $root[$property.Name]=$property.Value }; if (-not $root.Contains('models')) { $root.models=@() } } else { throw '现有配置必须是 JSON 对象，已停止。' }; $backup="$ConfigPath.$now.backup"; Copy-Item -LiteralPath $ConfigPath -Destination $backup }
$managed=@{}; foreach($model in $selected){$managed[[string]$model.id]=$true}
$configured=New-Object System.Collections.ArrayList
foreach($model in $selected){
  $entry=[ordered]@{ id=[string]$model.id; name=[string]$model.name; vendor='Custom'; url="$ApiUrl/chat/completions"; apiKey=$ApiKey; useCustomProtocol=$false }
  if($null -ne $model.supportsToolCall){$entry.supportsToolCall=[bool]$model.supportsToolCall}
  if($null -ne $model.supportsImages){$entry.supportsImages=[bool]$model.supportsImages}
  if($null -ne $model.supportsReasoning){$entry.supportsReasoning=[bool]$model.supportsReasoning}
  if($null -ne $model.onlyReasoning){$entry.onlyReasoning=[bool]$model.onlyReasoning}
  if($null -ne $model.reasoning){$entry.reasoning=$model.reasoning}
  if($model.maxInputTokens){$entry.maxInputTokens=[int]$model.maxInputTokens}
  if($model.maxOutputTokens){$entry.maxOutputTokens=[int]$model.maxOutputTokens}
  [void]$configured.Add($entry)
}
foreach($model in @($root.models)){
  if (-not $model.id -or $managed[[string]$model.id]) { continue }
  $oldName=[string]$model.name; $oldUrl=[string]$model.url
  $branded=$oldName -match '^(QiYueAI(?:-|:)|WBAI-)'
  $ourEndpoint=$oldUrl -match '^https?://(?:(?:www|api)\.workbuddy999\.top|(?:localhost|127\.0\.0\.1):5173)/v1(?:/|$)'
  if ($branded -and $ourEndpoint) { continue }
  [void]$configured.Add($model)
}
$root.models=@($configured.ToArray())
$tmp="$ConfigPath.tmp"; [IO.File]::WriteAllText($tmp,($root | ConvertTo-Json -Depth 15),(New-Object Text.UTF8Encoding($false))); Move-Item -LiteralPath $tmp -Destination $ConfigPath -Force
Write-Host "已写入 $($selected.Count) 个模型：$ConfigPath" -ForegroundColor Green
if ($backup) { Write-Host "原配置备份：$backup" }
Write-Host '请重启客户端，并在模型菜单选择自定义模型。'

