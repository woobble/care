import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@playwright/test';
import type { Dialog, Locator, Page } from '@playwright/test';
import { Client } from 'pg';

export const reviewDirectory = process.env.CARE_UI_REVIEW_DIR
  ? resolve(process.env.CARE_UI_REVIEW_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../../../artifacts/ui-foundation-review');

export function dateInBerlin(): string {
  return dateInTimezone(new Date(), 'Europe/Berlin');
}

export function addDaysToDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayInBerlin(date: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
  }).format(new Date(`${date}T12:00:00Z`));
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const value = weekdays[weekday];
  if (!value) throw new Error(`Unexpected weekday ${weekday}`);
  return value;
}

export async function expectFocusTrap(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  const tabStops = dialog.locator(
    [
      'a[href]:not([tabindex="-1"]):visible',
      'button:not([disabled]):not([tabindex="-1"]):visible',
      'input:not([type="hidden"]):not([disabled]):visible',
      'select:not([disabled]):visible',
      'textarea:not([disabled]):visible',
      '[tabindex="0"]:visible',
    ].join(', '),
  );
  const count = await tabStops.count();
  expect(count, 'The modal needs at least two keyboard stops for a wrap test').toBeGreaterThan(1);
  const first = tabStops.first();
  const last = tabStops.last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
}

