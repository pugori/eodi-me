/**
 * useUpdater — checks for app updates via Tauri's built-in updater.
 *
 * Only fires when `tauri.conf.json → tauri.updater.active = true` and
 * valid pubkey + endpoints are configured. In development / pre-cert builds
 * this hook is a no-op (silently catches all errors).
 *
 * Usage:
 *   const { updateAvailable, version, install } = useUpdater();
 *   if (updateAvailable) show <UpdateBanner version={version} onInstall={install} />
 */
import { useCallback, useEffect, useState } from 'react';

interface UpdaterState {
  updateAvailable: boolean;
  version: string | null;
  releaseNotes: string | null;
  installing: boolean;
  error: string | null;
}

export interface UseUpdaterReturn extends UpdaterState {
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdaterState>({
    updateAvailable: false,
    version: null,
    releaseNotes: null,
    installing: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        // Dynamic import — Tauri APIs are not available in plain web/test environments
        const { checkUpdate } = await import('@tauri-apps/api/updater');
        const result = await checkUpdate();
        if (cancelled) return;
        if (result.shouldUpdate) {
          setState((s) => ({
            ...s,
            updateAvailable: true,
            version: result.manifest?.version ?? null,
            releaseNotes: result.manifest?.body ?? null,
          }));
        }
      } catch {
        // Silently ignore: updater disabled, no network, cert missing, etc.
      }
    };

    // Small delay to avoid slowing down initial render
    const timer = setTimeout(check, 8000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const install = useCallback(async () => {
    setState((s) => ({ ...s, installing: true, error: null }));
    try {
      const { installUpdate } = await import('@tauri-apps/api/updater');
      await installUpdate();
      // installUpdate() will quit and relaunch — code below only runs on error
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Update installation failed';
      setState((s) => ({ ...s, installing: false, error: msg }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, updateAvailable: false }));
  }, []);

  return { ...state, install, dismiss };
}
