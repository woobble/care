import { renderDocumentPdf } from '@care/documents';
import type { DocumentPayload } from '@care/documents';
import type { PdfBranding } from '@care/documents';
import type { TaxTreatment } from '@module/billing/domain/billing';

export interface InvoicePdfLine {
  serviceCode: string;
  serviceName: string;
  serviceDate: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  taxTreatment: TaxTreatment;
  taxRateBasisPoints: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
  fundingReference: string | null;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  servicePeriodFrom: string | null;
  servicePeriodUntil: string | null;
  issuer: {
    legalName: string;
    tradingName: string;
    address: string;
    taxNumber: string | null;
    vatId: string | null;
    bankAccountHolder: string | null;
    iban: string | null;
    bic: string | null;
    taxExemptionBasis: string | null;
  };
  recipient: {
    name: string;
    address: string;
    payerReference: string | null;
    payerType: string | null;
  };
  currency: 'EUR';
  lines: InvoicePdfLine[];
  subtotalCents: number;
  taxTotalCents: number;
  grandTotalCents: number;
}

export interface CorrectionPdfData extends InvoicePdfData {
  correctionNumber: string;
  reason: string;
  correctionDate: string;
  originalIssueDate?: string | null;
  correctionAmountCents: number;
  outstandingAfterCorrectionCents: number;
  correctionLines: Array<{ serviceName: string; amountCents: number }>;
}

const defaultBranding: PdfBranding = {
  primaryColor: '#1D4ED8',
  headerText: null,
  footerText: null,
  contactEmail: null,
  contactPhone: null,
  contactWebsite: null,
  logo: null,
};

export class BillingPdfRenderer {
  async renderInvoice(
    invoice: InvoicePdfData,
    branding = defaultBranding,
    locale: 'de' | 'en' = 'de',
  ) {
    const payload: DocumentPayload = {
      documentType: 'invoice',
      locale,
      title: `${label(locale, 'Rechnung', 'Invoice')} ${invoice.invoiceNumber}`,
      provider: {
        name: invoice.issuer.legalName,
        addressLines: addressLines(invoice.issuer.address),
      },
      recipient: {
        name: invoice.recipient.name,
        addressLines: addressLines(invoice.recipient.address),
        reference: invoice.recipient.payerReference,
      },
      metadata: [
        { label: label(locale, 'Rechnungsnummer', 'Invoice number'), value: invoice.invoiceNumber },
        {
          label: label(locale, 'Rechnungsdatum', 'Issue date'),
          value: formatDate(invoice.issueDate, locale),
        },
        {
          label: label(locale, 'Leistungszeitraum', 'Service period'),
          value: formatPeriod(invoice.servicePeriodFrom, invoice.servicePeriodUntil, locale),
        },
        {
          label: label(locale, 'Fällig am', 'Due date'),
          value: formatDate(invoice.dueDate, locale),
        },
        ...(invoice.issuer.taxNumber
          ? [
              {
                label: label(locale, 'Steuernummer', 'Tax number'),
                value: invoice.issuer.taxNumber,
              },
            ]
          : []),
        ...(invoice.issuer.vatId ? [{ label: 'USt-IdNr.', value: invoice.issuer.vatId }] : []),
      ],
      sections: [
        {
          title: label(locale, 'Leistungen', 'Services'),
          columns: [
            label(locale, 'Datum', 'Date'),
            label(locale, 'Leistung', 'Service'),
            label(locale, 'Menge', 'Quantity'),
            label(locale, 'Einzelpreis', 'Unit price'),
            label(locale, 'Betrag', 'Amount'),
          ],
          rows: invoice.lines.map((line) => [
            formatDate(line.serviceDate, locale),
            `${line.serviceCode} ${line.serviceName}${line.fundingReference ? `\n${label(locale, 'Kostenzuordnung', 'Funding')}: ${line.fundingReference}` : ''}`,
            `${line.quantity} ${line.unit}`,
            money(line.unitPriceCents, locale),
            `${money(line.grossCents, locale)}\n${taxLabel(line, locale)}`,
          ]),
        },
        {
          title: label(locale, 'Zahlungsinformationen', 'Payment information'),
          paragraphs: [
            `${label(locale, 'Zahlungsempfänger', 'Payee')}: ${invoice.issuer.bankAccountHolder ?? invoice.issuer.legalName}`,
            ...(invoice.issuer.iban ? [`IBAN: ${invoice.issuer.iban}`] : []),
            ...(invoice.issuer.bic ? [`BIC: ${invoice.issuer.bic}`] : []),
            `${label(locale, 'Verwendungszweck', 'Payment reference')}: ${invoice.invoiceNumber}`,
            label(
              locale,
              'Dieses Dokument bestätigt keine Erstattung durch einen Kostenträger.',
              'This document does not confirm reimbursement by a payer.',
            ),
          ],
        },
      ],
      totals: [
        {
          label: label(locale, 'Nettobetrag', 'Net total'),
          value: money(invoice.subtotalCents, locale),
        },
        {
          label: label(locale, 'Umsatzsteuer', 'Tax total'),
          value: money(invoice.taxTotalCents, locale),
        },
        {
          label: label(locale, 'Rechnungsbetrag', 'Invoice total'),
          value: money(invoice.grandTotalCents, locale),
          emphasized: true,
        },
      ],
      notices: invoice.issuer.taxExemptionBasis
        ? [`${label(locale, 'Steuerhinweis', 'Tax notice')}: ${invoice.issuer.taxExemptionBasis}`]
        : [],
    };
    return renderDocumentPdf(payload, branding);
  }

