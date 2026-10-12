import { Badge } from './components/badge';

export { Badge, badgeVariants } from './components/badge';
export type { BadgeProps } from './components/badge';
export { Button, buttonVariants } from './components/button';
export type { ButtonProps } from './components/button';
export { Input } from './components/input';
export { Label } from './components/label';
export { cn } from './lib/utils';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card';
export { Separator } from './components/separator';
export { Skeleton } from './components/skeleton';
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/table';
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/tooltip';
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './components/sheet';

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
