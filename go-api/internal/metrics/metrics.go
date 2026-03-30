package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HTTPRequestsTotal counts all HTTP requests by method, path, and status code.
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eodi",
		Subsystem: "api",
		Name:      "http_requests_total",
		Help:      "Total number of HTTP requests processed.",
	}, []string{"method", "path", "status"})

	// HTTPRequestDuration tracks request latency by method and path.
	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "eodi",
		Subsystem: "api",
		Name:      "http_request_duration_seconds",
		Help:      "HTTP request latency in seconds.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"method", "path"})

	// ActiveRequests is a gauge of currently in-flight requests.
	ActiveRequests = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "eodi",
		Subsystem: "api",
		Name:      "active_requests",
		Help:      "Number of HTTP requests currently being handled.",
	})

	// EngineSearchesTotal counts hexagon search operations forwarded to the Rust engine.
	EngineSearchesTotal = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "eodi",
		Subsystem: "engine",
		Name:      "searches_total",
		Help:      "Total number of hexagon search requests forwarded to the engine.",
	})

	// EngineLookupErrors counts failed engine proxy calls.
	EngineLookupErrors = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "eodi",
		Subsystem: "engine",
		Name:      "lookup_errors_total",
		Help:      "Total number of engine proxy errors.",
	})
)
