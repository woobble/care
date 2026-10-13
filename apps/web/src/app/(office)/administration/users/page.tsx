import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui';
import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Label, StatusBadge } from '@care/ui';
import { roleLabelKey, scopeTypeLabelKey } from '@app/web/i18n/access';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import { statusLabelKey } from '@app/web/i18n/status';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import {
  inviteUserAction,
  revokeInvitationAction,
} from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';

type SearchParams = Promise<{
  status?: string;
  error?: string;
  invited?: string;
  updated?: string;
}>;

export default async function UsersAccessPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const status = ['pending', 'active', 'inactive', 'revoked'].includes(params.status ?? '')
    ? (params.status as 'pending' | 'active' | 'inactive' | 'revoked')
    : undefined;
  const api = await getApiClient();
  const get = api.GET;
  const [membersResult, invitationsResult] = await Promise.all([
    get('/api/v1/admin/members', {
      params: {
        query: { page: 1, pageSize: 100, ...(status ? { status } : {}) },
        header: await getTenantHeader(),
      },
    }),
    get('/api/v1/admin/invitations', { params: { header: await getTenantHeader() } }),
  ]);

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href="/administration">{t('Organizations.section')}</Link>}
        title={t('Users.title')}
        description={t('Users.description')}
      />

      {params.error ? <ErrorNotice code={params.error} /> : null}
      {params.invited ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('Users.invitationCreated')}
        </p>
      ) : null}
      {params.updated ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {t('Users.accessUpdated')}
        </p>
      ) : null}

      <section aria-labelledby="invite-title" className="grid gap-4 rounded-lg border bg-card p-5">
        <div>
          <h2 id="invite-title" className="text-xl font-semibold">
            {t('Users.inviteTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Users.inviteDescription')}</p>
        </div>
        <RHFActionForm action={inviteUserAction} className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">{t('Users.email')}</Label>
            <input
              id="invite-email"
              className="h-10 rounded-md border px-3"
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              required
            />
          </div>
          <Button type="submit">{t('Users.createInvitation')}</Button>
        </RHFActionForm>
      </section>

      <section aria-labelledby="members-title" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="members-title" className="text-xl font-semibold">
            {t('Users.membersTitle')}
          </h2>
          <form method="get" className="flex items-end gap-2">
            <label className="grid gap-1 text-sm" htmlFor="member-status">
              {t('Users.status')}
              <NativeSelect
                id="member-status"
                name="status"
                defaultValue={status ?? ''}
                selectClassName="h-10 rounded-md border bg-card px-3"
                className="w-full"
              >
                <option value="">{t('Users.allStatuses')}</option>
                <option value="pending">{t('Common.status.pending')}</option>
                <option value="active">{t('Common.status.active')}</option>
                <option value="inactive">{t('Common.status.inactive')}</option>
                <option value="revoked">{t('Common.status.revoked')}</option>
              </NativeSelect>
            </label>
            <Button variant="secondary" type="submit">
              {t('Users.filter')}
            </Button>
          </form>
        </div>
        {membersResult.error ? (
          <ErrorNotice code={membersResult.error.code} />
        ) : membersResult.data?.items.length ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Users.membersCaption')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.name')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.email')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.status')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.roles')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.scope')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {membersResult.data.items.map((member) => (
                  <ShadcnTableRow key={member.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3">
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        href={`/administration/users/${member.id}`}
                      >
                        {member.displayName || member.email || t('Resources.unavailableUser')}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">{member.email || '—'}</ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <StatusBadge
                        status={member.status}
                        label={t(statusLabelKey(member.status))}
                      />
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {member.roles.map((role) => t(roleLabelKey(role.name))).join(', ') || '—'}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {member.scopes
                        .map((scope) =>
                          scope.scopeType === 'tenant'
                            ? t('Users.entireTenant')
                            : t('Users.scopeLabel', {
                                name: scope.name || t('Resources.unavailableScope'),
                                scope: t(scopeTypeLabelKey(scope.scopeType)),
                              }),
                        )
                        .join(', ') || t('Users.noScope')}
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="rounded-lg border bg-card p-5 text-muted-foreground">
            {t('Users.noMembers')}
          </p>
        )}
      </section>

      <section aria-labelledby="invitations-title" className="grid gap-4">
        <h2 id="invitations-title" className="text-xl font-semibold">
          {t('Users.invitationsTitle')}
        </h2>
        {invitationsResult.error ? (
          <ErrorNotice code={invitationsResult.error.code} />
        ) : invitationsResult.data?.length ? (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Users.invitationsCaption')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-muted text-muted-foreground">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.email')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.status')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Users.expires')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    <span className="sr-only">{t('Users.actions')}</span>
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {invitationsResult.data.map((invitation) => (
                  <ShadcnTableRow key={invitation.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3">{invitation.email}</ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {t(statusLabelKey(invitation.status))}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {formatDate(invitation.expiresAt, locale)}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3 text-right">
                      {invitation.status === 'pending' ? (
                        <form action={revokeInvitationAction}>
                          <input type="hidden" name="invitationId" value={invitation.id} />
                          <ConfirmSubmitButton
                            confirmation={t('Users.revokeInvitationConfirmation')}
                          >
                            {t('Users.revokeInvitation')}
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="rounded-lg border bg-card p-5 text-muted-foreground">
            {t('Users.noInvitations')}
          </p>
        )}
      </section>
    </div>
  );
}

async function ErrorNotice({ code }: Readonly<{ code: string }>) {
  const t = await getTranslations();
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
    >
      {t(errorMessageKey(code))}
    </p>
  );
}
