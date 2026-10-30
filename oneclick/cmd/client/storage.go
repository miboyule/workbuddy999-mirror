package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type store struct {
	home      string
	backupDir string
	changes   []change
	seen      map[string]bool
}

type change struct {
	Relative string      `json:"relative"`
	Existed  bool        `json:"existed"`
	Mode     os.FileMode `json:"mode"`
}

func newStore(home string) (*store, error) {
	if home == "" {
		return nil, fmt.Errorf("无法确定用户目录")
	}
	home, err := filepath.Abs(home)
	if err != nil {
		return nil, err
	}
	s := &store{home: home, seen: make(map[string]bool)}
	// Keep recovery data beside the primary WorkBuddy user configuration so
	// customers can find it with the rest of their local client data.
	s.backupDir = filepath.Join(home, ".workbuddy", ".newapi-oneclick", "backups", time.Now().Format("20060102-150405.000000000"))
	// Create the backup folder lazily. The folder itself must not make an
	// uninstalled WorkBuddy look installed during client detection.
	return s, nil
}

func (s *store) path(parts ...string) string {
	all := append([]string{s.home}, parts...)
	return filepath.Join(all...)
}

func (s *store) backup(path string) error {
	if s.seen[path] {
		return nil
	}
	rel, err := filepath.Rel(s.home, path)
	if err != nil || !safeRelativePath(rel) {
		return fmt.Errorf("配置路径不在隔离用户目录内: %s", path)
	}
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		s.changes = append(s.changes, change{Relative: rel})
		s.seen[path] = true
		return nil
	}
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("无法备份配置文件: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dest := filepath.Join(s.backupDir, rel)
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(dest, data, 0o600); err != nil {
		return err
	}
	s.changes = append(s.changes, change{Relative: rel, Existed: true, Mode: info.Mode().Perm()})
	s.seen[path] = true
	return nil
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".newapi-setup-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Chmod(tmpName, mode); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func (s *store) write(path string, data []byte) error {
	if err := s.backup(path); err != nil {
		return fmt.Errorf("备份失败: %w", err)
	}
	if err := atomicWrite(path, data, 0o600); err != nil {
		return err
	}
	manifest, err := json.MarshalIndent(s.changes, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(s.backupDir, "manifest.json"), append(manifest, '\n'), 0o600)
}

func restoreBackup(home, backupDir string) error {
	home, err := filepath.Abs(home)
	if err != nil {
		return err
	}
	backupDir, err = filepath.Abs(backupDir)
	if err != nil {
		return err
	}
	backupRoot := filepath.Join(home, ".workbuddy", ".newapi-oneclick", "backups")
	if filepath.Dir(backupDir) != backupRoot {
		return fmt.Errorf("备份目录必须位于 %s", backupRoot)
	}
	manifest, err := os.ReadFile(filepath.Join(backupDir, "manifest.json"))
	if err != nil {
		return err
	}
	var changes []change
	if err := json.Unmarshal(manifest, &changes); err != nil {
		return err
	}
	for i := len(changes) - 1; i >= 0; i-- {
		item := changes[i]
		if !safeRelativePath(item.Relative) {
			return fmt.Errorf("备份清单包含无效路径")
		}
		path := filepath.Join(home, item.Relative)
		if item.Existed {
			data, err := os.ReadFile(filepath.Join(backupDir, item.Relative))
			if err != nil {
				return err
			}
			if err := atomicWrite(path, data, item.Mode.Perm()); err != nil {
				return err
			}
		} else if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func safeRelativePath(relative string) bool {
	clean := filepath.Clean(relative)
	return clean == relative && clean != "." && clean != ".." && !filepath.IsAbs(clean) && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func readJSON(path string, fallback any) (any, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) || len(bytes.TrimSpace(data)) == 0 {
		return fallback, nil
	}
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("JSON 格式错误 %s: %w", path, err)
	}
	return value, nil
}

func writeJSON(s *store, path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return s.write(path, append(data, '\n'))
}

func asMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func mapValue(parent map[string]any, key string) map[string]any {
	if child, ok := parent[key].(map[string]any); ok {
		return child
	}
	child := map[string]any{}
	parent[key] = child
	return child
}

func arrayValue(parent map[string]any, key string) []any {
	if child, ok := parent[key].([]any); ok {
		return child
	}
	return []any{}
}

func upsertByID(items []any, idKey, id string, value map[string]any) []any {
	for i, item := range items {
		if m, ok := item.(map[string]any); ok && m[idKey] == id {
			items[i] = value
			return items
		}
	}
	return append(items, value)
}

func uniqueAppend(items []any, value string) []any {
	for _, item := range items {
		if item == value {
			return items
		}
	}
	return append(items, value)
}
