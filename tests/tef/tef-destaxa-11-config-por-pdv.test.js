/**
 * TEF-DESTAXA-11 — Auditoria estática: escopo TEF por instalação vs PDV.
 * Sem TX financeira, sem INIT, sem mutação do banco oficial.
 * Executar: node tests/tef/tef-destaxa-11-config-por-pdv.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tefConfigService = require('../../backend/services/tef/tefConfigService');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error && error.stack ? error.stack : error}`);
  }
}

console.log('\n=== TEF-DESTAXA-11 config por PDV (estático) ===\n');

test('ESCOPO documentado = instalacao (não por PDV/caixa)', () => {
  const escopo = tefConfigService.ESCOPO_CONFIGURACAO_TEF;
  assert.strictEqual(escopo.nivel, 'instalacao');
  assert.ok(/LIMIT 1/i.test(escopo.descricao));
  assert.ok(/não isolamento por caixa/i.test(escopo.caixa));
});

test('repositório busca singleton + um pinpad por config (LIMIT 1)', () => {
  const repoPath = path.join(__dirname, '../../backend/repositories/tefConfigRepository.js');
  const src = fs.readFileSync(repoPath, 'utf8');
  assert.ok(/ORDER BY id ASC\s*\n\s*LIMIT 1/.test(src) || /ORDER BY id ASC[\s\S]{0,40}LIMIT 1/.test(src));
  assert.ok(src.includes('buscarPinpadPorConfigId'));
  assert.ok(/FROM tef_pinpads[\s\S]{0,120}LIMIT 1/.test(src));
});

test('schema pinpad sem FK pdv/caixa; config tem strings pdv/caixa', () => {
  const dbPath = path.join(__dirname, '../../backend/database.js');
  const src = fs.readFileSync(dbPath, 'utf8');
  const pinCreate = src.match(/CREATE TABLE IF NOT EXISTS tef_pinpads \(([\s\S]*?)\)/);
  assert.ok(pinCreate, 'CREATE tef_pinpads');
  assert.ok(!/pdv_codigo|caixa_codigo|pdv_id|caixa_id/.test(pinCreate[1]));
  assert.ok(/pdv_codigo/.test(src));
  assert.ok(/caixa_codigo/.test(src));
});

test('POST /tef/pagar não recebe caixa/pdv/porta no contrato da rota', () => {
  const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/tef.js'), 'utf8');
  const pagar = rota.match(/router\.post\('\/pagar'[\s\S]*?^}\);/m);
  assert.ok(pagar, 'bloco pagar');
  assert.ok(/venda_id/.test(pagar[0]));
  assert.ok(/idempotency_key/.test(pagar[0]));
  assert.ok(!/caixa_id|pdv_id|porta_com|portaCom/.test(pagar[0]));
});

test('PDV frontend não envia identidade de caixa/porta no body TEF', () => {
  const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
  const trecho = pdv.match(/async function processarPagamentoTEF[\s\S]*?catch \(error\)/);
  assert.ok(trecho);
  assert.ok(/\/tef\/pagar/.test(trecho[0]));
  assert.ok(/tipo:\s*tipoTef/.test(trecho[0]));
  assert.ok(!/caixa_codigo|pdv_codigo|portaCom/.test(trecho[0]));
});

test('Destaxa: pdv/caixa não entram na projeção iniciaClientDestaxa', () => {
  const p = projetarEntradaIniciaClient({
    empresaCodigo: 'E',
    lojaCodigo: 'L',
    terminalCodigo: 'T',
    pdvCodigo: 'PDV-1',
    caixaCodigo: 'CX-2'
  }, { versao: '1.0.3', aplicacao: 'CDS Sistemas' });
  assert.ok(p.texto.includes('estabelecimento=E'));
  assert.ok(p.texto.includes('terminal=T'));
  assert.ok(!p.texto.includes('PDV-1'));
  assert.ok(!p.texto.includes('CX-2'));
  assert.strictEqual(p.incluiPdvOuCaixa, false);
});

console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
process.exit(falhou ? 1 : 0);
