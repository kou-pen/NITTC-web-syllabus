import syllabus from './data/subjects.json';
import { DEFAULT_THRESHOLDS, calculateRequiredScore, isExamComponent, validateThresholds, weightedPoints } from './calculator.js';
import './styles.css';

const params = new URLSearchParams(location.search);
const subject = syllabus.subjects.find((item) => item.id === params.get('id'));

const elements = {
  app: document.querySelector('#subject-app'),
  name: document.querySelector('#course-name'),
  meta: document.querySelector('#course-meta'),
  chips: document.querySelector('#evaluation-chips'),
  thresholds: document.querySelector('#thresholds'),
  knownRows: document.querySelector('#known-rows'),
  addRow: document.querySelector('#add-row'),
  examWeight: document.querySelector('#exam-weight'),
  examMax: document.querySelector('#exam-max'),
  step: document.querySelector('#score-step'),
  results: document.querySelector('#results'),
  weightedTotal: document.querySelector('#weighted-total'),
  error: document.querySelector('#form-error'),
  frame: document.querySelector('#syllabus-frame'),
  original: document.querySelector('#open-original'),
  settingsSummary: document.querySelector('#settings-summary'),
};

if (!subject) {
  elements.app.innerHTML = '<section class="not-found"><p class="eyebrow">404</p><h1>科目が見つかりません</h1><p>一覧から科目を選び直してください。</p><a class="primary-button" href="./">科目一覧へ戻る</a></section>';
} else {
  initialize();
}

function initialize() {
  document.title = `${subject.name} | 必要点を計算`;
  elements.name.textContent = subject.name;
  elements.meta.textContent = [subject.code, subject.yearLevel && `${subject.yearLevel}年`, subject.term, subject.teachers].filter(Boolean).join(' · ');
  elements.original.href = subject.url;
  elements.frame.src = subject.url;

  subject.evaluation.forEach((item) => {
    const chip = document.createElement('span');
    chip.textContent = `${item.name} ${item.weight}%`;
    if (isExamComponent(item.name)) chip.classList.add('exam-chip');
    elements.chips.append(chip);
  });
  if (!subject.evaluation.length) {
    const chip = document.createElement('span');
    chip.textContent = '評価割合の掲載なし';
    elements.chips.append(chip);
  }

  DEFAULT_THRESHOLDS.forEach(({ grade, value }) => {
    const label = document.createElement('label');
    label.className = `threshold threshold-${grade.toLowerCase()}`;
    label.innerHTML = `<b>${grade}</b><div class="input-suffix"><input type="number" min="0" max="100" step="1" value="${value}" data-grade="${grade}" aria-label="${grade}評価の最低点" /><span>点〜</span></div>`;
    elements.thresholds.append(label);
  });

  const nonExam = subject.evaluation.filter((item) => !isExamComponent(item.name) && item.name !== '合計');
  nonExam.forEach((item) => addKnownRow({ name: item.name, weight: item.weight, score: '', max: 100 }));
  if (!nonExam.length) addKnownRow({ name: '課題・小テストなど', weight: '', score: '', max: 100 });

  const suggestedExamWeight = subject.evaluation
    .filter((item) => isExamComponent(item.name))
    .reduce((sum, item) => sum + item.weight, 0);
  elements.examWeight.value = suggestedExamWeight || '';

  restoreState();
  elements.addRow.addEventListener('click', () => {
    addKnownRow({ name: '', weight: '', score: '', max: 100 });
    update();
  });
  document.querySelector('#calculator').addEventListener('input', update);
  update();
}

function addKnownRow(values) {
  const row = document.createElement('div');
  row.className = 'known-row';
  row.innerHTML = `
    <input class="known-name" type="text" placeholder="例: 課題" aria-label="獲得済み項目名" />
    <div class="input-suffix"><input class="known-weight" type="number" min="0" max="100" step="0.1" inputmode="decimal" aria-label="評価割合" /><b>%</b></div>
    <div class="score-pair"><input class="known-score" type="number" min="0" step="0.1" inputmode="decimal" placeholder="得点" aria-label="獲得点" /><span>/</span><input class="known-max" type="number" min="0.1" step="0.1" inputmode="decimal" aria-label="満点" /></div>
    <button class="remove-row" type="button" aria-label="この項目を削除">×</button>`;
  row.querySelector('.known-name').value = values.name ?? '';
  row.querySelector('.known-weight').value = values.weight ?? '';
  row.querySelector('.known-score').value = values.score ?? '';
  row.querySelector('.known-max').value = values.max ?? 100;
  if (values.name && values.weight !== '') {
    row.querySelector('.known-name').readOnly = true;
    row.querySelector('.known-weight').readOnly = true;
  }
  row.querySelector('.remove-row').addEventListener('click', () => {
    row.remove();
    update();
  });
  elements.knownRows.append(row);
}

