import { expect, test, type Page } from '@playwright/test';
import { projectSnapshot } from './helpers/project';

async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(page.locator('.overview-page')).toBeVisible();
  await page.mouse.move(1, 1);
}
async function settle(page: Page) {
  await page.locator('.sidebar-slot').evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
}

test('desktop navigation animates both ways, accepts rapid reversals and preserves workspace and focus', async ({ page }) => {
  await create(page);
  const before = await projectSnapshot(page), sidebar = page.locator('.sidebar-slot'), toggle = page.locator('.brand-toggle');
  await page.locator('#project-name').evaluate(element => element.setAttribute('data-motion-identity', 'retained'));
  await toggle.click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(() => sidebar.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  const during = await sidebar.evaluate(element => element.getBoundingClientRect().width);
  expect(during).toBeGreaterThan(64); expect(during).toBeLessThan(208);
  await toggle.click(); await toggle.click(); await toggle.click(); await settle(page);
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  expect((await sidebar.boundingBox())!.width).toBe(208);
  await expect(toggle).toBeFocused();
  await expect(page.locator('#project-name')).toHaveAttribute('data-motion-identity', 'retained');
  expect(await projectSnapshot(page)).toBe(before);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await toggle.click();
  expect((await sidebar.boundingBox())!.width).toBe(64);
  expect(await sidebar.evaluate(element => element.getAnimations().length)).toBe(0);
});

test('phone drawer closes smoothly without moving the workspace and restores keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await create(page);
  const main = (await page.locator('.main-shell').boundingBox())!, before = await projectSnapshot(page);
  const toggle = page.locator('.brand-toggle'), sidebar = page.locator('.sidebar');
  await toggle.click(); await settle(page);
  await expect(page.getByRole('dialog', { name: '工程导航', exact: true })).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBe(280);
  await expect(page.locator('.main-shell')).toHaveAttribute('inert', '');
  await toggle.press('Escape');
  await expect.poll(() => sidebar.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  const during = (await sidebar.boundingBox())!.width;
  expect(during).toBeGreaterThan(64); expect(during).toBeLessThan(280);
  await settle(page);
  expect((await sidebar.boundingBox())!.width).toBe(64);
  await expect(toggle).toBeFocused();
  await expect(page.locator('.main-shell')).not.toHaveAttribute('inert', '');
  expect((await page.locator('.main-shell').boundingBox())!.width).toBe(main.width);
  expect(await projectSnapshot(page)).toBe(before);
  await toggle.click(); await settle(page);
  await page.locator('.nav-backdrop').click({ position: { x: 360, y: 200 } }); await settle(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('cards lift as a rigid surface once per entry, settle after exit, and respect touch and reduced motion', async ({ page }) => {
  await create(page);
  const card = page.locator('.stats .ant-card').first(), before = await card.boundingBox(), snapshot = await projectSnapshot(page);
  await card.hover();
  await expect.poll(() => card.evaluate(element => element.getAnimations().length)).toBeGreaterThan(0);
  await card.evaluate(element => {
    const animation = element.getAnimations()[0]; animation.pause(); animation.currentTime = 198;
  });
  expect(await card.evaluate(element => getComputedStyle(element).transform)).toContain('matrix3d');
  await page.mouse.move(1, 1);
  await card.evaluate(async element => {
    const animation = element.getAnimations()[0]; animation.play(); await animation.finished;
  });
  expect(await card.evaluate(element => getComputedStyle(element).transform)).toBe('none');
  expect(await card.boundingBox()).toEqual(before);
  await card.hover();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => card.evaluate(element => element.getAnimations().length)).toBe(0);
  await page.mouse.move(1, 1); await card.hover();
  expect(await card.evaluate(element => element.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.mouse.move(1, 1);
  await card.dispatchEvent('pointerover', { pointerType: 'touch' });
  expect(await card.evaluate(element => element.getAnimations().length)).toBe(0);
  expect(await projectSnapshot(page)).toBe(snapshot);
});
