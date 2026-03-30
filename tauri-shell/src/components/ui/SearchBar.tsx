import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, X, Clock3, Sparkles } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: (overrideQuery?: string) => void;
  loading: boolean;
  resultCount: number;
  recentQueries?: string[];
  onRemoveRecentQuery?: (value: string) => void;
  onClearRecentQueries?: () => void;
  validationMessage?: string | null;
  minQueryLen?: number;
  quickChips?: string[];
  locale?: string;
}

export const SearchBar = React.memo(function SearchBar({
  query,
  onQueryChange,
  onSearch,
  loading,
  resultCount,
  recentQueries = [],
  onRemoveRecentQuery,
  onClearRecentQueries,
  validationMessage,
  minQueryLen = 2,
  quickChips = [],
  locale = 'en',
}: SearchBarProps) {
  const [focused, setFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = useMemo(() => getUiCopy(locale), [locale]);

  const preventDefaultHandler = useCallback((e: React.MouseEvent) => e.preventDefault(), []);
  const clearBtnEnter = useCallback((e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.style.color = 'var(--color-text-2)';
    el.style.background = 'rgba(255,255,255,0.07)';
  }, []);
  const clearBtnLeave = useCallback((e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.style.color = 'var(--color-text-3)';
    el.style.background = 'transparent';
  }, []);

  const trimmed = query.trim();
  const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);

  // Normalize diacritics for accent-insensitive matching (e.g. "Sao" matches "São")
  const normStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const suggestions = useMemo(() => {
    const base = [...recentQueries, ...quickChips];
    const deduped = [...new Set(base.map((v) => (v || '').trim()).filter(Boolean))];
    if (!trimmed) return deduped.slice(0, 8);
    const normQ = normStr(trimmed);
    return deduped.filter((v) => normStr(v).includes(normQ)).slice(0, 8);
  }, [recentQueries, quickChips, trimmed]);

  const canShowSuggestions = focused && suggestions.length > 0;
  const canSearch = trimmed.length >= minQueryLen && !loading;

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [query, focused]);

  const applySuggestion = useCallback(
    (value: string) => {
      onQueryChange(value);
      onSearch(value);
      setHighlightedIndex(-1);
      // Close dropdown after selection
      setTimeout(() => inputRef.current?.blur(), 0);
    },
    [onQueryChange, onSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }

      if (e.key === 'ArrowUp' && suggestions.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }

      if (e.key === 'Enter') {
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          e.preventDefault();
          applySuggestion(suggestions[highlightedIndex]);
          return;
        }
        onSearch();
        // Close dropdown after Enter search
        setTimeout(() => inputRef.current?.blur(), 0);
      }

      if (e.key === 'Escape') {
        if (trimmed) {
          onQueryChange('');
        }
        setHighlightedIndex(-1);
      }
    },
    [suggestions, highlightedIndex, applySuggestion, onSearch, onQueryChange, trimmed],
  );

  const helperText = useMemo(() => {
    if (validationMessage) return validationMessage;
    if (!trimmed) return `${copy.helperExample} • ${copy.nextStepHint}`;
    return copy.helperMinChars(minQueryLen);
  }, [validationMessage, trimmed, minQueryLen, copy]);

  const isRecentChip = (value: string) => recentQueries.includes(value);

  return (
    <div className="flex-1 max-w-lg relative" role="search">
      {/* ── Search input container ─────────────────────────────────────── */}
      <div
        className={`flex items-center gap-2.5 px-3.5 h-[42px] rounded-[11px] border-[0.5px] transition-all duration-200 ${
          focused
            ? 'border-[rgba(74,150,255,0.50)] bg-[rgba(44,44,46,0.95)] shadow-[0_0_0_3px_rgba(74,150,255,0.14),0_4px_16px_rgba(0,0,0,0.25)] backdrop-blur-[72px]'
            : 'border-[rgba(255,255,255,0.10)] bg-[rgba(44,44,46,0.75)] shadow-[0_2px_8px_rgba(0,0,0,0.20)] backdrop-blur-[72px]'
        }`}
      >
        {/* Search icon */}
        <div className={`flex-shrink-0 transition-colors duration-200 ${focused ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-3)]'}`}>
          <Search size={14} aria-hidden="true" />
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="search"
          className="flex-1 bg-transparent border-none text-[14px] text-[var(--color-text)] outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 focus-visible:ring-offset-0 placeholder:text-[var(--color-text-3)] font-normal tracking-[-0.012em]"
          placeholder={copy.searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={copy.searchAria}
          aria-haspopup="listbox"
          aria-expanded={canShowSuggestions}
          aria-autocomplete="list"
          aria-controls="search-suggestions-list"
          aria-activedescendant={highlightedIndex >= 0 ? `suggestion-${highlightedIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Loader or clear button */}
        {loading ? (
          <Loader2 size={13} className="animate-spin flex-shrink-0 text-[var(--color-accent)] opacity-70" aria-hidden="true" />
        ) : trimmed.length > 0 ? (
          <button
            onClick={() => onQueryChange('')}
            className="flex-shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all duration-150 active:scale-90"
            style={{ color: 'var(--color-text-3)' }}
            onMouseEnter={clearBtnEnter}
            onMouseLeave={clearBtnLeave}
            aria-label={copy.clearSearchAria}
          >
            <X size={11} />
          </button>
        ) : resultCount > 0 ? (
          <span
            className="text-[10px] font-bold tabular-nums flex-shrink-0 px-1.5 py-[2px] rounded-full leading-none"
            style={{ color: 'var(--color-accent)', background: 'var(--color-accent-dim)', border: '0.5px solid rgba(74,150,255,0.22)' }}
            aria-label={copy.resultCountAria(resultCount)}
          >
            {resultCount}
          </span>
        ) : null}
      </div>

      {/* ── Shortcut hint + Helper text — only show when focused or validation error ── */}
      {(focused || !!validationMessage) && (
        <div className="mt-1 px-1.5 flex items-center justify-between gap-2 animate-fade-in">
          <p className={`text-[10px] transition-colors duration-200 ${validationMessage ? 'text-red-300/85' : 'text-white/30'}`}>
            {helperText}
          </p>
          {!focused && !trimmed && (
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/20 border border-white/[0.08] bg-white/[0.04] flex-shrink-0">
              {isMac ? <><span>⌘</span><span>K</span></> : <span>Ctrl+K</span>}
            </kbd>
          )}
        </div>
      )}

      {/* ── Quick chips ────────────────────────────────────────────────── */}
      {quickChips.length > 0 && !trimmed && (
        <div className="mt-2 px-0.5 flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
          <div className="flex-shrink-0 flex items-center gap-1 text-[10px] text-[rgba(235,235,245,0.50)] font-semibold uppercase tracking-widest pr-0.5">
            <Sparkles size={9} />
          </div>
          {quickChips.map((chip, i) => (
            <button
              key={chip}
              onMouseDown={preventDefaultHandler}
              onClick={() => applySuggestion(chip)}
              className="flex-shrink-0 px-3 py-[6px] rounded-full text-[12px] font-medium bg-[rgba(118,118,128,0.14)] border-[0.5px] border-[rgba(84,84,88,0.55)] text-[rgba(235,235,245,0.60)] hover:bg-[rgba(74,150,255,0.15)] hover:border-[rgba(74,150,255,0.35)] hover:text-[#72B0FF] transition-all duration-150 active:scale-95"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* ── Suggestions dropdown ───────────────────────────────────────── */}
      {canShowSuggestions && (
        <div className="absolute top-[60px] left-0 right-0 z-[700] rounded-[16px] border-[0.5px] border-[rgba(255,255,255,0.10)] bg-[rgba(16,16,20,0.98)] backdrop-blur-[56px] shadow-[0_16px_48px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.055)_inset] p-1.5 animate-fade-in-up">
          <div className="flex items-center justify-between px-3 py-1.5 mb-0.5">
            <div className="flex items-center gap-1.5 text-[10px] text-white/32 font-medium uppercase tracking-[0.06em]">
              <Clock3 size={9} />
              {!trimmed ? copy.recentSearches : copy.suggestions}
            </div>
            {!trimmed && onClearRecentQueries && recentQueries.length > 0 && (
              <button
                onMouseDown={preventDefaultHandler}
                onClick={onClearRecentQueries}
                className="text-[11px] text-[var(--color-accent)] opacity-70 hover:opacity-100 transition-opacity font-medium"
              >
                {copy.clear}
              </button>
            )}
          </div>

          <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-0.5" role="listbox" id="search-suggestions-list">
            {suggestions.map((value, idx) => (
              <div key={value} className="flex items-center gap-1" role="option" aria-selected={highlightedIndex === idx}>
                <button
                  id={`suggestion-${idx}`}
                  onMouseDown={preventDefaultHandler}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => applySuggestion(value)}
                  className={`flex-1 text-left px-3 py-2 rounded-[9px] text-[13px] font-normal transition-all duration-100 tracking-[-0.008em] ${
                    highlightedIndex === idx
                      ? 'bg-[rgba(10,132,255,0.10)] text-white/88'
                      : 'text-white/65 hover:bg-white/[0.06] hover:text-white/86'
                  }`}
                >
                  <span className="mr-2 opacity-40">{isRecentChip(value) ? '🕐' : '🔍'}</span>
                  {value}
                </button>
                {!trimmed && onRemoveRecentQuery && isRecentChip(value) && (
                  <button
                    onMouseDown={preventDefaultHandler}
                    onClick={() => onRemoveRecentQuery(value)}
                    className="p-1.5 rounded-[7px] text-white/24 hover:text-white/55 hover:bg-white/[0.06] transition-all"
                    aria-label={`${copy.clear} ${value}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

