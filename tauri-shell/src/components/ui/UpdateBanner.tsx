import React from 'react';
import { ArrowUpCircle, X, Loader2 } from 'lucide-react';
import { getUiCopy } from '../../i18n/ui';

interface UpdateBannerProps {
  version: string | null;
  installing: boolean;
  onInstall: () => void;
  onDismiss: () => void;
  locale?: string;
}

export const UpdateBanner = React.memo(function UpdateBanner({
  version,
  installing,
  onInstall,
  onDismiss,
  locale = 'en',
}: UpdateBannerProps) {
  const copy = React.useMemo(() => getUiCopy(locale), [locale]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1500]
                 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl
                 bg-[rgba(20,22,30,0.95)] border border-white/10 backdrop-blur-xl
                 text-sm text-white max-w-sm w-full"
    >
      <ArrowUpCircle size={18} className="text-[var(--color-accent-light)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium leading-tight">{copy.updateAvailable}</p>
        {version && (
          <p className="text-white/50 text-xs mt-0.5 truncate">{copy.updateVersion(version)}</p>
        )}
      </div>
      <button
        onClick={onInstall}
        disabled={installing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                   bg-[var(--color-accent-light)] text-black hover:opacity-90 transition-opacity
                   disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        aria-label={copy.updateInstall}
      >
        {installing ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {copy.updateInstalling}
          </>
        ) : (
          copy.updateInstall
        )}
      </button>
      {!installing && (
        <button
          onClick={onDismiss}
          className="p-1 rounded-md hover:bg-white/10 transition-colors shrink-0"
          aria-label={copy.updateDismiss}
        >
          <X size={14} className="text-white/50" />
        </button>
      )}
    </div>
  );
});
