'use client';

import type { ReactNode, RefObject } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@care/ui/components/sheet';

export default function OfficeMobileNavigation({
  open,
  onOpenChange,
  mainLabel,
  brandLabel,
  closeLabel,
  tenantName,
  pageContextRef,
  triggerRef,
  brand,
  navigation,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mainLabel: string;
  brandLabel: string;
  closeLabel: string;
  tenantName: string;
  pageContextRef: RefObject<HTMLSpanElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  brand: ReactNode;
  navigation: ReactNode;
}>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="p-0"
        closeLabel={closeLabel}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (window.matchMedia('(min-width: 768px)').matches) {
            pageContextRef.current?.focus({ preventScroll: true });
          } else {
            triggerRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        <SheetHeader className="border-b border-sidebar-border px-4 py-4 pr-14">
          <SheetTitle className="sr-only">{mainLabel}</SheetTitle>
          <SheetDescription className="sr-only">{tenantName}</SheetDescription>
          {brand}
        </SheetHeader>
        <nav
          id="office-mobile-navigation"
          aria-label={mainLabel}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-3"
        >
          {navigation}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <p className="truncate text-sm font-medium">{tenantName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{brandLabel}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
