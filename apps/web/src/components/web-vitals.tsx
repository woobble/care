'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { useCallback, useEffect, useRef } from 'react';

const navigationStartMark = 'care:router-transition-start';

export function WebVitals() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteKey = useRef(routeKey);
  const reportMetric = useCallback<Parameters<typeof useReportWebVitals>[0]>((metric) => {
    if (process.env.NODE_ENV !== 'development') return;
    console.info('[care:web-vital]', {
      name: metric.name,
      value: Math.round(metric.value * 100) / 100,
      rating: metric.rating,
      navigationType: metric.navigationType,
    });
  }, []);

  useReportWebVitals(reportMetric);

  useEffect(() => {
    if (previousRouteKey.current === routeKey) return;
    previousRouteKey.current = routeKey;
    if (process.env.NODE_ENV !== 'development') return;

    const start = performance.getEntriesByName(navigationStartMark, 'mark').at(-1);
    if (!start) return;
    console.info('[care:route-transition]', {
      route: pathname.split('/').filter(Boolean)[0] ?? '/',
      navigationType: (start as PerformanceMark).detail,
      durationMs: Math.round((performance.now() - start.startTime) * 100) / 100,
    });
    performance.clearMarks(navigationStartMark);
  }, [pathname, routeKey]);

  return null;
}
