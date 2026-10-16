import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { revokeInvitationAction } from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import { InvitationForm } from '@app/web/app/(office)/administration/invitation-form';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { DataPagination } from '@app/web/components/data-pagination';
import { PageHeader } from '@app/web/components/page-patterns';
import { roleLabelKey, scopeTypeLabelKey } from '@app/web/i18n/access';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate } from '@app/web/i18n/format';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { NativeSelect } from '@care/ui/components/native-select';
import { StatusBadge } from '@care/ui/components/status-badge';
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui/components/table';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  roleId?: string;
  scopeType?: string;
  organizationId?: string;
  facilityId?: string;
  page?: string;
  pageSize?: string;
  invitationPage?: string;
  invitationPageSize?: string;
  invitationStatus?: string;
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
  const q = params.q?.trim().slice(0, 120) || undefined;
  const roleId = isUuid(params.roleId) ? params.roleId : undefined;
  const scopeType = ['tenant', 'organization', 'facility', 'team'].includes(params.scopeType ?? '')
    ? (params.scopeType as 'tenant' | 'organization' | 'facility' | 'team')
    : undefined;
  const organizationId = isUuid(params.organizationId) ? params.organizationId : undefined;
  const facilityId = isUuid(params.facilityId) ? params.facilityId : undefined;
  const invitationStatus = ['pending', 'accepted', 'expired', 'revoked'].includes(
    params.invitationStatus ?? '',
  )
    ? (params.invitationStatus as 'pending' | 'accepted' | 'expired' | 'revoked')
    : undefined;
  const page = parsePage(params.page);
  const pageSize = parsePageSize(params.pageSize);
  const invitationPage = parsePage(params.invitationPage);
  const invitationPageSize = parsePageSize(params.invitationPageSize);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canReadRoles = hasPermission(permissions, 'tenant.roles.read');
  const canReadOrganizations = hasPermission(permissions, 'organization.read');
  const canReadFacilities = hasPermission(permissions, 'facility.read');
  const [membersResult, invitationsResult, rolesResult, organizationResult, facilityResult] =
    await Promise.all([
      get('/api/v1/admin/members', {
        params: {
          query: {
            page,
            pageSize,
            ...(status ? { status } : {}),
            ...(q ? { q } : {}),
            ...(roleId && canReadRoles ? { roleId } : {}),
            ...(scopeType ? { scopeType } : {}),
            ...(organizationId && canReadOrganizations ? { organizationId } : {}),
            ...(facilityId && canReadFacilities ? { facilityId } : {}),
          },
          header,
        },
      }),
      get('/api/v1/admin/invitations', {
        params: {
          query: {
            page: invitationPage,
            pageSize: invitationPageSize,
            ...(invitationStatus ? { status: invitationStatus } : {}),
          },
          header,
        },
      }),
      canReadRoles
        ? get('/api/v1/admin/roles', { params: { header } })
        : Promise.resolve({ data: [] }),
      organizationId && canReadOrganizations
        ? get('/api/v1/organizations/{id}', { params: { path: { id: organizationId }, header } })
        : Promise.resolve({ data: undefined }),
      facilityId && canReadFacilities
        ? get('/api/v1/facilities/{id}', { params: { path: { id: facilityId }, header } })
        : Promise.resolve({ data: undefined }),
    ]);
  const members = membersResult.data as unknown as
    | components['schemas']['TenantMemberListDto']
    | undefined;
  const memberError = membersResult.error as { code?: string } | undefined;
  const invitations = invitationsResult.data as unknown as
    | components['schemas']['TenantInvitationListDto']
    | undefined;
  const invitationError = invitationsResult.error as { code?: string } | undefined;
  const roles = rolesResult.data as components['schemas']['TenantRoleDto'][] | undefined;
  const memberFilters = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(roleId && canReadRoles ? { roleId } : {}),
    ...(scopeType ? { scopeType } : {}),
    ...(organizationId && canReadOrganizations ? { organizationId } : {}),
    ...(facilityId && canReadFacilities ? { facilityId } : {}),
  };
  const invitationFilters = {
    ...(invitationStatus ? { invitationStatus } : {}),
  };
  const persistentFilters = {
    ...memberFilters,
    ...invitationFilters,
    invitationPage: String(invitationPage),
    invitationPageSize: String(invitationPageSize),
  };
  if (members) {
    redirectToValidPage(
      '/administration/users',
      { ...persistentFilters, pageSize: String(pageSize) },
      page,
      pageSize,
      members.total,
    );
  }
  if (invitations) {
    redirectToValidPage(
      '/administration/users',
      {
        ...persistentFilters,
        page: String(page),
        pageSize: String(pageSize),
      },
      invitationPage,
      invitationPageSize,
      invitations.total,
      'invitationPage',
      'invitationPageSize',
    );
  }
  const memberRows = (members?.items ?? []).map((member) => ({
    member,
    name: member.displayName || member.email || t('Resources.unavailableUser'),
    roles: member.roles.map((role) => t(roleLabelKey(role.name))).join(', ') || '—',
    scopes:
      member.scopes
        .map((scope) =>
          scope.scopeType === 'tenant'
            ? t('Users.entireTenant')
            : t('Users.scopeLabel', {
                name: scope.name || t('Resources.unavailableScope'),
                scope: t(scopeTypeLabelKey(scope.scopeType)),
              }),
        )
        .join(', ') || t('Users.noScope'),
  }));

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={<Link href="/administration">{t('Navigation.administration')}</Link>}
        title={t('Users.title')}
        description={t('Users.description')}
      />

      {params.error ? <ErrorNotice code={params.error} /> : null}
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
        <InvitationForm
          labels={{
            email: t('Users.email'),
            createInvitation: t('Users.createInvitation'),
            creatingInvitation: t('Users.creatingInvitation'),
            invitationCreated: t('Users.invitationCreated'),
          }}
        />
      </section>

      <section aria-labelledby="members-title" className="grid gap-4">
        <h2 id="members-title" className="text-xl font-semibold">
          {t('Users.membersTitle')}
        </h2>
        <form
          method="get"
          className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <input type="hidden" name="pageSize" value={pageSize} />
          <input type="hidden" name="invitationPage" value={invitationPage} />
          <input type="hidden" name="invitationPageSize" value={invitationPageSize} />
          {invitationStatus ? (
            <input type="hidden" name="invitationStatus" value={invitationStatus} />
          ) : null}
          <label className="grid min-w-0 gap-1.5 text-sm" htmlFor="member-search">
            {t('Users.searchMembers')}
            <Input
              id="member-search"
              name="q"
              type="search"
              maxLength={120}
              defaultValue={q}
              placeholder={t('Users.searchMembersPlaceholder')}
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-sm" htmlFor="member-status">
            {t('Users.status')}
            <NativeSelect
              id="member-status"
              name="status"
              defaultValue={status ?? ''}
              selectClassName="h-10 rounded-md border bg-background px-3"
              className="w-full"
            >
              <option value="">{t('Users.allStatuses')}</option>
              <option value="pending">{t('Common.status.pending')}</option>
              <option value="active">{t('Common.status.active')}</option>
              <option value="inactive">{t('Common.status.inactive')}</option>
              <option value="revoked">{t('Common.status.revoked')}</option>
            </NativeSelect>
          </label>
          {canReadRoles ? (
            <label className="grid min-w-0 gap-1.5 text-sm" htmlFor="member-role">
              {t('Users.role')}
              <NativeSelect
                id="member-role"
                name="roleId"
                defaultValue={roleId ?? ''}
                selectClassName="h-10 rounded-md border bg-background px-3"
                className="w-full"
              >
                <option value="">{t('Users.allRoles')}</option>
                {(roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {t(roleLabelKey(role.name))}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <label className="grid min-w-0 gap-1.5 text-sm" htmlFor="member-scope-type">
            {t('Users.scope')}
            <NativeSelect
              id="member-scope-type"
              name="scopeType"
              defaultValue={scopeType ?? ''}
              selectClassName="h-10 rounded-md border bg-background px-3"
              className="w-full"
            >
              <option value="">{t('Users.allScopes')}</option>
              {(['tenant', 'organization', 'facility', 'team'] as const).map((type) => (
                <option key={type} value={type}>
                  {t(scopeTypeLabelKey(type))}
                </option>
              ))}
            </NativeSelect>
          </label>
          {canReadOrganizations ? (
            <AsyncEntityCombobox
              name="organizationId"
              label={t('Users.organizationScope')}
              entity="organizations"
              minQueryLength={2}
              initialOption={
                organizationResult.data
                  ? { id: organizationResult.data.id, label: organizationResult.data.name }
                  : undefined
              }
              placeholder={t('Users.chooseOrganization')}
            />
          ) : null}
          {canReadFacilities ? (
            <AsyncEntityCombobox
              name="facilityId"
              label={t('Users.facilityScope')}
              entity="facilities"
              minQueryLength={2}
              initialOption={
                facilityResult.data
                  ? { id: facilityResult.data.id, label: facilityResult.data.name }
                  : undefined
              }
              placeholder={t('Users.chooseFacility')}
            />
          ) : null}
          <div className="flex items-end">
            <Button variant="secondary" type="submit">
              {t('Users.filter')}
            </Button>
          </div>
        </form>
        {memberError ? (
          <ErrorNotice code={memberError.code ?? ''} />
        ) : memberRows.length ? (
          <>
            <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
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
                  {memberRows.map(({ member, name, roles: roleSummary, scopes }) => (
                    <ShadcnTableRow key={member.id} className="border-b last:border-0">
                      <ShadcnTableCell className="px-4 py-3">
                        <Link
                          className="font-medium text-primary underline-offset-4 hover:underline"
                          href={`/administration/users/${member.id}`}
                        >
                          {name}
                        </Link>
                      </ShadcnTableCell>
                      <ShadcnTableCell className="px-4 py-3">{member.email || '—'}</ShadcnTableCell>
                      <ShadcnTableCell className="px-4 py-3">
                        <StatusBadge
                          status={member.status}
                          label={t(statusLabelKey(member.status))}
                        />
                      </ShadcnTableCell>
                      <ShadcnTableCell className="px-4 py-3">{roleSummary}</ShadcnTableCell>
                      <ShadcnTableCell className="px-4 py-3">{scopes}</ShadcnTableCell>
                    </ShadcnTableRow>
                  ))}
                </ShadcnTableBody>
              </ShadcnTable>
            </div>
            <div className="grid gap-3 md:hidden">
              {memberRows.map(({ member, name, roles: roleSummary, scopes }) => (
                <article key={member.id} className="grid gap-3 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      className="min-w-0 font-semibold text-primary underline-offset-4 hover:underline"
                      href={`/administration/users/${member.id}`}
                    >
                      <span className="break-words">{name}</span>
                    </Link>
                    <StatusBadge status={member.status} label={t(statusLabelKey(member.status))} />
                  </div>
                  <p className="break-all text-sm text-muted-foreground">{member.email || '—'}</p>
                  <dl className="grid gap-2 text-sm">
                    <div>
                      <dt className="font-medium">{t('Users.roles')}</dt>
                      <dd className="text-muted-foreground">{roleSummary}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">{t('Users.scope')}</dt>
                      <dd className="break-words text-muted-foreground">{scopes}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-lg border bg-card p-5 text-muted-foreground">
            {t('Users.noMembers')}
          </p>
        )}
        {members ? (
          <DataPagination
            pathname="/administration/users"
            page={members.page}
            pageSize={members.pageSize}
            totalItems={members.total}
            filters={{ ...memberFilters, ...invitationFilters, invitationPage, invitationPageSize }}
          />
        ) : null}
      </section>

      <section aria-labelledby="invitations-title" className="grid gap-4">
        <h2 id="invitations-title" className="text-xl font-semibold">
          {t('Users.invitationsTitle')}
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          {Object.entries(memberFilters).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <input type="hidden" name="page" value={page} />
          <input type="hidden" name="pageSize" value={pageSize} />
          <input type="hidden" name="invitationPageSize" value={invitationPageSize} />
          <label className="grid gap-1.5 text-sm" htmlFor="invitation-status">
            {t('Users.invitationStatus')}
            <NativeSelect
              id="invitation-status"
              name="invitationStatus"
              defaultValue={invitationStatus ?? ''}
              selectClassName="h-10 rounded-md border bg-background px-3"
            >
              <option value="">{t('Users.allInvitationStatuses')}</option>
              {(['pending', 'accepted', 'expired', 'revoked'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(statusLabelKey(value))}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button variant="secondary" type="submit">
            {t('Users.filter')}
          </Button>
        </form>
        {invitationError ? (
          <ErrorNotice code={invitationError.code ?? ''} />
        ) : invitations?.items.length ? (
          <>
            <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
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
                  {invitations.items.map((invitation) => (
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
            <div className="grid gap-3 md:hidden">
              {invitations.items.map((invitation) => (
                <article key={invitation.id} className="grid gap-3 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-all font-medium">{invitation.email}</span>
                    <span className="shrink-0 text-sm">{t(statusLabelKey(invitation.status))}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('Users.expires')}: {formatDate(invitation.expiresAt, locale)}
                  </p>
                  {invitation.status === 'pending' ? (
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <ConfirmSubmitButton confirmation={t('Users.revokeInvitationConfirmation')}>
                        {t('Users.revokeInvitation')}
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-lg border bg-card p-5 text-muted-foreground">
            {t('Users.noInvitations')}
          </p>
        )}
        {invitations ? (
          <DataPagination
            pathname="/administration/users"
            page={invitations.page}
            pageSize={invitations.pageSize}
            totalItems={invitations.total}
            pageParam="invitationPage"
            pageSizeParam="invitationPageSize"
            controlId="invitation-page-size"
            filters={{ ...memberFilters, ...invitationFilters, page, pageSize }}
          />
        ) : null}
      </section>
    </div>
  );
}

function parsePage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1;
}

function parsePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
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

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}
