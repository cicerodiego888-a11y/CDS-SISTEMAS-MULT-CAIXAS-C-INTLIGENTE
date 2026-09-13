/**
 * RC15.5 — Auditoria completa da validação do Upload PLU
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const validator = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluValidator');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluErrors');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.5 — ValidationReport', () => {
  it('retorna errors com campo, valor e motivo', () => {
    const report = validator.buildReport({
      produto_id: 10,
      plu: '9999',
      descricao: 'CDS TESTE DE BALANÇA',
      preco: 0,
      departamento: null,
      unidade: 'kg'
    });
    assert.equal(report.success, false);
    assert.ok(report.errors.length >= 2);
    for (const e of report.errors) {
      assert.ok(e.campo);
      assert.ok(e.motivo);
      assert.ok('valor' in e);
    }
    assert.ok(report.checks.some((c) => c.label === 'Departamento' && !c.ok));
    assert.ok(report.checks.some((c) => c.label === 'Preço' && !c.ok));
    assert.ok(report.checks.some((c) => c.label === 'PLU válido' && c.ok));
  });

  it('assertValid não retorna só VALIDATION_ERROR na mensagem', () => {
    try {
      validator.assertValid({
        plu: '1',
        descricao: 'X',
        preco: 0,
        departamento: null,
        unidade: null
      });
      assert.fail('esperado throw');
    } catch (err) {
      assert.equal(err.code, CODES.VALIDATION_ERROR);
      assert.notEqual(String(err.message).trim(), 'VALIDATION_ERROR');
      assert.ok(err.validationReport);
      assert.ok(Array.isArray(err.meta.errors));
    }
  });

  it('formatChecklist usa ✔ e ✖', () => {
    const report = validator.buildReport({
      plu: '10',
      descricao: 'Ok',
      preco: 5,
      departamento: 1,
      unidade: 'kg'
    });
    const txt = validator.formatChecklist(report);
    assert.match(txt, /✔/);
    assert.ok(!txt.includes('✖') || report.success);
  });
});

describe('RC15.5 — integração código', () => {
  it('UploadPluOperation registra auditoria de validação', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/UploadPluOperation.js');
    assert.match(src, /_auditoriaValidacao|ValidationReport|formatChecklist/);
    assert.match(src, /buildReport/);
  });

  it('API propaga validationReport / motivos', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/plu/PluController.js');
    assert.match(src, /validationReport/);
    assert.match(src, /motivos/);
    assert.match(src, /Produto não enviado/);
  });

  it('front exibe motivos em vez de só VALIDATION_ERROR', () => {
    const epb = read('frontend/erp/js/enviar-produtos-balanca.js');
    assert.match(epb, /Produto não enviado/);
    assert.match(epb, /motivos/);
    const prod = read('frontend/erp/js/produtos.js');
    assert.match(prod, /formatarMotivosValidacaoBalanca/);
  });
});
