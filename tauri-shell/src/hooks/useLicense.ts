/**
 * useLicense — manages license state and subscription tiers.
 *
 * Reads license status from the Tauri backend (which checks the local
 * %APPDATA%/eodi.me/license.json file). Exposes plan tier, feature limits,
 * and activation helpers.
 *
 * Tiers: free → personal (Pro) → solo_biz → business → enterprise
 * Pricing: free($0) | personal/Pro($3.99/mo,$29/yr,$49 lifetime) | solo_biz($9.99/mo,$79/yr,$179 lifetime) | business(contact)
 *
 * Free tier includes: full vibe report, similarity matching, preference discovery.
 * Pro (personal) unlocks: custom POI overlay input, custom vibe recalculation, export, presets.
 */
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

// ── Types ────────────────────────────────────────────────────────────────────

export type Plan = 'free' | 'personal' | 'solo_biz' | 'business' | 'enterprise';

export interface LicenseStatus {
  plan: Plan;
  is_active: boolean;
  license_key_hint: string | null;
  expires_label: string;
  needs_verification: boolean;
  /** Positive = days until expiry, negative = days into grace period. Null for lifetime/free. */
  days_until_expiry: number | null;
  /** True when expired but still within 14-day grace window. */
  in_grace_period: boolean;
}

export interface TierLimits {
  /** Free+: full radar chart + detailed analysis in VibeReport */
  canFullVibeReport: boolean;
  /** Personal+: save/apply named weight presets */
  canPresets: boolean;
  /** Personal+: location similarity comparison */
  canMatch: boolean;
  /** Personal+: preference discovery / explore tab */
  canDiscover: boolean;
  /** Personal+: export search results and bookmarks as CSV */
  canExport: boolean;
  /** Solo Biz+: custom POI overlay input */
  canOverlayPoi: boolean;
  /** Solo Biz+: self-hosted Docker deploy */
  canDockerDeploy: boolean;
  /** Business+: batch analysis */
  canBatchAnalysis: boolean;
  /** Business+: bring your own data */
  canBYOD: boolean;
  /** Enterprise: full REST API access */
  canApiAccess: boolean;
  /** Enterprise: custom data schema */
  canCustomSchema: boolean;
}

export interface UseLicenseReturn {
  status: LicenseStatus | null;
  loading: boolean;
  activating: boolean;
  error: string | null;
  /** True when any paid plan is active */
  isPremium: boolean;
  /** Alias for isPremium (backward compat) */
  isProActive: boolean;
  /** Feature limits for the current plan */
  tierLimits: TierLimits;
  /** Warning message when expiry is near (≤7 days) or in grace period */
  expiryWarning: string | null;
  activate: (key: string) => Promise<void>;
  deactivate: () => Promise<void>;
  verifyOnline: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

// ── Tier definitions ─────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<Plan, TierLimits> = {
  free: {
    canFullVibeReport: true,   // ← show the core product to everyone
    canPresets: false,
    canMatch: true,            // ← similarity matching is free (read-only on existing data)
    canDiscover: true,         // ← preference discovery is free (read-only on existing data)
    canExport: false,
    canOverlayPoi: false,      // ← Pro: custom POI input → custom vibe recalculation
    canDockerDeploy: false,
    canBatchAnalysis: false,
    canBYOD: false,
    canApiAccess: false,
    canCustomSchema: false,
  },
  personal: {
    canFullVibeReport: true,
    canPresets: true,          // ← save named weight profiles
    canMatch: true,
    canDiscover: true,
    canExport: true,           // ← CSV export
    canOverlayPoi: true,       // ← THE core paid feature: add your own POI data → recalculate vibe
    canDockerDeploy: false,
    canBatchAnalysis: false,
    canBYOD: false,
    canApiAccess: false,
    canCustomSchema: false,
  },
  solo_biz: {
    canFullVibeReport: true,
    canPresets: true,
    canMatch: true,
    canDiscover: true,
    canExport: true,
    canOverlayPoi: true,
    canDockerDeploy: true,     // ← self-hosted Docker deploy for small teams
    canBatchAnalysis: false,
    canBYOD: false,
    canApiAccess: false,
    canCustomSchema: false,
  },
  business: {
    canFullVibeReport: true,
    canPresets: true,
    canMatch: true,
    canDiscover: true,
    canExport: true,
    canOverlayPoi: true,
    canDockerDeploy: true,
    canBatchAnalysis: true,
    canBYOD: true,
    canApiAccess: true,        // ← local REST API for external integrations
    canCustomSchema: false,
  },
  enterprise: {
    canFullVibeReport: true,
    canPresets: true,
    canMatch: true,
    canDiscover: true,
    canExport: true,
    canOverlayPoi: true,
    canDockerDeploy: true,
    canBatchAnalysis: true,
    canBYOD: true,
    canApiAccess: true,
    canCustomSchema: true,
  },
};

