import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import type { NoticeScenario } from '../scripts/error-notices.fixture';

const cases: Array<{
  route: NoticeScenario['route'];
  name: string;
  options: Partial<NoticeScenario>;
}> = [
  { route: 'employees', name: 'query', options: { queryError: 'TEST_ERROR' } },
  { route: 'employees', name: 'load', options: { loadError: true } },
  { route: 'employees', name: 'normal', options: {} },
  { route: 'operations', name: 'query', options: { queryError: 'INSUFFICIENT_PERMISSION' } },
  { route: 'operations', name: 'load', options: { loadError: true } },
  { route: 'operations', name: 'normal', options: {} },
];
let css: string;
test.beforeAll(async () => {
  if (process.env.ERROR_NOTICE_CSS) css = await readFile(process.env.ERROR_NOTICE_CSS, 'utf8');
  else {
    const directory = resolve(import.meta.dirname, '../.next/static/chunks');
    const files = (await readdir(directory)).filter((name) => name.endsWith('.css'));
    if (!files.length)
      throw new Error('Build the web app before capturing styled notice screenshots');
    css = (await Promise.all(files.map((name) => readFile(join(directory, name), 'utf8')))).join(
      '\n',
    );
  }
});
async function show(page: Page, html: string, locale: string) {
  await page.setContent(
    `<!doctype html><html lang="${locale}"><head><title>Isolated route notices</title><style>${css}</style></head><body><main class="p-4">${html}</main></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
}
async function metrics(page: Page) {
  return page.locator('[role="alert"]').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: element.textContent,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        padding: style.padding,
        color: style.color,
        background: style.backgroundColor,
        border: style.border,
        radius: style.borderRadius,
      };
    }),
  );
}
async function tabs(page: Page) {
  const sequence: string[] = [];
  // oxlint-disable no-await-in-loop -- Keyboard focus must advance and be observed sequentially.
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Tab');
    sequence.push(
      await page.evaluate(() => {
        const el = document.activeElement!;
        return [el.tagName, el.id, el.getAttribute('name'), el.getAttribute('href')].join('|');
      }),
    );
  }
  // oxlint-enable no-await-in-loop
  return sequence;
}

for (const locale of ['en', 'de'] as const)
  for (const width of [390, 768, 1440]) {
    test(`route notice screenshots, semantics and keyboard order (${locale}, ${width}px)`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const screenshotDirectory =
        process.env.ERROR_NOTICE_SCREENSHOTS_DIR ?? testInfo.outputPath('screenshots');
      await mkdir(screenshotDirectory, { recursive: true });
      // oxlint-disable no-await-in-loop -- Each baseline/current pair uses the same page and viewport.
      for (const { route, name, options } of cases) {
        const label = `${locale}-${route}-${name}`;
        const current = JSON.parse(
          execFileSync(
            'bun',
            [
              resolve(import.meta.dirname, '../scripts/error-notices.fixture.tsx'),
              JSON.stringify({ route, locale, ...options }),
            ],
            { encoding: 'utf8' },
          ),
        ) as { html: string; requests: unknown[] };
        let beforeMetrics: Awaited<ReturnType<typeof metrics>> | undefined;
        let beforeTabs: string[] | undefined;
        let beforeViolations: string[] | undefined;
        if (process.env.ERROR_NOTICE_BASELINE_DIR) {
          const baseline = JSON.parse(
            await readFile(join(process.env.ERROR_NOTICE_BASELINE_DIR, `${label}.json`), 'utf8'),
          ) as typeof current;
          expect(current.requests).toEqual(baseline.requests);
          await show(page, baseline.html, locale);
          beforeMetrics = await metrics(page);
          await page.screenshot({
            path: join(screenshotDirectory, `${label}-${width}-before.png`),
          });
          beforeViolations = beforeMetrics.length
            ? (await new AxeBuilder({ page }).include('[role="alert"]').analyze()).violations.map(
                (violation) => violation.id,
              )
            : [];
          beforeTabs = await tabs(page);
        }
        await show(page, current.html, locale);
        const afterMetrics = await metrics(page);
        expect(afterMetrics).toHaveLength(name === 'normal' ? 0 : 1);
        for (const metric of afterMetrics) expect(metric.padding).toBe('12px');
        await page.screenshot({ path: join(screenshotDirectory, `${label}-${width}-after.png`) });
        const violations = afterMetrics.length
          ? (await new AxeBuilder({ page }).include('[role="alert"]').analyze()).violations.map(
              (violation) => violation.id,
            )
          : [];
        expect(violations).toEqual(beforeViolations ?? []);
        if (beforeMetrics) {
          expect(
            afterMetrics.map(({ height: _height, padding: _padding, ...rest }) => rest),
          ).toEqual(beforeMetrics.map(({ height: _height, padding: _padding, ...rest }) => rest));
          if (route === 'employees' && name === 'load')
            expect(beforeMetrics[0]!.padding).toBe('16px');
          else expect(afterMetrics).toEqual(beforeMetrics);
        }
        const afterTabs = await tabs(page);
        if (beforeTabs) expect(afterTabs).toEqual(beforeTabs);
        await writeFile(
          join(screenshotDirectory, `${label}-${width}-metrics.json`),
          JSON.stringify(
            {
              before: beforeMetrics,
              after: afterMetrics,
              beforeViolations,
              violations,
              beforeTabs,
              afterTabs,
            },
            null,
            2,
          ),
        );
      }
      // oxlint-enable no-await-in-loop
    });
  }
