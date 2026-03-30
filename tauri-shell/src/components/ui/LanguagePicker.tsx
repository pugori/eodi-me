import React, { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { ALL_LOCALES, LOCALE_LABELS, LOCALE_SHORT } from '../../i18n/ui';
import type { UiLocale } from '../../i18n/ui';

interface Props {
  locale: UiLocale;
  onChange: (l: UiLocale) => void;
}

export function LanguagePicker({ locale, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Change language"
        aria-label="Change language"
        className="flex items-center gap-[3px] h-[30px] px-1.5 rounded-[8px] transition-all duration-150 text-[var(--color-text-3)] hover:text-[var(--color-text-2)] hover:bg-[rgba(255,255,255,0.06)]"
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: open ? 'rgba(235,235,245,0.85)' : 'rgba(235,235,245,0.45)',
          background: open ? 'rgba(255,255,255,0.08)' : undefined,
        }}
      >
        <Globe size={12} />
        <span>{LOCALE_SHORT[locale]}</span>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-[9999] rounded-[12px] overflow-hidden"
          style={{
            background: 'rgba(28,28,30,0.96)',
            backdropFilter: 'blur(30px)',
            border: '0.5px solid rgba(255,255,255,0.12)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.60)',
            minWidth: 160,
          }}
        >
          <div className="py-1">
            {ALL_LOCALES.map(l => (
              <button
                key={l}
                onClick={() => { onChange(l); setOpen(false); }}
                className="w-full flex items-center justify-between px-3 py-2 transition-colors duration-100"
                style={{
                  background: locale === l ? 'rgba(79,110,247,0.15)' : 'transparent',
                  color: locale === l ? 'rgba(147,197,253,0.95)' : 'rgba(235,235,245,0.72)',
                  fontSize: 13,
                  fontWeight: locale === l ? 600 : 400,
                }}
              >
                <span>{LOCALE_LABELS[l]}</span>
                {locale === l && (
                  <span style={{ fontSize: 10, color: 'rgba(147,197,253,0.7)' }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
