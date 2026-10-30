package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"newapi-oneclick/internal/config"
)

type report struct {
	Success          bool     `json:"success"`
	OS               string   `json:"os"`
	CleanInstall     bool     `json:"clean_install"`
	Model            string   `json:"model"`
	Results          []result `json:"results"`
	RestartAttempted bool     `json:"restart_attempted"`
	Restarted        []string `json:"restarted,omitempty"`
	BackupDir        string   `json:"backup_dir"`
}

func reportResult(configURL, mode string, rep report) error {
	parsed, err := url.Parse(configURL)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLocalHost(parsed.Hostname()))) {
		return fmt.Errorf("结果上报地址无效")
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "api" || parts[1] != "tasks" || parts[3] != "config" || parts[2] == "" {
		return fmt.Errorf("结果上报地址无效")
	}
	parsed.Path = "/api/tasks/" + parts[2] + "/result"
	data, err := json.Marshal(struct {
		Success          bool     `json:"success"`
		Mode             string   `json:"mode"`
		CleanInstall     bool     `json:"clean_install"`
		Model            string   `json:"model"`
		RestartAttempted bool     `json:"restart_attempted"`
		Restarted        []string `json:"restarted"`
		BackupDir        string   `json:"backup_dir"`
		Results          []result `json:"results"`
	}{rep.Success, mode, rep.CleanInstall, rep.Model, rep.RestartAttempted, rep.Restarted, rep.BackupDir, rep.Results})
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, parsed.String(), bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("结果服务返回 %d", response.StatusCode)
	}
	return nil
}

func fetchPayload(configURL string) (config.Payload, error) {
	var p config.Payload
	u, err := url.Parse(configURL)
	if err != nil || u.Host == "" {
		return p, fmt.Errorf("配置链接无效")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return p, fmt.Errorf("配置链接必须使用 HTTPS")
	}
	req, err := http.NewRequest(http.MethodGet, configURL, nil)
	if err != nil {
		return p, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "NewAPI-OneClick/1.0")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return p, fmt.Errorf("无法下载客户配置: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusGone {
			return p, fmt.Errorf("安装任务已过期，请重新生成一份安装脚本，不要继续使用旧脚本")
		}
		if resp.StatusCode == http.StatusNotFound {
			return p, fmt.Errorf("安装任务不存在或本地配置服务已重启，请从配置页重新生成脚本")
		}
		return p, fmt.Errorf("配置服务返回 %d，请从配置页重新生成脚本", resp.StatusCode)
	}
	if resp.Request.URL.Scheme != "https" && !local {
		return p, fmt.Errorf("配置链接被重定向到非 HTTPS 地址")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal(body, &p); err != nil {
		return p, fmt.Errorf("客户配置格式错误")
	}
	p.Defaults()
	return p, p.Validate()
}

func waitBeforeCloseOnWindows() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Print("\n按回车键关闭窗口……")
	_, _ = fmt.Scanln()
}

func hasConfiguredClient(results []result) bool {
	for _, item := range results {
		if item.Status == "configured" {
			return true
		}
	}
	return false
}

