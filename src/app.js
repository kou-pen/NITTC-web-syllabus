import catalog from './data/catalog.json';
import { DEFAULT_THRESHOLDS, calculateRequiredScore, parseScoreExpression, validateThresholds, weightedPoints } from './calculator.js';
import './styles.css';

const elements = {
  subjects: document.querySelector('#subjects'),
  search: document.querySelector('#search'),
  department: document.querySelector('#department-filter'),
  grade: document.querySelector('#grade-filter'),
  term: document.querySelector('#term-filter'),
  requirement: document.querySelector('#requirement-filter'),
  exam: document.querySelector('#exam-filter'),
  status: document.querySelector('#data-status'),
  empty: document.querySelector('#empty-state'),
  thresholds: document.querySelector('#global-thresholds'),
  thresholdError: document.querySelector('#threshold-error'),
  categorySort: document.querySelector('#category-sort'),
  officialSyllabus: document.querySelector('#official-syllabus'),
};

const SCORE_MAX = 100;
const SCORE_STEP = 1;
let activeRowUpdaters = [];
let subjects = [];
let loadSequence = 0;

function findPeriodicExam(subject) {
  const exact = subject.evaluation.find((item) => item.name === '定期試験');
  if (exact) return exact;
  return subject.evaluation.find((item) => /(定期|期末).*試験|試験$/u.test(item.name) && !/中間/u.test(item.name)) ?? null;
}

function hasExam(subject) {
  return Boolean(findPeriodicExam(subject));
}

function readThresholds() {
  return [...elements.thresholds.querySelectorAll('input')].map((input) => ({
    grade: input.dataset.grade,
    value: Number(input.value),
  }));
}

function restoreThresholds() {
  try {
    const stored = JSON.parse(localStorage.getItem('grade-planner:inline-thresholds'));
    if (!Array.isArray(stored) || validateThresholds(stored)) return;
    stored.forEach(({ grade, value }) => {
      const input = elements.thresholds.querySelector(`[data-grade="${grade}"]`);
      if (input) input.value = value;
    });
  } catch {
    // Defaults remain available when storage is unavailable or invalid.
  }
}

function scoreStorageKey(subject) {
  return `grade-planner:inline-scores:${subject.id}`;
}

function loadScores(subject) {
  try { return JSON.parse(localStorage.getItem(scoreStorageKey(subject))) ?? {}; } catch { return {}; }
}

function saveScores(subject, scores) {
  try { localStorage.setItem(scoreStorageKey(subject), JSON.stringify(scores)); } catch { /* optional */ }
}

