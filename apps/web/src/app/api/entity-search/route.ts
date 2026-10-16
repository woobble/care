import { getTranslations } from 'next-intl/server';
import { NextResponse } from 'next/server';

import type { EntityOption, SearchableEntity } from '@app/web/components/async-entity-combobox';
import { fetchCareApi } from '@app/web/lib/api';
import type { CareApiRequest } from '@app/web/lib/api-routes';

type EntityRecord = {
  id: string;
  userId?: string | null;
  firstName?: string;
  preferredName?: string | null;
  displayName?: string | null;
  email?: string | null;
  lastName?: string;
  relationshipType?:
    | 'daughter'
    | 'son'
    | 'spouse'
    | 'relative'
    | 'legal_representative'
    | 'guardian'
    | 'other';
  name?: string;
  legalName?: string | null;
  code?: string | null;
  description?: string | null;
  organizationName?: string;
  facilityName?: string | null;
  clientName?: string;
  invoiceNumber?: string | null;
  payerIdentifier?: string | null;
  outstandingCents?: number | null;
  timezone?: string;
  unit?: 'occurrence' | 'minute' | 'hour' | 'day';
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entity = url.searchParams.get('entity');
  const query = url.searchParams.get('q')?.trim().slice(0, 120) ?? '';
  const canBrowseWithoutQuery = entity === 'organizations' || entity === 'facilities';
  if (
    !isSearchableEntity(entity) ||
    (query.length < 2 && !(query.length === 0 && canBrowseWithoutQuery))
  ) {
    return NextResponse.json({ items: [] satisfies EntityOption[] });
  }

  const requestedPage = Number(url.searchParams.get('page') ?? '1');
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const search = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (query) search.set('q', query);
  if (entity === 'clients' || entity === 'employees') {
    search.set('status', 'active');
    search.set('sortBy', 'lastName');
    search.set('sortOrder', 'asc');
    const organizationId = url.searchParams.get('organizationId');
    const facilityId = url.searchParams.get('facilityId');
    if (organizationId) search.set('organizationId', organizationId);
    if (facilityId) search.set('facilityId', facilityId);
  } else if (entity === 'employee-users') {
    const employeeId = url.searchParams.get('employeeId');
    if (!employeeId || !/^[0-9a-f-]{36}$/i.test(employeeId) || query.length < 2) {
      return NextResponse.json({ items: [] satisfies EntityOption[] });
    }
    search.set('pageSize', '20');
  } else if (entity === 'qualifications' || entity === 'skills') {
    search.set('pageSize', '20');
  } else if (entity === 'client-contacts') {
    const clientId = url.searchParams.get('clientId');
    if (
      !clientId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)
    ) {
      return NextResponse.json({ items: [] satisfies EntityOption[] });
    }
    search.set('pageSize', '20');
  } else if (entity === 'organizations' || entity === 'facilities' || entity === 'teams') {
    search.set('status', 'active');
    const organizationId = url.searchParams.get('organizationId');
    if (organizationId && entity !== 'organizations') {
      search.set('organizationId', organizationId);
    }
  } else if (entity === 'services') {
    search.set('status', 'active');
    const validFrom = url.searchParams.get('validFrom');
    const validUntil = url.searchParams.get('validUntil');
    if (validFrom) {
      search.set('validFrom', validFrom);
      if (validUntil) search.set('validUntil', validUntil);
    } else {
      search.set(
        'validAt',
        url.searchParams.get('validAt') ?? new Date().toISOString().slice(0, 10),
      );
    }
    const organizationId = url.searchParams.get('organizationId');
    const facilityId = url.searchParams.get('facilityId');
    if (organizationId) search.set('organizationId', organizationId);
    if (facilityId) search.set('facilityId', facilityId);
  } else if (entity === 'payers') {
    const organizationId = url.searchParams.get('organizationId');
    if (!organizationId) {
      return NextResponse.json({ error: 'Organization scope is required' }, { status: 400 });
    }
    search.set('organizationId', organizationId);
    search.set('status', 'active');
  } else {
    const organizationId = url.searchParams.get('organizationId');
    if (organizationId) search.set('organizationId', organizationId);
  }

  const employeeId = url.searchParams.get('employeeId');
  const clientId = url.searchParams.get('clientId');
  const apiRequest = getEntitySearchRequest(entity, employeeId, clientId, search);
  const response = await fetchCareApi(apiRequest);
  if (!response.ok) {
    return NextResponse.json({ error: 'Entity search failed' }, { status: response.status });
  }

  const payload = (await response.json()) as {
    items?: EntityRecord[];
    page?: number;
    totalPages?: number;
    pageSize?: number;
    total?: number;
  };
  const communications =
    entity === 'client-contacts' ? await getTranslations('Communications') : undefined;
  const items = (payload.items ?? []).flatMap((record) => {
    const id = entity === 'employee-users' ? (record.userId ?? record.id) : record.id;
    if (!id) return [];
    const label = getEntityLabel(
      entity,
      record,
      communications
        ? (relationshipType) => communications(`contactRelationships.${relationshipType}`)
        : undefined,
    );
    return label
      ? [
          {
            id,
            label,
            ...(entity === 'organizations' && record.timezone ? { timezone: record.timezone } : {}),
            ...(entity === 'services' && record.unit ? { serviceUnit: record.unit } : {}),
          },
        ]
      : [];
  });
  return NextResponse.json({
    items,
    ...(canBrowseWithoutQuery ||
    entity === 'employee-users' ||
    entity === 'qualifications' ||
    entity === 'skills' ||
    entity === 'client-contacts'
      ? {
          page: payload.page ?? page,
          hasMore:
            entity === 'employee-users' || entity === 'qualifications' || entity === 'skills'
              ? (payload.page ?? page) * (payload.pageSize ?? 20) < (payload.total ?? 0)
              : entity === 'client-contacts'
                ? (payload.page ?? page) * (payload.pageSize ?? 20) < (payload.total ?? 0)
                : (payload.page ?? page) < (payload.totalPages ?? 0),
        }
      : {}),
  });
}

