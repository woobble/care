import VisitDetailContent, {
  type VisitDetailPageProps,
} from '@app/web/app/(office)/visits/[id]/visit-detail';
import { VisitDetailSheet } from '@app/web/components/visit-detail-sheet';

export default function VisitDetailModal(props: VisitDetailPageProps) {
  return (
    <VisitDetailSheet>
      <VisitDetailContent {...props} />
    </VisitDetailSheet>
  );
}
