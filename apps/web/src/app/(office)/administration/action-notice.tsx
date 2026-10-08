import { getTranslations } from 'next-intl/server';
import { errorMessageKey } from '../../../i18n/errors';

export async function ActionNotice({
  error,
  updated,
}: Readonly<{ error?: string | undefined; updated?: string | undefined }>) {
  const t = await getTranslations();
  return (
    <>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(error))}
        </p>
      ) : null}
      {updated ? (
        <p
          role="status"
          className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900"
        >
          {t('Errors.saved')}
        </p>
      ) : null}
    </>
  );
}
