'use client';

import dynamic from 'next/dynamic';

const DevelopmentWebVitals = dynamic(() =>
  import('./web-vitals').then((module) => module.WebVitals),
);

export function PerformanceInstrumentation() {
  return process.env.NODE_ENV === 'development' ? <DevelopmentWebVitals /> : null;
}
