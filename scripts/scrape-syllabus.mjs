import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_OUTPUT = resolve(ROOT, 'src/data/catalog.json');
const DEPARTMENT_OUTPUT = resolve(ROOT, 'public/data/departments');
const ORIGIN = 'https://syllabus.kosen-k.go.jp';
const SCHOOL = { id: '23', name: '豊田工業高等専門学校' };
const ACADEMIC_YEAR = Math.max(2000, Number(process.env.SYLLABUS_YEAR) || 2026);
const CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY) || 4);
const REQUEST_GAP_MS = Math.max(0, Number(process.env.SCRAPE_GAP_MS) || 300);
const USER_AGENT = 'KosenGradePlanner/2.0 (static educational grade calculator; low-frequency build-time fetch)';

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const clean = (value) => value.replace(/\s+/gu, ' ').trim();
const isUndergraduateDepartmentName = (value) => (
  Boolean(value)
  && !/(専攻|一般|教養|共通|留学生|特別学修|語学研修|人文|数理|学際領域|課題研究|特別活動|JABEE|プログラム)/u.test(value)
);

async function fetchHtml(url, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === retries) throw new Error(`HTTP ${response.status}: ${url}`);
        await sleep(1000 * (2 ** attempt));
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(1000 * (2 ** attempt));
    }
  }
  throw lastError;
}

function findField($, label) {
  let result = '';
  $('tr').each((_, row) => {
    if (result) return;
    const cells = $(row).children('th, td').toArray();
    const index = cells.findIndex((cell) => clean($(cell).text()) === label);
    if (index >= 0 && cells[index + 1]) result = clean($(cells[index + 1]).text());
  });
  return result;
}

function parseEvaluation($) {
  const table = $('#MainContent_SubjectSyllabus_wariaiTable');
  if (!table.length) return [];
  const rows = table.find('tr').toArray();
  const headerRow = rows.find((row) => $(row).find('th').length > 0);
  const overallRow = rows.find((row) => clean($(row).children('th,td').first().text()) === '総合評価割合');
  if (!headerRow || !overallRow) return [];
  const headers = $(headerRow).children('th,td').toArray().map((cell) => clean($(cell).text()));
  const values = $(overallRow).children('th,td').toArray().map((cell) => clean($(cell).text()));
  return headers.slice(1).map((name, index) => ({ name, weight: Number(values[index + 1]) }))
    .filter((item) => item.name && item.name !== '合計' && Number.isFinite(item.weight));
}

