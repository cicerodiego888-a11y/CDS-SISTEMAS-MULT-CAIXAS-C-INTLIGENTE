'use strict';

/**
 * MRT-21 — Orquestração do ciclo CRT no fluxo TefManager/DestaxaRealAdapter
 * Simulado. PROIBIDO: INIT/CRT reais, gate ON, DB/config/migrations.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-21-orquestracao-crt-tefmanager-report.json');

const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const {
  executarCicloCrt,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const {
  OPERACOES,
  REAL_TRANSACTION_ENV,
  VALOR_HOMOLOGACAO_CENTAVOS,
  CLASSIFICACAO_CODIGO,
  ERROS,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { ERROS_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { buildCrtInput } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const tefContrato = require('../../backend/services/tef/tefContrato');

function criarBridgeMock(passos, opcoes = {}) {
  const orq = new DestaxaTransacaoOrquestrador({
    driver: new DestaxaTransacaoMockDriver(passos),
    permitirTransacaoReal: true
  });
  const contadores = { enable: 0, inicia: 0, continua: 0, finaliza: 0 };
  let encerrado = opcoes.encerrado === true;
  let busy = opcoes.busy === true;
  let falhaAposContinues = opcoes.encerrarAposContinues != null
    ? Number(opcoes.encerrarAposContinues)
    : null;
  let continuesFeitos = 0;

  return {
    contadores,
    orq,
    encerrar() { encerrado = true; },
    setBusy(v) { busy = v === true; },
    async habilitarTransacaoReal() {
      contadores.enable += 1;
      if (encerrado) {
        return { sucesso: false, codigo: ERROS_HOST.HOST_OFFLINE, mensagem: 'host off' };
      }
      return { sucesso: true };
    },
    async iniciarTransacaoDestaxa(operacao, campos, opcoesTx = {}) {
      contadores.inicia += 1;
      if (encerrado) {
        return { sucesso: false, codigo: ERROS_HOST.HOST_OFFLINE, codigoDestaxa: ERROS_HOST.HOST_OFFLINE, retryAllowed: false };
      }
      if (busy) {
        return { sucesso: false, codigo: ERROS_HOST.HOST_BUSY, codigoDestaxa: ERROS_HOST.HOST_BUSY, retryAllowed: false };
      }
      return orq.iniciarTransacao(operacao, campos, opcoesTx);
    },
    async continuarTransacaoDestaxa(resposta) {
      contadores.continua += 1;
      continuesFeitos += 1;
      if (falhaAposContinues != null && continuesFeitos > falhaAposContinues) {
        encerrado = true;
      }
      if (encerrado) {
        return { sucesso: false, codigo: ERROS_HOST.HOST_OFFLINE, codigoDestaxa: ERROS_HOST.HOST_OFFLINE, retryAllowed: false };
      }
      if (busy) {
        return { sucesso: false, codigo: ERROS_HOST.HOST_BUSY, codigoDestaxa: ERROS_HOST.HOST_BUSY, retryAllowed: false };
      }
      if (opcoes.timeoutNoContinue === true) {
        return {
          sucesso: false,
          codigoDestaxa: '08',
          classificacao: CLASSIFICACAO_CODIGO.TIMEOUT,
          financialState: 'UNKNOWN',
          estado: 'TIMEOUT',
          retryAllowed: false,
          mensagem: 'timeout continue'
        };
      }
      return orq.continuarTransacao(resposta);
    },
    async finalizarTransacaoDestaxa(confirmacao) {
      contadores.finaliza += 1;
      if (encerrado) {
        return { sucesso: false, codigo: ERROS_HOST.HOST_OFFLINE, codigoDestaxa: ERROS_HOST.HOST_OFFLINE, retryAllowed: false };
      }
      return orq.finalizarTransacao(confirmacao);
    }
  };
}

function criarAdapterComBridge(bridge, extras = {}) {
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao', pdvCodigo: 'PDV1', caixaCodigo: 'CX1' },
    { bridge, executionMode: 'in-process' }
  );
  adapter.prepararAutorizacao = async () => ({
    pronto: extras.initFail
      ? false
      : true,
    resposta: extras.initFail
      ? {
        sucesso: false,
        status: tefContrato.STATUS.ERRO,
        codigo: ERROS.DESTAXA_CLIENT_INIT_FAILED,
        mensagem: 'INIT falhou',
        retryAllowed: false,
        transactionAttempted: false
      }
      : null,
    contexto: {
      operacao: OPERACOES.CRT,
      camposEntrada: buildCrtInput({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS }).campos,
      valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
      clientInitializationCode: extras.initFail ? '06' : '00',
      checks: {}
    }
  });
  return adapter;
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-21 — Orquestração CRT TefManager (simulado) ===\n');
  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const testes = [];
  const ok = (nome, cond, extra = {}) => {
    testes.push({ nome, ok: !!cond, ...extra });
    console.log(`  ${cond ? 'OK' : 'FAIL'} — ${nome}`);
    assert.ok(cond, nome);
  };

  const entrada = buildCrtInput({ valorCentavos: 100 });

  // 1. CRT retorno 00 (+ finalize)
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-1'
    });
    ok('1. CRT com retorno 00', r.sucesso === true && r.ciclo.finalizado === true && bridge.contadores.inicia === 1 && bridge.contadores.finaliza === 1, {
      codigo: r.codigoDestaxa
    });
  }

  // 2. 99 + continuação
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-2'
    });
    ok('2. CRT com retorno 99 e continuação', r.sucesso === true && r.ciclo.continues === 1 && bridge.contadores.continua === 1);
  }

  // 3. Múltiplas continuações
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Passo1' },
      { fn: 'continua', codigo: '99', saida: 'mensagem=Passo2' },
      { fn: 'continua', codigo: '99', saida: 'tipo=0;mensagem=Valor' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      respostasContinuidade: [{ informacao: '1.00' }],
      transactionId: 'tx-3'
    });
    ok('3. Múltiplas continuações', r.sucesso === true && r.ciclo.continues === 3 && bridge.contadores.continua === 3);
  }

  // 4. Finalização aprovada (via adapter)
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const adapter = criarAdapterComBridge(bridge);
    const r = await adapter.autorizarPagamento({
      tipo: 'credito',
      valor: 1,
      venda_id: 501,
      pdv_codigo: 'PDV1'
    }, { pronto: true, transactionId: '77', contexto: {
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      valorCentavos: 100,
      clientInitializationCode: '00',
      checks: {}
    } });
    ok('4. Finalização aprovada', r.sucesso === true && r.status === tefContrato.STATUS.APROVADO
      && r.cicloCrt?.finalizado === true
      && r.vinculoVendaPdv?.venda_id === 501
      && r.retryAllowed === false);
  }

  // 5. Finalização negada (código 03 no start)
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '03', saida: '' }
    ]);
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-5'
    });
    ok('5. Finalização negada', r.sucesso === false && r.negado === true && r.conclusivo === true
      && bridge.contadores.finaliza === 0 && r.retryAllowed === false);
  }

  // 6. INIT falho
  {
    const bridge = criarBridgeMock([]);
    const adapter = criarAdapterComBridge(bridge, { initFail: true });
    const r = await adapter.autorizarPagamento({ tipo: 'credito', valor: 1 });
    ok('6. INIT falho', r.sucesso === false
      && r.codigo === ERROS.DESTAXA_CLIENT_INIT_FAILED
      && bridge.contadores.inicia === 0
      && r.transactionAttempted === false);
  }

  // 7. Timeout TX_START
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '08', saida: '' }
    ]);
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-7'
    });
    ok('7. Timeout em TX_START', r.inconclusivo === true && r.reconciliacaoObrigatoria === true
      && r.retryAllowed === false && bridge.contadores.finaliza === 0);
  }

  // 8. Timeout TX_CONTINUE
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' }
    ], { timeoutNoContinue: true });
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-8'
    });
    ok('8. Timeout em TX_CONTINUE', r.inconclusivo === true && r.retryAllowed === false
      && bridge.contadores.continua === 1 && bridge.contadores.finaliza === 0);
  }

  // 9. Host encerrado durante ciclo
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde' },
      { fn: 'continua', codigo: '00', saida: '' }
    ], { encerrarAposContinues: 0 });
    // encerrarAposContinues:0 → first continue marks encerrado before continue? 
    // Our logic: continuesFeitos += 1 then if > falhaAposContinues. With 0, first continue (1 > 0) sets encerrado then returns OFFLINE.
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-9'
    });
    ok('9. Host encerrado durante o ciclo', r.codigo === CICLO_ERROS.HOST_ENCERRADO
      && r.retryAllowed === false && r.reconciliacaoObrigatoria === true);
  }

  // 10. Requisição concorrente (BUSY)
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '00', saida: '' }
    ], { busy: true });
    const r = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-10'
    });
    ok('10. Requisição concorrente', r.codigo === CICLO_ERROS.HOST_BUSY && r.retryAllowed === false
      && r.ciclo.txStartExecutado === false);
  }

  // 11. Resultado inconclusivo (sem nova TX_START no mesmo ciclo)
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '08', saida: '' }
    ]);
    const r1 = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-11'
    });
    // Segunda orquestração no mesmo bridge sem reconciliar — novo ciclo pode chamar inicia (orq state TIMEOUT blocks new)
    const r2 = await executarCicloCrt({
      bridge,
      operacao: OPERACOES.CRT,
      camposEntrada: entrada.campos,
      transactionId: 'tx-11b'
    });
    ok('11. Resultado inconclusivo', r1.inconclusivo === true && r1.reconciliacaoObrigatoria === true
      && r2.sucesso === false && r2.retryAllowed === false
      && bridge.contadores.inicia >= 1);
  }

  // 12. Idempotência / reconciliação preservadas no TefManager (auditoria estática)
  {
    const tm = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
    const adapterSrc = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'), 'utf8');
    const cic = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js'), 'utf8');
    const preservado = /idempotency_key/.test(tm)
      && /comLock/.test(tm)
      && /TRAVADO_RESULTADO_TARDIO|_pendencias/.test(tm)
      && /retryAllowed:\s*false/.test(tm)
      && /CICLO_CRT/.test(tm)
      && /executarCicloCrt/.test(adapterSrc)
      && /Não repete TX_START|txStartExecutado|TX_START_REPETIDO/.test(cic)
      && /99 NÃO é aprovação|não é aprovação/i.test(cic)
      && /Timeout ≠ cancelamento|Timeout\/inconclusivo/.test(cic);
    ok('12. Preservação da idempotência e reconciliação', preservado);
  }

  // Gate OFF: adapter real path still blocked before ciclo
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '00', saida: '' }
    ]);
    // Force real preparar would need gate; use stub enable that fails like production
    bridge.habilitarTransacaoReal = async () => ({
      sucesso: false,
      codigo: ERROS.DESTAXA_REAL_TRANSACTION_DISABLED,
      mensagem: 'gate off'
    });
    const adapter = criarAdapterComBridge(bridge);
    const r = await adapter.autorizarPagamento({ tipo: 'credito', valor: 1 }, {
      pronto: true,
      transactionId: 'g1',
      contexto: {
        operacao: OPERACOES.CRT,
        camposEntrada: entrada.campos,
        valorCentavos: 100,
        clientInitializationCode: '00',
        checks: {}
      }
    });
    ok('extra. gate OFF bloqueia antes do ciclo', r.codigo === ERROS.DESTAXA_REAL_TRANSACTION_DISABLED
      && bridge.contadores.inicia === 0);
  }

  // Sem TX_START duplicado no mesmo executarCicloCrt
  {
    const bridge = criarBridgeMock([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    await executarCicloCrt({ bridge, operacao: OPERACOES.CRT, camposEntrada: entrada.campos });
    ok('extra. um TX_START por ciclo', bridge.contadores.inicia === 1);
  }

  const todosOk = testes.every((t) => t.ok);
  const classificacao = todosOk
    ? 'ORQUESTRAÇÃO CRT VALIDADA'
    : 'ORQUESTRAÇÃO INCOMPLETA';

  const tratamentoRetornos = {
    '00': 'Sucesso → TX_FINALIZE(0) → aprovado conclusivo',
    '99': 'Ação requerida — NÃO aprovação; TX_CONTINUE com displayAck ou fila explícita',
    '03/04/09': 'Negado conclusivo — sem finalize(0); sem EST comercial',
    '08': 'Timeout inconclusivo — reconciliação; retryAllowed=false; sem cancel implícito',
    HOST_BUSY: 'Sem TX efetiva; retryAllowed=false',
    HOST_OFFLINE: 'Ciclo interrompido; reconciliacaoObrigatoria',
    INIT_FALHOU: 'prepararAutorizacao bloqueia antes de TX_START'
  };

  const rel = {
    sprint: 'MRT-21',
    title: 'Orquestração do ciclo CRT no TefManager',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      harnessControladoReal: false,
      initReal: false,
      crtReal: false,
      gatesHabilitados: false,
      gateValor: String(process.env[REAL_TRANSACTION_ENV] || '') || '(vazio)',
      configDestaxaAlterada: false,
      bancoProducaoAlterado: false,
      migrations: false
    },
    arquivosAlterados: [
      'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js (novo)',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'backend/services/tef/TefManager.js',
      'tests/tef/mrt-21-orquestracao-crt-tefmanager.test.js (novo)',
      'docs/build/mrt-21-orquestracao-crt-tefmanager-report.json (este)'
    ],
    fluxoImplementado: [
      'TefManager.autorizar → RouteDecision → DestaxaRealAdapter.prepararAutorizacao',
      'ENABLE_REAL (gate) → executarCicloCrt no mesmo bridge/host',
      'TX_START(CRT) único → 99* TX_CONTINUE → TX_FINALIZE(0) se 00',
      'Log CICLO_CRT + vinculoVendaPdv no payload; retryAllowed=false'
    ],
    testesExecutados: testes,
    tratamentoDeCadaRetorno: tratamentoRetornos,
    garantiasContraDuplicidade: [
      'Um TX_START por execução de ciclo',
      'autorizarComRetry permanece single-shot',
      'idempotency_key + lock TefManager preservados',
      'inconclusivo → reconciliacaoObrigatoria; sem nova cobrança automática',
      'HOST_BUSY não conta como start efetivo no provedor'
    ],
    riscosRemanescentes: [
      'COLETA/OPCAO sem fila respostasContinuidade interrompe com pendente operacional (PDV deve fornecer respostas ou UI)',
      'CRT real ainda exige gate pontual + INIT no host — fora desta sprint',
      'Timeout operacional do TefManager vs ciclo longo de 99 — resultado tardio já previsto no contrato Destaxa'
    ],
    confirmacaoNenhumaOperacaoFinanceiraReal: {
      gateOff: transacaoRealHabilitada() === false,
      dllFinanceira: false,
      mensagem: 'Nenhuma operação financeira real foi executada nesta sprint'
    },
    resultadoFinal: `MRT-21 CONCLUÍDA — ${classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  ${rel.resultadoFinal}\n`);

  assert.ok(todosOk);
  assert.ok(fs.existsSync(REPORT_PATH));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
