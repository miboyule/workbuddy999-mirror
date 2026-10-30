package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestFlatModelsOwnershipAndRepeatInstall(t *testing.T) {
	for _, directory := range []string{".workbuddy", ".codebuddy", ".codebuddycn"} {
		t.Run(directory, func(t *testing.T) {
			home := t.TempDir()
			s, _ := newStore(home)
			p := testPayload()
			p.DisplayName = "Updated"
			path := filepath.Join(home, directory, "models.json")
			old := []any{
				map[string]any{"id": p.Model, "url": "https://www.workbuddy999.top/v1/chat/completions", "name": "Old", "extra": "keep"},
				map[string]any{"id": "our-unselected", "url": p.Endpoint()},
				map[string]any{"id": "foreign", "url": "https://other.example/v1/chat/completions", "apiKey": "foreign-key"},
			}
			var root any = map[string]any{"models": old, "custom": true}
			if directory == ".workbuddy" {
				root = old
			}
			data, _ := json.Marshal(root)
			os.MkdirAll(filepath.Dir(path), 0700)
			os.WriteFile(path, data, 0600)
			for i := 0; i < 2; i++ {
				if err := configureModelFamily(s, p, directory); err != nil {
					t.Fatal(err)
				}
			}
			value, err := readJSON(path, nil)
			if err != nil {
				t.Fatal(err)
			}
			models, ok := value.([]any)
			if !ok {
				models = value.(map[string]any)["models"].([]any)
			}
			if len(models) != 3 {
				t.Fatalf("models lost or duplicated: %#v", models)
			}
			updated := models[0].(map[string]any)
			if updated["name"] != "Updated" || updated["extra"] != "keep" || updated["apiKey"] != p.APIKey {
				t.Fatal(updated)
			}
			if models[2].(map[string]any)["apiKey"] != "foreign-key" {
				t.Fatal("foreign credentials changed")
			}
			if err := restoreBackup(home, s.backupDir); err != nil {
				t.Fatal(err)
			}
			restored, _ := os.ReadFile(path)
			if string(restored) != string(data) {
				t.Fatal("backup did not restore original bytes")
			}
		})
	}
}

func TestFlatModelsForeignSameIDStopsWithoutWriting(t *testing.T) {
	for _, directory := range []string{".workbuddy", ".codebuddy", ".codebuddycn"} {
		home := t.TempDir()
		s, _ := newStore(home)
		p := testPayload()
		path := filepath.Join(home, directory, "models.json")
		data, _ := json.Marshal([]any{map[string]any{"id": p.Model, "url": "https://foreign.example/v1/chat/completions", "apiKey": "keep"}})
		os.MkdirAll(filepath.Dir(path), 0700)
		os.WriteFile(path, data, 0600)
		if err := configureModelFamily(s, p, directory); err == nil {
			t.Fatal("cross-provider ID collision accepted")
		}
		after, _ := os.ReadFile(path)
		if string(after) != string(data) || len(s.changes) != 0 {
			t.Fatal("conflict modified customer files")
		}
	}
}

func TestThirdPartyProvidersAndCredentialsAreIsolated(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HERMES_HOME", filepath.Join(home, ".hermes"))
	s, _ := newStore(home)
	p := testPayload()
	if hasErrors(configureAll(s, p)) {
		t.Fatal("initial install failed")
	}
	external := p
	external.BaseURL = "https://other.example/v1"
	external.APIKey = "other-key"
	external.Clients = []string{"ZCode", "DSH", "Hermes"}
	for i := 0; i < 2; i++ {
		if got := configureAll(s, external); hasErrors(got) {
			t.Fatal(got)
		}
	}
	root := readTestJSON(t, filepath.Join(home, ".zcode", "v2", "config.json"))
	providers := root["provider"].(map[string]any)
	if len(providers) != 2 {
		t.Fatalf("providers overwritten or duplicated: %#v", providers)
	}
	settings, err := readYAML(filepath.Join(home, ".dsh", "settings.yaml"), nil)
	if err != nil {
		t.Fatal(err)
	}
	dsh := settings.(map[string]any)["llm-pi-ai"].(map[string]any)["providers"].(map[string]any)
	if len(dsh) != 2 {
		t.Fatal("DSH providers overwritten")
	}
	credentials, _ := readYAML(filepath.Join(home, ".dsh", ".credentials.yaml"), nil)
	if credentials.(map[string]any)[credentialName] != p.APIKey || credentials.(map[string]any)[managedCredentialName(external)] != external.APIKey {
		t.Fatal("DSH credentials overwritten")
	}
	hermes, _ := readYAML(filepath.Join(home, ".hermes", "config.yaml"), nil)
	if len(hermes.(map[string]any)["providers"].(map[string]any)) != 2 || len(hermes.(map[string]any)["custom_providers"].([]any)) != 2 {
		t.Fatal("Hermes providers overwritten")
	}
	if managedProviderID(external) == managedProviderID(p) {
		t.Fatal("provider identity collision")
	}
}

func TestCodeBuddyCNDetectionAndConfiguration(t *testing.T) {
	home := t.TempDir()
	s, _ := newStore(home)
	os.MkdirAll(s.path(".codebuddycn"), 0700)
	p := testPayload()
	p.Clients = []string{"CodeBuddy"}
	if got := configureAll(s, p); hasErrors(got) || !hasConfiguredClient(got) {
		t.Fatal(got)
	}
	if readTestJSON(t, s.path(".codebuddycn", "settings.json"))["model"] != p.Model {
		t.Fatal("CN default missing")
	}
	if clients := installedClients(s); len(clients) != 1 || clients[0] != "CodeBuddy" {
		t.Fatal(clients)
	}
}
