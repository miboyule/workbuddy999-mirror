package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"newapi-oneclick/internal/config"
)

const testAPIKey = "test-server-side-key"

func newTestApplication(t *testing.T) *application {
	t.Helper()
	app, err := newApplication(applicationConfig{
		PublicBaseURL: "https://install.example.com",
		CustomersFile: filepath.Join(t.TempDir(), "customers.json"),
		AdminToken:    "test-admin-token",
	})
	if err != nil {
		t.Fatalf("newApplication: %v", err)
	}
	return app
}

func request(app *application, method, target, body string, authorize bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if authorize {
		req.Header.Set("Authorization", "Bearer test-admin-token")
	}
	recorder := httptest.NewRecorder()
	app.routes().ServeHTTP(recorder, req)
	return recorder
}

func createTestCustomer(t *testing.T, app *application) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/chat/completions" && r.Method == http.MethodPost && r.Header.Get("Authorization") == "Bearer "+testAPIKey {
			writeJSON(w, http.StatusOK, map[string]any{"choices": []map[string]any{{"message": map[string]string{"content": "OK"}}}})
			return
		}
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer "+testAPIKey {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": []map[string]string{{"id": "test-model"}, {"id": "another-model"}}})
	}))
	t.Cleanup(server.Close)
	app.modelTestLocal = true
	body := `{"customer":"测试客户","base_url":"` + server.URL + `/v1","api_key":"` + testAPIKey + `","model":"test-model","models":[{"id":"test-model","display_name":"测试模型","description":"本地测试","status":"available","latency_ms":100,"recommended":true}],"verify":true,"restart":true}`
	response := request(app, http.MethodPost, "http://service.local/admin/customers", body, true)
	if response.Code != http.StatusCreated {
		t.Fatalf("create customer status = %d, body = %s", response.Code, response.Body.String())
	}
	var result struct {
		Token         string `json:"token"`
		ActivationURL string `json:"activation_url"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if len(result.Token) != 32 || !validToken(result.Token) {
		t.Fatalf("unexpected generated token %q", result.Token)
	}
	if result.ActivationURL != "https://install.example.com/i/"+result.Token {
		t.Fatalf("unexpected activation URL: %+v", result)
	}
	if _, err := os.Stat(app.store.path); err != nil {
		t.Fatalf("customer store was not persisted: %v", err)
	}
	return result.Token
}

func TestHealthAndSecurityHeaders(t *testing.T) {
	app := newTestApplication(t)
	response := request(app, http.MethodGet, "http://service.local/healthz", "", false)
	if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("unexpected health response: %d %s", response.Code, response.Body.String())
	}
	for name, expected := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if actual := response.Header().Get(name); actual != expected {
			t.Errorf("%s = %q, want %q", name, actual, expected)
		}
	}
	if policy := response.Header().Get("Content-Security-Policy"); !strings.Contains(policy, "connect-src 'self'") || !strings.Contains(policy, "img-src 'self'") {
		t.Fatalf("same-origin API requests blocked by CSP: %s", policy)
	}
}

func TestSetupIsSinglePageWithoutActivation(t *testing.T) {
	app := newTestApplication(t)
	for _, path := range []string{"/setup", "/setup/"} {
		response := request(app, http.MethodGet, "http://service.local"+path, "", false)
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("setup entry failed: %d", response.Code)
		}
		page := response.Body.String()
		for _, control := range []string{`id="activationForm"`, `id="modelGrid"`, `id="clientGrid"`, `id="generate"`, `id="resultDialog"`, `value="real" checked`, `name="configStrategy"`, `value="merge" checked`, `/brand/clients/workbuddy.svg`} {
			if !strings.Contains(page, control) {
				t.Fatalf("single page missing %s", control)
			}
		}
		if strings.Contains(page, testAPIKey) || strings.Contains(page, "下一步") {
			t.Fatal("setup leaks key or still requires wizard navigation")
		}
		if strings.Contains(page, `id="confirmReal"`) || !strings.Contains(page, "生成真实安装脚本") {
			t.Fatal("real installation is not the default one-click path")
		}
	}
}

func TestActivationTaskFlow(t *testing.T) {
	app := newTestApplication(t)
	code := createTestCustomer(t, app)

	landing := request(app, http.MethodGet, "http://service.local/i/"+code, "", false)
	if landing.Code != http.StatusOK || !strings.Contains(landing.Body.String(), "/api/session/") || !strings.Contains(landing.Body.String(), "选择模型，打开客户端就能用") {
		t.Fatalf("unexpected landing page: %d %s", landing.Code, landing.Body.String())
	}
	if strings.Contains(landing.Body.String(), testAPIKey) {
		t.Fatal("landing page leaked server-side API key")
	}
	if response := request(app, http.MethodGet, "http://service.local/api/config/"+code, "", false); response.Code != http.StatusNotFound {
		t.Fatal("activation code exposed old config endpoint")
	}

	session := request(app, http.MethodGet, "http://service.local/api/session/"+code, "", false)
	if session.Code != http.StatusOK || strings.Contains(session.Body.String(), testAPIKey) || !strings.Contains(session.Body.String(), "another-model") {
		t.Fatalf("unexpected public session: %d %s", session.Code, session.Body.String())
	}
	check := request(app, http.MethodPost, "http://service.local/api/model-check", `{"activation_code":"`+code+`","model":"test-model"}`, false)
	if check.Code != http.StatusOK || !strings.Contains(check.Body.String(), "connected") || strings.Contains(check.Body.String(), testAPIKey) {
		t.Fatalf("model check: %d %s", check.Code, check.Body.String())
	}
	for _, invalid := range []string{
		`{"activation_code":"` + code + `","model":"not-allowed","clients":["WorkBuddy"]}`,
		`{"activation_code":"` + code + `","model":"test-model","clients":["not-supported"]}`,
	} {
		if response := request(app, http.MethodPost, "http://service.local/api/tasks", invalid, false); response.Code != http.StatusBadRequest {
			t.Fatalf("invalid task was accepted: %d", response.Code)
		}
	}

	task := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"test-model","clients":["WorkBuddy"]}`, false)
	if task.Code != http.StatusCreated || strings.Contains(task.Body.String(), testAPIKey) {
		t.Fatalf("unexpected task response: %d %s", task.Code, task.Body.String())
	}
	var created struct {
		TaskID      string `json:"task_id"`
		DownloadCMD string `json:"download_cmd_url"`
		DownloadMac string `json:"download_command_url"`
	}
	if err := json.Unmarshal(task.Body.Bytes(), &created); err != nil || !validToken(created.TaskID) || created.DownloadCMD == "" || created.DownloadMac == "" {
		t.Fatalf("invalid task response: %s", task.Body.String())
	}

	configResponse := request(app, http.MethodGet, "http://service.local/api/tasks/"+created.TaskID+"/config", "", false)
	if configResponse.Code != http.StatusOK || configResponse.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unexpected task config response: %d, headers=%v", configResponse.Code, configResponse.Header())
	}
	var payload config.Payload
	if err := json.Unmarshal(configResponse.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.APIKey != testAPIKey || len(payload.Clients) != 1 || payload.Clients[0] != "WorkBuddy" {
		t.Fatalf("unexpected task payload: %+v", payload)
	}
	if payload.Restart {
		t.Fatal("sandbox task unexpectedly requested restart")
	}

	cmd := request(app, http.MethodGet, "http://service.local/download/task/"+created.TaskID+"/cmd", "", false)
	if cmd.Code != http.StatusOK || !strings.Contains(cmd.Body.String(), "WB_PAYLOAD=") || strings.Contains(cmd.Body.String(), testAPIKey) || !strings.Contains(cmd.Header().Get("Content-Disposition"), "workbuddy999.top-oneclick-sandbox-test-windows.cmd") {
		t.Fatalf("unexpected Windows task download: %d %s", cmd.Code, cmd.Body.String())
	}
	mac := request(app, http.MethodGet, "http://service.local/download/task/"+created.TaskID+"/command", "", false)
	if mac.Code != http.StatusOK || !strings.Contains(mac.Body.String(), "官网：https://www.workbuddy999.top/setup/") || strings.Contains(mac.Body.String(), testAPIKey) || !strings.Contains(mac.Header().Get("Content-Disposition"), "workbuddy999.top-oneclick-sandbox-test-macos.command") {
		t.Fatalf("unexpected macOS task download: %d %s", mac.Code, mac.Body.String())
	}
	if !strings.Contains(cmd.Body.String(), "chcp 65001") || !strings.Contains(cmd.Body.String(), "官网：https://www.workbuddy999.top/setup/") || strings.Contains(cmd.Body.String(), "INSTALL_MODE=") {
		t.Fatal("sandbox launcher lacks UTF-8 or clear mode indication")
	}
	real := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"test-model","clients":["WorkBuddy"],"install_mode":"real"}`, false)
	if real.Code != http.StatusCreated {
		t.Fatalf("real task: %d %s", real.Code, real.Body.String())
	}
	var realCreated struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(real.Body.Bytes(), &realCreated); err != nil {
		t.Fatal(err)
	}
	realConfig := request(app, http.MethodGet, "http://service.local/api/tasks/"+realCreated.TaskID+"/config", "", false)
	var realPayload config.Payload
	if err := json.Unmarshal(realConfig.Body.Bytes(), &realPayload); err != nil || !realPayload.Restart {
		t.Fatal("real task did not request restart")
	}
	realCmd := request(app, http.MethodGet, "http://service.local/download/task/"+realCreated.TaskID+"/cmd", "", false)
	if !strings.Contains(realCmd.Body.String(), "WB_PAYLOAD=") || !strings.Contains(realCmd.Body.String(), "workbuddy999.top") || strings.Contains(realCmd.Body.String(), "INSTALL_MODE=") {
		t.Fatal("real launcher lacks explicit mode")
	}
	invalidMode := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"test-model","clients":["WorkBuddy"],"install_mode":"unknown"}`, false)
	if invalidMode.Code != http.StatusBadRequest {
		t.Fatal("accepted unknown install mode")
	}

	for i := 0; i < 2; i++ {
		request(app, http.MethodGet, "http://service.local/api/tasks/"+created.TaskID+"/config", "", false)
	}
	if response := request(app, http.MethodGet, "http://service.local/api/tasks/"+created.TaskID+"/config", "", false); response.Code != http.StatusGone {
		t.Fatalf("task reuse status = %d, want %d", response.Code, http.StatusGone)
	}
	app.taskMu.Lock()
	app.tasks["expired-test-task"] = installTask{Payload: payload, ExpiresAt: time.Now().Add(-time.Second)}
	app.taskMu.Unlock()
	if response := request(app, http.MethodGet, "http://service.local/api/tasks/expired-test-task/config", "", false); response.Code != http.StatusGone {
		t.Fatalf("expired task status = %d, want %d", response.Code, http.StatusGone)
	}
}

