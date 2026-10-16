import Link from 'next/link';
import type { ReactNode } from 'react';

/** Displays a resolved resource label and only links when the caller has verified access. */
export function ResourceReference({
  label,
  href,
  children,
  description,
  icon,
  truncate = false,
  className = '',
}: {
  label: string;
  href?: string | null;
  children?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  truncate?: boolean;
  className?: string;
}) {
  const content = (
    <>
      <span className="flex max-w-full min-w-0 items-center gap-1.5">
        {icon ? (
          <span aria-hidden="true" className="shrink-0">
            {icon}
          </span>
        ) : null}
        <span className={truncate ? 'truncate' : 'min-w-0 break-words'}>{children ?? label}</span>
      </span>
      {description ? (
        <span className="block text-xs text-muted-foreground">{description}</span>
      ) : null}
    </>
  );
  const classes = `inline-flex min-w-0 max-w-full flex-col align-baseline ${className}`.trim();

  return href ? (
    <Link
      href={href}
      title={label}
      className={`${classes} text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none`}
    >
      {content}
    </Link>
  ) : (
    <span title={label} className={classes}>
      {content}
    </span>
  );
}

/** Wraps a resource row in a link only when the caller has verified access to the target. */
export function ResourceCardLink({
  href,
  children,
  className,
}: {
  href?: string | null;
  children: ReactNode;
  className: string;
}) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}
