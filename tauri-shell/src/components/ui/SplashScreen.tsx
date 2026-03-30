import React, { useState } from 'react';
import { getUiCopy } from '../../i18n/ui';

// Version injected at build time via vite.config.js define.__APP_VERSION__
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.0';

interface SplashScreenProps {
  stage: 'connecting' | 'loading_engine' | 'ready' | string;
  loadProgress?: number;
  error?: string | null;
  locale?: string;
}

interface ErrorDiagnosis {
  cause: string;
  steps: string[];
}

function diagnoseError(error: string, locale: string): ErrorDiagnosis {
  const e = error.toLowerCase();
  const isKo = /^ko\b/i.test(locale);

  if (e.includes('connection refused') || e.includes('err_connection') || e.includes('econnrefused')) {
    return isKo
      ? { cause: '엔진 프로세스가 시작되지 않았습니다', steps: ['앱을 완전히 종료 후 다시 실행', '바이러스 백신이 eodi-engine을 차단하는지 확인', '앱을 재설치해도 해결되지 않으면 아래 정보를 복사해 문의'] }
      : { cause: 'Engine process did not start', steps: ['Close completely and reopen eodi.me', 'Check if antivirus is blocking eodi-engine — add exception if needed', 'If reinstalling doesn\'t help, copy the info below and contact support'] };
  }
  if (e.includes('timeout') || e.includes('timed out') || e.includes('aborted')) {
    return isKo
      ? { cause: '엔진 로딩이 너무 오래 걸립니다', steps: ['여유 RAM이 2GB 이상인지 확인', '다른 무거운 프로그램을 닫고 재시도', '앱을 재시작해도 반복되면 진단 정보를 복사해 문의'] }
      : { cause: 'Engine is taking too long to load', steps: ['Ensure at least 2 GB of free RAM is available', 'Close other heavy programs and retry', 'If it keeps happening, copy info below and contact support'] };
  }
  if (e.includes('database') || e.includes('.edbh') || e.includes('not found') || e.includes('no such file')) {
    return isKo
      ? { cause: '데이터베이스 파일을 찾을 수 없습니다', steps: ['시작 메뉴에서 데이터 다운로드를 다시 실행', '디스크 여유 공간이 4GB 이상인지 확인', '문제가 계속되면 진단 정보를 복사해 문의'] }
      : { cause: 'Database file not found', steps: ['Re-run data setup from the start menu', 'Ensure at least 4 GB of free disk space', 'If it persists, copy info below and contact support'] };
  }
  if (e.includes('port') || e.includes('eaddrinuse') || e.includes('address already in use')) {
    return isKo
      ? { cause: '포트가 이미 다른 프로세스에서 사용 중입니다', steps: ['작업 관리자에서 eodi 프로세스가 여러 개 실행 중인지 확인', '기존 프로세스를 종료 후 앱을 다시 시작'] }
      : { cause: 'Port is already in use by another process', steps: ['Check Task Manager for multiple eodi processes running', 'End the old process, then restart the app'] };
  }
  return isKo
    ? { cause: '예기치 않은 오류가 발생했습니다', steps: ['앱을 완전히 종료 후 다시 시작', '해결되지 않으면 아래 진단 정보를 복사해 문의'] }
    : { cause: 'An unexpected error occurred', steps: ['Close completely and restart eodi.me', 'If it persists, copy the diagnostic info below and contact support'] };
}

