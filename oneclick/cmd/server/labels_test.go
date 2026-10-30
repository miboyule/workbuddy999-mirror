package main

import (
	"newapi-oneclick/internal/config"
	"testing"
)

func TestLiveAliasesKeepActualIDsAndPublishedNames(t *testing.T) {
	defaults := []config.ModelOption{{ID: "glm-5.1", DisplayName: "WBAI-g04-0.79x", Description: "参考倍率 0.79x", Recommended: true}}
	models := decorateModels([]config.ModelOption{{ID: "cn:glm-5.1"}, {ID: "glm-5.1"}}, defaults, "glm-5.1")
	if models[0].ID != "cn:glm-5.1" || models[0].DisplayName != defaults[0].DisplayName || models[0].Description != defaults[0].Description || models[0].Recommended {
		t.Fatalf("alias metadata is incorrect: %#v", models[0])
	}
	if !models[1].Recommended {
		t.Fatal("canonical default is not recommended")
	}
}
