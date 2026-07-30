const EPSILON = 1e-9;

export const DEFAULT_THRESHOLDS = [
  { grade: 'A', value: 85 },
  { grade: 'B', value: 70 },
  { grade: 'C', value: 60 },
  { grade: 'F', value: 0 },
];

export function weightedPoints(rows) {
  return rows.reduce((total, row) => {
    const weight = Number(row.weight);
    const score = Number(row.score);
    const max = Number(row.max);
    if (![weight, score, max].every(Number.isFinite) || max <= 0) return total;
    return total + weight * (score / max);
  }, 0);
}

export function validateThresholds(thresholds) {
  if (thresholds.some(({ value }) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return '評価基準は0〜100で入力してください。';
  }
  for (let index = 1; index < thresholds.length; index += 1) {
    if (thresholds[index - 1].value <= thresholds[index].value) {
      return '評価基準は A > B > C > F の順にしてください。';
    }
  }
  return '';
}

export function calculateRequiredScore({ threshold, earned, examWeight, examMax, step = 1 }) {
  if (![threshold, earned, examWeight, examMax, step].every(Number.isFinite) || examMax <= 0 || step <= 0) {
    return { status: 'invalid' };
  }

  const effectiveThreshold = Math.ceil(threshold - EPSILON);
  const currentFinal = Math.floor(earned + EPSILON);
  const maximumFinal = Math.floor(earned + examWeight + EPSILON);

  if (currentFinal >= effectiveThreshold) {
    return { status: 'secured', exact: 0, required: 0, maxFinal: maximumFinal };
  }

  if (examWeight <= 0) {
    return { status: 'impossible', exact: Infinity, required: null, maxFinal: currentFinal, shortage: effectiveThreshold - currentFinal };
  }

  const exact = (effectiveThreshold - earned) * examMax / examWeight;
  const required = Math.ceil(exact / step - EPSILON) * step;
  const roundedRequired = Number(required.toFixed(10));
  const maxFinal = maximumFinal;

  if (exact > examMax + EPSILON || roundedRequired > examMax + EPSILON) {
    return {
      status: 'impossible',
      exact,
      required: null,
      maxFinal,
      shortage: Math.max(0, effectiveThreshold - maxFinal),
    };
  }

  return { status: 'reachable', exact, required: roundedRequired, maxFinal };
}

export function isExamComponent(name) {
  return /(試験|テスト|考査)/u.test(name);
}
