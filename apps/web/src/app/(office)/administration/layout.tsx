import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function AdministrationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const t = await getTranslations('Navigation');
  return (
    <div className="grid gap-6">
      <nav aria-label={t('administration')} className="flex flex-wrap gap-2 border-b pb-3 text-sm">
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/users"
        >
          {t('users')}
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/organizations"
        >
          {t('organizations')}
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/facilities"
        >
          {t('facilities')}
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/teams"
        >
          {t('teams')}
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/qualifications"
        >
          {t('qualifications')}
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/competency-policies"
        >
          {t('competencyPolicies')}
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/audit"
        >
          {t('audit')}
        </Link>
      </nav>
      {children}
    </div>
  );
}
