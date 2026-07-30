import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('./data/catalog.json', import.meta.url), 'utf8'));
const departmentDirectory = new URL('../public/data/departments/', import.meta.url);
const departmentFiles = await readdir(departmentDirectory);

test('catalog contains only the five Toyota Kosen departments', () => {
  assert.equal(catalog.schools.length, 1);
  assert.equal(catalog.schools[0].id, '23');
  assert.deepEqual(catalog.schools[0].departments.map(({ id, name }) => ({ id, name })), [
    { id: '11', name: '機械工学科' },
    { id: '12', name: '電気・電子システム工学科' },
    { id: '13', name: '情報工学科' },
    { id: '14', name: '環境都市工学科' },
    { id: '15', name: '建築学科' },
  ]);
  assert.deepEqual(departmentFiles.sort(), ['23-11.json', '23-12.json', '23-13.json', '23-14.json', '23-15.json']);
});

test('every Toyota department chunk has complete unique course data', async () => {
  for (const department of catalog.schools[0].departments) {
    const data = JSON.parse(await readFile(new URL(department.file, departmentDirectory), 'utf8'));
    assert.equal(data.schoolId, '23');
    assert.equal(data.departmentId, department.id);
    assert.equal(data.subjects.length, department.subjectCount);
    assert.equal(new Set(data.subjects.map((subject) => subject.id)).size, data.subjects.length);
    for (const subject of data.subjects) {
      assert.match(subject.name, /\S/u);
      assert.match(subject.code, /^\d+$/u);
      const url = new URL(subject.url);
      assert.equal(url.hostname, 'syllabus.kosen-k.go.jp');
      assert.equal(url.searchParams.get('school_id'), '23');
      assert.equal(url.searchParams.get('department_id'), department.id);
      assert.ok(subject.evaluation.length > 0, `${subject.code} has no evaluation components`);
    }
  }
});

test('Toyota catalog preserves mixed syllabus years and course requirements', async () => {
  const subjects = [];
  for (const file of departmentFiles) {
    const data = JSON.parse(await readFile(new URL(file, departmentDirectory), 'utf8'));
    subjects.push(...data.subjects);
  }
  assert.deepEqual([...new Set(subjects.map((subject) => subject.syllabusYear))].sort(), [2022, 2023, 2024, 2025, 2026]);
  assert.ok(subjects.some((subject) => subject.selection === '必修'));
  assert.ok(subjects.some((subject) => subject.enrollment === '必履修'));
});
