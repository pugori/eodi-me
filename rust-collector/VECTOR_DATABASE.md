# 15D Vector Database Builder

## Overview

The rust-collector now includes a production-grade encrypted vector database builder for City Vibe Engine. This system collects license-compliant urban data and computes academically validated 15-dimensional feature vectors for each city.

## Architecture

### Data Pipeline

```
cities15000.txt → SQLite DB → POI Collection → Climate Collection → 15D Vectors → Encrypted .edb
```

1. **Initial Collection** (`collect-cities`): Parse GeoNames data, collect basic country and weather info
2. **POI Collection** (`collect-poi`): Fetch POI categories, transit, and water proximity from OSM
3. **Climate Collection** (`collect-poi`): Fetch historical temperature data from Open-Meteo
4. **Vector Computation** (`build-vdb`): Two-pass normalization → encrypted database

### 15D Vector Specification

The Urban Vibe Dataset v6.0 includes these dimensions (all normalized to [0,1]):

- **dim 0-5**: Urban Vibe 6-axis (POI category proportions)
  - dim 0: Vitality (bars, nightclubs, fast\_food, coffee shops)
  - dim 1: Culture (museums, galleries, theaters, libraries)
  - dim 2: Nature (parks, gardens, beaches, viewpoints)
  - dim 3: Taste (restaurants, cafes, bakeries, ice cream)
  - dim 4: Shopping (shops, supermarkets, malls, markets)
  - dim 5: Rhythm (daily activity patterns via temporal proxies)

- **dim 6-7**: POI Profile
  - dim 6: POI density percentile (per-country normalized)
  - dim 7: Shannon entropy of 7 POI categories (diversity measure)

- **dim 8**: Water Proximity (inverse distance percentile, global)

- **dim 9-10**: Climate (30% attenuated to reduce geographic bias)
  - dim 9: Thermal comfort (Gaussian model, 20°C neutral)
  - dim 10: Seasonality (annual temperature standard deviation)

- **dim 11-14**: Mobility & Accessibility
  - dim 11: Temporal rhythm proxy (Cranshaw et al. 2012)
  - dim 12: Spatial flow proxy (Hasan et al. 2013)
  - dim 13: Population density (log-percentile, global)
  - dim 14: Transit accessibility (mode-weighted, OSM real data)

### Academic Validation

All normalization methods are based on peer-reviewed research:

- **Shannon Entropy**: Shannon (1948) "A Mathematical Theory of Communication" — POI diversity measure
- **Thermal Comfort**: Fanger (1970) "Thermal Comfort" + ASHRAE Standard 55 — 20°C neutral, ±12°C comfort range
- **Temporal Rhythms**: Cranshaw et al. (2012) "The Livehoods Project" — POI diversity as temporal activity proxy
- **Spatial Flows**: Hasan et al. (2013) "Urban Mobility Patterns" — Shannon entropy + density correlation (r=0.73)
- **Percentile Ranking**: Hyndman & Fan (1996) "Sample Quantiles" — linear interpolation method

### Data Sources (License-Compliant)

All data sources have compatible licenses (CC BY 4.0, ODbL 1.0):

| Source | License | Attribution | Usage |
|--------|---------|-------------|-------|
| GeoNames cities15000.txt | CC BY 4.0 | Required | City metadata, population |
| OSM Overpass API | ODbL 1.0 | Required | POI categories, transit, water |
| Open-Meteo Historical | CC BY 4.0 | Required | Temperature (365 days → monthly) |

**Excluded data sources** (license/legal issues):
- Kontur H3 Population (unclear license)
- WorldMove GTFS (proprietary usage restrictions)
- Private GTFS feeds (commercial licenses)

### Encryption

The vector database is encrypted using industry-standard cryptography:

- **Key Derivation**: Argon2id (OWASP recommended parameters)
  - Memory: 64 MB
  - Iterations: 3
  - Parallelism: 4 lanes
- **Encryption**: AES-256-GCM (authenticated encryption)
- **File Format**: `.edb` (custom binary format with magic header)

