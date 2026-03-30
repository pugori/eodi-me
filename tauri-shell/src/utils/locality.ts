/**
 * Shared locality name resolution and suffix computation.
 *
 * Used by App.jsx (map labels), VibeReport.tsx (header), and ResultsList.tsx
 * (search result cards) to ensure consistent neighborhood naming and numbering.
 */
import type { HexResult } from '../hooks/useEngine';

// ── Script detection ────────────────────────────────────────────────────────

/**
 * Returns true if the string is primarily in non-Latin script
 * (Arabic, Devanagari, Thai, CJK, etc.) and would be unreadable
 * to users expecting romanized names.
 *
 * Korean (Hangul) is excluded because it is handled separately.
 */
function isNonLatinScript(s: string): boolean {
  if (!s) return false;
  // Strip whitespace, digits, punctuation — check remaining chars
  const letters = s.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return false;
  // Match common non-Latin blocks (excluding Hangul U+AC00-U+D7AF, U+1100-U+11FF)
  const nonLatin = letters.replace(/[\u0000-\u024F\u1E00-\u1EFF\uAC00-\uD7AF\u1100-\u11FF]/g, '');
  return nonLatin.length / letters.length > 0.3;
}

// ── Name resolution ──────────────────────────────────────────────────────────

/** Extract the best locality key for grouping (admin_name preferred, fallback to name). */
export function getLocalityKey(hex: Pick<HexResult, 'admin_name' | 'name'>): string {
  return (hex.admin_name || hex.name || '').trim();
}

/**
 * Resolve a human-readable locality label from hex metadata.
 * 항상 동네(admin_name)를 우선 사용.
 * admin_name이 도/시급인 경우에만 parent_city로 대체.
 *
 * For non-Korean locales: if admin_name is in non-Latin script and a Latin
 * city name is available, prefer the city name with the native admin_name
 * as a secondary detail (e.g. "Dubai · الحبية 3").
 */
export function resolveLocalityName(hex: HexResult | null): string {
  if (!hex) return '—';
  const adminName  = (hex.admin_name || hex.name || '').trim();
  const parentCity = (hex.parent_city_name || hex.city || '').trim();
  const country    = (hex.country || '').toUpperCase();

  const isProvinceLike      = /도$/.test(adminName) || /-do$/i.test(adminName);
  const isNeighborhoodLike  = /(동|가|읍|면|리)$/.test(adminName);
  const isDistrictLike      = /(구|군)$/.test(adminName);

  const isKorean = country === 'KR' || isProvinceLike || isNeighborhoodLike || isDistrictLike;

  if (isKorean) {
    if (isNeighborhoodLike || isDistrictLike) return adminName;
    if (isProvinceLike && parentCity) return parentCity;
    if (country === 'KR') return adminName || parentCity || 'Unknown';
  }

  // Non-Korean: if admin_name is in non-Latin script, use the Latin city name only.
  // The suffix system (#1, #2) provides disambiguation.
  if (adminName && isNonLatinScript(adminName) && parentCity && !isNonLatinScript(parentCity)) {
    return parentCity;
  }

  if (adminName) return adminName;
  return parentCity || 'Unknown';
}

/**
 * Format locality label with optional suffix number.
 * e.g. "성수동" → "성수동"  |  "성수동" + 2 → "성수동#2"
 */
export function formatLocalityLabel(hex: HexResult | null, suffix: number | string = ''): string {
  const base = resolveLocalityName(hex);
  return suffix ? `${base} #${suffix}` : base;
}

// ── Suffix computation ───────────────────────────────────────────────────────

/** Unique ID for a hex result. */
function hexId(hex: HexResult): string {
  return String(hex.id || hex.city_id || '');
}

/**
 * Pre-compute suffix map for a list of hexagons.
 * Returns a Map of hex-id → suffix-number.
 * Only hexes whose locality appears more than once receive a suffix.
 * Deterministic: order follows the input array.
 *
 * Complexity: O(n) — single pass to count, single pass to assign.
 */
export function computeLocalitySuffixes(hexes: HexResult[]): Map<string, number> {
  // 1. Count occurrences per locality
  const localityCounts = new Map<string, number>();
  for (const hex of hexes) {
    const loc = getLocalityKey(hex);
    if (loc) localityCounts.set(loc, (localityCounts.get(loc) || 0) + 1);
  }

  // 2. Assign sequential suffixes for localities with count > 1
  const suffixMap = new Map<string, number>();
  const runningIndices = new Map<string, number>();

  for (const hex of hexes) {
    const loc = getLocalityKey(hex);
    if (!loc || (localityCounts.get(loc) ?? 0) <= 1) continue;
    const idx = (runningIndices.get(loc) || 0) + 1;
    runningIndices.set(loc, idx);
    suffixMap.set(hexId(hex), idx);
  }

  return suffixMap;
}

/**
 * Get the suffix for a single hex within a set of visible hexes.
 * Returns empty string if no disambiguation is needed.
 */
export function getSuffixForHex(hex: HexResult | null, allHexes: HexResult[]): number | '' {
  if (!hex || !allHexes.length) return '';
  const loc = getLocalityKey(hex);
  if (!loc) return '';

  const sameLocality = allHexes.filter(h => getLocalityKey(h) === loc);
  if (sameLocality.length <= 1) return '';

  const idx = sameLocality.findIndex(h => hexId(h) === hexId(hex));
  return idx >= 0 ? idx + 1 : '';
}

// ── Place label (for ResultsList cards) ──────────────────────────────────────

/**
 * Build a breadcrumb-style place label: "Locality#N · City · Country"
 * Deduplicates parts (case-insensitive).
 */
export function placeLabel(hex: HexResult, suffix: number | string = ''): string {
  const resolvedLocality = resolveLocalityName(hex);
  const parentCity = (hex.parent_city_name || hex.city || '').trim();
  const country = hex.country || '';

  // Subtitle shows breadcrumb context only — suffix stays in the card title
  // If the resolved locality already contains the parent city (e.g. "Dubai · الحبية 3"),
  // don't repeat the city in the breadcrumb.
  const localityContainsParent = parentCity && resolvedLocality.toLowerCase().includes(parentCity.toLowerCase());
  const showParent = parentCity && !localityContainsParent && resolvedLocality.toLowerCase() !== parentCity.toLowerCase() ? parentCity : '';
  const parts = [resolvedLocality, showParent, country]
    .map(v => (v || '').trim())
    .filter(Boolean);

  // Remove duplicates (case-insensitive)
  const unique = parts.filter((v, i) => parts.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
  return unique.join(' · ') || '—';
}
