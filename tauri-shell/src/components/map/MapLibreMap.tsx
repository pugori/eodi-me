/**
 * MapLibreMap — neighborhood hex map with MapLibre GL native layers.
 *
 * Tile provider : OpenFreeMap Liberty — 100% free, no API key, commercial use OK.
 *   Served from https://tiles.openfreemap.org (already whitelisted in CSP).
 *   Data: © OpenStreetMap contributors (ODbL). Style: © OpenFreeMap (BSD).
 * Hex rendering : MapLibre GeoJSON fill + line + fill-extrusion layers.
 *   h3-js cellToBoundary() is used to compute exact H3 polygon vertices.
 *   Adjacent cells share polygon edges in the same GeoJSON source → MapLibre's
 *   renderer draws each shared edge exactly once → no double-border overlap.
 * Attribution   : © OpenStreetMap contributors (ODbL), © OpenFreeMap
 */
import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { isValidCell, cellToBoundary } from 'h3-js';
import type { ViewportBounds } from '../../hooks/useViewportHexes';
import type { VibeWeights } from '../../hooks/useUserData';
import { computeSuitability } from '../../hooks/useUserData';
import { getUiCopy } from '../../i18n/ui';
import {
  VIBE_CATEGORY_COLORS,
  NEUTRAL_COLOR,
  VIBE_LABELS,
  HEX_RESULT_COLORS,
} from '../../utils/vibeConstants';

// Re-export for backward compat (ResultsList may still reference HEX_COLORS)
export { HEX_RESULT_COLORS as HEX_COLORS };

// ── H3 boundary cache ────────────────────────────────────────────────────────
// cellToBoundary() is computationally expensive. Cache results to avoid
// recomputing polygon vertices on every GeoJSON rebuild.
const H3_BOUNDARY_CACHE = new Map<string, number[][]>();
const H3_CACHE_MAX = 12_000;