export const SplashScreen = ({ stage, loadProgress = 0, error, locale = 'en' }: SplashScreenProps) => {
  const copy = getUiCopy(locale);
  const [diagCopied, setDiagCopied] = useState(false);
  // Pseudo-progress: slowly nudge the bar forward when loadProgress stalls,
  // so the UI never feels frozen. Caps at 92% so the real 100% still "lands".
  const [pseudoProgress, setPseudoProgress] = useState(loadProgress);
  React.useEffect(() => {
    if (stage === 'ready' || error) { setPseudoProgress(stage === 'ready' ? 100 : pseudoProgress); return; }
    if (loadProgress > pseudoProgress) { setPseudoProgress(loadProgress); return; }
    if (pseudoProgress >= 92) return;
    const id = setTimeout(() => setPseudoProgress(p => Math.min(92, p + 0.4)), 600);
    return () => clearTimeout(id);
  }, [loadProgress, pseudoProgress, stage, error]); // eslint-disable-line react-hooks/exhaustive-deps

  const STAGES = [
    { key: 'connecting',     label: copy.splashConnecting },
    { key: 'loading_engine', label: copy.splashLoadingDb },
    { key: 'ready',          label: copy.splashReady },
  ];
  const stageIdx = STAGES.findIndex((s) => s.key === stage);
  const progress = stage === 'ready' ? 100
    : stage === 'loading_engine' && pseudoProgress > 0 ? Math.max(35, Math.min(95, pseudoProgress))
    : stageIdx >= 0 ? ((stageIdx + 1) / STAGES.length) * 90 : 10;

  const stageLabelText = STAGES[Math.max(0, stageIdx)]?.label ?? copy.splashConnecting;
  const statusText = stage === 'loading_engine' && pseudoProgress > 0
    ? `${Math.round(pseudoProgress)}%`
    : stage === 'ready' ? '100%' : '';

  return (
    <div
      className="h-screen w-full flex flex-col items-center justify-center text-white relative overflow-hidden select-none"
      style={{ background: '#0e0e0e' }}
      role="status"
      aria-label={copy.splashAria}
    >
      {/* ── Multi-layer ambient glows ─────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 70% 50% at 50% -10%, rgba(79,110,247,0.18) 0%, transparent 70%)',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 40% at 50% 110%, rgba(79,110,247,0.10) 0%, transparent 65%)',
      }} />
      {/* Left-right side vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, rgba(0,0,0,0.55) 100%)',
      }} />
      {/* Subtle noise texture overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '200px 200px',
        }}
      />

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center w-full max-w-[320px] px-8">

        {/* App name — clean text only */}
        <div className="mb-14 flex flex-col items-center">
          <h1
            className="text-[42px] font-black tracking-[-0.04em] leading-none mb-3"
            style={{ color: 'rgba(245,245,247,0.96)' }}
          >
            eodi<span style={{
              background: 'linear-gradient(135deg, #00CFCF 0%, #4A96FF 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>.me</span>
          </h1>

          {/* Subtitle removed as per user request (just eodi.me text) */}
          {/* <p
            className="text-[10.5px] font-semibold uppercase tracking-[0.30em] text-center"
            style={{ color: 'rgba(255,255,255,0.32)', letterSpacing: '0.28em' }}
          >
            {copy.splashCityVibeEngine}
          </p> */}
        </div>

        {/* ── Progress section ────────────────────────────────────────── */}
        <div className="w-full mb-6">
          {/* Track + fill */}
          <div
            className="w-full rounded-full overflow-hidden mb-3"
            style={{ height: '5px', background: 'rgba(255,255,255,0.07)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #00CFCF 0%, #4A96FF 100%)',
                boxShadow: '0 0 10px rgba(0,207,207,0.60), 0 0 20px rgba(74,150,255,0.25)',
                transition: 'width 0.7s cubic-bezier(0.22,1,0.36,1)',
              }}
            />
          </div>

          {/* Status row */}
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.38)', fontWeight: 500 }}>
              {stageLabelText}
            </span>
            {statusText && (
              <span style={{ fontSize: '11px', color: 'rgba(0,207,207,0.85)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {statusText}
              </span>
            )}
          </div>
        </div>

        {/* ── Stage indicator — pill dots ─────────────────────────────── */}
        <div className="flex items-center gap-2 mb-10">
          {STAGES.map((s, i) => {
            const isDone = stageIdx > i || stage === 'ready';
            const isActive = s.key === stage;
            return (
              <div
                key={s.key}
                style={{
                  width: isActive ? '22px' : '6px',
                  height: '6px',
                  borderRadius: '4px',
                  transition: 'all 0.5s cubic-bezier(0.22,1,0.36,1)',
                  background: isDone
                    ? 'rgba(48,209,88,0.75)'
                    : isActive
                    ? 'linear-gradient(90deg, #4F6EF7, #A5B8FF)'
                    : 'rgba(255,255,255,0.12)',
                  boxShadow: isActive ? '0 0 8px rgba(79,110,247,0.55)' : isDone ? '0 0 5px rgba(48,209,88,0.35)' : 'none',
                }}
              />
            );
          })}
        </div>

        {/* Error state */}
        {error && (() => {
          const diagnosis = diagnoseError(error, locale);
          const copyDiag = () => {
            const text = [
              `eodi.me Diagnostic Report`,
              `─────────────────────────`,
              `App Version: ${APP_VERSION}`,
              `Stage: ${stage}`,
              `Error: ${error}`,
              `Time: ${new Date().toISOString()}`,
            ].join('\n');
            navigator.clipboard.writeText(text).then(() => {
              setDiagCopied(true);
              setTimeout(() => setDiagCopied(false), 2500);
            }).catch(() => {});
          };
          return (
            <div className="w-full rounded-[18px] border overflow-hidden mb-6"
              style={{ background: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.18)' }}
            >
              {/* Header */}
              <div className="px-4 pt-3.5 pb-2.5 border-b" style={{ borderColor: 'rgba(239,68,68,0.14)' }}>
                <p className="text-[12px] font-semibold mb-1" style={{ color: 'rgba(252,165,165,0.90)' }}>
                  {copy.splashDiagTitle}
                </p>
                <p className="text-[11px] font-mono leading-relaxed" style={{ color: 'rgba(252,165,165,0.55)' }}>
                  {error.length > 120 ? error.slice(0, 120) + '…' : error}
                </p>
              </div>
              {/* Diagnosis */}
              <div className="px-4 pt-2.5 pb-3 space-y-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.10em] mb-1" style={{ color: 'rgba(252,165,165,0.45)' }}>
                    {copy.splashDiagPossibleCause}
                  </p>
                  <p className="text-[11.5px] font-medium" style={{ color: 'rgba(252,165,165,0.80)' }}>
                    {diagnosis.cause}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.10em] mb-1" style={{ color: 'rgba(252,165,165,0.45)' }}>
                    {copy.splashDiagSteps}
                  </p>
                  <ol className="space-y-0.5">
                    {diagnosis.steps.map((step, i) => (
                      <li key={i} className="text-[11px] leading-relaxed flex gap-1.5" style={{ color: 'rgba(252,165,165,0.65)' }}>
                        <span style={{ color: 'rgba(252,165,165,0.35)', flexShrink: 0 }}>{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              {/* Actions */}
              <div className="px-4 pb-3.5 flex gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 py-1.5 rounded-[10px] text-[11.5px] font-semibold transition-opacity"
                  style={{ background: 'rgba(239,68,68,0.18)', border: '0.5px solid rgba(239,68,68,0.28)', color: 'rgba(252,165,165,0.85)' }}
                  aria-label={copy.retry}
                >
                  {copy.retry}
                </button>
                <button
                  onClick={copyDiag}
                  className="flex-1 py-1.5 rounded-[10px] text-[11.5px] font-semibold transition-all"
                  style={{ background: diagCopied ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.05)', border: `0.5px solid ${diagCopied ? 'rgba(52,211,153,0.30)' : 'rgba(255,255,255,0.10)'}`, color: diagCopied ? 'rgba(52,211,153,0.85)' : 'rgba(255,255,255,0.38)' }}
                >
                  {diagCopied ? copy.splashDiagCopied : copy.splashDiagCopy}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Version */}
        <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.10)', fontFamily: 'monospace', letterSpacing: '0.12em' }}>
          v1.0.0
        </p>
      </div>
    </div>
  );
};
