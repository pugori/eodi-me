/**
 * AnalysisPanel — Google Places Insights-style left sidebar.
 *
 * Displays vibe weight controls, presets, bookmarks, and statistics.
 * All user data is managed locally — NEVER modifies the hexagon DB.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ChevronDown, ChevronRight,
  Sliders, Lock,
  TrendingUp, X, FileUp,
  BarChart2, BookmarkCheck, Map, RotateCcw, Plus, Trash2, Bookmark,
  Eye, EyeOff, Tag, Download, CheckCircle,
} from 'lucide-react';
import { VIBE_DIMENSIONS, computeSuitability } from '../../hooks/useUserData';
import {
  type VibeDimKey,
  type VibeWeights,
  type AnalysisPreset,
  type BookmarkedHex,
} from '../../hooks/useUserData';
import { getUiCopy } from '../../i18n/ui';
import { getVibeLabel, getVibeDescription } from '../../utils/vibeConstants';
import type { HexResult } from '../../hooks/useEngine';
import type { TierLimits } from '../../hooks/useLicense';

// ── Types ────────────────────────────────────────────────────────────────────
interface AnalysisPanelProps {
  weights: VibeWeights;
  presets: AnalysisPreset[];
  bookmarks: BookmarkedHex[];
  analysisMode: 'suitability' | 'comparison' | 'explore';
  showLegend: boolean;
  showLabels: boolean;
  hexCount: number;
  totalInView: number;
  isSearchMode: boolean;
  engineMeta?: { mode: string; cityCount: number; sigma: number };
  onWeightChange: (key: VibeDimKey, value: number) => void;
  onApplyPreset: (id: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onResetWeights: () => void;
  onModeChange: (mode: 'suitability' | 'comparison' | 'explore') => void;
  onToggleLegend: () => void;
  onToggleLabels: () => void;
  onBookmarkClick: (b: BookmarkedHex) => void;
  onRemoveBookmark: (h3: string) => void;
  onUpdateBookmarkNote?: (h3: string, note: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  locale?: string;
  candidateHexes?: HexResult[];
  selectedHex?: HexResult | null;
  onSelectHex?: (hex: HexResult) => void;
  onCompareHexes?: (baseHex: HexResult, targetHex: HexResult) => void;
  onApplyPoiOverlaySingle?: (payload: { h3Index: string; poiCounts: number[] }) => Promise<boolean>;
  onApplyPoiOverlayBulk?: (items: { h3Index: string; poiCounts: number[] }[]) => Promise<{ applied: number; failed: number } | null>;
  overlayBusy?: boolean;
  overlayStatus?: string | null;
  isPremium?: boolean;
  /** Fine-grained tier limits — when provided, overrides isPremium checks */
  tierLimits?: TierLimits;
  onOpenLicenseModal?: () => void;
  /** Full country list from engine DB. */
  dbCountries?: string[];
  /** Cities for the currently selected country (from engine DB). */
  dbCities?: string[];
  /** Callback to fetch cities when country changes. */
  onCountrySelect?: (countryCode: string) => void;
  /** Batch analysis: search multiple locations by name and export results */
  engineBaseUrl?: string;
  engineToken?: string;
}

// ── Suitability Score Histogram ──────────────────────────────────────────────
// Displays the distribution of hex suitability scores in 10 equal buckets.
// Design basis: ESRI Business Analyst's "Results pane histogram" (2024 release).
// Shows users WHERE on the score distribution the hexagons cluster, enabling
// threshold-based decisions (Bertin 1983, "Semiology of Graphics").
const HIST_BINS = 10;
const HIST_COLORS: [number, [string, string]][] = [
  [0.0, ['#4A5260', '#4A5260']],  // 0-10%: slate gray
  [0.2, ['#3478BE', '#2A6AAE']],  // 10-30%: steel blue
  [0.5, ['#10BABA', '#0DAAAA']],  // 30-60%: teal
  [0.7, ['#50C86E', '#40B85E']],  // 60-80%: sage green
  [1.0, ['#FFAB32', '#F09A22']],  // 80-100%: warm gold
];

function histBarColor(bucketCenter: number): string {
  for (let i = HIST_COLORS.length - 1; i >= 0; i--) {
    if (bucketCenter >= HIST_COLORS[i][0]) return HIST_COLORS[i][1][0];
  }
  return HIST_COLORS[0][1][0];
}

/** Skeleton histogram bars shown while radar data is loading. */
const SKELETON_HEIGHTS = [0.3, 0.55, 0.7, 0.85, 1.0, 0.9, 0.75, 0.55, 0.35, 0.2];
function HistogramSkeleton() {
  return (
    <div className="mt-3 mb-1 px-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="h-2.5 rounded-full animate-pulse w-24" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <div className="h-2.5 rounded-full animate-pulse w-12" style={{ background: 'rgba(255,255,255,0.06)' }} />
      </div>
      <div className="flex items-end gap-[2px]" style={{ height: 36 }}>
        {SKELETON_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-[2px] animate-pulse"
            style={{ height: `${h * 100}%`, background: 'rgba(255,255,255,0.07)' }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.30)' }}>0%</span>
        <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.30)' }}>50%</span>
        <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.30)' }}>100%</span>
      </div>
    </div>
  );
}

