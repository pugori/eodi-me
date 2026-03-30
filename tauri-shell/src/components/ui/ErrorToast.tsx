/**
 * ErrorToast — friendly error display with technical-to-user message mapping.
 * Maps common network/engine errors to actionable messages.
 */
import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';

interface ErrorToastProps {
  message: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
  locale?: string;
}

/** Map technical error patterns to user-friendly messages. */
function friendlyMessage(raw: string, copy: ReturnType<typeof getUiCopy>): { text: string; canRetry: boolean } {
  const m = raw.toLowerCase();

  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network error') || m.includes('err_connection_refused')) {
    if (navigator.onLine) {
      return { text: copy.errorEngine, canRetry: true };
    }
    return { text: copy.errorNetwork, canRetry: true };
  }
  if (m.includes('timeout') || m.includes('aborted') || m.includes('abort')) {
    return { text: copy.errorTimeout, canRetry: true };
  }
  if (m.includes('pro_required') || m.includes('pro required') || m.includes('403')) {
    return { text: copy.errorProRequired, canRetry: false };
  }
  if (m.includes('401') || m.includes('unauthorized')) {
    return { text: copy.errorAuth, canRetry: false };
  }
  if (m.includes('500') || m.includes('internal server')) {
    return { text: copy.errorServer, canRetry: true };
  }
  if (m.includes('no matching') || m.includes('not found') || m.includes('404')) {
    return { text: copy.errorNotFound, canRetry: false };
  }

  // Fallback: show original but cap length
  const truncated = raw.length > 100 ? raw.slice(0, 100) + '…' : raw;
  return { text: truncated, canRetry: true };
}

export const ErrorToast = ({ message, onDismiss, onRetry, locale = 'en' }: ErrorToastProps) => {
  const copy = getUiCopy(locale);
  const { text, canRetry } = useMemo(
    () => (message ? friendlyMessage(message, copy) : { text: '', canRetry: false }),
    [message, copy],
  );

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ y: 60, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 60, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[calc(100%-2rem)]"
        >
          <div
            className="p-4 rounded-[18px] flex items-start gap-3"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{
              background: 'rgba(28,28,30,0.96)',
              border: '0.5px solid rgba(248,113,113,0.22)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(248,113,113,0.08) inset',
              backdropFilter: 'blur(32px)',
            }}
          >
            <div className="p-1.5 rounded-[8px] mt-0.5 flex-shrink-0" style={{ background: 'rgba(248,113,113,0.14)', border: '0.5px solid rgba(248,113,113,0.20)' }}>
              <AlertTriangle style={{ color: 'var(--color-red)' }} size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-red)' }}>{copy.errorTitle}</p>
              <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'rgba(235,235,245,0.55)' }}>{text}</p>
              {canRetry && onRetry && (
                <button
                  onClick={() => { onRetry(); onDismiss(); }}
                  className="mt-2 flex items-center gap-1 text-[11px] font-medium transition-colors"
                  style={{ color: 'rgba(255,255,255,0.65)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(140,180,255,0.90)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.65)'; }}
                >
                  <RefreshCw size={10} />
                  {copy.retry}
                </button>
              )}
            </div>
            <button
              onClick={onDismiss}
              className="p-2 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-[8px] transition-all duration-150 outline-none active:scale-90"
              style={{ color: 'rgba(235,235,245,0.40)', background: 'transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.10)'; (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.70)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(235,235,245,0.40)'; }}
              aria-label={copy.errorDismiss}
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

