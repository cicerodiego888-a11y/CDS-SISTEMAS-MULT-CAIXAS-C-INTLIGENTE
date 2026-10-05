'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendFile = path.join(
  __dirname,
  '../../frontend/erp/js/fechamento-fiscal-dia.js'
);
const serviceFile = path.join(
  __dirname,
  '../../backend/services/fechamento-fiscal/FechamentoFiscalService.js'
);
const frontend = fs.readFileSync(frontendFile, 'utf8');
const service = fs.readFileSync(serviceFile, 'utf8');
const previewHandler = frontend.match(
  /async function ffdAtualizarPrevia\(\) \{[\s\S]*?\n\}/
)?.[0] || '';

test('timeout de interface não cancela a requisição e o lock é sempre liberado', () => {
  assert.ok(previewHandler);
  assert.match(frontend, /FFD_PREVIA_TIMEOUT_MS = 120000/);
  assert.match(previewHandler, /Promise\.race/);
  assert.match(previewHandler, /request\.then/);
  assert.match(previewHandler, /PREVIA_FRONTEND_TIMEOUT/);
  assert.doesNotMatch(previewHandler, /AbortController|\.abort\(/);
  assert.match(frontend, /finally\s*\{\s*__ffdEstado\.ops\[chave\] = false/);
});

test('backend coalesce requests iguais e rejeita composição concorrente conflitante', () => {
  assert.match(service, /const previewsEmAndamento = new Map\(\)/);
  assert.match(service, /existente\.assinatura === assinatura/);
  assert.match(service, /PREVIA_EM_ANDAMENTO/);
});
