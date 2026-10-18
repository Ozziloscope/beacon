'use strict';

/**
 * Line diff using Myers' O(ND) algorithm, with common prefix/suffix trimmed first.
 * Returns [{ type: '=', '+' or '-', text, a: oldLineNo|null, b: newLineNo|null }]
 */
function diffLines(oldText, newText) {
  const a = String(oldText || '').replace(/\r\n?/g, '\n').split('\n');
  const b = String(newText || '').replace(/\r\n?/g, '\n').split('\n');

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const middle = myers(A, B);

  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ type: '=', text: a[i] });
  for (const op of middle) ops.push(op);
  for (let i = a.length - suf; i < a.length; i++) ops.push({ type: '=', text: a[i] });

  let ai = 1, bi = 1;
  for (const op of ops) {
    if (op.type === '=') { op.a = ai++; op.b = bi++; }
    else if (op.type === '-') { op.a = ai++; op.b = null; }
    else { op.a = null; op.b = bi++; }
  }
  return ops;
}

const MAX_D = 4000; // beyond this many edits, show a full replacement instead

function myers(a, b) {
  const N = a.length, M = b.length;
  if (N === 0) return b.map((text) => ({ type: '+', text }));
  if (M === 0) return a.map((text) => ({ type: '-', text }));
  const max = N + M;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    if (d > MAX_D) {
      return [...a.map((text) => ({ type: '-', text })), ...b.map((text) => ({ type: '+', text }))];
    }
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= N && y >= M) return backtrack(trace, a, b, offset);
    }
  }
  return [];
}

function backtrack(trace, a, b, offset) {
  let x = a.length, y = b.length;
  const ops = [];
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ type: '=', text: a[x - 1] }); x--; y--; }
    if (d > 0) {
      if (x === prevX) { ops.push({ type: '+', text: b[y - 1] }); y--; }
      else { ops.push({ type: '-', text: a[x - 1] }); x--; }
    }
  }
  return ops.reverse();
}

/**
 * Group ops into hunks, collapsing long unchanged runs to `context` lines on each side.
 * Returns [{ type: 'lines', ops } | { type: 'skip', count }]
 */
function hunks(ops, context = 3) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type !== '=') {
      const start = i;
      while (i < ops.length && ops[i].type !== '=') i++;
      out.push({ type: 'lines', ops: ops.slice(start, i) });
      continue;
    }
    const start = i;
    while (i < ops.length && ops[i].type === '=') i++;
    const run = ops.slice(start, i);
    const isFirst = start === 0, isLast = i === ops.length;
    const keepBefore = isFirst ? 0 : context;
    const keepAfter = isLast ? 0 : context;
    if (run.length <= keepBefore + keepAfter + 1) {
      out.push({ type: 'lines', ops: run });
    } else {
      if (keepBefore) out.push({ type: 'lines', ops: run.slice(0, keepBefore) });
      out.push({ type: 'skip', count: run.length - keepBefore - keepAfter });
      if (keepAfter) out.push({ type: 'lines', ops: run.slice(run.length - keepAfter) });
    }
  }
  return out;
}

function stats(ops) {
  let added = 0, removed = 0;
  for (const op of ops) {
    if (op.type === '+') added++;
    else if (op.type === '-') removed++;
  }
  return { added, removed };
}

module.exports = { diffLines, hunks, stats };
