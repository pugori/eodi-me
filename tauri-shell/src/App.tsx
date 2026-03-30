import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Settings, WifiOff, X, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { useEngine } from './hooks/useEngine';
import { useSearch } from './hooks/useSearch';
import { useUserData, computeSuitability } from './hooks/useUserData';
import { useViewportHexes } from './hooks/useViewportHexes';
import { useCountries } from './hooks/useCountries';
import { useLicense } from './hooks/useLicense';
import { useUpdater } from './hooks/useUpdater';

import { MapLibreMap } from './components/map/MapLibreMap';
import { VIBE_COLORS } from './utils/vibeConstants';
import { Sidebar } from './components/layout/Sidebar';
import { SplashScreen } from './components/ui/SplashScreen';
import { DbSetupScreen } from './components/ui/DbSetupScreen';
import { ErrorToast } from './components/ui/ErrorToast';
import { SettingsModal } from './components/ui/SettingsModal';
import { ColorLegend } from './components/ui/ColorLegend';
import { LicenseActivation } from './components/license/LicenseActivation';
import { OnboardingOverlay, hasSeenOnboarding } from './components/ui/OnboardingOverlay';
import { UpdateBanner } from './components/ui/UpdateBanner';
import { WhatsNew, hasSeenWhatsNew } from './components/ui/WhatsNew';
import { CompareOverlay } from './components/ui/CompareOverlay';
import { HelpModal } from './components/ui/HelpModal';
import { InlineErrorBoundary } from './components/ui/InlineErrorBoundary';

import type { HexResult } from './hooks/useEngine';
import type { ViewportBounds } from './hooks/useViewportHexes';
import { getUiCopy, resolveUiLocale } from './i18n/ui';
import type { UiLocale } from './i18n/ui';

// ── i18n: detect initial locale (localStorage → browser → 'en') ───────────
function getInitialLocale(): UiLocale {
  const stored = localStorage.getItem('eodi_locale');
  if (stored) return resolveUiLocale(stored);
  return resolveUiLocale(navigator.language || 'en');
}

// ── Preview mode detection (dev only) ────────────────────────────────────────
const IS_PREVIEW = typeof window !== 'undefined' &&
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === '1';

// ── Persistent map position (localStorage) ────────────────────────────────────
const MAP_POS_KEY = 'eodi_map_pos';
// Neutral world-center default: first-time users see the global map (zoom 2).
// Returning users restore their last saved position via localStorage.
const DEFAULT_MAP_CENTER: [number, number] = [12.5, 30.0]; // Africa/Europe center — balanced global view
const DEFAULT_MAP_ZOOM = 2;

function getStoredMapPos(): { center: [number, number]; zoom: number } {
  try {
    const raw = localStorage.getItem(MAP_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.lng === 'number' && typeof parsed.lat === 'number' &&
        typeof parsed.zoom === 'number' && parsed.zoom >= 2 && parsed.zoom <= 20
      ) {
        return { center: [parsed.lng, parsed.lat], zoom: parsed.zoom };
      }
    }
  } catch (_) { /* ignore */ }
  return { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };
}

// ── Quick search chips ────────────────────────────────────────────────────────
const QUICK_CHIPS = [
  'Tokyo', 'Seoul', 'Barcelona', 'Amsterdam', 'Melbourne',
  'New York', 'London', 'Berlin', 'Singapore', 'Copenhagen',
];

