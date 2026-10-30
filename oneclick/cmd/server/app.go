package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"newapi-oneclick/internal/config"
)

const (
	maxRequestBody      = 1 << 20
	maxAdminRequestBody = 64 << 10
)

type applicationConfig struct {
	PublicBaseURL string
	CustomersFile string
	AdminToken    string
	LocalFixtures bool
}

type application struct {
	publicBaseURL  string
	adminToken     string
	store          *customerStore
	landing        *template.Template
	binaryDir      string
	limiter        *ipLimiter
	taskMu         sync.Mutex
	tasks          map[string]installTask
	sources        map[string]temporarySource
	modelCache     map[string]modelCacheEntry
	modelTestLocal bool
	localFixtures  bool
}

type modelCacheEntry struct {
	Models    []config.ModelOption
	ExpiresAt time.Time
}

type landingData struct {
	ActivationCode string
	Customer       string
	ProviderName   string
	DisplayName    string
	SessionURL     string
	TaskURL        string
}

type clientOption struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	Automatic   bool   `json:"automatic"`
}

var supportedClientOptions = []clientOption{
	{ID: "WorkBuddy", DisplayName: "WorkBuddy", Description: "自动写入并重启", Automatic: true},
	{ID: "CodeBuddy", DisplayName: "CodeBuddy", Description: "自动写入并重启", Automatic: true},
	{ID: "ZCode", DisplayName: "ZCode", Description: "自动写入并重启", Automatic: true},
	{ID: "DSH", DisplayName: "DSH", Description: "自动写入并重启", Automatic: true},
	{ID: "Hermes", DisplayName: "Hermes", Description: "自动写入并重启", Automatic: true},
	{ID: "TRAE", DisplayName: "TraeWork", Description: "生成手动配置说明", Automatic: false},
}

type publicSession struct {
	ActivationCode string               `json:"activation_code"`
	Customer       string               `json:"customer"`
	ProviderName   string               `json:"provider_name"`
	Models         []config.ModelOption `json:"models"`
	Clients        []clientOption       `json:"clients"`
}

type createTaskRequest struct {
	ActivationCode string   `json:"activation_code"`
	Model          string   `json:"model"`
	Models         []string `json:"models,omitempty"`
	Clients        []string `json:"clients"`
	SourceToken    string   `json:"source_token,omitempty"`
	Platform       string   `json:"platform,omitempty"`
	InstallMode    string   `json:"install_mode,omitempty"`
	CleanInstall   bool     `json:"clean_install,omitempty"`
}

type installTask struct {
	Payload   config.Payload
	Mode      string
	Result    *installOutcome
	CreatedAt time.Time
	ExpiresAt time.Time
	Fetches   int
}

type installOutcome struct {
	Success          bool                  `json:"success"`
	Mode             string                `json:"mode"`
	CleanInstall     bool                  `json:"clean_install"`
	Model            string                `json:"model"`
	Results          []clientInstallResult `json:"results,omitempty"`
	RestartAttempted bool                  `json:"restart_attempted"`
	Restarted        []string              `json:"restarted"`
	BackupDir        string                `json:"backup_dir,omitempty"`
}

