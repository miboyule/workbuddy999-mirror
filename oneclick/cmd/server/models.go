package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"newapi-oneclick/internal/config"
)

type temporarySource struct {
	ActivationCode string
	BaseURL        string
	APIKey         string
	Models         []config.ModelOption
	ExpiresAt      time.Time
}

type externalModelsRequest struct {
	ActivationCode string `json:"activation_code"`
	BaseURL        string `json:"base_url"`
	APIKey         string `json:"api_key"`
}

type modelCheckRequest struct {
	ActivationCode string `json:"activation_code"`
	SourceToken    string `json:"source_token,omitempty"`
	Model          string `json:"model"`
}

func (a *application) localTestMode() bool {
	parsed, err := url.Parse(a.publicBaseURL)
	return a.modelTestLocal || (err == nil && parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()))
}

func validateModelURL(raw string, allowLocal bool) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.RawPath != "" || strings.ContainsAny(raw, "\\\r\n\t") || len(raw) > 512 {
		return nil, errors.New("API 地址格式无效")
	}
	if parsed.Scheme != "https" && !(allowLocal && parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return nil, errors.New("第三方 API 仅支持 HTTPS")
	}
	if parsed.Port() != "" && parsed.Port() != "443" && !(allowLocal && isLoopbackHost(parsed.Hostname())) {
		return nil, errors.New("不支持此 API 端口")
	}
	if address := net.ParseIP(parsed.Hostname()); address != nil && !safeAddress(address, allowLocal) {
		return nil, errors.New("API 地址不允许访问内网")
	}
	if strings.Contains(parsed.Path, "..") || strings.Contains(parsed.Path, "%") || strings.Contains(parsed.Hostname(), "%") || strings.HasSuffix(parsed.Hostname(), ".") {
		return nil, errors.New("API 地址包含无效路径或主机")
	}
	return parsed, nil
}

func safeAddress(address net.IP, allowLocal bool) bool {
	if allowLocal && address.IsLoopback() {
		return true
	}
	return address.IsGlobalUnicast() && !address.IsPrivate() && !address.IsLoopback() && !address.IsLinkLocalUnicast() && !address.IsLinkLocalMulticast() && !address.IsUnspecified()
}

func fetchModels(ctx context.Context, baseURL, apiKey string, allowLocal bool) ([]config.ModelOption, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	client, err := modelHTTPClient(ctx, baseURL, allowLocal)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/models"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, errors.New("模型地址无效")
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("连接模型 API 失败")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return nil, errors.New("API Key 无效或没有模型列表权限")
	}
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("模型 API 未返回有效列表")
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result); err != nil {
		return nil, errors.New("模型 API 响应格式无效")
	}
	models := make([]config.ModelOption, 0, len(result.Data))
	seen := make(map[string]bool)
	for _, item := range result.Data {
		if item.ID == "" || len(item.ID) > 200 || strings.ContainsAny(item.ID, "\r\n") || seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		models = append(models, config.ModelOption{ID: item.ID, DisplayName: item.ID, Status: "listed"})
		if len(models) >= 200 {
			break
		}
	}
	if len(models) == 0 {
		return nil, errors.New("此密钥没有可见模型")
	}
	return models, nil
}

func decorateModels(models, defaults []config.ModelOption, preferred string) []config.ModelOption {
	byID := make(map[string]config.ModelOption, len(defaults))
	for _, model := range defaults {
		byID[model.ID] = model
	}
	for index := range models {
		known, ok := byID[models[index].ID]
		if !ok {
			known, ok = byID[strings.TrimPrefix(models[index].ID, "cn:")]
		}
		if ok {
			models[index].DisplayName = known.DisplayName
			models[index].Description = known.Description
			models[index].LatencyMS = known.LatencyMS
			models[index].PopularityRank = known.PopularityRank
			models[index].PopularityStars = known.PopularityStars
			models[index].SpeedStars = known.SpeedStars
			models[index].SampleCount = known.SampleCount
			models[index].RankingDays = known.RankingDays
			models[index].Recommended = known.Recommended && models[index].ID == known.ID
		}
		if models[index].ID == preferred {
			models[index].Recommended = true
		}
	}
	return models
}

