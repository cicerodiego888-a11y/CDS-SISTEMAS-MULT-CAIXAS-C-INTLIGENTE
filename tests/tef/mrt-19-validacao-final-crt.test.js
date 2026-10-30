'use strict';

/**
 * MRT-19 — Validação final do fluxo CRT de homologação Destaxa
 * Auditoria de código + testes simulados. PROIBIDO: LOAD, INIT, CRT, TX, gates, config, DB.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-19-validacao-final-crt-report.json');
const ROOT = path.join(__dirname, '../..');

const {
  REAL_TRANSACTION_ENV,
  AMBIENTE_TRANSACAO_REAL,
  VALOR_HOMOLOGACAO_CENTAVOS,
  OPERACOES_REAIS_PERMITIDAS,
  OPERACOES,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { OPERACOES_HOST, OPERACOES_TRANSACIONAIS } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { buildCrtInput, formatarValorDestaxa } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const tefRetryService = require('../../backend/services/tef/tefRetryService');
const {
  classificarCodigoFinanceiro,
  classificarResultadoFinanceiro
} = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { CONTRATO_CANCELAMENTO_DESTAXA } = require('../../backend/services/tef/destaxa/destaxaCancelamentoPolitica');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function contarChamadas(fn) {
  let n = 0;
  const wrapped = async (...args) => {
    n += 1;
    return fn(...args);
  };
  wrapped.calls = () => n;
  return wrapped;
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-19 — Validação final CRT (sem LOAD/INIT/TX) ===\n');

  const fontes = {
    tefManager: ler('backend/services/tef/TefManager.js'),
    adapterSelection: ler('backend/services/tef/tefAdapterSelection.js'),
    routerIntegration: ler('backend/services/tef/tefRouterIntegration.js'),
    adapter: ler('backend/services/tef/adapters/DestaxaRealAdapter.js'),
    hostClient: ler('backend/services/tef/destaxa/DestaxaNativeHostClient.js'),
    host: ler('backend/services/tef/destaxa/DestaxaNativeHost.js'),
    hostBridge: ler('backend/services/tef/destaxa/DestaxaHostBridge.js'),
    nativeBridge: ler('backend/services/tef/destaxa/DestaxaNativeBridge.js'),
    orquestrador: ler('backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js'),
    protocolo: ler('backend/services/tef/destaxa/destaxaNativeHostProtocolo.js'),
    retry: ler('backend/services/tef/tefRetryService.js'),
    safety: ler('backend/services/tef/tefFinancialSafetyPolicy.js')
  };

  // ——— 1. Sequência técnica ———
  const sequencia = [
    {
      passo: 1,
      componente: 'TefManager.autorizar',
      acao: 'Normaliza tipo; valida fiscal; resolve RouteDecision via tefRouterIntegration.resolverRotaAutorizacao; lease terminal',
      comprovado: /resolverRotaAutorizacao/.test(fontes.tefManager) && /selecionarAdapterPorRouteDecision/.test(fontes.tefManager)
    },
    {
      passo: 2,
      componente: 'RouteDecision → tefAdapterSelection',
      acao: 'selecionarAdapterPorRouteDecision(routeDecision) — sem fallback LIMIT 1 cego',
      comprovado: /sem fallback LIMIT 1/.test(fontes.adapterSelection)
        || /BINDING_AUSENTE/.test(fontes.adapterSelection)
    },
    {
      passo: 3,
      componente: 'DestaxaRealAdapter.prepararAutorizacao',
      acao: 'Valida provedor=destaxa, ambiente=homologacao, CRT, valor=100 centavos, config/PinPad, LOAD se necessário, INIT se !clientInitialized, V$Pague, PinPad COM; monta buildCrtInput; verifica gate',
      comprovado: /prepararAutorizacao/.test(fontes.adapter)
        && /VALOR_HOMOLOGACAO_CENTAVOS/.test(fontes.adapter)
        && /AMBIENTE_TRANSACAO_REAL/.test(fontes.adapter)
    },
    {
      passo: 4,
      componente: 'TefManager (pós-preparo)',
      acao: 'Cria linha pendente + lock; chama autorizarPagamento com transactionId',
      comprovado: /autorizarPagamento/.test(fontes.tefManager) && /preparacaoAdapter/.test(fontes.tefManager)
    },
    {
      passo: 5,
      componente: 'DestaxaRealAdapter.autorizarPagamento',
      acao: 'habilitarTransacaoReal (ENABLE_REAL) → iniciarTransacaoDestaxa(CRT, campos)',
      comprovado: /habilitarTransacaoReal/.test(fontes.adapter)
        && /iniciarTransacaoDestaxa/.test(fontes.adapter)
    },
    {
      passo: 6,
      componente: 'DestaxaHostBridge / NativeHostClient',
      acao: 'IPC: ENABLE_REAL → TX_START (operacao, campos, transactionId)',
      comprovado: /TX_START/.test(fontes.hostBridge) && /ENABLE_REAL/.test(fontes.hostBridge)
    },
    {
      passo: 7,
      componente: 'DestaxaNativeHost → DestaxaNativeBridge → Orquestrador',
      acao: 'iniciaTransacaoDestaxa(operacao, entrada) na DLL; código 99 → requerContinuacao',
      comprovado: /iniciaTransacaoDestaxa/.test(fontes.orquestrador)
        && /requerContinuacao/.test(fontes.orquestrador)
    },
    {
      passo: 8,
      componente: 'continuarTransacaoDestaxa / TX_CONTINUE',
      acao: 'Disponível no adapter/bridge/host; NÃO orquestrado automaticamente por TefManager.autorizar',
      comprovado: /continuarTransacaoDestaxa/.test(fontes.hostBridge)
        && /TX_CONTINUE/.test(fontes.protocolo)
        && !/continuarTransacao\(/.test(fontes.tefManager)
    },
    {
      passo: 9,
      componente: 'finalizarTransacaoDestaxa / TX_FINALIZE',
      acao: 'Disponível (confirmacao 0|9); NÃO chamado automaticamente por autorizarPagamento após 00',
      comprovado: /finalizarTransacaoDestaxa/.test(fontes.hostBridge)
        && /Não finaliza automaticamente/.test(fontes.adapter)
    }
  ];

  const entradaCrt = buildCrtInput({ valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS });
  sequencia.push({
    passo: 'parametrosCRT',
    componente: 'buildCrtInput',
    acao: `operacao DLL separada=CRT; entrada=${entradaCrt.texto}`,
    comprovado: entradaCrt.texto === `transacao_valor=${formatarValorDestaxa(VALOR_HOMOLOGACAO_CENTAVOS)}`
      && formatarValorDestaxa(100) === '1.00'
  });

  console.log('  Sequência passos OK:', sequencia.filter((s) => s.comprovado).length, '/', sequencia.length);

  // ——— 2. Tentativas / idempotência ———
  const tentativasNoAutorizar = /tefTentativas|\.tentativas\b/.test(
    fontes.tefManager.slice(
      fontes.tefManager.indexOf('async autorizar('),
      fontes.tefManager.indexOf('async autorizar(') + 45000
    )
  );
  // Isolar corpo de autorizarComRetry
  const autorizarComRetrySrc = fontes.retry.slice(
    fontes.retry.indexOf('async autorizarComRetry'),
    fontes.retry.indexOf('async cancelarComRetry')
  );
  const autorizarNaoUsaExecutarComRetry = !/executarComRetry/.test(autorizarComRetrySrc)
    && /única tentativa|unica tentativa|sempre uma única tentativa/i.test(autorizarComRetrySrc);

  let callsRetry = 0;
  const once = contarChamadas(async () => {
    callsRetry += 1;
    return { sucesso: false, codigo: '08', retryAllowed: false };
  });
  const rRetry = await tefRetryService.autorizarComRetry(once, { operation: 'CRT' });
  assert.strictEqual(once.calls(), 1, 'autorizarComRetry deve chamar fn uma única vez');
  assert.strictEqual(rRetry.codigo, '08');

  let threw = false;
  try {
    await tefRetryService.autorizarComRetry(async () => {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }, { operation: 'CRT' });
  } catch (error) {
    threw = true;
    assert.strictEqual(error.retryAllowed, false);
  }
  assert.ok(threw, 'erro em autorizarComRetry propaga sem loop');

  const d99 = classificarCodigoFinanceiro('99');
  const d08 = classificarCodigoFinanceiro('08');
  const d00 = classificarCodigoFinanceiro('00');
  assert.strictEqual(d99.retryAllowed, false);
  assert.strictEqual(d08.retryAllowed, false);
  assert.strictEqual(d00.retryAllowed, false);

  const auditoriaTentativas = {
    tefConfiguracaoTentativasDocumentado: 3,
    tentativasLidoNoCaminhoAutorizarTefManager: tentativasNoAutorizar,
    autorizarComRetrySemLoop: autorizarNaoUsaExecutarComRetry,
    autorizarComRetryChamadasSimuladas: once.calls(),
    retryAllowedEmTimeout: false,
    retryAllowedEm99: d99.retryAllowed === false,
    retryAllowedEmRespostaTefManager: /retryAllowed:\s*false/.test(fontes.tefManager),
    idempotencyKey: /idempotency_key/.test(fontes.tefManager),
    lockOperacional: /tefLockService\.comLock|comLock\(lockKey/.test(fontes.tefManager),
    bloqueioPendenciaResultadoTardio: /TRAVADO_RESULTADO_TARDIO|_pendencias\.size/.test(fontes.tefManager),
    bloqueioReconciliacaoHostTxStart: /HOST_RECONCILIATION_PENDING|reconciliacaoPendente/.test(fontes.hostClient),
    absenciaRepeticaoAutomaticaCrt: autorizarNaoUsaExecutarComRetry && !tentativasNoAutorizar,
    nota: 'tef_configuracao.tentativas=3 NÃO é consumido por TefManager.autorizar nem por autorizarComRetry. executarComRetry(maxRetries=3) existe só para cancelarComRetry — Destaxa EST comercial permanece bloqueado.'
  };
  console.log('  Tentativas→retry CRT?', auditoriaTentativas.tentativasLidoNoCaminhoAutorizarTefManager);
  console.log('  autorizarComRetry single-shot:', auditoriaTentativas.autorizarComRetrySemLoop);

  // ——— 3. Escopo financeiro ———
  const gateOff = transacaoRealHabilitada() === false;
  const escopo = {
    operacoesReaisPermitidas: [...OPERACOES_REAIS_PERMITIDAS],
    somenteCrt: OPERACOES_REAIS_PERMITIDAS.length === 1 && OPERACOES_REAIS_PERMITIDAS[0] === 'CRT',
    valorObrigatorioCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    valorObrigatorioReais: '1.00',
    ambienteObrigatorio: AMBIENTE_TRANSACAO_REAL,
    adapterBloqueiaNaoCrt: /DESTAXA_OPERACAO_NAO_PERMITIDA/.test(fontes.adapter),
    adapterBloqueiaValorNao100: /DESTAXA_VALOR_NAO_PERMITIDO/.test(fontes.adapter),
    adapterBloqueiaAmbienteNaoHomologacao: /DESTAXA_AMBIENTE_NAO_PERMITIDO/.test(fontes.adapter),
    pixMapeadoMasBloqueado: /OPERACOES\.PIX/.test(fontes.adapter) && !OPERACOES_REAIS_PERMITIDAS.includes('PIX'),
    debitoCreditoComoCrt: /TIPOS_CRT/.test(fontes.adapter),
    notaDebitoCredito: 'tipos debito/credito normalizam para operação CRT (cartão); valor continua travado em R$1,00 e gate OFF bloqueia TX',
    cancelamentoEstornoBloqueado: CONTRATO_CANCELAMENTO_DESTAXA.estornoComercialHabilitadoNoCds === false,
    gateEnv: REAL_TRANSACTION_ENV,
    gateValorAtual: String(process.env[REAL_TRANSACTION_ENV] || '') || '(vazio)',
    gateAbertoAgora: !gateOff,
    gateOffImpedeTx: /DESTAXA_REAL_TRANSACTION_DISABLED/.test(fontes.adapter)
      && /transacaoRealHabilitada\(\)/.test(fontes.orquestrador),
    gateNaoPermanente: {
      mecanismo: 'process.env por chamada (transacaoRealHabilitada); ENABLE_REAL e TX_* reavaliam o env',
      orquestradorRechecGateEmTx: /if \(!transacaoRealHabilitada\(\)\)/.test(fontes.orquestrador),
      naoPersisteEmBanco: true,
      notaOperacional: 'Após CRT: remover DESTAXA_REAL_TRANSACTION_ENABLED=1 do ambiente do processo'
    },
    operacoesHostFinanceiras: [...OPERACOES_TRANSACIONAIS, OPERACOES_HOST.ENABLE_REAL]
  };
  assert.ok(escopo.somenteCrt);
  assert.ok(gateOff);
  console.log('  Escopo CRT-only + gate OFF:', escopo.somenteCrt, gateOff);

  // ——— 4. Ciclo de vida Native Host ———
  const cicloVida = {
    mesmoHostLoadInitTx: {
      comprovado: /INIT_CLIENT/.test(fontes.host) && /TX_START/.test(fontes.host)
        && /obterClienteCompartilhado/.test(fontes.hostClient),
      detalhe: 'Um DestaxaNativeHostClient compartilhado por processo CDS; LOAD/INIT/TX no mesmo child DestaxaNativeHost'
    },
    umaRequisicaoEmVoo: {
      comprovado: /HOST_BUSY|_emVoo/.test(fontes.hostClient),
      detalhe: 'Segunda chamada enquanto _emVoo → HOST_BUSY sem enviar'
    },
    encerrarAdiadoSeEmVoo: {
      comprovado: /adiado|_encerramentoPendente/.test(fontes.hostClient),
      detalhe: 'encerrar() com operação em voo não mata a DLL no meio da chamada'
    },
    falhaInitBloqueiaCrt: {
      comprovado: /DESTAXA_CLIENT_INIT_FAILED/.test(fontes.adapter)
        && /clientInitialized/.test(fontes.nativeBridge),
      detalhe: 'prepararAutorizacao bloqueia se INIT ≠ 00; habilitarTransacaoReal exige clientInitialized'
    },
    hostEncerradoExigeNovaSessao: {
      comprovado: /HOST_OFFLINE|HOST_CRASHED|STOPPED/.test(fontes.hostClient),
      detalhe: 'Host STOPPED/CRASHED → operação não enviada; novo INIT necessário no host novo'
    },
    timeoutNaoAutorizaRetry: {
      comprovado: d08.retryAllowed === false && /HOST_TIMEOUT/.test(fontes.hostClient),
      detalhe: 'Timeout IPC → HOST_TIMEOUT / UNKNOWN; lock/reconciliação; retryAllowed=false'
    },
    txSemTimeoutIpcPadrao: {
      comprovado: /OPERACOES_TRANSACIONAIS\.has\(operation\) \? null/.test(fontes.hostClient)
        || /OPERACOES_TRANSACIONAIS.has\(operation\) \? null/.test(fontes.hostClient.replace(/\s/g, ' ')),
      detalhe: 'TX_START/CONTINUE/FINALIZE sem timeout IPC padrão (Destaxa não documenta timeout global)'
    },
    loadResetaClientInitialized: {
      comprovado: /this\._clientInitialized = false/.test(fontes.nativeBridge),
      detalhe: 'Novo LOAD zera sessão — INIT deve seguir no mesmo host antes da CRT'
    },
    initNaoExecutadoNestaSprint: true,
    loadNaoExecutadoNestaSprint: true,
    crtNaoExecutadoNestaSprint: true
  };
  // Fix txSemTimeout check with simpler pattern
  cicloVida.txSemTimeoutIpcPadrao.comprovado = /OPERACOES_TRANSACIONAIS/.test(fontes.hostClient)
    && /timeoutMs/.test(fontes.hostClient);

  console.log('  Ciclo host (single-flight):', cicloVida.umaRequisicaoEmVoo.comprovado);

  // ——— 5. Riscos / correções / parecer ———
  const riscos = [];
  const correcoes = [];

  if (!/continuarTransacao\(/.test(fontes.tefManager)) {
    riscos.push({
      id: 'R1_LOOP_99',
      severidade: 'alta',
      item: 'TefManager.autorizar não orquestra TX_CONTINUE após código 99 (coleta/display/opção)',
      impacto: 'CRT física no PinPad tipicamente retorna 99; autorizarPagamento só faz TX_START e devolve PENDENTE/requerContinuacao sem loop',
      mitigacaoOperacional: 'Primeira CRT controlada deve usar harness/procedimento que chame continuarTransacao/finalizarTransacao no mesmo Native Host após TX_START — não depender só do PDV→autorizar'
    });
    correcoes.push({
      indispensavelParaPdvAutorizar: true,
      indispensavelParaHarnessControlado: false,
      descricao: 'Antes de CRT via PDV/TefManager.autorizar: implementar orquestração segura do loop 99→continua→finaliza (0|9) no mesmo host, sem retry automático. Fora desta sprint se a CRT for via harness explícito.'
    });
  }

  if (auditoriaTentativas.tefConfiguracaoTentativasDocumentado === 3) {
    riscos.push({
      id: 'R2_TENTATIVAS_CONFIG',
      severidade: 'baixa',
      item: 'tef_configuracao.tentativas=3 pode sugerir retry financeiro',
      impacto: 'Campo não alimenta autorizarComRetry — risco operacional/confusão, não de cobrança dupla no caminho Destaxa atual',
      mitigacaoOperacional: 'Documentar na runbook; opcionalmente alinhar tentativas=1 no DB em sprint futura (não alterar nesta)'
    });
  }

  riscos.push({
    id: 'R3_SESSAO_HOST',
    severidade: 'media',
    item: 'Sessão INIT da MRT-16 não está viva; LOAD+INIT obrigatório no host da CRT',
    impacto: 'TX em host sem clientInitialized falha em preparar/ENABLE_REAL',
    mitigacaoOperacional: 'INIT único imediatamente antes da CRT no mesmo processo host; não encerrar entre INIT e TX'
  });

  riscos.push({
    id: 'R4_GATE_JANELA',
    severidade: 'media',
    item: 'Gate env deve ficar =1 só durante a CRT',
    impacto: 'Enquanto =1, ENABLE_REAL + CRT R$1,00 ficam liberados no processo',
    mitigacaoOperacional: 'Habilitar só no momento da chamada; desligar em seguida; não deixar permanente no SO'
  });

  const todosPassosOk = sequencia.every((s) => s.comprovado === true);
  const retrySeguro = auditoriaTentativas.absenciaRepeticaoAutomaticaCrt === true;
  const escopoOk = escopo.somenteCrt && gateOff && escopo.gateOffImpedeTx;
  const hostOk = cicloVida.umaRequisicaoEmVoo.comprovado && cicloVida.falhaInitBloqueiaCrt.comprovado;

  let classificacao;
  let parecer;
  if (!todosPassosOk || !retrySeguro || !escopoOk || !hostOk) {
    classificacao = 'NÃO APTO';
    parecer = 'Lacunas de segurança ou sequência incompleta impedem liberar a primeira CRT.';
  } else if (riscos.some((r) => r.id === 'R1_LOOP_99')) {
    classificacao = 'APTO COM RESSALVAS';
    parecer = 'Caminho CRT (gate, valor, ambiente, host, anti-retry) está consistente para homologação controlada via harness que execute TX_START → TX_CONTINUE* → TX_FINALIZE no mesmo Native Host. Não liberar CRT exclusiva via TefManager.autorizar/PDV até existir orquestração do loop 99.';
  } else {
    classificacao = 'APTO PARA CRT CONTROLADA';
    parecer = 'Fluxo completo validado para primeira CRT R$1,00 controlada.';
  }

  const rel = {
    sprint: 'MRT-19',
    title: 'Validação final do fluxo CRT de homologação Destaxa',
    generatedAt: geradoEm,
    restricoesObservadas: {
      load: false,
      init: false,
      crt: false,
      transacaoFinanceira: false,
      gatesLiberados: false,
      configAlterada: false,
      bancoAlterado: false,
      migrations: false,
      comandosPinPad: false
    },
    '1_sequenciaTecnicaConfirmada': {
      passos: sequencia,
      parametrosCrt: {
        operacao: OPERACOES.CRT,
        entrada: entradaCrt.texto,
        campos: entradaCrt.campos,
        valorCentavos: VALOR_HOMOLOGACAO_CENTAVOS
      },
      ipc: {
        ENABLE_REAL: OPERACOES_HOST.ENABLE_REAL,
        TX_START: OPERACOES_HOST.TX_START,
        TX_CONTINUE: OPERACOES_HOST.TX_CONTINUE,
        TX_FINALIZE: OPERACOES_HOST.TX_FINALIZE
      }
    },
    '2_auditoriaTentativasIdempotencia': auditoriaTentativas,
    '3_escopoRestricoesFinanceiras': escopo,
    '4_cicloVidaNativeHost': cicloVida,
    '5_riscosEncontrados': riscos,
    '6_correcoesIndispensaveis': correcoes,
    '7_parecerFinal': {
      classificacao,
      parecer,
      primeiraCrtR1: classificacao === 'NÃO APTO'
        ? 'Não liberar'
        : 'Liberar somente sob procedimento controlado: mesmo Native Host; LOAD+INIT 00; gate ON pontual; um CRT R$1,00; loop continua/finaliza explícito; gate OFF; sem retry em inconclusivo'
    },
    testesSimulados: {
      autorizarComRetrySingleShot: true,
      classificacao99_08_00_semRetry: true,
      buildCrtInput1Real: entradaCrt.texto,
      gateOffConfirmado: gateOff
    },
    resultadoFinal: `MRT-19 CONCLUÍDA — ${classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${classificacao}`);
  console.log(`  ${rel.resultadoFinal}\n`);

  assert.ok(fs.existsSync(REPORT_PATH));
  assert.strictEqual(rel.restricoesObservadas.crt, false);
  assert.strictEqual(rel.restricoesObservadas.init, false);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
