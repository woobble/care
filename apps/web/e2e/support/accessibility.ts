import { writeFile } from 'node:fs/promises';

import { AxeBuilder as PlaywrightAxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

const wcag22AaTags = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
  'best-practice',
];

export interface AccessibilityScan {
  label: string;
  violations: Array<{
    id: string;
    impact: string | null;
    help: string;
    helpUrl: string;
    criteria: string[];
    targets: unknown[][];
    elementHints: Array<{
      target: unknown[];
      tag: string | null;
      classes: string | null;
      hasAriaLabel: boolean;
      ariaLabelLength: number;
      hasTitle: boolean;
      visibleTextLength: number;
      ariaNameContainsVisibleText: boolean;
      visibleTextContainsAriaName: boolean;
      color: string;
      backgroundColor: string;
      opacity: string;
      disabled: boolean;
      rootClasses: string;
      primaryToken: string;
      primaryForegroundToken: string;
      secondaryToken: string;
      secondaryForegroundToken: string;
    }>;
  }>;
  contrastFailures: Array<{
    target: unknown[];
    checks: Array<{
      contrastRatio: number | null;
      expectedContrastRatio: number | null;
      foreground: string | null;
      background: string | null;
    }>;
  }>;
  contrast: {
    evaluatedNodes: number;
    lowestRatio: number | null;
    lowestTarget: unknown[] | null;
    incompleteNodes: number;
    incomplete: Array<{
      target: unknown[];
      checks: Array<{ id: string; message: string; data: unknown }>;
      rendered: {
        selector: string;
        tag: string;
        role: string | null;
        id: string;
        classes: string;
        color: string;
        backgroundColor: string;
        backgroundImage: string;
        opacity: string;
        filter: string;
        backdropFilter: string;
        mixBlendMode: string;
        borderColor: string;
        borderWidth: string;
        borderStyle: string;
        outlineColor: string;
        outlineWidth: string;
        outlineStyle: string;
        placeholderColor: string | null;
        visible: boolean;
        intersectsViewport: boolean;
        ariaHidden: string | null;
        inert: boolean;
        topAtCenter: { tag: string; id: string; classes: string } | null;
        fontSize: string;
        fontWeight: string;
        lineHeight: string;
        rect: { x: number; y: number; width: number; height: number };
        ancestors: Array<{
          tag: string;
          id: string;
          classes: string;
          backgroundColor: string;
          backgroundImage: string;
          opacity: string;
          filter: string;
          backdropFilter: string;
          mixBlendMode: string;
          transform: string;
          position: string;
          overflow: string;
          clipPath: string;
          ariaHidden: string | null;
          inert: boolean;
        }>;
        textStyles: Array<{
          tag: string;
          classes: string;
          color: string;
          opacity: string;
          fontSize: string;
          fontWeight: string;
          lineHeight: string;
          rects: Array<{ x: number; y: number; width: number; height: number }>;
        }>;
      } | null;
    }>;
  };
}

export interface RenderedBoundaryContrastSample {
  label: string;
  target: string;
  targetClasses: string;
  borderWidth: number;
  borderColor: string;
  backgroundColor: string;
  candidatePixels: number;
  sampledPixels: number;
  tenthPercentileRatio: number | null;
  medianRatio: number | null;
  lowestRatio: number | null;
  highestRatio: number | null;
}