type clientInstallResult struct {
	Client string `json:"client"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func newApplication(cfg applicationConfig) (*application, error) {
	baseURL := strings.TrimRight(cfg.PublicBaseURL, "/")
	if baseURL != "" {
		u, err := url.Parse(baseURL)
		if err != nil || u.Host == "" || (u.Scheme != "https" && (u.Scheme != "http" || !isLoopbackHost(u.Hostname()))) || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !safeBaseURL(baseURL) {
			return nil, errors.New("PUBLIC_BASE_URL 必须是有效的 http(s) 地址，且不能包含查询参数、片段或转义字符")
		}
	}
	store, err := openCustomerStore(cfg.CustomersFile)
	if err != nil {
		return nil, err
	}
	landingPath, err := locatePublicFile("index.html")
	if err != nil {
		return nil, err
	}
	landing, err := template.ParseFiles(landingPath)
	if err != nil {
		return nil, fmt.Errorf("解析落地页模板: %w", err)
	}
	return &application{
		publicBaseURL: baseURL,
		adminToken:    cfg.AdminToken,
		store:         store,
		landing:       landing,
		binaryDir:     filepath.Dir(landingPath),
		limiter:       newIPLimiter(2, 60), // 每秒补充 2 个，最多突发 60 次。
		tasks:         make(map[string]installTask),
		sources:       make(map[string]temporarySource),
		modelCache:    make(map[string]modelCacheEntry),
		localFixtures: cfg.LocalFixtures,
	}, nil
}

func locatePublicFile(name string) (string, error) {
	candidates := []string{
		filepath.Join("public", name),
		filepath.Join("..", "..", "public", name),
	}
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), "public", name))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("找不到 public/%s", name)
}

func (a *application) routes() http.Handler {
	return a.securityHeaders(a.limitRequests(a.limitBody(http.HandlerFunc(a.serveHTTP))))
}

func (a *application) serveHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/setup/" || r.URL.Path == "/setup":
		a.requireMethod(w, r, http.MethodGet, a.handleSetup)
	case r.URL.Path == "/brand/clients/workbuddy.svg":
		a.requireMethod(w, r, http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "image/svg+xml")
			http.ServeFile(w, r, filepath.Join(a.binaryDir, "workbuddy.svg"))
		})
	case r.URL.Path == "/healthz":
		a.requireMethod(w, r, http.MethodGet, a.handleHealth)
	case r.URL.Path == "/admin/customers":
		a.requireMethod(w, r, http.MethodPost, a.handleCreateCustomer)
	case r.URL.Path == "/admin/ephemeral":
		a.requireMethod(w, r, http.MethodPost, a.handleCreateCustomer)
	case strings.HasPrefix(r.URL.Path, "/i/"):
		a.requireMethod(w, r, http.MethodGet, a.handleLanding)
	case strings.HasPrefix(r.URL.Path, "/api/session/"):
		a.requireMethod(w, r, http.MethodGet, a.handleSession)
	case r.URL.Path == "/api/tasks":
		a.requireMethod(w, r, http.MethodPost, a.handleCreateTask)
	case r.URL.Path == "/api/models":
		a.requireMethod(w, r, http.MethodPost, a.handleExternalModels)
	case r.URL.Path == "/api/model-check":
		a.requireMethod(w, r, http.MethodPost, a.handleModelCheck)
	case strings.HasPrefix(r.URL.Path, "/api/tasks/"):
		if strings.HasSuffix(r.URL.Path, "/result") {
			switch r.Method {
			case http.MethodGet, http.MethodPost:
				a.handleTaskResult(w, r)
			default:
				writeError(w, http.StatusMethodNotAllowed, "请求方法不允许")
			}
		} else {
			a.requireMethod(w, r, http.MethodGet, a.handleTaskConfig)
		}
	case strings.HasPrefix(r.URL.Path, "/download/task/"):
		a.requireMethod(w, r, http.MethodGet, a.handleTaskDownload)
	case strings.HasPrefix(r.URL.Path, "/bin/"):
		a.requireMethod(w, r, http.MethodGet, a.handleBinary)
	default:
		http.NotFound(w, r)
	}
}

func (a *application) requireMethod(w http.ResponseWriter, r *http.Request, method string, handler http.HandlerFunc) {
	if r.Method != method {
		w.Header().Set("Allow", method)
		if r.Method == http.MethodHead && method == http.MethodGet {
			handler(w, r)
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "请求方法不允许")
		return
	}
	handler(w, r)
}

func (a *application) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *application) handleLanding(w http.ResponseWriter, r *http.Request) {
	token, ok := pathToken(r.URL.Path, "/i/")
	if !ok {
		http.NotFound(w, r)
		return
	}
	payload, ok := a.store.lookup(token)
	if !ok {
		http.NotFound(w, r)
		return
	}
	payload.Defaults()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	data := landingData{
		ActivationCode: token,
		Customer:       payload.Customer,
		ProviderName:   payload.ProviderName,
		DisplayName:    payload.DisplayName,
		SessionURL:     "/api/session/" + token,
		TaskURL:        "/api/tasks",
	}
	if err := a.landing.ExecuteTemplate(w, "index.html", data); err != nil {
		// ExecuteTemplate may already have written part of the response.
		return
	}
}

func (a *application) handleSetup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = a.landing.ExecuteTemplate(w, "index.html", landingData{ProviderName: "WBAI微:36612995", TaskURL: "/api/tasks"})
}

func (a *application) handleSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	token, ok := pathToken(r.URL.Path, "/api/session/")
	if !ok {
		writeError(w, http.StatusNotFound, "激活码无效")
		return
	}
	payload, ok := a.store.lookup(token)
	if !ok {
		writeError(w, http.StatusNotFound, "激活码无效或已撤销")
		return
	}
	payload.Defaults()
	if a.localFixtures && a.localTestMode() && len(payload.Models) > 0 {
		models := decorateModels(payload.Models, payload.Models, payload.Model)
		a.cacheModels(token, models)
		writeJSON(w, http.StatusOK, publicSession{
			ActivationCode: token, Customer: payload.Customer, ProviderName: payload.ProviderName,
			Models: models, Clients: supportedClientOptions,
		})
		return
	}
	models, err := fetchModels(r.Context(), payload.BaseURL, payload.APIKey, a.localTestMode())
	if err != nil {
		writeError(w, http.StatusBadGateway, "无法读取平台实时模型列表："+err.Error())
		return
	}
	models = decorateModels(models, payload.Models, payload.Model)
	a.cacheModels(token, models)
	writeJSON(w, http.StatusOK, publicSession{
		ActivationCode: token,
		Customer:       payload.Customer,
		ProviderName:   payload.ProviderName,
		Models:         models,
		Clients:        supportedClientOptions,
	})
}

func (a *application) cacheModels(activationCode string, models []config.ModelOption) {
	copyModels := append([]config.ModelOption(nil), models...)
	a.taskMu.Lock()
	a.modelCache[activationCode] = modelCacheEntry{Models: copyModels, ExpiresAt: time.Now().Add(10 * time.Minute)}
	a.taskMu.Unlock()
}

func (a *application) cachedModels(activationCode string) ([]config.ModelOption, bool) {
	a.taskMu.Lock()
	entry, found := a.modelCache[activationCode]
	if found && time.Now().After(entry.ExpiresAt) {
		delete(a.modelCache, activationCode)
		found = false
	}
	a.taskMu.Unlock()
	if !found {
		return nil, false
	}
	return append([]config.ModelOption(nil), entry.Models...), true
}

func (a *application) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !sameOriginRequest(r) {
		writeError(w, http.StatusForbidden, "跨站任务请求被拒绝")
		return
	}
	var request createTaskRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "任务请求无效")
		return
	}
	if !validToken(request.ActivationCode) || request.Model == "" || len(request.Clients) == 0 {
		writeError(w, http.StatusBadRequest, "请提供有效激活码、默认模型和至少一个客户端")
		return
	}
	payload, ok := a.store.lookup(request.ActivationCode)
	if !ok {
		writeError(w, http.StatusNotFound, "激活码无效或已撤销")
		return
	}
	payload.Defaults()
	var sourceModels []config.ModelOption
	var err error
	if request.SourceToken != "" {
		a.taskMu.Lock()
		source, found := a.sources[request.SourceToken]
		a.taskMu.Unlock()
		if !found || source.ActivationCode != request.ActivationCode || time.Now().After(source.ExpiresAt) {
			writeError(w, http.StatusBadRequest, "第三方站点授权已过期，请重新读取模型")
			return
		}
		payload.BaseURL, payload.APIKey, payload.ProviderName = source.BaseURL, source.APIKey, "自定义供应商"
		sourceModels = append([]config.ModelOption(nil), source.Models...)
	}
	models := sourceModels
	if len(models) == 0 && request.SourceToken == "" {
		models, _ = a.cachedModels(request.ActivationCode)
	}
	if len(models) == 0 {
		models, err = fetchModels(r.Context(), payload.BaseURL, payload.APIKey, a.localTestMode())
		if err != nil {
			writeError(w, http.StatusBadGateway, "无法确认当前模型授权："+err.Error())
			return
		}
	}
	if request.SourceToken == "" {
		models = decorateModels(models, payload.Models, payload.Model)
	}
	selectedIDs := request.Models
	if len(selectedIDs) == 0 {
		selectedIDs = []string{request.Model}
	}
	selectedSet := make(map[string]bool, len(selectedIDs))
	for _, id := range selectedIDs {
		if id == "" || selectedSet[id] {
			continue
		}
		selectedSet[id] = true
	}
	var selectedModel *config.ModelOption
	selectedModels := make([]config.ModelOption, 0, len(selectedSet))
	for i := range models {
		if models[i].ID == request.Model {
			selectedModel = &models[i]
		}
		if selectedSet[models[i].ID] {
			selectedModels = append(selectedModels, models[i])
		}
	}
	if selectedModel == nil || len(selectedModels) == 0 || len(selectedModels) != len(selectedSet) {
		writeError(w, http.StatusBadRequest, "所选模型不可用或不在当前授权范围内")
		return
	}
	allowedClients := make(map[string]bool, len(supportedClientOptions))
	for _, client := range supportedClientOptions {
		allowedClients[client.ID] = true
	}
	selectedClients := make([]string, 0, len(request.Clients))
	for _, client := range request.Clients {
		if !allowedClients[client] {
			writeError(w, http.StatusBadRequest, "包含不支持的客户端")
			return
		}
		selectedClients = append(selectedClients, client)
	}
	payload.Model = selectedModel.ID
	payload.DisplayName = selectedModel.DisplayName
	payload.Clients = selectedClients
	payload.Models = selectedModels
	payload.CleanInstall = request.CleanInstall
	if request.Platform != "" && request.Platform != "windows" && request.Platform != "macos" {
		writeError(w, http.StatusBadRequest, "操作系统选项无效")
		return
	}
	mode := request.InstallMode
	if mode == "" {
		mode = "sandbox"
	}
	if mode != "sandbox" && mode != "real" {
		writeError(w, http.StatusBadRequest, "安装模式无效")
		return
	}
	payload.Restart = mode == "real"
	taskID, err := newOpaqueToken(18)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成配置任务失败")
		return
	}
	now := time.Now().UTC()
	taskLifetime := 24 * time.Hour
	a.taskMu.Lock()
	a.tasks[taskID] = installTask{Payload: payload, Mode: mode, CreatedAt: now, ExpiresAt: now.Add(taskLifetime)}
	a.taskMu.Unlock()
	base := a.baseURL(r)
	writeJSON(w, http.StatusCreated, map[string]string{
		"task_id":              taskID,
		"expires_at":           now.Add(taskLifetime).Format(time.RFC3339),
		"download_cmd_url":     base + "/download/task/" + taskID + "/cmd",
		"download_command_url": base + "/download/task/" + taskID + "/command",
	})
}

func (a *application) handleTaskConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/tasks/"), "/")
	if len(parts) != 2 || parts[1] != "config" || !validToken(parts[0]) {
		writeError(w, http.StatusNotFound, "任务不存在")
		return
	}
	taskID := parts[0]
	a.taskMu.Lock()
	task, ok := a.tasks[taskID]
	if !ok {
		a.taskMu.Unlock()
		writeError(w, http.StatusNotFound, "任务不存在")
		return
	}
	if time.Now().UTC().After(task.ExpiresAt) || task.Fetches >= 3 {
		delete(a.tasks, taskID)
		a.taskMu.Unlock()
		writeError(w, http.StatusGone, "配置任务已过期或使用次数已达上限")
		return
	}
	if ok {
		task.Fetches++
		a.tasks[taskID] = task
	}
	a.taskMu.Unlock()
	if err := task.Payload.Validate(); err != nil {
		writeError(w, http.StatusInternalServerError, "配置任务内容无效")
		return
	}
	writeJSON(w, http.StatusOK, task.Payload)
}

func (a *application) handleTaskResult(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/tasks/"), "/")
	if len(parts) != 2 || parts[1] != "result" || !validToken(parts[0]) {
		writeError(w, http.StatusNotFound, "任务不存在")
		return
	}
	if r.Method == http.MethodPost && !sameOriginRequest(r) {
		writeError(w, http.StatusForbidden, "跨站请求被拒绝")
		return
	}
	a.taskMu.Lock()
	task, found := a.tasks[parts[0]]
	if !found || time.Now().After(task.ExpiresAt) {
		a.taskMu.Unlock()
		writeError(w, http.StatusNotFound, "任务不存在或已过期")
		return
	}
	if r.Method == http.MethodGet {
		a.taskMu.Unlock()
		if task.Result == nil {
			writeJSON(w, http.StatusOK, map[string]string{"status": "pending"})
		} else {
			writeJSON(w, http.StatusOK, map[string]any{"status": "completed", "result": task.Result})
		}
		return
	}
	a.taskMu.Unlock()
	var result installOutcome
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || !errors.Is(decoder.Decode(&struct{}{}), io.EOF) {
		writeError(w, http.StatusBadRequest, "安装结果格式无效")
		return
	}
	if result.Mode != task.Mode || (result.Model != "" && result.Model != task.Payload.Model) || (result.Success && result.Model == "") || len(result.BackupDir) > 2048 || len(result.Restarted) > 20 || len(result.Results) > 40 || (result.Mode == "sandbox" && (result.RestartAttempted || len(result.Restarted) > 0)) {
		writeError(w, http.StatusBadRequest, "安装结果格式无效")
		return
	}
	for _, item := range result.Results {
		if len(item.Client) > 100 || len(item.Status) > 40 || len(item.Detail) > 1000 {
			writeError(w, http.StatusBadRequest, "安装结果格式无效")
			return
		}
	}
	a.taskMu.Lock()
	task, found = a.tasks[parts[0]]
	if !found || time.Now().After(task.ExpiresAt) {
		a.taskMu.Unlock()
		writeError(w, http.StatusNotFound, "任务不存在或已过期")
		return
	}
	task.Result = &result
	a.tasks[parts[0]] = task
	a.taskMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]string{"status": "received"})
}

func (a *application) handleTaskDownload(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "download" || parts[1] != "task" || !validToken(parts[2]) {
		http.NotFound(w, r)
		return
	}
	a.taskMu.Lock()
	task, ok := a.tasks[parts[2]]
	a.taskMu.Unlock()
	if !ok || time.Now().UTC().After(task.ExpiresAt) {
		http.NotFound(w, r)
		return
	}
	base := a.baseURL(r)
	if !safeBaseURL(base) {
		writeError(w, http.StatusBadRequest, "请求主机无效")
		return
	}
	configURL := base + "/api/tasks/" + parts[2] + "/config"
	w.Header().Set("Cache-Control", "no-store")
	switch parts[3] {
	case "cmd":
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", taskFilename(task.Mode, "windows"))
		_, _ = io.WriteString(w, strings.ReplaceAll(windowsInstallScriptMode(configURL, task.Mode), "\n", "\r\n"))
	case "command":
		w.Header().Set("Content-Type", "application/x-sh; charset=utf-8")
		w.Header().Set("Content-Disposition", taskFilename(task.Mode, "macos"))
		_, _ = io.WriteString(w, macInstallScriptMode(configURL, task.Mode))
	default:
		http.NotFound(w, r)
	}
}

func (a *application) handleBinary(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/bin/")
	switch name {
	case "releases.json", "SHA256SUMS.txt",
		"setup-windows-amd64.exe", "setup-windows-arm64.exe", "setup-darwin-amd64", "setup-darwin-arm64",
		"setup-windows-amd64.exe.zip", "setup-windows-arm64.exe.zip", "setup-darwin-amd64.gz", "setup-darwin-arm64.gz",
		"setup-windows-amd64.exe.zip.sha256", "setup-windows-arm64.exe.zip.sha256", "setup-darwin-amd64.gz.sha256", "setup-darwin-arm64.gz.sha256":
	default:
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(filepath.Join(a.binaryDir, "bin", name))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	if name == "releases.json" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
	}
	if strings.HasSuffix(name, ".sha256") || name == "SHA256SUMS.txt" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	http.ServeContent(w, r, name, info.ModTime(), file)
}

func (a *application) handleCreateCustomer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if a.adminToken == "" {
		writeError(w, http.StatusServiceUnavailable, "管理接口未启用")
		return
	}
	authorization := r.Header.Get("Authorization")
	provided := strings.TrimPrefix(authorization, "Bearer ")
	if provided == authorization || subtle.ConstantTimeCompare([]byte(provided), []byte(a.adminToken)) != 1 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="admin"`)
		writeError(w, http.StatusUnauthorized, "未授权")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAdminRequestBody)
	var payload config.Payload
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "请求 JSON 无效或超过大小限制")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "请求只能包含一个 JSON 对象")
		return
	}
	payload.Defaults()
	if len(payload.Customer) > 200 || len(payload.DisplayName) > 200 || len(payload.ProviderName) > 200 || len(payload.Clients) > 50 {
		writeError(w, http.StatusBadRequest, "客户字段过长")
		return
	}
	if err := payload.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	base := a.baseURL(r)
	if !safeBaseURL(base) {
		writeError(w, http.StatusBadRequest, "请求主机无效")
		return
	}
	var token string
	var err error
	if r.URL.Path == "/admin/ephemeral" {
		if !isLoopbackHost(clientIP(r.RemoteAddr)) {
			writeError(w, http.StatusForbidden, "仅支持本地服务调用")
			return
		}
		token, err = a.store.createEphemeral(payload)
	} else {
		token, err = a.store.create(payload)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "保存客户失败")
		return
	}
	installURL := base + "/i/" + token
	writeJSON(w, http.StatusCreated, map[string]any{
		"token":           token,
		"activation_code": token,
		"activation_url":  installURL,
		"delivery_url":    installURL,
	})
}

