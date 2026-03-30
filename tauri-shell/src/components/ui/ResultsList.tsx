import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Search, SearchX, MapPinned, ZoomIn, Hexagon } from 'lucide-react';
import { VIBE_COLORS, VIBE_ICONS, getVibeLabel, scoreColor } from '../../utils/vibeConstants';
import { computeLocalitySuffixes, placeLabel, resolveLocalityName } from '../../utils/locality';
import type { HexResult } from '../../hooks/useEngine';
import { getUiCopy } from '../../i18n/ui';

interface ResultsListProps {
  results: HexResult[];
  selectedCity: HexResult | null;
  onSelect: (city: HexResult) => void;
  open: boolean;
  onToggle: () => void;
  loading?: boolean;
  query?: string;
  hasSearched?: boolean;
  isSearchMode?: boolean;
  minQueryLen?: number;
  locale?: string;
  onOpenLicenseModal?: () => void;
}

export const ResultsList = React.memo(function ResultsList({
  results,
  selectedCity,
  onSelect,
  open,
  onToggle,
  loading = false,
  query = '',
  hasSearched = false,
  isSearchMode = false,
  minQueryLen = 2,
  locale = 'en',
  onOpenLicenseModal,
}: ResultsListProps) {
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [resultsEpoch, setResultsEpoch] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleCardHover = useCallback((idx: number) => setActiveIndex(idx), []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setResultsEpoch(e => e + 1);
  }, [results]);

  const trimmedQuery = query.trim();
  const isSearchIntent = trimmedQuery.length > 0;
  const isTooShort = isSearchIntent && trimmedQuery.length < minQueryLen;
  const showEmpty = isSearchIntent && !isTooShort && !loading && hasSearched && results.length === 0;
  const showList = results.length > 0;

  useEffect(() => {
    if (!showList) {
      setActiveIndex(-1);
      return;
    }
    const selectedIndex = selectedCity
      ? results.findIndex((city) => selectedCity.id === city.id || selectedCity.city_id === city.city_id)
      : -1;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [results, selectedCity, showList]);

  const handlePanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!showList || results.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
      } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        onSelect(results[activeIndex]);
      }
    },
    [activeIndex, onSelect, results, showList],
  );

  // Welcome guide when no search intent and no browse results (low zoom)
  if (!isSearchIntent && !showList) {
    return (
      <div className="flex flex-col h-full w-full px-4 pt-6">
        <div className="flex flex-col items-center text-center gap-3 py-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1"
            style={{ background: 'rgba(74,150,255,0.12)', border: '0.5px solid rgba(74,150,255,0.18)' }}
          >
            <MapPinned size={22} style={{ color: 'rgba(114,176,255,0.75)' }} />
          </div>
          <h3 className="text-[14px] font-semibold tracking-[-0.01em]" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {copy.browseGuideTitle}
          </h3>
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.50)' }}>
            {copy.browseGuideSubtitle}
          </p>
        </div>
        <div className="space-y-2.5 mt-2">
          {[
            { icon: <Search size={13} />, text: copy.browseGuideStep1 },
            { icon: <ZoomIn size={13} />, text: copy.browseGuideStep2 },
            { icon: <Hexagon size={13} />, text: copy.browseGuideStep3 },
          ].map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px]"
              style={{ background: 'rgba(18,18,20,0.75)', border: '0.5px solid rgba(255,255,255,0.08)' }}
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(74,150,255,0.10)', color: 'rgba(114,176,255,0.60)' }}
              >
                {step.icon}
              </div>
              <span className="text-[11.5px] font-medium" style={{ color: 'rgba(235,235,245,0.60)' }}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full" role="search" aria-label={copy.searchResults}>
      {/* ── Sidebar results header ──────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-4 flex-shrink-0"
        style={{ height: '32px', borderBottom: isSearchMode && results.length > 0 ? 'none' : '0.5px solid var(--color-border)' }}
      >
        <span className="text-[10.5px] font-semibold tracking-[0.06em] uppercase" style={{ color: 'rgba(235,235,245,0.48)' }}>
          {isSearchMode ? copy.searchResults : copy.browseResults}
        </span>
        {results.length > 0 && (
          <span
            className="text-[9px] font-bold tabular-nums px-1.5 py-[2px] rounded-full leading-none ml-auto"
            style={{ color: 'var(--color-accent)', background: 'var(--color-accent-dim)' }}
          >
            {results.length}
          </span>
        )}
      </div>
      {/* Search mode hint — explains vibe-based global matching */}
      {isSearchMode && results.length > 0 && (
        <div
          className="px-4 py-[5px] flex items-center gap-1.5 flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--color-border)' }}
        >
          <span className="text-[10px] leading-none">🌍</span>
          <span className="text-[10.5px] font-medium" style={{ color: 'rgba(235,235,245,0.62)', letterSpacing: '-0.01em' }}>{copy.vibeSearchHint}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollRef}
          id="results-panel"
          className="h-full overflow-y-auto custom-scrollbar scroll-shadow px-3 py-2 outline-none"
          role="listbox"
          aria-label={copy.searchResults}
          tabIndex={0}
          onKeyDown={handlePanelKeyDown}
          aria-activedescendant={activeIndex >= 0 ? `result-${activeIndex}` : undefined}
        >
          {/* Loading skeleton — only when no results loaded yet */}
          {loading && !showList && (
            <div className="space-y-2.5 pt-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="p-3.5 rounded-[11px]" style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}>
                  <div className="flex items-start gap-3">
                    <div className="skeleton w-10 h-10 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2 pt-0.5">
                      <div className="skeleton h-3.5 w-3/4 rounded" />
                      <div className="skeleton h-2.5 w-1/2 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isTooShort && (
            <div className="p-4 rounded-[11px] text-[11.5px] font-medium" style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)', color: 'rgba(235,235,245,0.50)' }}>
              {copy.typeMinChars(minQueryLen)}
            </div>
          )}

          {showEmpty && (
            <div className="p-5 rounded-[11px] flex flex-col items-center text-center gap-2" style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}>
              <SearchX size={22} className="mb-1" style={{ color: 'rgba(255,255,255,0.40)' }} aria-hidden="true" />
              <p className="text-[12px] font-semibold" style={{ color: 'rgba(235,235,245,0.60)' }}>{copy.noNeighborhoodFound(trimmedQuery)}</p>
              <p className="text-[10.5px]" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.tryDifferentSearch}</p>
              <p className="text-[10px] mt-1" style={{ color: 'rgba(235,235,245,0.50)' }}>{copy.emptyStateSearchHint}</p>
            </div>
          )}

          {showList && (() => {
            const suffixMap = computeLocalitySuffixes(results);
            return (
              <ul className="space-y-2.5 pt-1">
                {results.map((city, idx) => {
                  const id = String(city.id || city.city_id || '');
                  const suffix = suffixMap.get(id) ?? '';
                  return (
                    <ResultCard
                      key={`${resultsEpoch}-${city.id || city.city_id}`}
                      city={city}
                      idx={idx}
                      total={results.length}
                      isActive={
                        idx === activeIndex ||
                        (!!selectedCity &&
                          (selectedCity.id === city.id || selectedCity.city_id === city.city_id))
                      }
                      onSelect={onSelect}
                      onHover={handleCardHover}
                      matchLabel={copy.matchLabel}
                      suffix={suffix}
                      locale={locale}
                      animDelay={Math.min(idx * 50, 300)}
                      isSearchMode={isSearchMode}
                    />
                  );
                })}
              </ul>
            );
          })()}

        </div>
      </div>
    </div>
  );
});