export async function scanAccessibility(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<AccessibilityScan> {
  await page.waitForTimeout(300);
  const results = await new PlaywrightAxeBuilder({ page }).withTags(wcag22AaTags).analyze();
  const contrastRule = results.passes.find((rule) => rule.id === 'color-contrast');
  const contrastMeasurements = contrastRule?.nodes.flatMap((node) =>
    node.any.flatMap((check) => {
      if (!check.data || typeof check.data !== 'object' || !('contrastRatio' in check.data)) {
        return [];
      }
      const ratio = Number(check.data.contrastRatio);
      return Number.isFinite(ratio) ? [{ ratio, target: node.target }] : [];
    }),
  );
  const lowestContrast = contrastMeasurements?.length
    ? contrastMeasurements.reduce(
        (lowest, measurement) => (measurement.ratio < lowest.ratio ? measurement : lowest),
        contrastMeasurements[0]!,
      )
    : undefined;
  const incompleteContrastRule = results.incomplete.find((rule) => rule.id === 'color-contrast');
  const incompleteContrastNodes = await Promise.all(
    (incompleteContrastRule?.nodes ?? []).map(async (node) => {
      const selector = node.target.find((target): target is string => typeof target === 'string');
      const rendered = selector
        ? await page
            .locator(selector)
            .first()
            .evaluate((element, targetSelector) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              const intersectsViewport =
                rect.width > 0 &&
                rect.height > 0 &&
                rect.right > 0 &&
                rect.left < document.documentElement.clientWidth &&
                rect.bottom > 0 &&
                rect.top < document.documentElement.clientHeight;
              const visible =
                element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
                !element.closest('[hidden], [inert], [aria-hidden="true"]');
              const topElement =
                rect.width > 0 && rect.height > 0
                  ? document.elementFromPoint(
                      Math.min(
                        document.documentElement.clientWidth - 1,
                        Math.max(0, rect.x + rect.width / 2),
                      ),
                      Math.min(
                        document.documentElement.clientHeight - 1,
                        Math.max(0, rect.y + rect.height / 2),
                      ),
                    )
                  : null;
              const ancestors = [];
              let current: Element | null = element;
              while (current && ancestors.length < 8) {
                const ancestorStyle = getComputedStyle(current);
                ancestors.push({
                  tag: current.localName,
                  id: current.id,
                  classes: typeof current.className === 'string' ? current.className : '',
                  backgroundColor: ancestorStyle.backgroundColor,
                  backgroundImage: ancestorStyle.backgroundImage,
                  opacity: ancestorStyle.opacity,
                  filter: ancestorStyle.filter,
                  backdropFilter: ancestorStyle.backdropFilter,
                  mixBlendMode: ancestorStyle.mixBlendMode,
                  transform: ancestorStyle.transform,
                  position: ancestorStyle.position,
                  overflow: `${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`,
                  clipPath: ancestorStyle.clipPath,
                  ariaHidden: current.getAttribute('aria-hidden'),
                  inert: current.hasAttribute('inert'),
                });
                current = current.parentElement;
              }

              const textStyles = [];
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let textNode = walker.nextNode();
              while (textNode && textStyles.length < 60) {
                if (textNode.textContent?.trim() && textNode.parentElement) {
                  const textElement = textNode.parentElement;
                  const textStyle = getComputedStyle(textElement);
                  const range = document.createRange();
                  range.selectNodeContents(textNode);
                  textStyles.push({
                    tag: textElement.localName,
                    classes: typeof textElement.className === 'string' ? textElement.className : '',
                    color: textStyle.color,
                    opacity: textStyle.opacity,
                    fontSize: textStyle.fontSize,
                    fontWeight: textStyle.fontWeight,
                    lineHeight: textStyle.lineHeight,
                    rects: Array.from(range.getClientRects()).map((textRect) => ({
                      x: Math.round(textRect.x * 100) / 100,
                      y: Math.round(textRect.y * 100) / 100,
                      width: Math.round(textRect.width * 100) / 100,
                      height: Math.round(textRect.height * 100) / 100,
                    })),
                  });
                }
                textNode = walker.nextNode();
              }

              return {
                selector: targetSelector,
                tag: element.localName,
                role: element.getAttribute('role'),
                id: element.id,
                classes: typeof element.className === 'string' ? element.className : '',
                color: style.color,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                opacity: style.opacity,
                filter: style.filter,
                backdropFilter: style.backdropFilter,
                mixBlendMode: style.mixBlendMode,
                borderColor: style.borderColor,
                borderWidth: style.borderWidth,
                borderStyle: style.borderStyle,
                outlineColor: style.outlineColor,
                outlineWidth: style.outlineWidth,
                outlineStyle: style.outlineStyle,
                placeholderColor:
                  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                    ? getComputedStyle(element, '::placeholder').color
                    : null,
                visible,
                intersectsViewport,
                ariaHidden: element.getAttribute('aria-hidden'),
                inert: element.hasAttribute('inert'),
                topAtCenter: topElement
                  ? {
                      tag: topElement.localName,
                      id: topElement.id,
                      classes: typeof topElement.className === 'string' ? topElement.className : '',
                    }
                  : null,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                rect: {
                  x: Math.round(rect.x * 100) / 100,
                  y: Math.round(rect.y * 100) / 100,
                  width: Math.round(rect.width * 100) / 100,
                  height: Math.round(rect.height * 100) / 100,
                },
                ancestors,
                textStyles,
              };
            }, selector)
            .catch(() => null)
        : null;

      return {
        target: node.target,
        checks: [...node.any, ...node.all, ...node.none]
          .filter((check) => check.id === 'color-contrast')
          .map((check) => ({
            id: check.id,
            message: check.message,
            data: check.data ?? null,
          })),
        rendered,
      };
    }),
  );
  const contrastFailures = results.violations
    .filter((violation) => violation.id === 'color-contrast')
    .flatMap((violation) =>
      violation.nodes.map((node) => ({
        target: node.target,
        checks: [...node.any, ...node.all, ...node.none]
          .filter((check) => check.id === 'color-contrast')
          .map((check) => {
            const data = check.data as Record<string, unknown> | undefined;
            const numberOrNull = (value: unknown) => {
              const number = Number(value);
              return Number.isFinite(number) ? number : null;
            };
            return {
              contrastRatio: numberOrNull(data?.contrastRatio),
              expectedContrastRatio: numberOrNull(data?.expectedContrastRatio),
              foreground: typeof data?.fgColor === 'string' ? data.fgColor : null,
              background: typeof data?.bgColor === 'string' ? data.bgColor : null,
            };
          }),
      })),
    );
  const report: AccessibilityScan = {
    label,
    violations: await Promise.all(
      results.violations.map(async (violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        helpUrl: violation.helpUrl,
        criteria: violation.tags.filter((tag) => tag.startsWith('wcag')),
        targets: violation.nodes.map((node) => node.target),
        elementHints: await Promise.all(
          violation.nodes.map(async (node) => {
            const target = node.target;
            const selector = typeof target[0] === 'string' ? target[0] : undefined;
            const emptyHint = {
              tag: null,
              classes: null,
              hasAriaLabel: false,
              ariaLabelLength: 0,
              hasTitle: false,
              visibleTextLength: 0,
              ariaNameContainsVisibleText: false,
              visibleTextContainsAriaName: false,
              color: '',
              backgroundColor: '',
              opacity: '',
              disabled: false,
              rootClasses: '',
              primaryToken: '',
              primaryForegroundToken: '',
              secondaryToken: '',
              secondaryForegroundToken: '',
            };
            const hint = selector
              ? await page
                  .locator(selector)
                  .first()
                  .evaluate((element) => {
                    const ariaName = element.getAttribute('aria-label') ?? '';
                    const visibleText = element.textContent?.trim() ?? '';
                    const normalize = (value: string) =>
                      value.toLocaleLowerCase().replaceAll(/\s+/g, ' ').trim();
                    const normalizedAriaName = normalize(ariaName);
                    const normalizedVisibleText = normalize(visibleText);
                    const style = window.getComputedStyle(element);
                    const rootStyle = window.getComputedStyle(document.documentElement);
                    return {
                      tag: element.tagName.toLowerCase(),
                      classes: typeof element.className === 'string' ? element.className : null,
                      hasAriaLabel: ariaName.length > 0,
                      ariaLabelLength: ariaName.length,
                      hasTitle: element.hasAttribute('title'),
                      visibleTextLength: visibleText.length,
                      ariaNameContainsVisibleText:
                        normalizedVisibleText.length === 0 ||
                        normalizedAriaName.includes(normalizedVisibleText),
                      visibleTextContainsAriaName:
                        normalizedAriaName.length === 0 ||
                        normalizedVisibleText.includes(normalizedAriaName),
                      color: style.color,
                      backgroundColor: style.backgroundColor,
                      opacity: style.opacity,
                      disabled: element instanceof HTMLButtonElement && element.disabled,
                      rootClasses: document.documentElement.className,
                      primaryToken: rootStyle.getPropertyValue('--primary').trim(),
                      primaryForegroundToken: rootStyle
                        .getPropertyValue('--primary-foreground')
                        .trim(),
                      secondaryToken: rootStyle.getPropertyValue('--secondary').trim(),
                      secondaryForegroundToken: rootStyle
                        .getPropertyValue('--secondary-foreground')
                        .trim(),
                    };
                  })
                  .catch(() => emptyHint)
              : emptyHint;
            return { target, ...hint };
          }),
        ),
      })),
    ),
    contrastFailures,
    contrast: {
      evaluatedNodes: contrastMeasurements?.length ?? 0,
      lowestRatio: lowestContrast?.ratio ?? null,
      lowestTarget: lowestContrast?.target ?? null,
      incompleteNodes: incompleteContrastRule?.nodes.length ?? 0,
      incomplete: incompleteContrastNodes,
    },
  };
  const filename = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-|-$)/g, '');
  await testInfo.attach(`axe-${filename}.json`, {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  return report;
}

export async function sampleRenderedBoundaryContrast(
  page: Page,
  testInfo: TestInfo,
  label: string,
  selector: string,
): Promise<RenderedBoundaryContrastSample> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  const screenshot = await page.screenshot({ animations: 'disabled' });
  const pixels = await page.evaluate(
    async ({ imageData, targetSelector }) => {
      const element = document.querySelector(targetSelector);
      if (!element) throw new Error(`Could not find rendered contrast target: ${targetSelector}`);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const borderWidth = Number.parseFloat(style.borderTopWidth);
      const borderColorAlpha = (() => {
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
        if (!colorContext) throw new Error('Canvas color parsing is not available');
        colorContext.fillStyle = style.borderTopColor;
        colorContext.fillRect(0, 0, 1, 1);
        return (colorContext.getImageData(0, 0, 1, 1).data[3] ?? 0) / 255;
      })();
      const paintedBorder =
        borderWidth > 0 && style.borderTopStyle !== 'none' && borderColorAlpha > 0;
      const parseColor = (value: string) => {
        const colorCanvas = document.createElement('canvas');
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
        if (!colorContext) throw new Error('Canvas color parsing is not available');
        colorContext.fillStyle = value;
        colorContext.fillRect(0, 0, 1, 1);
        const data = colorContext.getImageData(0, 0, 1, 1).data;
        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
      };
      const image = new Image();
      image.src = `data:image/png;base64,${imageData}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas pixel access is not available');
      context.drawImage(image, 0, 0);
      const scaleX = canvas.width / window.innerWidth;
      const scaleY = canvas.height / window.innerHeight;
      const getPixel = (x: number, y: number) => {
        const imageX = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
        const imageY = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
        const data = context.getImageData(imageX, imageY, 1, 1).data;
        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
      };
      const averagePixel = (x: number, y: number, includeVertical = true) => {
        const neighbors = [
          getPixel(x, y),
          getPixel(x - 1, y),
          getPixel(x + 1, y),
          ...(includeVertical ? [getPixel(x, y - 1), getPixel(x, y + 1)] : []),
        ];
        return [0, 1, 2].map((channel) =>
          Math.round(
            neighbors.reduce((total, color) => total + (color[channel] ?? 0), 0) / neighbors.length,
          ),
        );
      };
      const samples: Array<{ foreground: number[]; background: number[] }> = [];
      const left = Math.ceil(rect.left + 8);
      const right = Math.floor(rect.right - 8);
      const foregroundY = Math.floor(
        (rect.top + (paintedBorder ? borderWidth / 2 : borderWidth + 1)) * scaleY,
      );
      const backgroundY = paintedBorder
        ? Math.floor((rect.top + borderWidth + 2) * scaleY)
        : Math.floor((rect.top - Math.max(2, borderWidth + 1)) * scaleY);
      for (let cssX = left; cssX < right; cssX += 2) {
        const imageX = Math.floor(cssX * scaleX);
        samples.push({
          foreground: averagePixel(imageX, foregroundY, !paintedBorder),
          background: averagePixel(imageX, backgroundY),
        });
      }
      return {
        borderWidth,
        paintedBorder,
        targetClasses: element.getAttribute('class') ?? '',
        borderColor: style.borderTopColor,
        backgroundColor: style.backgroundColor,
        borderRgb: parseColor(style.borderTopColor),
        surfaceRgb: parseColor(style.backgroundColor),
        samples,
      };
    },
    { imageData: screenshot.toString('base64'), targetSelector: selector },
  );
  const luminance = (color: number[]) => {
    const channels = color.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
  };
  const colorDistance = (first: number[], second: number[]) =>
    Math.sqrt(
      [0, 1, 2].reduce(
        (total, channel) => total + ((first[channel] ?? 0) - (second[channel] ?? 0)) ** 2,
        0,
      ),
    );
  const paintedSamples = pixels.paintedBorder
    ? pixels.samples
    : pixels.samples.filter(({ foreground }) => colorDistance(foreground, pixels.surfaceRgb) < 8);
  const ratios = paintedSamples
    .map(({ foreground, background }) => {
      const first = luminance(pixels.paintedBorder ? pixels.borderRgb : foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    })
    .sort((first, second) => first - second);
  const sampleAt = (fraction: number) =>
    ratios.length ? (ratios[Math.floor((ratios.length - 1) * fraction)] ?? null) : null;
  const report: RenderedBoundaryContrastSample = {
    label,
    target: selector,
    targetClasses: pixels.targetClasses,
    borderWidth: pixels.borderWidth,
    borderColor: pixels.borderColor,
    backgroundColor: pixels.backgroundColor,
    candidatePixels: pixels.samples.length,
    sampledPixels: paintedSamples.length,
    tenthPercentileRatio: sampleAt(0.1),
    medianRatio: sampleAt(0.5),
    lowestRatio: sampleAt(0),
    highestRatio: sampleAt(1),
  };
  const body = JSON.stringify(report, null, 2);
  const filename = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') + '.json';
  await writeFile(testInfo.outputPath(filename), body);
  await writeFile(testInfo.outputPath(filename.replace(/\.json$/, '.png')), screenshot);
  await testInfo.attach(filename, { body, contentType: 'application/json' });
  await testInfo.attach(filename.replace(/\.json$/, '.png'), {
    body: screenshot,
    contentType: 'image/png',
  });
  return report;
}

export function expectNoWcagAccessibilityViolations(scans: AccessibilityScan[]): void {
  const violations = summarizeAccessibilityViolations(scans).filter(
    (violation) => violation.criteria.length > 0,
  );
  expect(violations, 'WCAG 2.2 A/AA scans should be clean').toEqual([]);
}

export async function writeAccessibilityReport(
  scans: AccessibilityScan[],
  testInfo: TestInfo,
  filename: string,
  additionalEvidence: Record<string, unknown> = {},
): Promise<void> {
  const report = {
    scanCount: scans.length,
    scans,
    violations: summarizeAccessibilityViolations(scans),
    ...additionalEvidence,
  };
  const body = JSON.stringify(report, null, 2);
  await writeFile(testInfo.outputPath(filename), body);
  await testInfo.attach(filename, { body, contentType: 'application/json' });
}

export function summarizeAccessibilityViolations(scans: AccessibilityScan[]) {
  const grouped = new Map<
    string,
    {
      id: string;
      impact: string | null;
      criteria: string[];
      occurrences: number;
      scans: Set<string>;
      targets: Map<string, unknown[]>;
      elementHints: Map<string, unknown>;
    }
  >();
  for (const scan of scans) {
    for (const violation of scan.violations) {
      const key = `${violation.id}:${violation.criteria.join(',')}`;
      const current = grouped.get(key) ?? {
        id: violation.id,
        impact: violation.impact,
        criteria: violation.criteria,
        occurrences: 0,
        scans: new Set<string>(),
        targets: new Map<string, unknown[]>(),
        elementHints: new Map<string, unknown>(),
      };
      current.occurrences += 1;
      current.scans.add(scan.label);
      for (const target of violation.targets) current.targets.set(JSON.stringify(target), target);
      for (const hint of violation.elementHints) {
        current.elementHints.set(JSON.stringify(hint.target), hint);
      }
      grouped.set(key, current);
    }
  }
  return [...grouped.values()].map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    criteria: violation.criteria,
    occurrences: violation.occurrences,
    scans: [...violation.scans],
    targets: [...violation.targets.values()],
    elementHints: [...violation.elementHints.values()],
  }));
}
