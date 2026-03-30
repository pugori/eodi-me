/**
 * useEngine — manages Tauri engine lifecycle: init, heartbeat, config, stats.
 *
 * Responsibilities:
 *  - Multi-stage initialization with exponential backoff
 *  - Heartbeat interval while engine is alive
 *  - Fetches /stats metadata on first connect
 *  - Returns engine status, config, meta, and initial hex seed for the map
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// ── Tauri IPC (graceful fallback for browser preview) ────────────────────────
// Use static imports to avoid top-level await, which can be broken by the
// production JS obfuscator (rollup-plugin-obfuscator stringArray encoding).
import { invoke as _tauriInvoke } from '@tauri-apps/api/tauri';
import { listen as _tauriListen } from '@tauri-apps/api/event';

// Detect Tauri at runtime (not module-evaluation time) to avoid false negatives
// during async module initialization.
function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && (
    '__TAURI_IPC__' in window ||
    (window as any).__TAURI_INTERNALS__ !== undefined
  );
}

const isTauri = isTauriEnv();

async function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriEnv()) return null;
  try { return await _tauriInvoke<T>(cmd, args); } catch { return null; }
}

async function listen(event: string, handler: (e: any) => void): Promise<() => void> {
  if (!isTauriEnv()) return () => {};
  try { return await _tauriListen(event, handler); } catch { return () => {}; }
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface EngineConfig {
  base_url?: string;
  token?: string;
  standalone?: boolean;
}

export interface EngineMeta {
  mode: 'engine' | 'sqlite' | null;
  cityCount: number | null;
  sigma: number | null;
  specVersion: string | null;
  totalHexagons: number | null;
  totalCities: number | null;
  builtAt: string | null;
}

export type SplashStage = 'connecting' | 'loading_engine' | 'ready';
export type EngineStatus = 'initializing' | 'ready' | 'error';

/** Commercial signal dimensions derived from the 13D vector (dims 6–12).
 *  All values are normalized 0.0–1.0. Present when the engine returns them. */
export interface HexSignals {
  poi_density?: number;        // dim 6 — POI activity level
  category_diversity?: number; // dim 7 — Shannon entropy of POI categories (competition proxy)
  temporal_entropy?: number;   // dim 9 — 24h activity pattern (all-day vs. peak)
  flow_ratio?: number;         // dim 10 — demand/supply ratio (high = market opportunity)
  pop_density?: number;        // dim 11 — population density (customer pool)
  transit_score?: number;      // dim 12 — transit accessibility
}

export interface HexResult {
  id: string;
  city_id?: string;
  name: string;
  city?: string;
  parent_city_name?: string;
  country?: string;
  lat: number;
  lng: number;
  score: number;
  match_reason?: string;
  radar?: Record<string, number>;
  population?: number;
  distance?: number;
  similarity?: number;
  admin_name?: string;
  admin_level?: number;
  h3_index?: string;
  /** Commercial market signals — available when engine returns signals object */
  signals?: HexSignals;
}

interface UseEngineReturn {
  engineStatus: EngineStatus;
  splashStage: SplashStage;
  loadProgress: number;
  indexReady: boolean;
  engineConfig: EngineConfig | null;
  engineMeta: EngineMeta;
  initialResults: HexResult[];
  updateMeta: (patch: Partial<EngineMeta>) => void;
  engineOnline: boolean;
  isReconnecting: boolean;
}

// ── Preview mode (dev only: ?preview=1 in URL) ────────────────────────────────
const IS_PREVIEW = typeof window !== 'undefined' &&
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === '1';

const PREVIEW_HEXES: HexResult[] = [
  { id: '8830e1c12bfffff', h3_index: '8830e1c12bfffff', name: 'Seongsu-dong', city: 'Seoul', parent_city_name: 'Seoul', country: 'KR', lat: 37.5444, lng: 127.0557, score: 0.97, radar: { active: 0.80, classic: 0.90, quiet: 0.75, trendy: 0.88, nature: 0.30, urban: 0.85 } },
  { id: '8830e1ca2bfffff', h3_index: '8830e1ca2bfffff', name: 'Gangnam', city: 'Seoul', parent_city_name: 'Seoul', country: 'KR', lat: 37.498, lng: 127.028, score: 0.91, radar: { active: 0.90, classic: 0.70, quiet: 0.80, trendy: 0.92, nature: 0.20, urban: 0.95 } },
  { id: '882f5a360bfffff', h3_index: '882f5a360bfffff', name: 'Shimokitazawa', city: 'Tokyo', parent_city_name: 'Tokyo', country: 'JP', lat: 35.661, lng: 139.668, score: 0.88, radar: { active: 0.85, classic: 0.95, quiet: 0.88, trendy: 0.80, nature: 0.40, urban: 0.90 } },
  { id: '881fb46625fffff', h3_index: '881fb46625fffff', name: 'Le Marais', city: 'Paris', parent_city_name: 'Paris', country: 'FR', lat: 48.857, lng: 2.352, score: 0.85, radar: { active: 0.75, classic: 0.98, quiet: 0.72, trendy: 0.95, nature: 0.35, urban: 0.88 } },
  { id: '881f18b259fffff', h3_index: '881f18b259fffff', name: 'Kreuzberg', city: 'Berlin', parent_city_name: 'Berlin', country: 'DE', lat: 52.499, lng: 13.403, score: 0.82, radar: { active: 0.97, classic: 0.88, quiet: 0.65, trendy: 0.78, nature: 0.45, urban: 0.85 } },
];

