import type { RouterTransitionType } from 'next';

const navigationStartMark = 'care:router-transition-start';

export function onRouterTransitionStart(_url: string, navigationType: RouterTransitionType) {
  if (process.env.NODE_ENV !== 'development') return;
  performance.clearMarks(navigationStartMark);
  performance.mark(navigationStartMark, { detail: navigationType });
}
