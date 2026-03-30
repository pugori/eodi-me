-- go-api/scripts/create-indexes.sql
--
-- Run this script once on the exported vibe_data.db before deploying.
-- The Go API opens the database in read-only mode, so indexes must exist
-- before the first read.
--
-- Usage:
--   sqlite3 data/vibe_data.db < scripts/create-indexes.sql
--
-- All statements are idempotent (IF NOT EXISTS).

-- Speed up city name search (used by GET /api/cities/search)
CREATE INDEX IF NOT EXISTS idx_cities_name         ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_ascii_name   ON cities(ascii_name);
CREATE INDEX IF NOT EXISTS idx_cities_country      ON cities(country);

-- Speed up city vector lookup (used by POST /api/match and GET /api/cities/:id)
CREATE INDEX IF NOT EXISTS idx_city_vectors_city_id ON city_vectors(city_id);

-- Speed up index_metadata lookup (used by sigma-squared adaptive similarity)
CREATE INDEX IF NOT EXISTS idx_metadata_singleton  ON index_metadata(rowid);

-- Analyse after creating indexes so the query planner uses them immediately
ANALYZE;
