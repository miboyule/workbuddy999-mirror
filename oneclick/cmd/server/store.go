package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"newapi-oneclick/internal/config"
)

type customerStore struct {
	mu        sync.RWMutex
	path      string
	customers map[string]config.Payload
	ephemeral map[string]temporaryCustomer
}

type temporaryCustomer struct {
	payload config.Payload
	expires time.Time
}

func openCustomerStore(path string) (*customerStore, error) {
	s := &customerStore{path: path, customers: make(map[string]config.Payload), ephemeral: make(map[string]temporaryCustomer)}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取客户库: %w", err)
	}
	if len(data) == 0 {
		return s, nil
	}
	if err := json.Unmarshal(data, &s.customers); err != nil {
		return nil, fmt.Errorf("解析客户库: %w", err)
	}
	if s.customers == nil {
		s.customers = make(map[string]config.Payload)
	}
	return s, nil
}

func (s *customerStore) lookup(token string) (config.Payload, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	payload, ok := s.customers[token]
	if !ok {
		entry, exists := s.ephemeral[token]
		if exists && time.Now().Before(entry.expires) {
			payload, ok = entry.payload, true
		}
	}
	if ok {
		payload.Clients = append([]string(nil), payload.Clients...)
	}
	return payload, ok
}

func (s *customerStore) createEphemeral(payload config.Payload) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for token, entry := range s.ephemeral {
		if time.Now().After(entry.expires) {
			delete(s.ephemeral, token)
		}
	}
	var raw [24]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	s.ephemeral[token] = temporaryCustomer{payload: payload, expires: time.Now().Add(30 * time.Minute)}
	return token, nil
}

func (s *customerStore) create(payload config.Payload) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var token string
	for attempts := 0; attempts < 5; attempts++ {
		var raw [24]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return "", fmt.Errorf("生成客户令牌: %w", err)
		}
		token = base64.RawURLEncoding.EncodeToString(raw[:])
		if _, exists := s.customers[token]; !exists {
			s.customers[token] = payload
			if err := s.saveLocked(); err != nil {
				delete(s.customers, token)
				return "", err
			}
			return token, nil
		}
	}
	return "", errors.New("无法生成唯一客户令牌")
}

func (s *customerStore) saveLocked() error {
	data, err := json.MarshalIndent(s.customers, "", "  ")
	if err != nil {
		return fmt.Errorf("编码客户库: %w", err)
	}
	data = append(data, '\n')
	dir := filepath.Dir(s.path)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("创建客户库目录: %w", err)
		}
	}
	tmp, err := os.CreateTemp(dir, ".customers-*.tmp")
	if err != nil {
		return fmt.Errorf("创建客户库临时文件: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("设置客户库权限: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("写入客户库: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("同步客户库: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("关闭客户库: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		// Windows cannot always replace an existing file with Rename.
		if removeErr := os.Remove(s.path); removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
			return fmt.Errorf("替换客户库: %w", err)
		}
		if retryErr := os.Rename(tmpName, s.path); retryErr != nil {
			return fmt.Errorf("替换客户库: %w", retryErr)
		}
	}
	return nil
}