function createSubjectRow(subject) {
  const row = document.createElement('div');
  row.className = 'course-row sheet-row';

  const identity = document.createElement('div');
  identity.className = 'course-identity';
  const code = document.createElement('span');
  code.className = 'course-code';
  code.textContent = subject.code;
  const title = document.createElement('h2');
  title.textContent = subject.name;
  const teacher = document.createElement('p');
  teacher.textContent = subject.teachers || '担当教員未掲載';
  const year = makeColumnFact('学年', subject.yearLevel ? `${subject.yearLevel}年` : '―', 'important-fact');
  const term = makeColumnFact('学期', subject.term || '―');
  const credits = makeColumnFact('単位', subject.credits ? `${subject.credits}単位` : '―', 'important-fact', subject.creditType);
  const category = document.createElement('div');
  category.className = 'course-category-column';
  category.dataset.columnLabel = '専門 / 一般';
  category.append(makeBadge(subject.category || '区分なし', 'neutral-badge'));
  const enrollment = document.createElement('div');
  enrollment.className = 'course-enrollment-column';
  enrollment.dataset.columnLabel = '履修区分';
  enrollment.append(makeBadge(subject.selection || '指定なし', subject.selection === '必修' ? 'required-badge' : 'elective-badge'));
  if (subject.enrollment) enrollment.append(makeBadge(subject.enrollment, 'must-badge'));

  const target = findPeriodicExam(subject);
  const evaluationTotal = subject.evaluation.reduce((sum, item) => sum + item.weight, 0);
  const knownComponents = target
    ? subject.evaluation.filter((item) => item !== target)
    : subject.evaluation;
  const storedScores = loadScores(subject);
  const scoreInputs = document.createElement('div');
  scoreInputs.className = 'inline-score-inputs';
  scoreInputs.dataset.sectionLabel = '① これまでの得点';

  knownComponents.forEach((component, index) => {
    const key = `${index}:${component.name}`;
    const label = document.createElement('label');
    label.className = 'inline-score-cell';
    const caption = document.createElement('span');
    caption.innerHTML = '<b></b><i></i><em></em>';
    caption.querySelector('b').textContent = component.name;
    caption.querySelector('i').textContent = `${component.weight}%`;
    caption.querySelector('em').textContent = '得点 / 満点';
    const saved = storedScores[key];
    const savedScore = typeof saved === 'object' && saved !== null ? saved.score : saved;
    const savedMax = typeof saved === 'object' && saved !== null ? saved.max : SCORE_MAX;
    const pair = document.createElement('div');
    pair.className = 'inline-score-pair';
    const scoreInput = document.createElement('input');
    scoreInput.className = 'inline-earned';
    scoreInput.type = 'text';
    scoreInput.inputMode = 'text';
    scoreInput.spellcheck = false;
    scoreInput.placeholder = '得点';
    scoreInput.value = savedScore ?? '';
    scoreInput.dataset.key = key;
    scoreInput.setAttribute('aria-label', `${subject.name} ${component.name}の得点`);
    const slash = document.createElement('span');
    slash.textContent = '/';
    const maxInput = document.createElement('input');
    maxInput.className = 'inline-max';
    maxInput.type = 'number';
    maxInput.min = '0.1';
    maxInput.step = '0.1';
    maxInput.inputMode = 'decimal';
    maxInput.placeholder = '満点';
    maxInput.value = savedMax ?? SCORE_MAX;
    maxInput.setAttribute('aria-label', `${subject.name} ${component.name}の満点`);
    pair.append(scoreInput, slash, maxInput);
    label.append(caption, pair);
    scoreInputs.append(label);
  });
  if (!knownComponents.length) {
    const none = document.createElement('span');
    none.className = 'no-score-input';
    none.textContent = '既得項目なし';
    scoreInputs.append(none);
  }

  const targetCell = document.createElement('div');
  targetCell.className = 'inline-target';
  targetCell.dataset.sectionLabel = '② 定期試験';
  if (target) {
    targetCell.innerHTML = '<strong></strong><b></b>';
    targetCell.querySelector('strong').textContent = target.name;
    targetCell.querySelector('b').textContent = `${target.weight}%`;
  } else {
    targetCell.classList.add('no-target');
    targetCell.textContent = '定期試験なし';
  }

  const results = document.createElement('div');
  results.className = 'inline-results';
  results.dataset.sectionLabel = '③ 必要点';

  const original = document.createElement('a');
  original.className = 'inline-original';
  original.href = subject.url;
  original.target = '_blank';
  original.rel = 'noreferrer';
  original.textContent = '公式 ↗';
  original.setAttribute('aria-label', `${subject.name}の公式シラバスを開く`);

  function updateRow() {
    const thresholds = readThresholds();
    if (validateThresholds(thresholds)) {
      results.innerHTML = '<span class="result-pending">基準エラー</span>';
      return;
    }
    if (Math.abs(evaluationTotal - 100) > 1e-9) {
      results.innerHTML = `<span class="result-pending">評価割合の合計が${formatNumber(evaluationTotal)}%です。公式を確認</span>`;
      return;
    }
    if (!target) {
      results.innerHTML = '<span class="result-no-exam">計算対象なし</span>';
      return;
    }

    const scoreCells = [...scoreInputs.querySelectorAll('.inline-score-cell')];
    const values = scoreCells.map((cell) => {
      const scoreInput = cell.querySelector('.inline-earned');
      const maxInput = cell.querySelector('.inline-max');
      return {
        scoreInput,
        maxInput,
        score: parseScoreExpression(scoreInput.value),
        max: Number(maxInput.value),
      };
    });
    values.forEach(({ scoreInput, maxInput, score, max }, index) => {
      const contribution = scoreInput.closest('.inline-score-cell').querySelector('em');
      contribution.textContent = scoreInput.value === '' || maxInput.value === '' || !Number.isFinite(score) || max <= 0
        ? '得点 / 満点'
        : `総合点へ +${formatNumber(knownComponents[index].weight * score / max)}点`;
    });
    const invalid = values.some(({ scoreInput, maxInput, score, max }) => (
      scoreInput.value !== '' && maxInput.value !== ''
      && (!Number.isFinite(score) || score < 0 || max <= 0 || score > max)
    ));
    values.forEach(({ scoreInput, maxInput, score, max }) => {
      const isInvalid = scoreInput.value !== '' && maxInput.value !== ''
        && (!Number.isFinite(score) || score < 0 || max <= 0 || score > max);
      scoreInput.classList.toggle('is-invalid', isInvalid);
      maxInput.classList.toggle('is-invalid', isInvalid);
    });
    if (invalid) {
      results.innerHTML = '<span class="result-pending">得点は0〜満点で入力</span>';
      return;
    }
    if (values.some(({ scoreInput, maxInput }) => scoreInput.value === '' || maxInput.value === '')) {
      results.innerHTML = '<span class="result-pending">左の得点 / 満点を入力すると表示</span>';
      return;
    }

    const earned = weightedPoints(knownComponents.map((component, index) => ({
      weight: component.weight,
      score: values[index].score,
      max: values[index].max,
    })));
    results.replaceChildren(...thresholds.slice(0, 3).map(({ grade, value }) => {
      const result = calculateRequiredScore({ threshold: value, earned, examWeight: target.weight, examMax: SCORE_MAX, step: SCORE_STEP });
      const item = document.createElement('span');
      item.className = `inline-result grade-${grade.toLowerCase()} status-${result.status}`;
      const displayed = result.status === 'reachable' ? `${formatNumber(result.required)}点` : result.status === 'secured' ? '0点' : '不可';
      item.innerHTML = '<b></b><strong></strong>';
      item.querySelector('b').textContent = grade;
      item.querySelector('strong').textContent = displayed;
      return item;
    }));
  }

  scoreInputs.addEventListener('input', () => {
    const scores = {};
    scoreInputs.querySelectorAll('.inline-score-cell').forEach((cell) => {
      const scoreInput = cell.querySelector('.inline-earned');
      const maxInput = cell.querySelector('.inline-max');
      if (scoreInput.value !== '' || maxInput.value !== String(SCORE_MAX)) {
        scores[scoreInput.dataset.key] = { score: scoreInput.value, max: maxInput.value };
      }
    });
    saveScores(subject, scores);
    updateRow();
  });

  identity.append(code, title, teacher, original);
  row.append(identity, year, term, credits, category, enrollment, scoreInputs, targetCell, results);
  updateRow();
  activeRowUpdaters.push(updateRow);
  return row;
}