func (a *application) handleExternalModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !sameOriginRequest(r) {
		writeError(w, http.StatusForbidden, "跨站模型请求被拒绝")
		return
	}
	var input externalModelsRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		writeError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	if (input.ActivationCode != "" && !validToken(input.ActivationCode)) || len(input.APIKey) == 0 || len(input.APIKey) > 4096 || strings.ContainsAny(input.APIKey, "\r\n") {
		writeError(w, http.StatusBadRequest, "请填写有效的 API 地址与 API Key")
		return
	}
	if input.ActivationCode != "" {
		if _, ok := a.store.lookup(input.ActivationCode); !ok {
			writeError(w, http.StatusNotFound, "激活码无效或已撤销")
			return
		}
	}
	models, err := fetchModels(r.Context(), input.BaseURL, input.APIKey, a.localTestMode())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	token, err := newOpaqueToken(24)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "无法生成临时授权")
		return
	}
	activationCode := input.ActivationCode
	if activationCode == "" {
		payload := config.Payload{
			SchemaVersion: config.SchemaVersion,
			Customer:      "第三方站点用户",
			BaseURL:       input.BaseURL,
			APIKey:        input.APIKey,
			Model:         models[0].ID,
			DisplayName:   models[0].DisplayName,
			ProviderName:  "自定义供应商",
			Models:        models,
			Verify:        true,
			Restart:       true,
		}
		var err error
		activationCode, err = a.store.createEphemeral(payload)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "无法创建第三方临时授权")
			return
		}
	}
	a.taskMu.Lock()
	for key, source := range a.sources {
		if time.Now().After(source.ExpiresAt) {
			delete(a.sources, key)
		}
	}
	a.sources[token] = temporarySource{ActivationCode: activationCode, BaseURL: input.BaseURL, APIKey: input.APIKey, Models: append([]config.ModelOption(nil), models...), ExpiresAt: time.Now().Add(10 * time.Minute)}
	a.taskMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"models": models, "source_token": token, "activation_code": activationCode})
}

func (a *application) handleModelCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !sameOriginRequest(r) {
		writeError(w, http.StatusForbidden, "跨站检测请求被拒绝")
		return
	}
	var input modelCheckRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF || !validToken(input.ActivationCode) || input.Model == "" {
		writeError(w, http.StatusBadRequest, "检测请求格式无效")
		return
	}
	payload, found := a.store.lookup(input.ActivationCode)
	if !found {
		writeError(w, http.StatusNotFound, "激活码无效")
		return
	}
	var cachedSource []config.ModelOption
	if input.SourceToken != "" {
		a.taskMu.Lock()
		source, ok := a.sources[input.SourceToken]
		a.taskMu.Unlock()
		if !ok || source.ActivationCode != input.ActivationCode || time.Now().After(source.ExpiresAt) {
			writeError(w, http.StatusBadRequest, "第三方临时授权已过期")
			return
		}
		payload.BaseURL, payload.APIKey = source.BaseURL, source.APIKey
		cachedSource = append([]config.ModelOption(nil), source.Models...)
	}
	models := cachedSource
	if len(models) == 0 && input.SourceToken == "" {
		models, _ = a.cachedModels(input.ActivationCode)
	}
	if len(models) == 0 {
		var err error
		models, err = fetchModels(r.Context(), payload.BaseURL, payload.APIKey, a.localTestMode())
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
	}
	listed := false
	for _, model := range models {
		if model.ID == input.Model {
			listed = true
			break
		}
	}
	if !listed {
		writeError(w, http.StatusBadRequest, "模型不在当前密钥的可见列表中")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	client, err := modelHTTPClient(ctx, payload.BaseURL, a.localTestMode())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	body, _ := json.Marshal(map[string]any{"model": input.Model, "messages": []map[string]string{{"role": "user", "content": "Reply OK"}}, "max_tokens": 1, "stream": false})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(payload.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		writeError(w, http.StatusBadRequest, "模型地址无效")
		return
	}
	request.Header.Set("Authorization", "Bearer "+payload.APIKey)
	request.Header.Set("Content-Type", "application/json")
	started := time.Now()
	response, err := client.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "模型生成请求连接失败")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "模型生成请求未成功，HTTP 状态 "+http.StatusText(response.StatusCode))
		return
	}
	var result struct {
		Choices []json.RawMessage `json:"choices"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result) != nil || len(result.Choices) == 0 {
		writeError(w, http.StatusBadGateway, "生成响应缺少 choices")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "latency_ms": time.Since(started).Milliseconds()})
}

func modelHTTPClient(ctx context.Context, baseURL string, allowLocal bool) (*http.Client, error) {
	parsed, err := validateModelURL(baseURL, allowLocal)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, parsed.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("无法解析 API 主机")
	}
	for _, address := range addresses {
		if !safeAddress(address.IP, allowLocal) || (address.IP.IsLoopback() && !isLoopbackHost(parsed.Hostname())) {
			return nil, errors.New("API 地址不允许访问内网")
		}
	}
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(addresses[0].IP.String(), port))
	}}
	return &http.Client{Timeout: 12 * time.Second, Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}, nil
}
