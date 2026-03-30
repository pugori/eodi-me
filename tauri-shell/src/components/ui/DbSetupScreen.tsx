import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

// GitHub repository where DB assets are published as Release assets.
// Update REPO before publishing to your actual org/repo.
const GITHUB_REPO = 'eodi-me/app';
const BASE_URL = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

interface DbFile {
  filename: string;
  label: string;
  labelKo: string;
  sizeMb: number; // approximate display size
}

const DB_FILES: DbFile[] = [
  { filename: 'hexagons.edbh',      label: 'Neighborhood Map Data',  labelKo: '동네 분석 데이터',    sizeMb: 161 },
  { filename: 'hexagons.edbh.adm',  label: 'City Boundary Data',     labelKo: '도시 경계 데이터',    sizeMb:  34 },
  { filename: 'cities.edb',         label: 'City Directory',          labelKo: '도시 목록',           sizeMb:   5 },
];

interface ProgressEvent {
  file: string;
  pct: number;
  bytes_done: number;
  bytes_total: number;
}

interface FileState {
  status: 'pending' | 'downloading' | 'done' | 'error';
  pct: number;
  error?: string;
}

interface Props {
  locale?: string;
  onComplete: () => void;
}

const isKo = (locale: string) => /^ko\b/i.test(locale);

export const DbSetupScreen: React.FC<Props> = ({ locale = 'en', onComplete }) => {
  const ko = isKo(locale);
  const [fileStates, setFileStates] = useState<Record<string, FileState>>(() =>
    Object.fromEntries(DB_FILES.map(f => [f.filename, { status: 'pending', pct: 0 }]))
  );
  const [hasError, setHasError] = useState(false);
  const [allDone, setAllDone] = useState(false);

  // Listen to download progress events emitted by the Tauri backend
  useEffect(() => {
    const unlisten = listen<ProgressEvent>('db-download-progress', ({ payload }) => {
      setFileStates(prev => ({
        ...prev,
        [payload.file]: {
          status: payload.pct >= 100 ? 'done' : 'downloading',
          pct: payload.pct,
        },
      }));
    });
    return () => { unlisten.then(u => u()); };
  }, []);

  const startDownload = useCallback(async () => {
    setHasError(false);
    for (const dbFile of DB_FILES) {
      setFileStates(prev => ({ ...prev, [dbFile.filename]: { status: 'downloading', pct: 0 } }));
      try {
        await invoke('download_db_file', {
          url: `${BASE_URL}/${dbFile.filename}`,
          filename: dbFile.filename,
          expectedSha256: null,
        });
        setFileStates(prev => ({ ...prev, [dbFile.filename]: { status: 'done', pct: 100 } }));
      } catch (err) {
        setFileStates(prev => ({
          ...prev,
          [dbFile.filename]: { status: 'error', pct: 0, error: String(err) },
        }));
        setHasError(true);
        return;
      }
    }
    setAllDone(true);
  }, []);

  // Auto-start download on mount
  useEffect(() => {
    startDownload();
  }, []);

  // Auto-proceed 1.5 seconds after all downloads complete
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(onComplete, 1500);
    return () => clearTimeout(t);
  }, [allDone, onComplete]);

  const totalBytes = DB_FILES.reduce((s, f) => s + f.sizeMb, 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(160deg, #0e0e0e 0%, #141416 100%)',
      color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 32,
    }}>
      {/* Logo */}
      <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-1px', marginBottom: 8 }}>
        eodi<span style={{ color: '#7c5cfc' }}>.me</span>
      </div>

      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 40, textAlign: 'center', maxWidth: 420 }}>
        {ko
          ? `처음 한 번만 데이터를 다운로드합니다. (~${totalBytes} MB, 약 1–3분 소요)`
          : `Downloading data for the first time. This only happens once. (~${totalBytes} MB)`}
      </div>

      {/* File list */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 12, padding: '20px 24px',
        border: '1px solid rgba(255,255,255,0.08)',
        marginBottom: 28,
      }}>
        {DB_FILES.map(dbFile => {
          const st = fileStates[dbFile.filename];
          return (
            <div key={dbFile.filename} style={{ marginBottom: 18 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 13, marginBottom: 6,
              }}>
                <span style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {ko ? dbFile.labelKo : dbFile.label}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
                  {st.status === 'done'
                    ? (ko ? '완료 ✓' : 'Done ✓')
                    : st.status === 'error'
                    ? (ko ? '오류' : 'Error')
                    : st.status === 'downloading'
                    ? `${st.pct}%`
                    : `~${dbFile.sizeMb} MB`}
                </span>
              </div>
              {/* Progress bar */}
              <div style={{
                height: 4, borderRadius: 2,
                background: 'rgba(255,255,255,0.1)', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${st.status === 'done' ? 100 : st.pct}%`,
                  borderRadius: 2,
                  background: st.status === 'error'
                    ? '#ff6b6b'
                    : st.status === 'done'
                    ? '#6bcb77'
                    : 'linear-gradient(90deg, #7c5cfc, #a78bfa)',
                  transition: 'width 0.3s ease',
                }} />
              </div>
              {st.error && (
                <div style={{ fontSize: 11, color: '#ff6b6b', marginTop: 4 }}>
                  {ko
                    ? '다운로드 실패 — 인터넷 연결을 확인하고 다시 시도해 주세요'
                    : 'Download failed — please check your internet connection and retry'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show retry button only on error; otherwise auto-proceeds */}
      {hasError && (
        <button
          onClick={startDownload}
          style={{
            padding: '12px 40px', borderRadius: 8, border: 'none',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: 'linear-gradient(135deg, #7c5cfc, #a78bfa)',
            color: '#fff',
          }}
        >
          {ko ? '다시 시도' : 'Retry'}
        </button>
      )}

      {allDone && (
        <div style={{ fontSize: 13, color: '#6bcb77', fontWeight: 500 }}>
          {ko ? '완료! 잠시 후 시작합니다…' : 'All done! Launching…'}
        </div>
      )}

      <div style={{ marginTop: 24, fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
        {ko
          ? '데이터는 로컬 기기에만 저장됩니다. 네트워크 데이터는 수집되지 않습니다.'
          : 'Data is stored locally on your device only. No usage data is collected.'}
      </div>
    </div>
  );
};
