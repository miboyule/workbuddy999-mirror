package config

import "testing"

func TestPayloadDefaultsAndEndpoints(t *testing.T) {
	p := Payload{BaseURL: "https://api.example.com/v1/chat/completions/", APIKey: "sk-test"}
	p.Defaults()
	if p.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("unexpected base URL: %s", p.BaseURL)
	}
	if p.Model != "deepseek-v4-flash" || p.Endpoint() != "https://api.example.com/v1/chat/completions" || p.ModelsEndpoint() != "https://api.example.com/v1/models" {
		t.Fatalf("unexpected payload: %#v", p)
	}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestPayloadRejectsInvalidValues(t *testing.T) {
	cases := []Payload{
		{SchemaVersion: 1, BaseURL: "javascript:alert(1)", APIKey: "sk", Model: "m"},
		{SchemaVersion: 1, BaseURL: "https://api.example.com/v1", APIKey: "", Model: "m"},
		{SchemaVersion: 1, BaseURL: "https://api.example.com/v1", APIKey: "sk\nbad", Model: "m"},
	}
	for _, p := range cases {
		if err := p.Validate(); err == nil {
			t.Fatalf("expected invalid payload: %#v", p)
		}
	}
}