const SuitabilityHistogram = React.memo(function SuitabilityHistogram({
  hexes,
  weights,
  analysisMode,
  locale,
}: {
  hexes: HexResult[];
  weights: VibeWeights;
  analysisMode: 'suitability' | 'comparison' | 'explore';
  locale?: string;
}) {
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const bins = useMemo(() => {
    const scored = hexes
      .filter(h => h.radar)
      .map(h => computeSuitability(h.radar, weights));
    if (scored.length === 0) return null;
    const counts = new Array(HIST_BINS).fill(0);
    for (const s of scored) {
      const idx = Math.min(HIST_BINS - 1, Math.floor(s * HIST_BINS));
      counts[idx]++;
    }
    const maxCount = Math.max(...counts, 1);
    return { counts, maxCount, total: scored.length };
  }, [hexes, weights]);

  if (analysisMode === 'explore') return null;

  // Show skeleton while hexes are present but radar data hasn't loaded yet
  if (hexes.length > 0 && !bins) return <HistogramSkeleton />;

  if (!bins) return null;

  return (
    <div className="mt-3 mb-1 px-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold tracking-[0.06em] uppercase" style={{ color: 'rgba(235,235,245,0.52)' }}>
          {copy.scoreDistribution}
        </span>
        <span className="text-[9.5px] font-medium tabular-nums" style={{ color: 'rgba(235,235,245,0.55)' }}>
          {copy.zoneCount(bins.total)}
        </span>
      </div>
      <div className="flex items-end gap-[2px]" style={{ height: 36 }}>
        {bins.counts.map((count, i) => {
          const bucketCenter = (i + 0.5) / HIST_BINS;
          const heightPct = count / bins.maxCount;
          const color = histBarColor(bucketCenter);
          return (
            <div
              key={i}
              className="flex-1 rounded-[2px] transition-all duration-200"
              style={{
                height: `${Math.max(heightPct * 100, count > 0 ? 6 : 2)}%`,
                background: count > 0 ? color : 'rgba(255,255,255,0.06)',
                opacity: count > 0 ? 0.85 : 0.4,
              }}
              title={`${Math.round(i * 10)}–${Math.round((i + 1) * 10)}%: ${count}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.50)' }}>0%</span>
        <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.50)' }}>50%</span>
        <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.50)' }}>100%</span>
      </div>
    </div>
  );
});

// ── CSV Export ───────────────────────────────────────────────────────────────

function downloadCSV(filename: string, headers: string[], rows: string[][]): void {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const csv = [headers, ...rows].map(row => row.map(esc).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function radarSimilarity(a?: Record<string, number>, b?: Record<string, number>): number {
  if (!a || !b) return 0;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const key of keys) {
    const av = Math.abs(Number(a[key] ?? 0));
    const bv = Math.abs(Number(b[key] ?? 0));
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function hexLabel(hex: HexResult): string {
  return hex.admin_name || hex.name || hex.parent_city_name || hex.city || '—';
}

function hexSubLabel(hex: HexResult): string {
  const city = hex.parent_city_name || hex.city || '';
  const country = hex.country || '';
  return [city, country].filter(Boolean).join(' · ') || '—';
}

function toNonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function parseBulkOverlayInput(raw: string): { h3Index: string; poiCounts: number[] }[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error('Invalid JSON format. Please check your input.');
    }
    const list = Array.isArray(json) ? json : [json];
    return list
      .map((item: any) => {
        const h3Index = String(item.h3_index ?? item.h3Index ?? '').trim();
        if (!h3Index) return null;

        if (Array.isArray(item.poi_counts) && item.poi_counts.length >= 7) {
          return {
            h3Index,
            poiCounts: item.poi_counts.slice(0, 7).map((v: any) => Math.max(0, Math.round(Number(v) || 0))),
          };
        }

        const dims = [
          toNonNegativeInt(String(item.active ?? 0)),
          toNonNegativeInt(String(item.classic ?? 0)),
          toNonNegativeInt(String(item.quiet ?? 0)),
          toNonNegativeInt(String(item.trendy ?? 0)),
          toNonNegativeInt(String(item.nature ?? 0)),
          toNonNegativeInt(String(item.urban ?? 0)),
        ];
        const total = dims.reduce((s, n) => s + n, 0);
        return { h3Index, poiCounts: [...dims, total] };
      })
      .filter(Boolean) as { h3Index: string; poiCounts: number[] }[];
  }

  const rows = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return rows
    .map((row, idx) => {
      const cols = row.split(',').map((v) => v.trim());
      if (idx === 0 && /h3|active|classic|quiet|trendy|nature|urban/i.test(row)) {
        return null;
      }
      if (cols.length < 7) return null;

      const h3Index = cols[0];
      if (!h3Index) return null;

      const dims = cols.slice(1, 7).map((v) => toNonNegativeInt(v));
      const total = cols.length >= 8 ? toNonNegativeInt(cols[7]) : dims.reduce((s, n) => s + n, 0);
      return { h3Index, poiCounts: [...dims, total] };
    })
    .filter(Boolean) as { h3Index: string; poiCounts: number[] }[];
}

// ── Business Type Quick Presets ──────────────────────────────────────────────
// Pre-calibrated vibe weight profiles for common SMB business types.
// Weights are tuned so that high-scoring hexagons statistically correlate
// with locations where these business types thrive (based on OSM POI distributions).
interface BusinessPreset {
  id: string;
  icon: string;
  labels: Record<string, string>;
  weights: Record<string, number>;
}

const BUSINESS_PRESETS: BusinessPreset[] = [
  {
    id: 'cafe',
    icon: '☕',
    labels: { en: 'Café', ko: '카페', ja: 'カフェ', zh: '咖啡', es: 'Café', fr: 'Café', de: 'Café', pt: 'Café' },
    weights: { active: 7, classic: 5, quiet: 4, trendy: 10, nature: 3, urban: 8 },
  },
  {
    id: 'restaurant',
    icon: '🍽️',
    labels: { en: 'F&B', ko: '식음료', ja: '飲食', zh: '餐饮', es: 'Restaurante', fr: 'F&B', de: 'F&B', pt: 'F&B' },
    weights: { active: 9, classic: 4, quiet: 2, trendy: 7, nature: 3, urban: 9 },
  },
  {
    id: 'retail',
    icon: '🛍️',
    labels: { en: 'Retail', ko: '소매', ja: '小売', zh: '零售', es: 'Venta', fr: 'Commerce', de: 'Handel', pt: 'Varejo' },
    weights: { active: 7, classic: 4, quiet: 2, trendy: 9, nature: 2, urban: 10 },
  },
  {
    id: 'convenience',
    icon: '🏪',
    labels: { en: 'Convenience', ko: '편의점', ja: 'コンビニ', zh: '便利店', es: 'Tienda', fr: 'Épicerie', de: 'Kiosk', pt: 'Mercado' },
    weights: { active: 8, classic: 3, quiet: 3, trendy: 5, nature: 2, urban: 9 },
  },
  {
    id: 'wellness',
    icon: '💆',
    labels: { en: 'Wellness', ko: '웰니스', ja: '美容/健康', zh: '健康美容', es: 'Bienestar', fr: 'Bien-être', de: 'Wellness', pt: 'Bem-estar' },
    weights: { active: 4, classic: 6, quiet: 9, trendy: 7, nature: 7, urban: 3 },
  },
];

// ── Section Header ───────────────────────────────────────────────────────────
const SectionHeader = ({
  icon: Icon,
  title,
  open,
  onToggle,
  count,
  locked,
}: {
  icon: React.ElementType;
  title: string;
  open: boolean;
  onToggle: () => void;
  count?: number;
  locked?: boolean;
}) => (
  <button
    onClick={onToggle}
    className="w-full flex items-center gap-2.5 px-4 py-[10px] transition-colors duration-120 group"
    style={{ borderBottom: open ? 'none' : '0.5px solid var(--color-border)' }}
  >
    <Icon size={12} style={{ color: 'rgba(100,140,255,0.40)', flexShrink: 0 }} className="group-hover:opacity-70 transition-opacity" />
    <span
      className="text-[11px] font-semibold flex-1 text-left tracking-[0.05em] uppercase"
      style={{ color: 'rgba(235,235,245,0.52)' }}
    >
      {title}
    </span>
    {locked && (
      <Lock size={9} style={{ color: 'rgba(139,92,246,0.60)', flexShrink: 0, marginRight: 4 }} />
    )}
    {count != null && count > 0 && (
      <span className="text-[9px] font-bold px-1.5 py-[2px] rounded-full mr-1" style={{ color: 'var(--color-accent)', background: 'var(--color-accent-dim)' }}>
        {count}
      </span>
    )}
    {open
      ? <ChevronDown size={10} style={{ color: 'rgba(235,235,245,0.50)', flexShrink: 0 }} />
      : <ChevronRight size={10} style={{ color: 'rgba(235,235,245,0.50)', flexShrink: 0 }} />
    }
  </button>
);

// ── Main Panel ───────────────────────────────────────────────────────────────
export const AnalysisPanel = React.memo(function AnalysisPanel({
  weights,
  presets,
  bookmarks,
  analysisMode,
  showLegend,
  showLabels,
  hexCount,
  totalInView,
  isSearchMode,
  engineMeta,
  onWeightChange,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  onResetWeights,
  onModeChange,
  onToggleLegend,
  onToggleLabels,
  onBookmarkClick,
  onRemoveBookmark,
  onUpdateBookmarkNote,
  collapsed,
  onToggleCollapse,
  locale = 'en',
  candidateHexes = [],
  selectedHex = null,
  onSelectHex,
  onCompareHexes,
  onApplyPoiOverlaySingle,
  onApplyPoiOverlayBulk,
  overlayBusy = false,
  overlayStatus = null,
  isPremium = false,
  tierLimits,
  onOpenLicenseModal,
  dbCountries = [],
  dbCities = [],
  onCountrySelect,
  engineBaseUrl = '',
  engineToken = '',
}: AnalysisPanelProps) {
  const copy = useMemo(() => getUiCopy(locale), [locale]);

  // Feature gates — prefer tierLimits when passed, otherwise fall back to isPremium
  const canMatch        = tierLimits ? tierLimits.canMatch        : isPremium;
  const canOverlayPoi   = tierLimits ? tierLimits.canOverlayPoi   : isPremium;
  const canPresets      = tierLimits ? tierLimits.canPresets      : isPremium;
  const canExport       = tierLimits ? tierLimits.canExport       : isPremium;
  const canBatchAnalysis = tierLimits ? tierLimits.canBatchAnalysis : false;

  const [openSections, setOpenSections] = useState({
    suitability: true,
    presets: false,
    display: false,
    bookmarks: false,
    stats: false,
    locationCompare: false,
    b2bPoi: false,
    batchAnalysis: false,
  });

  const [presetName, setPresetName] = useState('');
  const [editingNoteH3, setEditingNoteH3] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState('');
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

  const flashExport = useCallback((msg: string) => {
    setExportFeedback(msg);
    setTimeout(() => setExportFeedback(null), 2200);
  }, []);

  const handleExportBookmarks = useCallback(() => {
    if (bookmarks.length === 0) return;
    const headers = ['Name', 'Country', 'H3 Index', 'Latitude', 'Longitude', 'Note', 'Saved At'];
    const rows = bookmarks.map(b => [
      b.name, b.country, b.h3_index,
      b.lat.toFixed(6), b.lng.toFixed(6),
      b.note || '',
      new Date(b.savedAt).toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US'),
    ]);
    downloadCSV(`eodi-bookmarks-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    flashExport(copy.exportedRows(bookmarks.length));
  }, [bookmarks, copy, flashExport]);

  const handleExportAnalysis = useCallback(() => {
    const dims = ['active', 'classic', 'quiet', 'trendy', 'nature', 'urban'];
    const hexesWithRadar = candidateHexes.filter(h => h.radar);
    if (hexesWithRadar.length === 0) return;
    const scored = hexesWithRadar
      .map(h => ({ h, score: computeSuitability(h.radar, weights) }))
      .sort((a, b) => b.score - a.score);
    const headers = ['Rank', 'Name', 'Country', 'City', 'H3 Index', 'Suitability Score (%)',
      'Active', 'Culture', 'Quiet', 'Trendy', 'Nature', 'Urban'];
    const rows = scored.map(({ h, score }, i) => [
      String(i + 1),
      h.admin_name || h.name || '—',
      h.country || '—',
      h.parent_city_name || (h as any).city || '—',
      h.h3_index || h.id || h.city_id || '—',
      String(Math.round(score * 100)),
      ...dims.map(d => String(Math.round(Math.abs((h.radar?.[d] ?? 0)) * 100))),
    ]);
    downloadCSV(`eodi-analysis-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    flashExport(copy.exportedRows(scored.length));
  }, [candidateHexes, weights, copy, flashExport]);

  const [countryFilter, setCountryFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [neighborhoodFilter, setNeighborhoodFilter] = useState('');
  const [poiH3, setPoiH3] = useState('');
  const [poiCounts, setPoiCounts] = useState({ active: '0', classic: '0', quiet: '0', trendy: '0', nature: '0', urban: '0' });
  const [bulkText, setBulkText] = useState('');

  // ── Address → H3 geocoding state ─────────────────────────────────────────
  const [addressQuery, setAddressQuery] = useState('');
  const [addressStatus, setAddressStatus] = useState<'idle' | 'searching' | 'found' | 'notfound'>('idle');
  const [addressFoundName, setAddressFoundName] = useState('');

  const handleAddressSearch = useCallback(async () => {
    const q = addressQuery.trim();
    if (!q || !engineBaseUrl) return;
    setAddressStatus('searching');
    setAddressFoundName('');
    try {
      const headers: Record<string, string> = engineToken ? { Authorization: `Bearer ${engineToken}` } : {};
      const r = await fetch(`${engineBaseUrl}/geocode/h3?q=${encodeURIComponent(q)}`, { headers });
      if (!r.ok) { setAddressStatus('notfound'); return; }
      const data = await r.json();
      if (data.h3) {
        setPoiH3(data.h3);
        setAddressFoundName(data.display_name || q);
        setAddressStatus('found');
      } else {
        setAddressStatus('notfound');
      }
    } catch {
      setAddressStatus('notfound');
    }
  }, [addressQuery, engineBaseUrl, engineToken]);

  // ── Batch Analysis state ─────────────────────────────────────────────────
  const [batchInput, setBatchInput] = useState('');
  const [batchResults, setBatchResults] = useState<{ name: string; score: number; grade: string; country: string; h3: string }[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const handleRunBatch = useCallback(async () => {
    const lines = batchInput.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults([]);
    const results: typeof batchResults = [];
    for (const name of lines.slice(0, 20)) {
      try {
        const headers: Record<string, string> = engineToken ? { Authorization: `Bearer ${engineToken}` } : {};
        const r = await fetch(`${engineBaseUrl}/hex/search?q=${encodeURIComponent(name)}&limit=1`, { headers });
        if (!r.ok) continue;
        const data = await r.json();
        const hit = Array.isArray(data) ? data[0] : data?.results?.[0];
        if (!hit) continue;
        const score = Math.round((hit.score ?? hit.similarity ?? 0) * 100);
        const gradeMap: Record<string, string[]> = {
          ko: ['미흡', '낮음', '보통', '양호', '우수', '최상'],
          ja: ['不足', '低め', '普通', '良好', '優良', '最高'],
        };
        const gradeLabels = gradeMap[locale] ?? ['Sparse', 'Low', 'Average', 'Fair', 'Good', 'Excellent'];
        const gradeIdx = score >= 88 ? 5 : score >= 72 ? 4 : score >= 55 ? 3 : score >= 40 ? 2 : score >= 25 ? 1 : 0;
        const grade = gradeLabels[gradeIdx];
        results.push({ name: hit.name ?? name, score, grade, country: hit.country ?? '', h3: hit.h3_index ?? hit.id ?? '' });
      } catch { /* skip */ }
    }
    results.sort((a, b) => b.score - a.score);
    setBatchResults(results);
    setBatchBusy(false);
  }, [batchInput, engineBaseUrl, engineToken, locale]);

  const handleExportBatch = useCallback(() => {
    if (batchResults.length === 0) return;
    const headers = ['Rank', 'Name', 'Country', 'Score', 'Grade', 'H3 Index'];
    const rows = batchResults.map((r, i) => [String(i + 1), r.name, r.country, String(r.score), r.grade, r.h3]);
    downloadCSV(`eodi-batch-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }, [batchResults]);

  const toggle = useCallback(
    (key: keyof typeof openSections) =>
      setOpenSections((p) => ({ ...p, [key]: !p[key] })),
    [],
  );

  // ── Cascading dropdown options ──────────────────────────────────────────
  // Use DB country list when available, otherwise fall back to client-side extraction.
  const countryOptions = useMemo(() => {
    if (dbCountries.length > 0) return dbCountries;
    const set = new Set<string>();
    for (const hex of candidateHexes) {
      const c = (hex.country || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [dbCountries, candidateHexes]);

  // Use DB city list when country is selected and DB provides them,
  // otherwise fall back to client-side extraction.
  const cityOptions = useMemo(() => {
    if (countryFilter && dbCities.length > 0) return dbCities;
    const set = new Set<string>();
    for (const hex of candidateHexes) {
      if (countryFilter && (hex.country || '') !== countryFilter) continue;
      const c = (hex.parent_city_name || hex.city || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [countryFilter, dbCities, candidateHexes]);

  const neighborhoodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const hex of candidateHexes) {
      if (countryFilter && (hex.country || '') !== countryFilter) continue;
      const city = (hex.parent_city_name || hex.city || '').trim();
      if (cityFilter && city !== cityFilter) continue;
      const hood = (hex.admin_name || hex.name || '').trim();
      if (hood) set.add(hood);
    }
    return Array.from(set).sort();
  }, [candidateHexes, countryFilter, cityFilter]);

  // Reset dependent filters on parent change
  const handleCountryChange = useCallback((value: string) => {
    setCountryFilter(value);
    setCityFilter('');
    setNeighborhoodFilter('');
    // Fetch cities from DB for the selected country
    onCountrySelect?.(value);
  }, [onCountrySelect]);

  const handleCityChange = useCallback((value: string) => {
    setCityFilter(value);
    setNeighborhoodFilter('');
  }, []);

  const filteredHexes = useMemo(() => {
    return candidateHexes.filter((hex) => {
      const country = (hex.country || '').trim();
      const city = (hex.parent_city_name || hex.city || '').trim();
      const hood = (hex.admin_name || hex.name || '').trim();

      if (countryFilter && country !== countryFilter) return false;
      if (cityFilter && city !== cityFilter) return false;
      if (neighborhoodFilter && hood !== neighborhoodFilter) return false;
      return true;
    });
  }, [candidateHexes, countryFilter, cityFilter, neighborhoodFilter]);

  const baseHex = useMemo(() => {
    if (
      selectedHex &&
      filteredHexes.some((h) => (h.h3_index || h.id || h.city_id) === (selectedHex.h3_index || selectedHex.id || selectedHex.city_id))
    ) {
      return selectedHex;
    }
    return filteredHexes[0] ?? null;
  }, [selectedHex, filteredHexes]);

  const top3Matches = useMemo(() => {
    if (!baseHex) return [];
    const baseId = baseHex.h3_index || baseHex.id || baseHex.city_id;
    return filteredHexes
      .filter((hex) => (hex.h3_index || hex.id || hex.city_id) !== baseId)
      .map((hex) => ({
        hex,
        similarity: radarSimilarity(baseHex.radar, hex.radar),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);
  }, [baseHex, filteredHexes]);

  useEffect(() => {
    if (!poiH3 && selectedHex) {
      const h3 = selectedHex.h3_index || selectedHex.id || selectedHex.city_id || '';
      if (h3) setPoiH3(h3);
    }
  }, [selectedHex, poiH3]);

  const totalPoi = useMemo(() => {
    return ['active', 'classic', 'quiet', 'trendy', 'nature', 'urban']
      .map((key) => toNonNegativeInt(poiCounts[key as keyof typeof poiCounts]))
      .reduce((s, n) => s + n, 0);
  }, [poiCounts]);

  const handleApplySinglePoi = useCallback(async () => {
    if (!onApplyPoiOverlaySingle) return;
    const h3Index = poiH3.trim();
    if (!h3Index) return;

    const dims = [
      toNonNegativeInt(poiCounts.active),
      toNonNegativeInt(poiCounts.classic),
      toNonNegativeInt(poiCounts.quiet),
      toNonNegativeInt(poiCounts.trendy),
      toNonNegativeInt(poiCounts.nature),
      toNonNegativeInt(poiCounts.urban),
    ];

    await onApplyPoiOverlaySingle({
      h3Index,
      poiCounts: [...dims, dims.reduce((s, n) => s + n, 0)],
    });
  }, [onApplyPoiOverlaySingle, poiH3, poiCounts]);

  const handleApplyBulkPoi = useCallback(async () => {
    if (!onApplyPoiOverlayBulk) return;
    let parsed: { h3Index: string; poiCounts: number[] }[] = [];
    try {
      parsed = parseBulkOverlayInput(bulkText);
    } catch {
      return;
    }
    if (parsed.length === 0) return;
    await onApplyPoiOverlayBulk(parsed);
  }, [onApplyPoiOverlayBulk, bulkText]);

  const handleBulkFile = useCallback(async (file: File | null) => {
    if (!file || !onApplyPoiOverlayBulk) return;
    try {
      const text = await file.text();
      setBulkText(text);
      const parsed = parseBulkOverlayInput(text);
      if (parsed.length === 0) {
        flashExport('No valid rows found in file');
        return;
      }
      await onApplyPoiOverlayBulk(parsed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to read file';
      flashExport(msg.length > 60 ? msg.slice(0, 60) + '…' : msg);
    }
  }, [onApplyPoiOverlayBulk, flashExport]);

  // ── Collapsed state: thin rail ────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="analysis-panel-collapsed">
        <button
          onClick={onToggleCollapse}
          className="flex flex-col items-center gap-4 py-4 w-full"
          aria-label={copy.analysisRailAria}
        >
          <Sliders size={18} className="text-white/50" />
          <span className="text-[9px] text-white/30 uppercase tracking-widest font-bold writing-vertical">
            {copy.analysisRailTitle}
          </span>
        </button>
      </div>
    );
  }

  // ── Expanded panel ────────────────────────────────────────────────────────
  return (
    <div className="analysis-panel" role="complementary" aria-label={copy.analysisPanelAria}>
      {/* Scrollable content — no inner header (App.tsx provides panel header) */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pb-36">

        {/* ── Suitability Criteria (Weight Sliders) ──────────────────────── */}
        <SectionHeader
          icon={Sliders}
          title={copy.suitabilityCriteria}
          open={openSections.suitability}
          onToggle={() => toggle('suitability')}
        />
        {openSections.suitability && (
          <div className="px-4 pb-3 space-y-0.5">
            {/* Mode tabs — navy segmented control */}
            <div className="flex gap-0.5 mb-3.5 p-[3px] rounded-[10px]" style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid var(--color-border-2)' }}>
              {(['explore', 'suitability', 'comparison'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className="flex-1 py-[9px] rounded-[8px] text-[11.5px] font-medium tracking-[-0.004em] transition-all duration-140"
                  style={analysisMode === m
                    ? { background: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.88)', boxShadow: '0 1px 3px rgba(0,0,8,0.28)' }
                    : { color: 'rgba(235,235,245,0.40)' }
                  }
                >
                  {m === 'explore' ? copy.modeExplore : m === 'suitability' ? copy.modeSuitability : copy.modeCompare}
                </button>
              ))}
            </div>

            {/* ── Business type quick presets ────────────────────────────── */}
            <div className="mb-3.5">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.055em] mb-2" style={{ color: 'rgba(235,235,245,0.35)' }}>
                {locale === 'ko' ? '업종별 최적화' : locale === 'ja' ? '業種別最適化' : locale === 'zh' ? '按业务类型' : 'Business Type'}
              </p>
              <div className="flex gap-1 flex-wrap">
                {BUSINESS_PRESETS.map((preset) => {
                  const lang = ['ko', 'ja', 'zh', 'es', 'fr', 'de', 'pt'].includes(locale) ? locale : 'en';
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        (['active', 'classic', 'quiet', 'trendy', 'nature', 'urban'] as const).forEach((key) => {
                          onWeightChange(key, preset.weights[key]);
                        });
                      }}
                      className="px-2.5 py-1.5 rounded-[8px] text-[10.5px] font-medium transition-all duration-150 active:scale-95"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '0.5px solid rgba(255,255,255,0.12)',
                        color: 'rgba(235,235,245,0.65)',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(79,110,247,0.10)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(79,110,247,0.35)';
                        (e.currentTarget as HTMLElement).style.color = 'rgba(165,180,252,0.90)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
                        (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.65)';
                      }}
                      title={Object.entries(preset.weights).map(([k, v]) => `${k}: ${v}`).join(', ')}
                    >
                      {preset.icon} {preset.labels[lang] ?? preset.labels.en}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Weight sliders */}
            <div className="space-y-3">
              {VIBE_DIMENSIONS.map(({ key, label, icon, color, desc }) => {
                const val = weights[key];
                const pct = ((val - 1) / 9 * 100).toFixed(1);
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="relative inline-flex items-center gap-1.5 group">
                        <span className="text-[12.5px] font-normal flex items-center gap-1.5 tracking-[-0.006em]" style={{ color: 'rgba(235,235,245,0.65)' }}>
                          <span className="text-[13px] opacity-70">{icon}</span>
                          <span>{getVibeLabel(key, locale)}</span>
                        </span>
                        {(() => {
                          const desc = getVibeDescription(key, locale);
                          return desc ? (
                            <>
                              <span
                                className="inline-flex w-[13px] h-[13px] rounded-full items-center justify-center cursor-help flex-shrink-0 select-none"
                                style={{
                                  background: 'rgba(255,255,255,0.09)',
                                  border: '0.5px solid rgba(255,255,255,0.16)',
                                  color: 'rgba(235,235,245,0.55)',
                                  fontSize: '8px',
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                                aria-label={desc}
                                role="img"
                                tabIndex={0}
                              >i</span>
                              <div
                                className="absolute bottom-full left-0 z-[200] mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                style={{
                                  width: '218px',
                                  padding: '8px 10px',
                                  background: 'rgba(22,22,26,0.98)',
                                  border: '0.5px solid rgba(255,255,255,0.14)',
                                  borderRadius: '8px',
                                  boxShadow: '0 8px 28px rgba(0,0,0,0.70)',
                                  backdropFilter: 'blur(20px)',
                                  WebkitBackdropFilter: 'blur(20px)',
                                }}
                              >
                                <p className="text-[10.5px] leading-[1.55] m-0" style={{ color: 'rgba(235,235,245,0.78)' }}>
                                  {desc}
                                </p>
                              </div>
                            </>
                          ) : null;
                        })()}
                      </div>
                      {/* Value: colored pill badge with aria-live for screen readers */}
                      <span
                        role="status"
                        aria-live="polite"
                        aria-label={`${getVibeLabel(key, locale)}: ${val}`}
                        className="text-[11.5px] font-bold tabular-nums px-2 py-0.5 rounded-full leading-none flex-shrink-0"
                        style={{ color, background: `${color}1A`, border: `0.5px solid ${color}33` }}
                      >{val}</span>
                    </div>
                    <input
                      type="range"
                      min={1} max={10} step={1}
                      value={val}
                      onChange={(e) => onWeightChange(key, Number(e.target.value))}
                      className="vibe-slider w-full rounded-full appearance-none cursor-pointer"
                      style={{
                        /* Track: 65% opacity = desaturated per Elliot & Maier (2010) */
                        background: `linear-gradient(to right, ${color}cc ${pct}%, rgba(255,255,255,0.07) ${pct}%)`,
                        '--thumb-color': color,
                      } as React.CSSProperties}
                    />
                  </div>
                );
              })}
            </div>

            <button
              onClick={onResetWeights}
              className="mt-3 flex items-center gap-1.5 text-[11.5px] transition-all duration-150 px-3 py-1.5 rounded-[9px] w-full justify-center active:scale-[0.97]"
              style={{ color: 'rgba(235,235,245,0.50)', border: '0.5px solid var(--color-border-2)' }}
              aria-label={copy.resetWeightsAria}
              onMouseEnter={e => {
                (e.currentTarget).style.background = 'rgba(255,255,255,0.06)';
                (e.currentTarget).style.color = 'rgba(235,235,245,0.72)';
              }}
              onMouseLeave={e => {
                (e.currentTarget).style.background = 'transparent';
                (e.currentTarget).style.color = 'rgba(235,235,245,0.50)';
              }}
            >
              <RotateCcw size={10} />
              {copy.reset}
            </button>
            {candidateHexes.length > 0 && (
              <SuitabilityHistogram
                hexes={candidateHexes}
                weights={weights}
                analysisMode={analysisMode}
                locale={locale}
              />
            )}

            {/* ── Comparison mode guide ────────────────────────────────────── */}
            {analysisMode === 'comparison' && (
              <div
                className="mt-3 rounded-[12px] p-3.5 flex flex-col gap-2"
                style={{ background: 'rgba(79,110,247,0.06)', border: '0.5px solid rgba(79,110,247,0.18)' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-[8px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(79,110,247,0.12)' }}>
                    <Map size={12} style={{ color: 'rgba(123,147,255,0.70)' }} />
                  </div>
                  <span className="text-[12px] font-semibold" style={{ color: 'rgba(255,255,255,0.80)' }}>
                    {copy.compareGuideTitle}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.50)' }}>
                  {copy.compareGuideBody}
                </p>
                <ol className="text-[10.5px] space-y-1.5 pl-1" style={{ color: 'rgba(235,235,245,0.42)' }}>
                  <li>{copy.compareGuideStep1}</li>
                  <li>{copy.compareGuideStep2.replace('"', '\u201C').replace('"', '\u201D')}</li>
                  <li>{copy.compareGuideStep3}</li>
                </ol>
              </div>
            )}

            {candidateHexes.filter(h => h.radar).length > 0 && (
              canExport ? (
              <button
                onClick={handleExportAnalysis}
                className="flex items-center gap-1.5 text-[11px] transition-all duration-300 px-3 py-1.5 rounded-[9px] w-full justify-center"
                style={{
                  color: exportFeedback ? 'rgba(52,211,153,0.90)' : 'rgba(235,235,245,0.55)',
                  border: exportFeedback ? '0.5px solid rgba(52,211,153,0.30)' : '0.5px solid var(--color-border-2)',
                  background: exportFeedback ? 'rgba(52,211,153,0.08)' : 'transparent',
                }}
              >
                {exportFeedback ? <CheckCircle size={10} /> : <Download size={10} />}
                {exportFeedback ?? copy.exportAnalysisBtn}
              </button>
              ) : (
              <button
                onClick={onOpenLicenseModal}
                className="flex items-center gap-1.5 text-[11px] transition-colors px-3 py-1.5 rounded-[9px] w-full justify-center"
                style={{ color: 'rgba(235,235,245,0.55)', border: '0.5px solid var(--color-border-2)' }}
                title={copy.exportGateTip}
              >
                <Lock size={10} />
                {copy.exportAnalysisBtn}
              </button>
              )
            )}
          </div>
        )}

        {/* ── Analysis Presets ───────────────────────────────────────────── */}
        <SectionHeader
          icon={BarChart2}
          title={copy.analysisPresets}
          open={openSections.presets}
          onToggle={() => toggle('presets')}
          count={presets.length}
        />
        {openSections.presets && (
          <div className="px-4 pb-3 space-y-2">
            {!canPresets ? (
              /* Presets feature gate — Personal plan required */
              <div
                className="rounded-[12px] p-4 flex flex-col items-center text-center gap-2"
                style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}
              >
                <Lock size={15} style={{ color: 'rgba(100,140,255,0.45)' }} />
                <p className="text-[11px] leading-[1.5]" style={{ color: 'rgba(235,235,245,0.55)' }}>
                  {copy.presetsGateTip}
                </p>
                <button
                  onClick={onOpenLicenseModal}
                  className="mt-1 px-3 py-1.5 rounded-[8px] text-[10.5px] font-semibold transition-all"
                  style={{ background: 'var(--color-accent-dim)', border: '0.5px solid rgba(79,110,247,0.35)', color: 'var(--color-accent-light)' }}
                >
                  {copy.upgradeNow}
                </button>
              </div>
            ) : (
            <>
            {/* Existing presets */}
            <div className="space-y-1">
              {presets.length === 0 && (
                <div
                  className="rounded-[10px] px-3 py-3 text-center"
                  style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border)' }}
                >
                  <p className="text-[10.5px] italic" style={{ color: 'rgba(235,235,245,0.38)' }}>
                    {copy.noPresetsYet ?? '저장된 프리셋이 없습니다'}
                  </p>
                </div>
              )}
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-[10px] px-3 py-2 group transition-colors"
                  style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}
                >
                  <button
                    className="flex-1 text-left text-[11.5px] font-medium truncate"
                    style={{ color: 'rgba(235,235,245,0.72)' }}
                    onClick={() => onApplyPreset(p.id)}
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => onDeletePreset(p.id)}
                    className="opacity-40 group-hover:opacity-100 p-1 rounded transition-all hover:bg-red-500/10"
                    style={{ color: 'rgba(235,235,245,0.55)' }}
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
            {/* Save new preset */}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={copy.presetNamePlaceholder}
                aria-label="Preset name"
                className="flex-1 input-glass text-[11px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && presetName.trim()) {
                    onSavePreset(presetName.trim());
                    setPresetName('');
                  }
                }}
              />
              <button
                onClick={() => {
                  if (presetName.trim()) {
                    onSavePreset(presetName.trim());
                    setPresetName('');
                  }
                }}
                disabled={!presetName.trim()}
                className="p-2 rounded-[10px] disabled:opacity-30 transition-all"
                style={{ background: 'var(--color-accent-dim)', border: '0.5px solid rgba(79,110,247,0.30)', color: 'var(--color-accent-light)' }}
                aria-label={copy.saveCurrentAsPreset}
              >
                <Plus size={13} />
              </button>
            </div>
            </>
            )}
          </div>
        )}

        {/* ── Display ───────────────────────────────────────────────────── */}
        <SectionHeader
          icon={Map}
          title={copy.display}
          open={openSections.display}
          onToggle={() => toggle('display')}
        />
        {openSections.display && (
          <div className="px-4 pb-3 space-y-1.5">
            <ToggleRow
              label={copy.colorLegend}
              value={showLegend}
              onToggle={onToggleLegend}
              icon={<Eye size={11} />}
            />
            <ToggleRow
              label={copy.mapLabels}
              value={showLabels}
              onToggle={onToggleLabels}
              icon={<Tag size={11} />}
            />
          </div>
        )}

        {/* ── Saved Locations (Bookmarks) ───────────────────────────────── */}
        <SectionHeader
          icon={BookmarkCheck}
          title={copy.savedLocations}
          open={openSections.bookmarks}
          onToggle={() => toggle('bookmarks')}
          count={bookmarks.length}
        />
        {openSections.bookmarks && (
          <div className="px-4 pb-3">
            {bookmarks.length === 0 ? (
              <p className="text-[10.5px] italic p-3 rounded-[10px]" style={{ color: 'rgba(235,235,245,0.55)', background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border)' }}>
                {copy.emptyBookmarksHint}
              </p>
            ) : (
              <div className="space-y-1.5">
                {bookmarks.map((b) => (
                  <div
                    key={b.h3_index}
                    className="rounded-[11px] p-2.5 group"
                    style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => onBookmarkClick(b)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-[11.5px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.82)' }}>{b.name}</div>
                        <div className="text-[9.5px] truncate" style={{ color: 'rgba(235,235,245,0.40)' }}>{b.country}</div>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            setEditingNoteH3(editingNoteH3 === b.h3_index ? null : b.h3_index);
                            setEditingNoteValue(b.note || '');
                          }}
                          className="p-1 rounded transition-all"
                          style={{ color: 'rgba(235,235,245,0.50)' }}
                          title={copy.editNoteTitle}
                        >
                          <Tag size={9} />
                        </button>
                        <button
                          onClick={() => onRemoveBookmark(b.h3_index)}
                          className="p-1 rounded transition-all opacity-0 group-hover:opacity-100"
                          style={{ color: 'rgba(235,235,245,0.50)' }}
                          aria-label={copy.removeBookmarkAria(b.name)}
                        >
                          <Trash2 size={9} />
                        </button>
                      </div>
                    </div>
                    {editingNoteH3 === b.h3_index && (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          type="text"
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          placeholder={copy.addNotePlaceholder}
                          className="flex-1 input-glass text-[10px]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onUpdateBookmarkNote?.(b.h3_index, editingNoteValue);
                              setEditingNoteH3(null);
                            } else if (e.key === 'Escape') {
                              setEditingNoteH3(null);
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            onUpdateBookmarkNote?.(b.h3_index, editingNoteValue);
                            setEditingNoteH3(null);
                          }}
                          className="px-2.5 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all"
                          style={{ background: 'var(--color-accent-dim)', color: 'var(--color-accent-light)', border: '0.5px solid rgba(79,110,247,0.30)' }}
                        >
                          OK
                        </button>
                      </div>
                    )}
                    {b.note && editingNoteH3 !== b.h3_index && (
                      <p className="mt-1.5 text-[9.5px] italic leading-relaxed" style={{ color: 'rgba(235,235,245,0.40)' }}>
                        "{b.note}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {bookmarks.length > 0 && (
              canExport ? (
              <button
                onClick={handleExportBookmarks}
                className="mt-2 flex items-center gap-1.5 text-[11px] transition-colors px-3 py-1.5 rounded-[9px] w-full justify-center"
                style={{ color: exportFeedback ? 'rgba(52,211,153,0.75)' : 'rgba(235,235,245,0.38)', border: '0.5px solid var(--color-border-2)' }}
              >
                <Download size={10} />
                {exportFeedback ?? copy.exportCsvBtn}
              </button>
              ) : (
              <button
                onClick={onOpenLicenseModal}
                className="mt-2 flex items-center gap-1.5 text-[11px] transition-colors px-3 py-1.5 rounded-[9px] w-full justify-center"
                style={{ color: 'rgba(235,235,245,0.55)', border: '0.5px solid var(--color-border-2)' }}
                title={copy.exportGateTip}
              >
                <Lock size={10} />
                {copy.exportCsvBtn}
              </button>
              )
            )}
          </div>
        )}

        {/* ── Statistics ────────────────────────────────────────────────── */}
        <SectionHeader
          icon={BarChart2}
          title={copy.statistics}
          open={openSections.stats}
          onToggle={() => toggle('stats')}
        />
        {openSections.stats && (
          <div className="px-4 pb-3">
            <div className="rounded-[12px] p-3 space-y-2" style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}>
              <StatRow label={copy.hexagonsVisible} value={hexCount} />
              <StatRow label={copy.totalInView} value={totalInView} />
              {engineMeta && (
                <>
                  <StatRow label={copy.engineModeLabel} value={engineMeta.mode} />
                  <StatRow label={copy.totalHexagons} value={engineMeta.cityCount?.toLocaleString()} />
                  {engineMeta.sigma > 0 && (
                    <StatRow label={copy.sigmaLabel} value={engineMeta.sigma.toFixed(4)} />
                  )}
                </>
              )}
              {/* Weight distribution bar */}
              <div className="pt-1">
                <div className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: 'rgba(235,235,245,0.38)' }}>
                  {copy.weightDistribution}
                </div>
                <div className="flex h-[5px] rounded-full overflow-hidden gap-[1px]">
                  {VIBE_DIMENSIONS.map(({ key, color }) => {
                    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
                    const pct = (weights[key] / total) * 100;
                    return (
                      <div
                        key={key}
                        className="rounded-full transition-all duration-300"
                        style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.72 }}
                        title={`${key}: ${weights[key]}`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Location Compare ──────────────────────────────────────────── */}
        <SectionHeader
          icon={TrendingUp}
          title={copy.locationCompare}
          open={openSections.locationCompare}
          onToggle={() => toggle('locationCompare')}
        />
        {openSections.locationCompare && !canMatch && (
          <div className="px-4 pb-3">
            <div className="rounded-[14px] border-[0.5px] border-indigo-400/[0.18] bg-[rgba(9,9,12,0.88)] backdrop-blur-xl p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 shrink-0 rounded-[10px] bg-gradient-to-br from-indigo-500/18 to-purple-500/18 border-[0.5px] border-indigo-400/20 flex items-center justify-center">
                <Lock size={14} className="text-indigo-300/65" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-widest text-indigo-300/55 mb-0.5">{copy.premiumFeature}</span>
                <span className="block text-[11px] font-semibold text-[#f5f5f7]/75 leading-tight mb-0.5">{copy.premiumOnly}</span>
                <span className="block text-[9px] text-white/35 leading-relaxed">{copy.personalMatchHint}</span>
              </div>
              <button
                onClick={() => onOpenLicenseModal?.()}
                className="shrink-0 px-3 py-1.5 rounded-[10px] text-[10px] font-semibold text-white transition-all duration-200 border-[0.5px] border-indigo-400/25"
                style={{
                  background: 'linear-gradient(160deg, #5b6cf5 0%, #6366f1 60%, #5254cc 100%)',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.14) inset, 0 0 0 0.5px rgba(99,102,241,0.5), 0 3px 10px rgba(99,102,241,0.3)',
                }}
              >
                {copy.upgradeNow}
              </button>
            </div>
          </div>
        )}
        {openSections.locationCompare && canMatch && (
          <div className="px-4 pb-3">
            <div className="rounded-[12px] p-3 space-y-2.5" style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}>
              <div className="grid grid-cols-1 gap-2">
                <select
                  value={countryFilter}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  aria-label={copy.filterCountry}
                  className="input-glass"
                >
                  <option value="">{copy.allCountries}</option>
                  {countryOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={cityFilter}
                  onChange={(e) => handleCityChange(e.target.value)}
                  aria-label={copy.filterCity}
                  disabled={cityOptions.length === 0}
                  className="input-glass"
                >
                  <option value="">{copy.allCities}</option>
                  {cityOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={neighborhoodFilter}
                  onChange={(e) => setNeighborhoodFilter(e.target.value)}
                  aria-label={copy.filterNeighborhood}
                  disabled={neighborhoodOptions.length === 0}
                  className="input-glass"
                >
                  <option value="">{copy.allNeighborhoods}</option>
                  {neighborhoodOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>

              <div className="text-[10px] text-white/45 font-semibold">{copy.filteredHexes(filteredHexes.length)}</div>

              {baseHex ? (
                <div className="rounded-xl border border-[#B2F2BB]/20 bg-[#B2F2BB]/10 p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-[#B2F2BB] font-bold">{copy.baseHex}</div>
                  <div className="mt-1 text-[11px] text-white/90 font-semibold truncate">{hexLabel(baseHex)}</div>
                  <div className="text-[9px] text-white/60 truncate">{hexSubLabel(baseHex)}</div>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-[10px] text-white/55">
                  {copy.noFilteredHexes}
                </div>
              )}

              <div>
                <div className="text-[9px] uppercase tracking-wider text-white/60 font-bold mb-1.5">
                  {copy.top3SimilarHexes}
                </div>

                {top3Matches.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-[10px] text-white/55">
                    {copy.noTop3Match}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {top3Matches.map((item, idx) => {
                      const score = Math.round(item.similarity * 100);
                      return (
                        <div
                          key={item.hex.h3_index || item.hex.id || `${idx}`}
                          className="rounded-xl border border-white/10 bg-[rgba(18,18,22,0.65)] p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[11px] text-white/85 font-semibold truncate">{hexLabel(item.hex)}</div>
                              <div className="text-[9px] text-white/60 truncate">{hexSubLabel(item.hex)}</div>
                            </div>
                            <div className="text-[10px] font-bold text-[#B2E2F2]">{score}%</div>
                          </div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <button
                              onClick={() => onSelectHex?.(item.hex)}
                              className="px-2 py-1 rounded-md text-[9px] font-semibold bg-white/[0.08] text-white/70 hover:bg-white/[0.14] hover:text-white transition-colors"
                            >
                              {copy.selectAsBase}
                            </button>
                            {baseHex && (
                              <button
                                onClick={() => onCompareHexes?.(baseHex, item.hex)}
                                className="px-2 py-1 rounded-md text-[9px] font-semibold bg-gradient-to-r from-[#B2F2BB]/70 to-[#B2E2F2]/70 text-[#121216] hover:from-[#B2F2BB] hover:to-[#B2E2F2] transition-colors"
                              >
                                {copy.compareWithThis}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <SectionHeader
          icon={FileUp}
          title={copy.b2bPoiInput}
          open={openSections.b2bPoi}
          onToggle={() => toggle('b2bPoi')}
          locked={!canOverlayPoi}
        />
        {openSections.b2bPoi && !canOverlayPoi && (
          <div className="px-4 pb-3">
            <div className="rounded-[14px] border-[0.5px] border-indigo-400/[0.18] bg-[rgba(9,9,12,0.88)] backdrop-blur-xl p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 shrink-0 rounded-[10px] bg-gradient-to-br from-indigo-500/18 to-purple-500/18 border-[0.5px] border-indigo-400/20 flex items-center justify-center">
                <Lock size={14} className="text-indigo-300/65" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-widest text-indigo-300/55 mb-0.5">{copy.premiumFeature}</span>
                <span className="block text-[11px] font-semibold text-[#f5f5f7]/75 leading-tight mb-0.5">{copy.premiumOnly}</span>
                <span className="block text-[9px] text-white/35 leading-relaxed">{copy.premiumPoiHint}</span>
              </div>
              <button
                onClick={() => onOpenLicenseModal?.()}
                className="shrink-0 px-3 py-1.5 rounded-[10px] text-[10px] font-semibold text-white transition-all duration-200 border-[0.5px] border-indigo-400/25"
                style={{
                  background: 'linear-gradient(160deg, #5b6cf5 0%, #6366f1 60%, #5254cc 100%)',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.14) inset, 0 0 0 0.5px rgba(99,102,241,0.5), 0 3px 10px rgba(99,102,241,0.3)',
                }}
              >
                {copy.upgradeNow}
              </button>
            </div>
          </div>
        )}
        {openSections.b2bPoi && canOverlayPoi && (
          <div className="px-4 pb-3">
            <div className="rounded-2xl border border-white/10 bg-[rgba(18,18,22,0.55)] backdrop-blur-xl p-3 space-y-3">

              {/* ── Address search → H3 auto-fill ── */}
              <div className="space-y-1.5">
                <div className="text-[9px] uppercase tracking-wider text-white/50 font-semibold">{copy.addressSearchHint}</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={addressQuery}
                    onChange={(e) => { setAddressQuery(e.target.value); setAddressStatus('idle'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddressSearch(); }}
                    placeholder={copy.addressSearchPlaceholder}
                    aria-label={copy.addressSearchPlaceholder}
                    className="flex-1 input-glass text-[11px]"
                  />
                  <button
                    onClick={handleAddressSearch}
                    disabled={!addressQuery.trim() || addressStatus === 'searching'}
                    className="btn-glass text-[9px] whitespace-nowrap disabled:opacity-40"
                  >
                    {addressStatus === 'searching' ? copy.addressSearching : copy.addressSearchBtn}
                  </button>
                </div>
                {addressStatus === 'found' && (
                  <div className="text-[9px] text-emerald-400/80 truncate">{copy.addressFound(addressFoundName)}</div>
                )}
                {addressStatus === 'notfound' && (
                  <div className="text-[9px] text-red-400/80">{copy.addressNotFound}</div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={poiH3}
                    onChange={(e) => setPoiH3(e.target.value)}
                    placeholder={copy.h3Index}
                    aria-label="H3 cell index"
                    disabled={!canOverlayPoi}
                    className="flex-1 input-glass disabled:opacity-40"
                  />
                  <button
                    onClick={() => {
                      const h3 = selectedHex?.h3_index || selectedHex?.id || selectedHex?.city_id || '';
                      if (h3) setPoiH3(h3);
                    }}
                    className="btn-glass text-[9px]"
                  >
                    {copy.selectedHexAutoFill}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(['active', 'classic', 'quiet', 'trendy', 'nature', 'urban'] as const).map((key) => (
                    <input
                      key={key}
                      type="number"
                      min={0}
                      step={1}
                      value={poiCounts[key]}
                      onChange={(e) => setPoiCounts((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={key}
                      aria-label={key}
                      className="input-glass"
                    />
                  ))}
                </div>
                <div className="text-[10px] text-white/65">total: {totalPoi}</div>
                <button
                  onClick={handleApplySinglePoi}
                  disabled={overlayBusy || !canOverlayPoi}
                  className="w-full px-2 py-1.5 rounded-lg text-[10px] font-semibold bg-gradient-to-r from-[#B2F2BB]/70 to-[#B2E2F2]/70 text-[#0e0e12] hover:from-[#B2F2BB] hover:to-[#B2E2F2] disabled:opacity-40 transition-all"
                >
                  {copy.applySingle}
                </button>
              </div>

              <div className="pt-2 border-t border-white/[0.07]">
                <div className="text-[10px] uppercase tracking-wider text-white/60 font-bold mb-1.5">{copy.poiBulkInput}</div>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={5}
                  placeholder={copy.bulkFormatHint}
                  aria-label="Bulk POI data (JSON)"
                  className="input-glass resize-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="btn-glass text-[9px] cursor-pointer">
                    {copy.importFile}
                    <input
                      type="file"
                      accept=".json,.csv,.txt"
                      className="hidden"
                      onChange={(e) => handleBulkFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <button
                    onClick={handleApplyBulkPoi}
                    disabled={overlayBusy || !canOverlayPoi}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-semibold bg-gradient-to-r from-[#B2F2BB]/70 to-[#B2E2F2]/70 text-[#0e0e12] hover:from-[#B2F2BB] hover:to-[#B2E2F2] disabled:opacity-40 transition-all"
                  >
                    {overlayBusy ? (
                      <>
                        <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                        </svg>
                        {copy.applyBulk}…
                      </>
                    ) : copy.applyBulk}
                  </button>
                </div>
                {overlayStatus && (
                  <div className="mt-2 text-[10px] text-white/55">{overlayStatus}</div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

        {/* ═══ BATCH ANALYSIS SECTION ═══════════════════════════════ */}
        <SectionHeader
          icon={BarChart2}
          title={locale === 'ko' ? '배치 분석 (Business+)' : 'Batch Analysis (Business+)'}
          open={openSections.batchAnalysis}
          onToggle={() => toggle('batchAnalysis')}
          locked={!canBatchAnalysis}
        />
        {openSections.batchAnalysis && !canBatchAnalysis && (
          <div className="px-4 pb-3">
            <div className="rounded-[14px] border-[0.5px] border-amber-400/[0.18] bg-[rgba(9,9,12,0.88)] backdrop-blur-xl p-3.5 flex items-center gap-3">
              <div className="w-8 h-8 shrink-0 rounded-[10px] bg-gradient-to-br from-amber-500/18 to-orange-500/18 border-[0.5px] border-amber-400/20 flex items-center justify-center">
                <Lock size={14} className="text-amber-300/65" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-widest text-amber-300/55 mb-0.5">Business Plan</span>
                <span className="block text-[11px] font-semibold text-[#f5f5f7]/75 leading-tight mb-0.5">
                  {locale === 'ko' ? '여러 지역 일괄 분석' : 'Analyze multiple locations at once'}
                </span>
                <span className="block text-[9px] text-white/35 leading-relaxed">
                  {locale === 'ko'
                    ? '최대 20개 지역명을 입력해 점수 비교표와 CSV 내보내기'
                    : 'Enter up to 20 location names, get a ranked comparison table + CSV export'}
                </span>
              </div>
              <button
                onClick={() => onOpenLicenseModal?.()}
                className="shrink-0 px-3 py-1.5 rounded-[10px] text-[10px] font-semibold text-white transition-all duration-200 border-[0.5px] border-amber-400/25"
                style={{
                  background: 'linear-gradient(160deg, #d97706 0%, #f59e0b 60%, #d97706 100%)',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.14) inset, 0 3px 10px rgba(245,158,11,0.3)',
                }}
              >
                {copy.upgradeNow}
              </button>
            </div>
          </div>
        )}
        {openSections.batchAnalysis && canBatchAnalysis && (
          <div className="px-4 pb-3">
            <div className="rounded-2xl border border-white/10 bg-[rgba(18,18,22,0.55)] backdrop-blur-xl p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-white/60 font-bold">
                {locale === 'ko' ? '분석할 지역 목록 (줄바꿈으로 구분, 최대 20개)' : 'Locations to analyze (one per line, max 20)'}
              </div>
              <textarea
                value={batchInput}
                onChange={e => setBatchInput(e.target.value)}
                rows={6}
                placeholder={locale === 'ko'
                  ? '성수동\n합정동\n강남역\n홍대\n이태원'
                  : 'Seongsu-dong\nHapjeong\nGangnam\nHongdae\nItaewon'}
                className="w-full rounded-lg px-2.5 py-2 text-[11px] bg-white/[0.06] border border-white/10 text-white/80 placeholder-white/25 focus:outline-none focus:border-white/20 resize-none font-mono leading-relaxed"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRunBatch}
                  disabled={batchBusy || batchInput.trim() === ''}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-semibold text-white disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                >
                  {batchBusy ? (
                    <><svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>{locale === 'ko' ? '분석 중…' : 'Analyzing…'}</>
                  ) : (locale === 'ko' ? '▶ 일괄 분석' : '▶ Run Batch')}
                </button>
                {batchResults.length > 0 && (
                  <button
                    onClick={handleExportBatch}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-white/[0.08] hover:bg-white/[0.13] text-white/70 transition-all"
                    title="Export CSV"
                  >
                    <Download size={10} /> CSV
                  </button>
                )}
              </div>
              {batchError && <div className="text-[10px] text-red-400/80">{batchError}</div>}
              {batchResults.length > 0 && (
                <div className="mt-1 space-y-1">
                  <div className="text-[9px] uppercase tracking-wider text-white/40 font-semibold px-1 flex justify-between">
                    <span>{locale === 'ko' ? '순위 · 지역명' : 'Rank · Location'}</span>
                    <span>{locale === 'ko' ? '점수 · 등급' : 'Score · Grade'}</span>
                  </div>
                  {batchResults.map((r, i) => (
                    <div
                      key={r.h3 || i}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-[8px] bg-white/[0.04] border border-white/[0.06]"
                    >
                      <span className="text-[10px] font-bold w-5 text-center tabular-nums" style={{ color: i === 0 ? '#FFD60A' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'rgba(235,235,245,0.35)' }}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium truncate" style={{ color: 'rgba(235,235,245,0.85)' }}>{r.name}</div>
                        {r.country && <div className="text-[9px]" style={{ color: 'rgba(235,235,245,0.35)' }}>{r.country}</div>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[11px] font-bold tabular-nums" style={{ color: r.score >= 72 ? '#30D158' : r.score >= 55 ? '#FFD60A' : r.score >= 40 ? '#FF9F0A' : '#FF5F5F' }}>
                          {r.score}
                        </div>
                        <div className="text-[9px]" style={{ color: 'rgba(235,235,245,0.40)' }}>{r.grade}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!batchBusy && batchResults.length === 0 && batchInput.trim() !== '' && (
                <div className="text-[10px] text-white/35 text-center py-1">
                  {locale === 'ko' ? '▶ 일괄 분석 버튼을 눌러 시작하세요' : 'Press ▶ Run Batch to start'}
                </div>
              )}
            </div>
          </div>
        )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/[0.05] flex items-center justify-between">
        <span className="text-[9px] text-white/35 uppercase tracking-wider font-semibold">
          eodi.me
        </span>
        <span className="text-[9px] text-white/22 font-mono">
          {copy.userDataOnlyReadonlyDb}
        </span>
      </div>
    </div>
  );
});

// ── Helper sub-components ────────────────────────────────────────────────────

const ToggleRow = ({
  label,
  value,
  onToggle,
  icon,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
}) => (
  <button
    onClick={onToggle}
    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] transition-colors"
  >
    <span style={{ color: value ? 'var(--color-accent)' : 'rgba(235,235,245,0.55)', transition: 'color 0.15s' }}>
      {icon}
    </span>
    <span className="flex-1 text-left text-[12.5px] font-normal tracking-[-0.006em]" style={{ color: 'rgba(235,235,245,0.65)' }}>
      {label}
    </span>
    {/* Apple-style toggle */}
    <div
      className="w-[32px] h-[18px] rounded-full transition-all duration-200 relative flex-shrink-0"
      style={value
        ? { background: 'var(--color-accent)', border: '0.5px solid rgba(79,110,247,0.50)' }
        : { background: 'rgba(255,255,255,0.08)', border: '0.5px solid var(--color-border-2)' }
      }
    >
      <div
        className="absolute top-[2px] w-[11px] h-[11px] rounded-full bg-white transition-all duration-200 shadow-sm"
        style={{ left: value ? '16px' : '3px', opacity: value ? 0.95 : 0.55 }}
      />
    </div>
  </button>
);

const StatRow = ({ label, value }: { label: string; value?: string | number }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.40)' }}>{label}</span>
    <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: 'rgba(235,235,245,0.72)' }}>{value ?? '—'}</span>
  </div>
);