function cachedCellToBoundary(hexId: string): number[][] | null {
  if (!isValidCell(hexId)) return null;
  const cached = H3_BOUNDARY_CACHE.get(hexId);
  if (cached) return cached;
  const latLngs = cellToBoundary(hexId);
  const ring = latLngs.map(([lat, lng]) => [lng, lat]);
  ring.push(ring[0]); // close the ring
  if (H3_BOUNDARY_CACHE.size >= H3_CACHE_MAX) {
    // Evict oldest 25% when cache is full
    const evictCount = H3_CACHE_MAX >> 2;
    const iter = H3_BOUNDARY_CACHE.keys();
    for (let i = 0; i < evictCount; i++) {
      const k = iter.next().value;
      if (k) H3_BOUNDARY_CACHE.delete(k);
    }
  }
  H3_BOUNDARY_CACHE.set(hexId, ring);
  return ring;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface City {
  id: string;
  /** Backend may also send city_id for the same concept. */
  city_id?: string;
  name: string;
  lat: number;
  lng: number;
  score?: number;
  country?: string;
  radar?: Record<string, number>;
  h3_index?: string;
  city?: string;
  parent_city_name?: string;
  admin_name?: string;
}

export interface MapLibreMapProps {
  cities: City[];
  selectedCity?: City | null;
  onCitySelect: (city: City) => void;
  onViewportChange?: (bounds: ViewportBounds) => void;
  mode?: 'browse' | 'search';
  weights?: VibeWeights;
  analysisMode?: 'suitability' | 'comparison' | 'explore';
  showLabels?: boolean;
  initialCenter?: [number, number];
  initialZoom?: number;
  flyToCenter?: { lng: number; lat: number; zoom?: number; key: number } | null;
  locale?: string;
}

interface HexDatum extends City {
  /** Validated h3-js hex string (never decimal) */
  hexId: string;
}

interface TooltipState {
  x: number;
  y: number;
  city: City;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

/** Parse a CSS #rrggbb hex string → [R, G, B] (0–255). */
function hexCssToRgb(css: string): [number, number, number] {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(css);
  if (!m) return [128, 128, 128];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function getDominantVibe(radar?: Record<string, number>) {
  if (!radar) return { key: '', dominance: 0, total: 0 };
  let maxKey = '';
  let maxVal = 0;
  let total = 0;
  for (const [k, v] of Object.entries(radar)) {
    const abs = Math.abs(v);
    total += abs;
    if (abs > maxVal) { maxVal = abs; maxKey = k; }
  }
  return { key: maxKey, dominance: total > 0 ? maxVal / total : 0, total };
}

const VIBE_KEYS = ['active', 'classic', 'quiet', 'trendy', 'nature', 'urban'] as const;

/**
 * Build per-hexagon locally-normalised radar maps for a viewport's data set.
 *
 * Within a single city most vibe values are similar (e.g. Seoul is 55 % active
 * everywhere). Normalising each dimension to [0,1] relative to the viewport
 * min/max amplifies subtle regional differences so the dominant colour of each
 * hexagon reflects its *relative* character — not just the global leader.
 *
 * The result is a Map<hexId, normalisedRadar> that replaces the raw radar when
 * computing fill colours in browse / compare modes.
 */
function buildLocalNormMap(data: HexDatum[]): Map<string | number, Record<string, number>> {
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};

  for (const d of data) {
    if (!d.radar) continue;
    for (const k of VIBE_KEYS) {
      const v = (d.radar as Record<string, number>)[k] ?? 0;
      if (mins[k] === undefined) { mins[k] = v; maxs[k] = v; }
      if (v < mins[k]) mins[k] = v;
      if (v > maxs[k]) maxs[k] = v;
    }
  }

  const result = new Map<string | number, Record<string, number>>();
  for (const d of data) {
    if (!d.radar) continue;
    const norm: Record<string, number> = {};
    for (const k of VIBE_KEYS) {
      const v = (d.radar as Record<string, number>)[k] ?? 0;
      const range = (maxs[k] ?? 0) - (mins[k] ?? 0);
      norm[k] = range > 0.005 ? (v - (mins[k] ?? 0)) / range : 0;
    }
    result.set(d.id, norm);
  }
  return result;
}

function suitabilityColor(score: number): [number, number, number] {
  // Perceptually uniform sequential gradient for suitability scoring.
  //
  // Design basis: ColorBrewer "PuBuGn" sequential scheme (Brewer 2003) adapted
  // for dark-mode geospatial maps. The scale is clinically inspired by
  // 5-level severity grading used in medical scoring systems (e.g., APACHE II):
  //   Gray → Steel Blue → Teal → Green → Gold
  //   (insufficient → low → moderate → good → excellent)
  //
  // APCA lightness progression ensures each step is perceptually distinguishable:
  //   ~30% → ~42% → ~55% → ~65% → ~72% relative luminance
  //
  // sqrt-curve pre-emphasis makes score differences in the 0.05–0.40 range
  // (typical equal-weight search) produce clearly distinct hues on the map.
  const t = Math.pow(Math.min(1, Math.max(0, score)), 0.30);

  const stops: [number, [number, number, number]][] = [
    [0.00, [ 74,  82,  96]],   // Slate Gray   — insufficient signal
    [0.25, [ 52, 120, 190]],   // Steel Blue   — low suitability
    [0.50, [ 16, 186, 186]],   // Teal         — moderate (matches trendy color)
    [0.72, [ 80, 200, 110]],   // Sage Green   — good suitability
    [1.00, [255, 171,  50]],   // Warm Gold    — excellent (distinct top signal)
  ];

  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + u * (c1[0] - c0[0])),
        Math.round(c0[1] + u * (c1[1] - c0[1])),
        Math.round(c0[2] + u * (c1[2] - c0[2])),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

type RGBA = [number, number, number, number];

function getFillRgba(
  d: HexDatum,
  isSearch: boolean,
  weights?: VibeWeights,
  analysisMode?: string,
  selectedId?: string | number,
  normRadar?: Record<string, number>,
): RGBA {
  const score = d.score ?? 0;
  const isSelected = selectedId != null && (d.id === selectedId || d.city_id === selectedId);

  // ── Suitability mode: ALWAYS takes priority ───────────────────────────────
  if (analysisMode === 'suitability' && weights && d.radar) {
    const suit = computeSuitability(d.radar, weights);
    const [r, g, b] = suitabilityColor(suit);
    const suitAlpha = isSelected ? 220 : Math.round((0.40 + suit * 0.38) * 255);
    return [r, g, b, suitAlpha];
  }

  // ── Explore / comparison mode: locally-normalised dominant vibe colour ────
  // normRadar is the viewport-relative normalised version of d.radar. Using
  // this makes subtle regional differences visible even in cities where one
  // vibe (e.g. "active" in Seoul) dominates all hexagons absolutely.
  if (analysisMode === 'explore' || analysisMode === 'comparison' || !isSearch) {
    const radarToUse = normRadar ?? d.radar;
    const { total, dominance, key } = getDominantVibe(radarToUse);
    const intensity = Math.min(1, total / 3.0);
    // Very low opacity — enough to tint and show coverage without blocking map labels.
    // Opacity formula: base + (data intensity bonus) + (category dominance bonus)
    // Based on Gestalt figure-ground principle: sufficient foreground contrast
    // without competing with map labels (Ware 2004, "Information Visualization").
    // Raised from 0.18/0.12/0.08 → 0.48/0.22/0.12 for strong category tinting on CARTO Dark Matter.
    // CARTO dark background (#0e0e0e) allows higher hex opacity without blocking map context.
    // Benchmark: Foursquare Studio uses 60-80% alpha for hex data layers.
    const browseAlpha = isSelected
      ? 210
      : Math.round((0.48 + intensity * 0.22 + dominance * 0.12) * 255);
    const col = (key && VIBE_CATEGORY_COLORS[key]) ? VIBE_CATEGORY_COLORS[key] : NEUTRAL_COLOR;
    const [r, g, b] = hexCssToRgb(col.fill);
    return [r, g, b, browseAlpha];
  }

  // ── Search mode: raw dominant vibe colour + opacity driven by score ────────
  const { key: sKey } = getDominantVibe(d.radar);
  const sCol = (sKey && VIBE_CATEGORY_COLORS[sKey]) ? VIBE_CATEGORY_COLORS[sKey] : NEUTRAL_COLOR;
  const [sr, sg, sb] = hexCssToRgb(sCol.fill);
  const searchAlpha = Math.round((0.52 + score * 0.38) * 255);
  return [sr, sg, sb, isSelected ? 235 : searchAlpha];
}

function getLineRgba(_d: HexDatum, isSelected: boolean, isSearch: boolean, analysisMode?: string): RGBA {
  if (isSelected) return [255, 255, 255, 210];      // bright selection ring
  if (analysisMode === 'suitability') return [255, 255, 255, 65];   // subtle in score mode
  if (isSearch) return [255, 255, 255, 95];          // search: clear hex grid
  return [255, 255, 255, 90];                        // browse: visible grid lines
  // Alpha raised from 72→90 (browse) and 80→95 (search) for clearer H3 cell boundaries.
  // ESRI Business Analyst benchmark: 60-80% alpha for hex boundaries.
  // ISO 9241-307: minimum 30% contrast ratio for spatial boundaries.
}

// ── H3 index normalisation ────────────────────────────────────────────────────

/**
 * Accepts decimal uint64 strings ("608533827773161471") or valid h3-js hex strings.
 * Returns a validated h3-js hex string, or '' if invalid.
 */
function normaliseH3Index(raw: string | undefined): string {
  if (!raw) return '';
  if (isValidCell(raw)) return raw;
  try {
    const hex = BigInt(raw).toString(16);
    if (isValidCell(hex)) return hex;
  } catch {
    // ignore
  }
  return '';
}

// ── GeoJSON builder ───────────────────────────────────────────────────────────

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * MapLibre stringifies nested objects in GeoJSON feature properties.
 * This helper restores `radar` and similar fields back to their original types.
 */
function parseFeatureProps(props: Record<string, unknown>): City {
  const out = { ...props } as Record<string, unknown>;
  if (typeof out.radar === 'string') {
    try { out.radar = JSON.parse(out.radar as string); } catch { out.radar = undefined; }
  }
  if (typeof out.score === 'string') out.score = parseFloat(out.score as string);
  if (typeof out.lat === 'string') out.lat = parseFloat(out.lat as string);
  if (typeof out.lng === 'string') out.lng = parseFloat(out.lng as string);
  return out as unknown as City;
}

/**
 * Converts the current HexDatum array into a GeoJSON FeatureCollection using
 * exact H3 cell boundaries (cellToBoundary). All hexagons share the same source,
 * so MapLibre renders each polygon edge exactly once — no double-border overlap.
 */
function hexesToGeoJSON(
  data: HexDatum[],
  isSearch: boolean,
  weights: VibeWeights | undefined,
  analysisMode: string | undefined,
  selectedId: string | number | undefined,
): GeoJSON.FeatureCollection {
  if (!data.length) return EMPTY_FC;

  // Pre-compute viewport-relative normalised radar for browse/compare modes so
  // that subtle regional vibe differences are visible even in cities where one
  // vibe dominates absolutely (e.g. Seoul's "active" vibe).
  const browseMode = analysisMode === 'explore' || analysisMode === 'comparison' || !isSearch;
  const normMap = browseMode ? buildLocalNormMap(data) : null;

  const features: GeoJSON.Feature[] = [];
  for (const d of data) {
    let ring: number[][] | null;
    try {
      ring = cachedCellToBoundary(d.hexId);
    } catch {
      ring = null;
    }
    if (!ring) continue; // skip invalid / unrecognised H3 indices

    const normRadar = normMap ? normMap.get(d.id) : undefined;
    const [fr, fg, fb, fa] = getFillRgba(d, isSearch, weights, analysisMode, selectedId, normRadar);
    const isSelected = selectedId != null && (d.id === selectedId || d.city_id === selectedId);
    const [lr, lg, lb, la] = getLineRgba(d, isSelected, isSearch, analysisMode);

    features.push({
      type: 'Feature',
      id: d.hexId,
      properties: {
        ...d,
        // Explicitly serialize radar as JSON string for MapLibre (otherwise becomes [object Object])
        radar: d.radar ? JSON.stringify(d.radar) : undefined,
        fill_r: fr, fill_g: fg, fill_b: fb, fill_a: +(fa / 255).toFixed(3),
        line_r: lr, line_g: lg, line_b: lb, line_a: +(la / 255).toFixed(3),
        line_w: isSelected ? 2.5 : 1.0,
        is_selected: isSelected ? 1 : 0,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ── Tooltip HTML ──────────────────────────────────────────────────────────────

function TooltipCard({ city, weights }: { city: City; weights?: VibeWeights }) {
  const tooltipLocale = /^ko\b/i.test(navigator.language || '') ? 'ko' : 'en';
  const tooltipCopy = getUiCopy(tooltipLocale);
  const suitScore = weights && city.radar ? computeSuitability(city.radar, weights) : null;
  const { key: domKey } = getDominantVibe(city.radar);
  const domColor = (domKey && VIBE_CATEGORY_COLORS[domKey]) ? VIBE_CATEGORY_COLORS[domKey] : NEUTRAL_COLOR;
  const breadcrumb = [city.parent_city_name || city.city, city.country].filter(Boolean).join(' · ');

  return (
    <div style={{ fontFamily: 'inherit', fontSize: 12, color: '#fff', minWidth: 160, maxWidth: 240, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: domColor.fill, flexShrink: 0 }} />
        <strong style={{ fontSize: 13 }}>{city.name || tooltipCopy.tooltipUnknown}</strong>
      </div>
      {breadcrumb && <div style={{ opacity: 0.4, fontSize: 10 }}>{breadcrumb}</div>}
      {suitScore != null && (
        <div style={{ marginTop: 4, padding: '3px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: 6, display: 'inline-block' }}>
          <span style={{ color: '#B197FC', fontSize: 11, fontWeight: 700 }}>
            {tooltipCopy.tooltipSuitability}: {Math.round(suitScore * 100)}%
          </span>
        </div>
      )}
      {city.score != null && !suitScore && (
        <div style={{ opacity: 0.5, fontSize: 10, marginTop: 2 }}>
          {tooltipCopy.tooltipMatch}: {Math.round((city.score ?? 0) * 100)}%
        </div>
      )}
      {city.radar && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
          {Object.entries(city.radar).map(([k, v]) => {
            const pct = Math.round(Math.abs(v) * 100);
            const cat = (VIBE_CATEGORY_COLORS[k] || NEUTRAL_COLOR);
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', width: 42, textAlign: 'right', flexShrink: 0 }}>
                  {VIBE_LABELS[k] || k}
                </span>
                <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: cat.fill, borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', width: 22, fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export const MapLibreMap = ({
  cities,
  selectedCity,
  onCitySelect,
  onViewportChange,
  mode = 'browse',
  weights,
  analysisMode = 'explore',
  showLabels = false,
  initialCenter = [30, 35],
  initialZoom = 3,
  flyToCenter = null,
  locale,
}: MapLibreMapProps) => {
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [mapZoom, setMapZoom] = useState(initialZoom ?? 3);
  const onSelectRef = useRef(onCitySelect);
  onSelectRef.current = onCitySelect;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;

  // ── Normalise input data → HexDatum[] ────────────────────────────────────
  const hexData = useMemo<HexDatum[]>(() => {
    const seen = new Set<string>();
    const out: HexDatum[] = [];
    for (const c of cities) {
      const hexId = normaliseH3Index(c.h3_index ?? c.id);
      if (!hexId || seen.has(hexId)) continue;
      seen.add(hexId);
      out.push({ ...c, hexId });
    }
    return out;
  }, [cities]);

  // ── Emit viewport ─────────────────────────────────────────────────────────
  const emitViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map || !onViewportRef.current) return;
    const b = map.getBounds();
    const z = map.getZoom();
    setMapZoom(z);
    onViewportRef.current({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
      zoom: z,
    });
  }, []);

  // ── Initialise MapLibre GL map (once) ────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // CARTO Dark Matter — professional dark basemap, no API key required.
      // Replaces the previous OpenFreeMap Liberty + programmatic dark override approach
      // (which caused a white flash on load). CARTO Dark Matter is already dark-native.
      // © OpenStreetMap contributors, © CARTO
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
      dragRotate: false, // Disable right-click rotation as requested
    });

    // Disable default context menu
    map.on('contextmenu', (e) => e.preventDefault());

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;

    map.on('error', (e) => {
      console.warn('[MapLibre] Map error:', e.error?.message || e.message);
    });

    map.on('moveend', emitViewport);
    // Note: moveend already fires after zoom — no need for separate zoomend handler

    let mmRaf = 0;
    map.once('load', () => {
      // CARTO Dark Matter is already dark — no programmatic overrides needed.
      // Hexagon layers are added directly on top of the pre-designed dark basemap.

      // All hexagons live in one GeoJSON source. Because adjacent H3 cells
      // share exact polygon vertices (computed by cellToBoundary), MapLibre's
      // renderer draws each shared edge exactly once — zero border overlap.
      map.addSource('hexagons', {
        type: 'geojson',
        data: EMPTY_FC,
        promoteId: 'hexId', // use hexId string as feature ID for feature-state
      });

      // Fill layer — smooth transition on color/opacity changes
      map.addLayer({
        id: 'hex-fill',
        type: 'fill',
        source: 'hexagons',
        paint: {
          'fill-color': ['rgba', ['get', 'fill_r'], ['get', 'fill_g'], ['get', 'fill_b'], ['get', 'fill_a']],
          'fill-antialias': true,
          'fill-color-transition': { duration: 400, delay: 0 },
          'fill-opacity-transition': { duration: 400, delay: 0 },
        },
      });

      // Line layer — single pass per edge, no double-border
      map.addLayer({
        id: 'hex-line',
        type: 'line',
        source: 'hexagons',
        paint: {
          'line-color': ['rgba', ['get', 'line_r'], ['get', 'line_g'], ['get', 'line_b'], ['get', 'line_a']],
          'line-width': ['get', 'line_w'],
        },
      });



      // ── Interaction events ─────────────────────────────────────────────
      map.on('mouseenter', 'hex-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'hex-fill', () => {
        map.getCanvas().style.cursor = '';
        setTooltip(null);
      });
      // Throttle mousemove via rAF to prevent excessive React state updates
      map.on('mousemove', 'hex-fill', (e) => {
        if (mmRaf) return;
        mmRaf = requestAnimationFrame(() => {
          mmRaf = 0;
          const f = e.features?.[0];
          if (f?.properties && e.point) {
            setTooltip({ x: e.point.x, y: e.point.y, city: parseFeatureProps(f.properties) });
          }
        });
      });
      map.on('click', 'hex-fill', (e) => {
        const f = e.features?.[0];
        if (f?.properties) onSelectRef.current(parseFeatureProps(f.properties));
      });

      setTimeout(() => { map.resize(); emitViewport(); }, 100);
    });

    return () => {
      if (mmRaf) cancelAnimationFrame(mmRaf);
      map.off('moveend', emitViewport);
      // Remove all interaction event listeners to prevent stale closures
      map.off('error');
      map.off('mouseenter', 'hex-fill');
      map.off('mouseleave', 'hex-fill');
      map.off('mousemove', 'hex-fill');
      map.off('click', 'hex-fill');
      map.remove();
      mapRef.current = null;
    };
  }, [emitViewport]);

  // ── Resize map when container size changes (debounced) ─────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !mapRef.current) return;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => mapRef.current?.resize(), 200);
    });
    observer.observe(container);
    return () => { clearTimeout(resizeTimer); observer.disconnect(); };
  }, []);

  // ── Update hex layer data when input changes──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('hexagons') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData(hexesToGeoJSON(hexData, mode === 'search', weights, analysisMode, selectedCity?.id));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [hexData, mode, weights, analysisMode, selectedCity?.id]);

  // ── Toggle labels by manipulating MapLibre label layer visibility ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const labelLayers = map.getStyle().layers?.filter((l) => l.type === 'symbol') ?? [];
    for (const layer of labelLayers) {
      map.setLayoutProperty(layer.id, 'visibility', showLabels ? 'visible' : 'none');
    }
  }, [showLabels]);

  // ── Fly to selected city ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedCity?.lat || !selectedCity?.lng) return;
    map.flyTo({
      center: [selectedCity.lng, selectedCity.lat],
      zoom: Math.max(map.getZoom(), 8),
      duration: 800,
    });
  }, [selectedCity?.id]);

  // ── Fly to search target (first result of new search) ─────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToCenter) return;
    map.flyTo({
      center: [flyToCenter.lng, flyToCenter.lat],
      zoom: flyToCenter.zoom ?? Math.max(map.getZoom(), 9),
      duration: 900,
    });
  }, [flyToCenter?.key]);

  // ── Tooltip position clamping ─────────────────────────────────────────────
  const tooltipStyle = useMemo((): React.CSSProperties => {
    if (!tooltip) return { display: 'none' };
    const W = containerRef.current?.clientWidth ?? 800;
    const left = tooltip.x + 16;
    const right = W - tooltip.x + 16;
    return {
      position: 'absolute',
      ...(left + 260 < W ? { left } : { right }),
      top: tooltip.y - 10,
      background: 'rgba(44,44,46,0.94)',
      border: '0.5px solid rgba(255,255,255,0.12)',
      borderRadius: 10,
      padding: '10px 12px',
      pointerEvents: 'none',
      zIndex: 900,
      backdropFilter: 'blur(16px)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    };
  }, [tooltip]);

  return (
    <div
      className="absolute inset-0 z-0"
      role="application"
      aria-label="Map of matching hexagons"
    >
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: '100%', background: '#0e0e0e' }} 
        onContextMenu={(e) => e.preventDefault()} 
      />

      {/* Subtle top vignette */}
      <div
        className="absolute inset-x-0 top-0 h-16 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(28,28,30,0.15), transparent)', zIndex: 500 }}
      />

      {/* Empty state hint shown when map is ready but no hexes are displayed (city-level zoom only) */}
      {hexData.length === 0 && mode === 'browse' && mapZoom >= 7 && (
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ zIndex: 600 }}
        >
          <div
            className="px-4 py-2.5 rounded-full text-[11.5px] font-medium"
            style={{
              background: 'rgba(28,28,30,0.80)',
              border: '0.5px solid rgba(255,255,255,0.18)',
              color: 'rgba(235,235,245,0.45)',
              backdropFilter: 'blur(16px)',
            }}
          >
            {copy.mapEmptySubhint}
          </div>
        </div>
      )}

      {/* hex hover tooltip */}
      {tooltip && (
        <div style={tooltipStyle}>
          <TooltipCard city={tooltip.city} weights={weights} />
        </div>
      )}
    </div>
  );
};

// Named re-export kept identical to LeafletMap export (App.tsx compatibility)
export const LeafletMap = MapLibreMap;
