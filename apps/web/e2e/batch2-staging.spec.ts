import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR =
  'C:/Users/MALEEM/.gemini/antigravity/brain/97e503d6-3c4a-4639-b75a-36034920e25b/scratch/screenshots';

const DEMO_EMAIL = 'demo@restaurantcloud.sa';
const DEMO_PASS = 'RestaurantDemo2026!';

interface NetworkIssue {
  url: string;
  status: number;
  method: string;
}

function attachListeners(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const apiErrors: NetworkIssue[] = [];
  const doublePrefix404s: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });

  page.on('response', (res) => {
    const url = res.url();
    const status = res.status();
    if (url.includes('/api/v1/api/v1')) {
      doublePrefix404s.push(`${res.request().method()} ${url} -> ${status}`);
    }
    if (url.includes('/api/') && status >= 400) {
      apiErrors.push({
        url,
        status,
        method: res.request().method(),
      });
    }
  });

  return { consoleErrors, pageErrors, apiErrors, doublePrefix404s };
}

async function login(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('#login-email')).toBeVisible();
  await page.locator('#login-email').fill(DEMO_EMAIL);
  await page.locator('#login-password').fill(DEMO_PASS);
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('aside nav')).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function ensureLoggedIn(page: Page) {
  const sidebarVisible = await page.locator('aside nav').isVisible().catch(() => false);
  if (!sidebarVisible) {
    await page.goto('/', { waitUntil: 'networkidle' });
    const needLogin = await page.locator('#login-email').isVisible().catch(() => false);
    if (needLogin) {
      await login(page);
    } else {
      await expect(page.locator('aside nav')).toBeVisible({ timeout: 20_000 });
    }
  }
}

async function waitForSpinnersToSettle(page: Page, timeoutMs = 10_000) {
  const spinnerText = page.locator('text=/جاري (تحميل|تحديث)/');
  await spinnerText
    .first()
    .waitFor({ state: 'hidden', timeout: timeoutMs })
    .catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function snap(page: Page, filename: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    fullPage: false,
  });
}

