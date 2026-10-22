import { expect, type Page } from '@playwright/test';

export async function assertBundledFonts(page: Page) {
  const faces = await page.evaluate(async () => {
    return Promise.all([400, 500, 600, 700].map(async weight => ({ weight, fonts: (await document.fonts.load(`${weight} 14px AlibabaPuHuiTi`, '中文 ROCOS 0123456789')).map(font => ({ family: font.family, weight: font.weight, status: font.status })) })));
  });
  for (const face of faces) expect(face.fonts).toEqual([{ family: 'AlibabaPuHuiTi', weight: String(face.weight), status: 'loaded' }]);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
