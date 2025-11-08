import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateStrategySignal } from '../public/js/strategy-logic.js';

test('evaluateStrategySignal yields green for strong metrics', () => {
  const result = evaluateStrategySignal({
    confidence: 85,
    top3Mass: 45,
    gap1: 2.1,
    gap2: 0.5,
  });
  assert.equal(result.color, 'green');
  assert.equal(result.label, 'Go');
});

test('evaluateStrategySignal yields yellow for mixed metrics', () => {
  const result = evaluateStrategySignal({
    confidence: 70,
    top3Mass: 35,
    gap1: 1.0,
    gap2: 0.4,
  });
  assert.equal(result.color, 'yellow');
  assert.equal(result.label, 'Caution');
});

test('evaluateStrategySignal yields red when metrics weak', () => {
  const result = evaluateStrategySignal({
    confidence: 55,
    top3Mass: 25,
    gap1: 1.0,
    gap2: 0.5,
  });
  assert.equal(result.color, 'red');
  assert.equal(result.label, 'Avoid');
});

test('evaluateStrategySignal handles fractional inputs', () => {
  const result = evaluateStrategySignal({
    confidence: 0.84,
    top3Mass: 0.45,
    gap1: 0.02,
    gap2: 0.01,
  });
  assert.equal(result.color, 'green');
});

