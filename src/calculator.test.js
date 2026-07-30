import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRequiredScore, isExamComponent, validateThresholds, weightedPoints } from './calculator.js';

test('weightedPoints converts raw component scores into overall points', () => {
  assert.equal(weightedPoints([{ weight: 35, score: 80, max: 100 }]), 28);
});

test('calculates and rounds required exam score up to the score step', () => {
  assert.deepEqual(calculateRequiredScore({ threshold: 80, earned: 28, examWeight: 65, examMax: 100, step: 1 }).required, 80);
  assert.equal(calculateRequiredScore({ threshold: 70, earned: 28, examWeight: 65, examMax: 100, step: 1 }).required, 65);
  assert.equal(calculateRequiredScore({ threshold: 60, earned: 28, examWeight: 65, examMax: 100, step: 1 }).required, 50);
});

test('reports secured and impossible targets', () => {
  assert.equal(calculateRequiredScore({ threshold: 80, earned: 82, examWeight: 18, examMax: 100, step: 1 }).status, 'secured');
  const impossible = calculateRequiredScore({ threshold: 80, earned: 10, examWeight: 50, examMax: 100, step: 1 });
  assert.equal(impossible.status, 'impossible');
  assert.equal(impossible.shortage, 20);
});

test('supports non-100-point exams and exact maximum', () => {
  assert.equal(calculateRequiredScore({ threshold: 80, earned: 50, examWeight: 40, examMax: 50, step: 1 }).required, 38);
  assert.equal(calculateRequiredScore({ threshold: 80, earned: 15, examWeight: 65, examMax: 100, step: 1 }).required, 100);
});

test('validates thresholds and recognizes exam labels', () => {
  assert.equal(validateThresholds([{ value: 80 }, { value: 80 }, { value: 60 }, { value: 0 }]), '評価基準は A > B > C > F の順にしてください。');
  assert.equal(isExamComponent('中間試験'), true);
  assert.equal(isExamComponent('課題'), false);
});
