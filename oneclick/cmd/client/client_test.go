package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
	"newapi-oneclick/internal/config"
)

func testPayload() config.Payload {
	return config.Payload{
		SchemaVersion: 1, Customer: "测试客户", BaseURL: "https://api.workbuddy999.top/v1",
		APIKey: "sk-test-only", Model: "deepseek-v4-flash", DisplayName: "DeepSeek V4 Flash",
		ProviderName: "我的 AI", Verify: false, Restart: false,
	}
}

func readTestJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestConfigureAllAndIdempotency(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HERMES_HOME", filepath.Join(home, ".hermes"))
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	p := testPayload()
	if err := os.MkdirAll(filepath.Join(home, ".dsh", "profiles", "desktop"), 0o700); err != nil {
		t.Fatal(err)
	}
	results := configureAll(s, p)
	for _, item := range results {
		if item.Status == "error" {
			t.Fatalf("%s: %s", item.Client, item.Detail)
		}
	}

	wbSettings := readTestJSON(t, filepath.Join(home, ".workbuddy", "settings.json"))
	if wbSettings["model"] != p.Model {
		t.Fatalf("WorkBuddy default model not set: %#v", wbSettings)
	}
	zcode := readTestJSON(t, filepath.Join(home, ".zcode", "v2", "provider_config.json"))
	selection := zcode["config"].(map[string]any)["defaultModelSelection"].(map[string]any)
	if selection["modelId"] != p.Model || selection["providerId"] != "newapi-oneclick" {
		t.Fatalf("ZCode default selection not set: %#v", selection)
	}
	legacy := readTestJSON(t, filepath.Join(home, ".zcode", "v2", "config.json"))
	provider := legacy["provider"].(map[string]any)["newapi-oneclick"].(map[string]any)
	if provider["kind"] != "openai-compatible" {
		t.Fatalf("ZCode legacy provider invalid: %#v", provider)
	}

	envData, err := os.ReadFile(filepath.Join(home, ".hermes", ".env"))
	if err != nil || !strings.Contains(string(envData), credentialName+"="+p.APIKey) {
		t.Fatalf("Hermes env missing: %s %v", envData, err)
	}
	credData, err := os.ReadFile(filepath.Join(home, ".dsh", ".credentials.yaml"))
	if err != nil || !strings.Contains(string(credData), p.APIKey) {
		t.Fatalf("DSH credential missing: %v", err)
	}

	// A second run must update rather than duplicate providers and models.
	results = configureAll(s, p)
	if hasErrors(results) {
		t.Fatalf("second run failed: %#v", results)
	}
	legacyData, err := os.ReadFile(filepath.Join(home, ".zcode", "v2", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(legacyData), `"newapi-oneclick"`) != 1 {
		t.Fatalf("duplicate ZCode provider: %s", legacyData)
	}
}

func TestPreserveExistingConfiguration(t *testing.T) {
	home := t.TempDir()
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	cbDir := filepath.Join(home, ".codebuddy")
	if err := os.MkdirAll(cbDir, 0o700); err != nil {
		t.Fatal(err)
	}
	existing := `{"models":[{"id":"existing-model","name":"Keep me"}],"availableModels":["existing-model"],"custom":true}`
	if err := os.WriteFile(filepath.Join(cbDir, "models.json"), []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := configureModelFamily(s, testPayload(), ".codebuddy"); err != nil {
		t.Fatal(err)
	}
	root := readTestJSON(t, filepath.Join(cbDir, "models.json"))
	if root["custom"] != true || len(root["models"].([]any)) != 2 || len(root["availableModels"].([]any)) != 2 {
		t.Fatalf("existing CodeBuddy configuration not preserved: %#v", root)
	}
}

func TestCleanInstallReplacesModelProvidersAndKeepsUnrelatedSettings(t *testing.T) {
	home := t.TempDir()
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	workbuddy := filepath.Join(home, ".workbuddy")
	if err := os.MkdirAll(workbuddy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workbuddy, "models.json"), []byte(`[{"id":"foreign","name":"Foreign"},{"id":"old","name":"Old"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workbuddy, "settings.json"), []byte(`{"custom":"keep","model":"old"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	p := testPayload()
	p.CleanInstall = true
	if err := configureModelFamily(s, p, ".workbuddy"); err != nil {
		t.Fatal(err)
	}
	var models []map[string]any
	data, err := os.ReadFile(filepath.Join(workbuddy, "models.json"))
	if err != nil || json.Unmarshal(data, &models) != nil {
		t.Fatalf("read clean models: %v", err)
	}
	if len(models) != 1 || models[0]["id"] != p.Model {
		t.Fatalf("clean install kept old models: %s", data)
	}
	settings := readTestJSON(t, filepath.Join(workbuddy, "settings.json"))
	if settings["custom"] != "keep" || settings["model"] != p.Model {
		t.Fatalf("clean install changed unrelated settings: %#v", settings)
	}
	if !strings.Contains(s.backupDir, filepath.Join(".workbuddy", ".newapi-oneclick", "backups")) {
		t.Fatalf("backup is outside WorkBuddy config directory: %s", s.backupDir)
	}
}

func TestSelectedModelsMergeWithoutReplacingExistingModels(t *testing.T) {
	home := t.TempDir()
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".zcode", "v2"), 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := `{"provider":{"newapi-oneclick":{"name":"old","models":{"old-model":{"name":"Keep old"},"same-model":{"name":"Old name","custom":"preserve"}},"extra":"keep"},"other-provider":{"models":{"foreign":{"name":"Foreign"}}}},"model":{"main":"old"}}`
	if err := os.WriteFile(filepath.Join(home, ".zcode", "v2", "config.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	p := testPayload()
	p.Models = []config.ModelOption{
		{ID: "same-model", DisplayName: "Updated name"},
		{ID: "new-model", DisplayName: "New model"},
	}
	if err := configureZCode(s, p); err != nil {
		t.Fatal(err)
	}
	root := readTestJSON(t, filepath.Join(home, ".zcode", "v2", "config.json"))
	providers := root["provider"].(map[string]any)
	managed := providers["newapi-oneclick"].(map[string]any)
	models := managed["models"].(map[string]any)
	if _, ok := models["old-model"]; !ok {
		t.Fatal("previous model from managed provider was removed")
	}
	if models["same-model"].(map[string]any)["name"] != "same-model" {
		t.Fatal("same-ID model was not updated")
	}
	if models["same-model"].(map[string]any)["custom"] != "preserve" {
		t.Fatal("same-ID model custom property was not preserved")
	}
	if _, ok := models["new-model"]; !ok {
		t.Fatal("selected model was not added")
	}
	if _, ok := providers["other-provider"]; !ok {
		t.Fatal("unrelated provider was removed")
	}
}

func TestHermesLegacyProviderAndTraeManualListMergeModels(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HERMES_HOME", filepath.Join(home, ".hermes"))
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".hermes"), 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := "custom_providers:\n  - name: newapi-oneclick\n    models: [old-model]\n    custom: keep\n  - name: other\n    models: [foreign]\n"
	if err := os.WriteFile(filepath.Join(home, ".hermes", "config.yaml"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	p := testPayload()
	p.Models = []config.ModelOption{{ID: "first-model"}, {ID: "second-model"}}
	p.Model = "second-model"
	if err := configureHermes(s, p); err != nil {
		t.Fatal(err)
	}
	if err := configureTrae(s, p); err != nil {
		t.Fatal(err)
	}
	var root map[string]any
	data, _ := os.ReadFile(filepath.Join(home, ".hermes", "config.yaml"))
	if err := yaml.Unmarshal(data, &root); err != nil {
		t.Fatal(err)
	}
	providers := root["custom_providers"].([]any)
	if len(providers) != 2 {
		t.Fatalf("Hermes legacy providers not merged: %#v", providers)
	}
	managed := providers[0].(map[string]any)
	if managed["custom"] != "keep" || len(managed["models"].([]any)) != 3 {
		t.Fatalf("Hermes models or custom fields were lost: %#v", managed)
	}
	manual, err := os.ReadFile(filepath.Join(home, ".newapi-oneclick", "trae-manual.txt"))
	if err != nil || !strings.Contains(string(manual), "first-model") || !strings.Contains(string(manual), "* second-model") {
		t.Fatalf("TRAE manual list missing selected/default models: %s %v", manual, err)
	}
}

func TestModelFamilyUpdatesSameIDAndPreservesOthers(t *testing.T) {
	home := t.TempDir()
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(home, ".workbuddy")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	initial := `[{"id":"keep","name":"Keep"},{"id":"managed","name":"Old","url":"https://api.workbuddy999.top/v1/chat/completions"}]`
	if err := os.WriteFile(filepath.Join(dir, "models.json"), []byte(initial), 0o600); err != nil {
		t.Fatal(err)
	}
	p := testPayload()
	p.Model = "managed"
	p.Models = []config.ModelOption{{ID: "managed", DisplayName: "Updated"}, {ID: "added", DisplayName: "Added"}}
	if err := configureModelFamily(s, p, ".workbuddy"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "models.json"))
	if err != nil {
		t.Fatal(err)
	}
	var models []map[string]any
	if err := json.Unmarshal(data, &models); err != nil {
		t.Fatal(err)
	}
	if len(models) != 3 || models[0]["id"] != "keep" || models[1]["name"] != "Updated" || models[2]["id"] != "added" {
		t.Fatalf("unexpected merged models: %s", data)
	}
}

func TestDSHProfileMerge(t *testing.T) {
	home := t.TempDir()
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	profileDir := filepath.Join(home, ".dsh", "profiles", "desktop")
	if err := os.MkdirAll(profileDir, 0o700); err != nil {
		t.Fatal(err)
	}
	patch := `- id: llm-pi-ai
  config:
    providers:
      existing:
        apiKeyEnv: EXISTING_KEY
        baseURL: https://existing.example/v1
- id: other-plugin
  config:
    enabled: true
`
	patchPath := filepath.Join(profileDir, "cordis.patch.yml")
	if err := os.WriteFile(patchPath, []byte(patch), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := configureDSH(s, testPayload()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(patchPath)
	if err != nil {
		t.Fatal(err)
	}
	var entries []map[string]any
	if err := yaml.Unmarshal(data, &entries); err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("unexpected DSH patch entries: %#v", entries)
	}
	text := string(data)
	if !strings.Contains(text, "existing:") || !strings.Contains(text, "newapi-oneclick:") || !strings.Contains(text, "other-plugin") {
		t.Fatalf("DSH patch did not merge: %s", text)
	}
}

func TestDSHAndHermesKeepExistingVendorModels(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HERMES_HOME", filepath.Join(home, ".hermes"))
	s, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".dsh"), 0o700); err != nil {
		t.Fatal(err)
	}
	dsh := "llm-pi-ai:\n  providers:\n    newapi-oneclick:\n      displayName: old\n      models:\n        - id: old-model\n          name: Keep old\n        - id: new-model\n          name: Old name\n          custom: keep\n    other-provider:\n      models:\n        - id: foreign\n          name: Foreign\n"
	if err := os.WriteFile(filepath.Join(home, ".dsh", "settings.yaml"), []byte(dsh), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, ".hermes"), 0o700); err != nil {
		t.Fatal(err)
	}
	hermes := "providers:\n  newapi-oneclick:\n    models: [old-model]\n  other-provider:\n    enabled: true\n"
	if err := os.WriteFile(filepath.Join(home, ".hermes", "config.yaml"), []byte(hermes), 0o600); err != nil {
		t.Fatal(err)
	}
	p := testPayload()
	p.Models = []config.ModelOption{{ID: "new-model", DisplayName: "New model"}}
	if err := configureDSH(s, p); err != nil {
		t.Fatal(err)
	}
	if err := configureHermes(s, p); err != nil {
		t.Fatal(err)
	}
	var dshRoot map[string]any
	data, _ := os.ReadFile(filepath.Join(home, ".dsh", "settings.yaml"))
	if err := yaml.Unmarshal(data, &dshRoot); err != nil {
		t.Fatal(err)
	}
	providers := dshRoot["llm-pi-ai"].(map[string]any)["providers"].(map[string]any)
	if _, ok := providers["other-provider"]; !ok {
		t.Fatal("DSH unrelated provider was removed")
	}
	merged := providers["newapi-oneclick"].(map[string]any)["models"].([]any)
	if len(merged) != 2 {
		t.Fatalf("DSH managed models were replaced: %#v", merged)
	}
	for _, item := range merged {
		if model, ok := item.(map[string]any); ok && model["id"] == "new-model" && model["custom"] != "keep" {
			t.Fatalf("DSH same-ID model custom fields were lost: %#v", model)
		}
	}
	var hermesRoot map[string]any
	data, _ = os.ReadFile(filepath.Join(home, ".hermes", "config.yaml"))
	if err := yaml.Unmarshal(data, &hermesRoot); err != nil {
		t.Fatal(err)
	}
	if _, ok := hermesRoot["providers"].(map[string]any)["other-provider"]; !ok {
		t.Fatal("Hermes unrelated provider was removed")
	}
	if len(hermesRoot["providers"].(map[string]any)["newapi-oneclick"].(map[string]any)["models"].([]any)) != 2 {
		t.Fatal("Hermes managed provider models were replaced")
	}
}

func TestSelectedClientAndRestore(t *testing.T) {
	home := t.TempDir()
	workbuddy := filepath.Join(home, ".workbuddy")
	if err := os.MkdirAll(workbuddy, 0o700); err != nil {
		t.Fatal(err)
	}
	original := []byte(`{"model":"original","custom":"keep"}`)
	settings := filepath.Join(workbuddy, "settings.json")
	if err := os.WriteFile(settings, original, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := newStore(home)
	if err != nil {
		t.Fatal(err)
	}
	payload := testPayload()
	payload.Clients = []string{"WorkBuddy", "CodeBuddy"}
	results := configureAll(store, payload)
	if len(results) != 2 || results[0].Status != "configured" || results[1].Status != "warning" {
		t.Fatalf("unexpected selected client results: %+v", results)
	}
	if _, err := os.Stat(filepath.Join(home, ".codebuddy")); !os.IsNotExist(err) {
		t.Fatal("uninstalled client directory was created")
	}
	if err := restoreBackup(home, store.backupDir); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(settings)
	if err != nil || string(got) != string(original) {
		t.Fatalf("settings were not restored: %s, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(workbuddy, "models.json")); !os.IsNotExist(err) {
		t.Fatal("newly created models.json was not removed")
	}
}

func TestRestoreRejectsBackupOutsideHome(t *testing.T) {
	home := t.TempDir()
	if err := restoreBackup(home, t.TempDir()); err == nil {
		t.Fatal("restore accepted external backup directory")
	}
}
