/**
 * useUserData — manages all user input data in localStorage.
 *
 * CRITICAL: This hook NEVER modifies the hexagon database (hexagons.edbh).
 * All user preferences, weights, bookmarks, and notes are stored
 * exclusively in browser localStorage as a separate user data layer.
 */
import { useState, useCallback, useEffect } from 'react';

// ── Vibe dimensions matching the engine's 6 radar axes ───────────────────────
export const VIBE_DIMENSIONS = [
  { key: 'active',  label: 'Active',  icon: '🏃', color: '#FFB7B2', desc: 'Sports, nightlife, events' },
  { key: 'classic', label: 'Culture', icon: '🏛️', color: '#FFE5B4', desc: 'Museums, heritage, history' },
  { key: 'quiet',   label: 'Quiet',   icon: '🧘', color: '#E2CEFF', desc: 'Parks, calm, residential' },
  { key: 'trendy',  label: 'Trendy',  icon: '✨', color: '#B2F2BB', desc: 'Cafes, shopping, modern' },
  { key: 'nature',  label: 'Nature',  icon: '🌿', color: '#C1E1C1', desc: 'Forests, lakes, mountains' },
  { key: 'urban',   label: 'Urban',   icon: '🏙️', color: '#B2E2F2', desc: 'Density, transit, commercial' },
] as const;

export type VibeDimKey = (typeof VIBE_DIMENSIONS)[number]['key'];

export interface VibeWeights {
  active: number;
  classic: number;
  quiet: number;
  trendy: number;
  nature: number;
  urban: number;
}

export interface BookmarkedHex {
  h3_index: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  note: string;
  savedAt: number;
}

export interface AnalysisPreset {
  id: string;
  name: string;
  weights: VibeWeights;
  createdAt: number;
}

export interface UserData {
  weights: VibeWeights;
  bookmarks: BookmarkedHex[];
  presets: AnalysisPreset[];
  analysisMode: 'suitability' | 'comparison' | 'explore';
  showLegend: boolean;
  showLabels: boolean;
}

const STORAGE_KEY = 'eodi_user_data';

const DEFAULT_WEIGHTS: VibeWeights = {
  active: 5,
  classic: 5,
  quiet: 5,
  trendy: 5,
  nature: 5,
  urban: 5,
};

const DEFAULT_USER_DATA: UserData = {
  weights: { ...DEFAULT_WEIGHTS },
  bookmarks: [],
  presets: [
    {
      id: 'balanced',
      name: 'Balanced',
      weights: { active: 5, classic: 5, quiet: 5, trendy: 5, nature: 5, urban: 5 },
      createdAt: 0,
    },
    {
      id: 'nightlife',
      name: 'Nightlife & Active',
      weights: { active: 9, classic: 3, quiet: 1, trendy: 8, nature: 2, urban: 7 },
      createdAt: 0,
    },
    {
      id: 'relaxation',
      name: 'Relaxation & Nature',
      weights: { active: 2, classic: 4, quiet: 9, trendy: 3, nature: 9, urban: 1 },
      createdAt: 0,
    },
    {
      id: 'culture',
      name: 'Cultural Explorer',
      weights: { active: 4, classic: 9, quiet: 5, trendy: 6, nature: 4, urban: 6 },
      createdAt: 0,
    },
  ],
  analysisMode: 'explore',
  showLegend: true,
  showLabels: true,
};

function loadUserData(): UserData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_USER_DATA, ...parsed, weights: { ...DEFAULT_WEIGHTS, ...parsed.weights } };
    }
  } catch { /* corrupt data — reset */ }
  return { ...DEFAULT_USER_DATA };
}

function saveUserData(data: UserData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

// ── Calculate weighted suitability score ─────────────────────────────────────
// Entirely client-side — no DB modifications
export function computeSuitability(
  radar: Record<string, number> | undefined,
  weights: VibeWeights,
): number {
  if (!radar) return 0.5;
  let totalWeight = 0;
  let totalScore = 0;
  for (const dim of VIBE_DIMENSIONS) {
    const w = weights[dim.key] || 0;
    const v = Math.abs(radar[dim.key] ?? 0);
    totalWeight += w;
    totalScore += w * v;
  }
  return totalWeight > 0 ? totalScore / totalWeight : 0.5;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useUserData() {
  const [userData, setUserData] = useState<UserData>(loadUserData);

  // Persist on change
  useEffect(() => {
    saveUserData(userData);
  }, [userData]);

  const setWeight = useCallback((key: VibeDimKey, value: number) => {
    setUserData((prev) => ({
      ...prev,
      weights: { ...prev.weights, [key]: Math.max(0, Math.min(10, value)) },
    }));
  }, []);

  const setWeights = useCallback((weights: VibeWeights) => {
    setUserData((prev) => ({ ...prev, weights: { ...weights } }));
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    setUserData((prev) => {
      const preset = prev.presets.find((p) => p.id === presetId);
      if (preset) return { ...prev, weights: { ...preset.weights } };
      return prev;
    });
  }, []);

  const savePreset = useCallback((name: string) => {
    setUserData((prev) => {
      const id = `custom_${Date.now()}`;
      return {
        ...prev,
        presets: [...prev.presets, { id, name, weights: { ...prev.weights }, createdAt: Date.now() }],
      };
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setUserData((prev) => ({
      ...prev,
      presets: prev.presets.filter((p) => p.id !== id || p.createdAt === 0),
    }));
  }, []);

  const addBookmark = useCallback((hex: Omit<BookmarkedHex, 'savedAt'>) => {
    setUserData((prev) => {
      if (prev.bookmarks.some((b) => b.h3_index === hex.h3_index)) return prev;
      return {
        ...prev,
        bookmarks: [...prev.bookmarks, { ...hex, savedAt: Date.now() }],
      };
    });
  }, []);

  const removeBookmark = useCallback((h3_index: string) => {
    setUserData((prev) => ({
      ...prev,
      bookmarks: prev.bookmarks.filter((b) => b.h3_index !== h3_index),
    }));
  }, []);

  const updateBookmarkNote = useCallback((h3_index: string, note: string) => {
    setUserData((prev) => ({
      ...prev,
      bookmarks: prev.bookmarks.map((b) =>
        b.h3_index === h3_index ? { ...b, note } : b,
      ),
    }));
  }, []);

  const setAnalysisMode = useCallback((mode: UserData['analysisMode']) => {
    setUserData((prev) => ({ ...prev, analysisMode: mode }));
  }, []);

  const toggleLegend = useCallback(() => {
    setUserData((prev) => ({ ...prev, showLegend: !prev.showLegend }));
  }, []);

  const toggleLabels = useCallback(() => {
    setUserData((prev) => ({ ...prev, showLabels: !prev.showLabels }));
  }, []);

  const resetWeights = useCallback(() => {
    setUserData((prev) => ({ ...prev, weights: { ...DEFAULT_WEIGHTS } }));
  }, []);

  const resetAll = useCallback(() => {
    setUserData({ ...DEFAULT_USER_DATA });
  }, []);

  return {
    ...userData,
    setWeight,
    setWeights,
    applyPreset,
    savePreset,
    deletePreset,
    addBookmark,
    removeBookmark,
    updateBookmarkNote,
    setAnalysisMode,
    toggleLegend,
    toggleLabels,
    resetWeights,
    resetAll,
  };
}