function makeColumnFact(label, value, className = '', detail = '') {
  const element = document.createElement('div');
  element.className = `course-column-fact ${className}`.trim();
  element.dataset.columnLabel = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  element.append(strong);
  if (detail) {
    const small = document.createElement('small');
    small.textContent = detail;
    element.append(small);
  }
  return element;
}

function makeBadge(value, className) {
  const element = document.createElement('span');
  element.className = `course-badge ${className}`;
  element.textContent = value;
  return element;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value);
}

function render() {
  const query = elements.search.value.trim().toLocaleLowerCase('ja');
  const grade = elements.grade.querySelector('.is-active')?.dataset.grade ?? '';
  const term = elements.term.value;
  const requirement = elements.requirement.value;
  const examFilter = elements.exam.value;
  const filtered = subjects.filter((subject) => {
    const haystack = `${subject.name} ${subject.code} ${subject.teachers} ${subject.schoolName} ${subject.departmentName}`.toLocaleLowerCase('ja');
    if (query && !haystack.includes(query)) return false;
    if (grade && String(subject.yearLevel) !== grade) return false;
    if (term && subject.term !== term) return false;
    if (requirement === 'required' && subject.selection !== '必修') return false;
    if (requirement === 'must-take' && subject.enrollment !== '必履修') return false;
    if (requirement === 'elective' && subject.selection !== '選択') return false;
    if (examFilter === 'exam' && !hasExam(subject)) return false;
    if (examFilter === 'no-exam' && hasExam(subject)) return false;
    return true;
  });

  const categoryOrder = elements.categorySort.value;
  if (categoryOrder) {
    const ranks = categoryOrder === 'general-first'
      ? { '一般': 0, '専門': 1 }
      : { '専門': 0, '一般': 1 };
    filtered.sort((left, right) => (ranks[left.category] ?? 2) - (ranks[right.category] ?? 2));
  }

  activeRowUpdaters = [];
  elements.subjects.replaceChildren(...filtered.map(createSubjectRow));
  elements.empty.hidden = filtered.length > 0;
  elements.status.textContent = `${filtered.length} / ${subjects.length} 科目`;
}

