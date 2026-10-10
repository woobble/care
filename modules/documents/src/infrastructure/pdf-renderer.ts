import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import type { DocumentPayload } from '../domain/documents';

export interface PdfBranding {
  primaryColor: string;
  headerText: string | null;
  footerText: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactWebsite: string | null;
  logo?: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' } | null;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 44;
const RIGHT = 44;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
const CONTENT_BOTTOM = 62;

export async function renderDocumentPdf(
  payload: DocumentPayload,
  branding: PdfBranding,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(payload.title);
  document.setSubject(documentTypeLabel(payload.documentType, payload.locale));
  document.setProducer('Care Platform');
  document.setCreator('Care Platform document renderer v1');
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const accent = parseColor(branding.primaryColor);
  const paleAccent = rgb(
    Math.min(1, accent.red * 0.11 + 0.89),
    Math.min(1, accent.green * 0.11 + 0.89),
    Math.min(1, accent.blue * 0.11 + 0.89),
  );
  let logo: PDFImage | null = null;
  if (branding.logo) {
    logo =
      branding.logo.mimeType === 'image/png'
        ? await document.embedPng(branding.logo.bytes)
        : await document.embedJpg(branding.logo.bytes);
  }

  let page!: PDFPage;
  let cursorY: number;
  const pages: PDFPage[] = [];
  const beginPage = (continued: boolean): void => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    cursorY = PAGE_HEIGHT - 42;
    if (continued) {
      page.drawText(payload.provider.name, {
        x: LEFT,
        y: cursorY,
        size: 9,
        font: bold,
        color: accent,
      });
      cursorY -= 16;
      page.drawText(`${payload.title} (${label(payload.locale, 'Fortsetzung', 'continued')})`, {
        x: LEFT,
        y: cursorY,
        size: 9,
        font: regular,
        color: rgb(0.28, 0.32, 0.38),
      });
      cursorY -= 20;
    } else {
      drawFirstPageHeader(page, payload, branding, logo, regular, bold, accent);
      cursorY = PAGE_HEIGHT - (logo ? 120 : 108);
    }
  };
  const ensureSpace = (height: number, continued = true): void => {
    if (cursorY - height < CONTENT_BOTTOM) beginPage(continued);
  };
  const drawParagraph = (value: string, size = 9.5, font: PDFFont = regular): void => {
    const lines = wrapText(value, font, size, CONTENT_WIDTH);
    const lineHeight = size + 4;
    for (const line of lines) {
      ensureSpace(lineHeight + 4);
      page.drawText(line, { x: LEFT, y: cursorY, size, font, color: rgb(0.16, 0.19, 0.23) });
      cursorY -= lineHeight;
    }
    cursorY -= 4;
  };

  beginPage(false);
  cursorY = drawIdentityBlock(page, payload, regular, bold, accent);

  for (const section of payload.sections) {
    ensureSpace(34);
    page.drawText(section.title, { x: LEFT, y: cursorY, size: 11, font: bold, color: accent });
    cursorY -= 18;
    for (const paragraph of section.paragraphs ?? []) drawParagraph(paragraph);
    if (section.columns?.length) {
      if (section.rows?.length) {
        drawTable(
          section.title,
          section.columns,
          section.rows,
          regular,
          bold,
          accent,
          paleAccent,
          ensureSpace,
          () => page,
          () => cursorY,
          (nextY) => {
            cursorY = nextY;
          },
          payload.locale === 'de' ? 'Fortsetzung' : 'continued',
        );
      } else {
        drawTableHeader(page, section.columns, bold, accent, paleAccent, cursorY);
        cursorY -= 23;
      }
    }
    cursorY -= 9;
  }

