package main

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"strings"

	"newapi-oneclick/internal/config"
)

// Compare service identity, never the API key or a customer-editable display name.
func serviceIdentity(raw string) string {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil || u.Host == "" {
		return raw
	}
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimSuffix(u.Path, "/chat/completions")
	if (u.Host == "www.workbuddy999.top" || u.Host == "api.workbuddy999.top") && u.Path == "/v1" {
		return "https://api.workbuddy999.top/v1"
	}
	return u.String()
}

func managedProviderID(p config.Payload) string {
	identity := serviceIdentity(p.BaseURL)
	if identity == "https://api.workbuddy999.top/v1" {
		return "newapi-oneclick"
	}
	sum := sha256.Sum256([]byte(identity))
	return fmt.Sprintf("newapi-oneclick-%x", sum[:8])
}

func managedCredentialName(p config.Payload) string {
	id := managedProviderID(p)
	if id == "newapi-oneclick" {
		return credentialName
	}
	return credentialName + "_" + strings.ToUpper(strings.TrimPrefix(id, "newapi-oneclick-"))
}

func mergeFlatModels(existing []any, p config.Payload) ([]any, error) {
	// These clients use the model ID as their only unique key. Duplicate IDs
	// from different endpoints are not independently selectable in their UI.
	for _, model := range payloadModels(p) {
		for _, item := range existing {
			if old, ok := item.(map[string]any); ok && old["id"] == model.ID {
				endpoint, _ := old["url"].(string)
				if serviceIdentity(endpoint) != serviceIdentity(p.BaseURL) {
					return nil, fmt.Errorf("模型 %s 已用于其他供应商；此客户端不支持不同供应商使用相同 ID。为保留原配置，已停止安装；可取消此模型或选择支持多供应商的 ZCode/DSH/Hermes", model.ID)
				}
			}
		}
	}
	for _, model := range payloadModels(p) {
		definition := modelDefinition(p, model)
		for _, item := range existing {
			if old, ok := item.(map[string]any); ok && old["id"] == model.ID {
				for key, value := range old {
					if _, replaced := definition[key]; !replaced {
						definition[key] = value
					}
				}
				break
			}
		}
		existing = upsertByID(existing, "id", model.ID, definition)
	}
	return existing, nil
}