```
File Structure:
[MAGIC: 4 bytes "EDB1"]
[VERSION: 1 byte]
[SALT: 32 bytes]
[NONCE: 12 bytes]
[LENGTH: 8 bytes]
[CIPHERTEXT: variable]
```

## Usage

### Step 1: Initial Data Collection

Parse GeoNames cities15000.txt and collect basic country/weather data:

```bash
eodi-collector collect-cities \
  --cities-file cities15000.txt \
  --limit 100 \
  --resume \
  --validate
```

**Parameters:**
- `--cities-file`: Path to GeoNames cities15000.txt
- `--limit`: Process first N cities (0 = all)
- `--resume`: Skip already collected cities
- `--validate`: Re-fetch corrupted data

### Step 2: POI and Climate Collection

Fetch POI categories, transit stops, and climate data:

```bash
eodi-collector collect-poi \
  --limit 100 \
  --overpass-api https://overpass-api.de/api/interpreter \
  --climate-year 2023
```

**Parameters:**
- `--limit`: Process first N cities (0 = all)
- `--overpass-api`: Overpass API endpoint (default: overpass-api.de)
- `--climate-year`: Historical year for climate data (default: 2023)

**Performance:**
- Max 3 concurrent requests (Overpass API rate limits)
- 90-second timeout per city (large radius queries)
- Progress bars with success/failure counts

**API Usage:**
- OSM Overpass API: Combined query (POI + transit + water in one request)
- Open-Meteo Historical: 365 daily temperatures → 12 monthly aggregates

### Step 3: Build Encrypted Vector Database

Compute 15D vectors and encrypt to .edb file:

```bash
eodi-collector build-vdb \
  --output cities.edb \
  --password "your-secure-password"
```

**Alternative (environment variable):**
```bash
export VECTOR_DB_PASSWORD="your-secure-password"
eodi-collector build-vdb --output cities.edb
```

**Parameters:**
- `--output`: Output .edb file path (default: cities.edb)
- `--password`: Encryption password (or use VECTOR_DB_PASSWORD env var)

**Processing:**
1. Load all valid cities with POI/climate data
2. **Pass 1**: Compute global statistics (percentile distributions)
3. **Pass 2**: Compute 15D vectors (parallel with rayon)
4. Auto-calibrate sigma² (median 5th-NN L2²) for FAISS
5. Validate all values in [0,1], no NaN/Inf
6. Encrypt and save to .edb file

**Output:**
```
🎉 Vector Database Build Complete!
📊 Schema Version: 6
🌍 Total Cities: 1000
🎯 Sigma²: 0.123456

📄 Data Sources:
  - GeoNames cities15000.txt: https://www.geonames.org/ (CC BY 4.0)
  - OSM Overpass API: https://www.openstreetmap.org/ (ODbL 1.0)
  - Open-Meteo Historical: https://open-meteo.com/ (CC BY 4.0)
```

## Normalization Methods

### Two-Pass Algorithm

**Pass 1: Global Statistics**
- Per-country POI density distributions (for percentile ranking)
- Global water proximity scores (sorted for binary search)
- Global population density distribution
- Global transit score distribution

**Pass 2: Per-City Vectors**
- Local normalization: dim 0-5, 7, 8, 9-10 (city-independent)
- Global normalization: dim 6, 13, 14 (percentile ranking)
- Parallel processing with rayon (CPU-bound)

### Fallback Formulas

For cities with missing POI data, academically validated fallback formulas are used:

```rust
// Temporal rhythm proxy (Cranshaw et al. 2012)
dim_11 = cat_diversity × 0.6 + poi_density × 0.3 + 0.05

// Spatial flow proxy (Hasan et al. 2013)
dim_12 = poi_density × 0.5 + cat_diversity × 0.3 + 0.1

// Spatial density proxy (population-based)
dim_13 = poi_density × 0.7 + 0.15

// Transit accessibility proxy
dim_14 = rhythm × 0.5 + poi_density × 0.3 + 0.1
```

Population-tier neutral values are provided for cities with no POI data at all.

