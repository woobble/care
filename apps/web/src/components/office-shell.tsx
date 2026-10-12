"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeEuro,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FileText,
  HeartHandshake,
  Landmark,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  UserRoundPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  TooltipProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  cn,
} from "@care/ui";
import { AccountMenu } from "@app/web/components/account-menu";
import type { Locale } from "@app/web/i18n/config";
import { LanguageSwitcher } from "@app/web/components/language-switcher";
import { NavigationProgress } from "@app/web/components/navigation-progress";
import { ThemeSwitcher } from "@app/web/components/theme-switcher";

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
  employees: Briefcase,
  services: Wrench,
  benefits: BadgeEuro,
  billing: Landmark,
  claims: ClipboardCheck,
  documentation: FileText,
  serviceEvidence: FileCheck2,
  communications: MessageSquareText,
  administration: Settings,
};

export function OfficeShell({
  children,
  groups,
  tenantName,
  profileName,
  email,
  locale,
  initialCollapsed,
  signOut,
  labels,
}: {
  children: React.ReactNode;
  groups: OfficeNavigationGroup[];
  tenantName: string;
  profileName?: string | null | undefined;
  email?: string | null | undefined;
  locale: Locale;
  initialCollapsed: boolean;
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
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageContextRef = useRef<HTMLSpanElement>(null);
  const activeItem = useMemo(() => {
    const links = groups.flatMap((group) => group.items);
    return links
      .filter((item) => isNavigationItemActive(item, pathname))
      .sort((left, right) => right.href.length - left.href.length)[0];
  }, [groups, pathname]);
  const tenantInitial = tenantName.trim().charAt(0).toUpperCase() || "C";

  useEffect(() => {
    const desktopViewport = window.matchMedia("(min-width: 768px)");
    function closeDrawerOnDesktop() {
      if (desktopViewport.matches) setMobileOpen(false);
    }
    closeDrawerOnDesktop();
    desktopViewport.addEventListener("change", closeDrawerOnDesktop);
    return () => {
      desktopViewport.removeEventListener("change", closeDrawerOnDesktop);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider
        open={!collapsed}
        onOpenChange={(open) => setCollapsed(!open)}
        cookieName="care-office-sidebar"
        cookieMaxAge={31_536_000}
        cookieFormat="expanded-collapsed"
        style={
          {
            "--sidebar-width": "var(--sidebar-width-expanded)",
            "--sidebar-width-icon": "var(--sidebar-width-collapsed)",
          } as React.CSSProperties
        }
      >
        <div className="flex min-h-dvh w-full bg-background text-foreground">
          <Sidebar
            id="office-sidebar"
            role="complementary"
            aria-label={labels.main}
            data-collapsed={collapsed}
            collapsible="none"
            style={{
              width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width-expanded)",
            }}
            className={cn(
              "sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none md:flex",
            )}
          >
            <SidebarHeader className="min-h-[4.75rem] shrink-0 p-0">
              <SidebarBrand
                href={groups[0]?.items[0]?.href ?? "/"}
                label={labels.brand}
                collapsed={collapsed}
                mobileView={false}
              />
            </SidebarHeader>
            <SidebarSeparator className="mx-0 shrink-0" />
            <SidebarContent className="office-sidebar-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-3">
              <NavigationGroups
                groups={groups}
                activeItemId={activeItem?.id}
                collapsed={collapsed}
                mobileView={false}
                closeMobile={() => undefined}
              />
            </SidebarContent>
            <SidebarFooter className="mt-auto border-t border-sidebar-border p-0">
              <div className="flex min-w-0 items-center">
                <span
                  className={cn(
                    "flex h-[4.75rem] w-[var(--sidebar-width-collapsed)] shrink-0 items-center justify-center text-sidebar-foreground transition-transform duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
                    !collapsed && "translate-x-2.5",
                  )}
                  title={tenantName}
                >
                  <span
                    className="flex size-11 items-center justify-center rounded-full border border-sidebar-border bg-background text-sm font-semibold text-foreground"
                    aria-hidden="true"
                  >
                    {tenantInitial}
                  </span>
                </span>
                <div
                  className={cn(
                    "ml-[18px] grid min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
                    collapsed
                      ? "max-w-0 -translate-x-1 opacity-0"
                      : "max-w-44 translate-x-0 opacity-100",
                  )}
                  aria-hidden={collapsed}
                >
                  <p className="truncate text-sm font-medium" title={tenantName}>
                    {tenantName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{labels.brand}</p>
                </div>
              </div>
            </SidebarFooter>
          </Sidebar>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur md:h-[4.75rem] sm:px-5 lg:px-7">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 md:hidden"
                    aria-label={labels.openMenu}
                    aria-expanded={mobileOpen}
                    aria-controls="office-mobile-navigation"
                  >
                    <Menu className="size-5" aria-hidden="true" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  className="p-0"
                  closeLabel={labels.closeMenu}
                  aria-describedby={undefined}
                  onCloseAutoFocus={(event) => {
                    if (window.matchMedia("(min-width: 768px)").matches) {
                      event.preventDefault();
                      pageContextRef.current?.focus({ preventScroll: true });
                    }
                  }}
                >
                  <SheetHeader className="border-b border-sidebar-border px-4 py-4 pr-14">
                    <SheetTitle className="sr-only">{labels.main}</SheetTitle>
                    <SheetDescription className="sr-only">{tenantName}</SheetDescription>
                    <SidebarBrand
                      href={groups[0]?.items[0]?.href ?? "/"}
                      label={labels.brand}
                      collapsed={false}
                      mobileView
                      onNavigate={() => setMobileOpen(false)}
                    />
                  </SheetHeader>
                  <nav
                    id="office-mobile-navigation"
                    aria-label={labels.main}
                    className="min-h-0 flex-1 overflow-y-auto px-2 py-3"
                  >
                    <NavigationGroups
                      groups={groups}
                      activeItemId={activeItem?.id}
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

              <SidebarTrigger
                className="hidden shrink-0 rounded-full md:inline-flex"
                aria-label={collapsed ? labels.expand : labels.collapse}
                label={collapsed ? labels.expand : labels.collapse}
                title={collapsed ? labels.expand : labels.collapse}
                aria-expanded={!collapsed}
                aria-controls="office-sidebar"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                )}
              </SidebarTrigger>

              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground md:hidden">
                  <HeartHandshake className="size-4" aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "hidden shrink-0 text-sm font-semibold sm:inline",
                    !collapsed && "md:hidden",
                  )}
                >
                  {labels.brand}
                </span>
                <Separator
                  orientation="vertical"
                  className={cn("hidden h-7 sm:block", !collapsed && "md:hidden")}
                />
                <span
                  id="office-page-context"
                  ref={pageContextRef}
                  tabIndex={-1}
                  className="min-w-0 truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-current="page"
                >
                  {activeItem?.label ?? labels.overview}
                </span>
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">
                  {tenantName}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <ThemeSwitcher />
                <div className="hidden sm:block">
                  <LanguageSwitcher locale={locale} />
                </div>
                <AccountMenu
                  profileName={profileName}
                  email={email}
                  tenantName={tenantName}
                  locale={locale}
                  mobileLanguageOnly
                  labels={{ account: labels.account, changeTenant: labels.changeTenant }}
                  signOut={signOut}
                />
              </div>
              <NavigationProgress />
            </header>

            <main className="mx-auto w-full max-w-[1680px] min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function SidebarBrand({
  href,
  label,
  collapsed,
  mobileView,
  onNavigate,
}: {
  href: string;
  label: string;
  collapsed: boolean;
  mobileView: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center overflow-hidden text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        mobileView ? "min-h-16" : "min-h-[4.75rem]",
        mobileView ? "gap-3 px-2" : "px-0",
      )}
      aria-label={label}
      {...(onNavigate ? { onClick: onNavigate } : {})}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center transition-transform duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
          mobileView ? "size-10" : "h-[4.75rem] w-[var(--sidebar-width-collapsed)]",
          !mobileView && !collapsed && "translate-x-2.5",
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm",
            mobileView ? "size-9" : "size-11",
          )}
        >
          <HeartHandshake className={cn("size-5", !mobileView && "size-6")} aria-hidden="true" />
        </span>
      </span>
      <span
        className={cn(
          "min-w-0 overflow-hidden truncate whitespace-nowrap font-semibold transition-[max-width,opacity,transform] duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
          mobileView ? "text-sm" : "text-lg",
          !mobileView && "ml-[18px]",
          !mobileView && collapsed
            ? "max-w-0 -translate-x-1 opacity-0"
            : "max-w-40 translate-x-0 opacity-100",
        )}
        aria-hidden={!mobileView && collapsed}
      >
        {label}
      </span>
    </Link>
  );
}