  if (payload.totals?.length) {
    const totalHeight = payload.totals.length * 19 + 14;
    ensureSpace(totalHeight);
    cursorY -= 3;
    page.drawLine({
      start: { x: LEFT, y: cursorY },
      end: { x: PAGE_WIDTH - RIGHT, y: cursorY },
      color: accent,
      thickness: 1,
    });
    cursorY -= 17;
    for (const total of payload.totals) {
      const font = total.emphasized ? bold : regular;
      const size = total.emphasized ? 11 : 9.5;
      page.drawText(total.label, { x: LEFT, y: cursorY, size, font, color: rgb(0.16, 0.19, 0.23) });
      rightText(page, total.value, PAGE_WIDTH - RIGHT, cursorY, size, font, rgb(0.16, 0.19, 0.23));
      cursorY -= 19;
    }
  }

  for (const acknowledgement of payload.acknowledgements ?? []) {
    const hasSignature =
      acknowledgement.status === 'acknowledged' &&
      acknowledgement.method === 'touch_signature' &&
      acknowledgement.signatureStrokes?.length;
    const blockHeight = hasSignature ? 132 : 105;
    ensureSpace(blockHeight);
    page.drawText(label(payload.locale, 'Bestätigung', 'Acknowledgement'), {
      x: LEFT,
      y: cursorY,
      size: 11,
      font: bold,
      color: accent,
    });
    cursorY -= 19;
    page.drawText(acknowledgementLabel(acknowledgement.status, payload.locale), {
      x: LEFT,
      y: cursorY,
      size: 9.5,
      font: bold,
      color: rgb(0.16, 0.19, 0.23),
    });
    cursorY -= 15;
    const details = [
      acknowledgement.signatoryName,
      methodLabel(acknowledgement.method, payload.locale),
      acknowledgement.statementVersion
        ? `${label(payload.locale, 'Erklärung', 'Statement')} ${acknowledgement.statementVersion}`
        : null,
      acknowledgement.occurredAt,
      `${label(payload.locale, 'Nachweispaket', 'Evidence package')} v${acknowledgement.evidencePackageVersion} · ${acknowledgement.evidencePackageHash.slice(0, 12)}`,
    ].filter((value): value is string => Boolean(value));
    for (const detail of details) drawParagraph(detail, 8.5);
    if (acknowledgement.statementText) drawParagraph(acknowledgement.statementText, 8.5);
    if (acknowledgement.declineReason) {
      drawParagraph(
        `${label(payload.locale, 'Ablehnungsgrund', 'Decline reason')}: ${acknowledgement.declineReason}`,
        8.5,
      );
    }
    if (acknowledgement.declineNote) drawParagraph(acknowledgement.declineNote, 8.5);
    if (hasSignature) {
      ensureSpace(74);
      const box = { x: LEFT, y: cursorY - 62, width: 220, height: 54 };
      page.drawRectangle({ ...box, borderColor: rgb(0.72, 0.75, 0.79), borderWidth: 0.7 });
      drawSignature(page, acknowledgement.signatureStrokes!, box, accent);
      cursorY -= 72;
    }
    cursorY -= 10;
  }

  for (const notice of payload.notices ?? []) {
    drawParagraph(notice, 8.5);
  }

  pages.forEach((target, index) => {
    target.drawLine({
      start: { x: LEFT, y: 45 },
      end: { x: PAGE_WIDTH - RIGHT, y: 45 },
      color: rgb(0.83, 0.85, 0.88),
      thickness: 0.5,
    });
    const footer = [
      branding.footerText,
      [branding.contactEmail, branding.contactPhone, branding.contactWebsite]
        .filter(Boolean)
        .join(' · '),
      `${index + 1} / ${pages.length}`,
    ]
      .filter(Boolean)
      .join(' · ');
    target.drawText(footer, {
      x: LEFT,
      y: 29,
      size: 7.5,
      font: regular,
      color: rgb(0.38, 0.41, 0.45),
      maxWidth: CONTENT_WIDTH,
    });
  });

  return document.save({ useObjectStreams: false });
}

