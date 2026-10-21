'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@care/ui/lib/utils';

type BillingNavigationLink = Readonly<{ href: string; label: string }>;

export function getActiveBillingNavigationIndex(
  links: readonly BillingNavigationLink[],
  pathname: string,
): number {
  const path = pathname.split(/[?#]/, 1)[0]!;
  let selected = -1;
  for (const [index, link] of links.entries()) {
    if (link.href.includes('#')) continue;
    const matches =
      link.href === '/billing'
        ? path === '/billing' || path === '/billing/'
        : path === link.href || path.startsWith(`${link.href}/`);
    if (matches && (selected === -1 || link.href.length > links[selected]!.href.length))
      selected = index;
  }
  return selected;
}

export function BillingNavigationLinks({
  links,
}: Readonly<{ links: readonly BillingNavigationLink[] }>) {
  const selected = getActiveBillingNavigationIndex(links, usePathname());
  return links.map((link, index) => (
    <Link
      key={link.href}
      className={cn(
        'min-h-10 rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        index === selected && 'bg-accent text-accent-foreground underline underline-offset-4',
      )}
      href={link.href}
      aria-current={index === selected ? 'page' : undefined}
    >
      {link.label}
    </Link>
  ));
}