func main() {
	configURL := flag.String("config-url", os.Getenv("NEWAPI_CONFIG_URL"), "客户配置接口")
	home := flag.String("home", "", "测试用用户目录")
	restore := flag.String("restore", "", "从指定备份目录恢复原配置")
	noRestart := flag.Bool("no-restart", false, "不重启客户端")
	allowLocalRealInstall := flag.Bool("allow-local-real-install", false, "允许本机配置链接修改真实用户目录")
	skipVerify := flag.Bool("skip-verify", false, "跳过在线验证")
	flag.Parse()
	if *restore != "" {
		if *home == "" {
			fmt.Fprintln(os.Stderr, "恢复配置必须指定 --home 隔离用户目录")
			os.Exit(2)
		}
		if err := restoreBackup(*home, *restore); err != nil {
			fmt.Fprintln(os.Stderr, "恢复失败："+err.Error())
			os.Exit(2)
		}
		fmt.Println("原配置已恢复：" + *restore)
		return
	}
	if *configURL == "" {
		fmt.Println("==========================================")
		fmt.Println("  NewAPI 一键配置工具")
		fmt.Println("==========================================")
		fmt.Println()
		fmt.Println("不能直接双击运行本程序！")
		fmt.Println()
		fmt.Println("正确做法：请打开客服发给您的专属链接，")
		fmt.Println("在网页上点击下载 install.cmd（Windows）")
		fmt.Println("或 install.command（Mac），运行下载的")
		fmt.Println("脚本即可自动完成全部配置。")
		fmt.Println()
		waitBeforeCloseOnWindows()
		os.Exit(2)
	}
	parsedConfigURL, parseErr := url.Parse(*configURL)
	localConfig := parseErr == nil && parsedConfigURL.Scheme == "http" && isLocalHost(parsedConfigURL.Hostname())
	if *allowLocalRealInstall && (!localConfig || *home != "" || *noRestart) {
		fmt.Fprintln(os.Stderr, "真实安装标记仅用于本机 HTTP 配置链接，且不能与 --home 或 --no-restart 同时使用")
		os.Exit(2)
	}
	if localConfig {
		if *home == "" && !*allowLocalRealInstall {
			fmt.Fprintln(os.Stderr, "本地测试必须显式指定 --home 隔离用户目录")
			os.Exit(2)
		}
		actualHome, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintln(os.Stderr, "无法确定真实用户目录："+err.Error())
			os.Exit(2)
		}
		if *home != "" {
			provided, _ := filepath.Abs(*home)
			actual, _ := filepath.Abs(actualHome)
			if strings.EqualFold(provided, actual) {
				fmt.Fprintln(os.Stderr, "本地测试不能写入真实用户目录")
				os.Exit(2)
			}
		}
	}
	mode := "real"
	if *home != "" {
		mode = "sandbox"
	}
	p, err := fetchPayload(*configURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "配置失败："+err.Error())
		if reportErr := reportResult(*configURL, mode, report{}); reportErr != nil {
			fmt.Fprintln(os.Stderr, "网页结果同步失败："+reportErr.Error())
		}
		os.Exit(2)
	}
	sandboxMode := *home != ""
	if *home == "" {
		*home, err = os.UserHomeDir()
		if err != nil {
			fmt.Fprintln(os.Stderr, "无法确定用户目录："+err.Error())
			os.Exit(2)
		}
	}
	s, err := newStore(*home)
	if err != nil {
		fmt.Fprintln(os.Stderr, "初始化失败："+err.Error())
		os.Exit(2)
	}
	fmt.Println("正在配置选中的客户端：" + strings.Join(p.Clients, "、"))
	results := configureAll(s, p)
	if !hasConfiguredClient(results) && !hasErrors(results) {
		results = append(results, result{Client: "安装检查", Status: "error", Detail: "没有找到任何可自动配置的已安装客户端"})
	}
	if !*skipVerify && p.Verify {
		results = append(results, verifyEndpoint(p))
	}
	if hasErrors(results) && len(s.changes) > 0 {
		if err := restoreBackup(s.home, s.backupDir); err != nil {
			results = append(results, result{Client: "自动恢复", Status: "error", Detail: "自动恢复失败：" + err.Error()})
		} else {
			fmt.Println("配置失败，已自动恢复修改前的配置")
			for i := range results {
				if results[i].Status == "configured" {
					results[i].Status = "restored"
					results[i].Detail = "其他配置步骤失败，本客户端已恢复原配置"
				}
			}
		}
	}
	restarted := []string{}
	restartAttempted := !*noRestart && p.Restart && !hasErrors(results)
	if !*noRestart && p.Restart && !hasErrors(results) {
		configured := make([]string, 0, len(p.Clients))
		for _, item := range results {
			if item.Status == "configured" {
				configured = append(configured, item.Client)
			}
		}
		restarted = restartApps(s, configured)
		for _, name := range configured {
			found := false
			for _, restartedName := range restarted {
				if restartedName == name {
					found = true
					break
				}
			}
			if found {
				results = append(results, result{Client: name + " 重启", Status: "restarted", Detail: "已重新启动客户端"})
			} else {
				results = append(results, result{Client: name + " 重启", Status: "warning", Detail: "未能确认自动重启，请手动退出并重新打开客户端"})
			}
		}
	}
	rep := report{
		Success: !hasErrors(results), OS: runtime.GOOS, CleanInstall: p.CleanInstall, Model: p.Model, RestartAttempted: restartAttempted,
		Results: results, Restarted: restarted, BackupDir: s.backupDir,
	}
	data, _ := json.MarshalIndent(rep, "", "  ")
	reportPath := filepath.Join(s.home, ".newapi-oneclick", "last-result.json")
	_ = atomicWrite(reportPath, append(data, '\n'), 0o600)
	if sandboxMode {
		mode = "sandbox"
	}
	if err := reportResult(*configURL, mode, rep); err != nil {
		fmt.Fprintln(os.Stderr, "网页结果同步失败，请查看本机报告："+reportPath+"（"+err.Error()+"）")
	}
	for _, item := range results {
		icon := "✓"
		if item.Status == "error" {
			icon = "✗"
		} else if item.Status == "warning" || item.Status == "manual_required" {
			icon = "!"
		}
		fmt.Printf("%s %-12s %s\n", icon, item.Client, sanitizeLog(item.Detail, p.APIKey))
	}
	if rep.Success {
		if localConfig && !*allowLocalRealInstall {
			fmt.Printf("\n隔离测试成功；真实客户端未修改也未重启。测试模型：%s\n", p.Model)
		} else {
			fmt.Printf("\n真实客户端配置完成，默认模型：%s\n", p.Model)
		}
		if len(restarted) > 0 {
			fmt.Println("已重启：" + strings.Join(restarted, "、"))
		}
		fmt.Println("原配置备份：" + s.backupDir)
		if p.DashboardURL != "" {
			fmt.Println("用量后台：" + p.DashboardURL)
		}
		if !localConfig || *allowLocalRealInstall {
			fmt.Println("现在回到客户端，新建任务即可使用。")
		}
	} else {
		fmt.Fprintln(os.Stderr, "\n部分项目配置失败，原配置已备份。请把 last-result.json 发给客服（文件不含 API Key）。")
		os.Exit(3)
	}
}

func isLocalHost(host string) bool {
	if host == "localhost" {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}
