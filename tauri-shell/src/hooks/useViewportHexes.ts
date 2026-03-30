/**
 * useViewportHexes — dynamically loads hexagons for the visible map viewport.
 *
 * On every map pan/zoom (debounced 150ms), fetches `/hex/viewport` with the
 * current bounding box and a zoom-dependent limit so that the map never
 * shows more hexagons than it can comfortably display.
 *
 * In "search" mode this hook is paused — the parent shows search results instead.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { HexResult, EngineConfig } from './useEngine';

const VIEWPORT_DEBOUNCE_MS = 150;

/** Zoom → max hexagons to show in viewport.
 *  At low zoom, show enough dots to cover the visible landmass.
 *  At high zoom, hex cells are larger so we can show more detail.
 */
function maxHexByZoom(zoom: number): number {
  if (zoom <= 3) return 500;
  if (zoom <= 5) return 800;
  if (zoom <= 7) return 1200;
  if (zoom <= 9) return 2000;
  if (zoom <= 11) return 3000;
  return 5000;
}

export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

interface UseViewportHexesReturn {
  viewportHexes: HexResult[];
  totalInView: number;
  loading: boolean;
  onViewportChange: (bounds: ViewportBounds) => void;
  refreshViewport: () => void;
  /** When true, viewport loading is paused (search mode) */
  paused: boolean;
  setPaused: (v: boolean) => void;
}

export function useViewportHexes(
  engineConfig: EngineConfig | null,
): UseViewportHexesReturn {
  const [viewportHexes, setViewportHexes] = useState<HexResult[]>([]);
  const [totalInView, setTotalInView] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastBoundsRef = useRef<ViewportBounds | null>(null);
  const hexCountRef = useRef(0);
  hexCountRef.current = viewportHexes.length;

  const fetchViewport = useCallback(
    async (bounds: ViewportBounds) => {
      if (!engineConfig || paused) {
        abortRef.current?.abort();
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const limit = maxHexByZoom(bounds.zoom);
      const baseUrl = engineConfig.base_url || '';
      const headers: Record<string, string> = {};
      if (engineConfig.token) headers['Authorization'] = `Bearer ${engineConfig.token}`;

      // Stale-while-revalidate: keep previous hexagons visible during fetch
      // Only show loading=true on the very first load (no existing data)
      if (hexCountRef.current === 0) setLoading(true);
      try {
        const url =
          `${baseUrl}/hex/viewport?north=${bounds.north}&south=${bounds.south}` +
          `&east=${bounds.east}&west=${bounds.west}&limit=${limit}`;

        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`viewport ${res.status}`);

        const data = await res.json();
        const hexes: HexResult[] = (data.hexagons || []).map(
          (h: any, idx: number) => ({
            id: h.h3_index || `v-${idx}`,
            city_id: h.h3_index,
            name: h.admin_name || h.city || 'Unknown',
            city: h.city,
            parent_city_name: h.city,
            country: h.country,
            lat: h.lat ?? 0,
            lng: h.lng ?? h.lon ?? 0,
            score: 1.0,
            match_reason: '',
            radar: h.radar,
            admin_name: h.admin_name,
            admin_level: h.admin_level,
            h3_index: h.h3_index,
          }),
        );

        setViewportHexes(hexes);
        setTotalInView(data.total_in_view || hexes.length);
      } catch (err: unknown) {
        const e = err as Error;
        if (e?.name !== 'AbortError') {
          console.warn('[useViewportHexes] fetch failed:', e?.message ?? err);
        }
      } finally {
        setLoading(false);
      }
    },
    [engineConfig, paused],
  );

  const onViewportChange = useCallback(
    (bounds: ViewportBounds) => {
      lastBoundsRef.current = bounds;
      if (paused) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchViewport(bounds), VIEWPORT_DEBOUNCE_MS);
    },
    [fetchViewport, paused],
  );

  // When unpaused, refetch for current viewport
  useEffect(() => {
    if (!paused && lastBoundsRef.current) {
      fetchViewport(lastBoundsRef.current);
    }
  }, [paused, fetchViewport]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const refreshViewport = useCallback(() => {
    if (lastBoundsRef.current) {
      fetchViewport(lastBoundsRef.current);
    }
  }, [fetchViewport]);

  return {
    viewportHexes,
    totalInView,
    loading,
    onViewportChange,
    refreshViewport,
    paused,
    setPaused,
  };
}
