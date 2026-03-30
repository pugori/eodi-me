package utils

import (
	"math"
)

// L2DistanceSquared calculates the squared Euclidean distance between two vectors.
// Returns (distance, true) on success or (0, false) if vectors have different lengths.
func L2DistanceSquared(a, b []float32) (float64, bool) {
	if len(a) != len(b) {
		return 0, false
	}

	var sum float64
	for i := range a {
		diff := float64(a[i] - b[i])
		sum += diff * diff
	}

	return sum, true
}

// GaussianRBFSimilarity calculates similarity using Gaussian RBF kernel.
// similarity = exp(-L2² / σ²) * 100
// Returns 0 if sigmaSquared is zero or negative to avoid division by zero.
func GaussianRBFSimilarity(l2Squared, sigmaSquared float64) float64 {
	if sigmaSquared <= 0 {
		return 0
	}
	return math.Exp(-l2Squared/sigmaSquared) * 100.0
}

// VectorToRadar converts a 15D vector to 6-axis radar chart
func VectorToRadar(vector []float32) map[string]float32 {
	if len(vector) < 6 {
		return nil
	}

	return map[string]float32{
		"active":  vector[0], // vitality
		"classic": vector[1], // culture
		"quiet":   vector[2], // relief
		"trendy":  vector[3], // rhythm
		"nature":  vector[4], // lifestyle
		"urban":   vector[5], // commercial
	}
}

// Normalize normalizes a vector to unit length
func Normalize(vector []float32) []float32 {
	var sumSq float64
	for _, v := range vector {
		sumSq += float64(v * v)
	}

	norm := math.Sqrt(sumSq)
	if norm == 0 {
		return vector
	}

	normalized := make([]float32, len(vector))
	for i, v := range vector {
		normalized[i] = float32(float64(v) / norm)
	}

	return normalized
}

// CosineSimilarity calculates cosine similarity between two vectors
func CosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) {
		return -1
	}

	var dotProduct, normA, normB float64
	for i := range a {
		dotProduct += float64(a[i] * b[i])
		normA += float64(a[i] * a[i])
		normB += float64(b[i] * b[i])
	}

	normA = math.Sqrt(normA)
	normB = math.Sqrt(normB)

	if normA == 0 || normB == 0 {
		return 0
	}

	return dotProduct / (normA * normB)
}

// FindTopK finds the indices of the k smallest values
func FindTopK(distances []float64, k int) []int {
	if k > len(distances) {
		k = len(distances)
	}

	// Create index-value pairs
	type pair struct {
		index int
		value float64
	}

	pairs := make([]pair, len(distances))
	for i, d := range distances {
		pairs[i] = pair{i, d}
	}

	// Partial sort: keep only top k
	for i := 0; i < k; i++ {
		minIdx := i
		for j := i + 1; j < len(pairs); j++ {
			if pairs[j].value < pairs[minIdx].value {
				minIdx = j
			}
		}
		if minIdx != i {
			pairs[i], pairs[minIdx] = pairs[minIdx], pairs[i]
		}
	}

	// Extract indices
	indices := make([]int, k)
	for i := 0; i < k; i++ {
		indices[i] = pairs[i].index
	}

	return indices
}

// EstimateSigmaSquared estimates sigma squared from 5th nearest neighbor
func EstimateSigmaSquared(distances []float64) float64 {
	if len(distances) < 5 {
		return 1.0
	}

	// Sort distances
	sorted := make([]float64, len(distances))
	copy(sorted, distances)
	
	// Simple insertion sort for small arrays
	for i := 1; i < len(sorted); i++ {
		key := sorted[i]
		j := i - 1
		for j >= 0 && sorted[j] > key {
			sorted[j+1] = sorted[j]
			j--
		}
		sorted[j+1] = key
	}

	// 5th nearest neighbor (index 4)
	fifthNN := sorted[4]

	// σ² = 5th_nn_L2² / ln(2)
	return fifthNN / 0.693147
}
