/**
 * Sprint 7.1.1 — INSERT caixa_fechamentos: placeholders === parâmetros.
 * node --test tests/caixa/sprint711-fechamento-sql-placeholders.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { countPlaceholders, validateSql } = require('../../backend/lib/sqlCertification');

const ROOT = path.join(__dirname, '../..');
const CAIXA = fs.readFileSync(path.join(ROOT, 'backend/rotas/caixa.js'), 'utf8');

function splitTopo(src) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inStr = false;
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inStr) {
      current += c;
      if (c === quote && src[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inStr = true;
      quote = c;
      current += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extrairInsertFechamento() {
  const inicio = CAIXA.indexOf('INSERT INTO caixa_fechamentos (');
  assert.ok(inicio >= 0, 'INSERT caixa_fechamentos não encontrado');
  const values = CAIXA.indexOf('VALUES (', inicio);
  const fechaValues = CAIXA.indexOf(')', values);
  const sql = CAIXA.slice(inicio, fechaValues + 1);
  const colsBloco = CAIXA.slice(inicio + 'INSERT INTO caixa_fechamentos ('.length, values);
  const colunas = colsBloco
    .split(',')
    .map((c) => c.replace(/[^a-z0-9_]/gi, '').trim())
    .filter(Boolean);
  const arrInicio = CAIXA.indexOf('[', fechaValues);
  const arrFim = CAIXA.indexOf('], (insertErr)', arrInicio);
  assert.ok(arrFim > arrInicio, 'array de parâmetros do INSERT não encontrado');
  const params = splitTopo(CAIXA.slice(arrInicio + 1, arrFim));
  return { sql, colunas, params };
}

describe('Sprint 7.1.1 — alinhamento SQL do fechamento', () => {
  it('INSERT caixa_fechamentos tem colunas = placeholders = parâmetros', () => {
    const { sql, colunas, params } = extrairInsertFechamento();
    const placeholders = countPlaceholders(sql);
    assert.equal(colunas.length, 28, `colunas=${colunas.length}`);
    assert.equal(placeholders, 28, `placeholders=${placeholders}`);
    assert.equal(params.length, 28, `parâmetros=${params.length}`);
    assert.equal(placeholders, params.length);
    assert.equal(colunas.length, placeholders);
    assert.ok(colunas.includes('resumo_json'));
    assert.ok(colunas.includes('dinheiro_conferido'));
    assert.ok(colunas.includes('retirada_fechamento'));
    assert.ok(colunas.includes('saldo_final'));
    assert.ok(colunas.includes('total_recebido'));
    assert.ok(colunas.includes('total_pendente'));
    assert.ok(colunas.includes('justificativa_divergencia'));
    assert.ok(colunas.includes('autorizado_por'));
    validateSql(sql, new Array(params.length).fill(null));
  });

  it('falha se placeholders !== parâmetros (certificação real)', () => {
    const { sql, params } = extrairInsertFechamento();
    const ph = countPlaceholders(sql);
    assert.throws(
      () => validateSql(sql, new Array(ph + 1).fill(null)),
      (err) => /placeholders !== parâmetros|placeholders !== parametros/i.test(String(err.message || err))
    );
    assert.doesNotThrow(() => validateSql(sql, new Array(params.length).fill(null)));
  });

  it('UPDATE de caixa e INSERT de movimentação do fechar também alinham', () => {
    const fechar = CAIXA.slice(CAIXA.indexOf("router.post('/fechar'"));
    const upd = fechar.match(/UPDATE caixa SET[\s\S]*?WHERE id = \?/);
    assert.ok(upd);
    const updParams = fechar.slice(fechar.indexOf(upd[0]) + upd[0].length);
    const updArr = updParams.match(/,\s*\[([\s\S]*?)\]\s*,\s*\(updateErr\)/);
    assert.ok(updArr);
    const nUpd = splitTopo(updArr[1]).length;
    assert.equal(countPlaceholders(upd[0]), nUpd);
    validateSql(upd[0], new Array(nUpd).fill(null));

    const mov = fechar.match(
      /INSERT INTO caixa_movimentacoes \(\s*caixa_id,\s*sessao_id,\s*tipo,\s*valor,\s*motivo,\s*usuario_id,\s*operador_nome,\s*terminal_id\s*\)\s*VALUES \(\?, \?, 'retirada_fechamento', \?, \?, \?, \?, \?\)/
    );
    assert.ok(mov, 'INSERT retirada_fechamento deve ter 7 placeholders para 7 parâmetros');
    assert.equal(countPlaceholders(mov[0]), 7);
  });
});
