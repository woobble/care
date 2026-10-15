'use client';

import { Button } from '@care/ui/components/button';
import { Label } from '@care/ui/components/label';
import { Textarea } from '@care/ui/components/textarea';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { useTranslations } from 'next-intl';
import { reverseBenefitAllocationAction } from './actions';

export function AllocationReversalForm({
  clientId,
  allocationId,
  idempotencyKey,
}: Readonly<{
  clientId: string;
  allocationId: string;
  idempotencyKey: string;
}>) {
  const t = useTranslations('Benefits');
  const reasonId = `allocation-reversal-reason-${allocationId}`;

  return (
    <details className="min-w-48">
      <summary className="cursor-pointer text-sm font-medium text-primary underline">
        {t('reverseAllocation')}
      </summary>
      <RHFActionForm
        action={reverseBenefitAllocationAction}
        beforeAction={() => window.confirm(t('confirmAllocationReversal'))}
        errorMessage={t('allocationReversalFailed')}
        className="mt-2 grid min-w-64 gap-2 rounded-md border bg-card p-3"
      >
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="allocationId" value={allocationId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <label className="grid gap-2">
          <Label htmlFor={reasonId}>{t('correctionReason')}</Label>
          <Textarea id={reasonId} name="reason" rows={3} maxLength={500} required />
        </label>
        <p className="text-xs text-muted-foreground">{t('allocationReversalNote')}</p>
        <Button type="submit" variant="destructive" className="w-fit">
          {t('confirmReversal')}
        </Button>
      </RHFActionForm>
    </details>
  );
}
