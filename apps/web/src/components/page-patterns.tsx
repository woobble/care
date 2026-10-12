import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight, Inbox } from 'lucide-react';
import { Card } from '@care/ui';

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex w-full min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid min-w-0 gap-1.5">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="break-words text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] sm:text-3xl">
          {title}
        </h1>
        {meta ? <div>{meta}</div> : null}
        {description ? (
          <p className="max-w-3xl break-words text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string | number;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-accent/45">
        <div className="flex min-h-24 items-start justify-between gap-3 p-4 sm:p-5">
          <div className="grid min-w-0 gap-2">
            <span className="text-sm leading-5 text-muted-foreground">{label}</span>
            <strong className="text-2xl font-semibold tabular-nums tracking-tight">{value}</strong>
          </div>
          <ArrowUpRight
            className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
            aria-hidden="true"
          />
        </div>
      </Card>
    </Link>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-5 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="size-5" aria-hidden="true" />
      </span>
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
