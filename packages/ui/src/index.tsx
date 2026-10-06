import { Badge } from './components/badge';

export { Badge, badgeVariants } from './components/badge';
export type { BadgeProps } from './components/badge';
export { Button, buttonVariants } from './components/button';
export type { ButtonProps } from './components/button';
export { Input } from './components/input';
export { Label } from './components/label';
export { cn } from './lib/utils';

export function StatusBadge({ status }: { status: 'pending' | 'active' | 'archived' }) {
  const labels = { pending: 'Ausstehend', active: 'Aktiv', archived: 'Archiviert' };
  const variants = { pending: 'warning', active: 'success', archived: 'secondary' } as const;
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}
