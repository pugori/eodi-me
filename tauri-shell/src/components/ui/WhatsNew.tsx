/**
 * WhatsNew — first-launch welcome / feature announcement modal.
 * Shown once after install; dismissed state stored in localStorage.
 * Contains NO server calls — fully offline.
 */
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';

// Version-stamped key: bump when new major features are added so returning
// users see the modal again. Reads from Vite's package.json version shim.
const APP_VERSION = (import.meta as { env: Record<string, string> }).env?.VITE_APP_VERSION
  ?? (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1');
const STORAGE_KEY = `eodi_whats_new_${APP_VERSION.replace(/\./g, '_')}`;

export function hasSeenWhatsNew(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markWhatsNewSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch { /* noop */ }
}

interface Props {
  locale?: string;
  onClose: () => void;
}

export function WhatsNew({ locale = 'en', onClose }: Props) {
  const copy = getUiCopy(locale);
  const [dontShow, setDontShow] = useState(false);

  const handleClose = useCallback(() => {
    if (dontShow) markWhatsNewSeen();
    onClose();
  }, [dontShow, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const tierRows: Array<{ label: string; color: string; lines: string[] }> = [
    {
      label: copy.whatsNewFreeLabel,
      color: 'rgba(235,235,245,0.55)',
      lines: [copy.whatsNewFreeLine1, copy.whatsNewFreeLine2],
    },
    {
      label: copy.whatsNewPersonalLabel,
      color: 'var(--color-accent-light)',
      lines: [copy.whatsNewPersonalLine1, copy.whatsNewPersonalLine2],
    },
    {
      label: copy.whatsNewSoloBizLabel,
      color: '#34d399',
      lines: [copy.whatsNewSoloBizLine1],
    },
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[2100] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <motion.div
          className="relative w-[360px] max-w-[92vw] rounded-[20px] shadow-2xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '0.5px solid var(--color-border-strong)' }}
          initial={{ scale: 0.93, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        >
          {/* Header gradient strip */}
          <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg,#3b82f6,#a78bfa,#34d399)' }} />

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3.5 right-3.5 w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all"
            style={{ color: 'var(--color-text-3)', background: 'transparent' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.10)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <X size={12} />
          </button>

          <div className="px-6 pt-5 pb-4">
            {/* Title */}
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={15} style={{ color: 'var(--color-accent-light)' }} />
              <h2 className="text-[15px] font-semibold tracking-[-0.022em]" style={{ color: 'var(--color-text)' }}>
                {copy.whatsNewTitle}
              </h2>
            </div>
            <p className="text-[11px] leading-[1.55] mb-5" style={{ color: 'var(--color-text-3)' }}>
              {copy.whatsNewTagline}
            </p>

            {/* Tier feature rows */}
            <div className="space-y-3">
              {tierRows.map((tier) => (
                <div
                  key={tier.label}
                  className="rounded-[12px] p-3"
                  style={{ background: 'var(--color-surface-2)', border: '0.5px solid var(--color-border-2)' }}
                >
                  <p className="text-[10.5px] font-semibold mb-1.5 tracking-[0.03em]" style={{ color: tier.color }}>
                    {tier.label.toUpperCase()}
                  </p>
                  {tier.lines.map((line) => (
                    <p key={line} className="text-[11px] leading-[1.5]" style={{ color: 'rgba(235,235,245,0.75)' }}>
                      {line}
                    </p>
                  ))}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={handleClose}
                className="w-full py-2.5 rounded-[11px] text-[12.5px] font-semibold transition-all"
                style={{ background: 'var(--color-accent-dim)', border: '0.5px solid rgba(79,110,247,0.40)', color: 'var(--color-accent-light)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(79,110,247,0.18)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent-dim)'; }}
              >
                {copy.whatsNewClose}
              </button>
              <label className="flex items-center gap-2 justify-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontShow}
                  onChange={e => setDontShow(e.target.checked)}
                  className="accent-blue-400 w-3 h-3"
                />
                <span className="text-[10.5px]" style={{ color: 'var(--color-text-3)' }}>
                  {copy.whatsNewDontShow}
                </span>
              </label>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
