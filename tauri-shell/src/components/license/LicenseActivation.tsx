/**
 * LicenseActivation — subscription plan selection and license key activation.
 *
 * Shows all 5 pricing tiers with features, pricing, and purchase links.
 * Active plan is highlighted. License key input for activation below.
 *
 * External links use Tauri shell.open() to avoid sandboxing issues.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Check, ExternalLink, Zap, AlertTriangle, X } from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/api/shell';
import type { UseLicenseReturn } from '../../hooks/useLicense';
import { PLAN_INFO, PLAN_BUY_LINKS, type Plan } from '../../hooks/useLicense';
import { getUiCopy } from '../../i18n/ui';

interface LicenseActivationProps {
  license: UseLicenseReturn;
  onClose: () => void;
  locale?: string;
}

const PLAN_FEATURES_EN: Record<Plan, string[]> = {
  free:       ['Basic search & map view', 'Top vibe category', 'Location details', 'Unlimited browsing'],
  personal:   ['Full vibe report & radar', 'Similarity matching', 'Preference discovery', 'Bookmark locations'],
  solo_biz:   ['Everything in Personal', 'Custom POI input', 'Similar location finder', 'Export results'],
  business:   ['Everything in Solo Biz', 'Batch analysis', 'Bring Your Own Data (BYOD)', 'Self-hosted Docker deploy'],
  enterprise: ['Everything in Business', 'Full REST API access', 'Custom data schema', 'Unlimited batch'],
};

const PLAN_FEATURES_KO: Record<Plan, string[]> = {
  free:       ['기본 검색 및 지도 보기', '주요 바이브 카테고리', '지역 상세 정보', '무제한 둘러보기'],
  personal:   ['전체 바이브 리포트 · 레이더', '유사 지역 매칭', '선호 탐색', '즐겨찾기 저장'],
  solo_biz:   ['Personal 전체 포함', 'POI 커스텀 입력', '유사 지역 찾기', '결과 내보내기'],
  business:   ['Solo Biz 전체 포함', '배치 분석', 'BYOD 데이터 연결', '자체 호스팅 Docker 배포'],
  enterprise: ['Business 전체 포함', '전체 REST API 접근', '커스텀 데이터 스키마', '무제한 배치'],
};

function getPlanFeatures(locale?: string): Record<Plan, string[]> {
  return /^ko\b/i.test(locale || '') ? PLAN_FEATURES_KO : PLAN_FEATURES_EN;
}

const PLANS: Plan[] = ['free', 'personal', 'solo_biz', 'business', 'enterprise'];

/** Open an external URL via Tauri shell; fall back to window.open in browser mode */
async function openExternal(url: string) {
  try {
    await shellOpen(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Inline confirmation prompt rendered inside the card */
function DeactivateConfirm({ onConfirm, onCancel, busy, copy }: { onConfirm: () => void; onCancel: () => void; busy: boolean; copy: ReturnType<typeof getUiCopy> }) {
  return (
    <div
      className="mt-2 rounded-[10px] p-3 flex items-start gap-2.5 animate-fade-in"
      style={{ background: 'rgba(248,113,113,0.07)', border: '0.5px solid rgba(248,113,113,0.22)' }}
    >
      <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-red)' }} />
      <div className="flex-1">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--color-red)' }}>{copy.deactivateTitle}</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'rgba(248,113,113,0.65)' }}>
          {copy.deactivateDesc}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={onConfirm}
            disabled={busy}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-[7px] transition-all disabled:opacity-50"
            style={{ background: 'rgba(248,113,113,0.18)', color: 'var(--color-red)', border: '0.5px solid rgba(248,113,113,0.3)' }}
          >
            {busy ? copy.deactivatingLabel : copy.yesDeactivate}
          </button>
          <button
            onClick={onCancel}
            className="text-[10px] px-2.5 py-1 rounded-[7px] transition-all"
            style={{ color: 'var(--color-text-3)', border: '0.5px solid var(--color-border-2)' }}
          >
            {copy.cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LicenseActivation({ license, onClose, locale }: LicenseActivationProps) {
  const copy = useMemo(() => getUiCopy(locale), [locale]);
  const planFeatures = useMemo(() => getPlanFeatures(locale), [locale]);
  const { status, activating, error, isPremium, activate, deactivate, clearError } = license;
  const currentPlan = status?.plan ?? 'free';
  const [key, setKey] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual' | 'lifetime'>('annual');

  // Auto-clear success message after 4 seconds
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleActivate = useCallback(async () => {
    if (!key.trim() || key.trim().length < 10) return;
    clearError();
    setSuccessMsg(null);
    try {
      await activate(key.trim());
      setSuccessMsg(copy.activatedSuccess);
      setKey('');
      setShowKeyInput(false);
    } catch { /* error set by hook */ }
  }, [key, activate, clearError]);

  const handleDeactivate = useCallback(async () => {
    setDeactivating(true);
    try {
      await deactivate();
      setSuccessMsg(copy.deactivatedSuccess);
      setShowDeactivateConfirm(false);
    } catch { /* error set by hook */ }
    finally { setDeactivating(false); }
  }, [deactivate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter') handleActivate();
  }, [onClose, handleActivate]);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(4,8,16,0.80)', backdropFilter: 'blur(24px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full mx-4 rounded-[22px] overflow-hidden flex flex-col animate-fade-in"
        style={{
          maxWidth: 700,
          maxHeight: '90vh',
          background: 'var(--color-surface)',
          border: '0.5px solid var(--color-border-2)',
          boxShadow: 'var(--shadow-3)',
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0"
          style={{ borderBottom: '0.5px solid var(--color-border)' }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--color-text)' }}>
              {copy.choosePlan}
            </h2>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-text-3)' }}>
              {copy.currentPlanLabel}:{' '}
              <span style={{ color: PLAN_INFO[currentPlan].color, fontWeight: 600 }}>
                {PLAN_INFO[currentPlan].label}
              </span>
              {isPremium && status?.expires_label && status.expires_label !== '—' && (
                <span className="ml-2">· {copy.renewsLabel} {status.expires_label}</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={copy.closeVibeReport}
            className="w-[28px] h-[28px] flex items-center justify-center rounded-full transition-all duration-150"
            style={{ color: 'var(--color-text-3)', background: 'rgba(255,255,255,0.06)', border: '0.5px solid var(--color-border-2)' }}
            onMouseEnter={e => { (e.currentTarget).style.background = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={e => { (e.currentTarget).style.background = 'rgba(255,255,255,0.06)'; }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Billing cycle toggle */}
        <div className="flex items-center justify-center gap-1.5 px-5 pt-3 pb-1 flex-shrink-0">
          <button
            onClick={() => setBillingCycle('monthly')}
            className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-all duration-150"
            style={{
              background: billingCycle === 'monthly' ? 'rgba(255,255,255,0.14)' : 'transparent',
              color: billingCycle === 'monthly' ? 'var(--color-text)' : 'var(--color-text-3)',
              border: `0.5px solid ${billingCycle === 'monthly' ? 'rgba(255,255,255,0.35)' : 'transparent'}`,
            }}
          >
            {copy.billingMonthly}
          </button>
          <button
            onClick={() => setBillingCycle('annual')}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full transition-all duration-150"
            style={{
              background: billingCycle === 'annual' ? 'rgba(52,211,153,0.12)' : 'transparent',
              color: billingCycle === 'annual' ? '#34d399' : 'var(--color-text-3)',
              border: `0.5px solid ${billingCycle === 'annual' ? 'rgba(52,211,153,0.35)' : 'transparent'}`,
            }}
          >
            {copy.billingAnnual}
            <span
              className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded-full"
              style={{ background: 'rgba(52,211,153,0.18)', color: '#34d399' }}
            >
              {copy.billingSaveLabel(30)}
            </span>
          </button>
          <button
            onClick={() => setBillingCycle('lifetime')}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full transition-all duration-150"
            style={{
              background: billingCycle === 'lifetime' ? 'rgba(168,85,247,0.12)' : 'transparent',
              color: billingCycle === 'lifetime' ? '#a855f7' : 'var(--color-text-3)',
              border: `0.5px solid ${billingCycle === 'lifetime' ? 'rgba(168,85,247,0.35)' : 'transparent'}`,
            }}
          >
            Lifetime
            <span
              className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded-full"
              style={{ background: 'rgba(168,85,247,0.18)', color: '#a855f7' }}
            >
              Once
            </span>
          </button>
        </div>

        {/* Plan cards */}
        <div className="overflow-y-auto custom-scrollbar p-5 space-y-2 flex-1">
          {PLANS.map((plan) => {
            const info = PLAN_INFO[plan];
            const features = planFeatures[plan];
            const isCurrent = plan === currentPlan;
            const buyLinkEntry = PLAN_BUY_LINKS[plan];
            const buyLink = typeof buyLinkEntry === 'object'
              ? (billingCycle === 'annual' ? buyLinkEntry.yearly : billingCycle === 'lifetime' ? buyLinkEntry.lifetime : buyLinkEntry.monthly)
              : buyLinkEntry;
            const planIdx = PLANS.indexOf(plan);
            const currentIdx = PLANS.indexOf(currentPlan);
            const isUpgrade = planIdx > currentIdx;
            const isDowngrade = planIdx < currentIdx;

            return (
              <div
                key={plan}
                className="rounded-[14px] p-4 transition-all duration-200"
                style={{
                  background: isCurrent
                    ? `linear-gradient(135deg, ${info.color}16 0%, ${info.color}08 100%)`
                    : info.highlight && !isDowngrade
                      ? `linear-gradient(135deg, ${info.color}1e 0%, ${info.color}0c 100%)`
                      : 'rgba(255,255,255,0.025)',
                  border: `${info.highlight && !isCurrent ? '1px' : '0.5px'} solid ${isCurrent ? info.color + '55' : info.highlight ? info.color + '60' : 'var(--color-border-2)'}`,
                  opacity: isDowngrade && !isCurrent ? 0.55 : 1,
                  boxShadow: isCurrent
                    ? `0 0 20px ${info.color}20, 0 2px 8px ${info.color}12`
                    : info.highlight && !isDowngrade
                      ? `0 0 36px ${info.color}40, 0 8px 24px ${info.color}22, inset 0 2px 0 ${info.color}80`
                      : 'none',
                  transform: !isCurrent && info.highlight && !isDowngrade ? 'translateY(-4px)' : 'none',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Plan name + badges + price */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                      <span className="text-[13px] font-bold" style={{ color: info.color }}>
                        {info.label}
                      </span>
                      {info.highlight && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                          style={{
                            background: `${info.color}30`,
                            color: info.color,
                            border: `0.5px solid ${info.color}66`,
                            boxShadow: `0 0 10px ${info.color}35`,
                          }}
                        >
                          {copy.mostPopularLabel}
                        </span>
                      )}
                      {isCurrent && (
                        <span
                          className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-[2px] rounded-full"
                          style={{ background: 'rgba(255,255,255,0.12)', color: 'var(--color-text-2)' }}
                        >
                          {copy.activeLabel}
                        </span>
                      )}
                      <div className="ml-auto flex items-baseline gap-1">
                        <span className="text-[15px] font-bold" style={{ color: 'var(--color-text)' }}>
                          {billingCycle === 'annual' && plan !== 'free' ? info.yearlyPrice : billingCycle === 'lifetime' && plan !== 'free' ? info.lifetimePrice : info.monthlyPrice}
                        </span>
                        {plan !== 'free' && (
                          <span className="text-[10px]" style={{ color: 'var(--color-text-3)' }}>
                            {billingCycle === 'annual' ? `/${copy.billingAnnualNote}` : billingCycle === 'lifetime' ? '/forever' : copy.billingPerMonth}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Features grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {features.map((f) => (
                        <div key={f} className="flex items-center gap-1.5 py-[1px]">
                          <Check size={9} style={{ color: info.color, flexShrink: 0 }} />
                          <span className="text-[10.5px]" style={{ color: 'var(--color-text-2)' }}>{f}</span>
                        </div>
                      ))}
                    </div>

                    {/* Deactivate confirmation — inline in the active card */}
                    {isCurrent && isPremium && showDeactivateConfirm && (
                      <DeactivateConfirm
                        onConfirm={handleDeactivate}
                        onCancel={() => setShowDeactivateConfirm(false)}
                        busy={deactivating}
                        copy={copy}
                      />
                    )}
                  </div>

                  {/* CTA buttons */}
                  <div className="flex-shrink-0 flex flex-col gap-1.5 items-end">
                    {isCurrent && isPremium && !showDeactivateConfirm && (
                      <button
                        onClick={() => setShowDeactivateConfirm(true)}
                        className="text-[10px] px-2.5 py-1.5 rounded-[8px] transition-all duration-150"
                        style={{ border: '0.5px solid rgba(248,113,113,0.22)', color: 'rgba(248,113,113,0.7)', background: 'transparent' }}
                        onMouseEnter={e => { (e.currentTarget).style.background = 'rgba(248,113,113,0.07)'; }}
                        onMouseLeave={e => { (e.currentTarget).style.background = 'transparent'; }}
                      >
                        {copy.deactivateLabel}
                      </button>
                    )}
                    {plan !== 'free' && !isCurrent && buyLink && (
                      <button
                        onClick={() => openExternal(buyLink)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-[8px] transition-all duration-150 active:scale-[0.97]"
                        style={
                          isUpgrade && info.highlight
                            ? {
                                background: info.color,
                                border: `none`,
                                color: '#fff',
                                boxShadow: `0 2px 12px ${info.color}55`,
                              }
                            : {
                                background: isUpgrade ? `${info.color}20` : 'rgba(255,255,255,0.05)',
                                border: `0.5px solid ${isUpgrade ? info.color + '55' : 'var(--color-border-2)'}`,
                                color: isUpgrade ? info.color : 'var(--color-text-3)',
                                boxShadow: isUpgrade ? `0 2px 8px ${info.color}20` : 'none',
                              }
                        }
                        onMouseEnter={e => {
                          if (isUpgrade && info.highlight) {
                            (e.currentTarget).style.filter = 'brightness(1.12)';
                          } else {
                            (e.currentTarget).style.background = `${info.color}30`;
                            (e.currentTarget).style.boxShadow = `0 2px 12px ${info.color}28`;
                          }
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget).style.filter = '';
                          if (!(isUpgrade && info.highlight)) {
                            (e.currentTarget).style.background = isUpgrade ? `${info.color}20` : 'rgba(255,255,255,0.05)';
                            (e.currentTarget).style.boxShadow = isUpgrade ? `0 2px 8px ${info.color}20` : 'none';
                          }
                        }}
                      >
                        {isUpgrade && <Zap size={9} />}
                        {isUpgrade ? copy.upgradeLabel : copy.switchLabel}
                        <ExternalLink size={9} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Success message */}
          {successMsg && (
            <div
              className="rounded-[10px] px-4 py-2.5 text-[12px] flex items-center gap-2"
              style={{ background: 'rgba(52,211,153,0.09)', border: '0.5px solid rgba(52,211,153,0.22)', color: 'var(--color-green)' }}
            >
              <Check size={12} />
              {successMsg}
            </div>
          )}
          {error && (
            <div
              className="rounded-[10px] px-4 py-3 text-[12px] space-y-1.5"
              style={{ background: 'rgba(248,113,113,0.09)', border: '0.5px solid rgba(248,113,113,0.22)', color: 'var(--color-red)' }}
            >
              <div className="font-semibold">{error}</div>
              <div className="text-[10px] leading-relaxed" style={{ color: 'rgba(248,113,113,0.75)' }}>
                {/invalid|not found|wrong/i.test(error)
                  ? 'Double-check the key from your email. Keys are case-insensitive and usually look like EODI-XXXX-XXXX-XXXX.'
                  : /network|connect|offline/i.test(error)
                  ? 'Check your internet connection and try again. The app works offline after activation.'
                  : /already.*used|already.*active|another device/i.test(error)
                  ? 'This key is active on another device. Deactivate it there first, then try again.'
                  : 'If this keeps happening, email hello@eodi.me with your order number.'}
              </div>
            </div>
          )}

          {/* License key activation section */}
          <div className="pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button
              onClick={() => { setShowKeyInput((v) => !v); clearError(); }}
              className="mt-3 text-[11px] transition-colors flex items-center gap-1"
              style={{ color: 'var(--color-text-3)' }}
              onMouseEnter={e => { (e.currentTarget).style.color = 'var(--color-text-2)'; }}
              onMouseLeave={e => { (e.currentTarget).style.color = 'var(--color-text-3)'; }}
            >
              {showKeyInput ? copy.hideLicenseKey : copy.showLicenseKey}
            </button>

            {showKeyInput && (
              <div className="mt-2.5 space-y-2">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase().slice(0, 128))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleActivate(); }}
                  placeholder="EODI-XXXX-XXXX-XXXX"
                  aria-label="License key"
                  maxLength={128}
                  inputMode="text"
                  className="w-full rounded-[9px] px-3 py-2 font-mono text-[13px] outline-none transition-all duration-150"
                  style={{
                    background: 'var(--color-surface-3)',
                    border: '0.5px solid var(--color-border-2)',
                    color: 'var(--color-text)',
                    caretColor: 'var(--color-accent)',
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border-focus)';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,110,247,0.10)';
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'var(--color-border-2)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
                <button
                  onClick={handleActivate}
                  disabled={activating || key.trim().length < 10}
                  className="w-full rounded-[9px] py-2 text-[13px] font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', color: '#fff', boxShadow: '0 2px 8px rgba(79,110,247,0.28)' }}
                >
                  {activating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      {copy.activatingLabel}
                    </span>
                  ) : copy.activateLicenseBtn}
                </button>
                <p className="text-[10px] text-center" style={{ color: 'var(--color-text-3)' }}>
                  {copy.licenseKeyEmailHint}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