// ── City center coordinates for accurate flyTo ────────────────────────────────
const CITY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  // Korean (both hangul and romanized)
  '서울': { lat: 37.5665, lng: 126.9780, zoom: 11 },
  '부산': { lat: 35.1796, lng: 129.0756, zoom: 11 },
  '대구': { lat: 35.8714, lng: 128.6014, zoom: 11 },
  '인천': { lat: 37.4563, lng: 126.7052, zoom: 11 },
  '광주': { lat: 35.1595, lng: 126.8526, zoom: 11 },
  '대전': { lat: 36.3504, lng: 127.3845, zoom: 11 },
  '울산': { lat: 35.5384, lng: 129.3114, zoom: 11 },
  '제주': { lat: 33.4996, lng: 126.5312, zoom: 11 },
  'seoul': { lat: 37.5665, lng: 126.9780, zoom: 11 },
  'busan': { lat: 35.1796, lng: 129.0756, zoom: 11 },
  'daegu': { lat: 35.8714, lng: 128.6014, zoom: 11 },
  'incheon': { lat: 37.4563, lng: 126.7052, zoom: 11 },
  // Japanese (both kanji and romanized)
  '東京': { lat: 35.6762, lng: 139.6503, zoom: 11 },
  '大阪': { lat: 34.6937, lng: 135.5023, zoom: 12 },
  '京都': { lat: 35.0116, lng: 135.7681, zoom: 12 },
  '福岡': { lat: 33.5904, lng: 130.4017, zoom: 11 },
  'tokyo': { lat: 35.6762, lng: 139.6503, zoom: 11 },
  'osaka': { lat: 34.6937, lng: 135.5023, zoom: 12 },
  'kyoto': { lat: 35.0116, lng: 135.7681, zoom: 12 },
  'fukuoka': { lat: 33.5904, lng: 130.4017, zoom: 11 },
  // Chinese
  '上海': { lat: 31.2304, lng: 121.4737, zoom: 11 },
  '北京': { lat: 39.9042, lng: 116.4074, zoom: 11 },
  '深圳': { lat: 22.5431, lng: 114.0579, zoom: 11 },
  '广州': { lat: 23.1291, lng: 113.2644, zoom: 11 },
  'shanghai': { lat: 31.2304, lng: 121.4737, zoom: 11 },
  'beijing': { lat: 39.9042, lng: 116.4074, zoom: 11 },
  'shenzhen': { lat: 22.5431, lng: 114.0579, zoom: 11 },
  'guangzhou': { lat: 23.1291, lng: 113.2644, zoom: 11 },
  // Global cities
  'barcelona': { lat: 41.3851, lng: 2.1734, zoom: 12 },
  'amsterdam': { lat: 52.3676, lng: 4.9041, zoom: 12 },
  'melbourne': { lat: -37.8136, lng: 144.9631, zoom: 11 },
  'new york': { lat: 40.7128, lng: -74.0060, zoom: 11 },
  'new york city': { lat: 40.7128, lng: -74.0060, zoom: 11 },
  'nyc': { lat: 40.7128, lng: -74.0060, zoom: 11 },
  'london': { lat: 51.5074, lng: -0.1278, zoom: 11 },
  'berlin': { lat: 52.5200, lng: 13.4050, zoom: 11 },
  'singapore': { lat: 1.3521, lng: 103.8198, zoom: 12 },
  'copenhagen': { lat: 55.6761, lng: 12.5683, zoom: 12 },
  'paris': { lat: 48.8566, lng: 2.3522, zoom: 12 },
  'taipei': { lat: 25.0330, lng: 121.5654, zoom: 12 },
  'hong kong': { lat: 22.3193, lng: 114.1694, zoom: 12 },
  'sydney': { lat: -33.8688, lng: 151.2093, zoom: 11 },
  'dubai': { lat: 25.2048, lng: 55.2708, zoom: 11 },
  'bangkok': { lat: 13.7563, lng: 100.5018, zoom: 11 },
  'los angeles': { lat: 34.0522, lng: -118.2437, zoom: 11 },
  'la': { lat: 34.0522, lng: -118.2437, zoom: 11 },
  'san francisco': { lat: 37.7749, lng: -122.4194, zoom: 12 },
  'sf': { lat: 37.7749, lng: -122.4194, zoom: 12 },
  'chicago': { lat: 41.8781, lng: -87.6298, zoom: 11 },
  'toronto': { lat: 43.6532, lng: -79.3832, zoom: 11 },
  'vancouver': { lat: 49.2827, lng: -123.1207, zoom: 12 },
  'lisbon': { lat: 38.7223, lng: -9.1393, zoom: 12 },
  'madrid': { lat: 40.4168, lng: -3.7038, zoom: 11 },
  'rome': { lat: 41.9028, lng: 12.4964, zoom: 12 },
  'milan': { lat: 45.4654, lng: 9.1859, zoom: 12 },
  'vienna': { lat: 48.2082, lng: 16.3738, zoom: 12 },
  'prague': { lat: 50.0755, lng: 14.4378, zoom: 12 },
  'stockholm': { lat: 59.3293, lng: 18.0686, zoom: 12 },
  'zürich': { lat: 47.3769, lng: 8.5417, zoom: 12 },
  'zurich': { lat: 47.3769, lng: 8.5417, zoom: 12 },
  'kuala lumpur': { lat: 3.1390, lng: 101.6869, zoom: 11 },
  'kl': { lat: 3.1390, lng: 101.6869, zoom: 11 },
  'jakarta': { lat: -6.2088, lng: 106.8456, zoom: 11 },
  'mumbai': { lat: 19.0760, lng: 72.8777, zoom: 11 },
  'delhi': { lat: 28.6139, lng: 77.2090, zoom: 11 },
  'new delhi': { lat: 28.6139, lng: 77.2090, zoom: 11 },
  'mexico city': { lat: 19.4326, lng: -99.1332, zoom: 11 },
  'buenos aires': { lat: -34.6037, lng: -58.3816, zoom: 11 },
  'sao paulo': { lat: -23.5505, lng: -46.6333, zoom: 11 },
  'rio de janeiro': { lat: -22.9068, lng: -43.1729, zoom: 11 },
  'cairo': { lat: 30.0444, lng: 31.2357, zoom: 11 },
  'cape town': { lat: -33.9249, lng: 18.4241, zoom: 12 },
};

