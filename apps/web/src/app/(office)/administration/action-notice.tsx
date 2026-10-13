import { getTranslations } from 'next-intl/server';
import { errorMessageKey } from '@app/web/i18n/errors';
import { Alert, AlertDescription } from '@care/ui/components/alert';

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
          className="rounded-md border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          <AlertDescription className="text-inherit">{t(errorMessageKey(error))}</AlertDescription>
        </Alert>
      ) : null}
      {updated ? (
        <Alert
          role="status"
          className="rounded-md border border-success/40 bg-success-muted p-3 text-success-foreground"
        >
          <AlertDescription className="text-inherit">{t('Errors.saved')}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