// ── Individual result card ───────────────────────────────────────────────────
interface ResultCardProps {
  city: HexResult;
  idx: number;
  total?: number;
  isActive: boolean;
  onSelect: (city: HexResult) => void;
  onHover: (idx: number) => void;
  matchLabel?: string;
  suffix?: number | string;
  locale?: string;
  animDelay?: number;
  isSearchMode?: boolean;
}

/** Minimal SVG score ring — activity ring inspired, Apple-style */
const MiniRing = ({ value, color, grade }: { value: number; color: string; grade: string }) => {
  const S = 38, W = 3, r = (S - W) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - value / 100);
  const c = S / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: S, height: S }}>
      <svg width={S} height={S}>
        {/* Track — subtle bg ring */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={W} />
        {/* Progress arc with glow */}
        <circle
          cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={W}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
          style={{ filter: `drop-shadow(0 0 4px ${color}60)` }}
        />
      </svg>
      {/* Center: grade label only — simpler, stronger visual hierarchy */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-black leading-none tracking-tight" style={{ color }}>{grade}</span>
      </div>
    </div>
  );
};

const ResultCard = React.memo(function ResultCard({ city, idx, total = 1, isActive, onSelect, onHover, suffix, locale = 'en', animDelay = 0, isSearchMode = false }: ResultCardProps) {
  const handleHover = useCallback(() => onHover(idx), [onHover, idx]);
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const scoreP = Math.round((city.score ?? city.similarity ?? 0) * 100);

  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(() => onSelect(city), [onSelect, city]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(city);
      }
    },
    [onSelect, city],
  );

  // Top 2 vibe dimensions (3 chips wrap to 2 lines — keep single row for consistent card height)
  const topDims = useMemo(() => {
    if (!city.radar) return [];
    return Object.entries(city.radar)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([key, val]) => ({ key, val: Math.round(val * 100) }));
  }, [city.radar]);

  // Dominant vibe for browse mode display
  const dominantVibe = useMemo(() => {
    if (!city.radar) return null;
    const entries = Object.entries(city.radar).sort(([, a], [, b]) => b - a);
    if (entries.length === 0) return null;
    const [key, val] = entries[0];
    return { key, val: Math.round(val * 100), color: VIBE_COLORS[key] ?? '#888', icon: VIBE_ICONS[key] ?? '·' };
  }, [city.radar]);

  const scoreColorHex = scoreColor(scoreP);
  // Rank-based grade: distributes grades across the result set
  // Top 10% = A+, 10-25% = A, 25-45% = B+, 45-65% = B, 65-80% = C, else D
  const rankPct = total > 1 ? idx / total : 0;
  const gradeLabel = rankPct < 0.10 ? 'A+' : rankPct < 0.25 ? 'A' : rankPct < 0.45 ? 'B+' : rankPct < 0.65 ? 'B' : rankPct < 0.80 ? 'C' : 'D';

  // Rank badge — Apple-style: subtle numbered badge, top 3 with light gold/silver/bronze tint
  const rankBadge = (() => {
    const colors: string[] = [
      'rgba(250,200,50,0.70)',   // gold
      'rgba(190,200,215,0.60)',  // silver
      'rgba(195,120,50,0.65)',   // bronze
    ];
    const color = idx < 3 ? colors[idx] : 'rgba(235,235,245,0.50)';
    return (
      <span
        className="text-[10px] font-semibold tabular-nums flex-shrink-0 w-[17px] text-center leading-none"
        style={{ color }}
        aria-hidden="true"
      >
        {idx + 1}
      </span>
    );
  })();

  return (
    <li
      id={`result-${idx}`}
      onClick={handleClick}
      onMouseEnter={() => { setHovered(true); handleHover(); }}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={handleKeyDown}
      role="option"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      className="relative rounded-[11px] cursor-pointer outline-none overflow-hidden animate-fade-in-up"
      style={{
        border: isActive
          ? `1px solid rgba(255,255,255,0.16)`
          : '0.5px solid rgba(255,255,255,0.08)',
        borderLeft: dominantVibe ? `4px solid ${dominantVibe.color}` : '4px solid transparent',
        background: isActive
          ? 'rgba(63,63,70,0.95)'
          : hovered ? 'rgba(50,50,55,0.92)' : 'rgba(39,39,42,0.85)',
        boxShadow: isActive
          ? `0 4px 16px rgba(0,0,0,0.32), 0 0 0 0.5px rgba(79,110,247,0.20) inset, 0 0 0 1px rgba(79,110,247,0.08)`
          : hovered
            ? '0 6px 20px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.18)'
            : '0 2px 8px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.12)',
        transform: hovered && !isActive ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease, border-color 0.15s ease',
        animationDelay: `${animDelay}ms`,
        animationFillMode: 'both',
      }}
    >
      {/* No accent strip — Apple uses background/border change only for selection */}
      <div className="p-3">
        <div className="flex items-start gap-2">
          {/* Score ring (search mode) or vibe dot (browse mode) */}
          {isSearchMode
            ? <MiniRing value={scoreP} color={scoreColorHex} grade={gradeLabel} />
            : dominantVibe && (
                <div className="flex-shrink-0 w-[38px] h-[38px] rounded-full flex items-center justify-center"
                  style={{ background: `${dominantVibe.color}18`, border: `1.5px solid ${dominantVibe.color}40` }}>
                  <span className="text-[18px] leading-none">{dominantVibe.icon}</span>
                </div>
              )
          }

          {/* Center: name + location + chips */}
          <div className="min-w-0 flex-1">
            {/* Rank badge + Name */}
            <div className="flex items-center gap-1.5 mb-1">
              {rankBadge}
              {/* 15px / font-semibold: primary label — WCAG AA large */}
              <span className="text-[15px] font-semibold truncate leading-[1.3] tracking-[-0.018em]" style={{ color: 'rgba(255,255,255,0.88)' }}>
                {resolveLocalityName(city)}{suffix ? ` #${suffix}` : ''}
              </span>
            </div>

            {/* Location — secondary info */}
            <div className="flex items-center gap-1 mb-2">
              <MapPin size={9} className="flex-shrink-0" style={{ color: 'rgba(235,235,245,0.55)' }} aria-hidden="true" />
              <span className="text-[12px] font-normal truncate tracking-[-0.008em]" style={{ color: 'rgba(235,235,245,0.55)' }}>
                {placeLabel(city, suffix)}
              </span>
            </div>

            {/* Vibe dimension mini-bars — data-dense professional look */}
            {topDims.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-hidden flex-nowrap">
                {topDims.map(({ key, val }) => {
                  const clr = VIBE_COLORS[key] ?? '#aaa';
                  return (
                    <span
                      key={key}
                      className="flex items-center gap-[3px] px-2 py-[2.5px] rounded-full text-[10.5px] font-medium leading-none"
                      style={{
                        color: clr,
                        backgroundColor: `${clr}1A`,
                        border: `0.5px solid ${clr}33`,
                      }}
                    >
                      <span className="text-[9.5px]">{VIBE_ICONS[key] ?? '·'}</span>
                      <span className="tracking-[-0.008em]">{getVibeLabel(key, locale)}</span>
                      <span className="text-[8.5px] tabular-nums opacity-60 ml-0.5">{val}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Score (search mode) or Dominant vibe (browse mode) */}
          {isSearchMode ? (
            <div className="flex-shrink-0 flex flex-col items-end justify-start pt-0.5">
              <span
                className="text-[17px] font-bold tabular-nums leading-none tracking-[-0.04em]"
                style={{ color: scoreColorHex }}
              >
                {scoreP}
              </span>
              <span className="text-[8px] font-medium tabular-nums leading-none mt-0.5" style={{ color: 'rgba(235,235,245,0.50)' }}>
                /100
              </span>
            </div>
          ) : dominantVibe ? (
            <div className="flex-shrink-0 flex flex-col items-end justify-start pt-0.5 min-w-[38px]">
              <span className="text-[16px] leading-none">{dominantVibe.icon}</span>
              <span className="text-[9px] font-semibold leading-none mt-1 tabular-nums" style={{ color: dominantVibe.color }}>
                {dominantVibe.val}%
              </span>
            </div>
          ) : null}
        </div>

        {/* Match reason — tertiary, italic hint */}
        {city.match_reason && (
          <p className="text-[11px] mt-1.5 ml-[48px] line-clamp-1 italic leading-relaxed" style={{ color: 'rgba(235,235,245,0.62)' }}>
            {city.match_reason === 'Location match'
              ? copy.matchReasonLocation
              : city.match_reason === 'Neighborhood nearest fallback'
              ? copy.matchReasonNeighborhood
              : city.match_reason}
          </p>
        )}

        {/* Mini vibe sparkline — 6 dimension bars for data density */}
        {city.radar && (
          <div className="flex items-end gap-[2px] mt-2 ml-[48px] h-[12px]">
            {(['active', 'classic', 'quiet', 'trendy', 'nature', 'urban'] as const).map((dim) => {
              const v = Math.round((city.radar?.[dim] ?? 0) * 100);
              const clr = VIBE_COLORS[dim] ?? '#888';
              return (
                <div key={dim} className="flex-1 rounded-[1.5px] transition-all duration-200"
                  style={{
                    height: `${Math.max(v * 0.12, 1.5)}px`,
                    background: `${clr}${v > 30 ? 'AA' : '66'}`,
                    minWidth: '3px',
                  }}
                  title={`${getVibeLabel(dim, locale)}: ${v}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
});

