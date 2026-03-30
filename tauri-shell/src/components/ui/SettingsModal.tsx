import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { getVersion } from '@tauri-apps/api/app';
import { X, Trash2, ExternalLink, Mail, ChevronDown, HelpCircle, Zap, Key, ClipboardCopy, Check, Eye, EyeOff, RefreshCw, Code2, Lock } from 'lucide-react';
import { getUiCopy, ALL_LOCALES, LOCALE_LABELS } from '../../i18n/ui';
import type { UiLocale } from '../../i18n/ui';
import type { UseLicenseReturn } from '../../hooks/useLicense';
import { PLAN_INFO } from '../../hooks/useLicense';

/** Format ISO 8601 date string → locale-aware short date */
function formatBuiltAt(isoStr: string, locale?: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr.length > 10 ? isoStr : isoStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return isoStr;
  const loc = locale === 'ko' ? 'ko-KR' : 'en-US';
  return d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetData: () => void | Promise<void>;
  locale?: string;
  onLocaleChange?: (locale: UiLocale) => void;
  engineMeta?: { 
    spec_version: string;
    total_hexagons: number;
    total_cities: number;
    built_at: string;
  };
  license?: UseLicenseReturn;
  onManageLicense?: () => void;
}

const SUPPORT_EMAIL = 'support@eodi.me';