function isSearchableEntity(value: string | null): value is SearchableEntity {
  return (
    value === 'clients' ||
    value === 'employees' ||
    value === 'employee-users' ||
    value === 'qualifications' ||
    value === 'skills' ||
    value === 'services' ||
    value === 'organizations' ||
    value === 'facilities' ||
    value === 'teams' ||
    value === 'payers' ||
    value === 'receivables' ||
    value === 'client-contacts'
  );
}

function getEntitySearchRequest(
  entity: SearchableEntity,
  employeeId: string | null,
  clientId: string | null,
  query: URLSearchParams,
): CareApiRequest {
  const init = { method: 'GET', cache: 'no-store' as const };
  switch (entity) {
    case 'clients':
      return { route: 'clients', query, init };
    case 'employees':
      return { route: 'employees', query, init };
    case 'employee-users':
      if (!employeeId) throw new Error('Employee ID is required for employee-user search.');
      return { route: 'employeeUsersSearch', pathParams: [employeeId], query, init };
    case 'client-contacts':
      if (!clientId) throw new Error('Client ID is required for client-contact search.');
      return { route: 'clientContactsSearch', pathParams: [clientId], query, init };
    case 'qualifications':
      return { route: 'qualificationsSearch', query, init };
    case 'skills':
      return { route: 'skillsSearch', query, init };
    case 'services':
      return { route: 'services', query, init };
    case 'organizations':
      return { route: 'organizationsSearch', query, init };
    case 'facilities':
      return { route: 'facilitiesSearch', query, init };
    case 'teams':
      return { route: 'teamsSearch', query, init };
    case 'payers':
      return { route: 'payers', query, init };
    case 'receivables':
      return { route: 'receivables', query, init };
  }
}

function getEntityLabel(
  entity: SearchableEntity,
  record: EntityRecord,
  translateRelationship?: (
    relationshipType: NonNullable<EntityRecord['relationshipType']>,
  ) => string,
): string | undefined {
  if (entity === 'employee-users') {
    return [record.displayName, record.email].filter(Boolean).join(' · ') || undefined;
  }
  if (entity === 'qualifications' || entity === 'skills') {
    return [record.name, record.code].filter(Boolean).join(' · ') || undefined;
  }
  if (entity === 'clients' || entity === 'employees') {
    if (!record.firstName || !record.lastName) return undefined;
    return `${record.preferredName || record.firstName} ${record.lastName}`.trim();
  }
  if (entity === 'client-contacts') {
    if (!record.firstName || !record.lastName) return undefined;
    const relationship = record.relationshipType
      ? translateRelationship?.(record.relationshipType)
      : undefined;
    return [record.firstName, record.lastName, relationship].filter(Boolean).join(' · ');
  }
  if (entity === 'organizations') return record.name ?? record.legalName ?? undefined;
  if (entity === 'facilities') {
    return [record.name, record.organizationName].filter(Boolean).join(' · ') || undefined;
  }
  if (entity === 'teams') {
    return (
      [record.name, record.facilityName || record.organizationName].filter(Boolean).join(' · ') ||
      undefined
    );
  }
  if (entity === 'services') {
    return [record.code, record.name].filter(Boolean).join(' · ') || undefined;
  }
  if (entity === 'payers') {
    return [record.name, record.payerIdentifier].filter(Boolean).join(' · ') || undefined;
  }
  if (!record.invoiceNumber && !record.clientName) return undefined;
  return [record.invoiceNumber, record.clientName, formatCents(record.outstandingCents)]
    .filter(Boolean)
    .join(' · ');
}

function formatCents(value: number | null | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return `${(value / 100).toFixed(2)} EUR`;
}