func TestProductionRealInstallTask(t *testing.T) {
	app := newTestApplication(t)
	payload := config.Payload{
		BaseURL: "https://api.example.com/v1", APIKey: testAPIKey,
		Model: "deepseek-v4-flash", DisplayName: "WBAI-d02-0.17x",
	}
	code, err := app.store.create(payload)
	if err != nil {
		t.Fatal(err)
	}
	app.cacheModels(code, []config.ModelOption{{ID: payload.Model, DisplayName: payload.DisplayName}})
	response := request(app, http.MethodPost, "http://service.local/api/tasks",
		`{"activation_code":"`+code+`","model":"deepseek-v4-flash","clients":["WorkBuddy"],"install_mode":"real"}`, false)
	if response.Code != http.StatusCreated {
		t.Fatalf("production real install: %d %s", response.Code, response.Body.String())
	}
	var task struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &task); err != nil {
		t.Fatal(err)
	}
	installed := request(app, http.MethodGet, "http://service.local/api/tasks/"+task.TaskID+"/config", "", false)
	var installedPayload config.Payload
	if err := json.Unmarshal(installed.Body.Bytes(), &installedPayload); err != nil || !installedPayload.Restart || installedPayload.DisplayName != payload.DisplayName {
		t.Fatalf("real install must set default model and restart: %d %s", installed.Code, installed.Body.String())
	}
	cmd := request(app, http.MethodGet, "http://service.local/download/task/"+task.TaskID+"/cmd", "", false)
	if cmd.Code != http.StatusOK || !strings.Contains(cmd.Body.String(), `WB_PAYLOAD=`) || strings.Contains(cmd.Body.String(), testAPIKey) {
		t.Fatalf("real install launcher invalid: %d %s", cmd.Code, cmd.Body.String())
	}
	cleanRequest := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"deepseek-v4-flash","clients":["WorkBuddy"],"install_mode":"real","clean_install":true}`, false)
	if cleanRequest.Code != http.StatusCreated {
		t.Fatalf("clean install task: %d %s", cleanRequest.Code, cleanRequest.Body.String())
	}
	var cleanTask struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(cleanRequest.Body.Bytes(), &cleanTask); err != nil {
		t.Fatal(err)
	}
	cleanConfig := request(app, http.MethodGet, "http://service.local/api/tasks/"+cleanTask.TaskID+"/config", "", false)
	var cleanPayload config.Payload
	if err := json.Unmarshal(cleanConfig.Body.Bytes(), &cleanPayload); err != nil || !cleanPayload.CleanInstall {
		t.Fatalf("clean install strategy was not carried into payload: %d %s", cleanConfig.Code, cleanConfig.Body.String())
	}
}

func TestInstallResultFlow(t *testing.T) {
	app := newTestApplication(t)
	app.tasks["result-test-task"] = installTask{
		Mode: "sandbox", Payload: config.Payload{Model: "test-model"}, ExpiresAt: time.Now().Add(time.Minute),
	}
	path := "http://service.local/api/tasks/result-test-task/result"
	if response := request(app, http.MethodGet, path, "", false); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"pending"`) {
		t.Fatalf("pending result: %d %s", response.Code, response.Body.String())
	}
	for _, invalid := range []string{
		`{"success":true,"mode":"real","model":"test-model"}`,
		`{"success":true,"mode":"sandbox","model":"wrong-model"}`,
		`{"success":true,"mode":"sandbox"}`,
		`{"success":true,"mode":"sandbox","model":"test-model","restart_attempted":true}`,
		`{"success":true,"mode":"sandbox","model":"test-model"} {}`,
	} {
		if response := request(app, http.MethodPost, path, invalid, false); response.Code != http.StatusBadRequest {
			t.Fatalf("accepted invalid outcome: %d %s", response.Code, invalid)
		}
	}
	valid := `{"success":true,"mode":"sandbox","model":"test-model","backup_dir":"C:\\test-backup","results":[{"client":"WorkBuddy","status":"configured","detail":"models written"}]}`
	if response := request(app, http.MethodPost, path, valid, false); response.Code != http.StatusOK {
		t.Fatalf("post result: %d %s", response.Code, response.Body.String())
	}
	if response := request(app, http.MethodGet, path, "", false); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"completed"`) || !strings.Contains(response.Body.String(), `"success":true`) || !strings.Contains(response.Body.String(), `"client":"WorkBuddy"`) || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("completed result: %d %s", response.Code, response.Body.String())
	}
	if response := request(app, http.MethodGet, "http://service.local/api/tasks/not-found/result", "", false); response.Code != http.StatusNotFound {
		t.Fatalf("unknown result: %d", response.Code)
	}
	app.tasks["expired-result-task"] = installTask{ExpiresAt: time.Now().Add(-time.Second)}
	if response := request(app, http.MethodGet, "http://service.local/api/tasks/expired-result-task/result", "", false); response.Code != http.StatusNotFound {
		t.Fatalf("expired result: %d", response.Code)
	}
}

func TestSameOriginRequestAllowsLocalPortHandoff(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:43498/api/tasks", nil)
	request.Header.Set("Origin", "http://127.0.0.1:8787")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	if !sameOriginRequest(request) {
		t.Fatal("local portal handoff was rejected")
	}
	request.Header.Set("Origin", "https://attacker.example")
	if sameOriginRequest(request) {
		t.Fatal("cross-site origin was accepted")
	}
}

func TestAdminValidationAndNoEnumeration(t *testing.T) {
	app := newTestApplication(t)
	validBody := `{"base_url":"https://api.example.com/v1","api_key":"sk-test","model":"model"}`
	if response := request(app, http.MethodPost, "http://service.local/admin/customers", validBody, false); response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized create status = %d", response.Code)
	}
	if response := request(app, http.MethodGet, "http://service.local/admin/customers", "", true); response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("customer enumeration status = %d", response.Code)
	}
	if response := request(app, http.MethodPost, "http://service.local/admin/customers", `{"base_url":"bad","api_key":"sk-test","model":"model"}`, true); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid customer status = %d", response.Code)
	}
	tooLarge := `{"base_url":"https://api.example.com/v1","api_key":"` + strings.Repeat("x", maxAdminRequestBody) + `","model":"model"}`
	if response := request(app, http.MethodPost, "http://service.local/admin/customers", tooLarge, true); response.Code != http.StatusBadRequest {
		t.Fatalf("oversized request status = %d", response.Code)
	}
}

func TestUnknownTokensAndBinaryWhitelist(t *testing.T) {
	app := newTestApplication(t)
	for _, path := range []string{"/i/missing", "/api/session/missing", "/api/tasks/missing/config", "/download/task/missing/cmd", "/bin/setup-linux-amd64"} {
		if response := request(app, http.MethodGet, "http://service.local"+path, "", false); response.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want 404", path, response.Code)
		}
	}
	app.binaryDir = t.TempDir()
	if err := os.Mkdir(filepath.Join(app.binaryDir, "bin"), 0o700); err != nil {
		t.Fatal(err)
	}
	contents := []byte("test-binary-without-customer-configuration")
	if err := os.WriteFile(filepath.Join(app.binaryDir, "bin", "setup-darwin-arm64"), contents, 0o700); err != nil {
		t.Fatal(err)
	}
	response := request(app, http.MethodGet, "http://service.local/bin/setup-darwin-arm64", "", false)
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), contents) || strings.Contains(response.Body.String(), testAPIKey) {
		t.Fatalf("unexpected binary response: %d", response.Code)
	}
}

func TestIPLimiter(t *testing.T) {
	limiter := newIPLimiter(0, 2)
	now := time.Now()
	if !limiter.allow("192.0.2.1", now) || !limiter.allow("192.0.2.1", now) || limiter.allow("192.0.2.1", now) {
		t.Fatal("limiter did not enforce its burst limit")
	}
	if !limiter.allow("192.0.2.2", now) {
		t.Fatal("limiter incorrectly shared quota between IP addresses")
	}
}

func TestEphemeralCustomerDoesNotPersist(t *testing.T) {
	app := newTestApplication(t)
	app.publicBaseURL = "http://127.0.0.1:4186"
	body := `{"customer":"临时客户","base_url":"http://127.0.0.1:4190/v1","api_key":"temporary-test-key","model":"test-model","restart":false}`
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:4186/admin/ephemeral", strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("Authorization", "Bearer test-admin-token")
	response := httptest.NewRecorder()
	app.routes().ServeHTTP(response, req)
	if response.Code != http.StatusCreated {
		t.Fatalf("provision: %d %s", response.Code, response.Body.String())
	}
	var created struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if payload, found := app.store.lookup(created.Token); !found || payload.APIKey != "temporary-test-key" {
		t.Fatal("ephemeral lookup failed")
	}
	if _, err := os.Stat(app.store.path); !os.IsNotExist(err) {
		t.Fatal("temporary credential was persisted to disk")
	}
	app.store.mu.Lock()
	entry := app.store.ephemeral[created.Token]
	entry.expires = time.Now().Add(-time.Second)
	app.store.ephemeral[created.Token] = entry
	app.store.mu.Unlock()
	if _, found := app.store.lookup(created.Token); found {
		t.Fatal("expired customer remains readable")
	}
	if !strings.Contains(windowsInstallScript("http://127.0.0.1:4186/api/tasks/id/config"), `WB_PAYLOAD=`) {
		t.Fatal("local install script lacks sandbox guard")
	}
}

func TestExternalModelsAndTask(t *testing.T) {
	app := newTestApplication(t)
	code := createTestCustomer(t, app)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer external-test-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": []map[string]string{{"id": "external-model"}}})
	}))
	defer server.Close()
	lookup := request(app, http.MethodPost, "http://service.local/api/models", `{"activation_code":"`+code+`","base_url":"`+server.URL+`/v1","api_key":"external-test-secret"}`, false)
	if lookup.Code != http.StatusOK || strings.Contains(lookup.Body.String(), "external-test-secret") || !strings.Contains(lookup.Body.String(), "external-model") {
		t.Fatalf("external lookup: %d %s", lookup.Code, lookup.Body.String())
	}
	var catalog struct {
		SourceToken string `json:"source_token"`
	}
	if err := json.Unmarshal(lookup.Body.Bytes(), &catalog); err != nil || catalog.SourceToken == "" {
		t.Fatal("missing source token")
	}
	task := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"external-model","clients":["WorkBuddy"],"source_token":"`+catalog.SourceToken+`","platform":"windows"}`, false)
	if task.Code != http.StatusCreated || strings.Contains(task.Body.String(), "external-test-secret") {
		t.Fatalf("external task: %d %s", task.Code, task.Body.String())
	}
	var created struct {
		TaskID string `json:"task_id"`
	}
	_ = json.Unmarshal(task.Body.Bytes(), &created)
	configResponse := request(app, http.MethodGet, "http://service.local/api/tasks/"+created.TaskID+"/config", "", false)
	var payload config.Payload
	_ = json.Unmarshal(configResponse.Body.Bytes(), &payload)
	if payload.APIKey != "external-test-secret" || payload.Model != "external-model" {
		t.Fatal("incorrect external setup configuration")
	}
	invalid := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"not-listed","clients":["WorkBuddy"],"source_token":"`+catalog.SourceToken+`"}`, false)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("accepted unlisted model: %d", invalid.Code)
	}
	standalone := request(app, http.MethodPost, "http://service.local/api/models", `{"base_url":"`+server.URL+`/v1","api_key":"external-test-secret"}`, false)
	if standalone.Code != http.StatusOK || strings.Contains(standalone.Body.String(), "external-test-secret") {
		t.Fatalf("standalone external lookup: %d %s", standalone.Code, standalone.Body.String())
	}
	var standaloneCatalog struct {
		ActivationCode string `json:"activation_code"`
		SourceToken    string `json:"source_token"`
	}
	if err := json.Unmarshal(standalone.Body.Bytes(), &standaloneCatalog); err != nil || !validToken(standaloneCatalog.ActivationCode) || standaloneCatalog.SourceToken == "" {
		t.Fatalf("standalone external authorization missing: %s", standalone.Body.String())
	}
	standaloneTask := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+standaloneCatalog.ActivationCode+`","model":"external-model","clients":["WorkBuddy"],"source_token":"`+standaloneCatalog.SourceToken+`","platform":"windows"}`, false)
	if standaloneTask.Code != http.StatusCreated || strings.Contains(standaloneTask.Body.String(), "external-test-secret") {
		t.Fatalf("standalone external task: %d %s", standaloneTask.Code, standaloneTask.Body.String())
	}
}

