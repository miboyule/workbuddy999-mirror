package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
)

const installerHeader = `rem =========================================================
rem WorkBuddy 一键自动配置助手
rem 官网：https://www.workbuddy999.top/setup/
rem 版权：WorkBuddy积分充值兑换平台运营方 版权所有
rem 联系：微信 / QQ 36612995
rem 请从官网生成和运行本文件，勿从未知来源获取。
rem =========================================================`

func taskFilename(mode, platform string) string {
	suffix := "real-install"
	if mode != "real" {
		suffix = "sandbox-test"
	}
	if platform == "macos" {
		return fmt.Sprintf(`attachment; filename="workbuddy999.top-oneclick-%s-macos.command"`, suffix)
	}
	return fmt.Sprintf(`attachment; filename="workbuddy999.top-oneclick-%s-windows.cmd"`, suffix)
}

func windowsInstallScript(configURL string) string {
	return windowsInstallScriptMode(configURL, "sandbox")
}

func windowsInstallScriptMode(configURL, mode string) string {
	payload := fmt.Sprintf(`$ErrorActionPreference='Stop'
$ConfigUrl='%s'
$InstallMode='%s'
$arch=$env:PROCESSOR_ARCHITECTURE
if($env:PROCESSOR_ARCHITEW6432){$arch=$env:PROCESSOR_ARCHITEW6432}
if($arch -eq 'ARM64'){$BinaryName='setup-windows-arm64.exe'}elseif($arch -eq 'AMD64'){$BinaryName='setup-windows-amd64.exe'}else{throw "不支持当前 Windows 架构：$arch"}
$ServerRoot=([uri]$ConfigUrl).GetLeftPart([System.UriPartial]::Authority)
$dir=Join-Path $env:TEMP ('workbuddy-setup-'+[guid]::NewGuid().ToString('N'))
$zip=$dir+'.zip';$exe=Join-Path $dir $BinaryName
New-Item -ItemType Directory -Path $dir -Force|Out-Null
function Hash([string]$path){$s=[IO.File]::OpenRead($path);$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose();$s.Dispose()}}
try{
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 $release=Invoke-RestMethod -TimeoutSec 30 -Uri ($ServerRoot+'/bin/releases.json')
 $item=@($release.files|Where-Object{$_.name -eq $BinaryName})
 if($item.Count -ne 1 -or $item[0].archive -ne ($BinaryName+'.zip') -or $item[0].archive_sha256 -notmatch '^[a-f0-9]{64}$' -or $item[0].sha256 -notmatch '^[a-f0-9]{64}$'){throw '发布文件校验信息无效'}
 $item=$item[0];Write-Host ('正在下载配置助手（'+[Math]::Round($item.archive_size/1MB,2)+' MB）……')
 Invoke-WebRequest -TimeoutSec 60 -UseBasicParsing -Uri ($ServerRoot+'/bin/'+$item.archive+'?v='+$item.archive_sha256) -OutFile $zip
 if((Hash $zip) -ne $item.archive_sha256){throw '压缩包 SHA256 校验失败'}
 [IO.Compression.ZipFile]::ExtractToDirectory($zip,$dir)
 if((Hash $exe) -ne $item.sha256){throw '配置助手 SHA256 校验失败'}
 Write-Host '校验通过，正在配置……'
 if($InstallMode -eq 'real'){if($ServerRoot -like 'http://127.0.0.1:*'){& $exe --config-url $ConfigUrl --allow-local-real-install}else{& $exe --config-url $ConfigUrl}}else{$testHome=Join-Path $env:TEMP ('newapi-oneclick-test-'+[guid]::NewGuid().ToString('N'));foreach($c in @('.workbuddy','.codebuddy','.codebuddycn','.zcode','.dsh','.hermes')){New-Item -ItemType Directory -Path (Join-Path $testHome $c) -Force|Out-Null};Write-Host ('隔离测试目录：'+$testHome);& $exe --config-url $ConfigUrl --home $testHome --no-restart}
 $code=$LASTEXITCODE;if($code -ne 0){throw "配置程序返回 $code"}
 if($InstallMode -eq 'real'){Write-Host '真实安装完成。请确认客户端已重新打开。'}else{Write-Host '隔离测试完成，未修改或重启真实客户端。'}
 exit 0
}catch{Write-Host ('[失败] '+$_.Exception.Message);Write-Host '请重新从 https://www.workbuddy999.top/setup/ 生成脚本，或联系客服：微信 / QQ 36612995';exit 1}finally{Remove-Item $exe,$zip -Force -ErrorAction SilentlyContinue;Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue}`, configURL, mode)
	encoded := encodePowerShellPayload(payload)
	return fmt.Sprintf(`@echo off
chcp 65001 >nul
setlocal EnableExtensions
title WorkBuddy999.top 一键自动配置
%s
set "WB_PAYLOAD=%s"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "%%WB_PAYLOAD%%"
set "WB_EXIT=%%ERRORLEVEL%%"
if not "%%WB_EXIT%%"=="0" (
  echo.
  echo [失败] 配置未完成，请联系客服：微信 / QQ 36612995
  pause
)
exit /b %%WB_EXIT%%
`, installerHeader, encoded)
}

