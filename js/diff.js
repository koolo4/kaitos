/*
 * Построчный diff (алгоритм наибольшей общей подпоследовательности).
 * Используется для предпросмотра правок, которые предлагает модель.
 */

export function diffLines(before, after) {
  const left = String(before ?? '').split('\n');
  const right = String(after ?? '').split('\n');

  const rows = left.length;
  const cols = right.length;
  // таблицу держим в одном массиве: (rows+1) * (cols+1)
  const width = cols + 1;
  const table = new Uint32Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * width + j] = left[i] === right[j]
        ? table[(i + 1) * width + (j + 1)] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (left[i] === right[j]) {
      ops.push({ type: 'equal', text: left[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ type: 'del', text: left[i], oldLine: i + 1, newLine: null });
      i += 1;
    } else {
      ops.push({ type: 'add', text: right[j], oldLine: null, newLine: j + 1 });
      j += 1;
    }
  }
  while (i < rows) {
    ops.push({ type: 'del', text: left[i], oldLine: i + 1, newLine: null });
    i += 1;
  }
  while (j < cols) {
    ops.push({ type: 'add', text: right[j], oldLine: null, newLine: j + 1 });
    j += 1;
  }
  return ops;
}

export function diffStats(ops) {
  return ops.reduce(
    (acc, op) => {
      if (op.type === 'add') acc.added += 1;
      if (op.type === 'del') acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0 },
  );
}

/* Строки-заглушки в начале и конце (общие контекстные строки) сжимаем, чтобы diff был читаемым. */
export function compactOps(ops, context = 3) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.type === 'equal') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  });
  const result = [];
  let skipped = 0;
  ops.forEach((op, index) => {
    if (keep[index]) {
      if (skipped) {
        result.push({ type: 'gap', text: `… ${skipped} строк без изменений`, skipped });
        skipped = 0;
      }
      result.push(op);
    } else {
      skipped += 1;
    }
  });
  if (skipped) result.push({ type: 'gap', text: `… ${skipped} строк без изменений`, skipped });
  return result;
}

export function escapeDiffText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderDiffHtml(before, after, context = 3) {
  const rows = compactOps(diffLines(before, after), context);
  const body = rows
    .map((row) => {
      if (row.type === 'gap') {
        return `<div class="diff-row diff-row--gap">${escapeDiffText(row.text)}</div>`;
      }
      const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' ';
      const number = row.type === 'add' ? row.newLine : row.oldLine;
      return `<div class="diff-row diff-row--${row.type}"><span class="diff-num">${number ?? ''}</span>`
        + `<span class="diff-sign">${sign}</span><span class="diff-text">${escapeDiffText(row.text)}</span></div>`;
    })
    .join('');
  return `<div class="diff">${body || '<div class="diff-row diff-row--gap">изменений нет</div>'}</div>`;
}
