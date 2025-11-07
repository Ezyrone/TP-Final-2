package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

const maxLogs = 50

type userSummary struct {
	UserID      int    `json:"userId"`
	Pseudo      string `json:"pseudo"`
	Connections int    `json:"connections"`
}

type logEntry struct {
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type metrics struct {
	TotalMessagesProcessed int `json:"totalMessagesProcessed"`
}

type monitoringState struct {
	Connections int           `json:"connections"`
	Users       []userSummary `json:"users"`
	Metrics     metrics       `json:"metrics"`
	Logs        []logEntry    `json:"logs"`
}

var (
	state = monitoringState{
		Connections: 0,
		Users:       []userSummary{},
		Metrics:     metrics{},
		Logs:        []logEntry{},
	}
	stateMu sync.Mutex
)

func main() {
	port := getEnvInt("MONITOR_PORT", 4001)

	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", metricsHandler)
	mux.HandleFunc("/presence", presenceHandler)
	mux.HandleFunc("/metrics/messages", messageMetricsHandler)
	mux.HandleFunc("/logs", logsHandler)

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: withCORS(mux),
	}

	log.Printf("Monitoring service listening on %s\n", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("monitoring server failed: %v", err)
	}
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stateMu.Lock()
	snapshot := monitoringState{
		Connections: state.Connections,
		Users:       append([]userSummary{}, state.Users...),
		Metrics:     state.Metrics,
		Logs:        append([]logEntry{}, state.Logs...),
	}
	stateMu.Unlock()

	if snapshot.Users == nil {
		snapshot.Users = []userSummary{}
	}
	if snapshot.Logs == nil {
		snapshot.Logs = []logEntry{}
	}

	writeJSON(w, snapshot)
}

func presenceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var payload struct {
		Connections int           `json:"connections"`
		Users       []userSummary `json:"users"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	stateMu.Lock()
	state.Connections = payload.Connections
	state.Users = append([]userSummary{}, payload.Users...)
	stateMu.Unlock()

	writeJSON(w, map[string]string{"status": "ok"})
}

func messageMetricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var payload struct {
		Delta int `json:"delta"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	if payload.Delta == 0 {
		payload.Delta = 1
	}

	stateMu.Lock()
	state.Metrics.TotalMessagesProcessed += payload.Delta
	newMetrics := state.Metrics
	stateMu.Unlock()

	writeJSON(w, newMetrics)
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var entry logEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	if entry.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	stateMu.Lock()
	state.Logs = append(state.Logs, entry)
	if len(state.Logs) > maxLogs {
		state.Logs = state.Logs[len(state.Logs)-maxLogs:]
	}
	stateMu.Unlock()

	writeJSON(w, entry)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
	}
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	if v, err := strconv.Atoi(value); err == nil {
		return v
	}
	return fallback
}
