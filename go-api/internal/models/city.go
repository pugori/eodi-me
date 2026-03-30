package models

// City represents basic city information
type City struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Population *int64   `json:"population,omitempty"`
	Country    *string  `json:"country,omitempty"`
	Lat        *float64 `json:"lat,omitempty"`
	Lon        *float64 `json:"lon,omitempty"`
}

// CityDetail represents extended city information with vector and radar
type CityDetail struct {
	City
	Vector []float32          `json:"vector,omitempty"`
	Radar  map[string]float32 `json:"radar,omitempty"`
}

// CitiesSearchRequest represents a city search request
type CitiesSearchRequest struct {
	Query   string  `form:"q" binding:"required"`
	Limit   int     `form:"limit" binding:"omitempty,min=1,max=100"`
	Country *string `form:"country"`
}

// CitiesSearchResponse represents the response for city search
type CitiesSearchResponse struct {
	Cities []City `json:"cities"`
}
