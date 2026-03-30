-- ============================================================================
-- EODI.ME PostgreSQL Initialization Script
-- Used by Docker Compose for initial database setup
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Fast trigram text search

-- ============================================================================
-- Core Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS cities (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    ascii_name  TEXT,
    country     TEXT,
    lat         NUMERIC(10, 6),
    lon         NUMERIC(10, 6),
    population  BIGINT,
    timezone    TEXT,
    feature_code TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS city_vectors (
    city_id     TEXT        PRIMARY KEY REFERENCES cities(id) ON DELETE CASCADE,
    vector      BYTEA       NOT NULL,   -- 15 × float32 = 60 bytes (little-endian)
    dim         SMALLINT    NOT NULL DEFAULT 15,
    version     SMALLINT    NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS index_metadata (
    id              SERIAL      PRIMARY KEY,
    median_5nn_l2sq DOUBLE PRECISION,
    city_count      INTEGER,
    built_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Hexagon Tables (populated by rust-collector)
-- ============================================================================

CREATE TABLE IF NOT EXISTS hexagons (
    h3_index        TEXT        PRIMARY KEY,  -- H3 cell index (decimal string)
    name            TEXT,
    admin_name      TEXT,
    admin_level     SMALLINT,
    parent_city_name TEXT,
    city            TEXT,
    country         TEXT,
    lat             NUMERIC(10, 6),
    lon             NUMERIC(10, 6),
    population      BIGINT,
    vector          BYTEA,                    -- 15D float32 vector
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- User & Credit Tables (login/payment deferred — schema prepared)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT        UNIQUE NOT NULL,
    display_name    TEXT,
    credits         INTEGER     NOT NULL DEFAULT 0,
    is_premium      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    amount          INTEGER     NOT NULL,  -- positive = add, negative = deduct
    reason          TEXT        NOT NULL,
    external_ref    TEXT,                  -- Lemon Squeezy order ID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_cities_name_trgm
    ON cities USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cities_country
    ON cities (country);

CREATE INDEX IF NOT EXISTS idx_cities_coords
    ON cities (lat, lon);

CREATE INDEX IF NOT EXISTS idx_hexagons_name_trgm
    ON hexagons USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_hexagons_admin_trgm
    ON hexagons USING GIN (admin_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_hexagons_country
    ON hexagons (country);

CREATE INDEX IF NOT EXISTS idx_hexagons_coords
    ON hexagons (lat, lon);

-- ============================================================================
-- Update trigger (auto-update updated_at)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cities_updated_at
    BEFORE UPDATE ON cities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER hexagons_updated_at
    BEFORE UPDATE ON hexagons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
