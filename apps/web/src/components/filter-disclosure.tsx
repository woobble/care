'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function FilterDisclosure({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const syncDisclosureToViewport = () => {
      if (detailsRef.current) detailsRef.current.open = desktop.matches;
    };
    syncDisclosureToViewport();
    desktop.addEventListener('change', syncDisclosureToViewport);
    return () => desktop.removeEventListener('change', syncDisclosureToViewport);
  }, []);

  return (
    <details
      ref={detailsRef}
      open
      className="group min-w-0 rounded-xl border border-border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold md:hidden [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="p-4">{children}</div>
    </details>
  );
}
