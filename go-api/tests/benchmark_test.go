package tests

import (
	"testing"

	"github.com/eodi-me/api-server/internal/utils"
)

func BenchmarkL2DistanceSquared(b *testing.B) {
	vec1 := make([]float32, 15)
	vec2 := make([]float32, 15)
	for i := range vec1 {
		vec1[i] = float32(i) * 0.1
		vec2[i] = float32(i) * 0.2
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = utils.L2DistanceSquared(vec1, vec2)
	}
}

func BenchmarkGaussianRBFSimilarity(b *testing.B) {
	l2Sq := 0.5
	sigmaSq := 0.15

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.GaussianRBFSimilarity(l2Sq, sigmaSq)
	}
}

func BenchmarkVectorToRadar(b *testing.B) {
	vec := make([]float32, 15)
	for i := range vec {
		vec[i] = float32(i) * 0.1
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.VectorToRadar(vec)
	}
}

func BenchmarkNormalize(b *testing.B) {
	vec := make([]float32, 15)
	for i := range vec {
		vec[i] = float32(i) * 0.1
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.Normalize(vec)
	}
}

func BenchmarkCosineSimilarity(b *testing.B) {
	vec1 := make([]float32, 15)
	vec2 := make([]float32, 15)
	for i := range vec1 {
		vec1[i] = float32(i) * 0.1
		vec2[i] = float32(i) * 0.2
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.CosineSimilarity(vec1, vec2)
	}
}

func BenchmarkFindTopK(b *testing.B) {
	distances := make([]float64, 10000)
	for i := range distances {
		distances[i] = float64(i) * 0.001
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.FindTopK(distances, 10)
	}
}
