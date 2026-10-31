'use strict';

/**
 * MRT-38 — Hardening continuidade interativa Destaxa (somente mocks).
 * Sem INIT/DLL/NativeHost/V$Pague/CRT financeira/gate ON/DB produção.
 * Não reutiliza identidades MRT-24 / MRT-36.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-38-hardening-continuidade-interativa-report.json');

const {
  REAL_TRANSACTION_ENV,
  TIPOS_ACAO,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  parseAcaoSolicitada,
  buildContinuaInput,
  classificarCodigoTransacao
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  ERROS_CONTINUIDADE,
  normalizarAcaoContinuidade,
  validarRespostaOperador,
  validarContinuidadeCompleta,
  avaliarDisponibilidadeOperador,
  avaliarTimeoutColeta,
  limparRegistrosContinuidade,
  montarPedidoContinuidade,
  ehSolicitacaoContinuidade
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');
const {
  continuarCicloCrt,
  executarCicloCrt,
  CICLO_ERROS
} = require('../../backend/services/tef/destaxa/destaxaCrtCicloOrquestracao');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const { buildCrtInput } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const { CLASSIFICACAO_CODIGO } = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { ERROS_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');

const ID_MRT38 = Object.freeze({
  idempotency_key: 'mrt38_sim_continuidade_opcao_a1b2',
  transactionId: 'tx-mrt38-sim-9001',
  operation_id: 'op_mrt38_sim_continuidade'
});

const ACAO_OPCAO = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});

const SAIDA_99 = 'mensagem=Tipo do Cartao;opcao=Credito|Debito|Voucher;tipo=X;timeout=120;chave=transacao_tipo_cartao';

function ok(nome, cond, evidencias = {}) {
  if (!cond) throw new Error(`FAIL — ${nome}: ${JSON.stringify(evidencias)}`);
  console.log(`  OK — ${nome}`);
  return { nome, ok: true, ...evidencias };
}

function criarBridgeMock(passos, opcoes = {}) {
  const orq = new DestaxaTransacaoOrquestrador({
    driver: new DestaxaTransacaoMockDriver(passos),
    permitirTransacaoReal: true
  });
  const contadores = { inicia: 0, continua: 0, finaliza: 0 };
  const txsRecebidos = [];
  return {
    contadores,
    txsRecebidos,
    async iniciarTransacaoDestaxa(operacao, campos, o = {}) {
      contadores.inicia += 1;
      txsRecebidos.push(o.transactionId);
      return orq.iniciarTransacao(operacao, campos, o);
    },
    async continuarTransacaoDestaxa(resposta, o = {}) {
      contadores.continua += 1;
      txsRecebidos.push(o.transactionId);
      if (opcoes.timeoutContinue) {
        return {
          sucesso: false,
          codigoDestaxa: '08',
          classificacao: CLASSIFICACAO_CODIGO.TIMEOUT,
          financialState: 'UNKNOWN',
          estado: 'TIMEOUT',
          retryAllowed: false,
          mensagem: 'timeout continue mock'
        };
      }
      if (opcoes.hostMortoContinue) {
        return {
          sucesso: false,
          codigoDestaxa: ERROS_HOST.HOST_OFFLINE,
          hostError: ERROS_HOST.HOST_OFFLINE,
          retryAllowed: false
        };
      }
      return orq.continuarTransacao(resposta);
    },
    async finalizarTransacaoDestaxa(c) {
      contadores.finaliza += 1;
      return orq.finalizarTransacao(c);
    },
    async habilitarTransacaoReal() {
      return { sucesso: true };
    }
  };
}

function carregarPdvContinuidade() {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdvTefContinuidade.js'), 'utf8');
  const sandbox = { globalThis: {}, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'pdvTefContinuidade.js' });
  return sandbox.PdvTefContinuidade || sandbox.globalThis.PdvTefContinuidade;
}

async function main() {
  const geradoEm = new Date().toISOString();
  console.log('=== MRT-38 — Hardening continuidade interativa (mocks) ===\n');

  delete process.env[REAL_TRANSACTION_ENV];
  assert.strictEqual(transacaoRealHabilitada(), false);
  limparRegistrosContinuidade();

  const resultados = [];
  const capacidades = {};
  const arquivosAlterados = [
    'backend/services/tef/destaxa/destaxaContinuidadeContrato.js',
    'backend/services/tef/adapters/DestaxaRealAdapter.js',
    'frontend/pdv/js/pdvTefContinuidade.js',
    'tests/tef/mrt-38-hardening-continuidade-interativa.test.js',
    'docs/build/mrt-38-hardening-continuidade-interativa-report.json'
  ];

  // --- Parse / 99 ---
  const class99 = classificarCodigoTransacao('99');
  const acaoParsed = parseAcaoSolicitada(SAIDA_99);
  resultados.push(ok('1) 99 → ACTION_REQUIRED e parse OPCAO com chave',
    class99.classificacao === CLASSIFICACAO_CODIGO.ACTION_REQUIRED
    && acaoParsed.tipo === TIPOS_ACAO.OPCAO
    && acaoParsed.chave === 'transacao_tipo_cartao'
    && acaoParsed.opcoes.join('|') === 'Credito|Debito|Voucher'));
  capacidades.interpretar99Opcao = 'IMPLEMENTADO';

  // --- Opções válidas literais ---
  for (const opcao of ['Credito', 'Debito', 'Voucher']) {
    limparRegistrosContinuidade();
    const v = validarContinuidadeCompleta({
      acao: ACAO_OPCAO,
      respostaBruta: opcao,
      transactionId: ID_MRT38.transactionId,
      idempotencyKeyInformada: ID_MRT38.idempotency_key,
      idempotencyKeyPersistida: ID_MRT38.idempotency_key
    });
    const entrada = buildContinuaInput(v.resposta);
    resultados.push(ok(`2) opção válida literal ${opcao} → informacao=${opcao}`,
      v.ok === true
      && v.resposta.informacao === opcao
      && entrada.texto === `informacao=${opcao}`
      && v.entradaContinuaEsperada === `informacao=${opcao}`));
  }
  capacidades.validarOpcaoLiteral = 'IMPLEMENTADO';
  capacidades.construirInformacao = 'IMPLEMENTADO';

  // --- Opção inválida ---
  limparRegistrosContinuidade();
  const invalida = validarContinuidadeCompleta({
    acao: ACAO_OPCAO,
    respostaBruta: 'Pix',
    transactionId: ID_MRT38.transactionId
  });
  resultados.push(ok('3) opção não oferecida rejeitada',
    invalida.ok === false && invalida.codigo === ERROS_CONTINUIDADE.OPCAO_INVALIDA));
  capacidades.rejeitarOpcaoInvalida = 'IMPLEMENTADO';

  // --- 99 ≠ aprovação / sem fila ---
  const bridgeSemFila = criarBridgeMock([
    { fn: 'inicia', codigo: '99', saida: SAIDA_99 }
  ]);
  const rSemFila = await executarCicloCrt({
    bridge: bridgeSemFila,
    camposEntrada: buildCrtInput({ valorCentavos: 100 }).campos,
    transactionId: ID_MRT38.transactionId,
    respostasContinuidade: []
  });
  resultados.push(ok('4) 99 sem fila → CONTINUIDADE_SEM_RESPOSTA; sem auto-aprovação; 1 TX_START',
    rSemFila.requerContinuacao === true
    && rSemFila.codigo === CICLO_ERROS.CONTINUIDADE_SEM_RESPOSTA
    && rSemFila.sucesso !== true
    && bridgeSemFila.contadores.inicia === 1
    && bridgeSemFila.contadores.continua === 0));
  capacidades.naoAprovar99 = 'IMPLEMENTADO';
  capacidades.semNovoTxStartNaContinuidade = 'IMPLEMENTADO';

  // --- Continuidade mock: Credito, mesma identidade, sem 2º TX_START ---
  limparRegistrosContinuidade();
  const bridgeOk = criarBridgeMock([
    { fn: 'inicia', codigo: '99', saida: SAIDA_99 },
    { fn: 'continua', codigo: '00', saida: '' },
    { fn: 'finaliza', codigo: '00', saida: '' }
  ]);
  const rStart = await executarCicloCrt({
    bridge: bridgeOk,
    camposEntrada: buildCrtInput({ valorCentavos: 100 }).campos,
    transactionId: ID_MRT38.transactionId,
    respostasContinuidade: []
  });
  assert.strictEqual(rStart.requerContinuacao, true);
  const iniciaAntes = bridgeOk.contadores.inicia;
  const rCont = await continuarCicloCrt({
    bridge: bridgeOk,
    transactionId: ID_MRT38.transactionId,
    respostaOperador: { informacao: 'Credito' },
    acaoAtual: acaoParsed
  });
  resultados.push(ok('5) CONTINUE mock Credito: mesma transactionId; zero TX_START extra',
    rCont.sucesso === true
    && bridgeOk.contadores.inicia === iniciaAntes
    && bridgeOk.contadores.continua >= 1
    && bridgeOk.txsRecebidos.every((id) => id === ID_MRT38.transactionId || id == null)
    && rCont.ciclo?.txStartExecutado === false));
  capacidades.correlacaoIdentidadeCiclo = 'IMPLEMENTADO';

  // --- Adapter.continuarPagamento mock ---
  limparRegistrosContinuidade();
  const bridgeAd = criarBridgeMock([
    { fn: 'continua', codigo: '00', saida: '' },
    { fn: 'finaliza', codigo: '00', saida: '' }
  ]);
  // Pré-aquecer orquestrador via start simulado no mesmo bridge driver path:
  // continuarCicloCrt não precisa de start prévio no mock driver se continua já está na fila.
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { bridge: bridgeAd, executionMode: 'in-process' }
  );
  const rAd = await adapter.continuarPagamento({
    transacao_id: ID_MRT38.transactionId,
    idempotency_key: ID_MRT38.idempotency_key,
    acao: ACAO_OPCAO,
    resposta_continuidade: { informacao: 'Credito' }
  });
  resultados.push(ok('6) Adapter.continuarPagamento monta continuidade sem TX_START',
    bridgeAd.contadores.inicia === 0
    && bridgeAd.contadores.continua >= 1
    && rAd.retryAllowed === false
    && (rAd.sucesso === true || rAd.requerContinuacao === true || rAd.codigo != null)));
  capacidades.adapterContinuarSemTxStart = 'IMPLEMENTADO';

  // --- Duplicata ---
  limparRegistrosContinuidade();
  const d1 = validarContinuidadeCompleta({
    acao: ACAO_OPCAO,
    respostaBruta: 'Credito',
    transactionId: ID_MRT38.transactionId
  });
  const d2 = validarContinuidadeCompleta({
    acao: ACAO_OPCAO,
    respostaBruta: 'Credito',
    transactionId: ID_MRT38.transactionId
  });
  resultados.push(ok('7) resposta duplicada bloqueada',
    d1.ok === true && d2.ok === false && d2.codigo === ERROS_CONTINUIDADE.RESPOSTA_DUPLICADA));
  capacidades.protecaoRespostaDuplicada = 'CORRIGIDO';

  // --- Timeout ---
  limparRegistrosContinuidade();
  const agora = Date.now();
  const to = avaliarTimeoutColeta({
    timeoutSegundos: 120,
    solicitadaEm: agora - 121000,
    agoraMs: agora
  });
  const toPipe = validarContinuidadeCompleta({
    acao: ACAO_OPCAO,
    respostaBruta: 'Credito',
    transactionId: 'tx-timeout-1',
    solicitadaEm: agora - 121000,
    agoraMs: agora
  });
  resultados.push(ok('8) timeout coleta → UNKNOWN hint; sem retry',
    to.ok === false
    && to.codigo === ERROS_CONTINUIDADE.TIMEOUT
    && to.financialStateHint === 'UNKNOWN'
    && toPipe.ok === false
    && toPipe.retryAllowed === false));
  capacidades.protecaoTimeout = 'CORRIGIDO';

  // --- Sem operador / sem TTY ---
  const semTty = avaliarDisponibilidadeOperador({ tty: false });
  const semOp = avaliarDisponibilidadeOperador({ forcarSemOperador: true });
  const pdv = carregarPdvContinuidade();
  const headless = await pdv.conduzirContinuidade({
    requerContinuacao: true,
    acao: ACAO_OPCAO,
    transacao_id: ID_MRT38.transactionId,
    idempotency_key: ID_MRT38.idempotency_key
  }, { apiUrl: 'http://localhost', idempotencyKey: ID_MRT38.idempotency_key });
  const solTty = await pdv.solicitarRespostaOperador(ACAO_OPCAO);
  resultados.push(ok('9) sem TTY/operador falha explícita (não silenciosa)',
    semTty.codigo === ERROS_CONTINUIDADE.SEM_TTY
    && semOp.codigo === ERROS_CONTINUIDADE.SEM_OPERADOR
    && headless.codigo === 'DESTAXA_PDV_SEM_TTY'
    && solTty.codigo === 'DESTAXA_PDV_SEM_TTY'
    && headless.retryAllowed === false));
  capacidades.protecaoSemTty = 'CORRIGIDO';

  // --- Identidade divergente / ausente ---
  limparRegistrosContinuidade();
  const idDiv = validarContinuidadeCompleta({
    acao: ACAO_OPCAO,
    respostaBruta: 'Credito',
    transactionId: ID_MRT38.transactionId,
    idempotencyKeyInformada: 'outra-chave',
    idempotencyKeyPersistida: ID_MRT38.idempotency_key
  });
  const idAus = validarContinuidadeCompleta({
    acao: ACAO_OPCAO,
    respostaBruta: 'Credito',
    transactionId: null
  });
  resultados.push(ok('10) correlação identidade: divergente e ausente bloqueados',
    idDiv.codigo === ERROS_CONTINUIDADE.IDENTIDADE_DIVERGENTE
    && idAus.codigo === ERROS_CONTINUIDADE.IDENTIDADE_AUSENTE));
  capacidades.correlacaoIdentidadePedido = 'IMPLEMENTADO';

  // --- Pedido HTTP / PDV validarResposta ---
  const pedido = montarPedidoContinuidade({
    transacaoId: ID_MRT38.transactionId,
    idempotencyKey: ID_MRT38.idempotency_key,
    resposta: { informacao: 'Credito' },
    acao: ACAO_OPCAO
  });
  const vPdv = pdv.validarResposta(ACAO_OPCAO, 'Debito');
  const vPdvBad = pdv.validarResposta(ACAO_OPCAO, 'Cheque');
  resultados.push(ok('11) PDV validarResposta + pedido /continuar sem novo TX',
    pedido.nao_iniciar_tx === true
    && pedido.transacao_id != null
    && vPdv.ok && vPdv.resposta.informacao === 'Debito'
    && vPdvBad.ok === false
    && ehSolicitacaoContinuidade({ requerContinuacao: true }) === true));
  capacidades.transportePdvApi = 'IMPLEMENTADO';

  // --- Perda de comunicação / timeout no CONTINUE ---
  const bridgeTo = criarBridgeMock([
    { fn: 'inicia', codigo: '99', saida: SAIDA_99 }
  ], { timeoutContinue: true });
  await executarCicloCrt({
    bridge: bridgeTo,
    camposEntrada: buildCrtInput({ valorCentavos: 100 }).campos,
    transactionId: 'tx-to-cont',
    respostasContinuidade: []
  });
  const rToCont = await continuarCicloCrt({
    bridge: bridgeTo,
    transactionId: 'tx-to-cont',
    respostaOperador: { informacao: 'Credito' },
    acaoAtual: ACAO_OPCAO
  });
  resultados.push(ok('12) timeout/perda em CONTINUE → inconclusivo; sem retry; sem novo TX_START',
    rToCont.inconclusivo === true
    && rToCont.retryAllowed === false
    && bridgeTo.contadores.inicia === 1));
  capacidades.perdaComunicacaoContinue = 'IMPLEMENTADO';

  // --- Ausência de operador (resposta vazia) ---
  limparRegistrosContinuidade();
  const ausente = validarRespostaOperador(ACAO_OPCAO, null);
  resultados.push(ok('13) ausência de seleção OPCAO',
    ausente.ok === false && ausente.codigo === ERROS_CONTINUIDADE.OPCAO_AUSENTE));
  capacidades.ausenciaOperador = 'IMPLEMENTADO';

  // --- Gate OFF + identidades MRT-24/36 não usadas ---
  const m24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-24-primeira-crt-homologacao-report.json'), 'utf8'));
  const m36 = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/build/mrt-36-crt-controlada-destaxa-report.json'), 'utf8'));
  resultados.push(ok('14) gate OFF; IDs de teste ≠ MRT-24/36',
    transacaoRealHabilitada() === false
    && ID_MRT38.idempotency_key !== m36.identidade?.idempotency_key
    && ID_MRT38.transactionId !== String(m36.identidade?.transactionId)
    && ID_MRT38.idempotency_key !== m24.execucao?.transactionId));
  capacidades.preservacaoUnknown = 'IMPLEMENTADO';

  // --- Código-fonte: rota /continuar e TefManager sem TX_START na continuidade ---
  const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/tef.js'), 'utf8');
  const tm = fs.readFileSync(path.join(ROOT, 'backend/services/tef/TefManager.js'), 'utf8');
  const cicloSrc = fs.readFileSync(path.join(ROOT, 'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js'), 'utf8');
  const adapterSrc = fs.readFileSync(
    path.join(ROOT, 'backend/services/tef/adapters/DestaxaRealAdapter.js'),
    'utf8'
  );
  resultados.push(ok('15) audit estático: /continuar → continuarAutorizacao; continuarCicloCrt sem TX_START',
    /post\('\/continuar'/.test(rota)
    && /continuarAutorizacao/.test(tm)
    && /NUNCA chama TX_START/.test(cicloSrc)
    && /validarContinuidadeCompleta/.test(adapterSrc)));
  capacidades.fluxoApiTefManager = 'IMPLEMENTADO';

  const report = {
    sprint: 'MRT-38',
    title: 'Hardening da continuidade interativa Destaxa',
    generatedAt: geradoEm,
    classificacaoGeral: 'CORRIGIDO',
    identidades: {
      usadasNosTestes: ID_MRT38,
      mrt24NaoReutilizada: true,
      mrt36NaoReutilizada: true,
      unknownPreservado: true
    },
    capacidades,
    sequenciaValidada: [
      'receber 99',
      'interpretar OPCAO',
      'exibir opções (contrato PDV)',
      'receber seleção literal',
      'validar opção',
      'construir informacao=Credito',
      'correlacionar identidade',
      'continuarCicloCrt mock (sem TX_START)'
    ],
    garantias: {
      nenhumNovoTxStartNaContinuidade: true,
      nenhumaNovaIdentidade: true,
      nenhumaAprovacaoAutomatica99: true,
      nenhumRetryAutomatico: true,
      rejeicaoOpcaoNaoOferecida: true,
      protecaoRespostaDuplicada: true,
      protecaoTimeout: true,
      falhaExplicitaSemTty: true,
      preservacaoUnknown: true
    },
    arquivosAlterados,
    testes: {
      arquivo: 'tests/tef/mrt-38-hardening-continuidade-interativa.test.js',
      resultados,
      totalOk: resultados.length
    },
    riscosResiduais: [
      'TefManager.continuarAutorizacao ainda depende de DB real em produção — não exercitado financeiramente nesta sprint',
      'Anti-duplicata é por processo (Map em memória); reinício do Node limpa o registro',
      'Timeout PDV no modal só aplica se acao.timeout vier preenchido do provedor',
      'Continuidade financeira real (CONTINUE na DLL) permanece fora de escopo até autorização futura'
    ],
    restricoesObservadas: {
      gateOff: true,
      init: false,
      dllReal: false,
      nativeHostReal: false,
      vspague: false,
      crtFinanceira: false,
      continueFinanceiro: false,
      est: false,
      dbProducao: false
    },
    confirmacoes: {
      gateOff: true,
      zeroOperacoesFinanceiras: true,
      mrt24NaoReutilizada: true,
      mrt36NaoReutilizada: true,
      semMecanismoParalelo: true
    },
    recomendacao: 'Aguardar Tech Lead. Não iniciar MRT-39 automaticamente. Próxima CRT/CONTINUE real só com PO + PDV com UI e gate pontual.'
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${REPORT_PATH}`);
  console.log('Classificação geral:', report.classificacaoGeral);
  console.log(`Testes OK: ${resultados.length}`);
  console.log('Gate OFF:', transacaoRealHabilitada() === false);
  console.log('Aguardando Tech Lead. Não iniciar MRT-39.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