export default function App() {
  // ── i18n ───────────────────────────────────────────────────────────────────
  const [locale, setLocaleState] = useState<UiLocale>(getInitialLocale);
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const setLocale = useCallback((l: UiLocale) => {
    setLocaleState(l);
    localStorage.setItem('eodi_locale', l);
  }, []);

  // ── License ─────────────────────────────────────────────────────────────────
  const license = useLicense();
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);

  // ── Onboarding ──────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── What's New ──────────────────────────────────────────────────────────────
  const [showWhatsNew, setShowWhatsNew] = useState(() => !hasSeenWhatsNew());

  // ── App updater ──────────────────────────────────────────────────────────────
  const updater = useUpdater();

  // ── Engine lifecycle ────────────────────────────────────────────────────────
  const { engineStatus, splashStage, loadProgress, indexReady, engineConfig, engineMeta, initialResults, updateMeta, engineOnline, isReconnecting } =
    useEngine();

  // ── DB setup check ──────────────────────────────────────────────────────────
  const [dbCheckDone, setDbCheckDone] = useState(false);
  const [dbPresent, setDbPresent] = useState(true);
  useEffect(() => {
    invoke<{ hex_db_present: boolean }>('check_db_status')
      .then(status => {
        setDbPresent(status.hex_db_present);
        setDbCheckDone(true);
      })
      .catch(() => {
        setDbPresent(true);
        setDbCheckDone(true);
      });
  }, []);

  // ── Search & selection ──────────────────────────────────────────────────────
  const {
    query,
    setQuery,
    results: searchResults,
    setResults,
    selectedCity,
    selectCity,
    loading: searchLoading,
    handleSearch,
    error: searchError,
    showError,
    clearError,
    validationMessage,
    hasSearched,
    recentQueries,
    removeRecentQuery,
    clearRecentQueries,
    minQueryLen,
  } = useSearch(engineConfig, updateMeta);

  // ── User preferences ────────────────────────────────────────────────────────
  const {
    weights,
    presets,
    bookmarks,
    analysisMode,
    showLegend,
    showLabels,
    setWeight,
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
  } = useUserData();

  // ── Viewport hexes (browse mode) ────────────────────────────────────────────
  const { viewportHexes, totalInView, loading: viewportLoading, onViewportChange,
          setPaused: setViewportPaused } = useViewportHexes(engineConfig);

  // ── Country list for AnalysisPanel ──────────────────────────────────────────
  const { countries: dbCountries, cities: dbCities, fetchCities } = useCountries(engineConfig);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [compareTarget, setCompareTarget] = useState<HexResult | null>(null);
  const [isPickingCompare, setIsPickingCompare] = useState(false);
  const [compareOverlayOpen, setCompareOverlayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [flyToCenter, setFlyToCenter] = useState<{ lng: number; lat: number; zoom?: number; key: number } | null>(null);
  const flyKeyRef = useRef(0);
  const [currentZoom, setCurrentZoom] = useState(IS_PREVIEW ? 11 : DEFAULT_MAP_ZOOM);
  const [searchToast, setSearchToast] = useState<string | null>(null);
  const searchToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Global unhandled rejection / error guard ─────────────────────────────────
  // Catches any async errors not handled in try/catch blocks. Logs for debugging.
  // In production the disableConsoleOutput obfuscation flag suppresses these.
  useEffect(() => {
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? 'unknown');
      // Ignore AbortError (user-initiated cancels) and network preload errors
      if (reason.includes('AbortError') || reason.includes('load failed')) return;
      console.error('[unhandledRejection]', reason);
    };
    const onError = (e: ErrorEvent) => {
      console.error('[globalError]', e.message, e.filename, e.lineno);
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  // Ctrl+K / ⌘K global shortcut to focus search (clears existing query for fresh start)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[type="search"]');
        if (input) {
          input.focus();
          // Only select-all if there's text; clearing would be too aggressive UX
          input.select();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ? / F1 global shortcut to toggle help modal (skip when typing in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === 'F1') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === '?' && !isTyping && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Cleanup toast timer on unmount
  useEffect(() => () => {
    if (searchToastTimer.current) clearTimeout(searchToastTimer.current);
  }, []);

  // Show onboarding on first run (after engine is ready)
  useEffect(() => {
    if (engineStatus === 'ready' && !hasSeenOnboarding()) {
      const t = setTimeout(() => setShowOnboarding(true), 800);
      return () => clearTimeout(t);
    }
  }, [engineStatus]);

  // First-visit geolocation: if no stored map position, fly to user's actual location
  useEffect(() => {
    if (IS_PREVIEW) return;
    const hasStoredPos = !!localStorage.getItem(MAP_POS_KEY);
    if (hasStoredPos) return;
    if (!navigator.geolocation) return;
    flyKeyRef.current += 1;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (latitude >= -85 && latitude <= 85 && longitude >= -180 && longitude <= 180) {
          setFlyToCenter({ lat: latitude, lng: longitude, zoom: 11, key: flyKeyRef.current });
        }
      },
      () => { /* silently fall back to Seoul */ },
      { timeout: 5000, maximumAge: 60_000 },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether we're in search mode vs browse mode
  const isSearchMode = hasSearched || searchResults.length > 0;

  // When search results arrive, fly map to city center (if known) or fit all results
  useEffect(() => {
    if (searchResults.length > 0) {
      const q = query.toLowerCase().trim();
      const cityCenter = CITY_CENTERS[q];
      flyKeyRef.current += 1;
      if (cityCenter) {
        setFlyToCenter({ ...cityCenter, key: flyKeyRef.current });
      } else {
        // Compute bounding box of all results and fit to it
        const lats = searchResults.map((r) => r.lat).filter(Boolean) as number[];
        const lngs = searchResults.map((r) => r.lng).filter(Boolean) as number[];
        if (lats.length > 0 && lngs.length > 0) {
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs);
          const maxLng = Math.max(...lngs);
          const centerLat = (minLat + maxLat) / 2;
          const centerLng = (minLng + maxLng) / 2;
          // Estimate zoom from bounding box span (wider span = lower zoom)
          const latSpan = maxLat - minLat;
          const lngSpan = maxLng - minLng;
          const span = Math.max(latSpan, lngSpan);
          const zoom = span > 5 ? 9 : span > 2 ? 10 : span > 0.5 ? 11 : 12;
          setFlyToCenter({ lat: centerLat, lng: centerLng, zoom, key: flyKeyRef.current });
        }
      }
      // Show search result toast
      const msg = copy.searchResultToast
        ? copy.searchResultToast(searchResults.length)
        : `${searchResults.length} results found`;
      setSearchToast(msg);
      if (searchToastTimer.current) clearTimeout(searchToastTimer.current);
      searchToastTimer.current = setTimeout(() => setSearchToast(null), 3000);
    }
  }, [searchResults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Displayed hexes: search results override viewport hexes
  // Apply weights-based suitability score so ResultsList shows meaningful grades
  const { displayedHexes, searchResultsTruncated } = useMemo<{ displayedHexes: HexResult[]; searchResultsTruncated: boolean }>(() => {
    const applyScore = (hexes: HexResult[]) =>
      hexes.map((h) => ({ ...h, score: computeSuitability(h.radar, weights) }));

    // Normalize scores within a result set so the best result = 1.0, worst = FLOOR
    // This ensures search results always show a useful grade distribution (not all D-grade)
    const normalizeScores = (hexes: HexResult[], floor = 0.40): HexResult[] => {
      if (hexes.length < 2) return hexes;
      let min = Infinity, max = -Infinity;
      for (const h of hexes) {
        if (h.score < min) min = h.score;
        if (h.score > max) max = h.score;
      }
      const range = max - min;
      if (range < 0.001) return hexes; // all identical — skip normalization
      return hexes.map(h => ({ ...h, score: floor + ((h.score - min) / range) * (1 - floor) }));
    };

    if (isSearchMode && searchResults.length > 0) {
      const scored = applyScore(searchResults);
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      const normalized = normalizeScores(sorted); // normalize for meaningful grade distribution
      return { displayedHexes: normalized, searchResultsTruncated: false };
    }
    if (!isSearchMode && viewportHexes.length > 0) {
      const scored = applyScore(viewportHexes);
      // At low zoom, filter out low-quality results to avoid showing random D-grade towns
      const minScore = currentZoom < 7 ? 0.35 : 0;
      const filtered = minScore > 0 ? scored.filter((h) => h.score >= minScore) : scored;
      const sorted = [...filtered].sort((a, b) => b.score - a.score);
      return { displayedHexes: sorted, searchResultsTruncated: false };
    }
    if (!isSearchMode && initialResults.length > 0) {
      const scored = applyScore(initialResults);
      const sorted = [...scored].sort((a, b) => b.score - a.score);
      return { displayedHexes: sorted, searchResultsTruncated: false };
    }
    return { displayedHexes: [], searchResultsTruncated: false };
  }, [isSearchMode, searchResults, viewportHexes, initialResults, weights, currentZoom]);

  // Pause viewport loading during search
  const handleSearch_ = useCallback((overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim();
    setViewportPaused(!!q);

    // Immediately fly to city center without waiting for API results
    const cityCenter = CITY_CENTERS[q.toLowerCase()];
    if (cityCenter) {
      flyKeyRef.current += 1;
      setFlyToCenter({ ...cityCenter, key: flyKeyRef.current });
    }

    handleSearch(overrideQuery);
  }, [query, handleSearch, setViewportPaused]);

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setViewportPaused(false);
      setResults([]);
    }
  }, [setQuery, setViewportPaused, setResults]);

  // Preview mode: auto-select first hex for demo
  useEffect(() => {
    if (IS_PREVIEW && displayedHexes.length > 0 && !selectedCity) {
      selectCity(displayedHexes[0]);
    }
  }, [displayedHexes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── City selection ──────────────────────────────────────────────────────────
  const handleCitySelect = useCallback((city: HexResult) => {
    if (isPickingCompare) {
      // In compare-picking mode: set the clicked hex as compare target
      setCompareTarget(city);
      setIsPickingCompare(false);
      setCompareOverlayOpen(true);
    } else {
      selectCity(city);
      setCompareTarget(null);
    }
  }, [selectCity, isPickingCompare]);

  const handleCloseReport = useCallback(() => {
    selectCity(null);
    setCompareTarget(null);
    setIsPickingCompare(false);
  }, [selectCity]);

  const handleCompareStart = useCallback(() => {
    if (compareTarget) {
      // Already comparing — open overlay to view/change
      setCompareOverlayOpen(true);
    } else if (selectedCity) {
      // Open compare overlay with selected city as base
      setCompareOverlayOpen(true);
    } else {
      // Enter picking mode (legacy fallback)
      setIsPickingCompare(true);
    }
  }, [compareTarget, selectedCity]);

  const handleBookmark = useCallback(() => {
    if (!selectedCity) return;
    const h3 = selectedCity.h3_index || selectedCity.id;
    if (bookmarks.some((b) => b.h3_index === h3)) {
      removeBookmark(h3);
      setSearchToast(copy.bookmarkRemoved ?? '북마크 제거됨');
    } else {
      addBookmark({
        h3_index: h3,
        name: selectedCity.admin_name || selectedCity.name,
        country: selectedCity.country || '',
        lat: selectedCity.lat,
        lng: selectedCity.lng,
        note: '',
      });
      setSearchToast(copy.bookmarkAdded ?? '북마크 추가됨');
    }
    if (searchToastTimer.current) clearTimeout(searchToastTimer.current);
    searchToastTimer.current = setTimeout(() => setSearchToast(null), 2500);
  }, [selectedCity, bookmarks, addBookmark, removeBookmark, copy, searchToastTimer]);

  // ── POI overlay handlers (B2B) ─────────────────────────────────────────────
  const handleApplyPoiOverlaySingle = useCallback(async (payload: { h3Index: string; poiCounts: number[] }): Promise<boolean> => {
    if (!engineConfig?.base_url) return false;
    setOverlayBusy(true);
    const controller = new AbortController();
    try {
      const res = await fetch(`${engineConfig.base_url}/user/hex/${payload.h3Index}`, {
        method: 'PUT',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(engineConfig.token ? { Authorization: `Bearer ${engineConfig.token}` } : {}),
        },
        body: JSON.stringify({ poi_counts: payload.poiCounts }),
      });
      if (!res.ok) showError(getUiCopy(locale).overlayApplyFailed);
      return res.ok;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return false;
      showError(getUiCopy(locale).overlayApplyFailed);
      return false;
    } finally {
      setOverlayBusy(false);
    }
  }, [engineConfig, locale, showError]);

  const handleApplyPoiOverlayBulk = useCallback(async (
    items: { h3Index: string; poiCounts: number[] }[]
  ): Promise<{ applied: number; failed: number } | null> => {
    if (!engineConfig?.base_url) return null;
    setOverlayBusy(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`${engineConfig.base_url}/user/hexagons/bulk`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(engineConfig.token ? { Authorization: `Bearer ${engineConfig.token}` } : {}),
        },
        body: JSON.stringify({
          items: items.map((it) => ({ h3_index: it.h3Index, poi_counts: it.poiCounts })),
        }),
      });
      if (!res.ok) {
        showError(getUiCopy(locale).overlayApplyFailed);
        return null;
      }
      const data = await res.json();
      return { applied: data.applied ?? items.length, failed: data.failed ?? 0 };
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        showError(getUiCopy(locale).overlayApplyFailed);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
      setOverlayBusy(false);
    }
  }, [engineConfig, locale, showError]);

  // ── Location compare (from AnalysisPanel) ─────────────────────────────────
  const handleCompareHexes = useCallback((baseHex: HexResult, targetHex: HexResult) => {
    selectCity(baseHex);
    setCompareTarget(targetHex);
    setIsPickingCompare(false);
    setCompareOverlayOpen(true);
  }, [selectCity]);

  const handleCompareOverlayTarget = useCallback((hex: HexResult) => {
    setCompareTarget(hex);
  }, []);

  const handleCompareSwap = useCallback(() => {
    if (selectedCity && compareTarget) {
      const prev = selectedCity;
      selectCity(compareTarget);
      setCompareTarget(prev);
    }
  }, [selectedCity, compareTarget, selectCity]);

  const handleCompareOverlayClose = useCallback(() => {
    setCompareOverlayOpen(false);
  }, []);

  // ── Viewport change handler ─────────────────────────────────────────────────
  const handleViewportChange = useCallback((bounds: ViewportBounds) => {
    setCurrentZoom(bounds.zoom);
    // Persist map position for next app launch
    const centerLng = (bounds.east + bounds.west) / 2;
    const centerLat = (bounds.north + bounds.south) / 2;
    try {
      localStorage.setItem(MAP_POS_KEY, JSON.stringify({
        lng: Math.max(-180, Math.min(180, centerLng)),
        lat: Math.max(-90, Math.min(90, centerLat)),
        zoom: Math.max(2, Math.min(20, bounds.zoom)),
      }));
    } catch (_) { /* ignore */ }
    if (!isSearchMode) {
      onViewportChange(bounds);
    }
  }, [isSearchMode, onViewportChange]);

  // ── Splash or main UI ──────────────────────────────────────────────────────
  // Show DB setup screen if hex database is not present yet
  if (!dbCheckDone || !dbPresent) {
    if (!dbCheckDone) {
      // Brief blank while checking (usually <100ms)
      return null;
    }
    return (
      <DbSetupScreen
        locale={locale}
        onComplete={() => setDbPresent(true)}
      />
    );
  }

  if (engineStatus !== 'ready') {
    return (
      <SplashScreen
        stage={splashStage}
        loadProgress={loadProgress}
        error={engineStatus === 'error' ? copy.engineFailedToStart : null}
        locale={locale}
      />
    );
  }

  return (
    <InlineErrorBoundary label="AppRoot">
    <div className="relative w-screen h-screen overflow-hidden select-none" style={{ background: '#0e0e0e' }}>
      {/* ── VDB Loading Banner ────────────────────────────────────────────────── */}
      {!indexReady && (
        <div className="absolute top-0 left-0 right-0 z-[700] pointer-events-none">
          <div className="h-[2px] overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${loadProgress || 5}%`,
                background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-light))',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Compare-picking banner ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {isPickingCompare && (
          <motion.div
            key="pick-compare-banner"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-[800] pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-[12px] select-none"
            style={{
              background: 'rgba(20, 20, 22, 0.80)',
              border: '0.5px solid rgba(74,150,255,0.35)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(74,150,255,0.08) inset',
              backdropFilter: 'blur(56px)',
            }}
          >
            <span className="w-[7px] h-[7px] rounded-full flex-shrink-0 animate-pulse" style={{ background: VIBE_COLORS.active }} />
            <span className="text-[12.5px] font-medium tracking-[-0.01em]" style={{ color: 'rgba(235,235,245,0.88)' }}>
              {copy.selectLocationToCompare}
            </span>
            <button
              onClick={() => setIsPickingCompare(false)}
              className="ml-1 w-[20px] h-[20px] rounded-full flex items-center justify-center transition-colors"
              style={{ color: 'rgba(235,235,245,0.45)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.80)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.45)'; }}
            >
              <X size={11} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Search result toast notification ───────────────────────────────── */}
      <AnimatePresence>
        {searchToast && (
          <motion.div
            key="search-toast"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed z-[600] pointer-events-none flex items-center gap-2 px-4 py-2.5 rounded-[12px]"
            style={{
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(20, 20, 22, 0.80)',
              border: '0.5px solid rgba(74,150,255,0.30)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(74,150,255,0.07) inset',
              backdropFilter: 'blur(56px)',
            }}
          >
            <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: VIBE_COLORS.urban }} />
            <span className="text-[12px] font-medium" style={{ color: 'rgba(235,235,245,0.88)' }}>
              {searchToast}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Full-screen Map ─────────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-[var(--color-bg)]">
        <MapLibreMap
          cities={displayedHexes}
          selectedCity={selectedCity}
          onCitySelect={handleCitySelect}
          onViewportChange={handleViewportChange}
          mode={isSearchMode ? 'search' : 'browse'}
          weights={weights}
          analysisMode={analysisMode}
          showLabels={showLabels}
          initialCenter={IS_PREVIEW ? [127.041, 37.521] : getStoredMapPos().center}
          initialZoom={IS_PREVIEW ? 11 : getStoredMapPos().zoom}
          flyToCenter={flyToCenter}
        />
      </div>

      {/* ── Floating Sidebar Panel ────────────────────────────────────────── */}
      <AnimatePresence>
        {!sidebarCollapsed && (
          <motion.div
            key="sidebar-panel"
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className="fixed z-[500]"
            style={{ top: '12px', left: '12px', bottom: '12px' }}
          >
            <Sidebar
              query={query}
              onQueryChange={handleQueryChange}
              onSearch={handleSearch_}
              loading={searchLoading || viewportLoading || !indexReady}
              searchResults={searchResults}
              hasSearched={hasSearched}
              isSearchMode={isSearchMode}
              recentQueries={recentQueries}
              onRemoveRecentQuery={removeRecentQuery}
              onClearRecentQueries={clearRecentQueries}
              validationMessage={!indexReady ? copy.loadingNeighborhoodData : validationMessage}
              minQueryLen={minQueryLen}
              quickChips={displayedHexes.length === 0 && !hasSearched && indexReady ? QUICK_CHIPS : []}
              selectedCity={selectedCity}
              onSelectCity={handleCitySelect}
              compareTarget={compareTarget}
              isPickingCompare={isPickingCompare}
              onCompareStart={handleCompareStart}
              onCompareSelect={handleCompareHexes}
              onCloseReport={handleCloseReport}
              weights={weights}
              presets={presets}
              bookmarks={bookmarks}
              analysisMode={analysisMode}
              showLegend={showLegend}
              showLabels={showLabels}
              hexCount={displayedHexes.length}
              totalInView={totalInView}
              engineMeta={engineMeta.mode ? { mode: engineMeta.mode, cityCount: engineMeta.cityCount ?? 0, sigma: engineMeta.sigma ?? 0 } : undefined}
              onWeightChange={setWeight}
              onApplyPreset={applyPreset}
              onSavePreset={savePreset}
              onDeletePreset={deletePreset}
              onResetWeights={resetWeights}
              onModeChange={setAnalysisMode}
              onToggleLegend={toggleLegend}
              onToggleLabels={toggleLabels}
              onBookmarkClick={(b) => {
                const hex = displayedHexes.find((h) => (h.h3_index || h.id) === b.h3_index);
                if (hex) handleCitySelect(hex);
              }}
              onBookmark={handleBookmark}
              onRemoveBookmark={removeBookmark}
              onUpdateBookmarkNote={updateBookmarkNote}
              dbCountries={dbCountries}
              dbCities={dbCities}
              onCountrySelect={fetchCities}
              isPremium={license.isPremium}
              tierLimits={license.tierLimits}
              onOpenLicenseModal={() => setLicenseModalOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenHelp={() => setHelpOpen(true)}
              engineBaseUrl={engineConfig?.base_url ?? ''}
              engineToken={engineConfig?.token ?? ''}
              locale={locale}
              onLocaleChange={setLocale}
              displayedHexes={displayedHexes}
              onCollapse={() => setSidebarCollapsed(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating sidebar toggle (when collapsed) ──────────────────────── */}
      <AnimatePresence>
        {sidebarCollapsed && (
          <motion.button
            key="sidebar-toggle"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            onClick={() => setSidebarCollapsed(false)}
            className="fixed top-4 left-4 z-[500] w-[44px] h-[44px] rounded-[12px] flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95"
            style={{
              background: 'rgba(20, 20, 22, 0.92)',
              backdropFilter: 'blur(56px) saturate(200%)',
              WebkitBackdropFilter: 'blur(56px) saturate(200%)',
              border: '0.5px solid rgba(255, 255, 255, 0.13)',
              boxShadow: '0 8px 32px rgba(0,0,8,0.55), 0 0 0 0.5px rgba(255,255,255,0.05) inset',
              color: 'rgba(255, 255, 255, 0.72)',
            }}
            title="Open panel"
          >
            <Menu size={18} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Compare Overlay ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {compareOverlayOpen && selectedCity && (
          <InlineErrorBoundary label="CompareOverlay">
            <CompareOverlay
              key="compare-overlay"
              baseHex={selectedCity}
              targetHex={compareTarget}
              allHexes={displayedHexes}
              onSelectTarget={handleCompareOverlayTarget}
              onSwap={handleCompareSwap}
              onClose={handleCompareOverlayClose}
              locale={locale}
            />
          </InlineErrorBoundary>
        )}
      </AnimatePresence>

      {/* ── Map empty state hint (only at city-level zoom where no data genuinely means gap) */}
      {displayedHexes.length === 0 && indexReady && !hasSearched && !searchLoading && currentZoom >= 7 && (
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[50] pointer-events-none flex flex-col items-center gap-1 text-center px-6 py-3 rounded-[16px]"
          style={{ background: 'rgba(20,20,22,0.94)', border: '0.5px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(56px)', maxWidth: '320px', boxShadow: '0 8px 28px rgba(0,0,0,0.50)' }}
        >
          <p className="text-[12px] font-semibold" style={{ color: 'rgba(235,235,245,0.70)' }}>{copy.mapEmptyHint}</p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.42)' }}>{copy.mapEmptySubhint}</p>
        </div>
      )}





      {/* ── Color legend ──────────────────────────────────────────────────────── */}
      <ColorLegend
        mode={isSearchMode ? 'search' : 'browse'}
        visible={showLegend}
        analysisMode={analysisMode}
        locale={locale}
        collapsed={sidebarCollapsed}
      />

      {/* ── Error toast ───────────────────────────────────────────────────────── */}
      <ErrorToast
        message={IS_PREVIEW ? null : searchError}
        onDismiss={clearError}
        onRetry={() => handleSearch_(query)}
        locale={locale}
      />

      {/* ── Connection lost banner ────────────────────────────────────────────── */}
      <AnimatePresence>
        {!engineOnline && !IS_PREVIEW && (
          <motion.div
            initial={{ y: -44, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -44, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 left-0 right-0 z-[90] flex items-center justify-center gap-2 px-4 py-2.5"
            style={{ background: 'rgba(28,28,30,0.96)', borderBottom: '0.5px solid rgba(248,113,113,0.22)', backdropFilter: 'blur(20px)' }}
          >
            <WifiOff size={12} style={{ color: 'var(--color-red)' }} />
            <span className="text-[11.5px] font-semibold" style={{ color: 'rgba(248,150,150,0.85)' }}>
              {copy.engineOffline}
            </span>
            {isReconnecting && (
              <span className="text-[11px]" style={{ color: 'rgba(235,235,245,0.50)' }}>
                — {copy.engineReconnecting}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Onboarding overlay ────────────────────────────────────────────────── */}
      {showOnboarding && (
        <OnboardingOverlay
          locale={locale}
          onDone={() => setShowOnboarding(false)}
        />
      )}

      {/* ── What's New modal (first launch) ────────────────────────────────── */}
      {showWhatsNew && !showOnboarding && (
        <WhatsNew
          locale={locale}
          onClose={() => setShowWhatsNew(false)}
        />
      )}

      {/* ── Help / keyboard shortcuts modal ────────────────────────────────── */}
      <AnimatePresence>
        {helpOpen && (
          <HelpModal
            key="help-modal"
            locale={locale}
            onClose={() => setHelpOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Settings modal ─────────────────────────────────────────────────────── */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onResetData={resetAll}
        locale={locale}
        onLocaleChange={setLocale}
        license={license}
        onManageLicense={() => { setSettingsOpen(false); setLicenseModalOpen(true); }}
        engineMeta={engineMeta.specVersion ? {
          spec_version: engineMeta.specVersion,
          total_hexagons: engineMeta.totalHexagons ?? 0,
          total_cities: engineMeta.totalCities ?? 0,
          built_at: engineMeta.builtAt ?? '',
        } : undefined}
      />

      {/* ── License activation modal ───────────────────────────────────────── */}
      {licenseModalOpen && (
        <LicenseActivation
          license={license}
          onClose={() => setLicenseModalOpen(false)}
          locale={locale}
        />
      )}

      {/* ── App update banner ──────────────────────────────────────────────── */}
      {updater.updateAvailable && (
        <UpdateBanner
          version={updater.version}
          installing={updater.installing}
          onInstall={updater.install}
          onDismiss={updater.dismiss}
          locale={locale}
        />
      )}

      {/* ── License expiry warning banner ──────────────────────────────────── */}
      {license.expiryWarning && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
          background: license.status?.in_grace_period
            ? 'rgba(239,68,68,0.92)' : 'rgba(245,158,11,0.92)',
          backdropFilter: 'blur(8px)',
          color: '#fff', fontSize: '13px', padding: '10px 20px',
          display: 'flex', alignItems: 'center', gap: '12px',
          borderTop: '0.5px solid rgba(255,255,255,0.15)',
        }}>
          <span style={{ flex: 1 }}>{license.expiryWarning}</span>
          <button
            onClick={() => setLicenseModalOpen(true)}
            style={{
              background: 'rgba(255,255,255,0.2)', border: '0.5px solid rgba(255,255,255,0.4)',
              color: '#fff', borderRadius: '6px', padding: '4px 12px',
              cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            }}
          >
            Renew
          </button>
        </div>
      )}
    </div>
    </InlineErrorBoundary>
  );
}