export async function expectKeyboardTabSequence(page: Page): Promise<void> {
  // The Playwright server runs Next.js in development mode. Its portal owns a
  // browser toolbar that is not part of the production application workflow.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });

  const selector = [
    'a[href]',
    'area[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'iframe',
    'summary',
    '[contenteditable="true"]',
    '[tabindex]',
  ].join(', ');
  const getTabStops = () =>
    page.evaluate((focusableSelector) => {
      const isVisible = (element: Element) => {
        if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        if (element.matches(':disabled')) return false;
        const rect = element.getBoundingClientRect();
        let ancestor: Element | null = element;
        while (ancestor) {
          const style = getComputedStyle(ancestor);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
          ancestor = ancestor.parentElement;
        }
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth;
      };

      return Array.from(document.querySelectorAll(focusableSelector))
        .filter((element) => element instanceof HTMLElement && element.tabIndex >= 0)
        .filter(isVisible).length;
    }, selector);

  const tabStopCount = await getTabStops();
  expect(
    tabStopCount,
    'The workflow page should expose keyboard-operable controls',
  ).toBeGreaterThan(0);
  const originalScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const visited = new Set<number>();

  await page.evaluate(() => {
    const sentinel = document.createElement('button');
    sentinel.type = 'button';
    sentinel.id = 'care-keyboard-audit-sentinel';
    sentinel.setAttribute('aria-label', 'Keyboard audit start');
    Object.assign(sentinel.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.prepend(sentinel);
    sentinel.focus();
  });
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id === 'care-keyboard-audit-sentinel'))
    .toBe(true);
  const getFocusedStop = () =>
    page.evaluate((focusableSelector) => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const isVisible = (candidate: Element) => {
        if (candidate.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        if (candidate.matches(':disabled')) return false;
        const rect = candidate.getBoundingClientRect();
        let ancestor: Element | null = candidate;
        while (ancestor) {
          const ancestorStyle = getComputedStyle(ancestor);
          if (
            ancestorStyle.display === 'none' ||
            ancestorStyle.visibility === 'hidden' ||
            Number(ancestorStyle.opacity) === 0
          ) {
            return false;
          }
          ancestor = ancestor.parentElement;
        }
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth;
      };
      const tabStops = Array.from(document.querySelectorAll(focusableSelector)).filter(
        (candidate): candidate is HTMLElement =>
          candidate instanceof HTMLElement && candidate.tabIndex >= 0 && isVisible(candidate),
      );
      const style = getComputedStyle(element);
      const outlineColor = style.outlineColor;
      const outlineAlpha = outlineColor.match(/,\s*([\d.]+)\)$/)?.[1];
      const outlineVisible =
        style.outlineStyle !== 'none' &&
        Number.parseFloat(style.outlineWidth) > 0 &&
        outlineColor !== 'transparent' &&
        (outlineAlpha === undefined || Number(outlineAlpha) > 0);

      return {
        index: tabStops.indexOf(element),
        indicatorVisible: outlineVisible || style.boxShadow !== 'none',
        tag: element.localName,
        nativeInputFocus:
          element instanceof HTMLInputElement &&
          ['color', 'date', 'datetime-local', 'file', 'month', 'range', 'time', 'week'].includes(
            element.type,
          ) &&
          !element.matches(':focus'),
        role: element.getAttribute('role'),
        dataSlot: element.getAttribute('data-slot'),
      };
    }, selector);

  try {
    for (let step = 0; step < tabStopCount; step += 1) {
      // oxlint-disable-next-line no-await-in-loop -- Each Tab advances one real keyboard stop.
      await page.keyboard.press('Tab');
      if (step === 0) {
        // oxlint-disable-next-line no-await-in-loop -- Remove the temporary focus sentinel after the first Tab.
        await page.evaluate(() => {
          document.getElementById('care-keyboard-audit-sentinel')?.remove();
        });
      }
      // oxlint-disable-next-line no-await-in-loop -- Read focus after each keyboard movement.
      const focus = await getFocusedStop();

      expect(
        focus,
        `Tab stop ${step + 1} of ${tabStopCount} should stay in the page`,
      ).not.toBeNull();
      expect(
        focus?.index,
        `Tab stop ${step + 1} should map to a visible control: ${JSON.stringify(focus)}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        focus?.indicatorVisible || focus?.nativeInputFocus,
        `Tab stop ${step + 1} (${focus?.tag}[role=${focus?.role ?? 'none'}][data-slot=${focus?.dataSlot ?? 'none'}]) should have a visible focus indicator: ${JSON.stringify(focus)}`,
      ).toBe(true);
      if (focus) visited.add(focus.index);
    }

    expect(
      visited.size,
      'Keyboard traversal should reach more than one distinct visible control',
    ).toBeGreaterThan(1);
  } finally {
    await page.evaluate(({ x, y }) => {
      document.getElementById('care-keyboard-audit-sentinel')?.remove();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(x, y);
    }, originalScroll);
  }
}

export async function expectReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const offenders = await page.evaluate(() => {
    const durationMilliseconds = (value: string) => {
      const amount = Number.parseFloat(value);
      if (!Number.isFinite(amount)) return 0;
      return value.trim().endsWith('ms') ? amount : amount * 1000;
    };

    return Array.from(document.querySelectorAll('*'))
      .filter((element) => {
        const style = getComputedStyle(element);
        return [...style.transitionDuration.split(','), ...style.animationDuration.split(',')].some(
          (duration) => durationMilliseconds(duration) > 1,
        );
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.localName,
        role: element.getAttribute('role'),
        dataSlot: element.getAttribute('data-slot'),
      }));
  });

  expect(
    offenders,
    'Reduced-motion pages should not retain long transitions or animations',
  ).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

export async function expectMobileLayoutToFit(
  page: Page,
  accessibleScope?: Locator,
): Promise<void> {
  if (accessibleScope) {
    await expectAccessiblePageBasics(accessibleScope.page(), accessibleScope);
  } else {
    await expectAccessiblePageBasics(page);
  }
  const { documentWidth, visualWidth, overflowCandidates, shellAncestors } = await page.evaluate(
    () => {
      const width = window.visualViewport?.width ?? window.innerWidth;
      const shell = document.querySelector('main');
      const shellAncestorSummary = [];
      let current = shell;
      while (current && shellAncestorSummary.length < 6) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        shellAncestorSummary.push({
          tag: current.tagName,
          className: typeof current.className === 'string' ? current.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          minWidth: style.minWidth,
          flex: style.flex,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          boxSizing: style.boxSizing,
        });
        current = current.parentElement;
      }
      return {
        documentWidth: document.documentElement.scrollWidth,
        visualWidth: width,
        shellAncestors: shellAncestorSummary,
        overflowCandidates: Array.from(document.body.querySelectorAll('*'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const ancestors: Array<Record<string, number | string>> = [];
            let ancestor = element.parentElement;
            while (ancestor && ancestors.length < 5) {
              const ancestorRect = ancestor.getBoundingClientRect();
              const ancestorStyle = getComputedStyle(ancestor);
              ancestors.push({
                tag: ancestor.tagName,
                className: typeof ancestor.className === 'string' ? ancestor.className : '',
                left: Math.round(ancestorRect.left),
                right: Math.round(ancestorRect.right),
                width: Math.round(ancestorRect.width),
                scrollWidth: ancestor.scrollWidth,
                clientWidth: ancestor.clientWidth,
                overflowX: ancestorStyle.overflowX,
                minWidth: ancestorStyle.minWidth,
              });
              ancestor = ancestor.parentElement;
            }
            return {
              tag: element.tagName,
              id: element.id,
              className: typeof element.className === 'string' ? element.className : '',
              text: element.textContent?.trim().slice(0, 100) ?? '',
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              ancestors,
            };
          })
          .filter((element) => element.right > width + 1 || element.left < -1)
          .filter(
            (element) =>
              !element.ancestors.some(
                (ancestor) => ancestor.overflowX === 'auto' || ancestor.overflowX === 'scroll',
              ),
          )
          .sort((left, right) => right.right - left.right)
          .slice(0, 8),
      };
    },
  );
  expect(documentWidth, JSON.stringify({ overflowCandidates, shellAncestors })).toBeLessThanOrEqual(
    visualWidth,
  );
}

export async function expectTargetViewportLayouts(page: Page): Promise<void> {
  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error('A fixed viewport is required for layout review');

  try {
    // oxlint-disable no-await-in-loop -- Each viewport is a separate rendered-state check.
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expectMobileLayoutToFit(page);
    }
    // oxlint-enable no-await-in-loop
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

export async function selectEntity(
  page: Page,
  controlLabel: string,
  searchText: string,
  optionName: string | RegExp,
  root: Page | Locator = page,
): Promise<void> {
  const trigger = root.getByRole('combobox', { name: controlLabel });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const searchInput = page.getByRole('combobox', { name: 'Search by name' });
  const dialog = page.getByRole('dialog').filter({ has: searchInput });
  await expect(dialog).toBeVisible();
  await searchInput.fill(searchText);
  const targetOption = dialog.getByRole('option', { name: optionName });
  await expect(targetOption).toBeVisible({ timeout: 15_000 });
  const optionCount = await dialog.getByRole('option').count();
  const matchesOption = (text: string) =>
    typeof optionName === 'string' ? text.includes(optionName) : optionName.test(text);

  for (let index = 0; index < optionCount; index += 1) {
    const activeOption = dialog.locator('[role="option"][aria-selected="true"]').first();
    // The active option must be checked after each keyboard movement.
    // oxlint-disable-next-line no-await-in-loop
    const activeText = (await activeOption.textContent()) ?? '';
    if (matchesOption(activeText)) {
      // oxlint-disable-next-line no-await-in-loop
      await searchInput.press('Enter');
      // oxlint-disable-next-line no-await-in-loop
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement)) return 'other';
            if (active.dataset.slot === 'popover-trigger') return 'trigger';
            if (active.dataset.slot === 'command-input') return 'search';
            return 'other';
          }),
        )
        .toMatch(/^(trigger|search)$/);
      return;
    }
    // The active option must be checked after each keyboard movement.
    // oxlint-disable-next-line no-await-in-loop
    await searchInput.press('ArrowDown');
  }
  throw new Error(`Could not navigate to the ${String(optionName)} option`);
}

export async function submitServerAction(page: Page, submitButton: Locator): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'POST' && 'next-action' in request.headers();
  });
  await submitButton.click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await page.waitForLoadState('networkidle');
}

export async function retryCareToday(page: Page): Promise<void> {
  const refreshedPage = page.waitForResponse((response) => {
    const request = response.request();
    return (
      new URL(response.url()).pathname === '/care/today' &&
      request.method() === 'GET' &&
      request.headers()['rsc'] === '1'
    );
  });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  expect((await refreshedPage).status()).toBe(200);
}

export async function expectAccessiblePageBasics(page: Page, scope?: Locator): Promise<void> {
  const issues = await (scope ?? page.locator('body')).evaluate((root) => {
    const isVisible = (element: Element) => {
      if (element.closest('[hidden], [aria-hidden]:not([aria-hidden="false"]), [inert]')) {
        return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const text = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const hasName = (element: Element) => {
      const directName = text(
        element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.getAttribute('alt'),
      );
      if (directName) return true;

      const labelledBy = text(element.getAttribute('aria-labelledby'))
        .split(' ')
        .filter(Boolean)
        .map((id) => text(document.getElementById(id)?.textContent))
        .join(' ');
      if (labelledBy) return true;

      if (
        element instanceof HTMLInputElement &&
        ['button', 'image', 'reset', 'submit'].includes(element.type) &&
        text(element.value)
      ) {
        return true;
      }
      const labels = (element as HTMLButtonElement).labels;
      if (labels?.length) return true;
      const wrappingLabel = element.closest('label');
      if (wrappingLabel && text(wrappingLabel.textContent)) return true;
      if (text(element.textContent)) return true;

      return Boolean(
        element.querySelector(
          'img[alt]:not([alt=""]), [aria-label]:not([aria-label=""]), [aria-labelledby], svg title',
        ),
      );
    };
    const describeElement = (element: Element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      const usefulClasses = className.split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      const role = element.getAttribute('role');
      const dataSlot = element.getAttribute('data-slot');
      const ariaLabel = text(element.getAttribute('aria-label'));
      const labelledBy = text(element.getAttribute('aria-labelledby'));
      const title = text(element.getAttribute('title'));
      const textContent = text(element.textContent);
      return [
        element.localName,
        usefulClasses ? `.${usefulClasses}` : '',
        role ? `[role=${role}]` : '',
        dataSlot ? `[data-slot=${dataSlot}]` : '',
        `(aria-label=${ariaLabel ? 'set' : 'empty'}, aria-labelledby=${labelledBy ? 'set' : 'empty'}, title=${title ? 'set' : 'empty'}, text=${textContent ? 'yes' : 'no'})`,
      ].join('');
    };
    const interactiveSelector =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"]';
    const unnamedControls = Array.from(root.querySelectorAll(interactiveSelector))
      .filter((element) => isVisible(element) && !hasName(element))
      .map(describeElement);
    const unlabeledFields = Array.from(
      root.querySelectorAll('input:not([type="hidden"]), select, textarea'),
    )
      .filter((element) => {
        if (!isVisible(element)) return false;
        if (hasName(element)) return false;
        return true;
      })
      .map(describeElement);
    const missingImageAlt = Array.from(root.querySelectorAll('img'))
      .filter((element) => isVisible(element) && !element.hasAttribute('alt'))
      .map(describeElement);
    const hasMinimumTarget = (element: Element) => {
      const meetsMinimum = (target: Element) => {
        if (!isVisible(target)) return false;
        const rect = target.getBoundingClientRect();
        if (rect.width >= 24 && rect.height >= 24) return true;

        const hitArea = getComputedStyle(target, '::after');
        if (
          hitArea.position !== 'absolute' ||
          hitArea.pointerEvents === 'none' ||
          hitArea.content === 'none'
        ) {
          return false;
        }
        const insetExtension = (value: string) => Math.max(0, -Number.parseFloat(value) || 0);
        const width = rect.width + insetExtension(hitArea.left) + insetExtension(hitArea.right);
        const height = rect.height + insetExtension(hitArea.top) + insetExtension(hitArea.bottom);
        return width >= 24 && height >= 24;
      };
      if (meetsMinimum(element)) return true;
      const labels = (element as HTMLButtonElement).labels;
      return Array.from(labels ?? []).some(meetsMinimum);
    };
    const undersizedButtons = Array.from(root.querySelectorAll('button, [role="button"]'))
      .filter((element) => isVisible(element) && !hasMinimumTarget(element))
      .map(describeElement);
    const overflowElements = Array.from(document.body.querySelectorAll('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const ancestors = [];
        let parent = element.parentElement;
        while (parent && ancestors.length < 4) {
          const parentRect = parent.getBoundingClientRect();
          const parentStyle = getComputedStyle(parent);
          ancestors.push({
            tag: parent.localName,
            id: parent.id,
            className: typeof parent.className === 'string' ? parent.className : '',
            left: Math.round(parentRect.left),
            right: Math.round(parentRect.right),
            width: Math.round(parentRect.width),
            scrollWidth: parent.scrollWidth,
            clientWidth: parent.clientWidth,
            overflowX: parentStyle.overflowX,
          });
          parent = parent.parentElement;
        }
        return {
          tag: element.localName,
          id: element.id,
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflowX: style.overflowX,
          ancestors,
        };
      })
      .filter((element) => element.right > document.documentElement.clientWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 12);

    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowElements,
      unnamedControls,
      unlabeledFields,
      missingImageAlt,
      undersizedButtons,
    };
  });

  expect(
    issues.documentWidth,
    'Horizontal overflow at ' +
      issues.viewportWidth +
      'px viewport: ' +
      JSON.stringify(issues.overflowElements),
  ).toBeLessThanOrEqual(issues.viewportWidth + 1);
  expect(issues.unnamedControls, 'Visible interactive controls need accessible names').toEqual([]);
  expect(issues.unlabeledFields, 'Visible form fields need accessible names').toEqual([]);
  expect(issues.missingImageAlt, 'Visible images need an alt attribute').toEqual([]);
  expect(
    issues.undersizedButtons,
    'Visible button targets should be at least 24 CSS pixels',
  ).toEqual([]);
}

export async function captureReviewScreenshot(
  page: Page,
  filename: string,
  fullPage = false,
  scrollToTop = true,
): Promise<void> {
  await expectTargetViewportLayouts(page);
  if (scrollToTop) await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: resolve(reviewDirectory, filename), fullPage });
}

export async function captureReviewElementScreenshot(
  locator: Locator,
  filename: string,
): Promise<void> {
  await expectTargetViewportLayouts(locator.page());
  await locator.screenshot({ path: resolve(reviewDirectory, filename) });
}

export async function expectVisibleTextToOmitIds(
  page: Page,
  ids: Array<string | undefined>,
): Promise<void> {
  const visibleText = await page.evaluate(() => document.body.innerText);
  for (const id of ids) {
    if (id) expect(visibleText).not.toContain(id);
  }
}

export async function expectMembershipScopes(
  database: Client,
  membershipId: string,
  expected: Array<{ scopeType: string; scopeId: string }>,
): Promise<void> {
  await expect
    .poll(async () => {
      const result = await database.query<{ scopeType: string; scopeId: string }>(
        `SELECT scope_type AS "scopeType", scope_id AS "scopeId"
         FROM identity.membership_scopes
         WHERE membership_id = $1
         ORDER BY scope_type, scope_id`,
        [membershipId],
      );
      return result.rows;
    })
    .toEqual(expected);
}

export async function acceptDialogDuringAction(
  page: Page,
  action: () => Promise<unknown>,
  onDialog: (dialog: Dialog) => Promise<void> | void = (dialog) => dialog.accept(),
): Promise<void> {
  const dialogPromise = page.waitForEvent('dialog');
  const actionPromise = action();
  await onDialog(await dialogPromise);
  await actionPromise;
}

function dateInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
