'use strict';

/**
 * MRT-11 — Auditoria de isolamento/extensibilidade (diagnóstico; sem PayGo/SiTef real/INIT/TX).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CAMPOS_MAPEAMENTO_TEF,
  INTERPRETACAO_POR_PROVEDOR,
  interpretacaoProvedor,
  camposLocaisCds,
  camposProvedor
} = require('../../backend/services/tef/tefProvedorCampos');

const {
  criarAdapter,
  provedorReconhecido,
  PROVEDORES
} = require('../../backend/services/tef/tefFactory');

const { politicaIsolamento } = require('../../backend/services/tef/terminalAllocator/contracts');
const { matrizProvedor, TOPOLOGIES } = require('../../backend/services/tef/executionContext/contracts');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');

const {
  criarTerminalRegistry,
  resetTerminalRegistryParaTestes,
  TERMINAL_STATES,
  REGISTRY_CODES
} = require('../../backend/services/tef/terminalRegistry');

function test(nome, fn) {
  const ret = fn();
  if (ret && typeof ret.then === 'function') {
    return ret.then(() => console.log(`  OK  ${nome}`)).catch((err) => {
      console.error(`  FAIL ${nome}`);
      throw err;
    });
  }
  console.log(`  OK  ${nome}`);
  return Promise.resolve();
}

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

console.log('=== MRT-11 — Isolamento e extensibilidade TEF ===\n');

(async () => {
  await test('contrato: provedor identificado + campos genéricos + interpretação isolada', () => {
    assert.ok(PROVEDORES.includes('destaxa'));
    assert.ok(PROVEDORES.includes('sitef'));
    assert.ok(PROVEDORES.includes('paygo'));
    assert.strictEqual(provedorReconhecido('paygo'), true);
    assert.strictEqual(provedorReconhecido('xyz'), false);

    assert.strictEqual(camposProvedor().length, 3);
    assert.strictEqual(camposLocaisCds().length, 2);
    assert.strictEqual(CAMPOS_MAPEAMENTO_TEF.pdvCds.escopo, 'cds_local');

    const d = interpretacaoProvedor('destaxa');
    assert.ok(d.modulo && d.modulo.includes('destaxaMapeamentoTerminal'));
    assert.strictEqual(interpretacaoProvedor('sitef').modulo, null);
    assert.strictEqual(interpretacaoProvedor('paygo').modulo, null);
    assert.match(interpretacaoProvedor('novo_provedor').nota, /Sem mapeamento/i);
  });

  await test('parâmetros ausentes/desconhecidos: Destaxa não recebe pdv/caixa; não inventa códigos', () => {
    const vazio = projetarEntradaIniciaClient({});
    assert.ok(vazio.texto.includes('aplicacao='));
    assert.ok(!vazio.texto.includes('estabelecimento='));
    assert.strictEqual(vazio.incluiPdvOuCaixa, false);

    const comLocais = projetarEntradaIniciaClient({
      pdv_codigo: 'PDV-X',
      caixa_codigo: 'CX-Y',
      campo_desconhecido: 'IGNORAR'
    });
    assert.ok(!comLocais.texto.includes('PDV-X'));
    assert.ok(!comLocais.texto.includes('IGNORAR'));
  });

  await test('seleção de adapter extensível por registro.provedor (simulação; sem INIT)', () => {
    assert.ok(criarAdapter({ provedor: 'destaxa', ambiente: 'simulacao' }));
    assert.ok(criarAdapter({ provedor: 'sitef', ambiente: 'simulacao' }));
    assert.ok(criarAdapter({ provedor: 'paygo', ambiente: 'simulacao' }));
    assert.throws(
      () => criarAdapter({ provedor: 'provedor_inexistente_xyz', ambiente: 'simulacao' }),
      /não suportado/i
    );
    assert.throws(
      () => criarAdapter({ provedor: '', ambiente: 'simulacao' }),
      /não configurado/i
    );
  });

  await test('Allocator/ExecutionContext: política por provedor sem campos financeiros Destaxa', () => {
    assert.strictEqual(politicaIsolamento('destaxa').modo, 'GLOBAL_SERIALIZE');
    assert.strictEqual(politicaIsolamento('sitef').modo, 'PER_TERMINAL');
    assert.strictEqual(politicaIsolamento('paygo').modo, 'PER_TERMINAL');
    assert.ok(politicaIsolamento('destaxa').runtimeKey);
    assert.strictEqual(politicaIsolamento('sitef').runtimeKey, null);

    const mD = matrizProvedor('destaxa');
    const mS = matrizProvedor('sitef');
    assert.strictEqual(mD.runtimeSingleton, true);
    assert.strictEqual(mS.runtimeSingleton, false);
    assert.strictEqual(mD.topologias[TOPOLOGIES.MULTI_ESTACAO].suportado, false);
  });

  await test('TefManager/Router core sem dependência de campos exclusivos Destaxa', () => {
    const tm = ler('backend/services/tef/TefManager.js');
    assert.ok(!tm.includes('iniciaClientDestaxa'));
    assert.ok(!tm.includes('empresa_codigo'));
    assert.ok(!tm.includes('destaxaMapeamentoTerminal'));
    assert.match(tm, /obterAdapter/);
    assert.match(tm, /tefRouterIntegration/);

    const router = ler('backend/services/tef/terminalRouter/TerminalRouter.js');
    assert.ok(!router.includes('estabelecimento'));
    assert.ok(!router.includes('iniciaClientDestaxa'));
    assert.ok(!router.includes('00151'));
  });

  await test('configuração Destaxa não redefine interpretação SiTef/PayGo (contrato)', () => {
    assert.notDeepStrictEqual(
      INTERPRETACAO_POR_PROVEDOR.destaxa,
      INTERPRETACAO_POR_PROVEDOR.sitef
    );
    assert.notDeepStrictEqual(
      INTERPRETACAO_POR_PROVEDOR.destaxa,
      INTERPRETACAO_POR_PROVEDOR.paygo
    );
  });

  await test('Registry: terminais de provedores distintos + ambiguidade sem seleção arbitrária', async () => {
    resetTerminalRegistryParaTestes();
    const registry = criarTerminalRegistry();
    registry.registrar({
      id: 't-destaxa',
      pdvId: '1',
      provedor: 'destaxa',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.ATIVO,
      codigoLogicoProvedor: 'DX-1'
    });
    registry.registrar({
      id: 't-sitef',
      pdvId: '1',
      provedor: 'sitef',
      ambiente: 'homologacao',
      estado: TERMINAL_STATES.ATIVO,
      codigoLogicoProvedor: 'SF-1'
    });

    const amb = await registry.resolverPorPdv({ pdvId: '1' });
    assert.strictEqual(amb.codigo, REGISTRY_CODES.TERMINAL_AMBIGUO);

    const sitef = await registry.resolverPorPdv({ pdvId: '1', provedorPreferido: 'sitef' });
    assert.strictEqual(sitef.ok, true);
    assert.strictEqual(sitef.terminal.provedor, 'sitef');

    const factorySrc = ler('backend/services/tef/tefFactory.js');
    assert.match(factorySrc, /buscarConfiguracaoPrincipal/);
    resetTerminalRegistryParaTestes();
  });

  await test('ausência de configuração de provedor: factory falha explícita', () => {
    assert.throws(() => criarAdapter(null), /não configurado/i);
  });

  await test('regressão MRT-10: UI genérica preservada (estático)', () => {
    const ui = ler('frontend/erp/js/configuracao_tef.js');
    assert.match(ui, /Empresa \/ Mapeamento TEF/);
    assert.match(ui, /Estabelecimento do provedor/);
    assert.ok(!/Estabelecimento Destaxa/.test(ui));
  });

  console.log('\nMRT-11 testes OK — diagnóstico sem INIT / TX / implementação PayGo-SiTef.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
