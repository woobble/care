'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@care/ui/lib/utils';

type AdministrationNavigationGroup = Readonly<{
  key: string;
  label: string;
  links: readonly Readonly<{ href: string; label: string }>[];
}>;

export function getActiveAdministrationNavigationItem(
  groups: readonly AdministrationNavigationGroup[],
  pathname: string,
): { groupIndex: number; linkIndex: number } | undefined {
  const path = pathname.split(/[?#]/, 1)[0]!;
  let selected: { groupIndex: number; linkIndex: number } | undefined;
  let specificity = -1;
  for (const [groupIndex, group] of groups.entries()) {
    for (const [linkIndex, link] of group.links.entries()) {
      if (link.href.includes('#')) continue;
      const matches =
        link.href === '/administration'
          ? path === '/administration' || path === '/administration/'
          : path === link.href || path.startsWith(`${link.href}/`);
      if (matches && link.href.length > specificity) {
        selected = { groupIndex, linkIndex };
        specificity = link.href.length;
      }
    }
  }
  return selected;
}

export function AdministrationNavigationLinks({
  groups,
}: Readonly<{ groups: readonly AdministrationNavigationGroup[] }>) {
  const selected = getActiveAdministrationNavigationItem(groups, usePathname());
  return groups.map((group, groupIndex) => (
    <section key={group.key} className="grid content-start gap-1">
      <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {group.label}
      </h2>
      {group.links.map((link, linkIndex) => {
        const current = selected?.groupIndex === groupIndex && selected.linkIndex === linkIndex;
        return (
          <Link
            key={link.href}
            className={cn(
              'min-h-10 rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              current && 'bg-accent text-accent-foreground underline underline-offset-4',
            )}
            href={link.href}
            aria-current={current ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </section>
  ));
}
