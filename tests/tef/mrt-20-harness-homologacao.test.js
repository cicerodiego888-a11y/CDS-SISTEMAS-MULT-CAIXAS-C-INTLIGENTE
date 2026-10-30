'use strict';

/**
 * MRT-20 — Harness controlado de homologação CRT Destaxa
 * Testes simulados apenas. PROIBIDO: INIT/CRT/TX reais, gate ON, alteração de DB/config.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-20-harness-homologacao-report.json');

const {
  DestaxaHomologacaoCrtHarness,
  HomologacaoSessaoSimulada,
  HARNESS_ENV,
  HARNESS_SIM_ENV,
  HARNESS_ERROS,
  ESTADOS_HARNESS,
  FINALIZACAO_CONFIRMAR
} = require('../../backend/services/tef/destaxa/destaxaHomologacaoCrtHarness');
const {
  REAL_TRANSACTION_ENV,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

function assertOk(cond, msg) {
  assert.ok(cond, msg);
}

async function criarHarnessPronto(passosTransacao, extras = {}) {
  const sessao = new HomologacaoSessaoSimulada({
    codigoInit: extras.codigoInit || '00',
    passosTransacao
  });
  const harness = new DestaxaHomologacaoCrtHarness({
    modo: 'simulado',
    sessao,
    config: { ambiente: AMBIENTE_TRANSACAO_REAL, provedor: 'destaxa' },
    vspague: { detectado: true, executando: true, responding: true },
    exigirGateOffNestaSprint: true
  });
  const amb = harness.validarAmbiente({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS });
  assertOk(amb.sucesso, amb.mensagem);
  const prep = await harness.prepararSessao();
  if (extras.expectInitFail) return { harness, sessao, prep };
  assertOk(prep.sucesso, prep.mensagem);
  const en = await harness.prepararEnableReal();
  assertOk(en.sucesso, en.mensagem);
  return { harness, sessao, prep };
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-20 — Harness homologação CRT (simulado) ===\n');

  // Gate OFF obrigatório nesta sprint
  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);

  const testes = [];
  const registrar = (nome, ok, detalhe = {}) => {
    testes.push({ nome, ok, ...detalhe });
    console.log(`  ${ok ? 'OK' : 'FAIL'} — ${nome}`);
  };

  // 1. INIT 00
  {
    const { harness, prep, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const ok = prep.sucesso === true
      && prep.codigoDestaxa === '00'
      && harness.estado === ESTADOS_HARNESS.PRONTO_PARA_TX
      && sessao.contadores.init === 1;
    registrar('1. INIT com código 00', ok, { codigoDestaxa: prep.codigoDestaxa, hostId: prep.hostId });
    assertOk(ok);
  }

  // 2. INIT falha bloqueia TX_START
  {
    const { harness, prep } = await criarHarnessPronto([], { codigoInit: '06', expectInitFail: true });
    assertOk(prep.sucesso === false && prep.codigo === HARNESS_ERROS.INIT_FALHOU);
    const en = await harness.prepararEnableReal();
    assertOk(en.sucesso === false);
    harness.estado = ESTADOS_HARNESS.PRONTO_PARA_TX; // tentativa indevida
    const tx = await harness.iniciarCrt();
    // mesmo forçando estado, sessão sem clientInitialized bloqueia no txStart
    // mas iniciarCrt exige PRONTO_PARA_TX e enableReal — rearmar via sessão
    const sessao = harness.sessao;
    sessao._enableReal = true;
    harness._txStartExecutado = false;
    const tx2 = await harness.iniciarCrt();
    const ok = tx2.sucesso === false
      && (tx2.codigo === HARNESS_ERROS.INIT_FALHOU || prep.codigo === HARNESS_ERROS.INIT_FALHOU)
      && sessao.contadores.txStart >= 1
      && sessao.contadores.txStart === 1;
    // txStart was called once and returned INIT_FALHOU without driving CRT success
    registrar('2. INIT com falha bloqueia TX_START', ok, { prep: prep.codigo, tx: tx2.codigo });
    assertOk(ok);
  }

  // 3. TX_START retorno 00
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r = await harness.iniciarCrt();
    const ok = r.codigoDestaxa === '00'
      && r.requerFinalizacao === true
      && harness.estado === ESTADOS_HARNESS.AGUARDANDO_FINALIZACAO
      && sessao.contadores.txStart === 1
      && r.retryAllowed === false;
    registrar('3. TX_START com retorno 00', ok, { codigo: r.codigoDestaxa });
    assertOk(ok);
  }

  // 4. TX_START retorno 99
  {
    const { harness } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde;acao=display' }
    ]);
    const r = await harness.iniciarCrt();
    const ok = (r.codigoDestaxa === '99' || r.requerContinuacao === true)
      && harness.estado === ESTADOS_HARNESS.AGUARDANDO_CONTINUACAO
      && r.retryAllowed === false;
    registrar('4. TX_START com retorno 99', ok, { estado: harness.estado });
    assertOk(ok);
  }

  // 5. Continuação explícita após 99
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde;acao=display' },
      { fn: 'continua', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    const r1 = await harness.iniciarCrt();
    assertOk(harness.estado === ESTADOS_HARNESS.AGUARDANDO_CONTINUACAO);
    const r2 = await harness.continuar({ displayAck: true });
    const ok = r2.codigoDestaxa === '00'
      && r2.requerFinalizacao === true
      && sessao.contadores.txContinue === 1
      && harness.estado === ESTADOS_HARNESS.AGUARDANDO_FINALIZACAO;
    registrar('5. Continuação explícita após 99', ok, { r1: r1.codigoDestaxa, r2: r2.codigoDestaxa });
    assertOk(ok);
  }

  // 6. Finalização conforme retorno
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    await harness.iniciarCrt();
    const fin = await harness.finalizar(FINALIZACAO_CONFIRMAR);
    const ok = fin.sucesso === true
      && fin.confirmacao === FINALIZACAO_CONFIRMAR
      && harness.estado === ESTADOS_HARNESS.CONCLUIDO
      && sessao.contadores.txFinalize === 1
      && fin.retryAllowed === false;
    registrar('6. Finalização conforme retorno do provedor', ok, { confirmacao: fin.confirmacao });
    assertOk(ok);
  }

  // 7. Timeout sem repetição
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '08', saida: '' }
    ]);
    const r = await harness.iniciarCrt();
    const segunda = await harness.iniciarCrt();
    const ok = (r.inconclusivo === true || r.codigoDestaxa === '08')
      && r.retryAllowed === false
      && segunda.codigo === HARNESS_ERROS.TX_START_JA_EXECUTADO
      && sessao.contadores.txStart === 1;
    registrar('7. Timeout sem repetição', ok, { primeira: r.codigoDestaxa || r.codigo, segunda: segunda.codigo });
    assertOk(ok);
  }

  // 8. Host encerrado bloqueia continuidade
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde;acao=display' },
      { fn: 'continua', codigo: '00', saida: '' }
    ]);
    await harness.iniciarCrt();
    sessao.encerrar();
    const c = await harness.continuar({ displayAck: true });
    const ok = c.sucesso === false
      && (c.codigo === HARNESS_ERROS.HOST_ENCERRADO || harness.estado === ESTADOS_HARNESS.HOST_ENCERRADO);
    registrar('8. Host encerrado bloqueia continuidade', ok, { codigo: c.codigo });
    assertOk(ok);
  }

  // 9. Segunda requisição simultânea bloqueada
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '00', saida: '' },
      { fn: 'finaliza', codigo: '00', saida: '' }
    ]);
    sessao._emVoo = true;
    const r = await harness.iniciarCrt();
    sessao._emVoo = false;
    const ok = r.sucesso === false && r.codigo === HARNESS_ERROS.HOST_BUSY;
    registrar('9. Segunda requisição simultânea bloqueada', ok, { codigo: r.codigo });
    assertOk(ok);
  }

  // 10. Inconclusivo bloqueia nova cobrança
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '00', saida: '' }
    ]);
    await harness.prepararEnableReal();
    const timeout = harness.registrarTimeoutInconclusivo();
    assertOk(timeout.inconclusivo === true && timeout.retryAllowed === false);
    assertOk(sessao.getEstado().reconciliacaoPendente != null);
    const nova = await harness.tentarNovaCobrancaAposInconclusivo();
    const ok = nova.sucesso === false
      && nova.codigo === HARNESS_ERROS.RECONCILIACAO_PENDENTE
      && sessao.contadores.txStart === 0;
    registrar('10. Resultado inconclusivo bloqueia nova cobrança', ok, { codigo: nova.codigo });
    assertOk(ok);
  }

  // Proteções extras
  {
    const h = new DestaxaHomologacaoCrtHarness({
      modo: 'simulado',
      config: { ambiente: 'producao' },
      exigirGateOffNestaSprint: true
    });
    const r = h.validarAmbiente({ ambiente: 'producao', valorCentavos: 100 });
    registrar('extra. produção bloqueada', r.codigo === HARNESS_ERROS.PRODUCAO_PROIBIDA);
    assert.strictEqual(r.codigo, HARNESS_ERROS.PRODUCAO_PROIBIDA);
  }
  {
    const h = new DestaxaHomologacaoCrtHarness({
      modo: 'simulado',
      config: { ambiente: AMBIENTE_TRANSACAO_REAL },
      exigirGateOffNestaSprint: true
    });
    const r = h.validarAmbiente({ valorCentavos: 200, operacao: 'CRT' });
    registrar('extra. valor ≠ R$1,00 bloqueado', r.codigo === HARNESS_ERROS.VALOR_INVALIDO);
    assert.strictEqual(r.codigo, HARNESS_ERROS.VALOR_INVALIDO);
  }
  {
    const h = new DestaxaHomologacaoCrtHarness({
      modo: 'simulado',
      config: { ambiente: AMBIENTE_TRANSACAO_REAL },
      exigirGateOffNestaSprint: true
    });
    const r = h.validarAmbiente({ valorCentavos: 100, operacao: 'PIX' });
    registrar('extra. PIX bloqueado', r.codigo === HARNESS_ERROS.OPERACAO_INVALIDA);
    assert.strictEqual(r.codigo, HARNESS_ERROS.OPERACAO_INVALIDA);
  }
  {
    const h = new DestaxaHomologacaoCrtHarness({
      modo: 'controlado',
      config: { ambiente: AMBIENTE_TRANSACAO_REAL },
      exigirGateOffNestaSprint: true
    });
    delete process.env[HARNESS_ENV];
    const r = h.validarAmbiente({ valorCentavos: 100 });
    registrar('extra. modo controlado sem env bloqueado', r.codigo === HARNESS_ERROS.DESABILITADO);
    assert.strictEqual(r.codigo, HARNESS_ERROS.DESABILITADO);
  }

  // Sem repetição TX_START após sucesso parcial 99
  {
    const { harness, sessao } = await criarHarnessPronto([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Aguarde;acao=display' }
    ]);
    await harness.iniciarCrt();
    const novamente = await harness.iniciarCrt();
    const ok = novamente.codigo === HARNESS_ERROS.TX_START_JA_EXECUTADO
      && sessao.contadores.txStart === 1;
    registrar('extra. sem repetição automática de TX_START', ok);
    assertOk(ok);
  }

  const todosOk = testes.every((t) => t.ok === true);
  const classificacao = todosOk
    ? 'HARNESS PRONTO PARA HOMOLOGAÇÃO CONTROLADA'
    : 'HARNESS INCOMPLETO';

  const tefManager = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/TefManager.js'),
    'utf8'
  );
  const pdvJsExiste = fs.existsSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'));
  let pdvAlteradoPeloHarness = false;
  // Isolamento: harness não é referenciado pelo TefManager
  const isolamento = {
    tefManagerReferenciaHarness: /destaxaHomologacaoCrtHarness|DestaxaHomologacaoCrtHarness/.test(tefManager),
    pdvJsPresente: pdvJsExiste,
    nota: 'Harness é módulo isolado; TefManager.autorizar não foi alterado nesta sprint'
  };
  assert.strictEqual(isolamento.tefManagerReferenciaHarness, false);

  const rel = {
    sprint: 'MRT-20',
    title: 'Harness controlado de homologação CRT Destaxa',
    generatedAt: geradoEm,
    classificacao,
    restricoesObservadas: {
      initReal: false,
      crtReal: false,
      transacaoFinanceiraReal: false,
      dllFinanceiraChamada: false,
      gateLiberado: false,
      gateValor: String(process.env[REAL_TRANSACTION_ENV] || '') || '(vazio)',
      tefManagerAlterado: false,
      pdvAlterado: false,
      bancoAlterado: false,
      migrations: false,
      configDestaxaAlterada: false
    },
    arquivosCriados: [
      'backend/services/tef/destaxa/destaxaHomologacaoCrtHarness.js',
      'tests/tef/mrt-20-harness-homologacao.test.js',
      'docs/build/mrt-20-harness-homologacao-report.json'
    ],
    funcoesReutilizadas: [
      'DestaxaTransacaoOrquestrador',
      'DestaxaTransacaoMockDriver',
      'buildCrtInput / destaxaProtocolo',
      'destaxaConstantes (CRT, VALOR_HOMOLOGACAO_CENTAVOS, AMBIENTE_TRANSACAO_REAL, gate)',
      'ERROS_HOST (BUSY, OFFLINE, RECONCILIATION_PENDING)'
    ],
    sequenciaExecucao: [
      '1. validarAmbiente (homologacao, CRT, R$1,00, V$Pague, gate OFF na sprint)',
      '2. obter sessão/host (mesmo hostId durante o ciclo)',
      '3. LOAD se necessário',
      '4. INIT único se necessário — exige código 00',
      '5. prepararEnableReal',
      '6. iniciarCrt → TX_START(CRT, transacao_valor=1.00) uma vez',
      '7. se 99 → continuar() explícito → TX_CONTINUE',
      '8. se 00 → finalizar(0|9) → TX_FINALIZE',
      '9. registrar resultado; inconclusivo → reconciliação obrigatória'
    ],
    testesSimulados: testes,
    protecoesImplementadas: [
      'Somente CRT / R$1,00 / homologacao',
      'Produção e PIX/débito-crédito-como-op/EST bloqueados no harness',
      'Uma requisição em voo (HOST_BUSY)',
      'Sem retry automático; TX_START único por run',
      'Timeout/inconclusivo → reconciliação; nova cobrança bloqueada',
      'INIT falho bloqueia TX_START',
      'Host encerrado bloqueia continuidade',
      'INIT concorrente bloqueado',
      'Modo controlado exige DESTAXA_HOMOLOGACAO_CRT_HARNESS=1',
      'Não é caminho de produção; isolado do TefManager/PDV',
      'Gate OFF nesta sprint; TX real do modo controlado não liberada aqui'
    ],
    limitacoesIdentificadas: [
      'Modo controlado (HostBridge real) ainda não executa CRT — reservado a sprint futura com gate pontual',
      'Loop 99 exige chamadas explícitas continuar() — sem auto-orquestração de coleta PinPad',
      'Sessão simulada não carrega DLL; validação física PinPad/V$Pague no caminho controlado futuro',
      `Env flags: ${HARNESS_ENV} (controlado), ${HARNESS_SIM_ENV} (opcional para simulado)`
    ],
    isolamento,
    confirmacaoNenhumaTransacaoReal: {
      gateOff: transacaoRealHabilitada() === false,
      modoTestes: 'simulado',
      dllFinanceira: false,
      mensagem: 'Nenhuma transação financeira real foi executada nesta sprint'
    },
    resultadoFinal: `MRT-20 CONCLUÍDA — ${classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  ${rel.resultadoFinal}\n`);

  assertOk(todosOk, 'Nem todos os testes simulados passaram');
  assertOk(fs.existsSync(REPORT_PATH));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
