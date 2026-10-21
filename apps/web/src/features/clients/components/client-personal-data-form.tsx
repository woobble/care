import { getTranslations } from 'next-intl/server';

import { RHFActionForm } from '@app/web/components/rhf-action-form';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';

import { updateClientAction } from '../actions/update-client';
import { TextField, SelectField } from './client-form-fields';

export async function ClientPersonalDataForm({
  client,
}: Readonly<{ client: components['schemas']['ClientResponseDto'] }>) {
  const t = await getTranslations();
  return (
    <details className="rounded-lg border bg-card p-5">
      <summary className="cursor-pointer font-semibold">
        {t('Clients.detail.editPersonalData')}
      </summary>
      <RHFActionForm
        action={updateClientAction}
        errorMessage={t('Clients.detail.saveFailed')}
        warnOnUnsavedChanges
        className="mt-4 grid gap-4"
      >
        <input type="hidden" name="id" value={client.id} />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="edit-firstName"
            name="firstName"
            label={t('Clients.form.firstName')}
            defaultValue={client.firstName}
            required
          />
          <TextField
            id="edit-lastName"
            name="lastName"
            label={t('Clients.form.lastName')}
            defaultValue={client.lastName}
            required
          />
          <TextField
            id="edit-preferredName"
            name="preferredName"
            label={t('Clients.form.preferredName')}
            defaultValue={client.preferredName ?? ''}
          />
          <TextField
            id="edit-dateOfBirth"
            name="dateOfBirth"
            label={t('Clients.form.dateOfBirth')}
            type="date"
            defaultValue={client.dateOfBirth ?? ''}
          />
          <TextField
            id="edit-dateOfDeath"
            name="dateOfDeath"
            label={t('Clients.form.dateOfDeath')}
            type="date"
            defaultValue={client.dateOfDeath ?? ''}
          />
          <SelectField
            id="edit-gender"
            name="gender"
            label={t('Clients.form.gender')}
            value={client.gender ?? ''}
          >
            <option value="">{t('Clients.form.notSpecified')}</option>
            <option value="female">{t('Clients.form.female')}</option>
            <option value="male">{t('Clients.form.male')}</option>
            <option value="diverse">{t('Clients.form.diverse')}</option>
          </SelectField>
          <SelectField
            id="edit-salutation"
            name="salutation"
            label={t('Clients.form.salutation')}
            value={client.salutation ?? ''}
          >
            <option value="">{t('Clients.form.notSpecified')}</option>
            <option value="mr">{t('Clients.form.mr')}</option>
            <option value="ms">{t('Clients.form.ms')}</option>
            <option value="mx">{t('Clients.form.mx')}</option>
            <option value="other">{t('Clients.form.other')}</option>
          </SelectField>
          <TextField
            id="edit-email"
            name="email"
            label={t('Clients.form.email')}
            type="email"
            defaultValue={client.email ?? ''}
          />
          <TextField
            id="edit-phone"
            name="phone"
            label={t('Clients.form.phone')}
            type="tel"
            defaultValue={client.phone ?? ''}
          />
          <TextField
            id="edit-mobile"
            name="mobile"
            label={t('Clients.form.mobilePhone')}
            type="tel"
            defaultValue={client.mobile ?? ''}
          />
        </div>
        <Button type="submit" className="w-fit">
          {t('Clients.detail.savePersonalData')}
        </Button>
      </RHFActionForm>
    </details>
  );
}