export const SettingsModal = ({ isOpen, onClose, onResetData, engineMeta, locale = 'en', onLocaleChange, license, onManageLicense }: SettingsModalProps) => {
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const [appVersion, setAppVersion] = useState('1.0.0');

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {/* fallback to default */});
  }, []);
  const legalLinks = useMemo(() => ([
    { label: copy.privacy, url: 'https://eodi.me/privacy' },
    { label: copy.terms, url: 'https://eodi.me/terms' },
    { label: 'FAQ', url: 'https://eodi.me/#faq' },
  ]), [copy.privacy, copy.terms]);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);
  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
  }, []);

  // Local API state
  const canApi = license?.tierLimits?.canApiAccess ?? false;
  const [apiInfo, setApiInfo] = useState<{ port: number; session_token: string; api_key: string; base_url: string; session_file: string; api_key_file: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSessionToken, setShowSessionToken] = useState(false);
  const [apiCopied, setApiCopied] = useState<string | null>(null);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenDone, setRegenDone] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !canApi) return;
    invoke<{ port: number; session_token: string; api_key: string; base_url: string; session_file: string; api_key_file: string } | null>('get_local_api_info')
      .then(setApiInfo)
      .catch(() => {/* engine may not be running yet */});
  }, [isOpen, canApi]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setApiCopied(key);
      safeTimeout(() => setApiCopied(null), 2500);
    }).catch((err) => { console.warn('[clipboard]', err?.message ?? err); });
  };

  const handleRegenerate = async () => {
    setRegenError(null);
    try {
      const newKey = await invoke<string>('regenerate_local_api_key');
      setApiInfo(prev => prev ? { ...prev, api_key: newKey } : prev);
      setRegenConfirm(false);
      setRegenDone(true);
      safeTimeout(() => setRegenDone(false), 4000);
    } catch (err) {
      console.error('[regen]', err);
      setRegenConfirm(false);
      setRegenError(copy.regenFailed);
      safeTimeout(() => setRegenError(null), 5000);
    }
  };

  const copyDiagnostic = () => {
    const lines = [
      copy.diagnosticReportTitle,
      '─────────────────────────',
      `${copy.appVersion}: v${appVersion}`,
      `${copy.engineSpec}: ${engineMeta?.spec_version ?? copy.unknown}`,
      `${copy.databaseStats}: ${engineMeta?.total_hexagons?.toLocaleString() ?? 0} ${copy.hexagons} · ${engineMeta?.total_cities?.toLocaleString() ?? 0} ${copy.cities}`,
      `${copy.builtAt}: ${engineMeta?.built_at ? formatBuiltAt(engineMeta.built_at, locale) : copy.unknown}`,
      `Plan: ${license?.status?.plan ?? 'free'}`,
      `Platform: ${navigator.platform}`,
      `Time: ${new Date().toISOString()}`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setDiagCopied(true);
      safeTimeout(() => setDiagCopied(false), 2500);
    }).catch((err) => { console.warn('[clipboard]', err?.message ?? err); });
  };

  // Focus trap: auto-focus close button and trap focus within modal
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Focus the modal container (not close button) to avoid showing a visible focus ring on the button
    requestAnimationFrame(() => modalRef.current?.focus());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // Trap focus within the modal
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const openExternal = useCallback((url: string) => {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { /* invalid URL — ignore */ }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center backdrop-blur-sm animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.60)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={copy.settingsAndAbout}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-[440px] rounded-[22px] overflow-hidden flex flex-col max-h-[88vh] animate-scale-in"
        style={{
          background: 'rgba(28,28,30,0.97)',
          border: '0.5px solid rgba(255,255,255,0.14)',
          boxShadow: '0 40px 120px rgba(0,0,0,0.85), 0 0 0 0.5px rgba(255,255,255,0.06) inset',
          backdropFilter: 'blur(64px) saturate(180%)',
          outline: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4" style={{ borderBottom: '0.5px solid var(--color-border)' }}>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]" style={{ color: 'var(--color-text)' }}>
            {copy.settingsAndAbout}
          </h2>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="w-[28px] h-[28px] flex items-center justify-center rounded-full transition-all duration-150 active:scale-90"
            style={{ color: 'var(--color-text-3)', background: 'rgba(255,255,255,0.06)', border: '0.5px solid var(--color-border-2)', outline: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-3)'; }}
            aria-label="Close settings"
          >
            <X size={13} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">

          {/* Subscription / License */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2.5" style={{ color: 'rgba(235,235,245,0.38)' }}>
              {copy.subscriptionLabel}
            </h3>
            <div className="rounded-[14px] overflow-hidden" style={{ border: '0.5px solid var(--color-border-2)', background: 'rgba(255,255,255,0.03)' }}>
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div>
                  {(() => {
                    const plan = license?.status?.plan ?? 'free';
                    const info = PLAN_INFO[plan];
                    return (
                      <>
                        <div className="text-[13px] font-semibold tracking-[-0.01em] flex items-center gap-2">
                          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: license?.isPremium ? info.color : 'rgba(255,255,255,0.25)', boxShadow: license?.isPremium ? `0 0 6px ${info.color}99` : 'none' }} />
                          <span style={{ color: info.color }}>eodi.me {info.label}</span>
                        </div>
                        {license?.status?.license_key_hint && (
                          <div className="text-[11px] text-white/30 font-mono mt-0.5 tracking-wider">
                            {license.status.license_key_hint}
                          </div>
                        )}
                        {license?.isPremium && license.status?.expires_label && (
                          <div className="text-[11px] text-white/30 mt-0.5">
                            {copy.renewsExpires}: {license.status.expires_label}
                          </div>
                        )}
                        {(() => {
                          const planDescMap: Record<string, string> = {
                            free: copy.freePlanDesc,
                            personal: copy.personalPlanDesc,
                            solo_biz: copy.soloBizPlanDesc,
                            business: copy.businessPlanDesc,
                            enterprise: copy.enterprisePlanDesc,
                          };
                          const desc = planDescMap[plan] ?? copy.freePlanDesc;
                          return (
                            <div className="text-[11px] mt-0.5" style={{ color: 'rgba(235,235,245,0.55)' }}>
                              {desc}
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>
                <button
                  onClick={onManageLicense}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-semibold transition-all duration-150 active:scale-95"
                  style={{ background: 'var(--color-accent-dim)', border: '0.5px solid rgba(79,110,247,0.28)', color: 'var(--color-accent-light)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(79,110,247,0.22)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent-dim)'; }}
                >
                  {license?.isPremium ? <Key size={11} /> : <Zap size={11} />}
                  {license?.isPremium ? copy.manageLabel : copy.upgrade}
                </button>
              </div>
            </div>
          </section>

          {/* Language */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2.5" style={{ color: 'rgba(235,235,245,0.38)' }}>
              Language
            </h3>
            <div className="grid grid-cols-4 gap-1.5">
              {ALL_LOCALES.map(l => (
                <button
                  key={l}
                  onClick={() => onLocaleChange?.(l)}
                  className="px-2 py-2 rounded-[10px] text-[11px] font-medium transition-all duration-150 active:scale-95"
                  style={{
                    background: locale === l ? 'rgba(79,110,247,0.18)' : 'rgba(255,255,255,0.04)',
                    border: `0.5px solid ${locale === l ? 'rgba(79,110,247,0.40)' : 'rgba(255,255,255,0.10)'}`,
                    color: locale === l ? 'rgba(147,197,253,0.95)' : 'rgba(235,235,245,0.50)',
                  }}
                >
                  {LOCALE_LABELS[l]}
                </button>
              ))}
            </div>
          </section>
          
          {/* Version Info */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'rgba(235,235,245,0.38)' }}>{copy.systemInformation}</h3>
              <button
                onClick={copyDiagnostic}
                className="flex items-center gap-1 px-2 py-1 rounded-[7px] text-[10px] font-semibold transition-all duration-150 active:scale-95"
                style={{ background: diagCopied ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)', border: `0.5px solid ${diagCopied ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.14)'}`, color: diagCopied ? 'rgba(52,211,153,0.80)' : 'rgba(235,235,245,0.45)' }}
                title={copy.copyDiagnosticBtn}
              >
                {diagCopied ? <Check size={10} /> : <ClipboardCopy size={10} />}
                {diagCopied ? copy.copyDiagnosticDone : copy.copyDiagnosticBtn}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-3)' }}>{copy.appVersion}</div>
                <div className="text-[13px] font-mono font-semibold" style={{ color: 'var(--color-text)' }}>v{appVersion}</div>
              </div>
              <div className="p-3 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-3)' }}>{copy.engineSpec}</div>
                <div className="text-[13px] font-mono font-semibold" style={{ color: engineMeta ? 'rgba(52,211,153,0.90)' : 'rgba(251,191,36,0.90)' }}>{engineMeta?.spec_version || copy.engineOffline}</div>
              </div>
              <div className="p-3 rounded-[12px] col-span-2" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                <div className="text-[10px] mb-1.5" style={{ color: 'var(--color-text-3)' }}>{copy.databaseStats}</div>
                <div className="text-[12px] font-medium flex justify-between" style={{ color: 'var(--color-text)' }}>
                  <span>{engineMeta?.total_hexagons?.toLocaleString() ?? 0} {copy.hexagons}</span>
                  <span style={{ color: 'var(--color-text-3)' }}>·</span>
                  <span>{engineMeta?.total_cities?.toLocaleString() ?? 0} {copy.cities}</span>
                </div>
                <div className="text-[10px] mt-1 font-mono" style={{ color: 'rgba(235,235,245,0.55)' }}>
                  {copy.builtAt}: {engineMeta?.built_at ? formatBuiltAt(engineMeta.built_at, locale) : copy.unknown}
                </div>
              </div>
            </div>
          </section>

          {/* Data Management */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2.5" style={{ color: 'rgba(235,235,245,0.38)' }}>
              {copy.dataManagement}
            </h3>
            <div className="p-4 rounded-[14px] space-y-3" style={{ border: '0.5px solid rgba(255,59,48,0.20)', background: 'rgba(255,59,48,0.04)' }}>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,59,48,0.10)', border: '0.5px solid rgba(255,59,48,0.20)', color: '#FF3B30' }}>
                  <Trash2 size={14} />
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>{copy.resetUserData}</h4>
                  <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(235,235,245,0.40)' }}>
                    {copy.resetUserDataDesc}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="w-full py-2 px-4 rounded-[10px] text-[12px] font-semibold transition-all duration-150 flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{ background: 'rgba(255,59,48,0.08)', border: '0.5px solid rgba(255,59,48,0.20)', color: '#FF3B30' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,59,48,0.15)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,59,48,0.08)'; }}
              >
                {copy.clearAllLocalData}
              </button>
              {showResetConfirm && (
                <div className="mt-2 p-3 rounded-[10px]" style={{ background: 'rgba(255,59,48,0.07)', border: '0.5px solid rgba(255,59,48,0.22)' }}>
                  <p className="text-[11px] mb-2.5 leading-relaxed" style={{ color: 'rgba(255,150,150,0.75)' }}>{copy.resetConfirm}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => { setShowResetConfirm(false); await onResetData?.(); onClose(); }}
                      className="flex-1 py-1.5 rounded-[8px] text-[11.5px] font-semibold transition-colors"
                      style={{ background: 'rgba(255,59,48,0.20)', border: '0.5px solid rgba(255,59,48,0.30)', color: '#FF3B30' }}
                    >
                      {copy.clearAllLocalData}
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="flex-1 py-1.5 rounded-[8px] text-[11.5px] font-medium transition-colors"
                      style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border)', color: 'rgba(235,235,245,0.55)' }}
                    >
                      {copy.cancelLabel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Local API */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] mb-2.5" style={{ color: 'rgba(235,235,245,0.38)' }}>
              {copy.localApiTitle}
            </h3>
            {!canApi ? (
              <div className="p-4 rounded-[14px] flex items-start gap-3" style={{ border: '0.5px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)' }}>
                <Lock size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'rgba(235,235,245,0.40)' }} />
                <div>
                  <p className="text-[12px] font-medium mb-0.5" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.localApiTitle}</p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.localApiUpgradeHint}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11px]" style={{ color: 'rgba(235,235,245,0.45)' }}>{copy.localApiDesc}</p>
                {!apiInfo ? (
                  <div className="text-[11px] px-1" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.engineNotRunning}</div>
                ) : (
                  <div className="space-y-2">
                    {/* Endpoint */}
                    <div className="p-3 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px]" style={{ color: 'var(--color-text-3)' }}>{copy.localApiEndpoint}</span>
                        <button onClick={() => copyToClipboard(apiInfo.base_url, 'endpoint')} className="flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[10px] transition-colors" style={{ color: apiCopied === 'endpoint' ? 'rgba(52,211,153,0.80)' : 'rgba(235,235,245,0.45)', background: apiCopied === 'endpoint' ? 'rgba(52,211,153,0.10)' : 'transparent' }}>
                          {apiCopied === 'endpoint' ? <Check size={9} /> : <ClipboardCopy size={9} />}
                          {apiCopied === 'endpoint' ? copy.localApiCopied : ''}
                        </button>
                      </div>
                      <div className="text-[12px] font-mono" style={{ color: 'var(--color-text)' }}>{apiInfo.base_url}</div>
                    </div>

                    {/* Persistent API Key */}
                    <div className="p-3 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px]" style={{ color: 'var(--color-text-3)' }}>{copy.localApiPersistentKey}</span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setShowApiKey(v => !v)} className="flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[10px]" style={{ color: 'rgba(235,235,245,0.45)' }}>
                            {showApiKey ? <EyeOff size={9} /> : <Eye size={9} />}
                            {showApiKey ? copy.localApiHide : copy.localApiShow}
                          </button>
                          <button onClick={() => copyToClipboard(apiInfo.api_key, 'apikey')} className="flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[10px] transition-colors" style={{ color: apiCopied === 'apikey' ? 'rgba(52,211,153,0.80)' : 'rgba(235,235,245,0.45)', background: apiCopied === 'apikey' ? 'rgba(52,211,153,0.10)' : 'transparent' }}>
                            {apiCopied === 'apikey' ? <Check size={9} /> : <ClipboardCopy size={9} />}
                            {apiCopied === 'apikey' ? copy.localApiCopied : ''}
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono break-all" style={{ color: 'var(--color-text)' }}>
                        {showApiKey ? apiInfo.api_key : '••••••••••••••••••••••••••••••••'}
                      </div>
                      <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.localApiKeyNote}</p>
                    </div>

                    {/* Session Token */}
                    <div className="p-3 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px]" style={{ color: 'var(--color-text-3)' }}>{copy.localApiSessionToken}</span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setShowSessionToken(v => !v)} className="flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[10px]" style={{ color: 'rgba(235,235,245,0.45)' }}>
                            {showSessionToken ? <EyeOff size={9} /> : <Eye size={9} />}
                            {showSessionToken ? copy.localApiHide : copy.localApiShow}
                          </button>
                          <button onClick={() => copyToClipboard(apiInfo.session_token, 'session')} className="flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[10px] transition-colors" style={{ color: apiCopied === 'session' ? 'rgba(52,211,153,0.80)' : 'rgba(235,235,245,0.45)', background: apiCopied === 'session' ? 'rgba(52,211,153,0.10)' : 'transparent' }}>
                            {apiCopied === 'session' ? <Check size={9} /> : <ClipboardCopy size={9} />}
                            {apiCopied === 'session' ? copy.localApiCopied : ''}
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono break-all" style={{ color: 'var(--color-text)' }}>
                        {showSessionToken ? apiInfo.session_token : '••••••••••••••••••••••••••••••••'}
                      </div>
                    </div>

                    {/* Endpoints quick reference */}
                    <div className="p-3 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--color-border)' }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Code2 size={11} style={{ color: 'var(--color-accent)' }} />
                        <span className="text-[10px] font-semibold" style={{ color: 'rgba(235,235,245,0.55)' }}>{copy.localApiDocsTitle}</span>
                      </div>
                      <div className="space-y-1 text-[10px] font-mono" style={{ color: 'rgba(235,235,245,0.55)' }}>
                        {[
                          ['GET', '/search?q=seongsu'],
                          ['GET', '/hex/{h3index}'],
                          ['GET', '/hex/match?h3={h3}'],
                          ['GET', '/stats'],
                          ['GET', '/countries'],
                          ['GET', '/cities?country=KR'],
                        ].map(([method, path]) => (
                          <div key={path} className="flex gap-2">
                            <span style={{ color: method === 'GET' ? '#34d399' : '#f59e0b', minWidth: 36 }}>{method}</span>
                            <span>{path}</span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => copyToClipboard(`import requests\n\nbase = "${apiInfo.base_url}"\nheaders = {"Authorization": "Bearer ${showApiKey ? apiInfo.api_key : '<PERSISTENT_API_KEY>'}"}\n\n# Search neighborhoods\nresults = requests.get(f"{base}/search", params={"q": "seongsu"}, headers=headers).json()\nfor r in results[:3]:\n    print(r["name"], r["city"])`, 'example')}
                        className="mt-2.5 flex items-center gap-1 text-[10px] transition-colors"
                        style={{ color: apiCopied === 'example' ? 'rgba(52,211,153,0.70)' : 'rgba(255,255,255,0.50)' }}
                      >
                        {apiCopied === 'example' ? <Check size={9} /> : <ClipboardCopy size={9} />}
                        {apiCopied === 'example' ? copy.localApiCopied : copy.copyPythonExample}
                      </button>
                    </div>

                    {/* Regenerate key */}
                    {!regenConfirm ? (
                      <button
                        onClick={() => setRegenConfirm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-medium transition-colors"
                        style={{ background: 'rgba(245,158,11,0.07)', border: '0.5px solid rgba(245,158,11,0.22)', color: 'rgba(245,158,11,0.70)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.13)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.07)'; }}
                      >
                        <RefreshCw size={10} />
                        {copy.localApiRegenerate}
                      </button>
                    ) : (
                      <div className="p-3 rounded-[10px] space-y-2" style={{ background: 'rgba(245,158,11,0.07)', border: '0.5px solid rgba(245,158,11,0.22)' }}>
                        <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(245,158,11,0.75)' }}>{copy.localApiRegenerateConfirm}</p>
                        <div className="flex gap-2">
                          <button onClick={handleRegenerate} className="flex-1 py-1.5 rounded-[8px] text-[11px] font-semibold" style={{ background: 'rgba(245,158,11,0.18)', border: '0.5px solid rgba(245,158,11,0.30)', color: 'rgba(245,158,11,0.90)' }}>
                            {copy.localApiRegenerate}
                          </button>
                          <button onClick={() => setRegenConfirm(false)} className="flex-1 py-1.5 rounded-[8px] text-[11px]" style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border)', color: 'rgba(235,235,245,0.55)' }}>
                            {copy.cancelLabel}
                          </button>
                        </div>
                      </div>
                    )}
                    {regenDone && (
                      <p className="text-[11px] px-1" style={{ color: 'rgba(52,211,153,0.70)' }}>{copy.localApiRestartNote}</p>
                    )}
                    {regenError && (
                      <p className="text-[11px] px-1 mt-1" style={{ color: 'rgba(248,113,113,0.75)' }}>{regenError}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* FAQ */}
          <section style={{ borderTop: '0.5px solid var(--color-border)' }} className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <HelpCircle size={13} style={{ color: 'var(--color-accent)' }} />
              <h3 className="text-[11.5px] font-semibold" style={{ color: 'rgba(235,235,245,0.65)' }}>{copy.faqTitle}</h3>
            </div>
            <div className="flex flex-col gap-1">
              {([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => {
                const q = copy[`faq${n}q` as keyof typeof copy] as string;
                const a = copy[`faq${n}a` as keyof typeof copy] as string;
                const isOpen = openFaq === n;
                return (
                  <div key={n} style={{ border: '0.5px solid rgba(100,130,200,0.12)', borderRadius: '10px', background: isOpen ? 'rgba(255,255,255,0.05)' : 'transparent', transition: 'background 0.15s' }}>
                    <button
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left gap-2"
                      onClick={() => setOpenFaq(isOpen ? null : n)}
                    >
                      <span className="text-[11.5px] font-medium" style={{ color: 'rgba(235,235,245,0.75)' }}>{q}</span>
                      <ChevronDown size={12} style={{ color: 'rgba(100,130,200,0.50)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
                    </button>
                    {isOpen && (
                      <p className="px-3 pb-2.5 text-[11px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.55)' }}>{a}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Credits */}
          <section className="text-center pt-3" style={{ borderTop: '0.5px solid var(--color-border)' }}>
            <p className="text-[11px] mb-2" style={{ color: 'rgba(235,235,245,0.50)' }}>
              City Vibe Engine © 2026 EODI.ME
            </p>
            <div className="flex justify-center items-center gap-2 text-[10px] flex-wrap" style={{ color: 'rgba(235,235,245,0.55)' }}>
              {legalLinks.map((item) => (
                <button
                  key={item.label}
                  onClick={() => openExternal(item.url)}
                  className="inline-flex items-center gap-1 px-1 transition-colors"
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.60)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.55)'; }}
                >
                  {item.label}
                  <ExternalLink size={9} />
                </button>
              ))}
              <span>·</span>
              <button
                onClick={() => (window.location.href = `mailto:${SUPPORT_EMAIL}`)}
                className="inline-flex items-center gap-1 px-1 transition-colors"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.60)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.55)'; }}
              >
                {copy.support}
                <Mail size={10} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
