import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { municipalityBoundaryAPI } from '../lib/api';
import { configFromUnknown, EMPTY_BOUNDARY, type MunicipalityBoundary } from '../lib/municipalityBoundary';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

const CACHE_KEY = 'norzagapay_municipality_boundary';
interface BoundaryContextValue {
  boundary: MunicipalityBoundary;
  loading: boolean;
  refresh: () => Promise<MunicipalityBoundary>;
  setBoundary: (boundary: MunicipalityBoundary) => void;
}

const BoundaryContext = createContext<BoundaryContextValue | null>(null);

function readCache(): MunicipalityBoundary {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? configFromUnknown(JSON.parse(raw)) : EMPTY_BOUNDARY;
  } catch {
    return EMPTY_BOUNDARY;
  }
}

export function MunicipalityBoundaryProvider({ children }: { children: ReactNode }) {
  const [boundary, setBoundaryState] = useState<MunicipalityBoundary>(readCache);
  const [loading, setLoading] = useState(true);

  const setBoundary = useCallback((next: MunicipalityBoundary) => {
    const normalized = configFromUnknown(next);
    setBoundaryState(normalized);
    localStorage.setItem(CACHE_KEY, JSON.stringify(normalized));
  }, []);

  const refresh = useCallback(async () => {
    const response = await municipalityBoundaryAPI.get();
    const next = configFromUnknown(response.data);
    setBoundary(next);
    return next;
  }, [setBoundary]);

  useEffect(() => {
    refresh().catch(() => undefined).finally(() => setLoading(false));
  }, [refresh]);
  useRealtimeRefresh(refresh, { publicUpdates: true });

  const value = useMemo(() => ({ boundary, loading, refresh, setBoundary }), [boundary, loading, refresh, setBoundary]);
  return <BoundaryContext.Provider value={value}>{children}</BoundaryContext.Provider>;
}

export function useMunicipalityBoundary() {
  const value = useContext(BoundaryContext);
  if (!value) throw new Error('useMunicipalityBoundary must be used within MunicipalityBoundaryProvider');
  return value;
}
