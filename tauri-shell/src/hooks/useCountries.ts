/**
 * useCountries — fetches the full country list from the engine DB at startup,
 * and lazily fetches city lists when a country is selected.
 *
 * Uses the same auth pattern as other hooks (token from engineConfig).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { EngineConfig } from './useEngine';

interface UseCountriesReturn {
  /** All country codes in the DB (sorted). */
  countries: string[];
  /** Cities for the currently selected country. */
  cities: string[];
  /** Whether the country list is still loading. */
  loading: boolean;
  /** Fetch cities for a given country code (cached). */
  fetchCities: (countryCode: string) => void;
}

export function useCountries(engineConfig: EngineConfig | null): UseCountriesReturn {
  const [countries, setCountries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const cityCacheRef = useRef<Record<string, string[]>>({});

  // Build headers with auth token if available
  const headersFor = useCallback(() => {
    const h: Record<string, string> = {};
    if (engineConfig?.token) h['Authorization'] = `Bearer ${engineConfig.token}`;
    return h;
  }, [engineConfig?.token]);

  const baseUrl = engineConfig?.base_url ?? '';

  // Fetch country list once on engine ready
  useEffect(() => {
    if (!engineConfig) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${baseUrl}/countries`, {
          headers: headersFor(),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.countries)) {
            setCountries(data.countries);
          }
        }
      } catch {
        // non-critical — fallback to client-side extraction
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [engineConfig, baseUrl, headersFor]);

  // Fetch cities for a country (with cache)
  const fetchCities = useCallback(
    (countryCode: string) => {
      if (!countryCode) {
        setCities([]);
        return;
      }

      // Return from cache if available
      if (cityCacheRef.current[countryCode]) {
        setCities(cityCacheRef.current[countryCode]);
        return;
      }

      if (!engineConfig) return;

      (async () => {
        try {
          const res = await fetch(
            `${baseUrl}/cities?country=${encodeURIComponent(countryCode)}`,
            { headers: headersFor(), signal: AbortSignal.timeout(5000) },
          );
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.cities)) {
              cityCacheRef.current[countryCode] = data.cities;
              setCities(data.cities);
            }
          }
        } catch {
          // fallback — keep current cities
        }
      })();
    },
    [engineConfig, baseUrl, headersFor],
  );

  return { countries, cities, loading, fetchCities };
}
