/**
 * TEF-STONE-01 — Bloqueio de aprovação simulada Stone fora de simulacao.
 *
 * Executar: node tests/tef/tef-stone-01-bloqueio-simulacao.test.js
 */
'use strict';

const assert = require('assert');
const tefFactory = require('../../backend/services/tef/tefFactory');
const SimulatedGatewayAdapter = require('../../backend/services/tef/adapters/SimulatedGatewayAdapter');
const {
  StoneUnavailableAdapter,
  CODIGO_INDISPONIVEL
} = require('../../backend/services/tef/adapters/stoneAdapter');
const tefContrato = require('../../backend/services/tef/tefContrato');

let passou = 0;
let falhou = 0;
const resultados = [];

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      resultados.push({ nome, ok: true });
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      resultados.push({ nome, ok: false, erro: error.message });
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function assertSemNsuAut(retorno) {
  assert.strictEqual(retorno.nsu, null, 'NSU fictício não permitido');
  assert.strictEqual(retorno.autorizacao, null, 'AUT fictício não permitido');
  assert.strictEqual(tefContrato.estaAprovado(retorno), false, 'indisponível não pode ser aprovação');
  assert.notStrictEqual(retorno.status, tefContrato.STATUS.APROVADO);
  assert.strictEqual(retorno.sucesso, false);
}

async function main() {
  console.log('\n=== TEF-STONE-01 Bloqueio simulação Stone ===\n');

  await test('Stone + simulacao → SimulatedGatewayAdapter e aprova com NSU/AUT', async () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'stone', ambiente: 'simulacao' });
    assert.ok(adapter instanceof SimulatedGatewayAdapter);
    assert.strictEqual(adapter.modo, 'simulacao');
    assert.strictEqual(adapter.nome, 'Stone');

    const retorno = await adapter.autorizarPagamento({ valor: 12.34, tipo: 'credito' });
    assert.strictEqual(tefContrato.estaAprovado(retorno), true);
    assert.ok(retorno.nsu && String(retorno.nsu).startsWith('NSU'));
    assert.ok(retorno.autorizacao && String(retorno.autorizacao).startsWith('AUT'));
    assert.strictEqual(retorno.modo, 'simulacao');
  });

  await test('Stone + homologacao → indisponível, sem NSU/AUT/aprovação', async () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'stone', ambiente: 'homologacao' });
    assert.ok(adapter instanceof StoneUnavailableAdapter);
    assert.strictEqual(adapter.modo, 'indisponivel');

    const prep = await adapter.prepararAutorizacao({ valor: 10, tipo: 'debito' });
    assert.strictEqual(prep.pronto, false);
    assertSemNsuAut(prep.resposta);
    assert.strictEqual(prep.resposta.codigo, CODIGO_INDISPONIVEL);

    const retorno = await adapter.autorizarPagamento({ valor: 10, tipo: 'debito' });
    assertSemNsuAut(retorno);
    assert.strictEqual(retorno.codigo, CODIGO_INDISPONIVEL);
    assert.strictEqual(retorno.modo, 'indisponivel');
  });

  await test('Stone + producao → indisponível, sem NSU/AUT/aprovação', async () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'stone', ambiente: 'producao' });
    assert.ok(adapter instanceof StoneUnavailableAdapter);

    const retorno = await adapter.autorizarPagamento({ valor: 99.9, tipo: 'credito' });
    assertSemNsuAut(retorno);
    assert.strictEqual(retorno.codigo, CODIGO_INDISPONIVEL);
  });

  await test('Stone + produção (acento) → indisponível', async () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'stone', ambiente: 'produção' });
    assert.ok(adapter instanceof StoneUnavailableAdapter);
    const retorno = await adapter.autorizarPagamento({ valor: 1, tipo: 'debito' });
    assertSemNsuAut(retorno);
  });

  await test('Stone sem ambiente explícito → não simula (erro explícito)', () => {
    assert.throws(
      () => tefFactory.criarAdapter({ provedor: 'stone' }),
      (err) => err && err.codigo === 'STONE_AMBIENTE_INVALIDO'
    );
  });

  await test('Resultado indisponível não vira aprovação via tefContrato', async () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'stone', ambiente: 'homologacao' });
    const retorno = await adapter.autorizarPagamento({ valor: 5, tipo: 'pix' });
    const normalizado = tefContrato.criarRespostaAutorizacao(retorno);
    assert.strictEqual(tefContrato.estaAprovado(normalizado), false);
    assert.strictEqual(tefContrato.estaAprovado({ ...retorno, sucesso: true }), false);
    assert.strictEqual(normalizado.nsu, null);
    assert.strictEqual(normalizado.autorizacao, null);
  });

  await test('Outros provedores inalterados (cielo/rede/getnet ainda simulam)', async () => {
    for (const provedor of ['cielo', 'rede', 'getnet']) {
      const adapter = tefFactory.criarAdapter({ provedor, ambiente: 'homologacao' });
      assert.ok(adapter instanceof SimulatedGatewayAdapter, `${provedor} deveria continuar simulado`);
      assert.strictEqual(adapter.modo, 'simulacao');
      const retorno = await adapter.autorizarPagamento({ valor: 1, tipo: 'credito' });
      assert.strictEqual(tefContrato.estaAprovado(retorno), true);
      assert.ok(retorno.nsu);
    }
  });

  await test('Destaxa simulacao preservada; sitef simulacao preservado', () => {
    const destaxa = tefFactory.criarAdapter({ provedor: 'destaxa', ambiente: 'simulacao' });
    assert.strictEqual(destaxa.modo, 'simulacao');
    assert.strictEqual(destaxa.nome, 'Destaxa');

    const sitef = tefFactory.criarAdapter({ provedor: 'sitef', ambiente: 'simulacao' });
    assert.strictEqual(sitef.modo, 'simulacao');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.stdout.write(`TEF_STONE_01_SUMMARY=${JSON.stringify({ passou, falhou, resultados })}\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
