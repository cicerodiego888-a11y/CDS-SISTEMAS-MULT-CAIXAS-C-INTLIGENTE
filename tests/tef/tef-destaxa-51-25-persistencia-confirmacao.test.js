'use strict';

/**
 * TEF-DESTAXA-51.25 — persistência de evidências 00 antes de FINALIZE(0).
 * Mocks apenas. Sem DLL, NativeHost, V$Pague, COM4, PinPad ou TX real.
 * Não toca tef_transacoes.id=1 nem banco oficial.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  executarCicloCrt,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const {
  TIPOS_ACAO,
  FINALIZACAO_CONFIRMAR,
  inspecionarGateFinanceiro,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  extrairEvidenciasRetorno00,
  classificarRetornoA1,
  parseParametrosDestaxa
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');

const ROOT = path.resolve(__dirname, '..', '..');
const HASH_5120 = 'F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C';

const SAIDA_00 = [
  'transacao_nsu=998877',
  'transacao_autorizacao=AUTH55',
  'transacao_comprovante_1via=VIA CLIENTE 51.25',
  'transacao_comprovante_2via=VIA LOJA 51.25',
  'transacao_valor=1.00',
  'transacao_tipo_cartao=Debito'
].join(';');

let passou = 0;
let falhou = 0;

async function test(nome, fn) {
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function saida00(overrides = {}) {
  return {
    sucesso: true,
    codigoDestaxa: '00',
    requerContinuacao: false,
    financialState: 'CONFIRMED_SUCCESS',
    classificacao: 'SUCCESS',
    saida: SAIDA_00,
    contexto: { transactionId: 'tx-5125' },
    ...overrides
  };
}

function criarBridgeMock({ passos = [], onFinalize = null } = {}) {
  let n = 0;
  const continues = [];
  const finalizes = [];
  return {
    continues,
    finalizes,
    async iniciarTransacaoDestaxa() {
      return passos[n++] || {
        sucesso: false,
        codigoDestaxa: '99',
        requerContinuacao: true,
        financialState: 'PENDING',
        acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'Insira o cartao' }
      };
    },
    async continuarTransacaoDestaxa(resposta) {
      continues.push(resposta);
      return passos[n++] || saida00();
    },
    async finalizarTransacaoDestaxa(confirmacao) {
      finalizes.push(confirmacao);
      if (typeof onFinalize === 'function') return onFinalize(confirmacao);
      return { sucesso: true, codigoDestaxa: '00', financialState: 'CONFIRMED_SUCCESS' };
    }
  };
}

function mockPersistirContinue(transactionId) {
  return async ({ resposta, solicitadaEm }) => ({
    ok: true,
    duravel: true,
    confirmada: true,
    transactionId: String(transactionId),
    solicitadaEm,
    estadoDespacho: 'INICIADO',
    despachoId: `despacho-5125-${Date.now()}`,
    fingerprint: 'fp-mock-5125-bbbbbbbbbbbbbbbbbbbbbbbb',
    resposta,
    identidade: {
      transactionId: String(transactionId),
      operation_id: 'op-mock-5125',
      idempotency_key: 'idem-mock-5125',
      fingerprint: 'fp-mock-5125-bbbbbbbbbbbbbbbbbbbbbbbb'
    }
  });
}

function mockPersistirEvidencias(transactionId, { falhar = false, parcial = false } = {}) {
  const chamadas = [];
  const fn = async ({ evidencias, transactionId: tx }) => {
    chamadas.push({ evidencias, transactionId: tx });
    if (falhar) {
      return {
        ok: false,
        confirmada: false,
        duravel: false,
        codigo: 'TEF_EVIDENCIAS_PERSISTENCIA_FALHOU',
        mensagem: 'falha simulada',
        evidencias,
        transactionId: String(transactionId)
      };
    }
    if (parcial || evidencias?.completa !== true) {
      return {
        ok: false,
        confirmada: false,
        duravel: false,
        codigo: 'TEF_EVIDENCIAS_00_INCOMPLETAS',
        mensagem: 'parcial',
        evidencias,
        transactionId: String(transactionId)
      };
    }
    return {
      ok: true,
      confirmada: true,
      duravel: true,
      transactionId: String(transactionId),
      evidencias,
      codigo: 'TEF_EVIDENCIAS_00_PERSISTIDAS'
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

function ordemPassos(ciclo) {
  return (ciclo.ciclo?.passos || []).map((p) => p.passo);
}

async function main() {
  console.log('\nTEF-DESTAXA-51.25 — persistência evidências antes FINALIZE(0)\n');

  await test('0) gate OFF e hash 51.20 preservado', async () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
    assert.strictEqual(inspecionarGateFinanceiro().habilitado, false);
    const hash = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(ROOT, 'backend/services/tef/TefManager.js')))
      .digest('hex')
      .toUpperCase();
    assert.strictEqual(hash, HASH_5120);
  });

  await test('1) START 99 → CONTINUE executado', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'Aguarde' }
        },
        saida00()
      ]
    });
    const persistEv = mockPersistirEvidencias('tx-5125-1');
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-1',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-1'),
      persistirEvidenciasAntesFinalize: persistEv
    });
    assert.strictEqual(bridge.continues.length, 1);
    assert.ok(ciclo.sucesso === true);
  });

  await test('2) CONTINUE 99 → novo CONTINUE', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: '1' }
        },
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: '2' }
        },
        saida00()
      ]
    });
    await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-2',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-2'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-2')
    });
    assert.strictEqual(bridge.continues.length, 2);
  });

  await test('3-6) retorno 00 extrai NSU/autorização/comprovantes', async () => {
    const evid = extrairEvidenciasRetorno00({ saida: SAIDA_00 });
    assert.strictEqual(evid.nsu, '998877');
    assert.strictEqual(evid.autorizacao, 'AUTH55');
    assert.strictEqual(evid.comprovanteCliente, 'VIA CLIENTE 51.25');
    assert.strictEqual(evid.comprovanteLoja, 'VIA LOJA 51.25');
    assert.strictEqual(evid.transacao_nsu, '998877');
    assert.strictEqual(evid.completa, true);
    const p = parseParametrosDestaxa(SAIDA_00);
    assert.strictEqual(p.transacao_autorizacao, 'AUTH55');
  });

  await test('7) persistência OK → FINALIZE(0) permitido e ordem correta', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'ok' }
        },
        saida00()
      ]
    });
    const persistEv = mockPersistirEvidencias('tx-5125-7');
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-7',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-7'),
      persistirEvidenciasAntesFinalize: persistEv
    });
    const ordem = ordemPassos(ciclo);
    const iRecv = ordem.indexOf('RECEBER_00');
    const iExt = ordem.indexOf('EXTRAIR_EVIDENCIAS');
    const iPers = ordem.indexOf('PERSISTIR_EVIDENCIAS');
    const iConf = ordem.indexOf('CONFIRMAR_PERSISTENCIA');
    const iFin = ordem.indexOf('TX_FINALIZE');
    const iFinR = ordem.indexOf('TX_FINALIZE_RESULT');
    const iFinal = ordem.indexOf('PERSISTIR_RESULTADO_FINAL');
    assert.ok(iRecv < iExt && iExt < iPers && iPers < iConf && iConf < iFin);
    assert.ok(iFin < iFinR && iFinR < iFinal);
    assert.deepStrictEqual(bridge.finalizes, [FINALIZACAO_CONFIRMAR]);
    assert.strictEqual(persistEv.chamadas.length, 1);
    assert.strictEqual(ciclo.evidencias.nsu, '998877');
    assert.strictEqual(ciclo.resultadoInicio.saida, SAIDA_00);
    assert.strictEqual(ciclo.finalizeExecutado, true);
    assert.strictEqual(ciclo.sucesso, true);
  });

  await test('8) persistência falha → FINALIZE(0) NÃO executado', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-8',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-8'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-8', { falhar: true })
    });
    assert.strictEqual(bridge.finalizes.length, 0);
    assert.strictEqual(ciclo.finalizeExecutado, false);
    assert.strictEqual(ciclo.sucesso, false);
    assert.strictEqual(ciclo.inconclusivo, true);
    assert.strictEqual(ciclo.codigo, 'TEF_EVIDENCIAS_PERSISTENCIA_FALHOU');
    assert.strictEqual(ciclo.evidencias.nsu, '998877');
  });

  await test('9) persistência parcial (sem NSU) → não concluir / sem FINALIZE', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00({ saida: 'transacao_autorizacao=SO_AUTH;mensagem=sem nsu' })
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-9',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-9'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-9')
    });
    assert.strictEqual(bridge.finalizes.length, 0);
    assert.strictEqual(ciclo.finalizeExecutado, false);
    assert.strictEqual(ciclo.codigo, CICLO_ERROS.EVIDENCIAS_NAO_PERSISTIDAS);
  });

  await test('10) FINALIZE(0) confirmado → confirmação registrada', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-10',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-10'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-10')
    });
    assert.strictEqual(ciclo.confirmacao, 0);
    assert.strictEqual(ciclo.sucesso, true);
    assert.ok(ordemPassos(ciclo).includes('TX_FINALIZE_RESULT'));
  });

  await test('11) FINALIZE(0) retorna erro → inconclusivo com evidências', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ],
      onFinalize: () => ({
        sucesso: false,
        codigoDestaxa: 'FE',
        financialState: 'UNKNOWN',
        classificacao: 'ERROR',
        mensagem: 'erro finalize'
      })
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-11',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-11'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-11')
    });
    assert.strictEqual(bridge.finalizes.length, 1);
    assert.strictEqual(ciclo.sucesso, false);
    assert.strictEqual(ciclo.inconclusivo, true);
    assert.strictEqual(ciclo.evidencias.nsu, '998877');
    assert.strictEqual(ciclo.resultadoInicio.saida, SAIDA_00);
  });

  await test('12) FINALIZE(0) timeout → UNKNOWN/inconclusivo', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ],
      onFinalize: () => ({
        sucesso: false,
        codigoDestaxa: '08',
        financialState: 'UNKNOWN',
        classificacao: 'TIMEOUT',
        estado: 'TIMEOUT'
      })
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-12',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-12'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-12')
    });
    assert.strictEqual(ciclo.inconclusivo, true);
    assert.strictEqual(ciclo.financialState, 'UNKNOWN');
    assert.strictEqual(ciclo.evidencias.nsu, '998877');
    assert.strictEqual(ciclo.finalizeExecutado, true);
  });

  await test('13) FINALIZE sem comprovante na resposta → dados 00 preservados', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ],
      onFinalize: () => ({
        sucesso: true,
        codigoDestaxa: '00',
        saida: '',
        financialState: 'CONFIRMED_SUCCESS'
      })
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-13',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-13'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-13')
    });
    assert.strictEqual(ciclo.resultadoUltimo.saida, '');
    assert.strictEqual(ciclo.evidencias.comprovanteCliente, 'VIA CLIENTE 51.25');
    assert.strictEqual(ciclo.resultadoInicio.saida, SAIDA_00);
  });

  await test('14) A1 no Client init — bloqueio sem finalização automática', async () => {
    const a1 = classificarRetornoA1('iniciaClientDestaxa');
    assert.strictEqual(a1.codigo, 'A1');
    assert.strictEqual(a1.origemApi, 'iniciaClientDestaxa');
    assert.strictEqual(a1.finalizacaoAutomatica, false);
    assert.strictEqual(a1.financialState, 'BLOCKED');
    const bridgeSrc = fs.readFileSync(
      path.join(ROOT, 'backend/services/tef/destaxa/DestaxaNativeBridge.js'),
      'utf8'
    );
    assert.ok(bridgeSrc.includes("classificarRetornoA1('iniciaClientDestaxa'"));
    assert.ok(bridgeSrc.includes('finalizacaoAutomaticaA1: false'));
  });

  await test('15) A1 no START — bloqueio sem FINALIZE', async () => {
    const bridge = criarBridgeMock({
      passos: [{
        sucesso: false,
        codigoDestaxa: 'A1',
        financialState: 'BLOCKED',
        classificacao: 'BLOCKED'
      }]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-15',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-15'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-15')
    });
    assert.strictEqual(bridge.finalizes.length, 0);
    assert.strictEqual(ciclo.bloqueadoA1, true);
    assert.strictEqual(ciclo.codigoDestaxa, 'A1');
    assert.strictEqual(ciclo.a1.origemApi, 'iniciaTransacaoDestaxa');
    assert.strictEqual(ciclo.a1.finalizacaoAutomatica, false);
  });

  await test('16) requisição duplicada de evidências — idempotente sem 2º FINALIZE indevido', async () => {
    let persistCalls = 0;
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-16',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-16'),
      persistirEvidenciasAntesFinalize: async ({ evidencias, transactionId }) => {
        persistCalls += 1;
        return {
          ok: true,
          confirmada: true,
          duravel: true,
          idempotente: persistCalls > 1,
          transactionId,
          evidencias
        };
      }
    });
    assert.strictEqual(persistCalls, 1);
    assert.strictEqual(bridge.finalizes.length, 1);
    assert.strictEqual(ciclo.sucesso, true);
  });

  await test('17) associação ao transactionId correto', async () => {
    const persistEv = mockPersistirEvidencias('tx-5125-17');
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00({ contexto: { transactionId: 'tx-5125-17' } })
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-17',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-17'),
      persistirEvidenciasAntesFinalize: persistEv
    });
    assert.strictEqual(persistEv.chamadas[0].transactionId, 'tx-5125-17');
    assert.strictEqual(ciclo.transactionId, 'tx-5125-17');
  });

  await test('18) encerramento/inconclusivo após evidências — dados preservados', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ],
      onFinalize: () => ({
        sucesso: false,
        codigoDestaxa: '08',
        financialState: 'UNKNOWN',
        classificacao: 'TIMEOUT',
        estado: 'TIMEOUT'
      })
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-18',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-18'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-18')
    });
    assert.ok(ciclo.evidenciasPersistidas === true || ciclo.evidencias?.nsu === '998877');
    assert.strictEqual(ciclo.resultadoInicio.saida.includes('transacao_nsu=998877'), true);
    assert.strictEqual(ciclo.reconciliacaoObrigatoria, true);
  });

  await test('19) FINALIZE nunca ocorre antes de CONFIRMAR_PERSISTENCIA', async () => {
    const bridge = criarBridgeMock({
      passos: [
        {
          sucesso: false,
          codigoDestaxa: '99',
          requerContinuacao: true,
          financialState: 'PENDING',
          acao: { tipo: TIPOS_ACAO.DISPLAY, mensagem: 'x' }
        },
        saida00()
      ]
    });
    const ciclo = await executarCicloCrt({
      bridge,
      operacao: 'CRT',
      transactionId: 'tx-5125-19',
      exigirEvidenciasAntesFinalize: true,
      persistirRespostaAntesContinue: mockPersistirContinue('tx-5125-19'),
      persistirEvidenciasAntesFinalize: mockPersistirEvidencias('tx-5125-19')
    });
    const ordem = ordemPassos(ciclo);
    assert.ok(ordem.indexOf('CONFIRMAR_PERSISTENCIA') < ordem.indexOf('TX_FINALIZE'));
  });

  await test('20) adapter mapeia resultadoInicio (fonte estática)', async () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/services/tef/adapters/DestaxaRealAdapter.js'),
      'utf8'
    );
    assert.ok(src.includes('ciclo.resultadoInicio || resultadoFonte'));
    assert.ok(src.includes('_persistirEvidenciasRetorno00'));
    assert.ok(src.includes('exigirEvidenciasAntesFinalize: true'));
  });

  console.log(`\nResultado: ${passou} ok / ${falhou} falhas\n`);
  if (falhou > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
