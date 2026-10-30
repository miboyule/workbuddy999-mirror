package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"newapi-oneclick/internal/config"
)

type result struct {
	Client string `json:"client"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func payloadModels(p config.Payload) []config.ModelOption {
	if len(p.Models) > 0 {
		return p.Models
	}
	return []config.ModelOption{{ID: p.Model, DisplayName: p.DisplayName}}
}

func modelIDs(models []config.ModelOption) []any {
	ids := make([]any, 0, len(models))
	for _, model := range models {
		ids = append(ids, model.ID)
	}
	return ids
}

func mergeStringIDs(existing any, models []config.ModelOption) []any {
	ids, _ := existing.([]any)
	for _, model := range models {
		ids = uniqueAppend(ids, model.ID)
	}
	return ids
}

func mergeProviderModels(existing any, models []config.ModelOption) []any {
	items, _ := existing.([]any)
	for _, model := range models {
		name := model.DisplayName
		if name == "" {
			name = model.ID
		}
		definition := map[string]any{
			"id": model.ID, "name": name, "input": []any{"text", "image"},
		}
		for _, item := range items {
			if old, ok := item.(map[string]any); ok && old["id"] == model.ID {
				for key, value := range old {
					if key != "id" && key != "name" && key != "input" {
						definition[key] = value
					}
				}
				break
			}
		}
		items = upsertByID(items, "id", model.ID, definition)
	}
	return items
}

func mergeNamedModels(existing any, models []config.ModelOption) map[string]any {
	merged, _ := asMap(existing)
	if merged == nil {
		merged = map[string]any{}
	}
	for _, model := range models {
		name := model.ID
		definition := map[string]any{
			"name":       name,
			"limit":      map[string]any{"context": 1000000, "output": 50000},
			"modalities": map[string]any{"input": []any{"text", "image"}, "output": []any{"text"}},
		}
		if old, ok := asMap(merged[model.ID]); ok {
			for key, value := range old {
				if key != "name" && key != "limit" && key != "modalities" {
					definition[key] = value
				}
			}
		}
		merged[model.ID] = definition
	}
	return merged
}

func modelDefinition(p config.Payload, model config.ModelOption) map[string]any {
	name := model.DisplayName
	if name == "" {
		name = model.ID
	}
	return map[string]any{
		"id": model.ID, "name": name, "vendor": "Custom", "url": p.Endpoint(), "apiKey": p.APIKey,
		"useCustomProtocol": false, "supportsToolCall": true, "supportsImages": true, "supportsReasoning": true,
		"maxInputTokens": 1000000, "maxOutputTokens": 50000,
	}
}

func configureModelFamily(s *store, p config.Payload, directory string) error {
	modelsPath := s.path(directory, "models.json")
	fallback := any(map[string]any{"models": []any{}})
	if directory == ".workbuddy" {
		fallback = any([]any{})
	}
	root, err := readJSON(modelsPath, fallback)
	if err != nil {
		return err
	}
	switch value := root.(type) {
	case []any:
		if p.CleanInstall {
			value = nil
		}
		merged, err := mergeFlatModels(value, p)
		if err != nil {
			return err
		}
		root = merged
	case map[string]any:
		existing := arrayValue(value, "models")
		if p.CleanInstall {
			existing = nil
		}
		models, err := mergeFlatModels(existing, p)
		if err != nil {
			return err
		}
		value["models"] = models
		if available, ok := value["availableModels"].([]any); ok {
			if p.CleanInstall {
				available = nil
			}
			for _, model := range payloadModels(p) {
				available = uniqueAppend(available, model.ID)
			}
			value["availableModels"] = available
		}
	default:
		return fmt.Errorf("无法识别的 models.json 结构")
	}
	if err := writeJSON(s, modelsPath, root); err != nil {
		return err
	}

	settingsPath := s.path(directory, "settings.json")
	settingsRoot, err := readJSON(settingsPath, map[string]any{})
	if err != nil {
		return err
	}
	settings, ok := asMap(settingsRoot)
	if !ok {
		return fmt.Errorf("settings.json 顶层必须是对象")
	}
	settings["model"] = p.Model
	variants := mapValue(settings, "variantModels")
	variants["lite"] = p.Model
	variants["reasoning"] = p.Model
	return writeJSON(s, settingsPath, settings)
}

func configureZCode(s *store, p config.Payload) error {
	// Current schema: provider_config.json with an explicit shared default.
	providerID := managedProviderID(p)
	path := s.path(".zcode", "v2", "provider_config.json")
	fallback := map[string]any{
		"schemaVersion": 1,
		"config": map[string]any{
			"providerConfigRules": map[string]any{"providerRules": []any{}},
			"modelConfigRules": map[string]any{
				"providerModelRules":       []any{},
				"manualProviderModelRules": []any{},
			},
		},
	}
	rootValue, err := readJSON(path, fallback)
	if err != nil {
		return err
	}
	root, ok := asMap(rootValue)
	if !ok {
		return fmt.Errorf("ZCode provider_config.json 顶层必须是对象")
	}
	root["schemaVersion"] = 1
	cfg := mapValue(root, "config")
	providerRules := mapValue(cfg, "providerConfigRules")
	existingProviderRule := map[string]any{}
	providerRuleItems := arrayValue(providerRules, "providerRules")
	if !p.CleanInstall {
		for _, item := range providerRuleItems {
			if current, ok := item.(map[string]any); ok && current["providerId"] == providerID {
				existingProviderRule = current
				break
			}
		}
	} else {
		providerRuleItems = nil
	}
	previousConfig, _ := existingProviderRule["config"].(map[string]any)
	personalModelIDs := mergeStringIDs(previousConfig["personalModelIds"], payloadModels(p))
	modelOrder := mergeStringIDs(previousConfig["modelOrder"], payloadModels(p))
	providerConfig := map[string]any{}
	for key, value := range previousConfig {
		providerConfig[key] = value
	}
	providerConfig["group"] = "standard-personal"
	providerConfig["access"] = map[string]any{"type": "api-key", "apiKey": p.APIKey}
	providerConfig["api"] = map[string]any{"type": "openai-chat-completions", "baseUrl": p.BaseURL}
	providerConfig["personalModelIds"] = personalModelIDs
	providerConfig["modelOrder"] = modelOrder
	providerConfig["visibility"] = "visible"
	provider := map[string]any{}
	for key, value := range existingProviderRule {
		provider[key] = value
	}
	provider["providerId"] = providerID
	provider["providerName"] = p.ProviderName
	provider["enabled"] = true
	provider["config"] = providerConfig
	rules := providerRuleItems
	providerRules["providerRules"] = upsertByID(rules, "providerId", providerID, provider)

	modelRules := mapValue(cfg, "modelConfigRules")
	providerModelRules := arrayValue(modelRules, "providerModelRules")
	if p.CleanInstall {
		providerModelRules = nil
	}
	modelRulesToWrite := make([]any, 0, len(providerModelRules)+len(payloadModels(p)))
	selectedIDs := make(map[string]bool)
	for _, model := range payloadModels(p) {
		selectedIDs[model.ID] = true
	}
	for _, item := range providerModelRules {
		m, ok := item.(map[string]any)
		if ok && m["providerId"] == providerID && selectedIDs[fmt.Sprint(m["modelId"])] {
			continue
		}
		modelRulesToWrite = append(modelRulesToWrite, item)
	}
	for _, selected := range payloadModels(p) {
		modelRule := map[string]any{
			"providerId": providerID,
			"modelId":    selected.ID,
			"config": map[string]any{
				"enabled": true,
				"properties": map[string]any{
					"contextWindow": 1000000,
					"inputFormat": map[string]any{
						"supportsText": true, "supportsImage": true,
						"supportsVideo": false, "supportsPdf": false,
					},
					"outputFormat":     map[string]any{"supportsText": true},
					"supportsToolCall": true,
				},
				"optionSpecs": map[string]any{
					"maxOutputTokens": map[string]any{
						"max": 50000, "map": `{"max_tokens": maxOutputTokens}`,
					},
					"reasoningLevel": map[string]any{
						"values": []any{"high"}, "map": `{"reasoning_effort": reasoningLevel}`,
					},
				},
			},
		}
		for _, oldRule := range providerModelRules {
			if old, ok := oldRule.(map[string]any); ok && old["providerId"] == providerID && old["modelId"] == selected.ID {
				oldConfig, _ := old["config"].(map[string]any)
				newConfig := modelRule["config"].(map[string]any)
				for key, value := range oldConfig {
					if key != "enabled" && key != "properties" && key != "optionSpecs" {
						newConfig[key] = value
					}
				}
			}
		}
		modelRulesToWrite = append(modelRulesToWrite, modelRule)
	}
	modelRules["providerModelRules"] = modelRulesToWrite
	if p.CleanInstall {
		modelRules["manualProviderModelRules"] = []any{}
	}
	cfg["defaultModelSelection"] = map[string]any{
		"providerId": providerID, "modelId": p.Model,
		"options": map[string]any{"reasoningLevel": "high"},
	}
	providerOrder := arrayValue(cfg, "providerOrder")
	if p.CleanInstall {
		providerOrder = nil
	}
	cfg["providerOrder"] = uniqueAppend(providerOrder, providerID)
	if err := writeJSON(s, path, root); err != nil {
		return err
	}

	// Legacy schema retained for older ZCode releases.
	legacyPath := s.path(".zcode", "v2", "config.json")
	legacyValue, err := readJSON(legacyPath, map[string]any{})
	if err != nil {
		return err
	}
	legacy, ok := asMap(legacyValue)
	if !ok {
		return fmt.Errorf("ZCode config.json 顶层必须是对象")
	}
	providers := mapValue(legacy, "provider")
	if p.CleanInstall {
		providers = map[string]any{}
		legacy["provider"] = providers
	}
	existingProvider, _ := providers[providerID].(map[string]any)
	legacyProvider := existingProvider
	legacyModels := map[string]any{}
	if existingProvider != nil {
		legacyModels = mergeNamedModels(existingProvider["models"], nil)
	}
	for _, model := range payloadModels(p) {
		legacyModels = mergeNamedModels(legacyModels, []config.ModelOption{model})
	}
	legacyProvider = existingProvider
	if legacyProvider == nil {
		legacyProvider = map[string]any{}
	}
	legacyProvider["name"] = p.ProviderName
	legacyProvider["kind"] = "openai-compatible"
	legacyProvider["options"] = map[string]any{"apiKey": p.APIKey, "baseURL": p.BaseURL, "apiKeyRequired": true}
	legacyProvider["enabled"] = true
	legacyProvider["source"] = "custom"
	legacyProvider["models"] = legacyModels
	providers[providerID] = legacyProvider
	if _, exists := legacy["model"]; exists {
		modelSettings := mapValue(legacy, "model")
		modelSettings["main"] = providerID + "/" + p.Model
		modelSettings["lite"] = providerID + "/" + p.Model
	}
	return writeJSON(s, legacyPath, legacy)
}

func configureTrae(s *store, p config.Payload) error {
	// TRAE desktop has no stable public provider-file API. Do not modify its
	// private state database; current versions can overwrite direct DB edits.
	path := s.path(".newapi-oneclick", "trae-manual.txt")
	text := fmt.Sprintf("TRAE 当前版本需在界面中确认一次：\n设置 > 模型 > 添加模型 > 自定义模型\nAPI 格式：OpenAI Chat Completions\nBase URL：%s\n模型 ID（默认项标记为 *）：\n", p.BaseURL)
	for _, model := range payloadModels(p) {
		marker := " "
		if model.ID == p.Model {
			marker = "*"
		}
		text += marker + " " + model.ID + "\n"
	}
	text += "API Key：已保存在其他客户端配置中，请从发货后台获取。\n"
	return s.write(path, []byte(text))
}

func configureAll(s *store, p config.Payload) []result {
	results := []result{}
	selected := make(map[string]bool)
	if len(p.Clients) == 0 {
		for _, name := range []string{"WorkBuddy", "CodeBuddy", "ZCode", "DSH", "Hermes", "TRAE"} {
			selected[name] = true
		}
	} else {
		for _, name := range p.Clients {
			selected[name] = true
		}
	}
	run := func(name string, fn func() error) {
		if len(p.Clients) > 0 {
			if !hasClientDirectory(s, name) {
				results = append(results, result{Client: name, Status: "warning", Detail: "本机未发现配置目录，未修改该客户端"})
				return
			}
		}
		if err := fn(); err != nil {
			results = append(results, result{Client: name, Status: "error", Detail: err.Error()})
		} else {
			results = append(results, result{Client: name, Status: "configured", Detail: "供应商及默认模型已写入"})
		}
	}
	if selected["WorkBuddy"] {
		run("WorkBuddy", func() error { return configureModelFamily(s, p, ".workbuddy") })
	}
	if selected["CodeBuddy"] {
		run("CodeBuddy", func() error { return configureCodeBuddy(s, p) })
	}
	if selected["ZCode"] {
		run("ZCode", func() error { return configureZCode(s, p) })
	}
	if selected["DSH"] {
		run("DSH", func() error { return configureDSH(s, p) })
	}
	if selected["Hermes"] {
		run("Hermes", func() error { return configureHermes(s, p) })
	}
	if selected["TRAE"] {
		if err := configureTrae(s, p); err != nil {
			results = append(results, result{Client: "TRAE", Status: "error", Detail: err.Error()})
		} else {
			results = append(results, result{Client: "TRAE", Status: "manual_required", Detail: "官方未提供稳定自动配置接口，已生成一次性配置说明"})
		}
	}
	return results
}

func hasErrors(results []result) bool {
	for _, r := range results {
		if r.Status == "error" {
			return true
		}
	}
	return false
}

func installedClients(s *store) []string {
	clients := []string{}
	for _, name := range []string{"WorkBuddy", "CodeBuddy", "ZCode", "DSH", "Hermes"} {
		if hasClientDirectory(s, name) {
			clients = append(clients, name)
		}
	}
	return clients
}

func hasClientDirectory(s *store, name string) bool {
	paths := map[string][]string{
		"WorkBuddy": {".workbuddy"},
		"CodeBuddy": {".codebuddy", ".codebuddycn"},
		"ZCode":     {".zcode"},
		"DSH":       {".dsh"},
		"Hermes":    {".hermes"},
	}[name]
	for _, rel := range paths {
		directory := filepath.Join(s.home, rel)
		info, err := os.Stat(directory)
		if err != nil || !info.IsDir() {
			continue
		}
		if rel != ".workbuddy" {
			return true
		}
		entries, err := os.ReadDir(directory)
		if err != nil {
			continue
		}
		backupOnly := len(entries) > 0
		for _, entry := range entries {
			if entry.Name() != ".newapi-oneclick" {
				backupOnly = false
				break
			}
		}
		if !backupOnly {
			return true
		}
	}
	return false
}

func sanitizeLog(input string, secret string) string {
	return strings.ReplaceAll(input, secret, "[已隐藏]")
}

func codeBuddyDirectory(s *store) string {
	if info, err := os.Stat(s.path(".codebuddycn")); err == nil && info.IsDir() {
		return ".codebuddycn"
	}
	return ".codebuddy"
}

func configureCodeBuddy(s *store, p config.Payload) error {
	primary := codeBuddyDirectory(s)
	if err := configureModelFamily(s, p, primary); err != nil {
		return err
	}
	if primary == ".codebuddycn" {
		if info, err := os.Stat(s.path(".codebuddy")); err == nil && info.IsDir() {
			return configureModelFamily(s, p, ".codebuddy")
		}
	}
	return nil
}