func pathToken(path, prefix string) (string, bool) {
	token := strings.TrimPrefix(path, prefix)
	if token == path || !validToken(token) || strings.Contains(token, "/") {
		return "", false
	}
	return token, true
}

func validToken(token string) bool {
	if len(token) == 0 || len(token) > 128 {
		return false
	}
	for _, c := range token {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' {
			continue
		}
		return false
	}
	return true
}

func newOpaqueToken(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func safeBaseURL(value string) bool {
	if value == "" {
		return false
	}
	for _, c := range value {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			continue
		}
		switch c {
		case ':', '/', '-', '.', '_', '~', '[', ']':
			continue
		}
		return false
	}
	return true
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func (a *application) baseURL(r *http.Request) string {
	if a.publicBaseURL != "" {
		return a.publicBaseURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func sameOriginRequest(r *http.Request) bool {
	if r.Header.Get("X-Portal-Origin-Validated") == "1" {
		return true
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil {
			return false
		}
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		} else if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]); forwarded != "" {
			scheme = strings.ToLower(forwarded)
		}
		sameScheme := parsed.Scheme == scheme
		if !sameScheme {
			return false
		}
		if strings.EqualFold(parsed.Host, r.Host) {
			return true
		}
		// The local portal hands the browser from port 8787 to a temporary
		// loopback port. Browsers can retain the original Origin and mark the
		// request cross-site even though both ends are local and HTTP-only.
		requestHost := r.Host
		if host, _, splitErr := net.SplitHostPort(r.Host); splitErr == nil {
			requestHost = host
		} else {
			requestHost = strings.Trim(requestHost, "[]")
		}
		return r.TLS == nil && isLoopbackHost(parsed.Hostname()) && isLoopbackHost(requestHost)
	}
	return r.Header.Get("Sec-Fetch-Site") != "cross-site"
}