function drawFirstPageHeader(
  page: PDFPage,
  payload: DocumentPayload,
  branding: PdfBranding,
  logo: PDFImage | null,
  regular: PDFFont,
  bold: PDFFont,
  accent: RGB,
): void {
  let providerX = LEFT;
  let providerWidth = CONTENT_WIDTH;
  if (logo) {
    const scale = Math.min(1, 102 / logo.width, 54 / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    page.drawImage(logo, { x: LEFT, y: PAGE_HEIGHT - 88, width, height });
    providerX = LEFT + 116;
    providerWidth -= 116;
  }
  const providerLines = [
    payload.provider.name,
    ...payload.provider.addressLines,
    payload.provider.phone,
    payload.provider.email,
    payload.provider.website,
    branding.headerText,
  ].filter((line): line is string => Boolean(line));
  let y = PAGE_HEIGHT - 48;
  for (const [index, line] of providerLines.entries()) {
    const font = index === 0 ? bold : regular;
    const size = index === 0 ? 11 : 8.2;
    for (const wrapped of wrapText(line, font, size, providerWidth)) {
      if (y < PAGE_HEIGHT - 95) break;
      page.drawText(wrapped, { x: providerX, y, size, font, color: rgb(0.18, 0.21, 0.25) });
      y -= size + 3;
    }
  }
  page.drawLine({
    start: { x: LEFT, y: PAGE_HEIGHT - 99 },
    end: { x: PAGE_WIDTH - RIGHT, y: PAGE_HEIGHT - 99 },
    color: accent,
    thickness: 1.5,
  });
  const titleY = PAGE_HEIGHT - 122;
  page.drawText(payload.title, { x: LEFT, y: titleY, size: 19, font: bold, color: accent });
  if (payload.subtitle) {
    page.drawText(payload.subtitle, {
      x: LEFT,
      y: titleY - 18,
      size: 10,
      font: regular,
      color: rgb(0.36, 0.39, 0.43),
      maxWidth: CONTENT_WIDTH,
    });
  }
}

function drawIdentityBlock(
  page: PDFPage,
  payload: DocumentPayload,
  regular: PDFFont,
  bold: PDFFont,
  accent: RGB,
): number {
  let recipientBottom = page.getHeight() - 174;
  if (payload.recipient) {
    page.drawText(label(payload.locale, 'Empfänger', 'Recipient'), {
      x: LEFT,
      y: page.getHeight() - 158,
      size: 8,
      font: bold,
      color: accent,
    });
    page.drawText(payload.recipient.name, {
      x: LEFT,
      y: page.getHeight() - 174,
      size: 10,
      font: bold,
      color: rgb(0.16, 0.19, 0.23),
    });
    let recipientY = page.getHeight() - 188;
    for (const addressLine of payload.recipient.addressLines.slice(0, 5)) {
      page.drawText(addressLine, {
        x: LEFT,
        y: recipientY,
        size: 8.5,
        font: regular,
        color: rgb(0.24, 0.27, 0.31),
      });
      recipientY -= 12;
    }
    recipientBottom = recipientY;
    if (payload.recipient.reference) {
      page.drawText(
        `${label(payload.locale, 'Referenz', 'Reference')}: ${payload.recipient.reference}`,
        {
          x: LEFT,
          y: recipientY - 2,
          size: 8,
          font: regular,
          color: rgb(0.36, 0.39, 0.43),
          maxWidth: CONTENT_WIDTH,
        },
      );
      recipientBottom -= 14;
    }
  }
  const metadata = payload.metadata ?? [];
  if (metadata.length) {
    const startY = payload.recipient ? page.getHeight() - 158 : page.getHeight() - 158;
    const x = payload.recipient ? PAGE_WIDTH - RIGHT - 210 : LEFT;
    const width = payload.recipient ? 210 : CONTENT_WIDTH;
    let y = startY;
    for (const item of metadata.slice(0, 8)) {
      const labelText = `${item.label}:`;
      page.drawText(labelText, { x, y, size: 7.5, font: bold, color: accent, maxWidth: width });
      y -= 11;
      for (const line of wrapText(item.value, regular, 8.5, width)) {
        page.drawText(line, { x, y, size: 8.5, font: regular, color: rgb(0.2, 0.23, 0.27) });
        y -= 12;
      }
      y -= 2;
    }
    recipientBottom = Math.min(recipientBottom, y);
  }
  const firstSectionY = Math.min(recipientBottom, page.getHeight() - 190) - 10;
  page.drawLine({
    start: { x: LEFT, y: firstSectionY },
    end: { x: PAGE_WIDTH - RIGHT, y: firstSectionY },
    color: rgb(0.85, 0.87, 0.9),
    thickness: 0.6,
  });
  return firstSectionY - 20;
}

function drawTable(
  sectionTitle: string,
  columns: string[],
  rows: string[][],
  regular: PDFFont,
  bold: PDFFont,
  accent: RGB,
  paleAccent: RGB,
  ensureSpace: (height: number) => void,
  getPage: () => PDFPage,
  getCursorY: () => number,
  setCursorY: (value: number) => void,
  continuedText: string,
): void {
  const widths = columnWidths(columns.length);
  const headerHeight = 23;
  const drawHeader = (): void => {
    const current = getPage();
    const y = getCursorY();
    drawTableHeader(current, columns, bold, accent, paleAccent, y, widths);
    setCursorY(y - headerHeight);
  };
  drawHeader();
  for (const [rowIndex, row] of rows.entries()) {
    const wrapped = row.map((cell, index) =>
      wrapText(cell, regular, 8, Math.max(18, widths[index]! - 12)),
    );
    const rowHeight = Math.max(22, Math.max(...wrapped.map((lines) => lines.length)) * 10.5 + 10);
    if (rowHeight > 660) {
      throw new RangeError('A document table row exceeds the printable page height');
    }
    const oldPage = getPage();
    ensureSpace(rowHeight + headerHeight + 20);
    if (oldPage !== getPage()) {
      const current = getPage();
      current.drawText(`${sectionTitle} (${continuedText})`, {
        x: LEFT,
        y: getCursorY(),
        size: 8.5,
        font: bold,
        color: accent,
      });
      setCursorY(getCursorY() - 14);
      drawHeader();
    }
    const current = getPage();
    const y = getCursorY();
    const background = rowIndex % 2 === 0 ? rgb(1, 1, 1) : rgb(0.975, 0.978, 0.982);
    current.drawRectangle({
      x: LEFT,
      y: y - rowHeight + 4,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: background,
      borderColor: rgb(0.88, 0.89, 0.91),
      borderWidth: 0.35,
    });
    let x = LEFT + 6;
    for (const [cellIndex, lines] of wrapped.entries()) {
      let cellY = y - 10;
      for (const line of lines) {
        current.drawText(line, {
          x,
          y: cellY,
          size: 8,
          font: cellIndex === 0 && columns.length > 3 ? bold : regular,
          color: rgb(0.18, 0.2, 0.24),
        });
        cellY -= 10.5;
      }
      x += widths[cellIndex]!;
    }
    setCursorY(y - rowHeight - 1);
  }
}

function drawTableHeader(
  page: PDFPage,
  columns: string[],
  font: PDFFont,
  accent: RGB,
  background: RGB,
  y: number,
  existingWidths?: number[],
): void {
  const widths = existingWidths ?? columnWidths(columns.length);
  page.drawRectangle({ x: LEFT, y: y - 19, width: CONTENT_WIDTH, height: 22, color: background });
  let x = LEFT + 6;
  for (const [index, column] of columns.entries()) {
    page.drawText(column, {
      x,
      y: y - 12,
      size: 8,
      font,
      color: accent,
      maxWidth: widths[index]! - 12,
    });
    x += widths[index]!;
  }
}

function drawSignature(
  page: PDFPage,
  strokes: Array<Array<{ x: number; y: number }>>,
  box: { x: number; y: number; width: number; height: number },
  color: RGB,
): void {
  const padding = 6;
  const points = strokes.flat();
  if (points.length === 0) return;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const sourceWidth = Math.max(0.001, maxX - minX);
  const sourceHeight = Math.max(0.001, maxY - minY);
  const scale = Math.min(
    (box.width - padding * 2) / sourceWidth,
    (box.height - padding * 2) / sourceHeight,
  );
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = box.x + padding + (box.width - padding * 2 - renderedWidth) / 2;
  const offsetY = box.y + padding + (box.height - padding * 2 - renderedHeight) / 2;
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      const previous = stroke[index - 1]!;
      const current = stroke[index]!;
      page.drawLine({
        start: {
          x: offsetX + (previous.x - minX) * scale,
          y: offsetY + (maxY - previous.y) * scale,
        },
        end: {
          x: offsetX + (current.x - minX) * scale,
          y: offsetY + (maxY - current.y) * scale,
        },
        thickness: 1.2,
        color,
      });
    }
  }
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = '';
    for (const character of word) {
      const next = fragment + character;
      if (fragment && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function columnWidths(count: number): number[] {
  if (count === 2) return [CONTENT_WIDTH * 0.34, CONTENT_WIDTH * 0.66];
  if (count === 3) return [CONTENT_WIDTH * 0.21, CONTENT_WIDTH * 0.56, CONTENT_WIDTH * 0.23];
  if (count === 4)
    return [CONTENT_WIDTH * 0.16, CONTENT_WIDTH * 0.47, CONTENT_WIDTH * 0.2, CONTENT_WIDTH * 0.17];
  return Array.from({ length: count }, () => CONTENT_WIDTH / Math.max(1, count));
}

function parseColor(hex: string): RGB {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new TypeError('Invalid PDF theme color');
  const value = match[1]!;
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  );
}

function rightText(
  page: PDFPage,
  value: string,
  right: number,
  y: number,
  size: number,
  font: PDFFont,
  color: RGB,
): void {
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: right - width, y, size, font, color });
}