function NavigationGroups({
  groups,
  activeItemId,
  collapsed,
  mobileView,
  closeMobile,
}: {
  groups: OfficeNavigationGroup[];
  activeItemId?: string | undefined;
  collapsed: boolean;
  mobileView: boolean;
  closeMobile: () => void;
}) {
  return (
    <div className={cn("grid", mobileView || !collapsed ? "gap-7" : "gap-5")}>
      {groups.map((group) => (
        <SidebarGroup key={group.id} className="grid gap-2 p-0">
          <SidebarGroupLabel
            className={cn(
              "block h-auto w-full overflow-hidden rounded-none p-0 text-sm font-semibold uppercase leading-tight tracking-[0.12em] text-muted-foreground transition-[max-height,opacity,transform] duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
              mobileView || !collapsed
                ? mobileView
                  ? "max-h-10 translate-y-0 px-3 pb-1 opacity-100"
                  : "max-h-10 translate-y-0 pb-1 pl-[calc(var(--sidebar-width-collapsed)+1.125rem)] pr-4 opacity-100"
                : "max-h-0 translate-y-1 p-0 opacity-0",
            )}
            aria-hidden={collapsed && !mobileView}
          >
            {group.label}
          </SidebarGroupLabel>
          <SidebarMenu
            className={cn(
              "grid",
              collapsed && !mobileView ? "gap-1.5" : "gap-2",
              mobileView && "px-2",
            )}
          >
            {group.items.map((item) => {
              const Icon = icons[item.id] ?? Activity;
              const isActive = activeItemId === item.id;
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    size="lg"
                    {...(!mobileView && collapsed ? { tooltip: item.label } : {})}
                    className={cn(
                      "relative isolate min-w-0 overflow-hidden rounded-2xl p-0 font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-transparent data-[active=true]:text-sidebar-accent-foreground",
                      mobileView
                        ? "min-h-11 gap-3 px-3 text-base hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent"
                        : collapsed
                          ? "mx-auto h-11 w-11 justify-center text-sm hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent"
                          : "min-h-14 w-full text-base before:pointer-events-none before:absolute before:inset-y-1 before:left-3 before:right-3 before:z-0 before:rounded-xl before:bg-sidebar-accent before:shadow-sm before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100 data-[active=true]:before:opacity-100",
                      isActive && "text-sidebar-accent-foreground",
                    )}
                  >
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={!mobileView && collapsed ? item.label : undefined}
                      onClick={closeMobile}
                    >
                      <span
                        className={cn(
                          "z-10 flex shrink-0 items-center justify-center",
                          mobileView
                            ? "size-10"
                            : collapsed
                              ? "absolute inset-y-0 left-0 w-full"
                              : "absolute inset-y-0 left-0 w-[var(--sidebar-width-collapsed)]",
                          !mobileView && !collapsed && "translate-x-2.5",
                          !mobileView &&
                            "transition-transform duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
                        )}
                      >
                        <Icon className="size-5" strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      {mobileView ? (
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap">
                          {item.label}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "absolute inset-y-0 z-10 flex min-w-0 items-center overflow-hidden truncate whitespace-nowrap transition-[opacity,transform] duration-[var(--sidebar-transition-duration)] ease-[var(--sidebar-transition-easing)] motion-reduce:transition-none",
                            isActive && !collapsed ? "right-12" : "right-3",
                            collapsed
                              ? "left-[var(--sidebar-width-collapsed)] text-sm"
                              : "left-[calc(var(--sidebar-width-collapsed)+1.125rem)] text-base",
                            collapsed ? "translate-x-1 opacity-0" : "translate-x-0 opacity-100",
                          )}
                          aria-hidden={collapsed}
                        >
                          {item.label}
                        </span>
                      )}
                      {isActive ? (
                        <span
                          className={cn(
                            "absolute z-10 size-1.5 rounded-full bg-primary",
                            !mobileView && !collapsed ? "right-5" : "right-3",
                            collapsed && !mobileView && "hidden",
                          )}
                        />
                      ) : null}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </div>
  );
}

function isNavigationItemActive(item: { id: string; href: string }, pathname: string) {
  if (item.id === "overview") return pathname === "/operations";
  if (item.id === "operations" && pathname.startsWith("/operations/")) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