function readRows() {
  const completed = [];
  let hasPartial = false;
  let validationError = '';
  document.querySelectorAll('.known-row').forEach((row) => {
    const name = row.querySelector('.known-name').value.trim();
    const raw = {
      name,
      weight: row.querySelector('.known-weight').value,
      score: row.querySelector('.known-score').value,
      max: row.querySelector('.known-max').value,
    };
    const relevant = raw.weight !== '' || raw.score !== '';
    if (!relevant) return;
    if (raw.weight === '' || raw.score === '' || raw.max === '') {
      hasPartial = true;
      return;
    }
    const parsed = { name, weight: Number(raw.weight), score: Number(raw.score), max: Number(raw.max) };
    if (parsed.weight < 0 || parsed.weight > 100 || parsed.max <= 0 || parsed.score < 0 || parsed.score > parsed.max) {
      validationError = '獲得済み項目は、割合0〜100・得点0〜満点の範囲で入力してください。';
      return;
    }
    completed.push(parsed);
  });
  return { completed, hasPartial, validationError };
}

function update() {
  const thresholds = [...elements.thresholds.querySelectorAll('input')].map((input) => ({ grade: input.dataset.grade, value: Number(input.value) }));
  const rows = readRows();
  const earned = weightedPoints(rows.completed);
  const examWeight = Number(elements.examWeight.value);
  const examMax = Number(elements.examMax.value);
  const step = Number(elements.step.value);
  elements.settingsSummary.textContent = `A ${formatNumber(thresholds[0]?.value)} · B ${formatNumber(thresholds[1]?.value)} · C ${formatNumber(thresholds[2]?.value)} ／ 試験 ${formatNumber(examWeight)}%・${formatNumber(examMax)}点`;
  let error = rows.validationError || validateThresholds(thresholds);

  if (!Number.isFinite(examWeight) || examWeight < 0 || examWeight > 100 || !Number.isFinite(examMax) || examMax <= 0 || !Number.isFinite(step) || step <= 0) {
    error ||= '残りの試験は、割合0〜100・満点と得点刻みは0より大きい値で入力してください。';
  }
  const knownWeight = rows.completed.reduce((sum, row) => sum + row.weight, 0);
  if (knownWeight + examWeight > 100 + 1e-9) {
    error ||= `獲得済み項目と今回の試験の割合が合計${formatNumber(knownWeight + examWeight)}%です。100%以下にしてください。`;
  }

  elements.weightedTotal.textContent = formatNumber(earned);
  elements.error.hidden = !error;
  elements.error.textContent = error;
  elements.results.replaceChildren();

  if (!error) {
    thresholds.forEach(({ grade, value }) => {
      elements.results.append(createResultRow(grade, value, calculateRequiredScore({ threshold: value, earned, examWeight, examMax, step }), examMax));
    });
    if (rows.hasPartial) {
      const note = document.createElement('p');
      note.className = 'partial-note';
      note.textContent = '未完成の獲得済み項目は計算から除外しています。';
      elements.results.append(note);
    }
  }
  saveState(thresholds, rows.completed);
}

function createResultRow(grade, threshold, result, examMax) {
  const row = document.createElement('div');
  row.className = `result-row result-${grade.toLowerCase()} result-${result.status}`;
  const label = document.createElement('div');
  label.className = 'result-label';
  label.innerHTML = `<b>${grade}</b><span>総合 ${formatNumber(threshold)}点〜</span>`;
  const value = document.createElement('div');
  value.className = 'result-value';

  if (result.status === 'reachable') {
    value.innerHTML = `<strong>${formatNumber(result.required)}<small> / ${formatNumber(examMax)}点</small></strong><span>必要</span>`;
  } else if (result.status === 'secured') {
    value.innerHTML = '<strong>0<small>点</small></strong><span>到達済み</span>';
  } else {
    value.innerHTML = `<strong>到達困難</strong><span>満点時 ${formatNumber(result.maxFinal)}点${result.shortage ? ` · あと${formatNumber(result.shortage)}点不足` : ''}</span>`;
  }
  row.append(label, value);
  return row;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '―';
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value);
}

function storageKey() {
  return `grade-planner:${subject.id}`;
}

function saveState(thresholds, rows) {
  const state = {
    thresholds,
    rows,
    examWeight: elements.examWeight.value,
    examMax: elements.examMax.value,
    step: elements.step.value,
  };
  localStorage.setItem(storageKey(), JSON.stringify(state));
}

function restoreState() {
  try {
    const state = JSON.parse(localStorage.getItem(storageKey()));
    if (!state) return;
    state.thresholds?.forEach(({ grade, value }) => {
      const input = elements.thresholds.querySelector(`[data-grade="${grade}"]`);
      if (input) input.value = value;
    });
    if (state.rows?.length) {
      elements.knownRows.replaceChildren();
      state.rows.forEach(addKnownRow);
    }
    if (state.examWeight !== undefined) elements.examWeight.value = state.examWeight;
    if (state.examMax !== undefined) elements.examMax.value = state.examMax;
    if (state.step !== undefined) elements.step.value = state.step;
  } catch {
    localStorage.removeItem(storageKey());
  }
}
