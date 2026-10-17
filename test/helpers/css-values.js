// Small numeric CSS evaluator for explicit budgets. Does not emulate intrinsic text or browser layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

export const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
export const sheet = file => postcss.parse(read(file));
export function declaration(css, selector, prop) {
  let value;
  css.walkRules(rule => {
    if (rule.selector !== selector) return;
    rule.walkDecls(prop, decl => { value = decl.value; });
  });
  assert.notEqual(value, undefined, `${selector}: ${prop}`);
  return value;
}

export function length(expression, vars = {}, viewport = { width: 1920, height: 1080 }) {
  const tokens = expression.match(/--[\w-]+|\d*\.?\d+(?:dvh|svh|vh|vw|rem|em|px|%)?|[a-z]+|[()+*/,-]/g) || [];
  let at = 0;
  function primary() {
    const token = tokens[at++];
    if (/^\d|^\./.test(token)) {
      const n = parseFloat(token), suffix = token.replace(/^[\d.]+/, '');
      return n * ({ px: 1, rem: vars.rem || 100, em: vars.em || 16, vw: viewport.width / 100,
        vh: viewport.height / 100, dvh: viewport.height / 100, svh: viewport.height / 100,
        '%': (vars.parent ?? viewport.width) / 100, '': 1 }[suffix]);
    }
    if (token === '-') return -primary();
    if (token === '(') { const result = sum(); assert.equal(tokens[at++], ')'); return result; }
    assert.equal(tokens[at++], '(');
    if (token === 'var') {
      const name = tokens[at++];
      let fallback;
      if (tokens[at] === ',') { at++; fallback = sum(); }
      assert.equal(tokens[at++], ')');
      assert.ok(name in vars || fallback !== undefined, name);
      return vars[name] ?? fallback;
    }
    const values = [sum()];
    while (tokens[at] === ',') { at++; values.push(sum()); }
    assert.equal(tokens[at++], ')');
    if (token === 'min') return Math.min(...values);
    if (token === 'max') return Math.max(...values);
    assert.equal(token, 'calc');
    return values[0];
  }
  function product() {
    let value = primary();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++], right = primary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++], right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = sum();
  assert.equal(at, tokens.length, expression);
  assert.ok(Number.isFinite(value), expression);
  return value;
}
