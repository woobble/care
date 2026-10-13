'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@care/ui/components/button';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import {
  careDraftPrefix,
  clearCareDrafts,
  findCareDraft,
  saveCareDraft,
  type CareDraftRecord,
} from './drafts';
import { useCareDraftScope } from './draft-scope';

type ServerAction = (formData: FormData) => void | Promise<void>;
type DraftOptions = {
  visitId: string;
  formId: string;
  revision: string;
  fields: string[];
};
type DraftState =
  | { type: 'none' }
  | { type: 'recoverable'; record: CareDraftRecord }
  | { type: 'stale'; count: number }
  | { type: 'saved'; savedAt: number }
  | { type: 'submitted' }
  | { type: 'storage-error' };

const submittedMarkerPrefix = 'care-draft:submitted:v1:';
const noSuccessNotices: string[] = [];

export function CareForm({
  action,
  children,
  className,
  draft,
  notice,
  successNotices = noSuccessNotices,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  draft?: DraftOptions;
  notice?: string | undefined;
  successNotices?: string[];
}) {
  const t = useTranslations('Caregiver.drafts');
  const scope = useCareDraftScope();
  const pendingFormRef = useRef<HTMLFormElement>(null);
  const submissionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftState, setDraftState] = useState<DraftState>({ type: 'none' });
  const [formState, setFormState] = useState<'idle' | 'offline' | 'submitting' | 'uncertain'>(
    'idle',
  );
  const [online, setOnline] = useState(true);
  const prefix =
    draft && scope
      ? careDraftPrefix(scope.userId, scope.tenantId, draft.visitId, draft.formId)
      : null;
  const draftKey = prefix && draft ? prefix + encodeURIComponent(draft.revision) : null;

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!prefix || !draft || !draftKey) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const storage = window.sessionStorage;
        const marker = submittedMarkerPrefix + prefix;
        if (notice && successNotices.includes(notice) && storage.getItem(marker)) {
          clearCareDrafts(storage, prefix);
          storage.removeItem(marker);
          setDraftState({ type: 'submitted' });
          setFormState('idle');
          return;
        }
        const result = findCareDraft(storage, prefix, draft.revision);
        if (result.current) setDraftState({ type: 'recoverable', record: result.current });
        else if (result.staleCount) setDraftState({ type: 'stale', count: result.staleCount });
        else setDraftState({ type: 'none' });
      } catch {
        setDraftState({ type: 'storage-error' });
      }
    });
    return () => {
      active = false;
    };
  }, [draft, draftKey, notice, prefix, successNotices]);

  useEffect(
    () => () => {
      if (submissionTimer.current) clearTimeout(submissionTimer.current);
    },
    [],
  );

  function persist(form: HTMLFormElement) {
    if (!prefix || !draft) return;
    try {
      const data = new FormData(form);
      const values: Record<string, string> = {};
      for (const name of draft.fields) {
        const value = data.get(name);
        if (typeof value === 'string') values[name] = value;
      }
      if (Object.values(values).every((value) => value === '')) {
        clearCareDrafts(window.sessionStorage, prefix);
        setDraftState({ type: 'none' });
      } else {
        const savedAt = Date.now();
        saveCareDraft(window.sessionStorage, prefix, draft.revision, values, savedAt);
        setDraftState({ type: 'saved', savedAt });
      }
    } catch {
      setDraftState({ type: 'storage-error' });
    }
  }

  function restore(record: CareDraftRecord, trigger: HTMLButtonElement) {
    const form = trigger.closest('form');
    if (!form || !draft) return;
    for (const name of draft.fields) {
      const value = record.values[name];
      if (value === undefined) continue;
      const controls = Array.from(form.elements).filter(
        (control): control is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
          (control instanceof HTMLInputElement ||
            control instanceof HTMLTextAreaElement ||
            control instanceof HTMLSelectElement) &&
          control.name === name,
      );
      for (const control of controls) {
        if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) {
          setNativeChecked(control, control.value === value);
        } else {
          setNativeValue(control, value);
        }
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    setDraftState({ type: 'saved', savedAt: record.savedAt });
  }

  function discardDraft() {
    if (!prefix) return;
    if (!window.confirm(t('discardPrompt'))) return;
    try {
      clearCareDrafts(window.sessionStorage, prefix);
      setDraftState({ type: 'none' });
    } catch {
      setDraftState({ type: 'storage-error' });
    }
  }

  function beforeSubmit(form: HTMLFormElement) {
    if (!navigator.onLine) {
      setFormState('offline');
      return false;
    }
    pendingFormRef.current = form;
    setFormState('submitting');
    for (const button of form.querySelectorAll<HTMLButtonElement>(
      'button[type="submit"],input[type="submit"]',
    )) {
      button.disabled = true;
    }
    if (prefix && draftKey) {
      persist(form);
      try {
        window.sessionStorage.setItem(submittedMarkerPrefix + prefix, '1');
      } catch {
        // The server action still runs; only draft cleanup feedback is unavailable.
      }
    }
    submissionTimer.current = setTimeout(() => {
      setFormState('uncertain');
      for (const button of pendingFormRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"],input[type="submit"]',
      ) ?? []) {
        button.disabled = false;
      }
    }, 15_000);
    return true;
  }

  const statusText =
    formState === 'offline'
      ? t('offline')
      : formState === 'submitting'
        ? t('submitting')
        : formState === 'uncertain'
          ? t('submissionUncertain')
          : draftState.type === 'storage-error'
            ? t('storageUnavailable')
            : draftState.type === 'submitted'
              ? t('submitted')
              : draftState.type === 'saved'
                ? t('savedLocally')
                : null;

  return (
    <RHFActionForm
      action={action}
      className={className}
      onInput={(event) => persist(event.currentTarget)}
      onChange={(event) => persist(event.currentTarget)}
      beforeAction={beforeSubmit}
    >
      {draftState.type === 'recoverable' ? (
        <aside className="grid gap-2 rounded-md border border-primary/20 bg-accent p-3 text-sm">
          <p>
            {t('recoverable', {
              time: new Intl.DateTimeFormat(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(draftState.record.savedAt)),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={(event) => restore(draftState.record, event.currentTarget)}
              variant="outline"
            >
              {t('restore')}
            </Button>
            <Button type="button" onClick={discardDraft} variant="secondary">
              {t('discard')}
            </Button>
          </div>
        </aside>
      ) : null}
      {draftState.type === 'stale' ? (
        <aside className="grid gap-2 rounded-md border border-warning/40 bg-warning-muted p-3 text-sm">
          <p>{t('stale', { count: draftState.count })}</p>
          <Button type="button" onClick={discardDraft} variant="secondary">
            {t('discard')}
          </Button>
        </aside>
      ) : null}
      {statusText ? (
        <p role="status" className="rounded-md bg-background p-2 text-sm text-muted-foreground">
          {statusText}
        </p>
      ) : null}
      {!online && formState !== 'offline' ? (
        <p role="status" className="text-sm text-warning-foreground">
          {t('offline')}
        </p>
      ) : null}
      {children}
    </RHFActionForm>
  );
}

function setNativeValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : control instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value);
}

function setNativeChecked(control: HTMLInputElement, checked: boolean) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(
    control,
    checked,
  );
}
