import { NextIntlClientProvider } from 'next-intl';
import { Component, useEffect, type ReactNode } from 'react';
import { useFormContext } from 'react-hook-form';
import { createRoot } from 'react-dom/client';

import de from '../../messages/de.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import { RHFActionForm } from '../../src/components/rhf-action-form';
import { TextField } from '../../src/features/clients/components/client-form-fields';

export type FormTestOptions = {
  structured?: boolean;
  locale?: 'en' | 'de';
  customError?: boolean;
  errorCallback?: boolean;
};
declare global {
  interface Window {
    formHarness: {
      render: (options?: FormTestOptions) => void;
      results: unknown[];
      calls: number;
      refreshes: number;
      errors: number;
      clientError: () => void;
      deferred: Array<(result: unknown) => void>;
    };
  }
}
class ErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  override state = { message: '' };
  static getDerivedStateFromError(error: { digest?: string; message: string }) {
    return { message: error.digest ?? error.message };
  }
  override render() {
    return this.state.message ? <p role="alert">{this.state.message}</p> : this.props.children;
  }
}
function ClientErrorProbe() {
  const { setError } = useFormContext();
  useEffect(() => {
    window.formHarness.clientError = () =>
      setError('lastName', { type: 'manual', message: 'Existing client validation error' });
  }, [setError]);
  return null;
}
const root = createRoot(document.getElementById('root')!);
window.formHarness = {
  results: [],
  calls: 0,
  refreshes: 0,
  errors: 0,
  clientError: () => {},
  deferred: [],
  render(options = {}) {
    const locale = options.locale ?? 'en';
    const messages = locale === 'en' ? en : de;
    const action = async () => {
      window.formHarness.calls++;
      const result = window.formHarness.results.shift();
      if (result === 'defer')
        return new Promise<never>((resolve) =>
          window.formHarness.deferred.push(resolve as (result: unknown) => void),
        );
      if (result === 'throw') throw new Error('private backend detail');
      if (result === 'redirect')
        throw Object.assign(new Error('NEXT_REDIRECT'), {
          digest: 'NEXT_REDIRECT;push;/clients;307;',
        });
      return result as never;
    };
    root.render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ErrorBoundary>
          <main>
            <h1>Form interaction fixture</h1>
            <RHFActionForm
              {...(options.structured ? { structuredErrors: true as const, action } : { action })}
              noValidate
              refreshOnSuccess
              warnOnUnsavedChanges
              errorMessage={options.customError ? messages.Clients.detail.saveFailed : undefined}
              {...(options.errorCallback
                ? {
                    onActionError: () => {
                      window.formHarness.errors++;
                    },
                  }
                : {})}
            >
              <ClientErrorProbe />
              <TextField
                id="firstName"
                name="firstName"
                label={messages.Clients.form.firstName}
                defaultValue="Ada"
                required
              />
              <TextField
                id="lastName"
                name="lastName"
                label={messages.Clients.form.lastName}
                defaultValue="Lovelace"
                required
              />
              <button type="submit">Save</button>
            </RHFActionForm>
            <a href="/elsewhere">Leave</a>
          </main>
        </ErrorBoundary>
      </NextIntlClientProvider>,
    );
  },
};
