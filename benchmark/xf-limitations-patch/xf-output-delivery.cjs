'use strict';

const assert = require('node:assert/strict');
const Analysis = require('./xf-release-old29/extension/analysis.js');

const contractPrefix = 'Benchmark统一输出约束';
const outputContract = [
  '最终答复只输出一个 JSON 对象，遵循下方 Schema。',
  '顶层只写 task、danger、efficiency、decision、limitations。decision 只写 action、tile、reasons。',
  '全部限制写在顶层 limitations。原因写在已有 reasons。省略 Schema 之外的键，空值占位键也省略。',
  '核对顶层与 decision 的键，再闭合整个 JSON 对象。'
].join('\n');

function tightenContract(options) {
  const lines = options.systemPrompt.split('\n');
  const index = lines.findIndex(line => line.startsWith(contractPrefix));
  assert(index >= 0 && lines[index + 1] === '输出JSON Schema：', 'XF output contract anchor changed');
  lines[index] = outputContract;
  return { ...options, systemPrompt: lines.join('\n') };
}

function readWithoutDuplicateKeys(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:]/g) ?? [];
  const stack = [];
  for (const [index, token] of tokens.entries()) {
    if (token === '{' || token === '[') stack.push(token === '{' ? new Set() : null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(token);
      const keys = stack.at(-1);
      if (keys.has(key)) return null;
      keys.add(key);
    }
  }
  return value;
}

const validStrings = lines => Array.isArray(lines) && lines.length <= 32 &&
  lines.every(line => typeof line === 'string' && line.trim() && line.length <= 2000);

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function recoverEarlyRootClose(text) {
  // One observed layout closes {task, danger, efficiency} before the final two fields.
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g;
  let depth = 0;
  for (const token of text.matchAll(tokens)) {
    if (token[0] === '{' || token[0] === '[') depth++;
    if (token[0] !== '}' && token[0] !== ']') continue;
    if (--depth !== 0) continue;
    if (token[0] !== '}') return null;
    const tail = text.slice(token.index + 1).trimStart();
    const extraBracket = tail.startsWith(']');
    const suffix = extraBracket ? tail.slice(1).trimStart() : tail;
    if (!suffix.startsWith(',')) return null;
    const prefix = text.slice(0, token.index);
    if (!hasExactKeys(readWithoutDuplicateKeys(prefix + '}'), ['task', 'danger', 'efficiency']) ||
        !hasExactKeys(readWithoutDuplicateKeys('{' + suffix.slice(1)), ['decision', 'limitations'])) return null;
    const value = readWithoutDuplicateKeys(prefix + suffix);
    const actions = ['move_root_close'];
    if (extraBracket) actions.push('remove_stray_closing_bracket');
    return value === null ? null : { value, actions };
  }
  return null;
}

function repairFinal(text, prepared) {
  if (typeof text !== 'string' || text.length > 32000) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  // Keep the released relocation path and start the extra rules only when it rejects the original.
  try {
    Analysis.parseXfResult(text, prepared);
    return null;
  } catch {}

  const actions = [];
  let value = readWithoutDuplicateKeys(trimmed);
  if (value === null && trimmed.endsWith('}')) {
    const closed = readWithoutDuplicateKeys(trimmed + '}');
    if (closed && !Object.hasOwn(closed, 'limitations') && validStrings(closed.decision?.limitations)) {
      value = closed;
      actions.push('close_root');
    }
  }
  if (value === null) {
    const recovered = recoverEarlyRootClose(trimmed);
    if (recovered) {
      value = recovered.value;
      actions.push(...recovered.actions);
    }
  }
  const decision = value?.decision;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null;
  for (const key of ['reasons_note', 'tileNote']) {
    if (Object.hasOwn(decision, key) && decision[key] === null) {
      delete decision[key];
      actions.push(`remove_null_${key}`);
    }
  }
  if (Object.hasOwn(decision, 'actionNote') && (decision.actionNote === null || decision.actionNote === '')) {
    actions.push(decision.actionNote === null ? 'remove_null_actionNote' : 'remove_empty_actionNote');
    delete decision.actionNote;
  }
  if (Object.hasOwn(decision, 'limitations') && validStrings(decision.limitations)) {
    if (!Object.hasOwn(value, 'limitations')) {
      value.limitations = decision.limitations;
      delete decision.limitations;
      actions.push('move_limitations');
    } else if (validStrings(value.limitations)) {
      // Keep every unique line the model supplied, with existing top-level lines in their original order.
      const top = new Set(value.limitations);
      const appended = decision.limitations.filter(line => {
        if (top.has(line)) return false;
        top.add(line);
        return true;
      });
      value.limitations = value.limitations.concat(appended);
      delete decision.limitations;
      actions.push(appended.length ? 'merge_limitations' : 'remove_redundant_limitations');
    }
  }
  if (!actions.length) return null;
  try {
    const result = Analysis.parseResult(value, prepared);
    return { text: JSON.stringify(result), actions };
  } catch (error) {
    if (!error.validation) throw error;
    return null;
  }
}

module.exports = { tightenContract, repairFinal };
