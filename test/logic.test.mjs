import test from 'node:test';
import assert from 'node:assert/strict';
import { bcaConcentrationToCpr, buildBcaCurve, calculateActivity, emptyBcaConfig, fitLinear, normalizeReplicateCount, parsePastedPlate } from '../src/logic.js';
import { COMPLEXES } from '../src/logic.js';

test('Complex I follows the protocol example', () => {
  const result = calculateActivity({
    complexId: 'I',
    sample: { controlDelta: 0.164, sampleDelta: 0.011 },
    parameters: COMPLEXES.I.params,
    cpr: 3.75,
    dilution: 2,
  });
  assert.ok(Math.abs(result - 70.64935) < 0.001);
});

test('Complex II keeps the protocol dilution factor explicit', () => {
  const result = calculateActivity({
    complexId: 'II',
    sample: { sampleDelta: 0.361, blankDelta: 0.007 },
    parameters: COMPLEXES.II.params,
    cpr: 2.07,
    dilution: 1,
  });
  assert.ok(Math.abs(result - 27.456) < 0.01);
});

test('Complex IV follows the protocol example', () => {
  const result = calculateActivity({
    complexId: 'IV',
    sample: { sampleDelta: 0.156, blankDelta: 0.004 },
    parameters: COMPLEXES.IV.params,
    cpr: 3.54,
    dilution: 10,
  });
  assert.ok(Math.abs(result - 359.6888) < 0.01);
});

test('linear fit returns slope, intercept and R-squared', () => {
  const fit = fitLinear([{ x: 0, y: 0.1 }, { x: 1, y: 0.3 }, { x: 2, y: 0.5 }]);
  assert.equal(Number(fit.slope.toFixed(6)), 0.2);
  assert.equal(Number(fit.intercept.toFixed(6)), 0.1);
  assert.equal(Number(fit.r2.toFixed(6)), 1);
});

test('pasted tabular data uses the same plate parser', () => {
  const header = ['', '', ...Array.from({ length: 12 }, (_, index) => index + 1)].join('\t');
  const rows = [header];
  for (const row of 'ABCDEFGH') {
    rows.push(['', row, ...Array.from({ length: 12 }, () => 0.2)].join('\t'));
    rows.push(['', '', ...Array.from({ length: 12 }, () => 0.1)].join('\t'));
  }
  const plate = parsePastedPlate(rows.join('\n'));
  assert.equal(plate.rows.A[1].read1, 0.2);
  assert.equal(plate.rows.H[12].read2, 0.1);
});

test('BCA curve uses configured wells and averages replicates', () => {
  const header = ['', '', ...Array.from({ length: 12 }, (_, index) => index + 1)].join('\t');
  const rows = [header];
  for (const row of 'ABCDEFGH') {
    rows.push(['', row, ...Array.from({ length: 12 }, () => 0.2)].join('\t'));
    rows.push(['', '', ...Array.from({ length: 12 }, () => 0.1)].join('\t'));
  }
  const plate = parsePastedPlate(rows.join('\n'));
  const curve = buildBcaCurve(plate, [
    { id: 'std-1', name: '0', concentration: 0, replicateCount: 2, wells: ['A1', 'A2'] },
    { id: 'std-2', name: '1', concentration: 1, replicateCount: 2, wells: ['B1', 'B2'] },
  ]);
  assert.deepEqual(curve.standardPoints.map((point) => point.od), [0.2, 0.2]);
  assert.equal(curve.regression.slope, 0);
  assert.equal(normalizeReplicateCount(2.9), 2);
  assert.equal(normalizeReplicateCount(0), 1);
});

test('BCA defaults use micrograms per milliliter and convert to Cpr units', () => {
  assert.deepEqual(emptyBcaConfig().map((point) => point.concentration), [0, 125, 250, 500, 750, 1000, 1500, 2000]);
  assert.equal(bcaConcentrationToCpr(125), 0.125);
});
