'use client';

import type { FocusEvent, ReactNode } from 'react';

type ClientProfileSectionNavProps = Readonly<{
  ariaLabel: string;
  className: string;
  children: ReactNode;
}>;

export function ClientProfileSectionNav({
  ariaLabel,
  className,
  children,
}: ClientProfileSectionNavProps) {
  const scrollFocusedLinkIntoView = (event: FocusEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target)) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <nav aria-label={ariaLabel} className={className} onFocusCapture={scrollFocusedLinkIntoView}>
      {children}
    </nav>
  );
}
