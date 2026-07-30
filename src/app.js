import syllabus from './data/subjects.json';
import { isExamComponent } from './calculator.js';
import './styles.css';

const elements = {
  subjects: document.querySelector('#subjects'),
  search: document.querySelector('#search'),
  grade: document.querySelector('#grade-filter'),
  term: document.querySelector('#term-filter'),
  requirement: document.querySelector('#requirement-filter'),
  exam: document.querySelector('#exam-filter'),
  status: document.querySelector('#data-status'),
  empty: document.querySelector('#empty-state'),
  source: document.querySelector('#source-link'),
  totalCount: document.querySelector('#total-count'),
  scrapeStatus: document.querySelector('#scrape-status'),
};

elements.source.href = syllabus.sourceUrl;

function hasExam(subject) {
  return subject.evaluation.some((item) => isExamComponent(item.name) && item.weight > 0);
}

function createSubjectCard(subject) {
  const card = document.createElement('a');
  card.className = 'course-row';
  card.href = `./subject.html?id=${encodeURIComponent(subject.id)}`;

  const identity = document.createElement('div');
  identity.className = 'course-identity';
  const code = document.createElement('span');
  code.className = 'course-code';
  code.textContent = subject.code;
  const title = document.createElement('h2');
  title.textContent = subject.name;
  const teacher = document.createElement('p');
  teacher.textContent = subject.teachers || '担当教員未掲載';
  identity.append(code, title, teacher);

  const year = makeFact('学年', subject.yearLevel ? `${subject.yearLevel}年` : '―', 'fact-strong');
  const term = makeFact('学期', subject.term || '―');
  const credits = makeFact('単位', subject.credits ? `${subject.credits}` : '―', 'fact-strong');
  if (subject.creditType) credits.append(makeSubtext(subject.creditType));

  const category = document.createElement('div');
  category.className = 'course-category-cell';
  category.append(makeBadge(subject.category || '区分なし', 'neutral-badge'));
  category.append(makeBadge(subject.selection || '指定なし', subject.selection === '必修' ? 'required-badge' : 'elective-badge'));

  const enrollment = document.createElement('div');
  enrollment.className = 'course-enrollment-cell';
  enrollment.append(makeBadge(subject.enrollment || '―', subject.enrollment === '必履修' ? 'must-badge' : 'plain-badge'));

  const evaluations = document.createElement('div');
  evaluations.className = 'evaluation-stack';
  subject.evaluation.slice(0, 3).forEach((item) => {
    const chip = document.createElement('span');
    chip.innerHTML = '<b></b><i></i>';
    chip.querySelector('b').textContent = item.name;
    chip.querySelector('i').textContent = `${item.weight}%`;
    evaluations.append(chip);
  });
  if (subject.evaluation.length > 3) {
    const more = document.createElement('small');
    more.textContent = `ほか${subject.evaluation.length - 3}項目`;
    evaluations.append(more);
  }

  const action = document.createElement('span');
  action.className = 'course-action';
  action.innerHTML = '<b>計算する</b><i>→</i>';
  card.append(identity, year, term, credits, category, enrollment, evaluations, action);
  return card;
}

function makeFact(label, value, className = '') {
  const element = document.createElement('div');
  element.className = `course-fact ${className}`.trim();
  element.innerHTML = '<small></small><strong></strong>';
  element.querySelector('small').textContent = label;
  element.querySelector('strong').textContent = value;
  return element;
}

function makeSubtext(value) {
  const element = document.createElement('span');
  element.className = 'fact-subtext';
  element.textContent = value;
  return element;
}

function makeBadge(value, className) {
  const element = document.createElement('span');
  element.className = `course-badge ${className}`;
  element.textContent = value;
  return element;
}

function render() {
  const query = elements.search.value.trim().toLocaleLowerCase('ja');
  const grade = elements.grade.querySelector('.is-active')?.dataset.grade ?? '';
  const term = elements.term.value;
  const requirement = elements.requirement.value;
  const examFilter = elements.exam.value;
  const filtered = syllabus.subjects.filter((subject) => {
    const haystack = `${subject.name} ${subject.code} ${subject.teachers}`.toLocaleLowerCase('ja');
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

  elements.subjects.replaceChildren(...filtered.map(createSubjectCard));
  elements.empty.hidden = filtered.length > 0;
  elements.status.textContent = `${filtered.length} / ${syllabus.subjects.length} 科目`;
}

const terms = [...new Set(syllabus.subjects.map((subject) => subject.term).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
terms.forEach((term) => {
  const option = document.createElement('option');
  option.value = term;
  option.textContent = term;
  elements.term.append(option);
});

elements.totalCount.textContent = syllabus.subjects.length;
const requirementSummary = `必修 ${syllabus.subjects.filter((subject) => subject.selection === '必修').length} · 必履修 ${syllabus.subjects.filter((subject) => subject.enrollment === '必履修').length}`;
elements.scrapeStatus.textContent = syllabus.scrapedAt
  ? `${requirementSummary} · 更新 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(syllabus.scrapedAt))}`
  : requirementSummary;

try {
  const savedGrade = localStorage.getItem('grade-planner:grade-filter');
  const savedButton = elements.grade.querySelector(`[data-grade="${savedGrade ?? ''}"]`);
  if (savedButton) {
    elements.grade.querySelector('.is-active')?.classList.remove('is-active');
    savedButton.classList.add('is-active');
  }
} catch {
  // Storage is an optional convenience; filtering still works without it.
}

[elements.search, elements.term, elements.requirement, elements.exam].forEach((element) => element.addEventListener('input', render));
elements.grade.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-grade]');
  if (!button) return;
  elements.grade.querySelector('.is-active')?.classList.remove('is-active');
  button.classList.add('is-active');
  try { localStorage.setItem('grade-planner:grade-filter', button.dataset.grade); } catch { /* optional */ }
  render();
});

if (syllabus.subjects.length === 0) {
  elements.status.textContent = '科目データがありません';
  elements.empty.hidden = false;
  elements.empty.querySelector('h3').textContent = '先にシラバスデータを取得してください';
  elements.empty.querySelector('p').textContent = 'npm run scrape を実行すると科目が表示されます。';
} else {
  render();
}
