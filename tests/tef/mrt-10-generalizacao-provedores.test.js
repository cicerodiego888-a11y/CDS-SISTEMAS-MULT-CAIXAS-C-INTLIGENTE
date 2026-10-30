'use strict';

/**
 * MRT-10 — Generalização da configuração de provedores TEF (sem INIT/TX/migration).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CAMPOS_MAPEAMENTO_TEF,
  interpretacaoProvedor,
  camposLocaisCds,
  camposProvedor
} = require('../../backend/services/tef/tefProvedorCampos');

const {
  projetarEntradaIniciaClient,
  avaliarMapeamentoTerminal
} = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');

const tefConfigService = require('../../backend/services/tef/tefConfigService');

function test(nome, fn) {
  try {
    fn();
    console.log(`  OK  ${nome}`);
  } catch (err) {
    console.error(`  FAIL ${nome}`);
    throw err;
  }
}

console.log('=== MRT-10 — Generalização provedores TEF ===\n');

const uiSrc = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/configuracao_tef.js'),
  'utf8'
);

test('UI: título Empresa / Mapeamento TEF (sem título exclusivo Destaxa)', () => {
  assert.match(uiSrc, /Empresa \/ Mapeamento TEF/);
  assert.ok(!/Empresa \/ mapeamento Destaxa/i.test(uiSrc));
  assert.ok(!/Empresa \/ Mapeamento Destaxa/i.test(uiSrc));
});

test('UI: labels genéricos do provedor', () => {
  assert.match(uiSrc, /Estabelecimento do provedor/);
  assert.match(uiSrc, /Loja do provedor/);
  assert.match(uiSrc, /Terminal lógico do provedor/);
  assert.ok(!/Estabelecimento Destaxa/.test(uiSrc));
  assert.ok(!/Loja Destaxa/.test(uiSrc));
  assert.ok(!/Terminal lógico Destaxa/.test(uiSrc));
});

test('UI: placeholder genérico + PDV/Caixa CDS locais', () => {
  assert.match(uiSrc, /Somente código oficial do provedor/);
  assert.ok(!/Somente código oficial Destaxa/.test(uiSrc));
  assert.match(uiSrc, /PDV CDS/);
  assert.match(uiSrc, /Caixa CDS/);
  assert.match(uiSrc, /identificadores internos do CDS/);
  assert.match(uiSrc, /não<\/strong> devem ser enviados como identificadores do provedor/);
});

test('contrato genérico separa campos locais × provedor', () => {
  assert.strictEqual(camposLocaisCds().length, 2);
  assert.strictEqual(camposProvedor().length, 3);
  assert.strictEqual(CAMPOS_MAPEAMENTO_TEF.pdvCds.escopo, 'cds_local');
  assert.strictEqual(CAMPOS_MAPEAMENTO_TEF.estabelecimentoProvedor.cds, 'empresa_codigo');
  const d = interpretacaoProvedor('destaxa');
  assert.match(d.empresa_codigo, /estabelecimento/);
  assert.match(d.pdv_codigo, /não enviado/i);
  const s = interpretacaoProvedor('sitef');
  assert.ok(s.nota && /SiTef/i.test(s.nota));
});

test('Destaxa continua recebendo parâmetros via mapeamento (compatibilidade)', () => {
  const entrada = projetarEntradaIniciaClient({
    empresa_codigo: 'EST-1',
    loja_codigo: 'LJ-2',
    terminal_codigo: 'TM-3',
    pdv_codigo: 'PDV-CDS',
    caixa_codigo: 'CX-CDS'
  });
  assert.ok(entrada.texto.includes('estabelecimento=EST-1'));
  assert.ok(entrada.texto.includes('loja=LJ-2'));
  assert.ok(entrada.texto.includes('terminal=TM-3'));
  assert.ok(!entrada.texto.includes('PDV-CDS'));
  assert.ok(!entrada.texto.includes('CX-CDS'));
  assert.strictEqual(entrada.incluiPdvOuCaixa, false);
  assert.strictEqual(entrada.camposDestaxaEnviados.estabelecimento, true);

  const av = avaliarMapeamentoTerminal({
    tefProvedor: 'destaxa',
    empresaCodigo: 'EST-1',
    lojaCodigo: 'LJ-2',
    terminalCodigo: 'TM-3',
    pdvCodigo: 'PDV-CDS'
  }, { provedor: 'destaxa' });
  assert.strictEqual(av.tefProntoParaVenda, false);
});

test('validarConfiguracao Destaxa permanece compatível', () => {
  const r = tefConfigService.validarConfiguracao({
    tefHabilitado: true,
    tefProvedor: 'destaxa',
    tefAmbiente: 'homologacao',
    pinpadHabilitado: true,
    pinpadModelo: 'PPC930',
    pinpadCodigo: 'GERTEC_PPC930',
    tipoConexao: 'serial',
    portaCom: 'COM4',
    empresaCodigo: 'E1',
    lojaCodigo: 'L1',
    terminalCodigo: 'T1'
  }, { modoAdapter: 'real' });
  assert.strictEqual(r.valida, true);
  assert.strictEqual(r.tefProntoParaVenda, false);
  assert.ok(r.mapeamentoDestaxa);
});

test('TefManager / Router / TEF-13 não alterados nesta sprint (estático)', () => {
  const tm = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/TefManager.js'),
    'utf8'
  );
  assert.match(tm, /tefRouterIntegration/);
  assert.match(tm, /idempotency_key/);
  assert.match(tm, /tefLockService\.comLock/);
  const adapter = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
    'utf8'
  );
  assert.ok(!adapter.includes('MRT-10'));
  assert.ok(!adapter.includes('tefProvedorCampos'));
});

test('IDs de formulário e persistência preservados', () => {
  assert.match(uiSrc, /id="empresaCodigo"/);
  assert.match(uiSrc, /id="lojaCodigo"/);
  assert.match(uiSrc, /id="terminalCodigo"/);
  assert.match(uiSrc, /id="pdvCodigo"/);
  assert.match(uiSrc, /id="caixaCodigo"/);
  assert.match(uiSrc, /formTefEmpresa/);
});

console.log('\nMRT-10 testes OK — sem INIT / TX / migration.\n');
