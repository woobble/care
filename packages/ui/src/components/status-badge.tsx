import { Badge } from './badge';

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
