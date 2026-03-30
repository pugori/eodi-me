package database

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/eodi-me/api-server/internal/models"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
	moderncsqlite "modernc.org/sqlite"
	_ "modernc.org/sqlite"
)

func init() {
	// Register a deterministic unaccent() function so SQLite can do
	// accent-insensitive city name searches (e.g. "Bogota" → "Bogotá").
	moderncsqlite.MustRegisterDeterministicScalarFunction(
		"unaccent", 1,
		func(ctx *moderncsqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			s, ok := args[0].(string)
			if !ok {
				return args[0], nil
			}
			return removeAccents(s), nil
		},
	)
}

// removeAccents strips Unicode combining marks (accents) from s via NFD decomposition.
func removeAccents(s string) string {
	t := transform.Chain(norm.NFD, transform.RemoveFunc(func(r rune) bool {
		return unicode.Is(unicode.Mn, r)
	}), norm.NFC)
	result, _, _ := transform.String(t, strings.ToLower(s))
	return result
}

type DB struct {
	*sql.DB
	mu sync.RWMutex
}

func NewSQLite(dbPath string) (*DB, error) {
	// Open database with read-only mode for production safety.
	//
	// IMPORTANT: The database must have been prepared with the indexes defined
	// in go-api/scripts/create-indexes.sql before the first deployment.
	// Read-only mode prevents creating indexes at runtime.
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro&cache=shared", dbPath))
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(0)

	// Verify connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Run optimization PRAGMAs
	optimizePragmas := []string{
		"PRAGMA cache_size = -64000",       // 64MB cache
		"PRAGMA temp_store = MEMORY",       // Use memory for temp storage
		"PRAGMA mmap_size = 268435456",     // 256MB mmap
		"PRAGMA synchronous = NORMAL",      // Faster writes
		"PRAGMA journal_mode = WAL",        // Write-ahead logging
		"PRAGMA wal_autocheckpoint = 1000", // Checkpoint every 1000 pages
	}

	for _, pragma := range optimizePragmas {
		if _, err := db.Exec(pragma); err != nil {
			// Non-fatal: log and continue; read-only DB ignores some PRAGMAs
			log.Printf("database: pragma warning %q: %v", pragma, err)
		}
	}

	return &DB{DB: db}, nil
}

func (db *DB) Close() error {
	if db.DB != nil {
		return db.DB.Close()
	}
	return nil
}

// GetCity retrieves basic city information
func (db *DB) GetCity(cityID string) (*City, error) {
	query := `
		SELECT id, name, population, country, lat, lon
		FROM cities
		WHERE id = ?
		LIMIT 1
	`

	var city City
	var population sql.NullInt64
	var country, lat, lon sql.NullString

	err := db.QueryRow(query, cityID).Scan(
		&city.ID,
		&city.Name,
		&population,
		&country,
		&lat,
		&lon,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("city not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query city: %w", err)
	}

	if population.Valid {
		city.Population = &population.Int64
	}
	if country.Valid {
		city.Country = &country.String
	}
	if lat.Valid {
		if latFloat, err := strconv.ParseFloat(lat.String, 64); err == nil {
			city.Lat = &latFloat
		}
	}
	if lon.Valid {
		if lonFloat, err := strconv.ParseFloat(lon.String, 64); err == nil {
			city.Lon = &lonFloat
		}
	}

	return &city, nil
}

// SearchCities searches for cities by name
func (db *DB) SearchCities(query string, limit int, country *string) ([]City, error) {
	var sqlQuery string
	var args []interface{}

	// Normalize the query: lowercase + strip accents for accent-insensitive matching.
	// The unaccent() SQL function (registered in init()) does the same to the DB value,
	// so "bogota" matches "Bogotá" and vice-versa.
	normalizedQuery := removeAccents(query)

	// Exact-start matches rank higher (CASE expression), then sort by population descending
	if country != nil {
		sqlQuery = `
			SELECT id, name, population, country, lat, lon
			FROM cities
			WHERE unaccent(lower(name)) LIKE ? AND country = ?
			ORDER BY (CASE WHEN unaccent(lower(name)) = ? THEN 0 WHEN unaccent(lower(name)) LIKE ? THEN 1 ELSE 2 END),
			         COALESCE(population, 0) DESC
			LIMIT ?
		`
		args = []interface{}{"%" + normalizedQuery + "%", *country, normalizedQuery, normalizedQuery + "%", limit}
	} else {
		sqlQuery = `
			SELECT id, name, population, country, lat, lon
			FROM cities
			WHERE unaccent(lower(name)) LIKE ?
			ORDER BY (CASE WHEN unaccent(lower(name)) = ? THEN 0 WHEN unaccent(lower(name)) LIKE ? THEN 1 ELSE 2 END),
			         COALESCE(population, 0) DESC
			LIMIT ?
		`
		args = []interface{}{"%" + normalizedQuery + "%", normalizedQuery, normalizedQuery + "%", limit}
	}

	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to search cities: %w", err)
	}
	defer rows.Close()

	var cities []City
	for rows.Next() {
		var city City
		var population sql.NullInt64
		var country, lat, lon sql.NullString

		err := rows.Scan(
			&city.ID,
			&city.Name,
			&population,
			&country,
			&lat,
			&lon,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan city row: %w", err)
		}

		if population.Valid {
			city.Population = &population.Int64
		}
		if country.Valid {
			city.Country = &country.String
		}
		if lat.Valid {
			if latFloat, err := strconv.ParseFloat(lat.String, 64); err == nil {
				city.Lat = &latFloat
			}
		}
		if lon.Valid {
			if lonFloat, err := strconv.ParseFloat(lon.String, 64); err == nil {
				city.Lon = &lonFloat
			}
		}

		cities = append(cities, city)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error in SearchCities: %w", err)
	}

	return cities, nil
}

