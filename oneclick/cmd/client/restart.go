package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type appTarget struct {
	name    string
	process string
	path    string
}

func discoverApps(s *store) []appTarget {
	apps := []appTarget{}
	if runtime.GOOS == "windows" {
		local := os.Getenv("LOCALAPPDATA")
		candidates := []appTarget{
			{name: "WorkBuddy", process: "WorkBuddy.exe", path: filepath.Join(local, "Programs", "WorkBuddy", "WorkBuddy.exe")},
			{name: "CodeBuddy", process: "CodeBuddy CN.exe", path: filepath.Join(local, "Programs", "CodeBuddy CN", "CodeBuddy CN.exe")},
			{name: "ZCode", process: "ZCode.exe", path: filepath.Join(local, "Programs", "ZCode", "ZCode.exe")},
			{name: "DSH", process: "DSH Desktop.exe", path: filepath.Join(local, "Programs", "DSH Desktop", "DSH Desktop.exe")},
			{name: "Hermes", process: "hermes-agent.exe", path: filepath.Join(local, "Programs", "hermes-desktop", "hermes-agent.exe")},
		}
		for _, app := range candidates {
			if _, err := os.Stat(app.path); err == nil {
				apps = append(apps, app)
			}
		}
	} else if runtime.GOOS == "darwin" {
		candidates := []appTarget{
			{name: "WorkBuddy", process: "WorkBuddy", path: "/Applications/WorkBuddy.app"},
			{name: "CodeBuddy", process: "CodeBuddy CN", path: "/Applications/CodeBuddy CN.app"},
			{name: "ZCode", process: "ZCode", path: "/Applications/ZCode.app"},
			{name: "DSH", process: "DSH Desktop", path: "/Applications/DSH Desktop.app"},
			{name: "Hermes", process: "hermes-agent", path: "/Applications/hermes-agent.app"},
		}
		for _, app := range candidates {
			if _, err := os.Stat(app.path); err == nil {
				apps = append(apps, app)
			}
		}
	}
	return apps
}

func restartApps(s *store, selected []string) []string {
	restarted := []string{}
	allowed := map[string]bool{}
	if len(selected) == 0 {
		for _, app := range discoverApps(s) {
			allowed[app.name] = true
		}
	} else {
		for _, name := range selected {
			allowed[strings.TrimSpace(name)] = true
		}
	}
	for _, app := range discoverApps(s) {
		if !allowed[app.name] {
			continue
		}
		if runtime.GOOS == "windows" {
			_ = exec.Command("taskkill", "/IM", app.process, "/T").Run()
			time.Sleep(1200 * time.Millisecond)
			cmd := exec.Command(app.path)
			cmd.Dir = filepath.Dir(app.path)
			if cmd.Start() == nil {
				restarted = append(restarted, app.name)
			}
		} else {
			_ = exec.Command("osascript", "-e", `tell application "`+app.process+`" to quit`).Run()
			time.Sleep(1200 * time.Millisecond)
			if exec.Command("open", app.path).Start() == nil {
				restarted = append(restarted, app.name)
			}
		}
	}
	return restarted
}
