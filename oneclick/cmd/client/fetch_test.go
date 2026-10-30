package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"newapi-oneclick/internal/config"
)

func TestFetchPayload(t *testing.T) {
	p := testPayload()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(p)
	}))
	defer server.Close()
	got, err := fetchPayload(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got.APIKey != p.APIKey || got.Model != p.Model {
		t.Fatalf("unexpected payload: %#v", got)
	}
}

func TestFetchPayloadRequiresHTTPSOutsideLocalhost(t *testing.T) {
	if _, err := fetchPayload("http://example.com/config"); err == nil {
		t.Fatal("expected insecure URL to be rejected")
	}
}

func TestPayloadResponseDoesNotLeakIntoReport(t *testing.T) {
	p := config.Payload{APIKey: "sk-secret"}
	rep := report{Success: true, Model: "deepseek-v4-flash"}
	data, err := json.Marshal(rep)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(p.APIKey)) {
		t.Fatal("report unexpectedly contains API key")
	}
}