// GetCityVector retrieves the 15D vector for a city
func (db *DB) GetCityVector(cityID string) ([]float32, error) {
	query := `
		SELECT vector
		FROM city_vectors
		WHERE city_id = ?
		LIMIT 1
	`

	var vectorBlob []byte
	err := db.QueryRow(query, cityID).Scan(&vectorBlob)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("vector not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query vector: %w", err)
	}

	// Convert blob to float32 slice
	if len(vectorBlob)%4 != 0 {
		return nil, fmt.Errorf("invalid vector blob size")
	}

	vector := make([]float32, len(vectorBlob)/4)
	for i := range vector {
		bits := uint32(vectorBlob[i*4]) |
			uint32(vectorBlob[i*4+1])<<8 |
			uint32(vectorBlob[i*4+2])<<16 |
			uint32(vectorBlob[i*4+3])<<24
		vector[i] = math.Float32frombits(bits)
	}

	return vector, nil
}

// GetAllVectors retrieves all city vectors for matching
func (db *DB) GetAllVectors() ([]string, [][]float32, error) {
	query := `
		SELECT city_id, vector
		FROM city_vectors
	`

	rows, err := db.Query(query)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to query vectors: %w", err)
	}
	defer rows.Close()

	var cityIDs []string
	var vectors [][]float32

	for rows.Next() {
		var cityID string
		var vectorBlob []byte

		if err := rows.Scan(&cityID, &vectorBlob); err != nil {
			return nil, nil, fmt.Errorf("failed to scan vector row: %w", err)
		}

		// Convert blob to float32 slice
		if len(vectorBlob)%4 != 0 {
			continue // Skip invalid vectors
		}

		vector := make([]float32, len(vectorBlob)/4)
		for i := range vector {
			bits := uint32(vectorBlob[i*4]) |
				uint32(vectorBlob[i*4+1])<<8 |
				uint32(vectorBlob[i*4+2])<<16 |
				uint32(vectorBlob[i*4+3])<<24
			vector[i] = math.Float32frombits(bits)
		}

		cityIDs = append(cityIDs, cityID)
		vectors = append(vectors, vector)
	}

	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("rows iteration error in GetAllVectors: %w", err)
	}

	return cityIDs, vectors, nil
}

// CoverageStats holds city database coverage metrics.
type CoverageStats struct {
	TotalCities   int            `json:"total_cities"`
	ByCountry     map[string]int `json:"by_country"`
}

// GetCoverageStats returns total city count and breakdown by country.
func (db *DB) GetCoverageStats() (*CoverageStats, error) {
	totalRow := db.QueryRow(`SELECT COUNT(*) FROM cities`)
	var total int
	if err := totalRow.Scan(&total); err != nil {
		return nil, fmt.Errorf("failed to count cities: %w", err)
	}

	rows, err := db.Query(`SELECT country, COUNT(*) FROM cities WHERE country IS NOT NULL GROUP BY country ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, fmt.Errorf("failed to count cities by country: %w", err)
	}
	defer rows.Close()

	byCountry := make(map[string]int)
	for rows.Next() {
		var country string
		var count int
		if err := rows.Scan(&country, &count); err != nil {
			continue
		}
		byCountry[country] = count
	}

	return &CoverageStats{
		TotalCities: total,
		ByCountry:   byCountry,
	}, nil
}

// GetSigmaSquared retrieves the sigma squared value for similarity calculation
func (db *DB) GetSigmaSquared() (float64, error) {
	query := `
		SELECT median_5nn_l2sq
		FROM index_metadata
		LIMIT 1
	`

	var median sql.NullFloat64
	err := db.QueryRow(query).Scan(&median)
	if err == sql.ErrNoRows || !median.Valid {
		return 1.0, nil // Default fallback
	}
	if err != nil {
		return 1.0, nil // Default fallback on error
	}

	// σ² = median_5nn_l2² / ln(2)
	return median.Float64 / 0.693147, nil
}

// City is an alias for models.City for use within the database layer.
type City = models.City