  async renderCorrection(
    correction: CorrectionPdfData,
    branding = defaultBranding,
    locale: 'de' | 'en' = 'de',
  ) {
    const payload: DocumentPayload = {
      documentType: 'invoice_correction',
      locale,
      title: label(locale, 'Rechnungskorrektur', 'Invoice correction'),
      provider: {
        name: correction.issuer.legalName,
        addressLines: addressLines(correction.issuer.address),
      },
      recipient: {
        name: correction.recipient.name,
        addressLines: addressLines(correction.recipient.address),
        reference: correction.recipient.payerReference,
      },
      metadata: [
        {
          label: label(locale, 'Korrekturbeleg', 'Correction number'),
          value: correction.correctionNumber,
        },
        {
          label: label(locale, 'Bezug auf Rechnung', 'Original invoice'),
          value: correction.invoiceNumber,
        },
        ...(correction.originalIssueDate
          ? [
              {
                label: label(locale, 'Originaldatum', 'Original issue date'),
                value: formatDate(correction.originalIssueDate, locale),
              },
            ]
          : []),
        {
          label: label(locale, 'Korrekturdatum', 'Correction date'),
          value: formatDate(correction.correctionDate, locale),
        },
      ],
      sections: [
        {
          title: label(locale, 'Korrekturgrund', 'Correction reason'),
          paragraphs: [correction.reason],
        },
        {
          title: label(locale, 'Korrigierte Positionen', 'Corrected lines'),
          columns: [
            label(locale, 'Position', 'Line item'),
            label(locale, 'Korrekturbetrag', 'Correction amount'),
          ],
          rows: correction.correctionLines.map((line) => [
            line.serviceName,
            `−${money(line.amountCents, locale)}`,
          ]),
        },
      ],
      totals: [
        {
          label: label(locale, 'Korrekturbetrag', 'Correction amount'),
          value: `−${money(correction.correctionAmountCents, locale)}`,
          emphasized: true,
        },
        {
          label: label(locale, 'Offener Betrag nach Korrektur', 'Outstanding after correction'),
          value: money(correction.outstandingAfterCorrectionCents, locale),
        },
      ],
      notices: [
        label(
          locale,
          'Die ursprüngliche Rechnung bleibt unverändert. Dieser Beleg ist eine Rechnungskorrektur.',
          'The original invoice remains unchanged. This document is an invoice correction.',
        ),
      ],
    };
    return renderDocumentPdf(payload, branding);
  }
}

function addressLines(address: string): string[] {
  return address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function money(cents: number, locale: 'de' | 'en'): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Invoice amounts must use whole cents');
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

function formatDate(value: string, locale: 'de' | 'en'): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(date);
}

function formatPeriod(from: string | null, until: string | null, locale: 'de' | 'en'): string {
  if (!from && !until) return label(locale, 'Nicht angegeben', 'Not specified');
  if (from === until) return formatDate(from!, locale);
  return `${from ? formatDate(from, locale) : '—'} ${label(locale, 'bis', 'to')} ${until ? formatDate(until, locale) : '—'}`;
}

function taxLabel(line: InvoicePdfLine, locale: 'de' | 'en'): string {
  if (line.taxTreatment === 'taxable') {
    return `${line.taxRateBasisPoints / 100}% ${label(locale, 'Steuer', 'tax')} (${money(line.taxCents, locale)})`;
  }
  return line.taxTreatment === 'small_business'
    ? label(locale, 'Kleinunternehmerregelung', 'Small business scheme')
    : label(locale, 'Steuerfrei', 'Tax exempt');
}

function label(locale: 'de' | 'en', de: string, en: string): string {
  return locale === 'de' ? de : en;
}
