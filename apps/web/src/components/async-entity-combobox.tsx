'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@care/ui';

export type EntityOption = { id: string; label: string; timezone?: string };
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
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [retryCount, setRetryCount] = useState(0);
  const requestVersion = useRef(0);
  const id = useId();

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
    if (!open || search.length < minQueryLength) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      const params = new URLSearchParams({ entity, q: search });
      if (organizationId) params.set('organizationId', organizationId);
      if (facilityId) params.set('facilityId', facilityId);
      if (validAt) params.set('validAt', validAt);
      try {
        const response = await fetch(`/api/entity-search?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Entity search failed');
        const payload = (await response.json()) as { items?: EntityOption[] };
        if (requestVersion.current !== version) return;
        setOptions(Array.isArray(payload.items) ? payload.items : []);
        setStatus('success');
      } catch {
        if (controller.signal.aborted || requestVersion.current !== version) return;
        setStatus('error');
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
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

  function selectOption(option: EntityOption) {
    if (multiple) {
      updateSelectedOptions((current) =>
        current.some((selected) => selected.id === option.id)
          ? current.filter((selected) => selected.id !== option.id)
          : [...current, option],
      );
      setQuery('');
      setOptions([]);
      setStatus('idle');
      return;
    }
    updateSelectedOptions([option]);
    setQuery('');
    setOptions([]);
    setStatus('idle');
    setOpen(false);
  }

  function clearSelection() {
    updateSelectedOptions([]);
    setQuery('');
    setOptions([]);
    setStatus('idle');
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
      <div className="flex min-w-0 gap-1">
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setOptions([]);
            setStatus('idle');
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
              className={`min-w-0 flex-1 justify-between font-normal ${className ?? ''}`}
            >
              <span className="truncate">
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
                  setOptions([]);
                  setStatus('idle');
                }}
                placeholder={t('entitySelector.searchPlaceholder')}
                aria-label={t('entitySelector.searchPlaceholder')}
              />
              <CommandList>
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
                ) : query.trim().length < minQueryLength ? (
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
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selectedOptions.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t('entitySelector.clear')}
            onClick={clearSelection}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
