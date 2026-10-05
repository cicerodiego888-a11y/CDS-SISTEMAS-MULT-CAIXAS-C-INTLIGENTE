'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const arquivo = path.join(__dirname, '..', '..', 'frontend', 'erp', 'js', 'fechamento-fiscal-dia.js');
const source = fs.readFileSync(arquivo, 'utf8');

describe('Sprint 5B-1E — UX por comprovante reutiliza o mesmo fluxo de recebimento', () => {
  it('não mantém card especial e usa a tabela de recebimentos do fluxo existente', () => {
    assert.doesNotMatch(source, /Comprovantes recebidos/i);
    assert.doesNotMatch(source, /ffdSecaoModoComprovante/i);
    assert.match(source, /ffdBtnAddMaquina/i);
    assert.match(source, /\/fiscal\/fechamentos\/\$\{fechamentoId\}\/recebimentos/i);
  });
});
