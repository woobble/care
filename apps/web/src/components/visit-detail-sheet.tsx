'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@care/ui/components/sheet';

export function VisitDetailSheet({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const t = useTranslations('Visits');

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : router.back())}>
      <SheetContent
        side="right"
        closeLabel={t('closeDetails')}
        className="data-[side=right]:w-full data-[side=right]:max-w-none data-[side=right]:overflow-y-auto data-[side=right]:p-4 data-[side=right]:sm:w-[min(52rem,90vw)] data-[side=right]:sm:max-w-none data-[side=right]:sm:p-6"
      >
        <SheetTitle className="sr-only">{t('detailsSheetTitle')}</SheetTitle>
        <SheetDescription className="sr-only">{t('detailsSheetDescription')}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
