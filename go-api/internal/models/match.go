package models

// MatchRequest represents a similarity matching request
type MatchRequest struct {
	CityID   *string   `json:"city_id,omitempty"`
	CityName *string   `json:"city_name,omitempty"`
	Vector   []float32 `json:"vector,omitempty"`
	K        int       `json:"k" binding:"min=1,max=100"`
}

// MatchResult represents a single match result
type MatchResult struct {
	CityID     string             `json:"city_id"`
	Name       string             `json:"name"`
	Similarity float64            `json:"similarity"`
	Distance   float64            `json:"distance"`
	Country    *string            `json:"country,omitempty"`
	Population *int64             `json:"population,omitempty"`
	Radar      map[string]float32 `json:"radar,omitempty"`
}

// MatchResponse represents the response for similarity matching
type MatchResponse struct {
	QueryCity     *string       `json:"query_city,omitempty"`
	Results       []MatchResult `json:"results"`
	SigmaSquared  float64       `json:"sigma_squared,omitempty"`
}
