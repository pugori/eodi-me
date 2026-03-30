import React, { useState, useMemo, useCallback } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { X, GitCompare, Share2, Bookmark, Check, MapPin, Layers, Lock, Printer } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';
import { VIBE_COLORS, VIBE_ICONS, getVibeLabel, getVibeDescription, scoreColor } from '../../utils/vibeConstants';
import { formatLocalityLabel, getSuffixForHex } from '../../utils/locality';
import type { HexResult, HexSignals } from '../../hooks/useEngine';
import type { TierLimits } from '../../hooks/useLicense';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Perceptually calibrated radar stroke/fill colors — must match vibeConstants.ts */
const VIBE_RADAR_COLORS: Record<string, string> = {
  active:   '#FF5F5F',  // Vivid Coral
  classic:  '#FFBB33',  // Golden Amber
  culture:  '#FFBB33',  // Golden Amber (alias)
  quiet:    '#C77DFF',  // Rich Violet
  trendy:   '#00CFCF',  // Vivid Teal
  nature:   '#4ED870',  // Vivid Green
  urban:    '#4A96FF',  // Deep Sky
};

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

/** Custom multi-color SVG radar chart — each axis rendered in its Apple system color */
type RadarDatum = ReturnType<typeof radarData>[number];
const MultiColorRadar = ({ data, size = 200 }: { data: RadarDatum[]; size?: number }) => {
  if (data.length === 0) return null;
  const cx = size / 2, cy = size / 2;
  const maxR = size * 0.36;
  const n = data.length;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i: number, r: number) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });

  const polyPts = data.map((d, i) => pt(i, (d.value / 100) * maxR));
  const polyPath = polyPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
  const rings = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid rings */}
      {rings.map((rr, ri) => {
        const ringPts = data.map((_, i) => pt(i, rr * maxR));
        const rPath = ringPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
        return <path key={ri} d={rPath} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={0.6} />;
      })}
      {/* Axis spoke lines */}
      {data.map((d, i) => {
        const end = pt(i, maxR);
        return <line key={`ax-${i}`} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke={d.fill} strokeWidth={0.7} strokeOpacity={0.48} />;
      })}
      {/* Filled polygon — very subtle */}
      <path d={polyPath} fill="rgba(255,255,255,0.08)" stroke="none" />
      {/* Per-segment colored border */}
      {data.map((d, i) => {
        const p1 = polyPts[i], p2 = polyPts[(i + 1) % n];
        return <line key={`seg-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={d.fill} strokeWidth={1.8} strokeOpacity={1.0} strokeLinecap="round" />;
      })}
      {/* Colored spokes from center */}
      {data.map((d, i) => {
        const end = polyPts[i];
        return <line key={`sp-${i}`} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke={d.fill} strokeWidth={1.4} strokeOpacity={0.72} strokeLinecap="round" />;
      })}
      {/* Colored dots */}
      {data.map((d, i) => {
        const p = polyPts[i];
        return <circle key={`dot-${i}`} cx={p.x} cy={p.y} r={3.5} fill={d.fill} stroke="rgba(0,0,0,0.5)" strokeWidth={1} />;
      })}
      {/* Ring value labels (25/50/75) along first axis spoke */}
      {[0.25, 0.5, 0.75].map((rr, ri) => {
        const labelPt = pt(0, rr * maxR);
        return (
          <text key={`rvl-${ri}`} x={labelPt.x + 3} y={labelPt.y}
            textAnchor="start" dominantBaseline="middle"
            fill="rgba(255,255,255,0.42)" fontSize={7} fontWeight={500}>
            {Math.round(rr * 100)}
          </text>
        );
      })}
      {/* Axis labels in vibe color */}
      {data.map((d, i) => {
        const labelR = maxR + 16;
        const lp = pt(i, labelR);
        return (
          <text key={`lbl-${i}`} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
            fill={d.fill} fontSize={9.5} fontWeight={600} opacity={1.0}>
            {d.axis}
          </text>
        );
      })}
    </svg>
  );
};

function formatPop(pop: number | null | undefined): string {
  if (!pop) return '—';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(0)}K`;
  return pop.toLocaleString();
}

/** Interprets a 0-1 normalized signal value into a label + color for non-technical users */
function signalLevel(v: number, locale: string): { label: string; pct: number; color: string } {
  const pct = Math.round(v * 100);
  // Color: green for good, yellow for medium, orange for weak
  const color = v >= 0.65 ? '#30D158' : v >= 0.38 ? '#FFD60A' : '#FF9F0A';
  const labels: Record<string, string[]> = {
    ko: ['매우낮음', '낮음', '보통', '높음', '매우높음'],
    ja: ['非常に低い', '低い', '普通', '高い', '非常に高い'],
    zh: ['非常低', '低', '中等', '高', '非常高'],
  };
  const keys = labels[locale] ?? ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
  const idx = v >= 0.80 ? 4 : v >= 0.60 ? 3 : v >= 0.38 ? 2 : v >= 0.18 ? 1 : 0;
  return { label: keys[idx], pct, color };
}

interface SignalRowProps { icon: string; title: string; hint: string; value: number; locale: string; }
const SignalRow = ({ icon, title, hint, value, locale }: SignalRowProps) => {
  const { label, pct, color } = signalLevel(value, locale);
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="text-[13px] w-5 text-center flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-[3px]">
          <span className="text-[11px] font-medium" style={{ color: 'rgba(235,235,245,0.72)' }}>{title}</span>
          <span className="text-[10px] font-semibold tabular-nums" style={{ color }}>{label}</span>
        </div>
        <div className="w-full rounded-full overflow-hidden" style={{ height: '3px', background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
      <span
        className="text-[9px] tabular-nums w-[28px] text-right flex-shrink-0"
        style={{ color: 'rgba(235,235,245,0.30)' }}
        title={hint}
      >{pct}</span>
    </div>
  );
};

/** Market Signals panel — shown when engine provides signal data (dims 6-12). */
const MarketSignalsPanel = ({ signals, locale }: { signals: HexSignals; locale: string }) => {
  const rows: Array<{ key: keyof HexSignals; icon: string; titles: Record<string, string>; hints: Record<string, string> }> = [
    {
      key: 'flow_ratio',
      icon: '💡',
      titles: { ko: '시장 기회', ja: '市場機会', zh: '市场机会', en: 'Market Opportunity' },
      hints: { ko: '수요/공급 비율 — 높을수록 블루오션', en: 'Demand/supply ratio — higher means less competition relative to foot traffic', ja: '需要/供給比 — 高いほど競合が少ない', zh: '需求/供给比 — 越高竞争越少' },
    },
    {
      key: 'pop_density',
      icon: '👥',
      titles: { ko: '고객 풀', ja: '顧客プール', zh: '客户群体', en: 'Customer Pool' },
      hints: { ko: '인구 밀도 — 잠재 고객 규모', en: 'Population density — potential customer base size', ja: '人口密度 — 潜在顧客規模', zh: '人口密度 — 潜在客户规模' },
    },
    {
      key: 'poi_density',
      icon: '⚡',
      titles: { ko: '상권 활성도', ja: '商圏活性度', zh: '商圈活跃度', en: 'Activity Level' },
      hints: { ko: 'POI 밀도 — 상권 집중도', en: 'POI density — commercial concentration and foot traffic proxy', ja: 'POI密度 — 商業集中度', zh: 'POI密度 — 商业集中度' },
    },
    {
      key: 'category_diversity',
      icon: '🏪',
      titles: { ko: '경쟁 강도', ja: '競合強度', zh: '竞争强度', en: 'Competition Level' },
      hints: { ko: '업종 다양성 — 높을수록 경쟁 포화', en: 'Category diversity — higher means more varied competition in the area', ja: 'カテゴリ多様性 — 高いほど競争が激しい', zh: '类别多样性 — 越高竞争越激烈' },
    },
    {
      key: 'transit_score',
      icon: '🚇',
      titles: { ko: '접근성', ja: 'アクセス性', zh: '交通便利性', en: 'Accessibility' },
      hints: { ko: '대중교통 접근성 — 도보 800m 내', en: 'Transit accessibility within 800m walk radius', ja: '徒歩800m圏内の交通アクセス', zh: '步行800米范围内的交通便利性' },
    },
    {
      key: 'temporal_entropy',
      icon: '🕐',
      titles: { ko: '운영 패턴', ja: '営業パターン', zh: '经营模式', en: 'All-Day Activity' },
      hints: { ko: '시간대별 활동 분포 — 높을수록 종일 유동', en: 'Temporal entropy — higher means steady all-day foot traffic vs. peak hours only', ja: '時間帯活動分布 — 高いほど一日中賑わう', zh: '时间活动分布 — 越高全天客流越稳定' },
    },
  ];

  const lang = ['ko', 'ja', 'zh'].includes(locale) ? locale : 'en';
  const visibleRows = rows.filter(r => signals[r.key] != null);
  if (visibleRows.length === 0) return null;

  const heading: Record<string, string> = {
    ko: '상권 분석 지표', ja: '商圏分析指標', zh: '商业分析指标', en: 'Market Signals',
  };
  const subheading: Record<string, string> = {
    ko: 'OSM 데이터 기반 · 참고용',
    ja: 'OSMデータ基準 · 参考値',
    zh: 'OSM数据基准 · 参考值',
    en: 'OSM-sourced · indicative',
  };

  return (
    <div className="px-5 pt-4 pb-3">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em]" style={{ color: 'rgba(235,235,245,0.52)' }}>
          {heading[lang] ?? heading.en}
        </span>
        <span className="text-[9px] px-1.5 py-[2px] rounded-full" style={{ background: 'rgba(255,149,0,0.12)', color: '#FF9F0A', border: '0.5px solid rgba(255,149,0,0.25)' }}>
          {subheading[lang] ?? subheading.en}
        </span>
      </div>
      <div className="mt-2 divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
        {visibleRows.map(r => (
          <SignalRow
            key={r.key}
            icon={r.icon}
            title={r.titles[lang] ?? r.titles.en}
            hint={r.hints[lang] ?? r.hints.en}
            value={signals[r.key] as number}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
};


function scoreGrade(v: number, locale: string): { label: string; emoji: string } {
  if (locale === 'ko') {
    if (v >= 85) return { label: '최상', emoji: '🟢' };
    if (v >= 72) return { label: '우수', emoji: '🟢' };
    if (v >= 60) return { label: '양호', emoji: '🟡' };
    if (v >= 48) return { label: '보통', emoji: '🟠' };
    if (v >= 35) return { label: '낮음', emoji: '🔴' };
    return { label: '미흡', emoji: '⚫' };
  }
  if (locale === 'ja') {
    if (v >= 85) return { label: '最高', emoji: '🟢' };
    if (v >= 72) return { label: '優良', emoji: '🟢' };
    if (v >= 60) return { label: '良好', emoji: '🟡' };
    if (v >= 48) return { label: '普通', emoji: '🟠' };
    if (v >= 35) return { label: '低め', emoji: '🔴' };
    return { label: '不足', emoji: '⚫' };
  }
  if (v >= 85) return { label: 'Excellent', emoji: '🟢' };
  if (v >= 72) return { label: 'Good', emoji: '🟢' };
  if (v >= 60) return { label: 'Fair', emoji: '🟡' };
  if (v >= 40) return { label: 'Average', emoji: '🟠' };
  if (v >= 25) return { label: 'Low', emoji: '🔴' };
  return { label: 'Sparse', emoji: '⚫' };
}

/** Returns a confidence label based on POI data richness */
function dataConfidenceLabel(confidence: number, locale: string): { label: string; color: string } {
  if (locale === 'ko') {
    if (confidence >= 70) return { label: '데이터 풍부', color: '#30D158' };
    if (confidence >= 45) return { label: '데이터 보통', color: '#FFD60A' };
    return { label: '데이터 부족', color: '#FF9F0A' };
  }
  if (locale === 'ja') {
    if (confidence >= 70) return { label: 'データ充実', color: '#30D158' };
    if (confidence >= 45) return { label: 'データ普通', color: '#FFD60A' };
    return { label: 'データ不足', color: '#FF9F0A' };
  }
  if (confidence >= 70) return { label: 'Rich data', color: '#30D158' };
  if (confidence >= 45) return { label: 'Moderate data', color: '#FFD60A' };
  return { label: 'Sparse data', color: '#FF9F0A' };
}

interface VibeReportProps {
  city: HexResult | null;
  comparedCity?: HexResult | null;
  onClose: () => void;
  onCompareStart?: () => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  locale?: string;
  allVisibleHexes?: HexResult[];
  /** Right margin offset (px) to avoid overlapping a right-side panel */
  rightOffset?: number;
  /** When true, renders as inline panel content (no absolute positioning wrapper) */
  inline?: boolean;
  /** When true, app is waiting for user to pick a compare target */
  isPickingCompare?: boolean;
  /** Feature gate — when provided, controls feature access */
  tierLimits?: TierLimits;
  isPremium?: boolean;
  onOpenLicenseModal?: () => void;
}

// ── Main Component ───────────────────────────────────────────────────────────
export const VibeReport = ({ city, comparedCity, onClose, onCompareStart, onBookmark, isBookmarked, locale = 'en', allVisibleHexes = [], rightOffset = 0, inline = false, isPickingCompare = false, tierLimits, isPremium, onOpenLicenseModal }: VibeReportProps) => {
  const [shareToast, setShareToast] = useState(false);
  const copy = getUiCopy(locale);
  const canFullVibeReport = tierLimits ? tierLimits.canFullVibeReport : (isPremium ?? false);
  const canExport = tierLimits ? tierLimits.canExport : false;

  const score = city?.score ?? city?.similarity ?? 0;
  const vibeScore = Math.round(score * 100);
  const radar1 = radarData(city?.radar, locale);
  const hasRadar = radar1.length > 0;

  const hasCompared = comparedCity?.radar != null;
  const radar2 = radarData(comparedCity?.radar, locale);

  // Use shared suffix logic (O(n))
  const suffix = useMemo(
    () => getSuffixForHex(city, allVisibleHexes),
    [city, allVisibleHexes],
  );
  const displayLocality = formatLocalityLabel(city, suffix);

  // Top vibe + saturated radar color
  const sorted = [...radar1].sort((a, b) => b.value - a.value);
  const topVibe = sorted[0];
  const radarColor = topVibe ? (VIBE_RADAR_COLORS[topVibe.key] || topVibe.fill) : '#32D74B';

  // Confidence — data richness
  const radarSum = radar1.reduce((s, d) => s + d.value, 0);
  const confidence = radar1.length > 0
    ? Math.min(100, Math.round((radarSum / (radar1.length * 100)) * 140 + 20))
    : 0;

  const handleShare = useCallback(() => {
    const text = `${city?.name} — ${copy.vibeMatch} ${vibeScore}% | eodi.me`;
    if (navigator.share) {
      navigator.share({ title: `EODI ${copy.vibeReportTitle}`, text }).catch((err) => { console.warn('[share]', err?.message ?? err); });
    } else {
      navigator.clipboard?.writeText(text).then(() => {
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2000);
      }).catch((err) => { console.warn('[share]', err?.message ?? err); });
    }
  }, [city, vibeScore, copy]);

  return (
    <AnimatePresence mode="wait">
      {city && (
      <motion.div
        key={`vibe-${city.city_id || city.id}`}
        initial={inline ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
        animate={inline ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={inline ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className={inline
          ? "flex flex-col flex-1 overflow-y-auto custom-scrollbar"
          : "absolute inset-0 z-[650] pointer-events-none flex items-center"
        }
        style={inline ? {} : { justifyContent: 'flex-end', paddingLeft: '276px', paddingRight: `${rightOffset}px`, paddingTop: '88px', paddingBottom: '16px' }}
        role="dialog"
        aria-label={`${copy.vibeReportTitle} — ${city.name}`}
        aria-modal={inline ? "false" : "true"}
      >
        {/* Inline: no wrapper div needed; floating: needs scroll+card container */}
        {inline ? (
          !hasRadar ? (
            <VibeReportSkeleton copy={copy} city={city} onClose={onClose} />
          ) : (
            <VibeReportContent
              city={city} comparedCity={comparedCity} onClose={onClose} onCompareStart={onCompareStart}
              onBookmark={onBookmark} isBookmarked={isBookmarked} copy={copy} vibeScore={vibeScore}
              radar1={radar1} radar2={radar2} hasRadar={hasRadar} hasCompared={hasCompared}
              sorted={sorted} topVibe={topVibe} radarColor={radarColor} confidence={confidence}
              displayLocality={displayLocality} shareToast={shareToast} handleShare={handleShare}
              showClose={false} isPickingCompare={isPickingCompare}
              canFullVibeReport={canFullVibeReport} onOpenLicenseModal={onOpenLicenseModal} locale={locale}
              canExport={canExport}
            />
          )
        ) : (
          <div className="pointer-events-auto w-full max-w-[680px] max-h-[calc(100vh-80px)] overflow-y-auto custom-scrollbar">
            <div
              className="rounded-[18px] border-[0.5px] border-[rgba(255,255,255,0.09)] backdrop-blur-[56px] overflow-hidden"
              style={{
                background: 'rgba(15,15,19,0.97)',
                boxShadow: '0 24px 72px rgba(0,0,0,0.56), 0 8px 24px rgba(0,0,0,0.30), 0 0 0 0.5px rgba(255,255,255,0.06) inset',
              }}
            >
              <VibeReportContent
                city={city} comparedCity={comparedCity} onClose={onClose} onCompareStart={onCompareStart}
                onBookmark={onBookmark} isBookmarked={isBookmarked} copy={copy} vibeScore={vibeScore}
                radar1={radar1} radar2={radar2} hasRadar={hasRadar} hasCompared={hasCompared}
                sorted={sorted} topVibe={topVibe} radarColor={radarColor} confidence={confidence}
                displayLocality={displayLocality} shareToast={shareToast} handleShare={handleShare}
                showClose canFullVibeReport={canFullVibeReport} onOpenLicenseModal={onOpenLicenseModal} locale={locale}
              />
            </div>
          </div>
        )}
      </motion.div>
      )}
    </AnimatePresence>
  );
};

// ── VibeReportSkeleton — shown while radar data is loading ────────────────────
const VibeReportSkeleton = ({ copy, city, onClose }: { copy: ReturnType<typeof getUiCopy>; city: HexResult; onClose: () => void }) => (
  <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar px-5 py-4 gap-3">
    {/* Header shimmer */}
    <div className="flex items-center justify-between">
      <div className="h-4 w-32 rounded-full animate-pulse" style={{ background: 'rgba(100,130,200,0.15)' }} />
      <button onClick={onClose} className="p-1.5 rounded-[8px]" style={{ color: 'rgba(235,235,245,0.40)' }}>
        <span aria-hidden="true" style={{ fontSize: 14 }}>×</span>
      </button>
    </div>
    <div className="h-6 w-48 rounded-full animate-pulse mt-1" style={{ background: 'rgba(100,130,200,0.12)' }} />
    <div className="h-3 w-24 rounded-full animate-pulse" style={{ background: 'rgba(100,130,200,0.10)' }} />
    {/* Score shimmer */}
    <div className="h-[72px] w-full rounded-[14px] animate-pulse mt-2" style={{ background: 'rgba(100,130,200,0.08)' }} />
    {/* Chart shimmer */}
    <div className="h-[180px] w-full rounded-[14px] animate-pulse mt-1" style={{ background: 'rgba(100,130,200,0.07)' }} />
    {/* Row shimmers */}
    {[1,2,3].map((i) => (
      <div key={i} className="h-10 w-full rounded-[10px] animate-pulse" style={{ background: 'rgba(100,130,200,0.06)', animationDelay: `${i * 80}ms` }} />
    ))}
    <p className="text-[11px] text-center mt-auto pt-2" style={{ color: 'rgba(235,235,245,0.55)' }}>
      {copy.loadingNeighborhoodData}
    </p>
  </div>
);

// ── VibeReportContent — shared content for both inline and modal modes ────────
const VibeReportContent = ({
  city, comparedCity, onClose, onCompareStart, onBookmark, isBookmarked,
  copy, vibeScore, radar1, radar2, hasRadar, hasCompared, sorted,
  topVibe, radarColor, confidence, displayLocality, shareToast, handleShare, showClose, isPickingCompare,
  canFullVibeReport = true, onOpenLicenseModal, locale = 'en', canExport = false,
}: {
  city: HexResult; comparedCity?: HexResult; onClose: () => void; onCompareStart?: () => void;
  onBookmark?: () => void; isBookmarked?: boolean; copy: ReturnType<typeof getUiCopy>; vibeScore: number;
  radar1: RadarDatum[]; radar2: RadarDatum[]; hasRadar: boolean; hasCompared: boolean; sorted: RadarDatum[];
  topVibe: RadarDatum | null; radarColor: string; confidence: number; displayLocality: string;
  shareToast: boolean; handleShare: () => void; showClose: boolean; isPickingCompare?: boolean;
  canFullVibeReport?: boolean; onOpenLicenseModal?: () => void; locale?: string; canExport?: boolean;
}) => {
  const score2 = comparedCity ? Math.round(((comparedCity.score ?? comparedCity.similarity ?? 0)) * 100) : 0;
  const topVibe2 = radar2.length > 0 ? [...radar2].sort((a, b) => b.value - a.value)[0] : null;
  const glowIntensity = vibeScore >= 90 ? '12px' : vibeScore >= 70 ? '8px' : vibeScore >= 50 ? '5px' : '0px';

  const handlePrint = () => {
    const style = document.createElement('style');
    style.id = 'eodi-print-override';
    style.textContent = `@media print {
      @page { margin: 16mm 14mm; }
      body > * { display: none !important; }
      [data-vibe-report] {
        display: block !important; position: static !important;
        width: 100% !important; max-height: none !important;
        overflow: visible !important; background: white !important;
        color: #111 !important; font-family: -apple-system, sans-serif !important;
      }
      [data-vibe-report] * {
        color-adjust: exact !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print { display: none !important; }
      /* Branding footer */
      [data-vibe-report]::after {
        content: 'Generated by eodi.me · ${new Date().toLocaleDateString()}';
        display: block !important;
        margin-top: 24px !important;
        padding-top: 10px !important;
        border-top: 0.5px solid #d1d5db !important;
        font-size: 9px !important;
        color: #9ca3af !important;
        text-align: right !important;
        letter-spacing: 0.04em !important;
      }
    }`;
    document.head.appendChild(style);
    const cleanup = () => document.getElementById('eodi-print-override')?.remove();
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    // Fallback: remove style if afterprint never fires (e.g., dialog cancelled)
    setTimeout(cleanup, 3000);
  };

  return (
  <>
    {/* Top accent line — score-color gradient */}
    <div
      className="w-full flex-shrink-0"
      data-vibe-report
      style={{
        height: '3px',
        background: `linear-gradient(90deg, ${scoreColor(vibeScore)}, ${scoreColor(vibeScore)}44)`,
        opacity: 0.90,
      }}
    />

    {/* ═══ HERO HEADER ═══════════════════════════════════════ */}
    <div
      className="relative px-5 pt-5 pb-4 flex-shrink-0"
      style={{
        background: `linear-gradient(160deg, ${scoreColor(vibeScore)}1C 0%, ${scoreColor(vibeScore)}08 55%, transparent 75%)`,
        borderBottom: '0.5px solid var(--color-border)',
      }}
    >
      {showClose && (
        <button
          onClick={onClose}
          className="absolute top-3.5 right-4 w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 z-10"
          style={{ color: 'var(--color-text-3)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.10)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-3)'; }}
          aria-label={copy.closeVibeReport}
        >
          <X size={12} />
        </button>
      )}

      <div className={`flex items-start gap-4 ${showClose ? 'pr-8' : ''}`}>
        <div className="relative flex-shrink-0" style={vibeScore > 0 ? { filter: `drop-shadow(0 0 ${glowIntensity} ${scoreColor(vibeScore)}60)` } : undefined}>
          <ScoreRing value={vibeScore} size={88} color={scoreColor(vibeScore)} />
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          <h2 className="text-[20px] font-semibold leading-[1.2] truncate tracking-[-0.026em] mb-1" style={{ color: 'var(--color-text)' }}>
            {displayLocality}
          </h2>
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[12px] tracking-[-0.008em]" style={{ color: 'var(--color-text-3)' }}>
              {[city.parent_city_name || city.city, city.country].filter(Boolean).join(' · ') || '—'}
            </span>
            {city.population && (
              <>
                <span style={{ color: 'var(--color-border-strong)' }} className="mx-0.5">·</span>
                <span className="text-[12px]" style={{ color: 'var(--color-text-3)' }}>{formatPop(city.population)}</span>
              </>
            )}
          </div>
          {/* Score grade badge — helps non-technical users interpret the number */}
          {vibeScore > 0 && (() => {
            const grade = scoreGrade(vibeScore, locale);
            const conf = dataConfidenceLabel(confidence, locale);
            return (
              <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                <span
                  className="px-2 py-[3px] rounded-full text-[10.5px] font-semibold border-[0.5px]"
                  style={{ backgroundColor: `${scoreColor(vibeScore)}18`, borderColor: `${scoreColor(vibeScore)}40`, color: scoreColor(vibeScore) }}
                >
                  {grade.emoji} {grade.label}
                </span>
                <span
                  className="px-2 py-[3px] rounded-full text-[10px] font-medium border-[0.5px]"
                  style={{ backgroundColor: `${conf.color}12`, borderColor: `${conf.color}30`, color: conf.color }}
                  title="Based on available POI data density in this area"
                >
                  {conf.label}
                </span>
              </div>
            );
          })()}
          <div className="flex items-center gap-1.5 flex-wrap">
            {sorted.slice(0, 2).filter((v) => v.value > 3).map((vibe) => (
              <span
                key={vibe.key}
                className="px-2 py-[3px] rounded-full text-[10.5px] font-medium border-[0.5px] tracking-[-0.004em]"
                style={{ backgroundColor: `${vibe.fill}18`, borderColor: `${vibe.fill}35`, color: vibe.fill }}
              >
                {vibe.icon} {vibe.axis} {vibe.value}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* ═══ VIBE PROFILE / FEATURE GATE ══════════════════════ */}
    {canFullVibeReport ? (
    <div className="px-5 pt-5 pb-4">
      <SectionLabel icon={<Layers size={11} />} text={copy.vibeProfileLabel} />
      <div className="mt-4 flex flex-col gap-5 items-start">
        {hasRadar && !hasCompared && (
          <div className="w-full flex justify-center flex-shrink-0 rounded-[12px] py-3" style={{ background: 'rgba(12,12,16,0.60)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
            <MultiColorRadar data={radar1} size={220} />
          </div>
        )}
        {hasRadar && hasCompared && (
          <div className="w-full flex gap-2 flex-shrink-0">
            <div className="flex-1 flex flex-col items-center rounded-[12px] pt-2 pb-3 gap-1 min-w-0" style={{ background: 'rgba(12,12,16,0.60)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
              <span className="text-[9.5px] font-semibold tracking-wide truncate max-w-full px-2" style={{ color: 'rgba(235,235,245,0.50)' }}>
                {formatLocalityLabel(city)}
              </span>
              <MultiColorRadar data={radar1} size={150} />
            </div>
            <div className="flex-1 flex flex-col items-center rounded-[12px] pt-2 pb-3 gap-1 min-w-0" style={{ background: 'rgba(12,12,16,0.60)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
              <span className="text-[9.5px] font-semibold tracking-wide truncate max-w-full px-2" style={{ color: 'rgba(235,235,245,0.50)' }}>
                {formatLocalityLabel(comparedCity)}
              </span>
              <MultiColorRadar data={radar2} size={150} />
            </div>
          </div>
        )}
        <div className="w-full space-y-3.5">
          {sorted.map((d) => (
            <VibeBar key={d.key} label={d.axis} icon={d.icon} value={d.value} color={d.fill}
              compared={hasCompared ? (radar2.find((r) => r.key === d.key)?.value ?? null) : null}
              description={getVibeDescription(d.key, locale)} />
          ))}
        </div>
      </div>
    </div>
    ) : (
    /* Free tier: locked vibe profile — upgrade CTA */
    <div className="px-5 pt-5 pb-5">
      <SectionLabel icon={<Layers size={11} />} text={copy.vibeProfileLabel} />
      <div className="mt-4 rounded-[14px] border-[0.5px] border-indigo-400/20 p-5 flex flex-col items-center text-center gap-4"
        style={{ background: 'rgba(12,16,28,0.85)' }}>
        {/* Blurred preview of top vibe bar */}
        {topVibe && (
          <div className="w-full relative" style={{ filter: 'blur(5px)', opacity: 0.35, pointerEvents: 'none', userSelect: 'none' }}>
            <div className="space-y-3">
              {sorted.slice(0, 3).map((d) => (
                <VibeBar key={d.key} label={d.axis} icon={d.icon} value={d.value} color={d.fill} compared={null}
                  description={getVibeDescription(d.key, locale)} />
              ))}
            </div>
          </div>
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none" style={{ position: 'relative' }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.12)', border: '0.5px solid rgba(99,102,241,0.25)' }}>
            <Lock size={18} style={{ color: 'rgba(165,180,252,0.70)' }} />
          </div>
          <div>
            <p className="text-[14px] font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.80)' }}>
              {copy.fullVibeReport}
            </p>
            <p className="text-[11.5px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.45)' }}>
              {copy.vibeReportUpgradeHint}
            </p>
          </div>
          <button
            onClick={() => onOpenLicenseModal?.()}
            className="px-4 py-2 rounded-[10px] text-[12px] font-semibold text-white transition-all pointer-events-auto"
            style={{
              background: 'linear-gradient(160deg, #6366f1 0%, #4f46e5 100%)',
              boxShadow: '0 0 0 0.5px rgba(99,102,241,0.5), 0 4px 12px rgba(99,102,241,0.30)',
            }}
          >
            {copy.upgradeToPersonal}
          </button>
        </div>
      </div>
    </div>
    )}

    {/* ═══ MARKET SIGNALS ═════════════════════════════════════ */}
    {canFullVibeReport && city.signals && (
      <>
        <div className="h-px" style={{ background: 'var(--color-border)' }} />
        <MarketSignalsPanel signals={city.signals} locale={locale} />
      </>
    )}

    {/* ═══ COMPARE SECTION ═════════════════════════════════════ */}
    {hasCompared && (
      <>
        <div className="h-px" style={{ background: 'var(--color-border)' }} />
        <div className="px-5 py-5">
          <SectionLabel icon={<GitCompare size={12} />} text={`${copy.compareVibes}: ${formatLocalityLabel(comparedCity)}`} />

          {/* Side-by-side stat table */}
          <div className="mt-3 rounded-[12px] overflow-hidden" style={{ border: '0.5px solid var(--color-border-2)', background: 'rgba(255,255,255,0.025)' }}>
            {/* Header row */}
            <div className="grid grid-cols-3 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(235,235,245,0.40)' }} />
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-center" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.compareThisLocation}</div>
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-center" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.compareOtherLocation}</div>
            </div>
            {/* Score row */}
            <div className="grid grid-cols-3 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.50)' }}>{copy.matchWord}</div>
              <div className="text-[11px] font-bold text-center tabular-nums" style={{ color: scoreColor(vibeScore) }}>{vibeScore}</div>
              <div className="text-[11px] font-bold text-center tabular-nums" style={{ color: scoreColor(score2) }}>{score2}</div>
            </div>
            {/* Top vibe row */}
            <div className="grid grid-cols-3 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="text-[10px] font-medium" style={{ color: 'rgba(235,235,245,0.50)' }}>{copy.topVibe}</div>
              <div className="text-[10px] text-center truncate" style={{ color: topVibe?.fill || 'var(--color-text-2)' }}>{topVibe ? `${topVibe.icon} ${topVibe.axis}` : '—'}</div>
              <div className="text-[10px] text-center truncate" style={{ color: topVibe2?.fill || 'var(--color-text-2)' }}>{topVibe2 ? `${topVibe2.icon} ${topVibe2.axis}` : '—'}</div>
            </div>
            {/* Dimension rows */}
            {radar1.map((d, i) => {
              const v2 = radar2.find((r) => r.key === d.key)?.value ?? 0;
              const higher = d.value > v2 ? 1 : d.value < v2 ? 2 : 0;
              return (
                <div key={d.key} className="grid grid-cols-3 px-3 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="text-[10px] flex items-center gap-1" style={{ color: d.fill, opacity: 0.85 }}>
                    <span className="text-[10px]">{d.icon}</span>
                    <span className="truncate">{d.axis}</span>
                  </div>
                  <div className="text-[10px] font-semibold text-center tabular-nums" style={{ color: higher === 1 ? d.fill : 'rgba(235,235,245,0.55)' }}>
                    {d.value}{higher === 1 && <span className="text-[8px] ml-0.5">↑</span>}
                  </div>
                  <div className="text-[10px] font-semibold text-center tabular-nums" style={{ color: higher === 2 ? d.fill : 'rgba(235,235,245,0.55)' }}>
                    {v2}{higher === 2 && <span className="text-[8px] ml-0.5">↑</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Delta bar chart */}
          <div className="mt-3 w-full h-36">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={radar1.map((d) => ({ name: d.axis, delta: d.value - (radar2.find((r) => r.key === d.key)?.value ?? 0), fill: d.fill }))} barCategoryGap="18%">
                <XAxis dataKey="name" tick={{ fill: 'rgba(235,235,245,0.55)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis hide domain={[-100, 100]} />
                <Tooltip contentStyle={{ background: 'rgba(30,30,32,0.97)', border: '0.5px solid rgba(255,255,255,0.20)', borderRadius: '10px', fontSize: '11px', color: 'rgba(255,255,255,0.90)' }} labelStyle={{ color: 'rgba(235,235,245,0.80)', fontWeight: 600 }} itemStyle={{ color: 'rgba(235,235,245,0.80)' }} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                <Bar dataKey="delta" radius={[4, 4, 4, 4]}>
                  {radar1.map((_, i) => <Cell key={i} fill={radar1[i].fill} fillOpacity={0.75} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] mt-2 text-center" style={{ color: 'rgba(235,235,245,0.40)' }}>{copy.compareDeltaHint}</p>
        </div>
      </>
    )}

    {/* ═══ ACTION BAR ════════════════════════════════════════ */}
    <div
      className="px-4 py-3 flex items-center gap-2 relative flex-shrink-0 sticky bottom-0 z-10"
      style={{
        borderTop: '0.5px solid var(--color-border)',
        background: 'rgba(14,14,18,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <ActionChip icon={<GitCompare size={12} />}
        label={hasCompared ? copy.clearCompare : isPickingCompare ? copy.cancelPickingCompare : copy.compareVibes}
        color={isPickingCompare ? '#FF9F0A' : '#3B82F6'}
        primary
        pulsing={isPickingCompare}
        onClick={() => onCompareStart?.()}
      />
      <div className="flex-1" />
      <IconBtn
        icon={<Printer size={14} />}
        title={copy.printReportBtn}
        onClick={handlePrint}
        disabled={!canExport}
        locked={!canExport}
      />
      <IconBtn icon={<Share2 size={14} />} title={copy.share} onClick={handleShare} />
      <IconBtn
        icon={isBookmarked ? <Check size={14} /> : <Bookmark size={14} />}
        title={isBookmarked ? copy.saved : copy.save}
        onClick={() => onBookmark?.()}
        active={isBookmarked}
        activeColor="#34D399"
      />
      <AnimatePresence>
        {shareToast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute -top-9 right-4 px-3 py-1.5 rounded-lg text-[10px] font-semibold" style={{ background: 'rgba(79,110,247,0.18)', border: '0.5px solid rgba(79,110,247,0.35)', color: 'var(--color-accent-light)' }}>
            {copy.copiedToClipboard}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  </>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────────

/** Animated circular score ring — clean gradient stroke, macOS style */
const ScoreRing = ({ value, size, color }: { value: number; size: number; color: string }) => {
  const strokeW = 7;
  const r = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const c = size / 2;
  const gradId = `sg-${value}`;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ overflow: 'visible' }} role="img" aria-label={`${value}%`}>
        <title>{value}% Score</title>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.65" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* Track — barely visible */}
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={strokeW} />
        {/* Progress — gradient stroke with glow */}
        <circle
          cx={c} cy={c} r={r} fill="none"
          stroke={`url(#${gradId})`} strokeWidth={strokeW}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
          style={{
            transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)',
            filter: `drop-shadow(0 0 10px ${color}80)`,
          }}
        />
      </svg>
      {/* Center content: score with % unit and small label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <div className="flex items-baseline gap-[1px]">
          <span className="text-[26px] font-black leading-none tracking-[-0.04em]" style={{ color: 'rgba(255,255,255,0.92)' }}>{value}</span>
          <span className="text-[12px] font-semibold leading-none" style={{ color: 'rgba(255,255,255,0.55)', marginBottom: '2px' }}>%</span>
        </div>
      </div>
    </div>
  );
};

/** Pill showing label + value — compact inline badge with tooltip hint */
const ScorePill = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] font-medium border-[0.5px] tracking-[-0.006em]"
    style={{ backgroundColor: `${color}14`, borderColor: `${color}2a`, color: `${color}cc` }}
  >
    {label} <span className="font-bold tabular-nums" style={{ color: value >= 60 ? color : 'rgba(255,255,255,0.75)' }}>{value}%</span>
  </span>
);

/** Section divider label — Apple HIG: small caps, letter-spaced, dim but legible */
const SectionLabel = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div className="flex items-center gap-1.5 mb-4">
    <span style={{ color: 'rgba(235,235,245,0.50)' }}>{icon}</span>
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'rgba(235,235,245,0.56)' }}>{text}</span>
  </div>
);

/** Horizontal vibe bar — Apple HIG 6px track with dimension tooltip */
const VibeBar = ({ label, icon, value, color, compared, description }: {
  label: string; icon: string; value: number; color: string; compared: number | null; description?: string;
}) => (
  <div>
    <div className="flex items-center justify-between mb-[6px]">
      <div className="relative inline-flex items-center gap-1.5 group">
        <span className="text-[12.5px] font-normal tracking-[-0.006em]" style={{ color: 'rgba(235,235,245,0.65)' }}>
          <span className="mr-1.5 opacity-60 text-[11px]">{icon}</span>{label}
        </span>
        {description && (
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
              aria-label={description}
              role="button"
              tabIndex={0}
            >i</span>
            <div
              className="absolute bottom-full left-0 z-50 mb-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
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
                {description}
              </p>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {compared !== null && (
          <span className="text-[11px]" style={{ color: 'rgba(235,235,245,0.55)' }}>{compared}%</span>
        )}
        <span className="text-[12.5px] font-semibold tabular-nums tracking-[-0.010em]" style={{ color: `${color}d8` }}>{value}%</span>
      </div>
    </div>
    {/* 6px track — Apple HIG slider spec */}
    <div className="relative w-full h-[6px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          backgroundColor: color,
          opacity: 0.90,
          boxShadow: `0 0 8px ${color}50`,
        }}
      />
      {compared !== null && (
        <div
          className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
          style={{ left: `${compared}%`, background: 'rgba(235,235,245,0.40)', transition: 'left 0.5s ease' }}
        />
      )}
    </div>
  </div>
);

/** Square icon-only button — macOS toolbar style */
const IconBtn = ({ icon, title, onClick, disabled, locked, active, activeColor }: {
  icon: React.ReactNode; title: string; onClick: () => void;
  disabled?: boolean; locked?: boolean; active?: boolean; activeColor?: string;
}) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className={`relative w-[34px] h-[34px] flex items-center justify-center rounded-[9px] transition-all duration-150 outline-none flex-shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-[0.92]'}`}
    style={active && activeColor
      ? { background: `${activeColor}18`, border: `0.5px solid ${activeColor}36`, color: activeColor }
      : { background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(235,235,245,0.65)' }
    }
    onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = active && activeColor ? `${activeColor}28` : 'rgba(255,255,255,0.11)'; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active && activeColor ? `${activeColor}18` : 'rgba(255,255,255,0.06)'; }}
  >
    {icon}
    {locked && (
      <span className="absolute -top-[5px] -right-[5px] w-[14px] h-[14px] rounded-full flex items-center justify-center" style={{ background: 'rgba(44,44,50,0.95)', border: '0.5px solid rgba(255,255,255,0.18)', color: 'rgba(235,235,245,0.50)' }}>
        <Lock size={7} />
      </span>
    )}
  </button>
);

/** Action chip — Apple HIG: compact, tinted, clear affordance */
const ActionChip = ({ icon, label, color, onClick, filled, primary, pulsing, disabled }: {
  icon: React.ReactNode; label: string; color: string; onClick: () => void; filled?: boolean; primary?: boolean; pulsing?: boolean; disabled?: boolean;
}) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`flex items-center gap-1.5 px-3 py-[7px] min-h-[34px] rounded-[9px] text-[12px] font-medium tracking-[-0.006em] transition-all duration-150 outline-none ${disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-[0.96]'} ${pulsing ? ' animate-pulse' : ''}`}
    style={primary
      ? pulsing
        ? { background: 'rgba(255,159,10,0.14)', border: '0.5px solid rgba(255,159,10,0.40)', color: '#FF9F0A' }
        : { background: disabled ? 'rgba(79,110,247,0.08)' : 'var(--color-accent-dim)', border: `0.5px solid ${disabled ? 'transparent' : 'rgba(79,110,247,0.32)'}`, color: disabled ? 'rgba(235,235,245,0.55)' : 'var(--color-accent-light)' }
      : filled
        ? { background: `${color}18`, border: `0.5px solid ${color}36`, color }
        : { background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.18)', color: disabled ? 'rgba(235,235,245,0.50)' : 'rgba(235,235,245,0.65)' }
    }
    aria-label={label}
  >
    <span className="opacity-85">{icon}</span>
    {label}
    {disabled && <Lock size={10} className="ml-1 opacity-70" />}
  </button>
);
