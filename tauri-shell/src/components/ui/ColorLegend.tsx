/**
 * ColorLegend — map overlay showing the vibe category colors.
 * Legend content adapts to the current analysis mode:
 *   - suitability: 5-step sequential gradient (Gray→Blue→Teal→Green→Gold)
 *   - search/explore: similarity gradient + 6 vibe category swatches
 *
 * Design basis: ColorBrewer sequential palette (Brewer 2003) for quantitative
 * data; qualitative swatches follow perceptual distinctiveness guidelines.
 * Toggle interaction follows Fitts's Law (min 36px touch target).
 */
import React, { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';
import { getVibeLabel } from '../../utils/vibeConstants';

// Matches VIBE_CATEGORY_COLORS — perceptually calibrated (must match vibeConstants.ts)
const CATEGORY_LEGEND = [
  { key: 'active',  color: '#FF6B6B', icon: '🏃' },
  { key: 'classic', color: '#FFAB40', icon: '🏛️' },
  { key: 'quiet',   color: '#CC84FF', icon: '🧘' },
  { key: 'trendy',  color: '#1BC8C8', icon: '✨' },
  { key: 'nature',  color: '#5DD67A', icon: '🌿' },
  { key: 'urban',   color: '#4D9FFF', icon: '🏙️' },
];

interface ColorLegendProps {
  mode: 'browse' | 'search';
  visible: boolean;
  analysisMode?: 'suitability' | 'comparison' | 'explore';
  locale?: string;
  collapsed?: boolean;
}

export const ColorLegend = React.memo(function ColorLegend({ mode, visible, analysisMode = 'explore', locale, collapsed }: ColorLegendProps) {
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const [hidden, setHidden] = useState(false);
  if (!visible) return null;

  const legendCls = `color-legend${collapsed ? ' legend-collapsed' : ''}`;

  const toggleBtn = (
    <button
      onClick={() => setHidden(h => !h)}
      className="absolute top-2 right-2 flex items-center justify-center w-[22px] h-[22px] rounded-[6px] transition-colors duration-120"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '0.5px solid rgba(255,255,255,0.12)',
        color: 'rgba(235,235,245,0.40)',
        cursor: 'pointer',
        pointerEvents: 'auto',
      }}
      title={hidden ? copy.showLegend : copy.hideLegend}
      aria-label={hidden ? copy.showLegend : copy.hideLegend}
    >
      {hidden ? <Eye size={11} /> : <EyeOff size={11} />}
    </button>
  );

  if (hidden) {
    return (
      <div className={legendCls} style={{ pointerEvents: 'auto', minWidth: 'auto', padding: '6px 8px' }}>
        <button
          onClick={() => setHidden(false)}
          className="flex items-center gap-1.5"
          style={{ color: 'rgba(235,235,245,0.40)', cursor: 'pointer', background: 'none', border: 'none' }}
          aria-label={copy.showLegend}
        >
          <Eye size={12} />
          <span className="text-[10px] font-medium tracking-wide" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.colorLegend}</span>
        </button>
      </div>
    );
  }

  // ── Suitability mode: 5-step sequential gradient (ColorBrewer sequential) ──
  if (analysisMode === 'suitability') {
    // Gray→Steel Blue→Teal→Green→Gold — matches suitabilityColor() in MapLibreMap
    const steps = ['#4A5260', '#3478BE', '#10BABA', '#50C86E', '#FFAB32'];
    return (
      <div className={legendCls} style={{ pointerEvents: 'auto' }}>
        {toggleBtn}
        <div className="text-[11px] uppercase font-semibold tracking-wider mb-2 pr-6" style={{ color: 'rgba(235,235,245,0.55)' }}>
          {copy.suitabilityScore}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.45)' }}>{copy.low}</span>
          <div className="flex flex-1 h-3 rounded-full overflow-hidden" style={{ gap: 0 }}>
            {steps.map((c, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: c }} />
            ))}
          </div>
          <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.45)' }}>{copy.high}</span>
        </div>
        <div className="flex justify-between mt-1 px-0.5">
          {[copy.suitabilityScaleNone, copy.suitabilityScaleLow, copy.suitabilityScaleMedium, copy.suitabilityScaleHigh, copy.suitabilityScaleBest].map((label, i) => (
            <span key={i} className="text-[9px]" style={{ color: 'rgba(235,235,245,0.55)' }}>{label}</span>
          ))}
        </div>
      </div>
    );
  }

  // ── Search mode (no analysis tab active): similarity gradient ────────────
  if (mode === 'search' && analysisMode !== 'explore' && analysisMode !== 'comparison') {
    const steps = ['hsl(213,40%,50%)', 'hsl(213,60%,54%)', 'hsl(213,80%,58%)', 'hsl(180,70%,50%)'];
    return (
      <div className={legendCls} style={{ pointerEvents: 'auto' }}>
        {toggleBtn}
        <div className="text-[11px] uppercase font-semibold tracking-wider mb-2 pr-6" style={{ color: 'rgba(235,235,245,0.55)' }}>
          {copy.similarityScore}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.45)' }}>{copy.low}</span>
          <div className="flex flex-1 h-3 rounded-full overflow-hidden">
            {steps.map((c, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: c }} />
            ))}
          </div>
          <span className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.45)' }}>{copy.high}</span>
        </div>
      </div>
    );
  }

  // ── Browse / Explore / Comparison mode: 6 vibe category swatches ────────────
  return (
    <div className={legendCls} style={{ pointerEvents: 'auto' }}>
      {toggleBtn}
      <div className="text-[11px] uppercase font-semibold tracking-[0.07em] mb-2.5 pr-6" style={{ color: 'rgba(235,235,245,0.50)' }}>
        {copy.dominantVibe}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {CATEGORY_LEGEND.map((cat) => (
          <div
            key={cat.key}
            className="flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 cursor-default transition-colors duration-150"
            style={{ color: 'transparent' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: cat.color,
                boxShadow: `0 0 4px ${cat.color}55`,
              }}
            />
            <span className="text-[10.5px] font-medium" style={{ color: 'rgba(235,235,245,0.65)' }}>
              {cat.icon} {getVibeLabel(cat.key, locale)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid rgba(84,84,88,0.35)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[9.5px] font-medium" style={{ color: 'rgba(235,235,245,0.32)' }}>{copy.low}</span>
          <div
            className="flex-1 h-1.5 rounded-full"
            style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.05), rgba(255,255,255,0.45))' }}
          />
          <span className="text-[9.5px] font-medium" style={{ color: 'rgba(235,235,245,0.32)' }}>{copy.high}</span>
        </div>
        <div className="text-[9px] text-center mt-1" style={{ color: 'rgba(235,235,245,0.50)' }}>{copy.opacityDataIntensity}</div>
      </div>
    </div>
  );
});

