import type { Locator } from '@playwright/test';

// Element screenshots round fractional CSS bounds outwards and can include an
// adjacent card-border row or overlay controls. Compare the actual rendered scene.
export async function renderedFrame(canvas: Locator) {
  const base64 = await canvas.evaluate(el => new Promise<string>((resolve, reject) => requestAnimationFrame(() => {
    const surface = el as HTMLCanvasElement, gl = surface.getContext('webgl2')!;
    const pixels = new Uint8Array(surface.width * surface.height * 4); gl.readPixels(0, 0, surface.width, surface.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let varied = false; for (let i = 4; i < pixels.length; i += 4) if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2]) { varied = true; break; }
    if (!varied) { reject(Error('Expected a rendered model/grid frame, not an empty capture')); return; }
    resolve(surface.toDataURL('image/png').split(',')[1]);
  })));
  return Buffer.from(base64, 'base64');
}
