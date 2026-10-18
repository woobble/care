import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { Button } from '@care/ui/components/button';
import { NativeSelect } from '@care/ui/components/native-select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@care/ui/components/pagination';

export type PaginationQuery = Record<string, string | number | undefined>;

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100] as const;

type DataPaginationBaseProps = Readonly<{
  pathname: string;
  page: number;
  pageSize: number;
  filters: PaginationQuery;
  pageSizeOptions?: readonly number[];
  pageParam?: string;
  pageSizeParam?: string;
  controlId?: string;
  stacked?: boolean;
  totalIsLowerBound?: boolean;
}>;

type DataPaginationProps = DataPaginationBaseProps &
  (
    | { totalItems: number; totalPages?: never; summaryLabel?: never }
    | { totalPages: number; totalItems?: never; summaryLabel: string }
  );

export async function DataPagination({
  pathname,
  page,
  pageSize,
  totalItems,
  totalPages,
  summaryLabel,
  filters,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  pageParam = 'page',
  pageSizeParam = 'pageSize',
  controlId = 'page-size',
  stacked = false,
  totalIsLowerBound = false,
}: DataPaginationProps) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const safePageSize = Math.max(1, Math.min(100, pageSize));
  const resultTotalPages = totalPages ?? Math.max(1, Math.ceil((totalItems ?? 0) / safePageSize));
  const currentPage = Math.min(Math.max(1, page), resultTotalPages);
  const start =
    totalItems === undefined || totalItems === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const end = totalItems === undefined ? 0 : Math.min(totalItems, currentPage * safePageSize);
  const number = new Intl.NumberFormat(locale);
  const sizes = [...new Set([...pageSizeOptions, safePageSize])].sort(
    (left, right) => left - right,
  );
  const numberedPages = pageWindow(currentPage, resultTotalPages);
  const hrefForPage = (targetPage: number) => {
    const params = new URLSearchParams();
    appendFilters(params, filters, pageParam, pageSizeParam);
    params.set(pageParam, String(targetPage));
    params.set(pageSizeParam, String(safePageSize));
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div
      className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-card px-3 py-3 ${
        stacked ? '' : 'xl:flex-row xl:items-center xl:justify-between'
      }`}
    >
      {totalItems === undefined ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {summaryLabel}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t(totalIsLowerBound ? 'Common.resultsRangeAtLeast' : 'Common.resultsRange', {
            start: number.format(start),
            end: number.format(end),
            total: number.format(totalItems),
          })}
        </p>
      )}
      <div
        className={`flex min-w-0 flex-col gap-3 ${
          stacked ? '' : 'xl:flex-row xl:items-center xl:justify-end'
        }`}
      >
        <form method="get" action={pathname} className="flex flex-wrap items-center gap-2">
          {Object.entries(filters).map(([key, value]) =>
            value === undefined ||
            value === '' ||
            key === pageParam ||
            key === pageSizeParam ? null : (
              <input key={key} type="hidden" name={key} value={String(value)} />
            ),
          )}
          <input type="hidden" name={pageParam} value="1" />
          <label className="text-sm whitespace-nowrap text-muted-foreground" htmlFor={controlId}>
            {t('Common.fields.pageSize')}
          </label>
          <NativeSelect
            id={controlId}
            name={pageSizeParam}
            defaultValue={String(safePageSize)}
            className="w-20"
            selectClassName="h-9 rounded-md"
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" variant="secondary">
            {t('Common.actions.apply')}
          </Button>
        </form>
        <Pagination
          aria-label={t('Common.fields.pagination')}
          className={`mx-0 w-auto justify-start ${stacked ? '' : 'xl:justify-end'}`}
        >
          <PaginationContent className="max-w-full flex-wrap gap-1">
            <PaginationItem>
              {currentPage === 1 ? (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled
                  aria-label={t('Common.actions.firstPage')}
                >
                  <ChevronsLeft aria-hidden="true" />
                </Button>
              ) : (
                <PaginationLink
                  href={hrefForPage(1)}
                  aria-label={t('Common.actions.firstPage')}
                  size="icon"
                >
                  <ChevronsLeft aria-hidden="true" />
                </PaginationLink>
              )}
            </PaginationItem>
            <PaginationItem>
              {currentPage === 1 ? (
                <Button
                  size="default"
                  variant="ghost"
                  disabled
                  aria-label={t('Common.actions.previous')}
                >
                  <ChevronLeft aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {stacked ? '' : t('Common.actions.previous')}
                  </span>
                </Button>
              ) : (
                <PaginationPrevious
                  aria-label={t('Common.actions.previous')}
                  href={hrefForPage(currentPage - 1)}
                  text={stacked ? '' : t('Common.actions.previous')}
                />
              )}
            </PaginationItem>
            {numberedPages.map((item) =>
              typeof item !== 'number' ? (
                <PaginationItem key={`ellipsis-${item.beforePage}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem
                  key={item}
                  className={item === currentPage ? undefined : 'hidden sm:block'}
                >
                  <PaginationLink
                    href={hrefForPage(item)}
                    isActive={item === currentPage}
                    aria-label={`${item}`}
                    size="icon"
                  >
                    {number.format(item)}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              {currentPage === resultTotalPages ? (
                <Button
                  size="default"
                  variant="ghost"
                  disabled
                  aria-label={t('Common.actions.next')}
                >
                  <span className="hidden sm:inline">
                    {stacked ? '' : t('Common.actions.next')}
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              ) : (
                <PaginationNext
                  aria-label={t('Common.actions.next')}
                  href={hrefForPage(currentPage + 1)}
                  text={stacked ? '' : t('Common.actions.next')}
                />
              )}
            </PaginationItem>
            <PaginationItem>
              {currentPage === resultTotalPages ? (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled
                  aria-label={t('Common.actions.lastPage')}
                >
                  <ChevronsRight aria-hidden="true" />
                </Button>
              ) : (
                <PaginationLink
                  href={hrefForPage(resultTotalPages)}
                  aria-label={t('Common.actions.lastPage')}
                  size="icon"
                >
                  <ChevronsRight aria-hidden="true" />
                </PaginationLink>
              )}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}

function appendFilters(
  params: URLSearchParams,
  filters: PaginationQuery,
  pageParam: string,
  pageSizeParam: string,
) {
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && key !== pageParam && key !== pageSizeParam) {
      params.set(key, String(value));
    }
  }
}

function pageWindow(current: number, total: number): Array<number | { beforePage: number }> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page));
  const ordered = [...pages].filter((page) => page > 0 && page <= total).sort((a, b) => a - b);
  const result: Array<number | { beforePage: number }> = [];
  for (const [index, page] of ordered.entries()) {
    if (index > 0 && page - ordered[index - 1]! > 1) result.push({ beforePage: page });
    result.push(page);
  }
  return result;
}