// ── Dev token (set VITE_ENGINE_TOKEN in .env.local when using the Vite proxy) ─
const DEV_ENGINE_TOKEN = import.meta.env.VITE_ENGINE_TOKEN as string | undefined;
function backoffMs(attempt: number, base = 600, cap = 8000): number {
  return Math.min(base * Math.pow(1.6, attempt), cap);
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useEngine(): UseEngineReturn {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('initializing');
  const [engineOnline, setEngineOnline] = useState<boolean>(true);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [splashStage, setSplashStage] = useState<SplashStage>('connecting');
  const [loadProgress, setLoadProgress] = useState<number>(0);
  const [indexReady, setIndexReady] = useState<boolean>(false);
  const [engineConfig, setEngineConfig] = useState<EngineConfig | null>(null);
  const [engineMeta, setEngineMeta] = useState<EngineMeta>({ mode: null, cityCount: null, sigma: null, specVersion: null, totalHexagons: null, totalCities: null, builtAt: null });
  const [initialResults, setInitialResults] = useState<HexResult[]>([]);

  const updateMeta = useCallback((patch: Partial<EngineMeta>) => {
    setEngineMeta((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let hbInterval: ReturnType<typeof setInterval> | undefined;
    const onPageHide = () => { if (hbInterval) clearInterval(hbInterval); };

    const init = async () => {
      // ── Preview bypass (dev only) ──────────────────────────────────
      if (IS_PREVIEW) {
        setSplashStage('connecting');
        await new Promise((r) => setTimeout(r, 400));
        setSplashStage('loading_engine');
        await new Promise((r) => setTimeout(r, 500));
        setSplashStage('ready');
        await new Promise((r) => setTimeout(r, 300));
        if (!cancelled) {
          setEngineConfig({ base_url: 'http://127.0.0.1:17384', standalone: true });
          setEngineMeta({ mode: 'engine', cityCount: 4_280_000, sigma: 0.42 });
          setInitialResults(PREVIEW_HEXES);
          setEngineStatus('ready');
          setIndexReady(true);
        }
        return;
      }

      if (!isTauri) {
        // ── Browser / standalone mode ──────────────────────────────
        const maxRetries = 8;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          if (cancelled) return;
          try {
            const healthRes = await fetch('/health', { signal: AbortSignal.timeout(2000) });
            if (healthRes.ok) {
              const healthData = await healthRes.json().catch(() => ({}));
              setSplashStage('loading_engine');

              let engineMode: EngineMeta['mode'] = 'sqlite';
              try {
                const engRes = await fetch('/engine/health', { signal: AbortSignal.timeout(2000) });
                if (engRes.ok) {
                  const engData = await engRes.json();
                  if (engData.engine === 'ok' && engData.mode === 'encrypted_engine') engineMode = 'engine';
                }
              } catch { /* engine not yet ready */ }

              if (engineMode !== 'engine') {
                throw new Error('Encrypted engine not ready');
              }

              setEngineConfig({ base_url: '', token: DEV_ENGINE_TOKEN, standalone: true });
              setEngineMeta({ mode: engineMode, cityCount: healthData.city_count || null, sigma: null });

              // Fetch stats (viewport hook handles hex loading now)
              try {
                const statsRes = await fetch('/stats', {
                  headers: DEV_ENGINE_TOKEN ? { Authorization: `Bearer ${DEV_ENGINE_TOKEN}` } : {},
                  signal: AbortSignal.timeout(3000),
                });
                if (statsRes.ok) {
                  const stats = await statsRes.json();
                  setEngineMeta((prev) => ({
                    ...prev,
                    cityCount: stats.total_hexagons || prev.cityCount,
                    sigma: stats.sigma_squared || prev.sigma,
                    specVersion: stats.spec_version || prev.specVersion,
                    totalHexagons: stats.total_hexagons || prev.totalHexagons,
                    totalCities: stats.total_cities || prev.totalCities,
                    builtAt: stats.built_at || prev.builtAt,
                  }));
                }
              } catch { /* stats optional */ }

              if (!cancelled) {
                setSplashStage('ready');
                await new Promise((r) => setTimeout(r, 600));
                setEngineStatus('ready');
                setIndexReady(true);

                // Heartbeat with reconnection detection
                let missedBeats = 0;
                let hbInFlight = false;
                const MISS_THRESHOLD = 3;
                hbInterval = setInterval(async () => {
                  if (hbInFlight) return; // prevent concurrent heartbeat requests
                  hbInFlight = true;
                  try {
                    await fetch('/_hb', { signal: AbortSignal.timeout(2000) });
                    missedBeats = 0;
                    setEngineOnline((prev) => {
                      if (!prev) {
                        setIsReconnecting(false);
                      }
                      return true;
                    });
                  } catch {
                    missedBeats++;
                    if (missedBeats >= MISS_THRESHOLD) {
                      setEngineOnline(false);
                      setIsReconnecting(true);
                      // Attempt reconnect
                      try {
                        const res = await fetch('/health', { signal: AbortSignal.timeout(2000) });
                        if (res.ok) {
                          missedBeats = 0;
                          setEngineOnline(true);
                          setIsReconnecting(false);
                        }
                      } catch { /* still offline */ }
                    }
                  } finally {
                    hbInFlight = false;
                  }
                }, 5000);
                window.addEventListener('pagehide', onPageHide);
              }
              return;
            }
          } catch { /* retry */ }

          setSplashStage(attempt < 3 ? 'connecting' : 'loading_engine');
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        }

        // Engine startup failed after retries
        if (!cancelled) {
          setEngineConfig(null);
          setEngineMeta({ mode: null, cityCount: null, sigma: null });
          setInitialResults([]);
          setEngineStatus('error');
        }
        return;
      }

      // ── Tauri IPC mode ──────────────────────────────────────────
      try {
        const unlistenProgress = await listen('engine-progress', (event: any) => {
          if (cancelled) return;
          const pct = event.payload as number;
          setLoadProgress(pct);
          if (pct >= 50) setSplashStage('loading_engine');
        });
        const unlistenLoaded = await listen('engine-loaded', () => {
          if (cancelled) return;
          setIndexReady(true);
          setLoadProgress(100);
        });
        const unlistenError = await listen('engine-error', () => {
          if (cancelled) return;
          setSplashStage('error' as SplashStage);
          setEngineStatus('error');
        });
        unlisten = await listen('engine-ready', (event: any) => {
          if (cancelled) return;
          unlistenProgress();
          setEngineConfig(event.payload);
          setSplashStage('ready');
          // If engine-loaded already fired (old engine), mark ready immediately
          setTimeout(() => {
            setEngineStatus('ready');
            // Poll health for index readiness fallback
            const pollHealth = async (cfg: EngineConfig) => {
              const base = cfg.base_url || '';
              const tok = cfg.token || '';
              const startMs = Date.now();
              const MAX_WAIT_MS = 60_000;
              for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                  const res = await fetch(`${base}/health`, {
                    headers: tok ? { Authorization: `Bearer ${tok}` } : {},
                    signal: AbortSignal.timeout(2000),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'ok') { setIndexReady(true); setLoadProgress(100); return; }
                    if (data.progress) {
                      setLoadProgress(data.progress as number);
                    } else {
                      // Animate progress based on time elapsed (30% → 92% over 60s)
                      const elapsed = Math.min(1, (Date.now() - startMs) / MAX_WAIT_MS);
                      setLoadProgress(Math.round(30 + elapsed * 62));
                    }
                  }
                } catch { /* retry */ }
              }
            };
            pollHealth(event.payload);
          }, 500);
          if (!cancelled) unlistenLoaded();
        });
        const config = await invoke('get_engine_config');
        if (config && !cancelled) {
          setEngineConfig(config);
          setSplashStage('ready');
          setTimeout(() => setEngineStatus('ready'), 500);
        } else {
          setSplashStage('loading_engine');
          // Fallback poll: engine-ready event may have fired before listener was ready.
          // Poll get_engine_config until it returns a config (up to 120s).
          (async () => {
            for (let i = 0; i < 240; i++) {
              await new Promise((r) => setTimeout(r, 500));
              if (cancelled) return;
              try {
                const cfg = await invoke('get_engine_config');
                if (cfg && !cancelled) {
                  setEngineConfig(cfg as EngineConfig);
                  setSplashStage('ready');
                  setTimeout(() => setEngineStatus('ready'), 500);
                  return;
                }
              } catch { /* retry */ }
            }
          })();
        }
      } catch (err: any) {
        if (!cancelled) setEngineStatus('error');
      }
    };

    init();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (hbInterval) clearInterval(hbInterval);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return { engineStatus, splashStage, loadProgress, indexReady, engineConfig, engineMeta, initialResults, updateMeta, engineOnline, isReconnecting };
}
