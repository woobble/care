import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@care/ui';
import { getApiClient } from '../../lib/api';
import { signOutAction } from '../actions/auth';

export default async function OfficeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const api = await getApiClient(false);
  const get = api.GET;
  const { data: tenants, error } = await get('/api/v1/me/tenants');
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (error || !tenantId || !tenants?.some((tenant) => tenant.id === tenantId)) redirect('/');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <nav
          className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4"
          aria-label="Hauptnavigation"
        >
          <Link className="font-semibold text-blue-900" href="/clients">
            Care Platform
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/administration/users">Administration</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/">Mandant wechseln</Link>
            </Button>
            <form action={signOutAction}>
              <Button variant="link" size="sm">
                Abmelden
              </Button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
