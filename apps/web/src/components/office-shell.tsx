'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  BadgeEuro,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  HeartHandshake,
  Landmark,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  UserRound,
  UserRoundPlus,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  Button,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@care/ui';
import { ThemeSwitcher } from '@app/web/components/theme-switcher';

export type OfficeNavigationGroup = {
  id: string;
  label: string;
  items: { id: string; label: string; href: string }[];
};

const icons: Record<string, LucideIcon> = {
  overview: Activity,
  operations: ClipboardList,
  planning: CalendarDays,
  clients: Users,
  admissions: UserRoundPlus,
  employees: Users,
  services: Wrench,
  benefits: BadgeEuro,
  billing: Landmark,
  claims: ClipboardCheck,
  documentation: ClipboardList,
  serviceEvidence: FileCheck2,
  communications: MessageSquareText,
  administration: Wrench,
};

function subscribeSidebar(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener('care-sidebar-change', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener('care-sidebar-change', listener);
  };
}

function getSidebarSnapshot() {
  try {
    return window.localStorage.getItem('care-office-sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function getSidebarServerSnapshot() {
  return false;
}

export function OfficeShell({
  children,
  groups,
  tenantName,
  language,
  signOut,
  labels,
}: {
  children: React.ReactNode;
  groups: OfficeNavigationGroup[];
  tenantName: string;
  language: React.ReactNode;
  signOut: React.ReactNode;
  labels: {
    main: string;
    brand: string;
    overview: string;
    openMenu: string;
    closeMenu: string;
    collapse: string;
    expand: string;
    account: string;
    changeTenant: string;
  };
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarSnapshot,
    getSidebarServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeItem = useMemo(() => {
    const links = groups.flatMap((group) => group.items.map((item) => ({ ...item, group })));
    return links
      .filter((item) => isNavigationItemActive(item, pathname))
      .sort((left, right) => right.href.length - left.href.length)[0];
  }, [groups, pathname]);

  function toggleCollapsed() {
    const next = !getSidebarSnapshot();
    try {
      window.localStorage.setItem('care-office-sidebar', next ? 'collapsed' : 'expanded');
    } catch {
      // The control still works for this session when storage is unavailable.
    }
    window.dispatchEvent(new Event('care-sidebar-change'));
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh w-full bg-background text-foreground">
        <aside
          aria-label={labels.main}
          data-collapsed={collapsed}
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex lg:w-[4.5rem] xl:w-64',
            collapsed && 'xl:w-[4.5rem]',
          )}
        >
          <SidebarBrand
            href={groups[0]?.items[0]?.href ?? '/'}
            label={labels.brand}
            collapsed={collapsed}
          />
          <Separator className="bg-sidebar-border" />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 xl:px-3">
            <NavigationGroups
              groups={groups}
              pathname={pathname}
              collapsed={collapsed}
              mobileView={false}
              closeMobile={() => undefined}
            />
          </div>
          <div className="border-t border-sidebar-border p-3">
            <div className="hidden min-w-0 xl:block" data-expanded={!collapsed}>
              {!collapsed ? (
                <>
                  <p className="truncate text-sm font-medium" title={tenantName}>
                    {tenantName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{labels.brand}</p>
                </>
              ) : null}
            </div>
            <div className="hidden justify-center xl:flex" data-collapsed={collapsed}>
              {collapsed ? (
                <span
                  className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground"
                  title={tenantName}
                >
                  <HeartHandshake className="size-4" aria-hidden="true" />
                </span>
              ) : null}
            </div>
            <div className="flex justify-center xl:hidden">
              <span
                className="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground"
                title={tenantName}
              >
                <HeartHandshake className="size-4" aria-hidden="true" />
              </span>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-5 lg:px-7">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 lg:hidden"
                  aria-label={labels.openMenu}
                >
                  <Menu className="size-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                className="p-0"
                closeLabel={labels.closeMenu}
                aria-describedby={undefined}
              >
                <SheetHeader className="border-b border-sidebar-border px-4 py-4 pr-14">
                  <SheetTitle className="sr-only">{labels.main}</SheetTitle>
                  <SheetDescription className="sr-only">{tenantName}</SheetDescription>
                  <SidebarBrand
                    href={groups[0]?.items[0]?.href ?? '/'}
                    label={labels.brand}
                    collapsed={false}
                  />
                </SheetHeader>
                <nav aria-label={labels.main} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
                  <NavigationGroups
                    groups={groups}
                    pathname={pathname}
                    collapsed={false}
                    mobileView
                    closeMobile={() => setMobileOpen(false)}
                  />
                </nav>
                <div className="border-t border-sidebar-border p-4">
                  <p className="truncate text-sm font-medium">{tenantName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{labels.brand}</p>
                </div>
              </SheetContent>
            </Sheet>

            <Button
              variant="ghost"
              size="icon"
              className="hidden shrink-0 xl:inline-flex"
              aria-label={collapsed ? labels.expand : labels.collapse}
              title={collapsed ? labels.expand : labels.collapse}
              onClick={toggleCollapsed}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              )}
            </Button>

            <nav aria-label={labels.main} className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-2 text-sm">
                <li className="hidden shrink-0 text-muted-foreground sm:block">{labels.brand}</li>
                {activeItem ? (
                  <>
                    <li aria-hidden="true" className="hidden text-muted-foreground sm:block">
                      /
                    </li>
                    <li className="truncate font-medium" aria-current="page">
                      {activeItem.label}
                    </li>
                  </>
                ) : (
                  <li className="truncate font-medium">{labels.overview}</li>
                )}
              </ol>
            </nav>

            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <ThemeSwitcher />
              {language}
              <details className="group relative">
                <summary
                  className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                  aria-label={labels.account}
                  title={labels.account}
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    <UserRound className="size-4" aria-hidden="true" />
                  </span>
                  <span className="hidden max-w-24 truncate text-sm sm:block">
                    {labels.account}
                  </span>
                </summary>
                <div className="absolute right-0 z-40 mt-2 grid min-w-56 gap-1 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium">{labels.account}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{tenantName}</p>
                  </div>
                  <Separator />
                  <Link
                    href="/"
                    className="flex min-h-10 items-center rounded-md px-2 text-sm hover:bg-accent"
                  >
                    {labels.changeTenant}
                  </Link>
                  {signOut}
                </div>
              </details>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1680px] min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarBrand({
  href,
  label,
  collapsed,
}: {
  href: string;
  label: string;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-16 items-center gap-3 px-3 text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring xl:px-4',
        collapsed && 'xl:justify-center xl:px-2',
      )}
      aria-label={label}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <HeartHandshake className="size-5" aria-hidden="true" />
      </span>
      <span
        className={cn(
          'min-w-0 truncate text-sm font-semibold lg:hidden xl:block',
          collapsed && 'xl:hidden',
        )}
      >
        {label}
      </span>
    </Link>
  );
}

