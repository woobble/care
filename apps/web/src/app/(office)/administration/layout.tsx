import Link from 'next/link';

export default function AdministrationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="grid gap-6">
      <nav aria-label="Administration" className="flex flex-wrap gap-2 border-b pb-3 text-sm">
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/users"
        >
          Users &amp; Access
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/organizations"
        >
          Organizations
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/facilities"
        >
          Facilities
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/teams"
        >
          Teams
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/qualifications"
        >
          Qualifications &amp; skills
        </Link>
        <Link
          className="rounded-md px-3 py-2 text-blue-900 underline-offset-4 hover:underline"
          href="/administration/audit"
        >
          Audit Log
        </Link>
      </nav>
      {children}
    </div>
  );
}
