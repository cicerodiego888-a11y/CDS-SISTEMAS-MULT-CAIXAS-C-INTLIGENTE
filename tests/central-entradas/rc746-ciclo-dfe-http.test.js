/**
 * RC7.4.6 — Mapeamento HTTP do ciclo DF-e.
 * Resultado de negócio (ex. cStat 596) NÃO vira HTTP 422.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/**
 * Espelha o contrato da rota (backend/rotas/central-entradas.js).
 * @param {Object|null} resultado
 * @returns {number}
 */
function statusHttpCicloDfe(resultado) {
  if (resultado && resultado.requerConfirmacao) return 409;
  return 200;
}

function test(nome, fn) {
  try {
    fn();
    console.log(`✓ ${nome}`);
  } catch (error) {
    console.error(`✗ ${nome}`);
    throw error;
  }
}

test('manifestação aceita → HTTP 200', () => {
  assert.strictEqual(
    statusHttpCicloDfe({ sucesso: true, xmlCompleto: false, mensagem: 'Aguardando...' }),
    200
  );
});

test('cStat 596 (rejeição SEFAZ) → HTTP 200, não 422', () => {
  const status = statusHttpCicloDfe({
    documentoId: 12,
    sucesso: false,
    cStat: '596',
    mensagem: 'Evento apresentado após o prazo permitido.',
    proximaConsultaEm: '2026-07-27T18:00:00.000Z',
    gateProcessado: true
  });
  assert.strictEqual(status, 200);
  assert.notStrictEqual(status, 422);
});

test('aguardando disponibilização → HTTP 200', () => {
  assert.strictEqual(
    statusHttpCicloDfe({
      sucesso: false,
      aguardandoDisponibilizacao: true,
      mensagem: 'Aguardando disponibilização do XML completo pela SEFAZ.'
    }),
    200
  );
});

test('requerConfirmacao → HTTP 409', () => {
  assert.strictEqual(
    statusHttpCicloDfe({
      sucesso: false,
      requerConfirmacao: true,
      mensagem: 'Confirmação do operador necessária.'
    }),
    409
  );
});

test('sucesso:false genérico (negócio) → HTTP 200, não 422', () => {
  assert.strictEqual(
    statusHttpCicloDfe({
      sucesso: false,
      ignorado: true,
      mensagem: 'Ciclo DF-e já em execução.'
    }),
    200
  );
});

test('rota não mapeia sucesso:false → 422', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../backend/rotas/central-entradas.js'),
    'utf8'
  );
  assert.ok(src.includes('function statusHttpCicloDfe'));
  assert.ok(src.includes('statusHttpCicloDfe(resultado)'));
  // Antigo fallback eliminado no handler ciclo-dfe
  const bloco = src.match(/router\.post\('\/:id\/ciclo-dfe'[\s\S]*?\n\}\);/);
  assert.ok(bloco, 'handler ciclo-dfe encontrado');
  assert.ok(!/:\s*422/.test(bloco[0]), 'handler ciclo-dfe não deve retornar 422');
  assert.ok(!/sucesso\s*\|\|\s*resultado\.aguardandoDisponibilizacao/.test(bloco[0]));
});

test('frontend exibe mensagem/cStat do corpo (não só Erro HTTP)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
    'utf8'
  );
  const fn = src.match(/async function solicitarXmlCompletoCentral[\s\S]*?^}/m);
  assert.ok(fn, 'solicitarXmlCompletoCentral encontrada');
  assert.ok(fn[0].includes('resultado.cStat'));
  assert.ok(fn[0].includes('resultado.mensagem'));
  assert.ok(fn[0].includes("resultado.sucesso === false"));
});

console.log('\nRC7.4.6 homologada com sucesso.');
