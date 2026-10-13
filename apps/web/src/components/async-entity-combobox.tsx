'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import { Button } from '@care/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@care/ui/components/command';
import { Label } from '@care/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@care/ui/components/popover';

export type EntityOption = { id: string; label: string; timezone?: string };
type EntityOptionPage = { page: number; items: EntityOption[]; hasMore: boolean };
const PAGE_SIZE = 20;
const MAX_RETAINED_PAGES = 2;
const OPTION_ROW_HEIGHT = 32;
export type SearchableEntity =
  | 'clients'
  | 'employees'
  | 'employee-users'
  | 'services'
  | 'organizations'
  | 'facilities'
  | 'teams'
  | 'payers'
  | 'receivables';

export function AsyncEntityCombobox({
  name,
  label,
  entity,
  organizationId,
  facilityId,
  initialOption,
  initialOptions,
  placeholder,
  browseOnEmpty = false,
  required = false,
  className,
  minQueryLength = 1,
  debounceMs = 300,
  multiple = false,
  valuePrefix,
  validAt,
  timezoneFieldName,
}: Readonly<{
  name: string;
  label: string;
  entity: SearchableEntity;
  organizationId?: string | undefined;
  facilityId?: string | undefined;
  initialOption?: EntityOption | undefined;
  initialOptions?: EntityOption[] | undefined;
  placeholder?: string;
  browseOnEmpty?: boolean;
  required?: boolean;
  className?: string;
  minQueryLength?: number;
  debounceMs?: number;
  multiple?: boolean;
  valuePrefix?: string;
  validAt?: string;
  timezoneFieldName?: string;
}>) {
  const t = useTranslations('Common');
  const initialSelectedOptions = initialOptions ?? (initialOption ? [initialOption] : []);
  const initialSelectionKey = JSON.stringify(
    initialSelectedOptions.map((option) => [option.id, option.label, option.timezone]),
  );
  const [selection, setSelection] = useState({
    key: initialSelectionKey,
    options: initialSelectedOptions,
  });
  const selectedOptions =
    selection.key === initialSelectionKey ? selection.options : initialSelectedOptions;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<EntityOptionPage[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [paging, setPaging] = useState<'previous' | 'next' | null>(null);
  const [paginationError, setPaginationError] = useState<'previous' | 'next' | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const requestVersion = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const pagingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = pages.flatMap((page) => page.items);

  function updateSelectedOptions(
    next: EntityOption[] | ((current: EntityOption[]) => EntityOption[]),
  ) {
    setSelection((current) => {
      const currentOptions =
        current.key === initialSelectionKey ? current.options : initialSelectedOptions;
      return {
        key: initialSelectionKey,
        options: typeof next === 'function' ? next(currentOptions) : next,
      };
    });
  }

  useEffect(() => {
    const version = ++requestVersion.current;
    const search = query.trim();
    const canBrowseWithoutQuery = browseOnEmpty && search.length === 0;
    if (!open || (search.length < minQueryLength && !canBrowseWithoutQuery)) return;

    const controller = new AbortController();
    activeController.current = controller;
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      setPages([]);
      const params = new URLSearchParams({ entity, page: '1', pageSize: String(PAGE_SIZE) });
      if (search) params.set('q', search);
      if (organizationId) params.set('organizationId', organizationId);
      if (facilityId) params.set('facilityId', facilityId);
      if (validAt) params.set('validAt', validAt);
      try {
        const response = await fetch(`/api/entity-search?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Entity search failed');
        const payload = (await response.json()) as {
          items?: EntityOption[];
          page?: number;
          hasMore?: boolean;
        };
        if (requestVersion.current !== version) return;
        setPages([
          {
            page: payload.page ?? 1,
            items: Array.isArray(payload.items) ? payload.items : [],
            hasMore: payload.hasMore ?? (payload.items?.length ?? 0) >= PAGE_SIZE,
          },
        ]);
        setStatus('success');
      } catch {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        setStatus('error');
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [
    browseOnEmpty,
    debounceMs,
    entity,
    facilityId,
    minQueryLength,
    open,
    organizationId,
    query,
    retryCount,
    validAt,
  ]);

  async function loadAdjacentPage(direction: 'previous' | 'next') {
    if (!browseOnEmpty || pagingRef.current || pages.length === 0) return;
    const firstPage = pages[0]!;
    const lastPage = pages.at(-1)!;
    const targetPage = direction === 'next' ? lastPage.page + 1 : firstPage.page - 1;
    if (targetPage < 1 || (direction === 'next' && !lastPage.hasMore)) return;

    pagingRef.current = true;
    setPaging(direction);
    setPaginationError(null);
    const version = requestVersion.current;
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    const params = new URLSearchParams({
      entity,
      page: String(targetPage),
      pageSize: String(PAGE_SIZE),
    });
    const search = query.trim();
    if (search) params.set('q', search);
    if (organizationId) params.set('organizationId', organizationId);
    if (facilityId) params.set('facilityId', facilityId);
    if (validAt) params.set('validAt', validAt);

    try {
      const response = await fetch(`/api/entity-search?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Entity search failed');
      const payload = (await response.json()) as {
        items?: EntityOption[];
        page?: number;
        hasMore?: boolean;
      };
      if (requestVersion.current !== version || controller.signal.aborted) return;
      const page: EntityOptionPage = {
        page: payload.page ?? targetPage,
        items: Array.isArray(payload.items) ? payload.items : [],
        hasMore: payload.hasMore ?? (payload.items?.length ?? 0) >= PAGE_SIZE,
      };
      const nextPages = direction === 'next' ? [...pages, page] : [page, ...pages];
      const trimmedPages =
        nextPages.length > MAX_RETAINED_PAGES
          ? direction === 'next'
            ? nextPages.slice(-MAX_RETAINED_PAGES)
            : nextPages.slice(0, MAX_RETAINED_PAGES)
          : nextPages;
      const removedCount =
        nextPages.length > MAX_RETAINED_PAGES
          ? direction === 'next'
            ? nextPages[0]!.items.length
            : nextPages.at(-1)!.items.length
          : 0;
      const oldScrollTop = listRef.current?.scrollTop ?? 0;
      setPages(trimmedPages);
      if (listRef.current) {
        window.requestAnimationFrame(() => {
          if (!listRef.current) return;
          listRef.current.scrollTop =
            direction === 'next'
              ? Math.max(0, oldScrollTop - removedCount * OPTION_ROW_HEIGHT)
              : oldScrollTop + page.items.length * OPTION_ROW_HEIGHT;
        });
      }
      setStatus('success');
    } catch {
      if (!controller.signal.aborted && requestVersion.current === version) {
        setPaginationError(direction);
      }
    } finally {
      if (requestVersion.current === version) {
        pagingRef.current = false;
        setPaging(null);
      }
      if (activeController.current === controller) activeController.current = null;
    }
  }

  function handleListScroll() {
    const list = listRef.current;
    if (!list || !browseOnEmpty || pagingRef.current || status !== 'success') return;
    if (list.scrollTop < OPTION_ROW_HEIGHT && pages[0]!.page > 1) {
      void loadAdjacentPage('previous');
      return;
    }
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - OPTION_ROW_HEIGHT) {
      void loadAdjacentPage('next');
    }
  }

  function selectOption(option: EntityOption) {
    if (multiple) {
      updateSelectedOptions((current) =>
        current.some((selected) => selected.id === option.id)
          ? current.filter((selected) => selected.id !== option.id)
          : [...current, option],
      );
      setQuery('');
      setPages([]);
      setStatus('idle');
      setPaginationError(null);
      return;
    }
    updateSelectedOptions([option]);
    setQuery('');
    setPages([]);
    setStatus('idle');
    setPaginationError(null);
    setOpen(false);
  }

  function clearSelection() {
    updateSelectedOptions([]);
    setQuery('');
    setPages([]);
    setStatus('idle');
    setPaginationError(null);
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiple ? (
        selectedOptions.map((option) => (
          <input
            key={option.id}
            type="hidden"
            name={name}
            value={`${valuePrefix ?? ''}${option.id}`}
          />
        ))
      ) : (
        <input type="hidden" name={name} value={selectedOptions[0]?.id ?? ''} />
      )}
      {timezoneFieldName ? (
        <input type="hidden" name={timezoneFieldName} value={selectedOptions[0]?.timezone ?? ''} />
      ) : null}
      <div className="relative min-w-0">
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              setPages([]);
              pagingRef.current = false;
              setPaging(null);
              setPaginationError(null);
            }
            setStatus(nextOpen && browseOnEmpty && query.trim().length === 0 ? 'loading' : 'idle');
          }}
        >
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-required={required}
              aria-label={label}
              className={`min-w-0 w-full h-10 justify-between font-normal ${className ?? ''}`}
            >
              <span className={`truncate ${selectedOptions.length > 0 ? 'mr-8' : ''}`}>
                {(multiple && selectedOptions.length
                  ? selectedOptions.map((option) => option.label).join(', ')
                  : selectedOptions[0]?.label) ??
                  placeholder ??
                  t('entitySelector.choose', { entity: label })}
              </span>
              <ChevronDown
                className="ml-2 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
          >
            <Command shouldFilter={false}>
              <CommandInput
                autoFocus
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  setPages([]);
                  pagingRef.current = false;
                  setPaging(null);
                  setPaginationError(null);
                  setStatus('idle');
                }}
                placeholder={t('entitySelector.searchPlaceholder')}
                aria-label={t('entitySelector.searchPlaceholder')}
              />
              <CommandList ref={listRef} onScroll={handleListScroll}>
                {status === 'loading' ? (
                  <div
                    role="status"
                    className="flex items-center justify-center gap-2 px-3 py-5 text-sm text-muted-foreground"
                  >
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    {t('entitySelector.loading')}
                  </div>
                ) : status === 'error' ? (
                  <div
                    role="alert"
                    className="grid justify-items-center gap-2 px-3 py-5 text-sm text-destructive"
                  >
                    <span>{t('entitySelector.failed')}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setRetryCount((count) => count + 1)}
                    >
                      {t('entitySelector.retry')}
                    </Button>
                  </div>
                ) : query.trim().length < minQueryLength &&
                  !(browseOnEmpty && query.trim().length === 0) ? (
                  <CommandEmpty>
                    {t('entitySelector.minimumCharacters', { count: minQueryLength })}
                  </CommandEmpty>
                ) : options.length === 0 ? (
                  <CommandEmpty>{t('entitySelector.empty')}</CommandEmpty>
                ) : (
                  options.map((option) => (
                    <CommandItem
                      key={option.id}
                      value={option.id}
                      onSelect={() => selectOption(option)}
                    >
                      <span className="truncate">{option.label}</span>
                      {selectedOptions.some((selected) => selected.id === option.id) ? (
                        <Check className="ml-auto size-4" aria-hidden="true" />
                      ) : null}
                    </CommandItem>
                  ))
                )}
                {paging ? (
                  <div
                    role="status"
                    className="flex items-center justify-center gap-2 px-3 py-3 text-sm text-muted-foreground"
                  >
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    {t('entitySelector.loading')}
                  </div>
                ) : null}
                {paginationError ? (
                  <div
                    role="alert"
                    className="grid justify-items-center gap-2 px-3 py-3 text-sm text-destructive"
                  >
                    <span>{t('entitySelector.failed')}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void loadAdjacentPage(paginationError)}
                    >
                      {t('entitySelector.retry')}
                    </Button>
                  </div>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selectedOptions.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('entitySelector.clear')}
            className="absolute top-1/2 right-9 z-10 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={clearSelection}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
