package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	customersFile := strings.TrimSpace(os.Getenv("CUSTOMERS_FILE"))
	if customersFile == "" {
		customersFile = "customers.json"
	}

	app, err := newApplication(applicationConfig{
		PublicBaseURL: strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")),
		CustomersFile: customersFile,
		AdminToken:    os.Getenv("ADMIN_TOKEN"),
		LocalFixtures: os.Getenv("ONECLICK_LOCAL_FIXTURES") == "1",
	})
	if err != nil {
		log.Fatalf("初始化服务失败: %v", err)
	}

	address := ":" + port
	if publicURL, err := url.Parse(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL"))); err == nil && isLoopbackHost(publicURL.Hostname()) {
		address = "127.0.0.1:" + port
	}
	server := &http.Server{
		Addr:              address,
		Handler:           app.routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownCtx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("HTTP 服务关闭失败: %v", err)
		}
	}()

	log.Printf("HTTP 服务已启动，监听地址 %s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("HTTP 服务异常退出: %v", err)
	}
}
