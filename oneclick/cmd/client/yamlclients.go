package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"gopkg.in/yaml.v3"
	"newapi-oneclick/internal/config"
)

const credentialName = "NEWAPI_ONECLICK_API_KEY"

func readYAML(path string, fallback any) (any, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) || len(strings.TrimSpace(string(data))) == 0 {
		return fallback, nil
	}
	if err != nil {
		return nil, err
	}
	var value any
	if err := yaml.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("YAML 格式错误 %s: %w", path, err)
	}
	if value == nil {
		return fallback, nil
	}
	return value, nil
}

func writeYAML(s *store, path string, value any) error {
	data, err := yaml.Marshal(value)
	if err != nil {
		return err
	}
	return s.write(path, data)
}

func yamlMap(parent map[string]any, key string) map[string]any {
	return mapValue(parent, key)
}

func dshProvider(p config.Payload) map[string]any {
	models := []any{}
	for _, model := range payloadModels(p) {
		name := model.DisplayName
		if name == "" {
			name = model.ID
		}
		modelEntry := map[string]any{"id": model.ID, "name": name, "input": []any{"text", "image"}}
		for _, item := range models {
			if previous, ok := item.(map[string]any); ok && previous["id"] == model.ID {
				for key, old := range previous {
					if key != "id" && key != "name" && key != "input" {
						modelEntry[key] = old
					}
				}
				break
			}
		}
		models = upsertByID(models, "id", model.ID, modelEntry)
	}
	return map[string]any{
		"displayName": p.ProviderName,
		"apiKeyEnv":   managedCredentialName(p),
		"api":         "openai-completions",
		"baseURL":     p.BaseURL,
		"models":      models,
	}
}

func configureDSH(s *store, p config.Payload) error {
	providerID := managedProviderID(p)
	keyName := managedCredentialName(p)
	// Managed credentials keep the secret out of provider settings.
	credentialsPath := s.path(".dsh", ".credentials.yaml")
	credentialsValue, err := readYAML(credentialsPath, map[string]any{})
	if err != nil {
		return err
	}
	credentials, ok := asMap(credentialsValue)
	if !ok {
		return fmt.Errorf("DSH .credentials.yaml 顶层必须是对象")
	}
	credentials[keyName] = p.APIKey
	if err := writeYAML(s, credentialsPath, credentials); err != nil {
		return err
	}

	// Legacy settings are still imported by current DSH on first run.
	settingsPath := s.path(".dsh", "settings.yaml")
	settingsValue, err := readYAML(settingsPath, map[string]any{})
	if err != nil {
		return err
	}
	settings, ok := asMap(settingsValue)
	if !ok {
		return fmt.Errorf("DSH settings.yaml 顶层必须是对象")
	}
	llm := yamlMap(settings, "llm-pi-ai")
	providers := yamlMap(llm, "providers")
	if p.CleanInstall {
		providers = map[string]any{}
		llm["providers"] = providers
	}
	provider := dshProvider(p)
	if !p.CleanInstall {
		if previous, ok := providers[providerID].(map[string]any); ok {
			for key, value := range previous {
				if key != "models" && key != "displayName" && key != "apiKeyEnv" && key != "api" && key != "baseURL" {
					provider[key] = value
				}
			}
			provider["models"] = mergeProviderModels(previous["models"], payloadModels(p))
		}
	}
	providers[providerID] = provider
	settings["agent-default-model"] = map[string]any{
		"provider": providerID, "model": p.Model,
	}
	if err := writeYAML(s, settingsPath, settings); err != nil {
		return err
	}

	// DSH >= 0.2 profile patch layers. Existing profiles are updated in place.
	for _, profile := range []string{"web", "desktop"} {
		patchPath := s.path(".dsh", "profiles", profile, "cordis.patch.yml")
		if _, err := os.Stat(filepath.Dir(patchPath)); os.IsNotExist(err) {
			continue
		}
		patchValue, err := readYAML(patchPath, []any{})
		if err != nil {
			return err
		}
		entries, ok := patchValue.([]any)
		if !ok {
			return fmt.Errorf("DSH %s 必须是补丁数组", patchPath)
		}
		for _, item := range entries {
			entry, ok := item.(map[string]any)
			if !ok || entry["id"] != "llm-pi-ai" {
				continue
			}
			cfg := yamlMap(entry, "config")
			providers := yamlMap(cfg, "providers")
			if p.CleanInstall {
				providers = map[string]any{}
				cfg["providers"] = providers
			}
			provider := dshProvider(p)
			if !p.CleanInstall {
				if previous, ok := providers[providerID].(map[string]any); ok {
					for key, value := range previous {
						if key != "models" && key != "displayName" && key != "apiKeyEnv" && key != "api" && key != "baseURL" {
							provider[key] = value
						}
					}
					provider["models"] = mergeProviderModels(previous["models"], payloadModels(p))
				}
			}
			providers[providerID] = provider
		}
		foundProvider := false
		for _, item := range entries {
			if entry, ok := item.(map[string]any); ok && entry["id"] == "llm-pi-ai" {
				foundProvider = true
				break
			}
		}
		if !foundProvider {
			entries = append(entries, map[string]any{
				"id": "llm-pi-ai", "name": "@deepseek-ai/dsh-llm-pi-ai",
				"config": map[string]any{"providers": map[string]any{
					providerID: dshProvider(p),
				}},
			})
		}
		defaultEntry := map[string]any{
			"id": "agent-default-model", "name": "@deepseek-ai/dsh-agent-default-model",
			"config": map[string]any{"provider": providerID, "model": p.Model},
		}
		entries = upsertByID(entries, "id", "agent-default-model", defaultEntry)
		if err := writeYAML(s, patchPath, entries); err != nil {
			return err
		}
	}
	return nil
}