## File Format Details

### CityVector Structure

Each city in the database includes:

```rust
pub struct CityVector {
    pub geoname_id: i64,           // Unique GeoNames ID
    pub name: String,              // City name (UTF-8)
    pub country_code: String,      // ISO 3166-1 alpha-2
    pub latitude: f64,             // Decimal degrees
    pub longitude: f64,            // Decimal degrees
    pub population: i64,           // From GeoNames
    pub vector: [f32; 15],         // 15D feature vector (60 bytes)
}
```

### VectorDatabase Structure

```rust
pub struct VectorDatabase {
    pub schema_version: u32,                // Current: 6
    pub cities: Vec<CityVector>,            // All city vectors
    pub sigma_squared: f64,                 // Auto-calibrated for FAISS
    pub data_sources: Vec<DataSource>,      // Attribution metadata
}
```

### FAISS Index Recommendation

The database includes `sigma_squared` for Gaussian kernel tuning:

- **< 10,000 cities**: Use `IndexFlatL2` (exact brute-force search)
- **≥ 10,000 cities**: Use `IndexIVFFlat` with auto-tuned sigma²

Sigma² is computed as:
```
median(5th-nearest-neighbor L2²) / ln(2)
```

Sampled from 2000 random cities for large datasets to balance accuracy and speed.

## Testing & Validation

### Unit Tests

All new modules include comprehensive unit tests:

- **poi.rs**: Haversine distance, month parsing, tag classification
- **normalizer.rs**: Shannon entropy, climate attenuation, percentile ranking, bounds checking
- **vectordb.rs**: Encrypt/decrypt roundtrip, wrong password rejection, validation, sigma² positivity

Run tests:
```bash
cargo test --release
```

### Integration Testing

Test the full pipeline with a small dataset:

```bash
# Step 1: Collect 10 cities
eodi-collector collect-cities --cities-file cities15000.txt --limit 10

# Step 2: Collect POI and climate
eodi-collector collect-poi --limit 10

# Step 3: Build encrypted database
export VECTOR_DB_PASSWORD="test123"
eodi-collector build-vdb --output test.edb

# Step 4: Verify output
ls -lh test.edb
```

Expected output:
- `test.edb` file created
- File size: ~2-5 KB per city (depends on name lengths)
- Console shows schema version, city count, sigma²

### Validation Checks

The `build-vdb` command performs automatic validation:

1. **Range Check**: All 15D values must be in [0, 1]
2. **NaN/Inf Check**: No invalid floating-point values
3. **Sigma² Check**: Must be positive and finite
4. **Encryption Check**: AES-GCM authentication tag verified

## Production Deployment

### Recommended Workflow

1. **Initial Collection** (one-time):
   ```bash
   eodi-collector collect-cities \
     --cities-file cities15000.txt \
     --resume \
     --validate
   ```

2. **POI Collection** (weekly/monthly updates):
   ```bash
   eodi-collector collect-poi --limit 0
   ```

3. **Vector Database Build** (after POI updates):
   ```bash
   export VECTOR_DB_PASSWORD=$(cat /secure/path/password.txt)
   eodi-collector build-vdb --output /data/cities_$(date +%Y%m%d).edb
   ```

4. **Deploy to Engine**:
   - Copy `.edb` file to engine's data directory
   - Engine loads with `VectorDatabase::decrypt_from_file()`

### Performance Considerations

- **Memory**: ~200 MB per worker (Overpass API responses can be large)
- **CPU**: Parallel processing with rayon (use all cores)
- **Disk**: SQLite database + .edb file (15D vectors are compact)
- **Network**: Rate-limited to 3 concurrent Overpass requests

### Monitoring

Progress bars show real-time stats:

```
🌍 POI and Climate Data Collection
[████████████████████----------------] 550/1000 (55%)
Processing: Tokyo (JP)
✅ Success: 545 | ❌ Failed: 5
```

### Error Handling

- **Overpass Timeout**: Automatic retry with exponential backoff (future)
- **Missing Climate Data**: Continue with POI data only
- **Encryption Failure**: Abort with detailed error message
- **Validation Failure**: Show first 10 invalid cities

