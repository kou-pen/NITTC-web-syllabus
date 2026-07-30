import { load } from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, 'src/data/subjects.json');
const SCHOOL_ID = '23';
const SCHOOL_NAME = '豊田工業高等専門学校';
const ACADEMIC_YEAR = Math.max(2000, Number(process.env.SYLLABUS_YEAR) || 2026);
const ORIGIN = 'https://syllabus.kosen-k.go.jp';
const SOURCE_URL = `${ORIGIN}/Pages/PublicDepartments?school_id=${SCHOOL_ID}`;
const DEPARTMENTS = [
  { id: '11', name: '機械工学科' },
  { id: '12', name: '電気・電子システム工学科' },
  { id: '13', name: '情報工学科' },
  { id: '14', name: '環境都市工学科' },
  { id: '15', name: '建築学科' },
];
const CONCURRENCY = Math.max(1, Number(process.env.SCRAPE_CONCURRENCY) || 3);
const REQUEST_GAP_MS = Math.max(0, Number(process.env.SCRAPE_GAP_MS) || 300);
const USER_AGENT = 'KosenGradePlanner/1.0 (static educational grade calculator; low-frequency build-time fetch)';

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const clean = (value) => value.replace(/\s+/gu, ' ').trim();

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

async function parseSubject(entry) {
  const html = await fetchHtml(entry.url);
  const $ = load(html);
  const identity = subjectIdentity(entry.url);
  const categoryText = findField($, '科目区分');
  const creditsText = findField($, '単位の種別と単位数');
  const name = clean($('.mcc-title-bar h1').first().text()) || findField($, '授業科目') || entry.name;

  return {
    ...identity,
    departmentId: entry.departmentId,
    departmentName: entry.departmentName,
    name,
    url: entry.url,
    category: categoryText.split('/')[0]?.trim() || '',
    selection: categoryText.split('/')[1]?.trim() || '',
    enrollment: entry.enrollment,
    creditType: creditsText.split(':')[0]?.trim() || '',
    credits: parseNumber(creditsText),
    teachers: findField($, '担当教員'),
    yearLevel: parseNumber(findField($, '対象学年')),
    term: findField($, '開設期'),
    weeklyHours: parseNumber(findField($, '週時間数')),
    evaluation: parseEvaluation($),
  };
}

async function runPool(entries) {
  const results = new Array(entries.length);
  let cursor = 0;
  let failures = 0;

  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await parseSubject(entries[index]);
        process.stdout.write(`\r取得中 ${results.filter(Boolean).length + failures}/${entries.length}（失敗 ${failures}）`);
      } catch (error) {
        failures += 1;
        console.error(`\n取得失敗: ${entries[index].url}\n${error.message}`);
      }
      await sleep(REQUEST_GAP_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  process.stdout.write('\n');
  return { results: results.filter(Boolean), failures };
}

async function main() {
  console.log(`${SCHOOL_NAME}の本科5学科を取得します。`);
  const seen = new Set();
  const entries = [];

  for (const department of DEPARTMENTS) {
    const url = `${ORIGIN}/Pages/PublicSubjects?school_id=${SCHOOL_ID}&department_id=${department.id}&year=${ACADEMIC_YEAR}&lang=ja`;
    console.log(`一覧を取得: ${department.name}`);
    const listHtml = await fetchHtml(url);
    const $ = load(listHtml);
    let departmentCount = 0;
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
        departmentId: department.id,
        departmentName: department.name,
      });
      departmentCount += 1;
    });
    if (!departmentCount) throw new Error(`${department.name}の科目リンクが見つかりません。対象サイトのHTML構造を確認してください。`);
    console.log(`${department.name}: ${departmentCount}科目`);
  }

  console.log(`${entries.length}科目を低速並列で取得します。`);
  const { results, failures } = await runPool(entries);
  if (results.length < entries.length * 0.9) {
    throw new Error(`取得成功が${results.length}/${entries.length}件のため、既存データを上書きしません。`);
  }

  const data = {
    sourceUrl: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    schoolName: SCHOOL_NAME,
    academicYear: ACADEMIC_YEAR,
    departments: DEPARTMENTS,
    subjects: results,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`保存完了: ${OUTPUT}`);
  console.log(`評価割合あり ${results.filter((item) => item.evaluation.length).length}件 / 失敗 ${failures}件`);
}

await main();