func hermesHome(s *store) string {
	actualHome, _ := os.UserHomeDir()
	if !strings.EqualFold(filepath.Clean(s.home), filepath.Clean(actualHome)) {
		return s.path(".hermes")
	}
	if dir := os.Getenv("HERMES_HOME"); dir != "" {
		return dir
	}
	legacy := s.path(".hermes")
	if _, err := os.Stat(filepath.Join(legacy, "config.yaml")); err == nil {
		return legacy
	}
	if runtime.GOOS == "windows" {
		if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
			return filepath.Join(dir, "hermes")
		}
	}
	return legacy
}

func configureHermes(s *store, p config.Payload) error {
	providerID := managedProviderID(p)
	keyName := managedCredentialName(p)
	home := hermesHome(s)
	path := filepath.Join(home, "config.yaml")
	rootValue, err := readYAML(path, map[string]any{})
	if err != nil {
		return err
	}
	root, ok := asMap(rootValue)
	if !ok {
		return fmt.Errorf("Hermes config.yaml 顶层必须是对象")
	}
	provider := map[string]any{
		"api":             p.BaseURL,
		"key_env":         keyName,
		"transport":       "openai_chat",
		"default_model":   p.Model,
		"discover_models": false,
		"models":          modelIDs(payloadModels(p)),
	}
	providers := yamlMap(root, "providers")
	if p.CleanInstall {
		providers = map[string]any{}
		root["providers"] = providers
	}
	if !p.CleanInstall {
		if previous, ok := providers[providerID].(map[string]any); ok {
			for key, value := range previous {
				if key != "api" && key != "key_env" && key != "transport" && key != "default_model" && key != "discover_models" && key != "models" {
					provider[key] = value
				}
			}
			old, _ := previous["models"].([]any)
			for _, model := range payloadModels(p) {
				old = uniqueAppend(old, model.ID)
			}
			provider["models"] = old
		}
	}
	providers[providerID] = provider

	// Keep the legacy representation in sync for older Hermes installations.
	legacy := []any{}
	if existing, ok := root["custom_providers"].([]any); ok {
		legacy = existing
	}
	if p.CleanInstall {
		legacy = nil
	}
	legacyProvider := map[string]any{
		"name": providerID, "base_url": p.BaseURL,
		"key_env": keyName, "api_mode": "chat_completions", "model": p.Model,
		"models": modelIDs(payloadModels(p)),
	}
	for _, item := range legacy {
		if previous, ok := item.(map[string]any); ok && previous["name"] == providerID {
			for key, value := range previous {
				if key != "name" && key != "base_url" && key != "key_env" && key != "api_mode" && key != "model" && key != "models" {
					legacyProvider[key] = value
				}
				legacyProvider["models"] = mergeStringIDs(previous["models"], payloadModels(p))
			}
			break
		}
	}
	root["custom_providers"] = upsertByID(legacy, "name", providerID, legacyProvider)
	root["model"] = map[string]any{
		"default": p.Model, "provider": "custom:" + providerID,
		"base_url": p.BaseURL, "api_mode": "chat_completions",
	}
	if err := writeYAML(s, path, root); err != nil {
		return err
	}

	envPath := filepath.Join(home, ".env")
	data, err := os.ReadFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	found := false
	for i, line := range lines {
		if strings.HasPrefix(line, keyName+"=") {
			lines[i] = keyName + "=" + p.APIKey
			found = true
		}
	}
	if !found {
		if len(lines) > 0 && lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
		lines = append(lines, keyName+"="+p.APIKey)
	}
	return s.write(envPath, []byte(strings.Join(lines, "\n")+"\n"))
}
