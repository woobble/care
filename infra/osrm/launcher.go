package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"syscall"
	"time"
)

var (
	datasetNamePattern = regexp.MustCompile(`^[a-z0-9_-]+$`)
	routeProbePattern  = regexp.MustCompile(`^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?,-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?;-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?,-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$`)
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if err := checkRoute(); err != nil {
			fmt.Fprintln(os.Stderr, "OSRM route health check failed")
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 {
		fmt.Fprintln(os.Stderr, "unsupported OSRM launcher argument")
		os.Exit(2)
	}

	if err := startRouter(); err != nil {
		fmt.Fprintln(os.Stderr, "OSRM router could not start:", err)
		os.Exit(1)
	}
}

func startRouter() error {
	nameBytes, err := os.ReadFile("/data/current/dataset-name")
	if err != nil {
		return err
	}
	name := strings.TrimSpace(string(nameBytes))
	if !datasetNamePattern.MatchString(name) {
		return errors.New("invalid dataset name")
	}

	datasetPath := "/data/current/" + name + ".osrm"
	if _, err := os.Stat(datasetPath + ".fileIndex"); err != nil {
		return err
	}
	return syscall.Exec("/usr/local/bin/osrm-routed", []string{"osrm-routed", "--algorithm", "mld", datasetPath}, os.Environ())
}

func checkRoute() error {
	probeBytes, err := os.ReadFile("/data/current/route-probe")
	if err != nil {
		return err
	}
	probe := strings.TrimSpace(string(probeBytes))
	if !routeProbePattern.MatchString(probe) {
		return errors.New("invalid route probe")
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			Proxy: nil,
		},
	}
	response, err := client.Get("http://127.0.0.1:5000/route/v1/driving/" + probe + "?overview=false")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected route response status: %s", response.Status)
	}

	var payload struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return err
	}
	if payload.Code != "Ok" {
		return errors.New("route service returned a non-success code")
	}
	return nil
}