function parseNumber(value) {
  const match = value.match(/\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : null;
}

function subjectIdentity(url) {
  const parsed = new URL(url);
  const school = parsed.searchParams.get('school_id') ?? '';
  const department = parsed.searchParams.get('department_id') ?? '';
  const code = parsed.searchParams.get('subject_code') ?? '';
  const year = parsed.searchParams.get('year') ?? '';
  return { id: `${school}-${department}-${code}-${year}`, code, syllabusYear: Number(year) || null };
}

async function fetchSubjectTemplate(entry) {
  const html = await fetchHtml(entry.url);
  const $ = load(html);
  const categoryText = findField($, '科目区分');
  const creditsText = findField($, '単位の種別と単位数');
  return {
    name: clean($('.mcc-title-bar h1').first().text()) || findField($, '授業科目') || entry.name,
    category: categoryText.split('/')[0]?.trim() || '',
    selection: categoryText.split('/')[1]?.trim() || '',
    creditType: creditsText.split(':')[0]?.trim() || '',
    credits: parseNumber(creditsText),
    teachers: findField($, '担当教員'),
    yearLevel: parseNumber(findField($, '対象学年')),
    term: findField($, '開設期'),
    weeklyHours: parseNumber(findField($, '週時間数')),
    evaluation: parseEvaluation($),
  };
}

function materializeSubject(entry, template) {
  return {
    ...subjectIdentity(entry.url),
    schoolId: entry.schoolId,
    schoolName: entry.schoolName,
    departmentId: entry.departmentId,
    departmentName: entry.departmentName,
    ...template,
    url: entry.url,
    enrollment: entry.enrollment,
  };
}

async function runPool(groups, schoolName) {
  const results = new Array(groups.length);
  let cursor = 0;
  let failures = 0;
  let completed = 0;
  async function worker() {
    while (cursor < groups.length) {
      const index = cursor;
      cursor += 1;
      try {
        const template = await fetchSubjectTemplate(groups[index][0]);
        results[index] = groups[index].map((entry) => materializeSubject(entry, template));
      } catch (error) {
        failures += 1;
        console.error(`\n取得失敗: ${groups[index][0].url}\n${error.message}`);
      }
      completed += 1;
      if (completed % 10 === 0 || completed === groups.length) {
        process.stdout.write(`\r${schoolName}: ${completed}/${groups.length}（失敗 ${failures}）`);
      }
      await sleep(REQUEST_GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker));
  process.stdout.write('\n');
  return { subjects: results.filter(Boolean).flat(), failures };
}

async function discoverDepartments(school) {
  const url = `${ORIGIN}/Pages/PublicDepartments?school_id=${school.id}&year=${ACADEMIC_YEAR}&lang=ja`;
  const $ = load(await fetchHtml(url));
  const departments = [];
  const seen = new Set();
  $('a[href*="/Pages/PublicSubjects"]').each((_, link) => {
    const target = new URL($(link).attr('href'), ORIGIN);
    const id = target.searchParams.get('department_id') ?? '';
    const container = $(link).closest('.row');
    const name = clean(container.find('h4').first().text());
    if (!isUndergraduateDepartmentName(name) || seen.has(id)) return;
    seen.add(id);
    departments.push({ id, name, file: `${school.id}-${id}.json` });
  });
  if (!departments.length) throw new Error(`${school.name}の本科の学科が見つかりません。`);
  return { ...school, departments };
}

async function listDepartmentEntries(school, department) {
  const url = `${ORIGIN}/Pages/PublicSubjects?school_id=${school.id}&department_id=${department.id}&year=${ACADEMIC_YEAR}&lang=ja`;
  const $ = load(await fetchHtml(url));
  const entries = [];
  const seen = new Set();
  $('a.mcc-show[href*="/Pages/PublicSyllabus"], .subject-item a[href*="/Pages/PublicSyllabus"]').each((_, link) => {
    const href = $(link).attr('href');
    if (!href) return;
    const subjectUrl = new URL(href, ORIGIN).href;
    if (seen.has(subjectUrl)) return;
    seen.add(subjectUrl);
    const cells = $(link).closest('tr').children('th,td');
    entries.push({
      name: clean($(link).text()),
      url: subjectUrl,
      enrollment: clean(cells.last().text()),
      schoolId: school.id,
      schoolName: school.name,
      departmentId: department.id,
      departmentName: department.name,
    });
  });
  return entries;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function scrapeSchool(school) {
  const entriesByDepartment = new Map();
  const allEntries = [];
  for (const department of school.departments) {
    const entries = await listDepartmentEntries(school, department);
    if (!entries.length) {
      console.log(`${school.name} ${department.name}: 開講科目0件のため除外`);
      continue;
    }
    entriesByDepartment.set(department.id, entries);
    allEntries.push(...entries);
    console.log(`${school.name} ${department.name}: ${entries.length}科目`);
    await sleep(REQUEST_GAP_MS);
  }
  school.departments = school.departments.filter((department) => entriesByDepartment.has(department.id));
  if (!school.departments.length) throw new Error(`${school.name}に開講中の本科系学科がありません。`);

  const grouped = new Map();
  allEntries.forEach((entry) => {
    const identity = subjectIdentity(entry.url);
    const key = `${entry.schoolId}:${identity.code}:${identity.syllabusYear}:${entry.name}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });
  const groups = [...grouped.values()];
  console.log(`${school.name}: ${allEntries.length}掲載 / ${groups.length}ページを取得します。`);
  const { subjects, failures } = await runPool(groups, school.name);
  if (subjects.length < allEntries.length * 0.9) {
    throw new Error(`${school.name}の取得成功が${subjects.length}/${allEntries.length}件のため保存しません。`);
  }

  for (const department of school.departments) {
    const departmentSubjects = subjects.filter((subject) => subject.departmentId === department.id);
    if (departmentSubjects.length < (entriesByDepartment.get(department.id)?.length ?? 0) * 0.9) {
      throw new Error(`${school.name} ${department.name}の取得件数が不足しています。`);
    }
    const sourceUrl = `${ORIGIN}/Pages/PublicSubjects?school_id=${school.id}&department_id=${department.id}&year=${ACADEMIC_YEAR}&lang=ja`;
    await writeJson(resolve(DEPARTMENT_OUTPUT, department.file), {
      sourceUrl,
      scrapedAt: new Date().toISOString(),
      academicYear: ACADEMIC_YEAR,
      schoolId: school.id,
      schoolName: school.name,
      departmentId: department.id,
      departmentName: department.name,
      subjects: departmentSubjects,
    });
    department.subjectCount = departmentSubjects.length;
  }
  console.log(`${school.name}: 保存完了（失敗ページ ${failures}）`);
}

async function main() {
  console.log(`${SCHOOL.name}の本科5学科を取得します。`);
  const school = await discoverDepartments(SCHOOL);
  await scrapeSchool(school);

  await writeJson(CATALOG_OUTPUT, {
    sourceUrl: `${ORIGIN}/Pages/PublicDepartments?school_id=${SCHOOL.id}&year=${ACADEMIC_YEAR}&lang=ja`,
    scrapedAt: new Date().toISOString(),
    academicYear: ACADEMIC_YEAR,
    schools: [school],
  });
  console.log(`カタログ保存完了: ${CATALOG_OUTPUT}`);
}

await main();
