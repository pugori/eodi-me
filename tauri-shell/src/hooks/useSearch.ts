/**
 * useSearch — manages vibe search with debouncing, latency tracking, and
 * hex detail fetching.
 *
 * Responsibilities:
 *  - Debounced text query (300 ms)
 *  - Two-phase search: text → seed hex → similarity match
 *  - Per-result detail fetch when selecting a hex
 *  - Latency measurement and sigma tracking
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { EngineConfig, EngineMeta, HexResult } from './useEngine';
import { getUiCopy } from '../i18n/ui';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;
const MAX_QUERY_LEN = 120;
const SEARCH_LIMIT = 400;
const RECENT_QUERIES_KEY = 'eodi_recent_queries';
const MAX_RECENT_QUERIES = 8;

const QUERY_ALIAS_MAP: Record<string, string[]> = {
  // Korean queries → English search candidates
  '성수동': ['seongsu', 'seongsu seoul', 'seongsu-dong'],
  '성수': ['seongsu', 'seongsu seoul'],
  '강남': ['gangnam', 'gangnam seoul'],
  '강남구': ['gangnam', 'gangnam seoul'],
  '강남역': ['gangnam', 'gangnam seoul'],
  '홍대': ['hongdae', 'hongdae seoul', 'mapo seoul'],
  '홍익대': ['hongdae', 'hongdae seoul'],
  '합정': ['hapjeong', 'hapjeong seoul', 'mapo seoul'],
  '합정동': ['hapjeong', 'hapjeong seoul', 'mapo seoul'],
  '망원': ['mangwon', 'mangwon seoul', 'mapo seoul'],
  '망원동': ['mangwon', 'mangwon seoul'],
  '연남동': ['yeonnam', 'yeonnam seoul', 'mapo seoul'],
  '연남': ['yeonnam', 'yeonnam seoul'],
  '이태원': ['itaewon', 'itaewon seoul', 'yongsan seoul'],
  '신촌': ['sinchon', 'sinchon seoul'],
  '을지로': ['euljiro', 'euljiro seoul', 'jung-gu seoul'],
  '종로': ['jongno', 'jongno seoul'],
  '인사동': ['insadong', 'insadong seoul', 'jongno seoul'],
  '북촌': ['bukchon', 'bukchon seoul'],
  '서촌': ['seochon', 'seochon seoul'],
  '명동': ['myeongdong', 'myeongdong seoul'],
  '잠실': ['jamsil', 'jamsil seoul', 'songpa seoul'],
  '여의도': ['yeouido', 'yeouido seoul'],
  '강동': ['gangdong', 'gangdong seoul'],
  '은평': ['eunpyeong', 'eunpyeong seoul'],
  '마포': ['mapo', 'mapo seoul'],
  '용산': ['yongsan', 'yongsan seoul'],
  '서대문': ['seodaemun', 'seodaemun seoul'],
  '동대문': ['dongdaemun', 'dongdaemun seoul'],
  '해운대': ['haeundae', 'haeundae busan'],
  '서면': ['seomyeon', 'seomyeon busan'],
  '광안리': ['gwangalli', 'gwangalli busan'],
  '남포동': ['nampodong', 'busan'],
  '제주': ['jeju', 'jeju-si'],
  '서울': ['seoul'],
  '부산': ['busan'],
  '대구': ['daegu'],
  '인천': ['incheon'],
  '수원': ['suwon'],
  '대전': ['daejeon'],
  '광주': ['gwangju'],
  // Japanese queries
  '渋谷': ['shibuya', 'shibuya tokyo'],
  '新宿': ['shinjuku', 'shinjuku tokyo'],
  '銀座': ['ginza', 'ginza tokyo'],
  '東京': ['tokyo'],
  '大阪': ['osaka'],
  // Chinese queries
  '上海': ['shanghai'],
  '北京': ['beijing'],
  '深圳': ['shenzhen'],
  '广州': ['guangzhou'],
  // Common short aliases for global cities
  'nyc': ['new york', 'manhattan'],
  'la': ['los angeles'],
  'sf': ['san francisco'],
  'dc': ['washington dc', 'washington'],
  'bkk': ['bangkok'],
  'hk': ['hong kong'],
  'sg': ['singapore'],
  'kl': ['kuala lumpur'],
  // European neighborhoods
  'shoreditch': ['shoreditch london'],
  'marais': ['le marais paris'],
  'le marais': ['le marais paris', 'marais paris'],
  'kreuzberg': ['kreuzberg berlin'],
  'prenzlauer berg': ['prenzlauer berg berlin'],
  'gracia': ['gracia barcelona'],
  'eixample': ['eixample barcelona'],
  'trastevere': ['trastevere rome'],
  'navigli': ['navigli milan'],
  'neukölln': ['neukölln berlin', 'neukolln berlin'],
  'montmartre': ['montmartre paris'],
  'notting hill': ['notting hill london'],
  'hackney': ['hackney london'],
  // North America
  'williamsburg': ['williamsburg brooklyn', 'williamsburg new york'],
  'brooklyn': ['brooklyn new york'],
  'greenwich': ['greenwich village new york'],
  'mission': ['mission district san francisco'],
  'silverlake': ['silver lake los angeles'],
  'silver lake': ['silver lake los angeles'],
  'wicker park': ['wicker park chicago'],
  'queen west': ['queen west toronto'],
  // Latin America
  'condesa': ['condesa mexico city'],
  'roma norte': ['roma norte mexico city'],
  'palermo': ['palermo soho buenos aires'],
  'miraflores': ['miraflores lima'],
  'ipanema': ['ipanema rio de janeiro'],
  'santa teresa': ['santa teresa rio de janeiro'],
  'pinheiros': ['pinheiros sao paulo'],
  // Southeast Asia
  'thonglor': ['thonglor bangkok'],
  'silom': ['silom bangkok'],
  'orchard': ['orchard road singapore'],
  'tiong bahru': ['tiong bahru singapore'],
  'bui vien': ['bui vien ho chi minh'],
  'hoan kiem': ['hoan kiem hanoi'],
  'changkat': ['changkat bukit bintang kuala lumpur'],
  'canggu': ['canggu bali'],
  // Oceania
  'fitzroy': ['fitzroy melbourne'],
  'surry hills': ['surry hills sydney'],
  'newtown': ['newtown sydney'],
  'ponsonby': ['ponsonby auckland'],
  // Middle East & Africa
  'zamalek': ['zamalek cairo'],
  'maadi': ['maadi cairo'],
  'maboneng': ['maboneng johannesburg'],
  'victoria island': ['victoria island lagos'],
};

const NEIGHBORHOOD_HINTS: Record<string, { lat: number; lon: number; radiusKm: number; cityHint?: string; countryHint?: string }> = {
  // Korea — Seoul major districts & trendy neighborhoods
  '성수동': { lat: 37.5446, lon: 127.0557, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '성수': { lat: 37.5446, lon: 127.0557, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '강남': { lat: 37.4979, lon: 127.0276, radiusKm: 10, cityHint: 'seoul', countryHint: 'kr' },
  '강남구': { lat: 37.4979, lon: 127.0276, radiusKm: 10, cityHint: 'seoul', countryHint: 'kr' },
  '강남역': { lat: 37.4979, lon: 127.0276, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '홍대': { lat: 37.5563, lon: 126.9236, radiusKm: 10, cityHint: 'seoul', countryHint: 'kr' },
  '홍익대': { lat: 37.5563, lon: 126.9236, radiusKm: 10, cityHint: 'seoul', countryHint: 'kr' },
  '합정': { lat: 37.5493, lon: 126.9135, radiusKm: 7, cityHint: 'seoul', countryHint: 'kr' },
  '합정동': { lat: 37.5493, lon: 126.9135, radiusKm: 7, cityHint: 'seoul', countryHint: 'kr' },
  '망원': { lat: 37.5550, lon: 126.9016, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '망원동': { lat: 37.5550, lon: 126.9016, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '연남동': { lat: 37.5622, lon: 126.9258, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '연남': { lat: 37.5622, lon: 126.9258, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '이태원': { lat: 37.5344, lon: 126.9942, radiusKm: 7, cityHint: 'seoul', countryHint: 'kr' },
  '신촌': { lat: 37.5551, lon: 126.9361, radiusKm: 7, cityHint: 'seoul', countryHint: 'kr' },
  '을지로': { lat: 37.5660, lon: 126.9875, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '종로': { lat: 37.5704, lon: 126.9920, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '인사동': { lat: 37.5744, lon: 126.9849, radiusKm: 5, cityHint: 'seoul', countryHint: 'kr' },
  '명동': { lat: 37.5637, lon: 126.9824, radiusKm: 6, cityHint: 'seoul', countryHint: 'kr' },
  '잠실': { lat: 37.5145, lon: 127.1059, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '여의도': { lat: 37.5216, lon: 126.9244, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '마포': { lat: 37.5538, lon: 126.9515, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '용산': { lat: 37.5311, lon: 126.9810, radiusKm: 8, cityHint: 'seoul', countryHint: 'kr' },
  '동대문': { lat: 37.5714, lon: 127.0096, radiusKm: 7, cityHint: 'seoul', countryHint: 'kr' },
  // Korea — Busan
  '해운대': { lat: 35.1632, lon: 129.1636, radiusKm: 10, cityHint: 'busan', countryHint: 'kr' },
  '서면': { lat: 35.1575, lon: 129.0595, radiusKm: 7, cityHint: 'busan', countryHint: 'kr' },
  '광안리': { lat: 35.1537, lon: 129.1186, radiusKm: 6, cityHint: 'busan', countryHint: 'kr' },
  // Japan
  '渋谷': { lat: 35.6580, lon: 139.7016, radiusKm: 8, cityHint: 'tokyo', countryHint: 'jp' },
  '新宿': { lat: 35.6938, lon: 139.7034, radiusKm: 8, cityHint: 'tokyo', countryHint: 'jp' },
  // Neighborhoods with precise hints for global cities
  'shoreditch': { lat: 51.5223, lon: -0.0783, radiusKm: 5, cityHint: 'london', countryHint: 'gb' },
  'notting hill': { lat: 51.5080, lon: -0.2018, radiusKm: 5, cityHint: 'london', countryHint: 'gb' },
  'hackney': { lat: 51.5450, lon: -0.0553, radiusKm: 6, cityHint: 'london', countryHint: 'gb' },
  'marais': { lat: 48.8575, lon: 2.3514, radiusKm: 6, cityHint: 'paris', countryHint: 'fr' },
  'le marais': { lat: 48.8575, lon: 2.3514, radiusKm: 6, cityHint: 'paris', countryHint: 'fr' },
  'montmartre': { lat: 48.8867, lon: 2.3431, radiusKm: 5, cityHint: 'paris', countryHint: 'fr' },
  'williamsburg': { lat: 40.7081, lon: -73.9571, radiusKm: 5, cityHint: 'new york', countryHint: 'us' },
  'brooklyn': { lat: 40.6782, lon: -73.9442, radiusKm: 12, cityHint: 'new york', countryHint: 'us' },
  'manhattan': { lat: 40.7831, lon: -73.9712, radiusKm: 12, cityHint: 'new york', countryHint: 'us' },
  'silver lake': { lat: 34.0876, lon: -118.2712, radiusKm: 5, cityHint: 'los angeles', countryHint: 'us' },
  'silverlake': { lat: 34.0876, lon: -118.2712, radiusKm: 5, cityHint: 'los angeles', countryHint: 'us' },
  'mission': { lat: 37.7599, lon: -122.4148, radiusKm: 5, cityHint: 'san francisco', countryHint: 'us' },
  'wicker park': { lat: 41.9083, lon: -87.6780, radiusKm: 5, cityHint: 'chicago', countryHint: 'us' },
  'shibuya': { lat: 35.6580, lon: 139.7016, radiusKm: 8, cityHint: 'tokyo', countryHint: 'jp' },
  'shinjuku': { lat: 35.6938, lon: 139.7034, radiusKm: 8, cityHint: 'tokyo', countryHint: 'jp' },
  'ginza': { lat: 35.6717, lon: 139.7650, radiusKm: 5, cityHint: 'tokyo', countryHint: 'jp' },
  'harajuku': { lat: 35.6702, lon: 139.7027, radiusKm: 5, cityHint: 'tokyo', countryHint: 'jp' },
  'fitzroy': { lat: -37.7966, lon: 144.9778, radiusKm: 5, cityHint: 'melbourne', countryHint: 'au' },
  'surry hills': { lat: -33.8864, lon: 151.2094, radiusKm: 5, cityHint: 'sydney', countryHint: 'au' },
  'newtown': { lat: -33.8990, lon: 151.1773, radiusKm: 5, cityHint: 'sydney', countryHint: 'au' },
  'kreuzberg': { lat: 52.4983, lon: 13.4096, radiusKm: 6, cityHint: 'berlin', countryHint: 'de' },
  'prenzlauer berg': { lat: 52.5397, lon: 13.4163, radiusKm: 6, cityHint: 'berlin', countryHint: 'de' },
  'neukölln': { lat: 52.4811, lon: 13.4390, radiusKm: 7, cityHint: 'berlin', countryHint: 'de' },
  'gracia': { lat: 41.4036, lon: 2.1533, radiusKm: 5, cityHint: 'barcelona', countryHint: 'es' },
  'eixample': { lat: 41.3900, lon: 2.1617, radiusKm: 7, cityHint: 'barcelona', countryHint: 'es' },
  'trastevere': { lat: 41.8883, lon: 12.4707, radiusKm: 5, cityHint: 'rome', countryHint: 'it' },
  'navigli': { lat: 45.4504, lon: 9.1740, radiusKm: 5, cityHint: 'milan', countryHint: 'it' },
  // Latin America
  'condesa': { lat: 19.4121, lon: -99.1689, radiusKm: 5, cityHint: 'mexico city', countryHint: 'mx' },
  'roma norte': { lat: 19.4172, lon: -99.1620, radiusKm: 5, cityHint: 'mexico city', countryHint: 'mx' },
  'palermo': { lat: -34.5887, lon: -58.4228, radiusKm: 7, cityHint: 'buenos aires', countryHint: 'ar' },
  'ipanema': { lat: -22.9847, lon: -43.1980, radiusKm: 5, cityHint: 'rio de janeiro', countryHint: 'br' },
  'pinheiros': { lat: -23.5651, lon: -46.6848, radiusKm: 6, cityHint: 'sao paulo', countryHint: 'br' },
  // Southeast Asia
  'thonglor': { lat: 13.7306, lon: 100.5834, radiusKm: 5, cityHint: 'bangkok', countryHint: 'th' },
  'silom': { lat: 13.7218, lon: 100.5245, radiusKm: 6, cityHint: 'bangkok', countryHint: 'th' },
  'tiong bahru': { lat: 1.2852, lon: 103.8194, radiusKm: 4, cityHint: 'singapore', countryHint: 'sg' },
  'canggu': { lat: -8.6478, lon: 115.1385, radiusKm: 7, cityHint: 'bali', countryHint: 'id' },
  'zamalek': { lat: 30.0590, lon: 31.2192, radiusKm: 5, cityHint: 'cairo', countryHint: 'eg' },
};

function buildSearchCandidates(raw: string): string[] {
  const normalized = raw.trim();
  if (!normalized) return [];

  const candidates: string[] = [normalized];
  const compact = normalized.replace(/\s+/g, '');

  if (compact !== normalized) {
    candidates.push(compact);
  }

  const aliases = QUERY_ALIAS_MAP[normalized] || QUERY_ALIAS_MAP[compact];
  if (aliases?.length) {
    candidates.push(...aliases);
  }

  return [...new Set(candidates.map((v) => v.trim()).filter(Boolean))].slice(0, 6);
}

function normalizeHexSearchResults(hexagons: any[]): HexResult[] {
  const seen = new Set<string>();
  const normalized: HexResult[] = [];

  for (const hex of hexagons) {
    const h3 = hex?.h3_index;
    if (!h3 || seen.has(h3)) continue;
    seen.add(h3);

    const rawLat = hex.lat ?? 0;
    const rawLng = hex.lng ?? hex.lon ?? 0;
    // Reject clearly invalid coordinates (0,0 is equator+prime meridian — not a real result)
    if (rawLat === 0 && rawLng === 0) continue;
    if (rawLat < -90 || rawLat > 90 || rawLng < -180 || rawLng > 180) continue;

    normalized.push({
      ...hex,
      id: h3,
      city_id: h3,
      h3_index: h3,
      name: hex.city || hex.parent_city_name || hex.admin_name || hex.name || 'Unknown',
      city: hex.parent_city_name || hex.city,
      parent_city_name: hex.parent_city_name || hex.city,
      country: hex.country,
      lat: rawLat,
      lng: rawLng,
      score: typeof hex.score === 'number' ? hex.score : 1,
      match_reason: 'Location match',
      admin_name: hex.admin_name,
      admin_level: hex.admin_level,
      radar: hex.radar,
      signals: hex.signals,
    });
  }

  return normalized;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchByNeighborhoodHint(
  baseUrl: string,
  headers: Record<string, string>,
  query: string,
  signal: AbortSignal,
): Promise<HexResult[]> {
  const compact = query.trim().replace(/\s+/g, '').toLowerCase();
  const directHint = NEIGHBORHOOD_HINTS[query.trim()] || NEIGHBORHOOD_HINTS[compact] || null;
  if (!directHint) {
    return [];
  }

  const nearestRes = await fetch(
    `${baseUrl}/hex/nearest?lat=${directHint.lat}&lon=${directHint.lon}&k=50`,
    { headers, signal },
  );
  if (!nearestRes.ok) {
    return [];
  }

  const nearestData = await nearestRes.json();
  const normalized = normalizeHexSearchResults(Array.isArray(nearestData.hexagons) ? nearestData.hexagons : []);
  const filtered = normalized.filter((hex) => {
    const withinRadius = haversineKm(directHint.lat, directHint.lon, hex.lat, hex.lng) <= directHint.radiusKm;
    if (!withinRadius) return false;

    if (directHint.countryHint && (hex.country || '').toLowerCase() !== directHint.countryHint) {
      return false;
    }

    if (directHint.cityHint) {
      const city = (hex.parent_city_name || hex.city || '').toLowerCase();
      if (!city.includes(directHint.cityHint)) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length === 0) {
    return normalized.slice(0, 12).map((hex) => ({
      ...hex,
      match_reason: 'Neighborhood nearest fallback',
    }));
  }

  return filtered.map((hex) => ({
    ...hex,
    match_reason: 'Neighborhood nearest fallback',
  }));
}

async function fetchViewportByGeocode(
  _baseUrl: string,
  _headers: Record<string, string>,
  _queries: string[],
  _signal: AbortSignal,
): Promise<HexResult[]> {
  // NOTE: Nominatim (nominatim.openstreetmap.org) was removed — ToS prohibits commercial use.
  // Geocoding fallback is handled entirely by the local engine's hex/search endpoint.
  return [];
}

interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: HexResult[];
  setResults: React.Dispatch<React.SetStateAction<HexResult[]>>;
  selectedCity: HexResult | null;
  selectCity: (city: HexResult | null) => void;
  loading: boolean;
  lastLatency: number | null;
  handleSearch: (overrideQuery?: string) => void;
  error: string | null;
  clearError: () => void;
  showError: (msg: string) => void;
  validationMessage: string | null;
  hasSearched: boolean;
  recentQueries: string[];
  removeRecentQuery: (value: string) => void;
  clearRecentQueries: () => void;
  minQueryLen: number;
}

function loadRecentQueries(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_QUERIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string').slice(0, MAX_RECENT_QUERIES);
  } catch {
    return [];
  }
}

export function useSearch(
  engineConfig: EngineConfig | null,
  updateMeta: (patch: Partial<EngineMeta>) => void,
): UseSearchReturn {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HexResult[]>([]);
  const [selectedCity, setSelectedCity] = useState<HexResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => loadRecentQueries());

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isExecutingRef = useRef(false);
  const lastExecutedQueryRef = useRef('');

  const persistRecentQueries = useCallback((values: string[]) => {
    try {
      localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(values));
    } catch {
      // ignore storage failures
    }
  }, []);

  const addRecentQuery = useCallback((value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    setRecentQueries((prev) => {
      const deduped = [normalized, ...prev.filter((q) => q.toLowerCase() !== normalized.toLowerCase())]
        .slice(0, MAX_RECENT_QUERIES);
      persistRecentQueries(deduped);
      return deduped;
    });
  }, [persistRecentQueries]);

  const removeRecentQuery = useCallback((value: string) => {
    setRecentQueries((prev) => {
      const next = prev.filter((q) => q !== value);
      persistRecentQueries(next);
      return next;
    });
  }, [persistRecentQueries]);

  const clearRecentQueries = useCallback(() => {
    setRecentQueries([]);
    persistRecentQueries([]);
  }, [persistRecentQueries]);

  // ── Auto-dismiss error after 6 s ──────────────────────────────────────────
  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 6000);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  }, []);

  // ── Select hex with lazy detail fetch ─────────────────────────────────────
  const selectCity = useCallback(
    async (city: HexResult | null) => {
      setSelectedCity(city);
      if (!city || !engineConfig) return;

      try {
        const baseUrl = engineConfig.base_url || '';
        const headers: Record<string, string> = {};
        if (engineConfig.token) headers['Authorization'] = `Bearer ${engineConfig.token}`;

        const res = await fetch(`${baseUrl}/hex/${city.city_id || city.id}`, {
          headers,
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const detail = await res.json();
          if (detail.lon != null && detail.lng == null) detail.lng = detail.lon;
          setSelectedCity((prev) =>
            prev && (prev.city_id || prev.id) === (city.city_id || city.id)
              ? {
                  ...prev,
                  ...detail,
                  name: detail.city || detail.parent_city_name || prev.name,
                  city: detail.parent_city_name || detail.city || prev.city,
                  parent_city_name: detail.parent_city_name || detail.city || prev.parent_city_name,
                  admin_name: detail.admin_name || prev.admin_name,
                  admin_level: detail.admin_level ?? prev.admin_level,
                  signals: detail.signals ?? prev.signals,
                }
              : prev,
          );
        }
      } catch {
        // Best-effort hex detail enrichment — failures are silent
      }
    },
    [engineConfig],
  );

  // ── Core search logic (locality-only; no vibe expansion) ─────────────────
  const executeSearch = useCallback(async (rawQuery: string) => {
    if (!engineConfig) return;

    const normalizedQuery = rawQuery.trim().slice(0, MAX_QUERY_LEN);
    if (!normalizedQuery) return;

    if (isExecutingRef.current) {
      abortRef.current?.abort();
    }
    isExecutingRef.current = true;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setSelectedCity(null);

    try {
      // ── Locality search: direct hex search only ───────────────────────────
      const baseUrl = engineConfig.base_url || '';
      const headers: Record<string, string> = {};
      if (engineConfig.token) headers['Authorization'] = `Bearer ${engineConfig.token}`;

      const t0 = performance.now();

      const candidates = buildSearchCandidates(normalizedQuery);
      let matchedHexes: HexResult[] = [];

      for (const candidate of candidates) {
        const searchRes = await fetch(
          `${baseUrl}/hex/search?q=${encodeURIComponent(candidate)}&limit=${SEARCH_LIMIT}`,
          { headers, signal: controller.signal },
        );
        if (!searchRes.ok) {
          if (searchRes.status === 402) throw new Error('PRO_REQUIRED');
          throw new Error(`Search failed (${searchRes.status})`);
        }
        const searchData = await searchRes.json();
        const found = Array.isArray(searchData.hexagons) ? searchData.hexagons : [];
        if (found.length > 0) {
          matchedHexes = found;
          break;
        }
      }

      let normalized = normalizeHexSearchResults(matchedHexes);
      if (normalized.length === 0) {
        const geocodeCandidates = [
          ...candidates,
          `${normalizedQuery} korea`,
          `${normalizedQuery}, south korea`,
          `${normalizedQuery} seoul`,
        ];
        const dedupedGeocodeCandidates = [...new Set(geocodeCandidates.map((v) => v.trim()).filter(Boolean))].slice(0, 10);
        normalized = await fetchViewportByGeocode(baseUrl, headers, dedupedGeocodeCandidates, controller.signal);
      }

      if (normalized.length === 0) {
        normalized = await fetchByNeighborhoodHint(baseUrl, headers, normalizedQuery, controller.signal);
      }

      const latency = Math.round(performance.now() - t0);
      setLastLatency(latency);

      setResults(normalized);
      setHasSearched(true);
      addRecentQuery(normalizedQuery);
      lastExecutedQueryRef.current = normalizedQuery;
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      // Skip display for user-initiated cancels (AbortError) and navigation-triggered cancels (TimeoutError during unmount)
      if (e.name !== 'AbortError' && !(e.name === 'TimeoutError' && !isExecutingRef.current)) {
        const msg: string = e?.message ?? '';
        
        // Handle network/fetch errors gracefully
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          const isLocal = !engineConfig?.base_url || 
                          engineConfig.base_url.includes('localhost') || 
                          engineConfig.base_url.includes('127.0.0.1');

          if (isLocal) {
            showError(getUiCopy(navigator.language).engineOffline);
          } else {
            showError(getUiCopy(navigator.language).networkError); // "Internet connection required"
          }
        } else if (msg === 'PRO_REQUIRED') {
          showError(getUiCopy(navigator.language).proFeatureRequired);
        } else {
          showError(msg);
        }
      }
    } finally {
      setLoading(false);
      isExecutingRef.current = false;
    }
  }, [engineConfig, showError, addRecentQuery]);

  // ── Debounced search trigger ──────────────────────────────────────────────
  const handleSearch = useCallback((overrideQuery?: string) => {
    const nextQuery = (overrideQuery ?? query).trim();

    if (!nextQuery) {
      setValidationMessage(null);
      setHasSearched(false);
      setResults([]);
      return;
    }

    if (nextQuery.length < MIN_QUERY_LEN) {
      setValidationMessage(getUiCopy(navigator.language).typeMinChars(MIN_QUERY_LEN));
      return;
    }

    if (nextQuery === lastExecutedQueryRef.current && results.length > 0) {
      setValidationMessage(null);
      return;
    }

    setValidationMessage(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => executeSearch(nextQuery), DEBOUNCE_MS);
  }, [query, results.length, executeSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    query,
    setQuery,
    results,
    setResults,
    selectedCity,
    selectCity,
    loading,
    lastLatency,
    handleSearch,
    error,
    showError,
    clearError,
    validationMessage,
    hasSearched,
    recentQueries,
    removeRecentQuery,
    clearRecentQueries,
    minQueryLen: MIN_QUERY_LEN,
  };
}
