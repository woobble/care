import type { AgreementServiceSnapshot, ServiceAgreementSnapshot } from '@care/service-agreements';
import type { ServiceAgreementListItemDto } from './service-agreements.dto';

export function serviceAgreementResponse(agreement: ServiceAgreementSnapshot) {
  return {
    ...agreement,
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}

export function serviceAgreementListResponse(input: {
  items: Array<{ agreement: ServiceAgreementSnapshot; serviceCount: number }>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const items: ServiceAgreementListItemDto[] = input.items.map((item) => ({
    ...serviceAgreementResponse(item.agreement),
    serviceCount: item.serviceCount,
  }));
  return { items, page: input.page, pageSize: input.pageSize, total: input.total };
}

export function agreementServiceResponse(service: AgreementServiceSnapshot) {
  return {
    ...service,
    endedAt: service.endedAt?.toISOString() ?? null,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}