function NavigationGroups({
  groups,
  pathname,
  collapsed,
  mobileView,
  closeMobile,
}: {
  groups: OfficeNavigationGroup[];
  pathname: string;
  collapsed: boolean;
  mobileView: boolean;
  closeMobile: () => void;
}) {
  const links = groups.flatMap((group) => group.items.map((item) => ({ ...item, group })));
  const active = links
    .filter((item) => isNavigationItemActive(item, pathname))
    .sort((left, right) => right.href.length - left.href.length)[0];

  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.id} className="grid gap-1">
          <h2
            className={cn(
              'block px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:hidden xl:block',
              collapsed && !mobileView && 'xl:hidden',
            )}
          >
            {group.label}
          </h2>
          <ul className="grid gap-1">
            {group.items.map((item) => {
              const Icon = icons[item.id] ?? Activity;
              const isActive = active?.id === item.id;
              const link = (
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={closeMobile}
                  className={cn(
                    'group flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:px-3',
                    'lg:justify-center lg:px-2 xl:justify-start xl:px-3',
                    collapsed && 'xl:justify-center xl:px-2',
                    isActive && 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm',
                  )}
                >
                  <Icon className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate lg:sr-only',
                      collapsed && !mobileView ? 'xl:sr-only' : 'xl:not-sr-only',
                    )}
                  >
                    {item.label}
                  </span>
                  {isActive ? (
                    <span
                      className={cn(
                        'ml-auto size-1.5 rounded-full bg-primary lg:hidden xl:block',
                        collapsed && !mobileView && 'xl:hidden',
                      )}
                    />
                  ) : null}
                </Link>
              );
              return (
                <li key={item.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className={
                        mobileView ? 'hidden' : collapsed ? 'hidden xl:block' : 'xl:hidden'
                      }
                    >
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function isNavigationItemActive(item: { id: string; href: string }, pathname: string) {
  if (item.id === 'overview') return pathname === '/operations';
  if (item.id === 'operations' && pathname.startsWith('/operations/')) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
