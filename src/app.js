import syllabus from './data/subjects.json';
import { isExamComponent } from './calculator.js';
import './styles.css';

const elements = {
  subjects: document.querySelector('#subjects'),
  search: document.querySelector('#search'),
  grade: document.querySelector('#grade-filter'),
  exam: document.querySelector('#exam-filter'),
  status: document.querySelector('#data-status'),
  empty: document.querySelector('#empty-state'),
  source: document.querySelector('#source-link'),
};

elements.source.href = syllabus.sourceUrl;

function hasExam(subject) {
  return subject.evaluation.some((item) => isExamComponent(item.name) && item.weight > 0);
}

function createSubjectCard(subject) {
  const card = document.createElement('a');
  card.className = 'subject-card';
  card.href = `./subject.html?id=${encodeURIComponent(subject.id)}`;

  const top = document.createElement('div');
  top.className = 'subject-card-top';
  const category = document.createElement('span');
  category.className = 'subject-category';
  category.textContent = subject.category || '科目';
  const code = document.createElement('span');
  code.className = 'subject-code';
  code.textContent = subject.code;
  top.append(category, code);

  const title = document.createElement('h3');
  title.textContent = subject.name;
  const teacher = document.createElement('p');
  teacher.className = 'subject-teacher';
  teacher.textContent = subject.teachers || '担当教員未掲載';

  const details = document.createElement('div');
  details.className = 'subject-details';
  details.innerHTML = `<span>${subject.yearLevel ? `${subject.yearLevel}年` : '学年―'}</span><span>${subject.term || '開設期―'}</span><span>${subject.credits ? `${subject.credits}単位` : '単位―'}</span>`;

  const bars = document.createElement('div');
  bars.className = 'mini-bars';
  subject.evaluation.slice(0, 4).forEach((item) => {
    const row = document.createElement('div');
    row.innerHTML = `<span></span><i style="--bar:${Math.max(0, Math.min(100, item.weight))}%"></i><b></b>`;
    row.querySelector('span').textContent = item.name;
    row.querySelector('b').textContent = `${item.weight}%`;
    bars.append(row);
  });
  if (!subject.evaluation.length) {
    bars.classList.add('no-evaluation');
    bars.textContent = '評価割合の掲載なし';
  }

  const action = document.createElement('div');
  action.className = 'card-action';
  action.innerHTML = '<span>必要点を計算</span><b>→</b>';
  card.append(top, title, teacher, details, bars, action);
  return card;
}

function render() {
  const query = elements.search.value.trim().toLocaleLowerCase('ja');
  const grade = elements.grade.value;
  const examFilter = elements.exam.value;
  const filtered = syllabus.subjects.filter((subject) => {
    const haystack = `${subject.name} ${subject.code} ${subject.teachers}`.toLocaleLowerCase('ja');
    if (query && !haystack.includes(query)) return false;
    if (grade && String(subject.yearLevel) !== grade) return false;
    if (examFilter === 'exam' && !hasExam(subject)) return false;
    if (examFilter === 'no-exam' && hasExam(subject)) return false;
    return true;
  });

  elements.subjects.replaceChildren(...filtered.map(createSubjectCard));
  elements.empty.hidden = filtered.length > 0;
  elements.status.textContent = `${filtered.length} / ${syllabus.subjects.length} 科目`;
}

[elements.search, elements.grade, elements.exam].forEach((element) => element.addEventListener('input', render));

if (syllabus.subjects.length === 0) {
  elements.status.textContent = '科目データがありません';
  elements.empty.hidden = false;
  elements.empty.querySelector('h3').textContent = '先にシラバスデータを取得してください';
  elements.empty.querySelector('p').textContent = 'npm run scrape を実行すると科目が表示されます。';
} else {
  render();
}