function documentTypeLabel(type: DocumentPayload['documentType'], locale: 'de' | 'en'): string {
  const labels = {
    service_evidence: ['Leistungsnachweis', 'Service evidence'],
    service_agreement: ['Leistungsvereinbarung', 'Service agreement'],
    invoice: ['Rechnung', 'Invoice'],
    invoice_correction: ['Rechnungskorrektur', 'Invoice correction'],
    benefit_overview: ['Budgetübersicht', 'Budget overview'],
    claim_summary: ['Abrechnungsfall', 'Payer claim summary'],
  } as const;
  return labels[type][locale === 'de' ? 0 : 1];
}

function acknowledgementLabel(status: string, locale: 'de' | 'en'): string {
  const values: Record<string, [string, string]> = {
    acknowledged: ['Bestätigt', 'Acknowledged'],
    declined: ['Abgelehnt', 'Declined'],
    revoked: ['Widerrufen', 'Revoked'],
    outdated: ['Veraltet / ersetzt', 'Outdated / superseded'],
    awaiting_acknowledgement: ['Noch nicht bestätigt', 'Not yet acknowledged'],
  };
  const pair = values[status] ?? values.awaiting_acknowledgement!;
  return pair[locale === 'de' ? 0 : 1];
}

function methodLabel(method: string | null | undefined, locale: 'de' | 'en'): string | null {
  if (!method) return null;
  const values: Record<string, [string, string]> = {
    touch_signature: ['Unterschrift auf dem Touchscreen', 'Touch signature'],
    typed_confirmation: ['Bestätigung per Namenseingabe', 'Typed confirmation'],
    staff_recorded_decline: ['Ablehnung durch Mitarbeitende erfasst', 'Decline recorded by staff'],
  };
  const pair = values[method];
  return pair ? pair[locale === 'de' ? 0 : 1] : method;
}

function label(locale: 'de' | 'en', de: string, en: string): string {
  return locale === 'de' ? de : en;
}
