import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, SlidersHorizontal, Settings, ArrowLeft, PanelLeftClose, HelpCircle } from 'lucide-react';
import { SearchBar } from '../ui/SearchBar';
import { ResultsList } from '../ui/ResultsList';
import { AnalysisPanel } from '../ui/AnalysisPanel';
import { VibeReport } from '../vibe/VibeReport';
import { LanguagePicker } from '../ui/LanguagePicker';
import { getUiCopy } from '../../i18n/ui';
import type { UiLocale } from '../../i18n/ui';
import { VIBE_COLORS, VIBE_ICONS, getVibeLabel, scoreColor } from '../../utils/vibeConstants';
import type { HexResult } from '../../hooks/useEngine';
import type { VibeWeights, AnalysisPreset, BookmarkedHex, VibeDimKey } from '../../hooks/useUserData';

/** Mini stat card for the dashboard strip */
function StatCard({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent: string }) {
  return (
    <div
      className="rounded-[9px] px-2 py-2 text-center transition-all duration-150"
      style={{
        background: `linear-gradient(145deg, ${accent}18 0%, ${accent}0C 100%)`,
        border: `0.5px solid ${accent}30`,
        boxShadow: `0 1px 4px rgba(0,0,0,0.22), inset 0 0.5px 0 ${accent}20`,
      }}
    >
      <div className="text-[13px] font-bold tabular-nums leading-tight" style={{ color: `${accent}e8` }}>
        {value}{unit && <span className="text-[9px] font-medium ml-0.5" style={{ color: `${accent}a0` }}>{unit}</span>}
      </div>
      <div className="text-[8px] font-semibold uppercase tracking-wider mt-[3px]" style={{ color: 'rgba(235,235,245,0.52)' }}>
        {label}
      </div>
    </div>
  );
}

interface SidebarProps {
  // Search Props
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: (q?: string) => void;
  loading: boolean;
  searchResults: HexResult[];
  hasSearched: boolean;
  isSearchMode: boolean;
  recentQueries: string[];
  onRemoveRecentQuery: (q: string) => void;
  onClearRecentQueries: () => void;
  validationMessage: string | null;
  minQueryLen: number;
  quickChips: string[];

  // Selection
  selectedCity: HexResult | null;
  onSelectCity: (city: HexResult | null) => void;
  compareTarget: HexResult | null;
  isPickingCompare: boolean;
  onCompareStart: (city: HexResult) => void;
  onCompareSelect: (base: HexResult, target: HexResult) => void;
  onCloseReport: () => void;

