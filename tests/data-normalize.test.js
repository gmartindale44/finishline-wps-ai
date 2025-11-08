import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSurface } from '../lib/data-normalize.js';

test('normalizeSurface maps aliases to All Weather', () => {
  const aliases = ['AW', 'tapeta', 'PolyTrack', 'all weather', 'Woodbine Tapeta'];
  aliases.forEach((alias) => {
    assert.equal(normalizeSurface(alias), 'All Weather');
  });
});

test('normalizeSurface keeps standard labels', () => {
  assert.equal(normalizeSurface('Dirt'), 'Dirt');
  assert.equal(normalizeSurface('Turf'), 'Turf');
});

test('normalizeSurface capitalizes unknown labels', () => {
  assert.equal(normalizeSurface('harness'), 'Harness');
});

