import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('./data/subjects.json', import.meta.url), 'utf8'));

test('scraped syllabus data contains the complete unique course catalog', () => {
  assert.equal(data.subjects.length, 144);
  assert.equal(new Set(data.subjects.map((subject) => subject.id)).size, data.subjects.length);
  assert.equal(new Set(data.subjects.map((subject) => subject.url)).size, data.subjects.length);
});

test('every course has usable identity and evaluation data', () => {
  for (const subject of data.subjects) {
    assert.match(subject.name, /\S/u);
    assert.match(subject.code, /^\d+$/u);
    assert.equal(new URL(subject.url).hostname, 'syllabus.kosen-k.go.jp');
    assert.ok(subject.evaluation.length > 0, `${subject.code} has no evaluation components`);
    const total = subject.evaluation.reduce((sum, item) => sum + item.weight, 0);
    assert.ok(Math.abs(total - 100) < 1e-9, `${subject.code} evaluation total is ${total}`);
  }
});

test('catalog preserves mixed syllabus years from the official list', () => {
  const years = [...new Set(data.subjects.map((subject) => subject.syllabusYear))].sort();
  assert.deepEqual(years, [2022, 2023, 2024, 2025, 2026]);
});

test('catalog includes course and enrollment requirements', () => {
  assert.ok(data.subjects.some((subject) => subject.selection === '必修'));
  assert.ok(data.subjects.some((subject) => subject.enrollment === '必履修'));
});
