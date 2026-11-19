import { Resvg } from '@resvg/resvg-js';

export function renderIconPng(svg, size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('Icon size must be a positive integer.');

  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  });
  if (renderer.width !== renderer.height) throw new Error('The icon SVG must be square.');

  return renderer.render().asPng();
}
