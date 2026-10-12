import { getTranslations } from 'next-intl/server';
import { errorMessageKey } from '@app/web/i18n/errors';
import { Alert, AlertDescription } from '@care/ui';

export async function ActionNotice({
  error,
  updated,
}: Readonly<{ error?: string | undefined; updated?: string | undefined }>) {
  const t = await getTranslations();
  return (
    <>
      {error ? (
        <Alert
          variant="destructive"
          className="rounded-md border-red-300 bg-red-50 p-3 text-red-900"
        >
          <AlertDescription className="text-inherit">{t(errorMessageKey(error))}</AlertDescription>
        </Alert>
      ) : null}
      {updated ? (
        <Alert
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          <AlertDescription className="text-inherit">{t('Errors.saved')}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
