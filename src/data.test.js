import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('./data/subjects.json', import.meta.url), 'utf8'));

test('scraped syllabus data contains all five Toyota Kosen departments only', () => {
  assert.equal(data.schoolId, '23');
  assert.deepEqual(data.departments, [
    { id: '11', name: '機械工学科' },
    { id: '12', name: '電気・電子システム工学科' },
    { id: '13', name: '情報工学科' },
    { id: '14', name: '環境都市工学科' },
    { id: '15', name: '建築学科' },
  ]);
  assert.ok(data.subjects.length > 500);
  assert.deepEqual([...new Set(data.subjects.map((subject) => subject.departmentId))].sort(), ['11', '12', '13', '14', '15']);
  for (const department of data.departments) {
    assert.ok(data.subjects.filter((subject) => subject.departmentId === department.id).length > 100);
  }
  assert.equal(new Set(data.subjects.map((subject) => subject.id)).size, data.subjects.length);
  assert.equal(new Set(data.subjects.map((subject) => subject.url)).size, data.subjects.length);
});

test('every course has usable identity and evaluation data', () => {
  let standardWeightTotals = 0;
  for (const subject of data.subjects) {
    assert.match(subject.name, /\S/u);
    assert.match(subject.code, /^\d+$/u);
    assert.equal(subject.departmentName, data.departments.find((department) => department.id === subject.departmentId)?.name);
    assert.equal(new URL(subject.url).hostname, 'syllabus.kosen-k.go.jp');
    assert.equal(new URL(subject.url).searchParams.get('school_id'), '23');
    assert.ok(subject.evaluation.length > 0, `${subject.code} has no evaluation components`);
    const total = subject.evaluation.reduce((sum, item) => sum + item.weight, 0);
    assert.ok(total > 0, `${subject.code} evaluation total is ${total}`);
    if (Math.abs(total - 100) < 1e-9) standardWeightTotals += 1;
  }
  assert.ok(standardWeightTotals >= data.subjects.length * 0.99, 'most official evaluation totals should be 100');
});

test('catalog preserves mixed syllabus years from the official list', () => {
  const years = [...new Set(data.subjects.map((subject) => subject.syllabusYear))].sort();
  assert.deepEqual(years, [2022, 2023, 2024, 2025, 2026]);
});

test('catalog includes course and enrollment requirements', () => {
  assert.ok(data.subjects.some((subject) => subject.selection === '必修'));
  assert.ok(data.subjects.some((subject) => subject.enrollment === '必履修'));
});