test.describe('Batch 2 Staging E2E & Product Quality', () => {
  test('1. Login, RTL check, major module navigation, and screenshots', async ({ page }) => {
    const issues = attachListeners(page);

    await login(page);

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');

    const desktopOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth);

    await snap(page, '01-dashboard-rtl.png');

    const modules: Array<{ label: string; file: string; subTab?: string }> = [
      { label: 'نقاط البيع POS', file: '02-pos.png' },
      { label: 'إدارة الصالة والطاولات', file: '03-dining.png' },
      { label: 'المشتريات وسلاسل الإمداد', file: '04-purchasing-pr.png', subTab: 'طلبات الشراء' },
      { label: 'أرصدة المخزون والتكلفة', file: '05-inventory.png' },
      { label: 'التوصيل والسائقون', file: '06-delivery.png' },
      {
        label: 'المحاسبة ودفتر الأستاذ',
        file: '07-accounting-coa.png',
        subTab: 'دليل الحسابات الشجري (COA)',
      },
      {
        label: 'المحاسبة ودفتر الأستاذ',
        file: '08-accounting-settlements.png',
        subTab: 'تسويات الدفع والتوصيل',
      },
      { label: 'الفوترة الإلكترونية ZATCA', file: '09-zatca-v2.png' },
      { label: 'إقفال الفترات المالية', file: '10-period-closing.png' },
      { label: 'المصالحات والتقارير المالية', file: '11-reports.png' },
    ];

    const moduleResults: Array<{
      module: string;
      status: 'PASS' | 'FAIL';
      pageErrors: string[];
      apiErrors: NetworkIssue[];
      blankScreen: boolean;
    }> = [];

    for (const mod of modules) {
      await ensureLoggedIn(page);
      const prevPageErrLen = issues.pageErrors.length;
      const prevApiErrLen = issues.apiErrors.length;

      const btn = page.locator('aside nav button', { hasText: mod.label }).first();
      await expect(btn).toBeVisible();
      await btn.click();
      await page.waitForTimeout(400);
      await waitForSpinnersToSettle(page, 10_000);

      if (mod.subTab) {
        const subBtn = page.locator('button', { hasText: mod.subTab }).first();
        if (await subBtn.isVisible().catch(() => false)) {
          await subBtn.click();
          await page.waitForTimeout(400);
          await waitForSpinnersToSettle(page, 10_000);
        }
      }

      const bodyTextLen = await page.evaluate(
        () => (document.body?.innerText || '').trim().length
      );
      const blankScreen = bodyTextLen === 0;
      const newPageErrors = issues.pageErrors.slice(prevPageErrLen);
      const newApiErrors = issues.apiErrors.slice(prevApiErrLen);

      await snap(page, mod.file);

      const status =
        blankScreen || newPageErrors.length > 0 || newApiErrors.length > 0 ? 'FAIL' : 'PASS';
      moduleResults.push({
        module: mod.subTab ? `${mod.label} -> ${mod.subTab}` : mod.label,
        status,
        pageErrors: newPageErrors,
        apiErrors: newApiErrors,
        blankScreen,
      });

      if (blankScreen || newPageErrors.length > 0) {
        // Recover from React crash before next module
        await page.goto('/', { waitUntil: 'networkidle' }).catch(() => {});
      }
    }

    console.log('MODULE_RESULTS:', JSON.stringify(moduleResults, null, 2));
    console.log('DOUBLE_PREFIX_404S:', JSON.stringify(issues.doublePrefix404s));
    console.log('ALL_API_ERRORS:', JSON.stringify(issues.apiErrors));
    console.log('ALL_CONSOLE_ERRORS:', JSON.stringify(issues.consoleErrors));
    console.log('ALL_PAGE_ERRORS:', JSON.stringify(issues.pageErrors));

    expect(issues.doublePrefix404s).toEqual([]);
  });

  test('2. POS sale flow, Receipt modal, and Offline POS drawer', async ({ page }) => {
    const issues = attachListeners(page);
    await login(page);

    const posNav = page.locator('aside nav button', { hasText: 'نقاط البيع POS' }).first();
    await posNav.click();
    await waitForSpinnersToSettle(page, 15_000);

    // 1. Offline POS drawer open & close
    const offlineBtn = page.locator('button[title="إدارة صف الفواتير المحلي (Offline POS)"]');
    await expect(offlineBtn).toBeVisible();
    await offlineBtn.click();
    await page.waitForTimeout(500);
    await snap(page, '12-pos-offline-drawer.png');

    const closeDrawerBtn = page.locator('button[aria-label="إغلاق"]').first();
    await expect(closeDrawerBtn).toBeVisible();
    await closeDrawerBtn.click();
    await expect(closeDrawerBtn).toBeHidden();

    // 2. POS sale flow -> add first product -> checkout -> CASH -> Receipt modal
    const productButtons = page
      .locator('button')
      .filter({ hasText: 'ر.س' })
      .filter({ hasNotText: 'دفع وتحصيل الطلب' });
    const count = await productButtons.count();
    console.log('POS_PRODUCT_BUTTONS_COUNT:', count);

    expect(count).toBeGreaterThan(0);
    await productButtons.first().click();

    const checkoutBtn = page.locator('button', { hasText: 'دفع وتحصيل الطلب' });
    await expect(checkoutBtn).toBeEnabled();
    await checkoutBtn.click();

    const cashBtn = page.locator('button', { hasText: 'نقدي (Cash)' });
    await expect(cashBtn).toBeVisible();
    await cashBtn.click();

    // Wait for receipt modal or payment completion
    await page.waitForTimeout(3000);
    await snap(page, '13-pos-receipt-modal.png');

    console.log('POS_DOUBLE_PREFIX_404S:', JSON.stringify(issues.doublePrefix404s));
    console.log('POS_API_ERRORS:', JSON.stringify(issues.apiErrors));
    console.log('POS_CONSOLE_ERRORS:', JSON.stringify(issues.consoleErrors));
    console.log('POS_PAGE_ERRORS:', JSON.stringify(issues.pageErrors));

    expect(issues.doublePrefix404s).toEqual([]);
    expect(issues.pageErrors).toEqual([]);
  });

  test('3. Responsive viewport (390x844 mobile RTL) overflow check', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const dashOverflow = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log('MOBILE_DASHBOARD_OVERFLOW:', JSON.stringify(dashOverflow));
    await snap(page, '14-mobile-390-dashboard.png');

    const menuBtn = page.locator('header button').first();
    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await page.waitForTimeout(300);
    }
    const posBtn = page.locator('aside nav button', { hasText: 'نقاط البيع POS' }).first();
    await posBtn.click({ force: true });
    await waitForSpinnersToSettle(page, 10_000);

    const posOverflow = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log('MOBILE_POS_OVERFLOW:', JSON.stringify(posOverflow));
    await snap(page, '15-mobile-390-pos.png');

    expect(dashOverflow.dir).toBe('rtl');
    expect(dashOverflow.scrollWidth).toBeLessThanOrEqual(dashOverflow.clientWidth);
    expect(posOverflow.scrollWidth).toBeLessThanOrEqual(posOverflow.clientWidth);
  });
});