export const PLAN_INFO: Record<Plan, { label: string; monthlyPrice: string; yearlyPrice: string; lifetimePrice: string; color: string; highlight: boolean }> = {
  free:       { label: 'Free',       monthlyPrice: '$0',     yearlyPrice: '$0',       lifetimePrice: '$0',    color: 'rgba(235,235,245,0.55)', highlight: false },
  personal:   { label: 'Pro',        monthlyPrice: '$3.99',  yearlyPrice: '$29/yr',   lifetimePrice: '$49',   color: 'var(--color-accent-light)', highlight: true },
  solo_biz:   { label: 'Teams',      monthlyPrice: '$9.99',  yearlyPrice: '$79/yr',   lifetimePrice: '$179',  color: '#34d399', highlight: false },
  business:   { label: 'Business',   monthlyPrice: 'Contact', yearlyPrice: 'Contact', lifetimePrice: 'Contact', color: '#f59e0b', highlight: false },
  enterprise: { label: 'Enterprise', monthlyPrice: 'Contact', yearlyPrice: 'Contact', lifetimePrice: 'Contact', color: '#a78bfa', highlight: false },
};

/** Polar checkout links per plan and billing cycle. */
export const PLAN_BUY_LINKS: Partial<Record<Plan, { monthly: string; yearly: string; lifetime: string } | string>> = {
  personal: {
    monthly:  'https://buy.polar.sh/polar_cl_Ml6z5FGUF8sfSEz2A0iCZ0gAjWcWJ2YtVTlbS2MRFub',
    yearly:   'https://buy.polar.sh/polar_cl_mlCUP1Juw9Zv82aE8aAs4ZuB04AN8wi4ljlt20lIA0B',
    lifetime: 'https://buy.polar.sh/polar_cl_UmQmBnM8ztgFZnWCzkQq20Nayn5NDP1WwYgV12XaWbZ',
  },
  enterprise: 'mailto:hello@eodi.me?subject=Enterprise%20Inquiry',
};

// Backward compat alias
export const FREE_TIER_LIMITS = PLAN_LIMITS.free;

// ── Hook ─────────────────────────────────────────────────────────────────────

const FREE_STATUS: LicenseStatus = {
  plan: 'free',
  is_active: false,
  license_key_hint: null,
  expires_label: '—',
  needs_verification: false,
  days_until_expiry: null,
  in_grace_period: false,
};

export function useLicense(): UseLicenseReturn {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPremium = Boolean(status && status.plan !== 'free' && status.is_active);
  const isProActive = isPremium; // backward compat
  const tierLimits = PLAN_LIMITS[status?.plan ?? 'free'];

  // Compute expiry warning for banner display
  const expiryWarning: string | null = (() => {
    if (!status || status.plan === 'free' || status.days_until_expiry === null) return null;
    const d = status.days_until_expiry;
    if (status.in_grace_period) {
      const graceLeft = 14 + d; // d is negative in grace period
      return `Your ${PLAN_INFO[status.plan].label} license expired. ${graceLeft > 0 ? `${graceLeft} day${graceLeft !== 1 ? 's' : ''} of grace period remaining.` : 'Grace period ending soon.'} Renew to keep access.`;
    }
    if (d <= 7 && d >= 0) {
      return `Your ${PLAN_INFO[status.plan].label} license expires in ${d} day${d !== 1 ? 's' : ''}. Renew to avoid interruption.`;
    }
    return null;
  })();

  // ── Fetch local license status (no network) ───────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const s = await invoke<LicenseStatus>('get_license_status');
      setStatus(s);
    } catch {
      // Tauri invoke failed (dev mode without backend?) → default to Free
      setStatus(FREE_STATUS);
    }
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // ── Re-verify online (once per week) ──────────────────────────────────────
  const verifyOnline = useCallback(async () => {
    try {
      const s = await invoke<LicenseStatus>('verify_license_online');
      setStatus(s);
    } catch {
      // Non-fatal — local license remains valid for grace period
    }
  }, []);

  // Trigger online verification if needed (runs once after initial load)
  useEffect(() => {
    if (status?.needs_verification) {
      verifyOnline();
    }
  }, [status?.needs_verification, verifyOnline]);

  // ── Activate ──────────────────────────────────────────────────────────────
  const activate = useCallback(async (key: string) => {
    setActivating(true);
    setError(null);
    try {
      const s = await invoke<LicenseStatus>('activate_license', { key });
      setStatus(s);
    } catch (e: unknown) {
      const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? 'Activation failed');
      setError(msg);
      throw new Error(msg);
    } finally {
      setActivating(false);
    }
  }, []);

  // ── Deactivate ────────────────────────────────────────────────────────────
  const deactivate = useCallback(async () => {
    setError(null);
    try {
      await invoke('deactivate_license');
      setStatus(FREE_STATUS);
    } catch (e: unknown) {
      const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? 'Deactivation failed');
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    loading,
    activating,
    error,
    isPremium,
    isProActive,
    tierLimits,
    expiryWarning,
    activate,
    deactivate,
    verifyOnline,
    refresh,
    clearError,
  };
}