function selectedSchool() {
  return catalog.schools[0] ?? null;
}

function selectedDepartment() {
  return selectedSchool()?.departments.find((department) => department.id === elements.department.value) ?? null;
}

function populateDepartments(preferredId = '') {
  const departments = selectedSchool()?.departments ?? [];
  elements.department.replaceChildren(...departments.map((department) => {
    const option = document.createElement('option');
    option.value = department.id;
    option.textContent = department.name;
    return option;
  }));
  if (departments.some((department) => department.id === preferredId)) elements.department.value = preferredId;
}

function populateTerms() {
  elements.term.querySelectorAll('option:not(:first-child)').forEach((option) => option.remove());
  const terms = [...new Set(subjects.map((subject) => subject.term).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  terms.forEach((term) => {
    const option = document.createElement('option');
    option.value = term;
    option.textContent = term;
    elements.term.append(option);
  });
  if (!terms.includes(elements.term.value)) elements.term.value = '';
}

async function loadDepartment() {
  const school = selectedSchool();
  const department = selectedDepartment();
  if (!school || !department) return;
  const sequence = ++loadSequence;
  subjects = [];
  activeRowUpdaters = [];
  elements.subjects.replaceChildren();
  elements.empty.hidden = true;
  elements.status.textContent = `${school.name} ${department.name}を読み込み中…`;
  elements.officialSyllabus.href = `https://syllabus.kosen-k.go.jp/Pages/PublicSubjects?school_id=${encodeURIComponent(school.id)}&department_id=${encodeURIComponent(department.id)}&year=${catalog.academicYear ?? 2026}&lang=ja`;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/departments/${department.file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (sequence !== loadSequence) return;
    subjects = Array.isArray(data.subjects) ? data.subjects : [];
    populateTerms();
    render();
  } catch {
    if (sequence !== loadSequence) return;
    elements.status.textContent = '科目データを読み込めませんでした';
    elements.empty.hidden = false;
    elements.empty.querySelector('h3').textContent = 'この学科のデータがまだありません';
    elements.empty.querySelector('p').textContent = 'シラバスの更新処理後にもう一度お試しください。';
  }
}

restoreThresholds();
let preferredDepartment = '13';
try {
  const savedGrade = localStorage.getItem('grade-planner:grade-filter');
  const savedButton = elements.grade.querySelector(`[data-grade="${savedGrade ?? ''}"]`);
  if (savedButton) {
    elements.grade.querySelector('.is-active')?.classList.remove('is-active');
    savedButton.classList.add('is-active');
  }
  const savedCategorySort = localStorage.getItem('grade-planner:category-sort');
  if ([...elements.categorySort.options].some((option) => option.value === savedCategorySort)) {
    elements.categorySort.value = savedCategorySort;
  }
  preferredDepartment = localStorage.getItem('grade-planner:department-filter') ?? '13';
} catch {
  // Filtering works without persistent storage.
}
populateDepartments(preferredDepartment);

elements.thresholds.addEventListener('input', () => {
  const thresholds = readThresholds();
  const error = validateThresholds(thresholds);
  elements.thresholdError.textContent = error;
  if (!error) {
    try { localStorage.setItem('grade-planner:inline-thresholds', JSON.stringify(thresholds)); } catch { /* optional */ }
  }
  activeRowUpdaters.forEach((update) => update());
});
[elements.search, elements.term, elements.requirement, elements.exam].forEach((element) => element.addEventListener('input', render));
elements.department.addEventListener('input', () => {
  try { localStorage.setItem('grade-planner:department-filter', elements.department.value); } catch { /* optional */ }
  loadDepartment();
});
elements.categorySort.addEventListener('input', () => {
  try { localStorage.setItem('grade-planner:category-sort', elements.categorySort.value); } catch { /* optional */ }
  render();
});
elements.grade.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-grade]');
  if (!button) return;
  elements.grade.querySelector('.is-active')?.classList.remove('is-active');
  button.classList.add('is-active');
  try { localStorage.setItem('grade-planner:grade-filter', button.dataset.grade); } catch { /* optional */ }
  render();
});

if (catalog.schools.length === 0) {
  elements.status.textContent = '学校データがありません';
  elements.empty.hidden = false;
  elements.empty.querySelector('h3').textContent = '先に学校データを取得してください';
  elements.empty.querySelector('p').textContent = 'npm run scrape を実行してください。';
} else {
  loadDepartment();
}
