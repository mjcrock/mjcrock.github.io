import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {iconSizes, renderIcon} from '../scripts/icons.mjs';

const svg = readFileSync(new URL('../favicon.svg', import.meta.url));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test('one SVG deterministically produces valid PNG headers at both icon sizes', () => {
  assert.deepEqual(iconSizes, {'favicon.png': 64, 'apple-touch-icon.png': 180});
  for (const size of [64, 180]) {
    const png = renderIcon(svg, size);
    assert.deepEqual(png.subarray(0, 8), signature);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size]);
    assert.deepEqual(renderIcon(svg, size), png);
  }
});

test('invalid or non-square SVG artwork cannot silently produce a broken icon', () => {
  assert.throws(() => renderIcon('not SVG', 64));
  assert.throws(() => renderIcon('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"/>', 64), /must be square/);
});
