package main

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestWindowsLauncherIsBrandedAndBounded(t *testing.T) {
	script := windowsInstallScriptMode("https://www.workbuddy999.top/api/tasks/task/config", "real")
	if !strings.Contains(script, "https://www.workbuddy999.top/setup/") || !strings.Contains(script, "版权：WorkBuddy") {
		t.Fatal("launcher is missing the branded header")
	}
	for _, line := range strings.Split(script, "\n") {
		if strings.HasPrefix(line, `set "WB_PAYLOAD=`) {
			if len(line) >= 8191 {
				t.Fatalf("encoded launcher line is too long: %d", len(line))
			}
			value := strings.TrimSuffix(strings.TrimPrefix(line, `set "WB_PAYLOAD=`), `"`)
			if _, err := base64.StdEncoding.DecodeString(value); err != nil {
				t.Fatalf("encoded launcher payload is invalid: %v", err)
			}
		}
	}
	if strings.Contains(script, "https://www.workbuddy999.top/api/tasks/task/config") || strings.Contains(script, "setup-windows-amd64.exe") {
		t.Fatal("launcher exposed the full PowerShell payload instead of the compressed bootstrap")
	}
}
