import * as React from 'react';

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribeToMobileQuery(onChange: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getIsMobile() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribeToMobileQuery, getIsMobile, () => false);
}
