'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '../../frontend/erp/js/caixa.js'),
  path.join(__dirname, '../../frontend/pdv/js/caixa.js')
];

test('reimpressão do fechamento não usa confirm() bloqueante', () => {
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /confirm\(\s*['"]Deseja reimprimir o fechamento deste caixa\?['"]\s*\)/);
    assert.match(source, /function reimprimirFechamento\(caixaId\)\s*\{[\s\S]*?url:\s*`\$\{API_URL\}\/caixa\/\$\{caixaId\}\/reimprimir`/);
  }
});
