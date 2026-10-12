'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  careDraftPrefix,
  clearCareDrafts,
  findCareDraft,
  saveCareDraft,
  type CareDraftRecord,
} from './drafts';
import { useCareDraftScope } from './draft-scope';

type ServerAction = NonNullable<FormHTMLAttributes<HTMLFormElement>['action']>;
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
  const formRef = useRef<HTMLFormElement>(null);
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

  function restore(record: CareDraftRecord) {
    const form = formRef.current;
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
          control.checked = control.value === value;
        } else {
          control.value = value;
        }
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

  function submit(event: FormEvent<HTMLFormElement>) {
    if (event.defaultPrevented) return;
    if (!navigator.onLine) {
      event.preventDefault();
      setFormState('offline');
      return;
    }
    setFormState('submitting');
    for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[type="submit"],input[type="submit"]',
    )) {
      button.disabled = true;
    }
    if (prefix && draftKey) {
      persist(event.currentTarget);
      try {
        window.sessionStorage.setItem(submittedMarkerPrefix + prefix, '1');
      } catch {
        // The server action still runs; only draft cleanup feedback is unavailable.
      }
    }
    submissionTimer.current = setTimeout(() => {
      setFormState('uncertain');
      for (const button of formRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"],input[type="submit"]',
      ) ?? []) {
        button.disabled = false;
      }
    }, 15_000);
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
    <form
      ref={formRef}
      action={action}
      className={className}
      aria-busy={formState === 'submitting'}
      onInput={(event) => persist(event.currentTarget)}
      onChange={(event) => persist(event.currentTarget)}
      onSubmit={submit}
    >
      {draftState.type === 'recoverable' ? (
        <aside className="grid gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
          <p>
            {t('recoverable', {
              time: new Intl.DateTimeFormat(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(draftState.record.savedAt)),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => restore(draftState.record)}
              className="min-h-11 rounded-md border border-blue-800 px-3 font-semibold text-blue-900"
            >
              {t('restore')}
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="min-h-11 rounded-md border px-3 font-medium"
            >
              {t('discard')}
            </button>
          </div>
        </aside>
      ) : null}
      {draftState.type === 'stale' ? (
        <aside className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>{t('stale', { count: draftState.count })}</p>
          <button
            type="button"
            onClick={discardDraft}
            className="min-h-11 w-fit rounded-md border px-3 font-medium"
          >
            {t('discard')}
          </button>
        </aside>
      ) : null}
      {statusText ? (
        <p role="status" className="rounded-md bg-slate-50 p-2 text-sm text-slate-700">
          {statusText}
        </p>
      ) : null}
      {!online && formState !== 'offline' ? (
        <p role="status" className="text-sm text-amber-900">
          {t('offline')}
        </p>
      ) : null}
      {children}
    </form>
  );
}
