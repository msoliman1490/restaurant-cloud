import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'demo@restaurantcloud.sa';
const DEMO_PASS = 'RestaurantDemo2026!';

test.describe('Restaurant Cloud — Complete UI/UX Redesign Acceptance', () => {
  test('1. Command Palette (Ctrl+K), Shortcuts (?), RTL/LTR toggle, POS keyboard shortcuts & Saudi National Address', async ({ page }) => {
    const pageErrors: string[] = [];
    const apiErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (res) => {
      if (res.url().includes('/api/') && res.status() >= 400) {
        apiErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto('/');
    await page.fill('input[type="email"]', DEMO_EMAIL);
    await page.fill('input[type="password"]', DEMO_PASS);
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside', { timeout: 20000 });

    // Verify RTL default
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    // Toggle LTR (EN) and verify dir="ltr", then toggle back to RTL
    const langBtn = page.locator('header button:has-text("EN")');
    await langBtn.click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
    const arBtn = page.locator('header button:has-text("عربي")');
    await arBtn.click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    // Open Keyboard Shortcuts Modal with '?'
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // Open Command Palette with Control+k and navigate to Companies (entities)
    await page.keyboard.press('Control+k');
    const paletteInput = page.locator('[role="dialog"] input[type="text"]');
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill('العنوان الوطني');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    // Verify CompaniesView loaded & edit first legal entity to add Saudi National Address
    await expect(page.locator('h1:has-text("إدارة الشركات والفروع")')).toBeVisible();
    const editBtn = page.locator('button[title="تعديل"], button[title="Edit"]').first();
    await editBtn.click();
    await expect(page.locator('text=العنوان الوطني السعودي (Saudi National Address)')).toBeVisible();

    await page.fill('input[placeholder="300000000000003"]', '310998877000003');
    await page.fill('input[placeholder="1234"]', '4321');
    await page.fill('input[placeholder="12211"]', '12211');
    await page.fill('input[placeholder="5678"]', '8765');
    await page.fill('input[placeholder="RRRD2929"]', 'RRRD2929');
    await page.fill('input[placeholder="طريق الملك فهد"]', 'طريق الملك فهد');
    await page.fill('input[placeholder="العليا"]', 'العليا');
    await page.fill('input[placeholder="الرياض"]', 'الرياض');

    await page.click('button[type="submit"]:has-text("حفظ التعديلات")');
    await page.waitForTimeout(1000);
    await expect(page.locator('text=RRRD2929').first()).toBeVisible();

    // Navigate to POS via Command Palette and verify POS keyboard shortcuts (F2 search)
    await page.keyboard.press('Control+k');
    await page.locator('[role="dialog"] input[type="text"]').fill('POS');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);

    await page.keyboard.press('F2');
    const focusedPlaceholder = await page.evaluate(() => (document.activeElement as HTMLInputElement)?.placeholder || '');
    expect(focusedPlaceholder).toContain('F2');

    // Verify POS defaults to Eye-Comfort Light Theme and supports Dark Theme toggle
    const themeBtn = page.locator('button[aria-label="الوضع الداكن"]');
    await expect(themeBtn).toBeVisible();
    await themeBtn.click();
    await expect(page.locator('button[aria-label="الوضع الفاتح"]')).toBeVisible();
    await page.locator('button[aria-label="الوضع الفاتح"]').click();
    await expect(themeBtn).toBeVisible();

    // Test Held Orders (الطلبات المعلقة): add product -> Hold (F6) -> Open Held (F7) -> Resume
    await page.locator('div.grid button:has-text("ر.س")').first().click();
    await expect(page.locator('text=سلة الطلب (1)')).toBeVisible();
    await page.keyboard.press('F6');
    await expect(page.locator('text=سلة الطلب (0)')).toBeVisible();
    await page.keyboard.press('F7');
    await expect(page.locator('button:has-text("استئناف")').first()).toBeVisible();
    await page.locator('button:has-text("استئناف")').first().click();
    await expect(page.locator('text=سلة الطلب (1)')).toBeVisible();

    // Test Sidebar Collapse/Expand & Keyboard ArrowDown navigation
    const collapseBtn = page.locator('aside button[aria-label="تصغير القائمة الجانبية"]');
    await collapseBtn.click();
    await expect(page.locator('aside button[aria-label="توسيع القائمة الجانبية"]')).toBeVisible();
    await page.locator('aside button[aria-label="توسيع القائمة الجانبية"]').click();

    const firstNav = page.locator('aside button[data-nav-item="true"]').first();
    await firstNav.focus();
    await page.keyboard.press('ArrowDown');
    const focusedNavLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    expect(focusedNavLabel.length).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
    expect(apiErrors).toEqual([]);
  });
});