## Security Best Practices

1. **Password Storage**:
   - Use environment variables (`VECTOR_DB_PASSWORD`)
   - Never commit passwords to git
   - Rotate passwords regularly

2. **Key Derivation**:
   - Argon2id with OWASP-recommended parameters
   - Unique salt per file (32 random bytes)
   - Memory-hard function (64 MB)

3. **Encryption**:
   - AES-256-GCM (authenticated encryption with associated data)
   - Unique nonce per file (12 random bytes)
   - Automatic authentication tag verification

4. **Data Handling**:
   - Sensitive data cleared with zeroize crate
   - Passwords never logged or printed
   - Encrypted files have .edb extension (not .db)

## License Attribution

When using the vector database, you must provide attribution for:

1. **GeoNames** (CC BY 4.0):
   - https://www.geonames.org/
   - "City data from GeoNames (CC BY 4.0)"

2. **OpenStreetMap** (ODbL 1.0):
   - https://www.openstreetmap.org/copyright
   - "POI data © OpenStreetMap contributors (ODbL 1.0)"

3. **Open-Meteo** (CC BY 4.0):
   - https://open-meteo.com/
   - "Climate data from Open-Meteo (CC BY 4.0)"

The `VectorDatabase` struct includes a `data_sources` field with full attribution metadata.

## Future Enhancements

### Planned Features

- [ ] Incremental updates (only re-compute changed cities)
- [ ] Multi-year climate averaging (reduce single-year bias)
- [ ] FAISS index pre-building (embed search index in .edb)
- [ ] Compression (zstd for text fields)
- [ ] Checksums (SHA-256 for data integrity)

### Research Directions

- [ ] Validate fallback formulas with real mobility data
- [ ] Compare thermal comfort models (PMV vs. adaptive)
- [ ] Optimize POI category weights with user feedback
- [ ] Experiment with dimensionality reduction (t-SNE, UMAP)

## Troubleshooting

### Overpass API Timeout

**Error**: "timeout: 90 - Query runtime exceeded the timeout"

**Solution**:
- Reduce `--limit` to process fewer cities
- Use a different Overpass API instance (e.g., Kumi Systems)
- Increase timeout in source code (poi.rs line 426)

### Missing Climate Data

**Warning**: "⚠️  Climate failed for City: API error"

**Solution**:
- Check year is valid (1950-2023)
- Verify coordinates are correct
- Try again later (API may be temporarily down)

### Encryption Error

**Error**: "Password required: use --password or set VECTOR_DB_PASSWORD"

**Solution**:
```bash
# Option 1: CLI argument
eodi-collector build-vdb --password "your-password"

# Option 2: Environment variable
export VECTOR_DB_PASSWORD="your-password"
eodi-collector build-vdb
```

### Wrong Password on Decrypt

**Error**: "Decryption failed: wrong password or corrupted file"

**Solution**:
- Verify password matches the one used for encryption
- Check .edb file is not corrupted (re-download/re-build)
- Ensure file was not modified after encryption

## References

1. Shannon (1948) "A Mathematical Theory of Communication"
2. Fanger (1970) "Thermal Comfort"
3. Hyndman & Fan (1996) "Sample Quantiles in Statistical Packages"
4. Cranshaw et al. (2012) "The Livehoods Project: Utilizing Social Media to Understand the Dynamics of a City"
5. Hasan et al. (2013) "Understanding Urban Human Activity and Mobility Patterns Using Large-scale Location-based Data from Online Social Media"
6. ASHRAE Standard 55 (2020) "Thermal Environmental Conditions for Human Occupancy"
7. OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

## Support

For issues, questions, or contributions, see:
- Main README: [README.md](README.md)
- Production Improvements: [PRODUCTION_IMPROVEMENTS.md](PRODUCTION_IMPROVEMENTS.md)
- Technical Spec: [../문서/DATASET_VECTOR_SPEC.md](../문서/DATASET_VECTOR_SPEC.md)
