/**
 * HelpModal — Keyboard shortcuts & quick tips overlay.
 * Opened via `?` key (when not typing), F1, or the ? button in the sidebar header.
 * Accessible: Escape to close, focus trap, role=dialog.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Keyboard, Lightbulb, X } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';

interface HelpModalProps {
  locale?: string;
  onClose: () => void;
}

/** A single keyboard shortcut row */
function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[7px]"
      style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
      <span className="text-[12px]" style={{ color: 'rgba(235,235,245,0.65)' }}>{description}</span>
      <div className="flex items-center gap-1 flex-shrink-0">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-[10px]" style={{ color: 'rgba(235,235,245,0.35)' }}>/</span>}
            <kbd
              className="px-[7px] py-[2px] rounded-[5px] text-[11px] font-mono font-semibold leading-tight"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '0.5px solid rgba(255,255,255,0.15)',
                color: 'rgba(235,235,245,0.85)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              {k}
            </kbd>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export function HelpModal({ locale = 'en', onClose }: HelpModalProps) {
  const copy = getUiCopy(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => onClose(), [onClose]);

  // Focus trap + Escape key
  useEffect(() => {
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return; }
      if (e.key !== 'Tab') return;

      const el = containerRef.current;
      if (!el) return;
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { keys: [`${mod}+K`], desc: copy.shortcutFocusSearch },
    { keys: ['↑', '↓'], desc: copy.shortcutNavigate },
    { keys: ['Enter'], desc: copy.shortcutSelect },
    { keys: ['Esc'], desc: copy.shortcutClose },
    { keys: ['?', 'F1'], desc: copy.shortcutHelp },
  ];

  const tips = [
    copy.tipClickHex,
    copy.tipAnalysis,
    copy.tipCompare,
    copy.tipSettings,
  ];

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={copy.helpTitle}
      className="fixed inset-0 z-[900] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }} />

      {/* Card */}
      <motion.div
        ref={containerRef}
        className="relative w-full max-w-[420px] rounded-[16px] overflow-hidden flex flex-col"
        style={{
          background: 'rgba(28,28,30,0.92)',
          backdropFilter: 'blur(50px) saturate(180%)',
          border: '0.5px solid rgba(255,255,255,0.12)',
          boxShadow: '0 32px 64px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.06) inset',
          maxHeight: '85vh',
        }}
        initial={{ scale: 0.94, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 8 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center gap-2">
            <Keyboard size={15} style={{ color: 'var(--color-accent)' }} />
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>
              {copy.helpTitle}
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            onClick={handleClose}
            aria-label="Close"
            className="w-[28px] h-[28px] rounded-[7px] flex items-center justify-center transition-all duration-150"
            style={{ color: 'rgba(235,235,245,0.45)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.80)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.45)'; }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto overscroll-contain px-5 py-4 flex flex-col gap-5">

          {/* Keyboard shortcuts */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Keyboard size={12} style={{ color: 'rgba(235,235,245,0.40)' }} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: 'rgba(235,235,245,0.40)' }}>
                {copy.shortcutsSection}
              </h3>
            </div>
            <div className="flex flex-col">
              {shortcuts.map((s, i) => (
                <ShortcutRow key={i} keys={s.keys} description={s.desc} />
              ))}
            </div>
          </section>

          {/* Quick tips */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={12} style={{ color: 'rgba(235,235,245,0.40)' }} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: 'rgba(235,235,245,0.40)' }}>
                {copy.quickTipsSection}
              </h3>
            </div>
            <ul className="flex flex-col gap-2">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-[3px] flex-shrink-0 w-[5px] h-[5px] rounded-full"
                    style={{ background: 'var(--color-accent)', marginTop: 5 }} />
                  <span className="text-[12px] leading-relaxed" style={{ color: 'rgba(235,235,245,0.60)' }}>
                    {tip}
                  </span>
                </li>
              ))}
            </ul>
          </section>

        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 text-center"
          style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
          <span className="text-[10.5px]" style={{ color: 'rgba(235,235,245,0.30)' }}>
            Press <kbd className="px-[5px] py-[1px] rounded-[4px] text-[10px] font-mono"
              style={{ background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.12)' }}>Esc</kbd> to close
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
