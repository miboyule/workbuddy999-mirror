package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"newapi-oneclick/internal/config"
)

func verifyEndpoint(p config.Payload) result {
	req, err := http.NewRequest(http.MethodGet, p.ModelsEndpoint(), nil)
	if err != nil {
		return result{Client: "API 验证", Status: "warning", Detail: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return result{Client: "API 验证", Status: "warning", Detail: "暂时无法连接 API，请检查网络后重试"}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return result{Client: "API 验证", Status: "warning", Detail: "读取 API 响应失败"}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return result{Client: "API 验证", Status: "error", Detail: "API Key 鉴权失败，请联系发货方"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return result{Client: "API 验证", Status: "warning", Detail: fmt.Sprintf("模型列表接口返回 %d，配置已保存", resp.StatusCode)}
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return result{Client: "API 验证", Status: "warning", Detail: "接口已连接，但模型列表格式无法识别"}
	}
	for _, model := range payload.Data {
		if model.ID == p.Model {
			return result{Client: "API 验证", Status: "verified", Detail: "密钥有效，目标模型已就绪"}
		}
	}
	return result{Client: "API 验证", Status: "warning", Detail: "密钥有效，但模型列表未显示目标模型；如调用失败请检查 new-api 模型权限"}
}
