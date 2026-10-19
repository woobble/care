'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@care/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@care/ui/components/collapsible';

export function FilterDisclosure({
  title,
  children,
  defaultOpenOnDesktop = true,
  desktopToggle = false,
}: Readonly<{
  title: string;
  children: ReactNode;
  defaultOpenOnDesktop?: boolean;
  desktopToggle?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpenOnDesktop);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const syncDisclosureToViewport = () => {
      setOpen(desktop.matches && defaultOpenOnDesktop);
    };
    syncDisclosureToViewport();
    desktop.addEventListener('change', syncDisclosureToViewport);
    return () => desktop.removeEventListener('change', syncDisclosureToViewport);
  }, [defaultOpenOnDesktop]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group min-w-0 rounded-xl border border-border bg-card"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={`group flex min-h-11 w-full justify-between rounded-none px-4 py-2 text-left text-sm font-semibold ${desktopToggle ? '' : 'md:hidden'}`}
        >
          {title}
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="p-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