func (a *application) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (a *application) limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
		}
		next.ServeHTTP(w, r)
	})
}

func (a *application) limitRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.limiter.allow(clientIP(r.RemoteAddr), time.Now()) {
			w.Header().Set("Retry-After", "30")
			writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后重试")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

type ipLimiter struct {
	mu      sync.Mutex
	rate    float64
	burst   float64
	clients map[string]*limiterClient
	lastGC  time.Time
}

type limiterClient struct {
	tokens float64
	last   time.Time
}

func newIPLimiter(rate, burst float64) *ipLimiter {
	return &ipLimiter{rate: rate, burst: burst, clients: make(map[string]*limiterClient)}
}

func (l *ipLimiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.lastGC.IsZero() {
		l.lastGC = now
	} else if now.Sub(l.lastGC) > 5*time.Minute {
		for key, client := range l.clients {
			if now.Sub(client.last) > 10*time.Minute {
				delete(l.clients, key)
			}
		}
		l.lastGC = now
	}
	client := l.clients[ip]
	if client == nil {
		client = &limiterClient{tokens: l.burst, last: now}
		l.clients[ip] = client
	}
	elapsed := now.Sub(client.last).Seconds()
	if elapsed > 0 {
		client.tokens += elapsed * l.rate
		if client.tokens > l.burst {
			client.tokens = l.burst
		}
	}
	client.last = now
	if client.tokens < 1 {
		return false
	}
	client.tokens--
	return true
}
