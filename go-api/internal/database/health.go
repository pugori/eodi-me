package database

import (
	"database/sql"
)

// Ping checks database connectivity
func (s *DB) Ping() error {
	return s.DB.Ping()
}

// Stats returns database statistics
func (s *DB) Stats() sql.DBStats {
	return s.DB.Stats()
}
