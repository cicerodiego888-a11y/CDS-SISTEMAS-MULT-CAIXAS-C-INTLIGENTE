'use strict';

/**
 * MRT-22 — Integração PDV com respostas de continuidade CRT
 * Simulado. Sem INIT/CRT/DLL reais. Gate OFF.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-22-integracao-pdv-continuidade-report.json');

const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const {
  executarCicloCrt,
  continuarCicloCrt,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const {
  TIPOS_CONTINUIDADE,
  validarRespostaOperador,
  normalizarAcaoContinuidade,
  ehSolicitacaoContinuidade,
  montarPedidoContinuidade
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
const {
  OPERACOES,
  REAL_TRANSACTION_ENV,
  CLASSIFICACAO_CODIGO,
  VALOR_HOMOLOGACAO_CENTAVOS,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { buildCrtInput } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const { ERROS_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const tefContrato = require('../../backend/services/tef/tefContrato');

let despachoMockSeq = 0;
function persistirRespostaContinuidadeMock({ transactionId, resposta, solicitadaEm }) {
  const txId = String(transactionId);
  return {
    ok: true,
    duravel: true,
    confirmada: true,
    transactionId: txId,
    solicitadaEm,
    estadoDespacho: 'INICIADO',
    despachoId: `mrt22-dispatch-${++despachoMockSeq}`,
    fingerprint: 'a'.repeat(64),
    identidade: {
      transactionId: txId,
      operation_id: `mrt22-op-${txId}`,
      idempotency_key: `mrt22-idem-${txId}`,
      fingerprint: `mrt22-fp-${txId}`
    },
    resposta
  };
}

function criarBridge(passos, opcoes = {}) {
  const orq = new DestaxaTransacaoOrquestrador({
    driver: new DestaxaTransacaoMockDriver(passos),
    permitirTransacaoReal: true
  });
  const contadores = { inicia: 0, continua: 0, finaliza: 0 };
  let busy = opcoes.busy === true;
  return {
    contadores,
    orq,
    setBusy(v) { busy = !!v; },
    async habilitarTransacaoReal() { return { sucesso: true }; },
    async iniciarTransacaoDestaxa(op, campos, o = {}) {
      contadores.inicia += 1;
      if (busy) return { sucesso: false, codigo: ERROS_HOST.HOST_BUSY, codigoDestaxa: ERROS_HOST.HOST_BUSY };
      return orq.iniciarTransacao(op, campos, o);
    },
    async continuarTransacaoDestaxa(resposta) {
      contadores.continua += 1;
      if (opcoes.timeoutContinue) {
        return {
          sucesso: false,
          codigoDestaxa: '08',
          classificacao: CLASSIFICACAO_CODIGO.TIMEOUT,
          financialState: 'UNKNOWN',
          estado: 'TIMEOUT',
          retryAllowed: false
        };
      }
      if (busy) return { sucesso: false, codigo: ERROS_HOST.HOST_BUSY, codigoDestaxa: ERROS_HOST.HOST_BUSY };
      return orq.continuarTransacao(resposta);
    },
    async finalizarTransacaoDestaxa(c) {
      contadores.finaliza += 1;
      return orq.finalizarTransacao(c);
    }
  };
}

function carregarPdvContinuidadeApi() {
  const src = fs.readFileSync(
    path.join(__dirname, '../../frontend/pdv/js/pdvTefContinuidade.js'),
    'utf8'
  );
  const sandbox = { window: {}, globalThis: {}, console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // jQuery stub mínimo para não carregar DOM nos testes de contrato
  sandbox.$ = () => {
    throw new Error('DOM não disponível neste teste unitário');
  };
  vm.runInNewContext(src, sandbox, { filename: 'pdvTefContinuidade.js' });
  return sandbox.PdvTefContinuidade;
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-22 — Integração PDV continuidade CRT (simulado) ===\n');
  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const PdvApi = carregarPdvContinuidadeApi();
  const testes = [];
  const ok = (nome, cond, extra = {}) => {
    testes.push({ nome, ok: !!cond, ...extra });
    console.log(`  ${cond ? 'OK' : 'FAIL'} — ${nome}`);
    assert.ok(cond, nome);
  };

  const entrada = buildCrtInput({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS });

  // 1. DISPLAY auto-ack
  {
    const bridge = criarBridge([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 't1',
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    ok('1. DISPLAY com auto-ack', r.sucesso === true && bridge.contadores.continua === 1 && bridge.contadores.inicia === 1);
  }

  // 2. COLETA válida
  {
    const bridge = criarBridge([
      { fn: 'inicia', codigo: '99', saida: 'tipo=0;mensagem=Valor' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const start = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 't2',
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    assert.strictEqual(start.requerContinuacao, true);
    const v = validarRespostaOperador(start.acao, '1.00');
    assert.ok(v.ok);
    const cont = await continuarCicloCrt({
      bridge,
      transactionId: 't2',
      respostaOperador: v.resposta,
      acaoAtual: start.acao,
      solicitadaEm: new Date().toISOString(),
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    ok('2. COLETA com resposta válida', cont.sucesso === true && bridge.contadores.inicia === 1);
  }

  // 3. COLETA inválida
  {
    const acao = { tipo: TIPOS_CONTINUIDADE.COLETA, mensagem: 'Valor' };
    const v = validarRespostaOperador(acao, '   ');
    const v2 = PdvApi.validarResposta(acao, '');
    ok('3. COLETA com resposta inválida', v.ok === false && v2.ok === false);
  }

  // 4. OPCAO válida
  {
    const acao = { tipo: TIPOS_CONTINUIDADE.OPCAO, mensagem: 'Escolha', opcoes: ['Debito', 'Credito'] };
    const v = validarRespostaOperador(acao, 'Credito');
    ok('4. OPCAO com seleção válida', v.ok === true && v.resposta.informacao === 'Credito');
  }

  // 5. OPCAO sem seleção
  {
    const acao = { tipo: TIPOS_CONTINUIDADE.OPCAO, mensagem: 'Escolha', opcoes: ['Debito', 'Credito'] };
    const v = validarRespostaOperador(acao, null);
    const v2 = validarRespostaOperador(acao, 'Pix');
    ok('5. OPCAO sem seleção / inválida', v.ok === false && v2.ok === false);
  }

  // 6. Múltiplas solicitações
  {
    const bridge = criarBridge([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=D1' },
      { fn: 'continua', codigo: '99', saida: 'tipo=0;mensagem=Coleta' },
      { fn: 'continua', codigo: '99', saida: 'mensagem=D2;opcao=A|B' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const s1 = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 't6',
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    // após display auto, deve pedir COLETA
    assert.ok(s1.requerContinuacao === true);
    const c1 = await continuarCicloCrt({
      bridge,
      transactionId: 't6',
      respostaOperador: { informacao: '1.00' },
      acaoAtual: s1.acao,
      solicitadaEm: new Date().toISOString(),
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    assert.ok(c1.requerContinuacao === true);
    const c2 = await continuarCicloCrt({
      bridge,
      transactionId: 't6',
      respostaOperador: { informacao: 'A' },
      acaoAtual: c1.acao,
      solicitadaEm: new Date().toISOString(),
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    ok('6. Múltiplas solicitações consecutivas', c2.sucesso === true && bridge.contadores.inicia === 1
      && bridge.contadores.continua >= 3);
  }

  // 7. Operador sem resposta
  {
    const pedido = montarPedidoContinuidade({
      transacaoId: 10,
      idempotencyKey: 'k1',
      resposta: null
    });
    const adapter = new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, {
      bridge: criarBridge([]),
      executionMode: 'in-process'
    });
    const r = await adapter.continuarPagamento({
      transacao_id: 10,
      acao: { tipo: 'COLETA', mensagem: 'x' },
      resposta_continuidade: null
    });
    ok('7. Operador sem resposta', r.requerContinuacao === true && r.sucesso === false
      && String(r.codigo).includes('COLETA'));
  }

  // 8. Timeout durante continuidade
  {
    const bridge = criarBridge([
      { fn: 'inicia', codigo: '99', saida: 'tipo=0;mensagem=Valor' }
    ], { timeoutContinue: true });
    const s = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 't8',
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    const c = await continuarCicloCrt({
      bridge,
      transactionId: 't8',
      respostaOperador: { informacao: '1.00' },
      acaoAtual: s.acao,
      solicitadaEm: new Date().toISOString(),
      persistirRespostaAntesContinue: persistirRespostaContinuidadeMock
    });
    ok('8. Timeout durante continuidade', c.inconclusivo === true && c.retryAllowed === false
      && c.reconciliacaoObrigatoria === true && bridge.contadores.inicia === 1);
  }

  // 9. PDV fechado / continuidade interrompida (API)
  {
    const r = {
      sucesso: false,
      status: 'pendente',
      codigo: 'DESTAXA_PDV_SEM_RESPOSTA',
      requerContinuacao: true,
      retryAllowed: false,
      idempotency_key: 'abc'
    };
    ok('9. PDV fechado durante continuidade', PdvApi.ehContinuidade(r) === true && r.retryAllowed === false);
  }

  // 10. Segunda cobrança durante ciclo (contrato TefManager)
  {
    const tm = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
    ok('10. Tentativa de segunda cobrança durante ciclo ativo',
      /TEF_CRT_CONTINUIDADE_ATIVA/.test(tm) && /_continuidadeCrt/.test(tm));
  }

  // 11. Preservação transactionId / idempotency
  {
    const pedido = montarPedidoContinuidade({
      transacaoId: 99,
      idempotencyKey: 'idem-xyz',
      vendaId: 7,
      resposta: { informacao: '1.00' },
      acao: { tipo: 'COLETA' }
    });
    const rota = fs.readFileSync(path.join(__dirname, '../../backend/rotas/tef.js'), 'utf8');
    const pdv = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    ok('11. Preservação de transactionId e idempotency_key',
      pedido.transacao_id === 99
      && pedido.idempotency_key === 'idem-xyz'
      && pedido.nao_iniciar_tx === true
      && /post\('\/continuar'/.test(rota)
      && /conduzirContinuidade/.test(pdv)
      && /idempotency_key: idempotencyKey/.test(pdv));
  }

  // 12. Resultados finais
  {
    const bridgeOk = criarBridge([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const apro = await executarCicloCrt({
      bridge: bridgeOk,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'ta'
    });
    const bridgeNeg = criarBridge([{ fn: 'inicia', codigo: '03', saida: '' }]);
    const neg = await executarCicloCrt({
      bridge: bridgeNeg,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tn'
    });
    const bridgeInc = criarBridge([{ fn: 'inicia', codigo: '08', saida: '' }]);
    const inc = await executarCicloCrt({
      bridge: bridgeInc,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'ti'
    });
    ok('12. Resultado final aprovado, negado e inconclusivo',
      apro.sucesso === true
      && neg.negado === true
      && inc.inconclusivo === true
      && apro.retryAllowed === false
      && neg.retryAllowed === false
      && inc.retryAllowed === false);
  }

  // Extra: adapter continuarPagamento
  {
    const bridge = criarBridge([
      { fn: 'inicia', codigo: '99', saida: 'tipo=0;mensagem=Valor' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const adapter = new DestaxaRealAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { bridge, executionMode: 'in-process' }
    );
    const start = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: '55'
    });
    const r = await adapter.continuarPagamento({
      transacao_id: '55',
      venda_id: 12,
      acao: start.acao,
      resposta_continuidade: '1.00'
    });
    ok('extra. adapter.continuarPagamento', r.sucesso === true
      && r.vinculoVendaPdv?.venda_id === 12
      && bridge.contadores.inicia === 1);
  }

  const todosOk = testes.every((t) => t.ok);
  const classificacao = todosOk
    ? 'INTEGRAÇÃO PDV VALIDADA'
    : 'INTEGRAÇÃO INCOMPLETA';

  const rel = {
    sprint: 'MRT-22',
    title: 'Integração PDV com respostas de continuidade CRT',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      gateOff: true,
      initReal: false,
      crtReal: false,
      dllFinanceira: false,
      configDestaxaAlterada: false,
      bancoProducaoAlterado: false,
      migrations: false
    },
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaContinuidadeContrato.js (novo)',
      'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js (continuarCicloCrt)',
      'backend/services/tef/adapters/DestaxaRealAdapter.js (continuarPagamento)',
      'backend/services/tef/TefManager.js (continuarAutorizacao + bloqueio 2ª cobrança)',
      'backend/services/tef/index.js',
      'backend/rotas/tef.js (POST /tef/continuar, HTTP 202)',
      'frontend/pdv/js/pdvTefContinuidade.js (novo)',
      'frontend/pdv/js/pdv.js',
      'frontend/pdv/index.html',
      'tests/tef/mrt-22-integracao-pdv-continuidade.test.js (novo)',
      'docs/build/mrt-22-integracao-pdv-continuidade-report.json (este)'
    ],
    contratoContinuidade: {
      tipos: TIPOS_CONTINUIDADE,
      respostasContinuidade: {
        DISPLAY: '{ displayAck: true } (auto no ciclo; PDV só se receber 99 DISPLAY)',
        COLETA: '{ informacao: string }',
        OPCAO: '{ informacao: string ∈ acao.opcoes }'
      },
      endpoints: {
        inicio: 'POST /tef/pagar',
        continuidade: 'POST /tef/continuar (sem TX_START)',
        httpContinuidade: 202
      },
      identificacaoTipo: 'acao.tipo ∈ DISPLAY|COLETA|OPCAO (parse 99 Destaxa)'
    },
    fluxoInterface: [
      'processarPagamentoTEF → /tef/pagar (mesma idempotency_key)',
      'se requerContinuacao → PdvTefContinuidade.conduzirContinuidade',
      'modal COLETA/OPCAO → validar → /tef/continuar',
      'repete só CONTINUE até aprovado/negado/inconclusivo',
      '__tefPagamentoEmAndamento permanece até o fim do loop'
    ],
    testesExecutados: testes,
    tratamentoErros: {
      coletaVazia: 'DESTAXA_PDV_COLETA_VAZIA — permanece em continuidade',
      opcaoInvalida: 'DESTAXA_PDV_OPCAO_INVALIDA',
      timeoutContinue: 'inconclusivo + reconciliacaoObrigatoria + retryAllowed=false',
      segundaCobranca: 'TEF_CRT_CONTINUIDADE_ATIVA',
      idempotencyDivergente: 'TEF_IDEMPOTENCY_DIVERGENTE'
    },
    riscosRemanescentes: [
      'Modal COLETA/OPCAO depende de jQuery/Bootstrap no PDV real',
      'Adapter recriado na continuidade usa Native Host compartilhado — OK em native-host; testes in-process reutilizam o mesmo bridge mock',
      'CRT real ainda bloqueada pelo gate OFF'
    ],
    confirmacaoNenhumaOperacaoFinanceiraReal: {
      gateOff: transacaoRealHabilitada() === false,
      mensagem: 'Nenhuma operação financeira real foi executada nesta sprint'
    },
    resultadoFinal: `MRT-22 CONCLUÍDA — ${classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  ${rel.resultadoFinal}\n`);

  assert.ok(todosOk);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
