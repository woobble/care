import { Badge } from './components/badge';

export { Badge, badgeVariants } from './components/badge';
export type { BadgeProps } from './components/badge';
export { Button, buttonVariants } from './components/button';
export type { ButtonProps } from './components/button';
export { Input } from './components/input';
export { Label } from './components/label';
export { cn } from './lib/utils';

export function StatusBadge({
  status,
  label,
}: {
  status: 'pending' | 'active' | 'inactive' | 'revoked' | 'archived';
  label: string;
}) {
  const variants = {
    pending: 'warning',
    active: 'success',
    inactive: 'secondary',
    revoked: 'destructive',
    archived: 'secondary',
  } as const;
  return <Badge variant={variants[status]}>{label}</Badge>;
}
