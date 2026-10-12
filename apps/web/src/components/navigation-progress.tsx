'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

export function NavigationProgress() {
  const t = useTranslations('Common');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const pendingRef = useRef(false);
  const previousRouteRef = useRef(routeKey);
  const progressIntervalRef = useRef<number | null>(null);
  const fallbackTimeoutRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (progressIntervalRef.current !== null) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (fallbackTimeoutRef.current !== null) {
      window.clearTimeout(fallbackTimeoutRef.current);
      fallbackTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const finishNavigation = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    clearTimers();
    setProgress(100);
    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false);
      setProgress(0);
      hideTimeoutRef.current = null;
    }, 180);
  }, [clearTimers]);

  const startNavigation = useCallback(() => {
    clearTimers();
    pendingRef.current = true;
    setVisible(true);
    setProgress(8);
    progressIntervalRef.current = window.setInterval(() => {
      setProgress((current) => Math.min(90, current + Math.max(1, (90 - current) * 0.08)));
    }, 160);
    fallbackTimeoutRef.current = window.setTimeout(finishNavigation, 20_000);
  }, [clearTimers, finishNavigation]);

  useEffect(() => {
    if (previousRouteRef.current !== routeKey) {
      previousRouteRef.current = routeKey;
      finishNavigation();
    }
  }, [finishNavigation, routeKey]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (
        !anchor ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      ) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      ) {
        return;
      }

      startNavigation();
    }

    function handlePopState() {
      startNavigation();
    }

    document.addEventListener('click', handleClick, true);
    window.addEventListener('popstate', handlePopState);
    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [startNavigation]);

  useEffect(
    () => () => {
      pendingRef.current = false;
      clearTimers();
    },
    [clearTimers],
  );

  return (
    <div
      aria-hidden={!visible}
      aria-label={visible ? t('loadingPage') : undefined}
      aria-valuemin={visible ? 0 : undefined}
      aria-valuemax={visible ? 100 : undefined}
      aria-valuenow={visible ? Math.round(progress) : undefined}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-50 h-0.5 overflow-hidden"
      role={visible ? 'progressbar' : undefined}
    >
      <span
        className="block h-full rounded-r-full bg-primary transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ opacity: visible ? 1 : 0, width: `${progress}%` }}
      />
    </div>
  );
}
