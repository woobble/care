'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { AsyncEntityCombobox, type EntityOption } from '@app/web/components/async-entity-combobox';
import { replaceMemberScopesAction } from '@app/web/app/(office)/administration/actions';
import { Button } from '@care/ui/components/button';

type ScopeFormResult = { kind: 'saved' } | { kind: 'error'; code: string } | null;

export function MemberScopesForm({
  membershipId,
  tenantScope,
  disabled = false,
  teams,
  organizations,
  facilities,
  labels,
}: Readonly<{
  membershipId: string;
  tenantScope: boolean;
  disabled?: boolean;
  teams: EntityOption[];
  organizations: EntityOption[];
  facilities: EntityOption[];
  labels: {
    scope: string;
    entireTenant: string;
    selectedScopes: string;
    teams: string;
    organizations: string;
    facilities: string;
    noVisibleTeams: string;
    noVisibleOrganizations: string;
    noVisibleFacilities: string;
    saving: string;
    accessUpdated: string;
    scopeConflict: string;
    requestFailed: string;
    saveScopes: string;
    scopeChangeConfirmation: string;
  };
}>) {
  const [result, setResult] = useState<ScopeFormResult>(null);
  const [isPending, startTransition] = useTransition();
  const controlsDisabled = disabled || isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controlsDisabled) return;
    const formData = new FormData(event.currentTarget);
    if (formData.get('scopeMode') === 'tenant' && formData.getAll('scope').length > 0) {
      setResult({ kind: 'error', code: 'SCOPE_CONFLICT' });
      return;
    }
    if (!window.confirm(labels.scopeChangeConfirmation)) return;
    setResult(null);
    startTransition(async () => {
      try {
        const actionResult = await replaceMemberScopesAction(formData);
        setResult(actionResult.ok ? { kind: 'saved' } : { kind: 'error', code: actionResult.code });
      } catch {
        setResult({ kind: 'error', code: 'REQUEST_FAILED' });
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      onChange={() => setResult(null)}
      aria-busy={isPending}
      className="grid gap-4"
    >
      <input type="hidden" name="membershipId" value={membershipId} />
      <fieldset disabled={controlsDisabled} className="grid gap-3">
        <legend className="font-medium">{labels.scope}</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="scopeMode" value="tenant" defaultChecked={tenantScope} />
          {labels.entireTenant}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="scopeMode" value="scoped" defaultChecked={!tenantScope} />
          {labels.selectedScopes}
        </label>
      </fieldset>
      <fieldset disabled={controlsDisabled} className="grid gap-3">
        <legend className="sr-only">{labels.teams}</legend>
        <AsyncEntityCombobox
          name="scope"
          entity="teams"
          label={labels.teams}
          multiple
          disabled={controlsDisabled}
          valuePrefix="team:"
          initialOptions={teams}
          placeholder={labels.noVisibleTeams}
          onSelectionChange={() => setResult(null)}
        />
      </fieldset>
      <fieldset disabled={controlsDisabled} className="grid gap-3">
        <legend className="sr-only">{labels.organizations}</legend>
        <AsyncEntityCombobox
          name="scope"
          entity="organizations"
          label={labels.organizations}
          multiple
          disabled={controlsDisabled}
          valuePrefix="organization:"
          initialOptions={organizations}
          placeholder={labels.noVisibleOrganizations}
          onSelectionChange={() => setResult(null)}
        />
      </fieldset>
      <fieldset disabled={controlsDisabled} className="grid gap-3">
        <legend className="sr-only">{labels.facilities}</legend>
        <AsyncEntityCombobox
          name="scope"
          entity="facilities"
          label={labels.facilities}
          multiple
          disabled={controlsDisabled}
          valuePrefix="facility:"
          initialOptions={facilities}
          placeholder={labels.noVisibleFacilities}
          onSelectionChange={() => setResult(null)}
        />
      </fieldset>
      {isPending ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {labels.saving}
        </p>
      ) : null}
      {result?.kind === 'saved' ? (
        <p
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          {labels.accessUpdated}
        </p>
      ) : null}
      {result?.kind === 'error' ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {result.code === 'SCOPE_CONFLICT' ? labels.scopeConflict : labels.requestFailed}
        </p>
      ) : null}
      <Button type="submit" disabled={controlsDisabled}>
        {labels.saveScopes}
      </Button>
    </form>
  );
}
