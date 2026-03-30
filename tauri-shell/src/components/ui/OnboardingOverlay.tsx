/**
 * OnboardingOverlay — First-time user guide, shown once (persisted in localStorage).
 * 3-step walkthrough: Search → Hexagon → Analysis
 * Accessible: focus trap, Escape key, role=dialog, aria-label
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MousePointer2, SlidersHorizontal, ChevronRight } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';

const STORAGE_KEY = 'eodi_onboarded_v1';

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch { return true; }
}

function markOnboardingDone(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
}

interface OnboardingOverlayProps {
  locale?: string;
  onDone: () => void;
}

const STEPS = [
  { icon: Search,            titleKey: 'onboardingStep1Title' as const, descKey: 'onboardingStep1Desc' as const, color: '#3B82F6' },
  { icon: MousePointer2,     titleKey: 'onboardingStep2Title' as const, descKey: 'onboardingStep2Desc' as const, color: '#8B5CF6' },
  { icon: SlidersHorizontal, titleKey: 'onboardingStep3Title' as const, descKey: 'onboardingStep3Desc' as const, color: '#10B981' },
];

export const OnboardingOverlay = ({ locale = 'en', onDone }: OnboardingOverlayProps) => {
  const copy = getUiCopy(locale);
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const containerRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const handleNext = useCallback(() => {
    if (isLast) {
      markOnboardingDone();
      onDone();
    } else {
      setStep((s) => s + 1);
    }
  }, [isLast, onDone]);

  const handleSkip = useCallback(() => {
    markOnboardingDone();
    onDone();
  }, [onDone]);

  // Focus trap + Escape key
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Focus first focusable element on mount
    nextBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleSkip(); return; }
      if (e.key !== 'Tab') return;

      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSkip]);

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={copy.onboardingTitle}
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
      onClick={handleSkip}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.96 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-[360px] rounded-[24px] overflow-hidden"
          style={{
            background: 'rgba(30,30,32,0.97)',
            border: '0.5px solid rgba(255,255,255,0.09)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,255,255,0.05) inset',
          }}
        >
          {/* Header stripe */}
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, ${current.color}60, ${current.color}20)` }}
          />

          {/* Content */}
          <div className="px-8 pt-7 pb-6">
            <p className="text-[10px] font-semibold tracking-[0.10em] uppercase mb-5" style={{ color: 'rgba(235,235,245,0.40)' }}>
              {copy.onboardingTitle}
            </p>

            <div
              className="w-12 h-12 rounded-[14px] flex items-center justify-center mb-5"
              style={{ background: `${current.color}16`, border: `0.5px solid ${current.color}30` }}
              aria-hidden="true"
            >
              <Icon size={22} style={{ color: current.color }} strokeWidth={1.8} />
            </div>

            <h2 className="text-[20px] font-bold mb-2.5 leading-tight tracking-[-0.02em]" style={{ color: 'rgba(220,230,255,0.92)' }}>
              {copy[current.titleKey]}
            </h2>

            <p className="text-[13.5px] leading-relaxed mb-7" style={{ color: 'rgba(235,235,245,0.62)' }}>
              {copy[current.descKey]}
            </p>

            {/* Progress dots */}
            <div className="flex items-center gap-1.5 mb-6" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length} aria-label={copy.onboardingStepProgress(step + 1, STEPS.length)}>
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className="h-[3px] rounded-full transition-all duration-300"
                  style={{
                    width: i === step ? '20px' : '6px',
                    background: i === step ? current.color : 'rgba(255,255,255,0.20)',
                  }}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={handleSkip}
                className="text-[12px] font-medium px-3 py-2 rounded-[10px] transition-colors"
                style={{ color: 'rgba(235,235,245,0.40)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.70)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.40)'; }}
              >
                {copy.onboardingSkip}
              </button>

              <button
                ref={nextBtnRef}
                onClick={handleNext}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-[12px] text-[13px] font-semibold text-white transition-all duration-150 active:scale-[0.97]"
                style={{
                  background: `linear-gradient(160deg, ${current.color} 0%, ${current.color}cc 100%)`,
                  boxShadow: `0 0 0 0.5px ${current.color}50, 0 4px 14px ${current.color}35`,
                }}
              >
                {isLast ? copy.onboardingDone : copy.onboardingNext}
                {!isLast && <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