  // Analysis Props
  weights: VibeWeights;
  presets: AnalysisPreset[];
  bookmarks: BookmarkedHex[];
  analysisMode: 'suitability' | 'comparison' | 'explore';
  showLegend: boolean;
  showLabels: boolean;
  hexCount: number;
  totalInView: number;
  engineMeta: any;
  onWeightChange: (key: VibeDimKey, value: number) => void;
  onApplyPreset: (id: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  onResetWeights: () => void;
  onModeChange: (mode: 'suitability' | 'comparison' | 'explore') => void;
  onToggleLegend: () => void;
  onToggleLabels: () => void;
  onBookmarkClick: (b: BookmarkedHex) => void;
  onBookmark: (city: HexResult) => void;
  onRemoveBookmark: (h3: string) => void;
  onUpdateBookmarkNote: (h3: string, note: string) => void;
  
  // Data / License
  dbCountries: string[];
  dbCities: string[];
  onCountrySelect: (c: string) => void;
  isPremium: boolean;
  tierLimits: any;
  onOpenLicenseModal: () => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  engineBaseUrl?: string;
  engineToken?: string;

  // UI State
  locale?: string;
  onLocaleChange?: (l: UiLocale) => void;
  displayedHexes: HexResult[];
  onCollapse?: () => void;
}

export function Sidebar({
  query, onQueryChange, onSearch, loading, searchResults, hasSearched, isSearchMode,
  recentQueries, onRemoveRecentQuery, onClearRecentQueries, validationMessage, minQueryLen, quickChips,
  selectedCity, onSelectCity, compareTarget, isPickingCompare, onCompareStart, onCompareSelect, onCloseReport,
  weights, presets, bookmarks, analysisMode, showLegend, showLabels, hexCount, totalInView, engineMeta,
  onWeightChange, onApplyPreset, onSavePreset, onDeletePreset, onResetWeights, onModeChange,
  onToggleLegend, onToggleLabels, onBookmarkClick, onBookmark, onRemoveBookmark, onUpdateBookmarkNote,
  dbCountries, dbCities, onCountrySelect, isPremium, tierLimits, onOpenLicenseModal, onOpenSettings, onOpenHelp,
  engineBaseUrl = '', engineToken = '',
  locale = 'en', onLocaleChange, displayedHexes, onCollapse
}: SidebarProps) {
  const copy = getUiCopy(locale);
  const [activeTab, setActiveTab] = useState<'search' | 'analysis'>('search');
  
  // Auto-switch to search tab when searching
  useEffect(() => {
    if (query.trim() || hasSearched) {
      setActiveTab('search');
    }
  }, [query, hasSearched]);

  // When details are shown, we just overlay them.
  // But we also want a manual tab switch.

  return (
    <aside 
      className="flex flex-col w-[380px] h-full overflow-hidden"
      style={{
        background: 'rgba(22, 22, 24, 0.78)',
        backdropFilter: 'blur(60px) saturate(200%)',
        WebkitBackdropFilter: 'blur(60px) saturate(200%)',
        borderRadius: '14px',
        border: '0.5px solid rgba(255, 255, 255, 0.13)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.07) inset',
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-shrink-0 z-50" style={{ borderBottom: '0.5px solid rgba(255, 255, 255, 0.06)' }}>
        <div className="flex items-center justify-between px-4 h-[48px]">
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-black tracking-[-0.04em] leading-none" style={{ color: 'rgba(255,255,255,0.92)' }}>
              eodi<span style={{
                background: `linear-gradient(135deg, ${VIBE_COLORS.trendy} 0%, ${VIBE_COLORS.urban} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>.me</span>
            </span>
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] px-1.5 py-[2.5px] rounded-[4px]"
              style={{
                color: VIBE_COLORS.active,
                background: `${VIBE_COLORS.active}12`,
                border: `0.5px solid ${VIBE_COLORS.active}35`,
                letterSpacing: '0.10em',
              }}>
              Vibe
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onLocaleChange && (
              <LanguagePicker locale={locale as UiLocale} onChange={onLocaleChange} />
            )}
            <button
              onClick={onOpenHelp}
              aria-label={copy.openHelpAria ?? 'Keyboard shortcuts & help'}
              title={copy.openHelpAria ?? 'Keyboard shortcuts & help'}
              className="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center transition-all duration-150 text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-[rgba(255,255,255,0.06)]"
            >
              <HelpCircle size={15} />
            </button>
            <button
              onClick={onOpenSettings}
              aria-label={copy.openSettingsAria ?? 'Open settings'}
              className="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center transition-all duration-150 text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-[rgba(255,255,255,0.06)]"
            >
              <Settings size={15} />
            </button>
            {onCollapse && (
              <button
                onClick={onCollapse}
                className="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center transition-all duration-150 text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-[rgba(255,255,255,0.06)]"
                title="Collapse panel"
                aria-label={copy.collapsePanelAria ?? 'Collapse panel'}
              >
                <PanelLeftClose size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar Area */}
        <div className="px-4 py-3 pb-2">
          <SearchBar
            query={query}
            onQueryChange={onQueryChange}
            onSearch={onSearch}
            loading={loading}
            resultCount={searchResults.length}
            recentQueries={recentQueries}
            onRemoveRecentQuery={onRemoveRecentQuery}
            onClearRecentQueries={onClearRecentQueries}
            validationMessage={validationMessage}
            minQueryLen={minQueryLen}
            quickChips={quickChips}
            locale={locale}
          />
        </div>

        {/* Tabs */}
        {!selectedCity && (
          <div className="flex px-4 gap-5" style={{ borderBottom: '0.5px solid rgba(255, 255, 255, 0.08)' }}>
            <button
              onClick={() => setActiveTab('search')}
              className={`pb-2.5 pt-1 text-[12.5px] font-semibold transition-all relative ${
                activeTab === 'search' ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Search size={14} />
                {copy.statusSearch}
              </div>
              {activeTab === 'search' && (
                <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-accent)]" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('analysis')}
              className={`pb-2.5 pt-1 text-[12.5px] font-semibold transition-all relative ${
                activeTab === 'analysis' ? 'text-[var(--color-text)]' : 'text-[var(--color-text-3)] hover:text-[var(--color-text-2)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={14} />
                {copy.analysisTitle}
              </div>
              {activeTab === 'analysis' && (
                <motion.div layoutId="tab-indicator" className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-accent)]" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Vibe Stats Dashboard ─────────────────────────────────────────── */}
      {!selectedCity && activeTab === 'search' && displayedHexes.length > 0 && (
        <div className="flex-shrink-0 px-3 py-2.5" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
          <div className="grid grid-cols-3 gap-1.5">
            {(() => {
              // Compute dominant vibe distribution
              const vibeCounts: Record<string, number> = {};
              let totalScore = 0;
              for (const h of displayedHexes) {
                const s = h.score ?? h.similarity ?? 0;
                totalScore += s;
                if (h.radar) {
                  const top = Object.entries(h.radar).sort(([,a],[,b]) => Math.abs(Number(b)) - Math.abs(Number(a)))[0];
                  if (top) vibeCounts[top[0]] = (vibeCounts[top[0]] || 0) + 1;
                }
              }
              const avgScore = displayedHexes.length > 0 ? Math.round((totalScore / displayedHexes.length) * 100) : 0;
              const topVibe = Object.entries(vibeCounts).sort(([,a],[,b]) => b - a)[0];
              const topVibeKey = topVibe ? topVibe[0] : '';
              const topVibeIcon = topVibeKey ? (VIBE_ICONS[topVibeKey] || '') : '';
              const topVibePct = topVibe && displayedHexes.length > 0 ? Math.round((topVibe[1] / displayedHexes.length) * 100) : 0;

              return (
                <>
                  <StatCard label={copy.statsHexCount || 'Areas'} value={displayedHexes.length.toLocaleString()} accent="#3B82F6" />
                  <StatCard label={copy.statsAvgScore || 'Avg Score'} value={`${avgScore}`} unit="/100" accent={scoreColor(avgScore)} />
                  <StatCard
                    label={topVibeKey ? getVibeLabel(topVibeKey, locale) : (copy.statsDominantVibe || 'Top Vibe')}
                    value={topVibeKey ? `${topVibeIcon} ${topVibePct}%` : '—'}
                    accent={VIBE_COLORS[topVibeKey] || '#888'}
                  />
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait" initial={false}>
          {selectedCity ? (
            <motion.div
              key="details"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="absolute inset-0 bg-[var(--color-bg)] z-20 flex flex-col"
            >
              <div className="flex items-center h-[48px] px-4 border-b border-[rgba(255,255,255,0.06)] flex-shrink-0">
                <button
                  onClick={onCloseReport}
                  className="flex items-center gap-2 text-[12.5px] font-semibold text-[rgba(235,235,245,0.55)] hover:text-[rgba(235,235,245,0.88)] transition-colors"
                >
                  <ArrowLeft size={13} />
                  {copy.backToResults}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-hide">
                <VibeReport
                  city={selectedCity}
                  comparedCity={compareTarget}
                  onClose={onCloseReport}
                  onCompareStart={onCompareStart}
                  onBookmark={() => onBookmark(selectedCity)}
                  isBookmarked={bookmarks.some(b => b.h3_index === (selectedCity.h3_index || selectedCity.id))}
                  locale={locale}
                  allVisibleHexes={displayedHexes}
                  rightOffset={0}
                  inline={true}
                  isPickingCompare={isPickingCompare}
                  tierLimits={tierLimits}
                  isPremium={isPremium}
                  onOpenLicenseModal={onOpenLicenseModal}
                />
              </div>
            </motion.div>
          ) : activeTab === 'search' ? (
            <motion.div
              key="search-list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-y-auto scrollbar-thin"
            >
              <ResultsList
                results={displayedHexes}
                selectedCity={selectedCity}
                onSelect={onSelectCity}
                open={true}
                onToggle={() => {}}
                loading={loading}
                query={query}
                hasSearched={hasSearched}
                isSearchMode={isSearchMode}
                minQueryLen={minQueryLen}
                locale={locale}
                onOpenLicenseModal={onOpenLicenseModal}
              />
            </motion.div>
          ) : (
            <motion.div
              key="analysis-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full overflow-y-auto scrollbar-thin"
            >
              <AnalysisPanel
                weights={weights}
                presets={presets}
                bookmarks={bookmarks}
                analysisMode={analysisMode}
                showLegend={showLegend}
                showLabels={showLabels}
                hexCount={hexCount}
                totalInView={totalInView}
                isSearchMode={isSearchMode}
                engineMeta={engineMeta}
                onWeightChange={onWeightChange}
                onApplyPreset={onApplyPreset}
                onSavePreset={onSavePreset}
                onDeletePreset={onDeletePreset}
                onResetWeights={onResetWeights}
                onModeChange={onModeChange}
                onToggleLegend={onToggleLegend}
                onToggleLabels={onToggleLabels}
                onBookmarkClick={onBookmarkClick}
                onRemoveBookmark={onRemoveBookmark}
                onUpdateBookmarkNote={onUpdateBookmarkNote}
                collapsed={false}
                onToggleCollapse={() => {}}
                locale={locale}
                candidateHexes={displayedHexes}
                selectedHex={selectedCity}
                onSelectHex={onSelectCity}
                onCompareHexes={onCompareSelect}
                dbCountries={dbCountries}
                dbCities={dbCities}
                onCountrySelect={onCountrySelect}
                isPremium={isPremium}
                tierLimits={tierLimits}
                onOpenLicenseModal={onOpenLicenseModal}
                engineBaseUrl={engineBaseUrl}
                engineToken={engineToken}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}