func TestTaskCarriesMultipleModelsAndDefault(t *testing.T) {
	app := newTestApplication(t)
	code := createTestCustomer(t, app)
	created := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"another-model","models":["test-model","another-model"],"clients":["WorkBuddy"],"platform":"windows"}`, false)
	if created.Code != http.StatusCreated {
		t.Fatalf("multi-model task: %d %s", created.Code, created.Body.String())
	}
	var task struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &task); err != nil {
		t.Fatal(err)
	}
	response := request(app, http.MethodGet, "http://service.local/api/tasks/"+task.TaskID+"/config", "", false)
	var payload config.Payload
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Model != "another-model" || len(payload.Models) != 2 || payload.Models[0].ID != "test-model" || payload.Models[1].ID != "another-model" {
		t.Fatalf("task payload lost selected/default models: %+v", payload)
	}
	invalid := request(app, http.MethodPost, "http://service.local/api/tasks", `{"activation_code":"`+code+`","model":"test-model","models":["test-model","not-listed"],"clients":["WorkBuddy"]}`, false)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("accepted an unlisted model in multi-select: %d", invalid.Code)
	}
}

func TestExternalURLRestrictions(t *testing.T) {
	for _, raw := range []string{"http://169.254.169.254/v1", "https://127.0.0.1/v1", "https://example.com:8080/v1", "https://user:secret@example.com/v1", "https://example.com/v1?x=y", "https://example.com/%2e%2e"} {
		if _, err := validateModelURL(raw, false); err == nil {
			t.Errorf("accepted unsafe URL %q", raw)
		}
	}
	if safeAddress(net.ParseIP("10.0.0.1"), false) || safeAddress(net.ParseIP("127.0.0.1"), false) {
		t.Fatal("accepted local IP")
	}
}
