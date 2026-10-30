package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReportResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/tasks/task123/result" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var outcome struct {
			Success bool     `json:"success"`
			Mode    string   `json:"mode"`
			Model   string   `json:"model"`
			Results []result `json:"results"`
		}
		if err := json.NewDecoder(r.Body).Decode(&outcome); err != nil || !outcome.Success || outcome.Mode != "sandbox" || outcome.Model != "test-model" || len(outcome.Results) != 1 || outcome.Results[0].Client != "WorkBuddy" {
			t.Errorf("unexpected result: %+v, %v", outcome, err)
		}
	}))
	defer server.Close()
	if err := reportResult(server.URL+"/api/tasks/task123/config", "sandbox", report{Success: true, Model: "test-model", Results: []result{{Client: "WorkBuddy", Status: "configured"}}}); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		server.URL + "/api/tasks/task123/other",
		server.URL + "/api/tasks/task123/config?key=secret",
		"http://example.com/api/tasks/task123/config",
	} {
		if err := reportResult(invalid, "sandbox", report{}); err == nil || !strings.Contains(err.Error(), "地址无效") {
			t.Fatalf("accepted invalid URL: %s, %v", invalid, err)
		}
	}
}
