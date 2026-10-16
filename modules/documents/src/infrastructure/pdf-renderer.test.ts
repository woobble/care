import { describe, expect, test } from 'bun:test';

import { PDFDocument } from 'pdf-lib';

import type { DocumentPayload } from '@module/documents/domain/documents';

import { renderDocumentPdf } from './pdf-renderer';

describe('document PDF renderer', () => {
  test('renders long service tables across multiple readable PDF pages', async () => {
    const payload: DocumentPayload = {
      documentType: 'service_evidence',
      locale: 'de',
      title: 'Leistungsnachweis',
      provider: { name: 'Demo Betreuungsdienst', addressLines: ['Musterstraße 1', '10115 Berlin'] },
      recipient: { name: 'Erika Beispiel', addressLines: ['Beispielweg 2', '10117 Berlin'] },
      sections: [
        {
          title: 'Leistungen',
          columns: ['Datum', 'Leistung', 'Menge'],
          rows: Array.from({ length: 80 }, (_, index) => [
            `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
            `Alltagsbegleitung ${index + 1}`,
            '1,5 Stunden',
          ]),
        },
      ],
    };
    const bytes = await renderDocumentPdf(payload, {
      primaryColor: '#1D4ED8',
      headerText: null,
      footerText: 'Demo Betreuungsdienst',
      contactEmail: 'office@example.test',
      contactPhone: null,
      contactWebsite: null,
    });

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('%PDF');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
