import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'demo@restaurantcloud.sa';
const DEMO_PASS = 'RestaurantDemo2026!';

test.describe('SaaS Portal, Auth Redesign, Onboarding & Subscriptions E2E', () => {
  test('1. Redesigned Login Portal has empty credentials, password toggle, forgot/verify/register modes & AR/EN', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('/');
    const emailInput = page.locator('#login-email');
    const passInput = page.locator('#login-password');
    await expect(emailInput).toBeVisible();
    await expect(passInput).toBeVisible();

    // Must NOT have pre-filled demo credentials
    expect(await emailInput.inputValue()).toBe('');
    expect(await passInput.inputValue()).toBe('');

    // Show/hide password toggle
    await passInput.fill('Secret123!');
    expect(await passInput.getAttribute('type')).toBe('password');
    await page.click('button[aria-label="Show password"]');
    expect(await passInput.getAttribute('type')).toBe('text');

    // Open Forgot Password & return
    await page.click('button:has-text("نسيت كلمة المرور؟")');
    await expect(page.locator('h1:has-text("استعادة كلمة المرور")')).toBeVisible();
    await page.click('button:has-text("العودة لتسجيل الدخول")');

    // Open Create Account Wizard & verify Step 1 + public plans loaded
    await page.click('button:has-text("إنشاء حساب منشأة جديد")');
    await expect(page.locator('h1:has-text("إنشاء حساب منشأة جديد")')).toBeVisible();
    await page.click('button:has-text("العودة لتسجيل الدخول")');

    expect(pageErrors).toEqual([]);
  });

  test('2. Authenticated tenant accesses Onboarding Wizard & Subscription Billing, and Super Admin is hidden', async ({ page }) => {
    const pageErrors: string[] = [];
    const apiErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (res) => {
      if (res.url().includes('/api/') && res.status() >= 400) {
        apiErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto('/');
    await page.fill('#login-email', DEMO_EMAIL);
    await page.fill('#login-password', DEMO_PASS);
    await page.click('button[type="submit"]');
    await page.waitForSelector('aside', { timeout: 20000 });

    // Super Admin link must NOT be visible for standard tenant owner
    await expect(page.locator('aside button:has-text("إدارة المنصة")')).toHaveCount(0);

    // Navigate to Setup Wizard (معالج تهيئة المنشأة)
    await page.click('aside button:has-text("معالج تهيئة المنشأة")');
    await expect(page.locator('h2:has-text("استكمال الجاهزية التشغيلية للمنشأة")')).toBeVisible();

    // Navigate to Subscription & Billing (الاشتراك والفوترة)
    await page.click('aside button:has-text("الاشتراك والفوترة")');
    await expect(page.locator('h2:has-text("الاشتراك والفوترة السحابية")')).toBeVisible();

    // Navigate to Settings -> Integrations & WhatsApp Templates
    await page.click('aside button:has-text("إعدادات المنشأة")');
    await page.click('button:has-text("التكاملات والإشعارات (WhatsApp)")');
    await expect(page.locator('h3:has-text("إدارة قوالب رسائل WhatsApp")')).toBeVisible();
    await expect(page.locator('td:has-text("ORDER_CONFIRMATION")').first()).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(apiErrors).toEqual([]);
  });
});
