/**
 * CompareOverlay — full-featured hex comparison panel.
 *
 * Shows two hex cards side-by-side with radar charts, vibe bars,
 * and a delta summary. Includes filtering to pick a comparison target.
 *
 * Appears as a centered floating panel over the map.
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, MapPin, ArrowRight, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';
import { VIBE_COLORS, VIBE_ICONS, getVibeLabel, scoreColor } from '../../utils/vibeConstants';
import type { HexResult } from '../../hooks/useEngine';

// ── Helpers ─────────────────────────────────────────────────────────────────

function radarData(radar: Record<string, number> | undefined, locale?: string) {
  if (!radar) return [];
  return Object.entries(radar).map(([k, v]) => ({
    axis: getVibeLabel(k, locale),
    key: k,
    value: Math.round(Math.abs(v) * 100),
    fill: VIBE_COLORS[k] || '#888',
    icon: VIBE_ICONS[k] || '',
  }));
}

function radarSimilarity(a?: Record<string, number>, b?: Record<string, number>): number {
  if (!a || !b) return 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, normA = 0, normB = 0;
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

function formatPop(pop: number | null | undefined): string {
  if (!pop) return '';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(0)}K`;
  return pop.toLocaleString();
}

const RADAR_COLORS = {
  base: '#3B82F6',
  target: '#F97316',
};

// ── Types ───────────────────────────────────────────────────────────────────

interface CompareOverlayProps {
  baseHex: HexResult;
  targetHex: HexResult | null;
  allHexes: HexResult[];
  onSelectTarget: (hex: HexResult) => void;
  onSwap: () => void;
  onClose: () => void;
  locale?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export const CompareOverlay = React.memo(function CompareOverlay({
  baseHex, targetHex, allHexes, onSelectTarget, onSwap, onClose, locale = 'en',
}: CompareOverlayProps) {
  const copy = getUiCopy(locale);
  const [filterOpen, setFilterOpen] = useState(!targetHex);
  const [filterQuery, setFilterQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterVibe, setFilterVibe] = useState('');

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Radar data
  const baseRadar = useMemo(() => radarData(baseHex.radar, locale), [baseHex.radar, locale]);
  const targetRadar = useMemo(() => targetHex ? radarData(targetHex.radar, locale) : [], [targetHex?.radar, locale]);

  // Merged radar for overlay chart
  const mergedRadar = useMemo(() => {
    if (!baseRadar.length) return [];
    return baseRadar.map((d, i) => ({
      ...d,
      baseValue: d.value,
      targetValue: targetRadar[i]?.value ?? 0,
    }));
  }, [baseRadar, targetRadar]);

  // Top vibes
  const baseTopVibe = useMemo(() => [...baseRadar].sort((a, b) => b.value - a.value)[0], [baseRadar]);
  const targetTopVibe = useMemo(() => targetRadar.length > 0 ? [...targetRadar].sort((a, b) => b.value - a.value)[0] : null, [targetRadar]);

  // Country options from allHexes
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const h of allHexes) {
      const c = (h.country || '').trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [allHexes]);

  // Vibe options
  const vibeKeys = ['active', 'classic', 'quiet', 'trendy', 'nature', 'urban'];

  // Filter + sort candidates
  const filteredCandidates = useMemo(() => {
    const baseId = baseHex.h3_index || baseHex.id || baseHex.city_id;
    return allHexes
      .filter((h) => {
        const hId = h.h3_index || h.id || h.city_id;
        if (hId === baseId) return false;
        if (filterCountry && (h.country || '') !== filterCountry) return false;
        if (filterQuery) {
          const q = filterQuery.toLowerCase();
          const name = (h.name || '').toLowerCase();
          const city = (h.parent_city_name || h.city || '').toLowerCase();
          if (!name.includes(q) && !city.includes(q)) return false;
        }
        if (filterVibe && h.radar) {
          const entries = Object.entries(h.radar);
          if (entries.length > 0) {
            const sorted = entries.sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])));
            if (sorted[0][0] !== filterVibe) return false;
          }
        }
        return true;
      })
      .map((h) => ({
        hex: h,
        similarity: radarSimilarity(baseHex.radar, h.radar),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
  }, [allHexes, baseHex, filterCountry, filterQuery, filterVibe]);

  const similarity = targetHex ? Math.round(radarSimilarity(baseHex.radar, targetHex.radar) * 100) : 0;

  const baseScore = Math.round((baseHex.score ?? baseHex.similarity ?? 0) * 100);
  const targetScore = targetHex ? Math.round((targetHex.score ?? targetHex.similarity ?? 0) * 100) : 0;

  const handleSelectCandidate = useCallback((hex: HexResult) => {
    onSelectTarget(hex);
    setFilterOpen(false);
  }, [onSelectTarget]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-[700] flex items-center justify-center pointer-events-none"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 pointer-events-auto"
        onClick={onClose}
        style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      />

      {/* Panel */}
      <div
        className="relative pointer-events-auto w-[720px] max-w-[92vw] max-h-[88vh] rounded-[18px] border-[0.5px] overflow-hidden flex flex-col"
        style={{
          background: 'rgba(12,14,22,0.97)',
          borderColor: 'rgba(255,255,255,0.14)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.05) inset',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} style={{ color: 'rgba(235,235,245,0.55)' }} />
            <span className="text-[14px] font-semibold" style={{ color: 'rgba(235,235,245,0.90)' }}>
              {copy.compareVibes}
            </span>
            {targetHex && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: 'rgba(79,110,247,0.15)', color: 'rgba(79,110,247,0.90)' }}>
                {similarity}% {copy.vibeMatch}
              </span>
            )}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: 'rgba(235,235,245,0.50)' }}>
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* ── Hex Cards ── */}
          <div className="grid grid-cols-2 gap-3 p-4">
            {/* Base Card */}
            <HexCard
              hex={baseHex}
              label={copy.compareThisLocation}
              color={RADAR_COLORS.base}
              score={baseScore}
              topVibe={baseTopVibe}
              locale={locale}
            />

            {/* Target Card */}
            {targetHex ? (
              <HexCard
                hex={targetHex}
                label={copy.compareOtherLocation}
                color={RADAR_COLORS.target}
                score={targetScore}
                topVibe={targetTopVibe}
                locale={locale}
              />
            ) : (
              <div
                className="rounded-[14px] border-[0.5px] border-dashed p-4 flex flex-col items-center justify-center gap-2 min-h-[120px] cursor-pointer transition-colors hover:border-blue-400/40"
                style={{ borderColor: 'rgba(255,255,255,0.20)', background: 'rgba(255,255,255,0.03)' }}
                onClick={() => setFilterOpen(true)}
              >
                <MapPin size={20} style={{ color: 'rgba(235,235,245,0.55)' }} />
                <span className="text-[11px] font-medium text-center" style={{ color: 'rgba(235,235,245,0.50)' }}>
                  {copy.selectLocationToCompare}
                </span>
              </div>
            )}
          </div>

          {/* Swap button */}
          {targetHex && (
            <div className="flex justify-center -mt-1 mb-2">
              <button
                onClick={onSwap}
                className="px-3 py-1.5 rounded-full text-[10px] font-semibold flex items-center gap-1.5 transition-colors hover:bg-white/10"
                style={{ color: 'rgba(235,235,245,0.60)', border: '0.5px solid rgba(255,255,255,0.15)' }}
              >
                <ArrowRight size={10} className="rotate-90" /> {copy.swapComparison}
              </button>
            </div>
          )}

          {/* ── Side-by-side Radar Charts ── */}
          {targetHex && baseRadar.length > 0 && (
            <div className="px-4 pb-4">
              <div className="rounded-[14px] p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.10)' }}>
                {/* Overlay radar */}
                <div className="w-full h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={mergedRadar} cx="50%" cy="50%" outerRadius="68%">
                      <PolarGrid stroke="rgba(255,255,255,0.13)" />
                      <PolarAngleAxis dataKey="axis" tick={{ fill: 'rgba(235,235,245,0.70)', fontSize: 11, fontWeight: 500 }} axisLine={false} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar name="Base" dataKey="baseValue" stroke={RADAR_COLORS.base} fill={RADAR_COLORS.base} fillOpacity={0.22} strokeWidth={2} dot={{ fill: RADAR_COLORS.base, r: 3 }} />
                      <Radar name="Target" dataKey="targetValue" stroke={RADAR_COLORS.target} fill={RADAR_COLORS.target} fillOpacity={0.18} strokeWidth={2} strokeDasharray="5 3" dot={{ fill: RADAR_COLORS.target, r: 3 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-5 mt-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-[3px] rounded-full" style={{ background: RADAR_COLORS.base }} />
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.70)' }}>
                      {baseHex.name || baseHex.city || 'Base'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-[3px] rounded-full" style={{ background: RADAR_COLORS.target }} />
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.70)' }}>
                      {targetHex.name || targetHex.city || 'Target'}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Dimension Comparison Bars ── */}
              <div className="mt-3 rounded-[14px] overflow-hidden" style={{ border: '0.5px solid rgba(255,255,255,0.10)' }}>
                {mergedRadar.map((d, i) => {
                  const delta = d.baseValue - d.targetValue;
                  const absDelta = Math.abs(delta);
                  return (
                    <div key={d.key} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                      <span className="text-[10px] w-[60px] shrink-0 truncate" style={{ color: d.fill }}>
                        {d.icon} {d.axis}
                      </span>
                      {/* Base value */}
                      <div className="flex-1 flex items-center gap-1">
                        <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full" style={{ width: `${d.baseValue}%`, background: RADAR_COLORS.base, opacity: 0.65 }} />
                        </div>
                        <span className="text-[10px] font-bold tabular-nums w-[28px] text-right" style={{ color: delta > 0 ? RADAR_COLORS.base : 'rgba(235,235,245,0.50)' }}>
                          {d.baseValue}
                        </span>
                      </div>
                      {/* Delta indicator */}
                      <div className="w-[36px] flex items-center justify-center shrink-0">
                        {absDelta > 0 && (
                          <span className="text-[9px] font-bold tabular-nums" style={{ color: delta > 0 ? '#34D399' : '#FB923C' }}>
                            {delta > 0 ? '+' : ''}{delta}
                          </span>
                        )}
                        {absDelta === 0 && <span className="text-[9px]" style={{ color: 'rgba(235,235,245,0.55)' }}>=</span>}
                      </div>
                      {/* Target value */}
                      <div className="flex-1 flex items-center gap-1">
                        <span className="text-[10px] font-bold tabular-nums w-[28px]" style={{ color: delta < 0 ? RADAR_COLORS.target : 'rgba(235,235,245,0.50)' }}>
                          {d.targetValue}
                        </span>
                        <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full" style={{ width: `${d.targetValue}%`, background: RADAR_COLORS.target, opacity: 0.65 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Filter Panel ── */}
          <div className="px-4 pb-4">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-[10px] transition-colors hover:bg-white/[0.04]"
              style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
            >
              <span className="text-[11px] font-semibold" style={{ color: 'rgba(235,235,245,0.70)' }}>
                {copy.findCompareTarget || 'Find comparison target'}
              </span>
              {filterOpen ? <ChevronUp size={14} style={{ color: 'rgba(235,235,245,0.40)' }} /> : <ChevronDown size={14} style={{ color: 'rgba(235,235,245,0.40)' }} />}
            </button>

            <AnimatePresence>
              {filterOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 space-y-2">
                    {/* Search input */}
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(235,235,245,0.55)' }} />
                      <input
                        type="text"
                        value={filterQuery}
                        onChange={(e) => setFilterQuery(e.target.value)}
                        placeholder={copy.searchPlaceholder || 'Search city or neighborhood...'}
                        className="w-full pl-8 pr-3 py-2 rounded-[10px] text-[11px] outline-none transition-all"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '0.5px solid rgba(255,255,255,0.12)',
                          color: 'rgba(235,235,245,0.85)',
                        }}
                      />
                    </div>

                    {/* Filter row */}
                    <div className="flex gap-2">
                      <select
                        value={filterCountry}
                        onChange={(e) => setFilterCountry(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-[8px] text-[10px] outline-none"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '0.5px solid rgba(255,255,255,0.12)',
                          color: 'rgba(235,235,245,0.75)',
                        }}
                      >
                        <option value="">{copy.allCountries}</option>
                        {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>

                      <select
                        value={filterVibe}
                        onChange={(e) => setFilterVibe(e.target.value)}
                        className="flex-1 px-2 py-1.5 rounded-[8px] text-[10px] outline-none"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '0.5px solid rgba(255,255,255,0.12)',
                          color: 'rgba(235,235,245,0.75)',
                        }}
                      >
                        <option value="">{copy.dominantVibe}</option>
                        {vibeKeys.map((k) => <option key={k} value={k}>{VIBE_ICONS[k]} {getVibeLabel(k, locale)}</option>)}
                      </select>
                    </div>

                    {/* Results count */}
                    <div className="text-[10px] font-medium px-1" style={{ color: 'rgba(235,235,245,0.40)' }}>
                      {filteredCandidates.length} {copy.matchingAreas || 'matching areas'}
                    </div>

                    {/* Candidate list */}
                    <div className="space-y-1 max-h-[220px] overflow-y-auto custom-scrollbar">
                      {allHexes.length === 0 ? (
                        /* Loading skeleton while hex data not yet available */
                        [0, 1, 2, 3].map((i) => (
                          <div key={i} className="w-full px-3 py-2 rounded-[10px] flex items-center gap-2.5"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                            <div className="skeleton w-[6px] h-[6px] rounded-full shrink-0" />
                            <div className="flex-1 space-y-1">
                              <div className="skeleton h-[11px] w-3/4 rounded" />
                              <div className="skeleton h-[9px] w-1/2 rounded" />
                            </div>
                            <div className="skeleton h-[10px] w-8 rounded shrink-0" />
                          </div>
                        ))
                      ) : (
                        filteredCandidates.map(({ hex, similarity: sim }) => {
                          const isSelected = targetHex && (hex.h3_index || hex.id) === (targetHex.h3_index || targetHex.id);
                          const topV = hex.radar ? Object.entries(hex.radar).sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))[0] : null;
                          const topVibeKey = topV ? topV[0] : '';
                          return (
                            <button
                              key={hex.h3_index || hex.id || hex.city_id}
                              onClick={() => handleSelectCandidate(hex)}
                              className={`w-full text-left px-3 py-2 rounded-[10px] flex items-center gap-2.5 transition-all ${isSelected ? 'ring-1 ring-blue-400/40' : ''}`}
                              style={{
                                background: isSelected ? 'rgba(79,110,247,0.10)' : 'rgba(255,255,255,0.03)',
                                border: '0.5px solid rgba(255,255,255,0.08)',
                              }}
                            >
                              {/* Mini vibe dot */}
                              <div className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: VIBE_COLORS[topVibeKey] || '#888' }} />
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium truncate" style={{ color: 'rgba(235,235,245,0.85)' }}>
                                  {hex.name || hex.city || '—'}
                                </div>
                                <div className="text-[9px] truncate" style={{ color: 'rgba(235,235,245,0.45)' }}>
                                  {[hex.parent_city_name || hex.city, hex.country].filter(Boolean).join(' · ')}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[10px] font-bold tabular-nums" style={{ color: 'rgba(79,110,247,0.85)' }}>
                                  {Math.round(sim * 100)}%
                                </div>
                                <div className="text-[8px]" style={{ color: 'rgba(235,235,245,0.55)' }}>
                                  {copy.matchWord}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                      {allHexes.length > 0 && filteredCandidates.length === 0 && (
                        <div className="text-center py-4 text-[11px]" style={{ color: 'rgba(235,235,245,0.55)' }}>
                          {copy.noFilteredHexes || 'No matching hexagons found'}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

// ── HexCard ─────────────────────────────────────────────────────────────────

function HexCard({ hex, label, color, score, topVibe, locale }: {
  hex: HexResult;
  label: string;
  color: string;
  score: number;
  topVibe: { fill: string; icon: string; axis: string } | null | undefined;
  locale: string;
}) {
  const radar = radarData(hex.radar, locale);
  return (
    <div
      className="rounded-[14px] border-[0.5px] p-3.5 flex flex-col gap-2.5"
      style={{
        background: `linear-gradient(160deg, ${color}0a 0%, transparent 60%)`,
        borderColor: `${color}30`,
      }}
    >
      {/* Label + color indicator */}
      <div className="flex items-center gap-2">
        <div className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}50` }} />
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: `${color}90` }}>
          {label}
        </span>
      </div>

      {/* Name + location */}
      <div>
        <h3 className="text-[14px] font-semibold leading-tight truncate" style={{ color: 'rgba(235,235,245,0.92)' }}>
          {hex.name || hex.city || '—'}
        </h3>
        <p className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(235,235,245,0.50)' }}>
          {[hex.parent_city_name || hex.city, hex.country].filter(Boolean).join(' · ')}
          {hex.population ? ` · ${formatPop(hex.population)}` : ''}
        </p>
      </div>

      {/* Score + top vibe */}
      <div className="flex items-center gap-2">
        <span className="text-[18px] font-black tabular-nums" style={{ color: scoreColor(score) }}>
          {score}
        </span>
        <span className="text-[10px]" style={{ color: 'rgba(235,235,245,0.40)' }}>/100</span>
        {topVibe && (
          <span className="ml-auto px-2 py-[2px] rounded-full text-[9px] font-medium"
            style={{ background: `${topVibe.fill}15`, color: topVibe.fill, border: `0.5px solid ${topVibe.fill}25` }}>
            {topVibe.icon} {topVibe.axis}
          </span>
        )}
      </div>

      {/* Mini radar chart */}
      {radar.length > 0 && (
        <div className="w-full h-[100px] -mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radar} cx="50%" cy="50%" outerRadius="65%">
              <PolarGrid stroke="rgba(255,255,255,0.10)" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: 'rgba(235,235,245,0.50)', fontSize: 8 }} axisLine={false} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.22} strokeWidth={1.5} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