func utf16LE(value string) []byte {
	runes := []rune(value)
	result := make([]byte, 0, len(runes)*2)
	for _, r := range runes {
		if r > 0xffff {
			r = 0xfffd
		}
		result = append(result, byte(r), byte(r>>8))
	}
	return result
}

func encodePowerShellPayload(payload string) string {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	_, _ = writer.Write(utf16LE(payload))
	_ = writer.Close()
	compressedText := base64.StdEncoding.EncodeToString(compressed.Bytes())
	bootstrap := fmt.Sprintf(`$m=[IO.MemoryStream]::new([Convert]::FromBase64String('%s'));$g=[IO.Compression.GzipStream]::new($m,[IO.Compression.CompressionMode]::Decompress);$r=[IO.StreamReader]::new($g,[Text.Encoding]::Unicode);&([scriptblock]::Create($r.ReadToEnd()))`, compressedText)
	return base64.StdEncoding.EncodeToString(utf16LE(bootstrap))
}

func macInstallScript(configURL string) string {
	return macInstallScriptMode(configURL, "sandbox")
}

func macInstallScriptMode(configURL, mode string) string {
	return fmt.Sprintf(`#!/bin/sh
# WorkBuddy 一键自动配置助手
# 官网：https://www.workbuddy999.top/setup/
# 版权：WorkBuddy积分充值兑换平台运营方 版权所有
# 联系：微信 / QQ 36612995
set -eu

CONFIG_URL='%s'
INSTALL_MODE='%s'
case "$(uname -m)" in
  arm64|aarch64) BINARY_NAME='setup-darwin-arm64' ;;
  x86_64|amd64) BINARY_NAME='setup-darwin-amd64' ;;
  *) echo '[错误] 不支持当前 Mac 处理器架构。' >&2; exit 1 ;;
esac

SERVER_ROOT=$(printf '%%s' "$CONFIG_URL" | sed 's#/api/tasks/.*##')
BINARY_URL="$SERVER_ROOT/bin/$BINARY_NAME.gz"
SETUP_EXE=$(mktemp "${TMPDIR:-/tmp}/newapi-oneclick.XXXXXX")
cleanup() { rm -f "$SETUP_EXE" "$SETUP_EXE.gz"; }
trap cleanup EXIT HUP INT TERM
if [ "$INSTALL_MODE" = 'real' ]; then
  case "$SERVER_ROOT" in
    http://127.0.0.1:*) set -- --allow-local-real-install ;;
    *) set -- ;;
  esac
else
  TEST_HOME=$(mktemp -d "${TMPDIR:-/tmp}/newapi-oneclick-test.XXXXXX")
  mkdir -p "$TEST_HOME/.workbuddy" "$TEST_HOME/.codebuddy" "$TEST_HOME/.codebuddycn" "$TEST_HOME/.zcode" "$TEST_HOME/.dsh" "$TEST_HOME/.hermes"
  echo "SANDBOX HOME: $TEST_HOME"
  set -- --home "$TEST_HOME" --no-restart
fi

echo '正在下载压缩配置助手，请稍候……'
fetch_file() {
  if command -v curl >/dev/null 2>&1; then curl --fail --location --silent --show-error "$1" --output "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else echo '[错误] 需要 curl 或 wget。' >&2; exit 1; fi
}
fetch_file "$BINARY_URL.sha256" "$SETUP_EXE"
EXPECTED=$(tr -d '[:space:]' < "$SETUP_EXE")
case "$EXPECTED" in *[!a-f0-9]*|'') echo 'Invalid SHA256 metadata' >&2; exit 1 ;; esac
[ "${#EXPECTED}" -eq 64 ] || exit 1
fetch_file "$BINARY_URL?v=$EXPECTED" "$SETUP_EXE.gz"
ACTUAL=$(shasum -a 256 "$SETUP_EXE.gz" | cut -d ' ' -f 1)
[ "$ACTUAL" = "$EXPECTED" ] || { echo 'SHA256 verification failed' >&2; exit 1; }
gzip -dc "$SETUP_EXE.gz" > "$SETUP_EXE"
echo '校验通过，正在配置……'
chmod 700 "$SETUP_EXE"
echo '下载完成，正在启动配置程序……'
"$SETUP_EXE" --config-url "$CONFIG_URL" "$@"
`, configURL, mode)
}
