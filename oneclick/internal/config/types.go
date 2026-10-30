package config

import (
	"fmt"
	"net/url"
	"strings"
)

const SchemaVersion = 1

type ModelOption struct {
	ID              string `json:"id"`
	DisplayName     string `json:"display_name"`
	Description     string `json:"description,omitempty"`
	Status          string `json:"status"`
	LatencyMS       int    `json:"latency_ms,omitempty"`
	Recommended     bool   `json:"recommended,omitempty"`
	PopularityRank  int    `json:"popularity_rank,omitempty"`
	PopularityStars int    `json:"popularity_stars,omitempty"`
	SpeedStars      int    `json:"speed_stars,omitempty"`
	SampleCount     int    `json:"sample_count,omitempty"`
	RankingDays     int    `json:"ranking_days,omitempty"`
}

// Payload is delivered by the setup server to the client over HTTPS.
type Payload struct {
	SchemaVersion int           `json:"schema_version"`
	Customer      string        `json:"customer"`
	BaseURL       string        `json:"base_url"`
	APIKey        string        `json:"api_key"`
	Model         string        `json:"model"`
	DisplayName   string        `json:"display_name"`
	ProviderName  string        `json:"provider_name"`
	DashboardURL  string        `json:"dashboard_url,omitempty"`
	RedeemURL     string        `json:"redeem_url,omitempty"`
	Clients       []string      `json:"clients,omitempty"`
	Models        []ModelOption `json:"models,omitempty"`
	Verify        bool          `json:"verify"`
	Restart       bool          `json:"restart"`
	CleanInstall  bool          `json:"clean_install"`
}

func (p *Payload) Defaults() {
	if p.SchemaVersion == 0 {
		p.SchemaVersion = SchemaVersion
	}
	if p.Model == "" {
		p.Model = "deepseek-v4-flash"
	}
	if p.DisplayName == "" {
		p.DisplayName = "WBAI-d02-0.17x"
	}
	if p.ProviderName == "" {
		p.ProviderName = "WBAI微:36612995"
	}
	if len(p.Models) == 0 {
		p.Models = []ModelOption{{
			ID: p.Model, DisplayName: p.DisplayName, Description: "当前客户默认模型",
			Status: "available", Recommended: true,
		}}
	}
	p.BaseURL = strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	p.BaseURL = strings.TrimSuffix(p.BaseURL, "/chat/completions")
}

func (p Payload) Validate() error {
	if p.SchemaVersion != SchemaVersion {
		return fmt.Errorf("不支持的配置版本: %d", p.SchemaVersion)
	}
	u, err := url.Parse(p.BaseURL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return fmt.Errorf("API Base URL 无效")
	}
	if p.APIKey == "" || len(p.APIKey) > 4096 || strings.ContainsAny(p.APIKey, "\r\n") {
		return fmt.Errorf("API Key 无效")
	}
	if p.Model == "" || strings.ContainsAny(p.Model, "\r\n") {
		return fmt.Errorf("模型 ID 无效")
	}
	return nil
}

func (p Payload) Endpoint() string {
	if strings.HasSuffix(p.BaseURL, "/chat/completions") {
		return p.BaseURL
	}
	return p.BaseURL + "/chat/completions"
}

func (p Payload) ModelsEndpoint() string {
	base := strings.TrimSuffix(p.BaseURL, "/chat/completions")
	return base + "/models"
}
