// Build/preview only. The SVG is the sole authored icon; PNGs stay generated.
import {Resvg} from '@resvg/resvg-js';

export const iconSizes = Object.freeze({'favicon.png': 64, 'apple-touch-icon.png': 180});

export function renderIcon(svg, size) {
  const image = new Resvg(svg, {
    fitTo: {mode: 'width', value: size},
    font: {loadSystemFonts: false},
  }).render();
  if (image.width !== size || image.height !== size) throw new Error('favicon.svg must be square.');
  return image.asPng();
}
