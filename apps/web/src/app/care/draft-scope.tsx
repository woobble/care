'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { purgeInaccessibleCareDrafts } from './drafts';

type CareDraftScopeValue = { userId: string; tenantId: string };
const CareDraftScopeContext = createContext<CareDraftScopeValue | null>(null);

export function CareDraftScope({
  userId,
  tenantId,
  children,
}: CareDraftScopeValue & { children: ReactNode }) {
  const scope = useMemo(() => ({ userId, tenantId }), [tenantId, userId]);

  useEffect(() => {
    const purge = () => {
      try {
        purgeInaccessibleCareDrafts(window.sessionStorage, userId, tenantId);
      } catch {
        // Draft storage is optional; forms report storage failures when a caregiver edits them.
      }
    };
    purge();
    const interval = window.setInterval(purge, 60_000);
    window.addEventListener('focus', purge);
    window.addEventListener('pageshow', purge);
    document.addEventListener('visibilitychange', purge);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', purge);
      window.removeEventListener('pageshow', purge);
      document.removeEventListener('visibilitychange', purge);
    };
  }, [tenantId, userId]);

  return <CareDraftScopeContext.Provider value={scope}>{children}</CareDraftScopeContext.Provider>;
}

export function useCareDraftScope() {
  return useContext(CareDraftScopeContext);
}
