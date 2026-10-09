import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';

type SettingsFormAction = (formData: FormData) => void | Promise<void>;
type WorkforceComplianceTranslator = Awaited<
  ReturnType<typeof getTranslations<'WorkforceCompliance'>>
>;

export function WorkforceCompliancePageHeader({
  section,
  title,
  description,
}: Readonly<{ section: string; title: string; description: string }>) {
  return (
    <header className="grid gap-1">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
        <Link href="/administration">{section}</Link>
      </p>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="text-slate-700">{description}</p>
    </header>
  );
}

export function WorkforceComplianceSection({
  id,
  title,
  description,
  children,
}: Readonly<{ id?: string; title: string; description: string; children: React.ReactNode }>) {
  return (
    <section id={id} className="grid gap-4 rounded-lg border bg-white p-5">
      <header className="grid gap-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-slate-600">{description}</p>
      </header>
      {children}
    </section>
  );
}

export function WorkforceComplianceNotice({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      {children}
    </p>
  );
}

export function WorkforceComplianceSettingsForm({
  criticalDays,
  warningDays,
  reportingTimezone,
  version,
  canManage,
  action,
  t,
}: Readonly<{
  criticalDays: number;
  warningDays: number;
  reportingTimezone: string;
  version: number;
  canManage: boolean;
  action: SettingsFormAction;
  t: WorkforceComplianceTranslator;
}>) {
  return (
    <section className="grid gap-4 rounded-lg border bg-white p-5">
      <header className="grid gap-1">
        <h2 className="text-xl font-semibold">{t('settingsTitle')}</h2>
        <p className="text-sm text-slate-600">{t('settingsDescription')}</p>
      </header>
      <form action={action} className="grid gap-4 md:grid-cols-3">
        <input type="hidden" name="expectedVersion" value={version} />
        <div className="grid content-start gap-2">
          <Label htmlFor="criticalDays">{t('criticalDays')}</Label>
          <Input
            id="criticalDays"
            name="criticalDays"
            type="number"
            min={1}
            max={365}
            step={1}
            required
            defaultValue={criticalDays}
            readOnly={!canManage}
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="warningDays">{t('warningDays')}</Label>
          <Input
            id="warningDays"
            name="warningDays"
            type="number"
            min={1}
            max={365}
            step={1}
            required
            defaultValue={warningDays}
            readOnly={!canManage}
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="reportingTimezone">{t('reportingTimezone')}</Label>
          <Input
            id="reportingTimezone"
            name="reportingTimezone"
            maxLength={100}
            required
            defaultValue={reportingTimezone}
            readOnly={!canManage}
          />
          <p className="text-xs text-slate-600">{t('timezoneHint')}</p>
        </div>
        {canManage ? (
          <div className="md:col-span-3">
            <Button type="submit">{t('saveSettings')}</Button>
          </div>
        ) : (
          <p className="text-sm text-slate-600 md:col-span-3">{t('settingsReadOnly')}</p>
        )}
      </form>
    </section>
  );
}
