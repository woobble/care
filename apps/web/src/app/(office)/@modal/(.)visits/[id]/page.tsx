import VisitDetailContent, {
  type VisitDetailPageProps,
} from '@app/web/app/(office)/visits/[id]/visit-detail';
import { VisitDetailSheet } from '@app/web/components/visit-detail-sheet';

export default async function VisitDetailModal(props: VisitDetailPageProps) {
  const { id } = await props.params;
  return (
    <VisitDetailSheet visitId={id}>
      <VisitDetailContent {...props} />
    </VisitDetailSheet>
  );
}
