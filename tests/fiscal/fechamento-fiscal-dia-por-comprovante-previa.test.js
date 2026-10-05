'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const arquivo = path.join(__dirname, '..', '..', 'frontend', 'erp', 'js', 'fechamento-fiscal-dia.js');
const source = fs.readFileSync(arquivo, 'utf8');

describe('Sprint 5B-3D — preview por comprovante preserva cada comprovante individualmente', () => {
  it('envia a lista de comprovantes na atualização da prévia e persiste no endpoint dedicado', () => {
    assert.match(source, /comprovantes:\s*comprovantesParaPrevia/i);
    assert.match(source, /recebimentos-comprovantes/i);
  });
});
