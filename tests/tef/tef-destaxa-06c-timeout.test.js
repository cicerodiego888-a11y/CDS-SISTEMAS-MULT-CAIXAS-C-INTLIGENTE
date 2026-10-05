/**
 * TEF-DESTAXA-06C-TIMEOUT — contrato de timeout antes da primeira transação.
 *
 * TefManager real → adapter (mapeamento real do DestaxaRealAdapter) → DestaxaHostBridge
 * → TEF Native Host em modo de teste (driver mock no orquestrador real, processo isolado).
 * Repositório/lock/fraude/notificação/circuit breaker substituídos por stubs em memória:
 * nenhuma linha em tef_transacoes. Validação nativa real: somente LOAD/INIT_CLIENT com tripwire.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada na 06C-TIMEOUT`);
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '../..');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-06c-timeout-report.json');
const DOCS_OFICIAIS = process.env.DESTAXA_DOCS_DIR
  || 'C:\\Users\\cicer\\Desktop\\DLL DESTAXA\\1_83-20260831T165940Z-1-001\\1_83';

const TIMEOUT_CDS_MS = 300;
const BLOQUEIO_NATIVO_MS = 1200;

// ------------------------------------------------ stubs antes do TefManager
const tefFactory = require('../../backend/services/tef/tefFactory');
let adapterAtual = null;
tefFactory.obterAdapter = async () => adapterAtual;

const repository = require('../../backend/services/tef/tefRepository');
const registros = { criadas: [], atualizacoes: [], logs: [] };
let proximoId = 96000;
let atrasoCriacaoMs = 0;
const statusEmMemoria = new Map();
repository.criarTransacao = (dados, cb) => {
  const id = ++proximoId;
  registros.criadas.push({ id, ...dados });
  statusEmMemoria.set(id, { ...dados, status: dados.status || 'pendente' });
  setTimeout(() => cb(null, id), atrasoCriacaoMs);
};
repository.criarTransacaoExclusiva = (dados, cb) => {
  if ([...statusEmMemoria.values()].some((linha) => linha.status === 'pendente')) {
    return setTimeout(() => cb(null, null), atrasoCriacaoMs);
  }
  return repository.criarTransacao({ ...dados, status: 'pendente' }, cb);
};
repository.listarTransacoesPendentes = (cb) => {
  const linhas = [...statusEmMemoria.entries()]
    .filter(([, linha]) => linha.status === 'pendente')
    .map(([id, linha]) => ({ id, status: 'pendente', provedor: linha.provedor, tipo: linha.tipo, payload_retorno: linha.payload_retorno || null }));
  setImmediate(() => cb(null, linhas));
};
repository.atualizarTransacao = (id, dados, cb) => {
  registros.atualizacoes.push({ id, ...dados });
  const linha = statusEmMemoria.get(Number(id));
  if (linha && dados.status) linha.status = dados.status;
  setImmediate(() => cb && cb(null));
};
repository.registrarLog = (id, tipo, mensagem, payload) => {
  registros.logs.push({ id, tipo, mensagem, payload });
};
require('../../backend/services/tef/tefLockService').comLock = async (_chave, fn) => fn();
require('../../backend/services/tef/tefFraudDetectionService').analisarTransacao = async () => ({ suspeita: false });
const notificacoes = require('../../backend/services/tef/tefFailureNotificationService');
notificacoes.notificarFalhaTimeout = async () => {};
notificacoes.notificarFalhaGenerica = async () => {};
require('../../backend/services/tef/tefCircuitBreakerService').executarComCircuitBreaker = async (_nome, fn) => fn();
require('../../backend/services/tef/tefFiscalValidator').validarTransacao = () => ({ valido: true, erros: [] });

const TefManager = require('../../backend/services/tef/TefManager');
const { ESTADOS_TRAVA_RESULTADO_TARDIO } = TefManager;
const destaxaKoffiLoader = require('../../backend/services/tef/destaxa/destaxaKoffiLoader');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const { DestaxaNativeHostClient, ESTADOS_CLIENTE } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { TEST_MODE_ENV } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const { OPERACOES_HOST, ERROS_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const verificador = require('../../backend/services/tef/destaxa/destaxaNativeHostVerifier');
const {
  FINANCIAL_STATES,
  LATE_RESULT_RESOLUTIONS,
  decidirResultadoTardio
} = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const {
  ERROS,
  OPERACOES,
  CONTRATO_TIMEOUT_DESTAXA,
  DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const tefContrato = require('../../backend/services/tef/tefContrato');

let passou = 0;
let falhou = 0;
const falhas = [];
const executados = [];

async function test(nome, fn) {
  executados.push(nome);
  try {
    await fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    falhas.push(nome);
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarLog(tipo, id, ms = 15000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const log = registros.logs.find((l) => l.tipo === tipo && String(l.id) === String(id));
    if (log) return log;
    await aguardar(20);
  }
  return null;
}

function consultarDb(sql) {
  const db = require('../../backend/database');
  return new Promise((resolve, reject) => {
    db.whenReady((erro) => {
      if (erro) return reject(erro);
      db.get(sql, [], (e, row) => (e ? reject(e) : resolve(row)));
    });
  });
}

async function contarTransacoes24h() {
  const row = await consultarDb("SELECT COUNT(*) AS n FROM tef_transacoes WHERE criado_em >= datetime('now','-1 day')");
  return row.n;
}

const DADOS = Object.freeze({ tipo: 'credito', valor: 1.0 });

function criarAdapterHost(bridge) {
  const base = new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, { bridge });
  const adapter = {
    nome: base.nome,
    contratoTimeout: base.contratoTimeout,
    chamadas: 0,
    transactionIds: [],
    async prepararAutorizacao() {
      return { pronto: true, contexto: { clientInitializationCode: '00' } };
    },
    async autorizarPagamento(_dados, preparacao) {
      adapter.chamadas += 1;
      adapter.transactionIds.push(preparacao.transactionId);
      const r = await bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, {
        transactionId: preparacao.transactionId
      });
      return base._mapearResultadoCrt(r, preparacao.contexto);
    }
  };
  return adapter;
}

function ultimaAtualizacao(id) {
  return registros.atualizacoes.filter((a) => String(a.id) === String(id)).pop() || null;
}

/** Autorização com chamada nativa acima do timeout do CDS e desfecho tardio `codigo`. */
async function cenarioTardio(cliente, bridge, passo) {
  const adapter = criarAdapterHost(bridge);
  adapterAtual = adapter;
  await bridge.configurarDriverTransacaoMock([{ fn: 'inicia', bloqueioMs: BLOQUEIO_NATIVO_MS, ...passo }]);
  const criadasAntes = registros.criadas.length;

  let ultimo = Date.now();
  let maiorIntervalo = 0;
  let ticks = 0;
  const hb = setInterval(() => {
    const agora = Date.now();
    maiorIntervalo = Math.max(maiorIntervalo, agora - ultimo);
    ultimo = agora;
    ticks += 1;
  }, 10);

  const inicio = Date.now();
  const resposta = await TefManager.autorizar({ ...DADOS }, TIMEOUT_CDS_MS);
  const respondidoEmMs = Date.now() - inicio;
  const travaDurante = TefManager.obterTravaResultadoTardio();
  const hostDurante = cliente.getEstado();
  const segunda = await TefManager.autorizar({ ...DADOS }, TIMEOUT_CDS_MS);
  let reconciliacaoPrematura = null;
  try {
    TefManager.reconciliarResultadoTardio(resposta.transacao_id, {
      financialState: FINANCIAL_STATES.CONFIRMED_SUCCESS, usuario: 'teste-06c', observacao: 'prematura'
    });
  } catch (error) {
    reconciliacaoPrematura = error.code;
  }
  const log = await esperarLog('RESULTADO_TARDIO', resposta.transacao_id);
  const duracaoTotalMs = Date.now() - inicio;
  clearInterval(hb);

  const travaDepois = TefManager.obterTravaResultadoTardio();
  const segundaAposDesfecho = await TefManager.autorizar({ ...DADOS }, TIMEOUT_CDS_MS);
  const status = passo.crashHost ? null : await cliente.enviar(OPERACOES_HOST.STATUS);
  return {
    adapter,
    resposta,
    respondidoEmMs,
    duracaoTotalMs,
    travaDurante,
    hostDurante,
    segunda,
    segundaAposDesfecho,
    reconciliacaoPrematura,
    log,
    travaDepois,
    atualizacao: ultimaAtualizacao(resposta.transacao_id),
    novasLinhas: registros.criadas.length - criadasAntes,
    mockInicia: status ? status.output.mockContadores.iniciaTransacaoDestaxa : null,
    hostPidDepois: status ? status.output.pid : null,
    maiorIntervalo,
    ticks
  };
}

function reconciliar(id, financialState = 'CANCELLED') {
  return TefManager.reconciliarResultadoTardio(id, { financialState, usuario: 'teste-06c', observacao: 'reconciliação de teste (mock)' });
}

function verificarDocumentacaoOficial() {
  const docsDir = path.join(DOCS_OFICIAIS, 'docs');
  const disponivel = fs.existsSync(docsDir);
  const fontes = CONTRATO_TIMEOUT_DESTAXA.sources.map((rel) => ({
    source: rel,
    found: fs.existsSync(path.join(DOCS_OFICIAIS, rel))
  }));
  if (!disponivel) return { disponivel, fontes, ocorrenciasTimeout: [] };
  const ocorrenciasTimeout = [];
  for (const nome of fs.readdirSync(docsDir).filter((n) => n.endsWith('.md'))) {
    const linhas = fs.readFileSync(path.join(docsDir, nome), 'utf8').split(/\r?\n/);
    linhas.forEach((linha, i) => {
      if (/timeout|tempo limite|tempo máximo/i.test(linha)) ocorrenciasTimeout.push({ arquivo: `docs/${nome}`, linha: i + 1, texto: linha.trim() });
    });
  }
  for (const rel of ['examples/clang/src/main.c', 'examples/dotnet/Program.cs', 'examples/java/app/src/main/java/com/destaxa/example/App.java']) {
    const arquivo = path.join(DOCS_OFICIAIS, rel);
    if (!fs.existsSync(arquivo)) continue;
    fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).forEach((linha, i) => {
      if (/timeout/i.test(linha)) ocorrenciasTimeout.push({ arquivo: rel, linha: i + 1, texto: linha.trim() });
    });
  }
  return { disponivel, fontes, ocorrenciasTimeout };
}

async function main() {
  console.log('\nTEF-DESTAXA-06C-TIMEOUT — CONTRATO DE TIMEOUT (mocks/stubs, sem transação)\n');

  let cargasDllMain = 0;
  const carregarOriginal = destaxaKoffiLoader.carregarBiblioteca;
  destaxaKoffiLoader.carregarBiblioteca = function contar(...args) {
    cargasDllMain += 1;
    return carregarOriginal.apply(this, args);
  };

  const transacoesAntes = await contarTransacoes24h();
  const evidencias = { cenarios: {}, regressoes: [] };

  await test('segurança: gate financeiro desabilitado', () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  // ------------------------------------------------ documentação oficial
  let documentacao = null;
  await test('documentação: nenhum timeout global/CRT documentado; somente campo timeout de COLETA (segundos) e código 08', () => {
    assert.strictEqual(CONTRATO_TIMEOUT_DESTAXA.globalTimeout, DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO);
    assert.strictEqual(CONTRATO_TIMEOUT_DESTAXA.coleta.unidade, 'segundos');
    assert.strictEqual(CONTRATO_TIMEOUT_DESTAXA.coleta.timeoutTotalDaTransacao, false);
    assert.strictEqual(CONTRATO_TIMEOUT_DESTAXA.chamadaEmAndamento.limite, null);
    documentacao = verificarDocumentacaoOficial();
    assert.strictEqual(documentacao.disponivel, true, `documentação oficial não encontrada em ${DOCS_OFICIAIS}`);
    assert.deepStrictEqual(documentacao.fontes.filter((f) => !f.found), []);
    const arquivos = [...new Set(documentacao.ocorrenciasTimeout.map((o) => o.arquivo))].sort();
    assert.deepStrictEqual(arquivos, ['docs/09-tabela-codigos-de-retorno.md', 'docs/10-acoes-de-coleta.md']);
    const coleta = documentacao.ocorrenciasTimeout.find((o) => /tempo máximo em segundos/.test(o.texto));
    assert.ok(coleta && coleta.arquivo === 'docs/10-acoes-de-coleta.md');
    assert.ok(documentacao.ocorrenciasTimeout.some((o) => /`08`.*Tempo limite de espera excedido/.test(o.texto)));
  });

  await test('contrato: timeout do CDS inalterado (sem número novo) e adapter declara resultado tardio sem cancelamento físico', () => {
    assert.strictEqual(TefManager.timeout, Number(process.env.TEF_TIMEOUT_MS) || 30000);
    const adapter = new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, { bridge: {} });
    assert.strictEqual(adapter.contratoTimeout.resultadoTardio, true);
    assert.strictEqual(adapter.contratoTimeout.cancelamentoFisico, false);
    assert.strictEqual(adapter.contratoTimeout.timeoutGlobalDestaxa, DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO);
  });

  await test('política: resultado tardio 00/03/04/09/08/A0/A1/99/HOST_CRASHED', () => {
    const casos = {
      '00': [FINANCIAL_STATES.CONFIRMED_SUCCESS, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED],
      '03': [FINANCIAL_STATES.CONFIRMED_DENIED, LATE_RESULT_RESOLUTIONS.FINAL_DENIED],
      '04': [FINANCIAL_STATES.CONFIRMED_DENIED, LATE_RESULT_RESOLUTIONS.FINAL_DENIED],
      '09': [FINANCIAL_STATES.CONFIRMED_DENIED, LATE_RESULT_RESOLUTIONS.FINAL_DENIED],
      '08': [FINANCIAL_STATES.UNKNOWN, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED],
      A0: [FINANCIAL_STATES.UNCONFIRMED, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED],
      A1: [FINANCIAL_STATES.BLOCKED, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED],
      99: [FINANCIAL_STATES.PENDING, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED],
      HOST_CRASHED: [FINANCIAL_STATES.UNKNOWN, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED]
    };
    for (const [codigo, [estado, resolucao]] of Object.entries(casos)) {
      const d = decidirResultadoTardio({ codigo });
      assert.strictEqual(d.financialState, estado, codigo);
      assert.strictEqual(d.resolution, resolucao, codigo);
      assert.strictEqual(d.retryAllowed, false, codigo);
      assert.strictEqual(d.newAuthorizationAllowed, false, codigo);
      assert.strictEqual(d.releaseLock, resolucao === LATE_RESULT_RESOLUTIONS.FINAL_DENIED, codigo);
    }
  });

  const cliente = new DestaxaNativeHostClient({ env: { [TEST_MODE_ENV]: '1' }, timeoutMs: 15000 });
  const bridge = new DestaxaHostBridge({ client: cliente });

  try {
    // ------------------------------------------------ 1: abaixo do timeout
    await test('1: chamada abaixo do timeout → resultado normal, sem trava', async () => {
      const adapter = criarAdapterHost(bridge);
      adapterAtual = adapter;
      await bridge.configurarDriverTransacaoMock([{ fn: 'inicia', codigo: '00', saida: 'transacao_nsu=100001', bloqueioMs: 50 }]);
      const r = await TefManager.autorizar({ ...DADOS }, 10000);
      assert.strictEqual(r.status, tefContrato.STATUS.APROVADO);
      assert.notStrictEqual(r.codigo, 'TIMEOUT');
      assert.strictEqual(TefManager.obterTravaResultadoTardio(), null);
      assert.strictEqual(adapter.chamadas, 1);
      assert.strictEqual(registros.logs.some((l) => l.tipo === 'RESULTADO_TARDIO' && String(l.id) === String(r.transacao_id)), false);
    });

    // ------------------------------------------------ transporte IPC
    await test('transporte: operação transacional sem timeout de IPC padrão (cliente com 200ms não expira TX_START de 700ms)', async () => {
      const curto = new DestaxaNativeHostClient({ env: { [TEST_MODE_ENV]: '1' }, timeoutMs: 200, timeoutInicioMs: 20000 });
      const b = new DestaxaHostBridge({ client: curto });
      try {
        await b.configurarDriverTransacaoMock([{ fn: 'inicia', codigo: '00', saida: '', bloqueioMs: 700 }]);
        const r = await b.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: 'tx-ipc' });
        assert.strictEqual(r.codigoDestaxa, '00');
        assert.notStrictEqual(r.codigo, ERROS_HOST.HOST_TIMEOUT);
      } finally {
        await curto.encerrar();
      }
    });

    // ------------------------------------------------ 2–5, 6, 11–17: 00 tardio
    const c00 = await cenarioTardio(cliente, bridge, { codigo: '00', saida: 'transacao_nsu=100002;transacao_autorizacao=654321' });
    evidencias.cenarios['00'] = c00;

    await test('2: chamada acima do timeout → TIMEOUT/PENDENTE (UNKNOWN) com o mesmo transactionId', () => {
      assert.strictEqual(c00.resposta.codigo, 'TIMEOUT');
      assert.strictEqual(c00.resposta.status, tefContrato.STATUS.PENDENTE);
      assert.strictEqual(c00.resposta.financialState, FINANCIAL_STATES.UNKNOWN);
      assert.strictEqual(c00.resposta.retryAllowed, false);
      assert.strictEqual(String(c00.resposta.transacao_id), c00.adapter.transactionIds[0]);
      assert.ok(c00.respondidoEmMs < BLOQUEIO_NATIVO_MS, `respondido em ${c00.respondidoEmMs}ms`);
    });

    await test('3: Main continua responsivo durante a chamada nativa acima do timeout', () => {
      assert.ok(c00.maiorIntervalo < 250, `maior intervalo ${c00.maiorIntervalo}ms`);
      assert.ok(c00.ticks >= Math.floor(c00.duracaoTotalMs / 10) * 0.5, `ticks ${c00.ticks} em ${c00.duracaoTotalMs}ms`);
    });

    await test('4: Main marca UNKNOWN sem matar o Host (host ocupado com a mesma operação)', () => {
      assert.strictEqual(c00.hostDurante.estado, ESTADOS_CLIENTE.BUSY);
      assert.strictEqual(c00.travaDurante.estado, ESTADOS_TRAVA_RESULTADO_TARDIO.AGUARDANDO_RESULTADO);
      assert.strictEqual(c00.hostPidDepois, c00.hostDurante.pid);
    });

    await test('5: Host continua a operação até o fim e entrega o desfecho', () => {
      assert.ok(c00.log, 'RESULTADO_TARDIO não registrado');
      assert.strictEqual(c00.mockInicia, 1);
      assert.ok(c00.duracaoTotalMs >= BLOQUEIO_NATIVO_MS - 50);
    });

    await test('6: 00 tardio → CONFIRMED_SUCCESS registrado, linha permanece pendente até reconciliação', () => {
      assert.strictEqual(c00.log.payload.financialState, FINANCIAL_STATES.CONFIRMED_SUCCESS);
      assert.strictEqual(c00.log.payload.resolution, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED);
      assert.strictEqual(c00.atualizacao.status, tefContrato.STATUS.PENDENTE);
      assert.strictEqual(c00.atualizacao.nsu, '100002');
      assert.strictEqual(c00.atualizacao.payload_retorno.resultadoTardio.codigo, '00');
      assert.strictEqual(registros.atualizacoes.some((a) => String(a.id) === String(c00.resposta.transacao_id) && a.status === tefContrato.STATUS.APROVADO), false);
      assert.strictEqual(c00.travaDepois.estado, ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE);
    });

    await test('11–13: nenhum retry, nenhum novo transactionId, nenhuma nova cobrança', () => {
      assert.strictEqual(c00.adapter.chamadas, 1);
      assert.strictEqual(c00.mockInicia, 1);
      assert.strictEqual(c00.novasLinhas, 1);
      assert.deepStrictEqual(c00.adapter.transactionIds, [String(c00.resposta.transacao_id)]);
      assert.strictEqual(c00.log.payload.transactionId, String(c00.resposta.transacao_id));
      assert.strictEqual(c00.log.payload.retryAllowed, false);
    });

    await test('14: segunda autorização bloqueada durante a chamada e após 00 tardio (antes de qualquer linha/adapter)', () => {
      for (const r of [c00.segunda, c00.segundaAposDesfecho]) {
        assert.strictEqual(r.codigo, 'TEF_RESULTADO_PENDENTE');
        assert.strictEqual(r.transacaoId, null);
        assert.strictEqual(r.transacao_pendente_id, String(c00.resposta.transacao_id));
        assert.strictEqual(r.retryAllowed, false);
      }
    });

    await test('14: adapter real bloqueia no host ocupado (HOST_BUSY) antes da DLL e sem transactionId', async () => {
      const adapter = criarAdapterHost(bridge);
      adapterAtual = adapter;
      await bridge.configurarDriverTransacaoMock([{ fn: 'inicia', codigo: '00', saida: '', bloqueioMs: 800 }]);
      const emCurso = bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' }, { transactionId: 'tx-host-lock' });
      await aguardar(100);
      const real = new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, {
        bridge,
        configService: {
          obterConfiguracao: async () => ({ tefProvedor: 'destaxa', pinpadHabilitado: 'true', portaCom: 'COM3' }),
          validarConfiguracao: () => ({ valida: true, pendencias: [] })
        },
        sdkDetector: { detectarVsPagueClient: () => { throw new Error('não deve ser chamado'); } }
      });
      const prep = await real.prepararAutorizacao({ tipo: 'credito', valor: 1.0 });
      assert.strictEqual(prep.pronto, false);
      assert.strictEqual(prep.resposta.codigo, ERROS_HOST.HOST_BUSY);
      assert.strictEqual(prep.resposta.transacaoId, null);
      await emCurso;
    });

    await test('15–16: lock preservado; reconciliação prematura recusada; liberação somente por reconciliação explícita', () => {
      assert.strictEqual(c00.reconciliacaoPrematura, 'TEF_RECONCILIACAO_PREMATURA');
      const id = c00.resposta.transacao_id;
      assert.throws(() => TefManager.reconciliarResultadoTardio('999999', { financialState: 'CANCELLED', usuario: 'x', observacao: 'x' }), { code: 'TEF_RECONCILIACAO_SEM_TRAVA' });
      assert.throws(() => TefManager.reconciliarResultadoTardio(id, { financialState: 'QUALQUER', usuario: 'x', observacao: 'x' }), { code: 'TEF_RECONCILIACAO_INVALIDA' });
      assert.throws(() => TefManager.reconciliarResultadoTardio(id, { financialState: FINANCIAL_STATES.CONFIRMED_SUCCESS }), { code: 'TEF_RECONCILIACAO_INVALIDA' });
      assert.ok(TefManager.obterTravaResultadoTardio());
      const r = reconciliar(id, FINANCIAL_STATES.CONFIRMED_SUCCESS);
      assert.strictEqual(r.status, tefContrato.STATUS.APROVADO);
      assert.strictEqual(r.travaLiberada, true);
      assert.strictEqual(TefManager.obterTravaResultadoTardio(), null);
      assert.strictEqual(ultimaAtualizacao(id).status, tefContrato.STATUS.APROVADO);
      assert.ok(registros.logs.some((l) => l.tipo === 'RECONCILIACAO_RESULTADO_TARDIO' && String(l.id) === String(id)));
    });

    // ------------------------------------------------ 7: 03 tardio
    const c03 = await cenarioTardio(cliente, bridge, { codigo: '03', saida: '' });
    evidencias.cenarios['03'] = c03;
    await test('7: 03 tardio → CONFIRMED_DENIED, linha negada, lock liberado automaticamente', () => {
      assert.strictEqual(c03.resposta.codigo, 'TIMEOUT');
      assert.strictEqual(c03.segunda.codigo, 'TEF_RESULTADO_PENDENTE');
      assert.strictEqual(c03.log.payload.financialState, FINANCIAL_STATES.CONFIRMED_DENIED);
      assert.strictEqual(c03.log.payload.resolution, LATE_RESULT_RESOLUTIONS.FINAL_DENIED);
      assert.strictEqual(c03.atualizacao.status, tefContrato.STATUS.NEGADO);
      assert.strictEqual(c03.travaDepois, null);
      assert.strictEqual(c03.adapter.chamadas, 2, 'somente a autorização liberada após a negação chega ao adapter');
    });
    // A autorização liberada após o 03 roda contra o mock já consumido e termina dentro do prazo.
    assert.strictEqual(TefManager.obterTravaResultadoTardio(), null);

    // ------------------------------------------------ 8–10: 08, A0, A1
    for (const [codigo, estado, nome] of [
      ['08', FINANCIAL_STATES.UNKNOWN, '8: 08 tardio → UNKNOWN'],
      ['A0', FINANCIAL_STATES.UNCONFIRMED, '9: A0 tardio → UNCONFIRMED'],
      ['A1', FINANCIAL_STATES.BLOCKED, '10: A1 tardio → BLOCKED']
    ]) {
      const c = await cenarioTardio(cliente, bridge, { codigo, saida: '' });
      evidencias.cenarios[codigo] = c;
      await test(`${nome}, linha pendente, lock mantido até reconciliação, sem retry`, () => {
        assert.strictEqual(c.resposta.codigo, 'TIMEOUT');
        assert.strictEqual(c.log.payload.financialState, estado);
        assert.strictEqual(c.log.payload.resultCode, codigo);
        assert.strictEqual(c.log.payload.resolution, LATE_RESULT_RESOLUTIONS.RECONCILIATION_REQUIRED);
        assert.strictEqual(c.log.payload.retryAllowed, false);
        assert.strictEqual(c.atualizacao.status, tefContrato.STATUS.PENDENTE);
        assert.strictEqual(c.travaDepois.estado, ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE);
        assert.strictEqual(c.segundaAposDesfecho.codigo, 'TEF_RESULTADO_PENDENTE');
        assert.strictEqual(c.adapter.chamadas, 1);
        assert.strictEqual(c.novasLinhas, 1);
        assert.strictEqual(c.mockInicia, 1);
      });
      reconciliar(c.resposta.transacao_id);
    }

    // ------------------------------------------------ timeout antes do envio
    await test('timeout antes do envio ao adapter → autorização nunca enviada, linha em erro, sem trava', async () => {
      const adapter = criarAdapterHost(bridge);
      adapterAtual = adapter;
      await bridge.configurarDriverTransacaoMock([{ fn: 'inicia', codigo: '00', saida: '' }]);
      atrasoCriacaoMs = 400;
      let r;
      try {
        r = await TefManager.autorizar({ ...DADOS }, 100);
      } finally {
        atrasoCriacaoMs = 0;
      }
      assert.strictEqual(r.codigo, 'TIMEOUT');
      await aguardar(600);
      const id = registros.criadas[registros.criadas.length - 1].id;
      assert.strictEqual(adapter.chamadas, 0);
      assert.strictEqual(ultimaAtualizacao(id).status, tefContrato.STATUS.ERRO);
      assert.ok(registros.logs.some((l) => l.tipo === 'TIMEOUT_ANTES_DO_ENVIO' && l.id === id));
      assert.strictEqual(TefManager.obterTravaResultadoTardio(), null);
      const status = await cliente.enviar(OPERACOES_HOST.STATUS);
      assert.strictEqual(status.output.mockContadores.iniciaTransacaoDestaxa, 0);
    });

    // ------------------------------------------------ 17: isolamento
    await test('17: host continua isolado (processo separado, DLL nunca carregada no Main)', () => {
      const estado = cliente.getEstado();
      assert.strictEqual(estado.estado, ESTADOS_CLIENTE.READY);
      assert.notStrictEqual(estado.pid, process.pid);
      assert.strictEqual(estado.processType, 'child_process');
      assert.strictEqual(cargasDllMain, 0);
    });

    // ------------------------------------------------ 18: crash durante UNKNOWN
    const cCrash = await cenarioTardio(cliente, bridge, { codigo: '00', saida: '', bloqueioMs: 800, crashHost: true });
    evidencias.cenarios.crash = cCrash;
    await test('18: queda do host durante UNKNOWN → UNKNOWN/reconciliação, Main vivo, nada aprovado/negado, sem nova cobrança', async () => {
      assert.strictEqual(cCrash.resposta.codigo, 'TIMEOUT');
      assert.ok(cCrash.log, 'desfecho da queda não registrado');
      assert.strictEqual(cCrash.log.payload.resultCode, ERROS_HOST.HOST_CRASHED);
      assert.strictEqual(cCrash.log.payload.financialState, FINANCIAL_STATES.UNKNOWN);
      assert.strictEqual(cCrash.atualizacao.status, tefContrato.STATUS.PENDENTE);
      assert.strictEqual(cCrash.travaDepois.estado, ESTADOS_TRAVA_RESULTADO_TARDIO.RECONCILIACAO_PENDENTE);
      assert.strictEqual(cCrash.segundaAposDesfecho.codigo, 'TEF_RESULTADO_PENDENTE');
      assert.strictEqual(cCrash.adapter.chamadas, 1);
      const estado = cliente.getEstado();
      assert.strictEqual(estado.estado, ESTADOS_CLIENTE.CRASHED);
      assert.strictEqual(estado.reconciliacaoPendente?.transactionId, String(cCrash.resposta.transacao_id));
      assert.strictEqual((await cliente.reiniciar()).sucesso, false);
      reconciliar(cCrash.resposta.transacao_id);
      assert.strictEqual(TefManager.obterTravaResultadoTardio(), null);
      const reinicio = await cliente.reiniciar({ reconciliado: true });
      assert.strictEqual(reinicio.sucesso, true);
      assert.strictEqual(cliente.getEstado().estado, ESTADOS_CLIENTE.READY);
    });
  } finally {
    await cliente.encerrar();
  }

  // ------------------------------------------------ nativo real (tripwire)
  let nativo = null;
  await test('nativo real: host carrega DLL, iniciaClientDestaxa=00, transacionais bloqueadas; Main sem DLL', async () => {
    nativo = await verificador.verificarNativoReal();
    assert.strictEqual(nativo.tripwire, true);
    assert.strictEqual(nativo.dll.exports, 4);
    assert.strictEqual(nativo.client.code, '00');
    assert.strictEqual(nativo.mainProcessDllLoads, 0);
    assert.strictEqual(nativo.gateReal, false);
    assert.strictEqual(nativo.enableReal, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(nativo.txStart, ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA);
  });

  const chamadasReais = {
    inicia: nativo?.counters?.inicia ?? null,
    continua: nativo?.counters?.continua ?? null,
    finaliza: nativo?.counters?.finaliza ?? null
  };
  await test('chamadas transacionais reais da DLL = 0 (tripwire) e nenhuma carga da DLL no Main', () => {
    assert.deepStrictEqual(chamadasReais, { inicia: 0, continua: 0, finaliza: 0 });
    assert.strictEqual(cargasDllMain, 0);
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  const transacoesDepois = await contarTransacoes24h();
  await test('banco: nenhuma linha nova em tef_transacoes', () => {
    assert.strictEqual(transacoesAntes, 0);
    assert.strictEqual(transacoesDepois, 0);
  });

  let ambientePersistido = null;
  await test('banco: tef_configuracao.ambiente permanece homologacao', async () => {
    const row = await consultarDb('SELECT ambiente FROM tef_configuracao ORDER BY id DESC LIMIT 1');
    ambientePersistido = row && row.ambiente;
    assert.strictEqual(ambientePersistido, 'homologacao');
  });

  let arquivosAlterados = [];
  await test('escopo: nenhum arquivo de Motores Fiscal/Não Fiscal, PDV, Financeiro, NF-e/NFC-e, Central, MUC, MIIP ou Monitor TEF alterado', () => {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: RAIZ, encoding: 'utf8' });
    arquivosAlterados = String(r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/\\/g, '/'));
    const proibidos = [/^backend\/motores\//, /fiscal/i, /nfc-?e|nf-?e/i, /monitor/i, /financeiro/i, /composite/i, /miip/i, /muc/i, /central/i, /pdv/i, /comercial/i];
    assert.deepStrictEqual(arquivosAlterados.filter((a) => proibidos.some((p) => p.test(a))), []);
  });

  destaxaKoffiLoader.carregarBiblioteca = carregarOriginal;

  // ------------------------------------------------ regressões
  if (String(process.env.TEF_06C_TIMEOUT_SKIP_REGRESSOES || '').trim() !== '1') {
    const scripts = [
      'test:tef-01', 'test:tef-02', 'test:tef-fluxo',
      'test:tef-destaxa-01', 'test:tef-destaxa-02', 'test:tef-destaxa-03',
      'test:tef-destaxa-prep-04b', 'test:tef-destaxa-05', 'test:tef-destaxa-06a',
      'test:tef-destaxa-06b', 'test:tef-destaxa-06c-prep', 'test:tef-destaxa-06c-mitigacao'
    ];
    for (const script of scripts) {
      const env = { ...process.env, [REAL_TRANSACTION_ENV]: '0' };
      if (script === 'test:tef-destaxa-06a') env.DESTAXA_REAL_HARNESS = '1';
      const inicio = Date.now();
      const r = spawnSync('npm', ['run', script], { cwd: RAIZ, env, shell: true, encoding: 'utf8', windowsHide: true, maxBuffer: 50 * 1024 * 1024, timeout: 900000 });
      const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
      const resumo = saida.split(/\r?\n/).filter((l) => /RESULTADO|Resultado:|CLIENT_INITIALIZED \(00\)/.test(l)).map((l) => l.trim());
      evidencias.regressoes.push({ script, exitCode: r.status, durationMs: Date.now() - inicio, summary: resumo });
      await test(`regressão ${script}`, () => {
        assert.strictEqual(r.status, 0, saida.split(/\r?\n/).filter((l) => /FALHOU|Error/.test(l)).slice(0, 10).join('\n'));
      });
    }
  }

  // ------------------------------------------------ relatório
  const resumoCenario = (c) => (c
    ? {
      respondedWithin: c.respondidoEmMs,
      cdsResult: { codigo: c.resposta.codigo, status: c.resposta.status, financialState: c.resposta.financialState },
      lateResult: c.log ? { code: c.log.payload.resultCode, financialState: c.log.payload.financialState, resolution: c.log.payload.resolution } : null,
      persistedStatus: c.atualizacao?.status || null,
      lockAfterLateResult: c.travaDepois?.estado || 'LIBERADA',
      adapterCalls: c.adapter.chamadas,
      newRows: c.novasLinhas,
      mainMaxLoopGapMs: c.maiorIntervalo
    }
    : null);

  const aprovado = falhou === 0;
  const relatorio = {
    sprint: 'TEF-DESTAXA-06C-TIMEOUT',
    timestamp: new Date().toISOString(),
    transactionExecuted: false,
    realTransactionGate: { env: REAL_TRANSACTION_ENV, enabled: transacaoRealHabilitada() },
    officialSources: {
      package: 'Destaxa DLL integração TEF 1.83 (documento "Biblioteca de Integração Destaxa" versão 1.1, 09/09/2025)',
      location: DOCS_OFICIAIS,
      consulted: documentacao?.fontes || [],
      timeoutOccurrences: documentacao?.ocorrenciasTimeout || []
    },
    officialTimeout: {
      global: DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO,
      crt: DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO,
      longInteractiveOperations: 'não documentado; docs/07: após DISPLAY a AC "deve aguardar o fim da chamada" (sem limite)',
      coletaField: CONTRATO_TIMEOUT_DESTAXA.coleta,
      code08: CONTRATO_TIMEOUT_DESTAXA.codigo08,
      clientVsPagueConfiguration: 'nenhum parâmetro de timeout em iniciaClientDestaxa (docs/05)'
    },
    unit: 'segundos (somente campo timeout de COLETA)',
    meaning: CONTRATO_TIMEOUT_DESTAXA.coleta.significado,
    currentCdsTimeouts: {
      tefManagerOperationalMs: TefManager.timeout,
      tefManagerSource: 'TEF_TIMEOUT_MS ou 30000 (backend/services/tef/TefManager.js) — inalterado',
      tefConfiguracaoTefTimeoutSeconds: 'tefTimeout=60 (tefConfigService DEFAULTS) — persistido, não consumido pelo TefManager; inalterado',
      hostIpcTransactionalMs: null,
      hostIpcNonTransactionalMs: 120000,
      hostStartupMs: 20000,
      tefLockServiceMs: 'timeout operacional + 10000 (lock por venda/idempotency_key)'
    },
    differences: [
      'Destaxa não define timeout global/CRT; o timeout operacional do CDS (30s) não tem base documental e não é autoridade sobre o resultado.',
      'O campo timeout de COLETA mede o prazo da AC para responder uma coleta (sem chamada nativa em andamento); não é timeout da chamada nem da transação.',
      'O timeout de IPC para operações transacionais (120s na 06C-MITIGACAO) foi removido: não havia base documental; perda do host é detectada pela saída do processo.'
    ],
    decision: 'Nenhum número novo. Contrato baseado em UNKNOWN, host ocupado, resultado tardio, reconciliação e ausência de retry (OBJETIVO 8).',
    finalContract: [
      { layer: 'TefManager (Main)', timeout: `${TefManager.timeout}ms (TEF_TIMEOUT_MS) — operacional, sem base documental`, meaning: 'prazo de resposta ao chamador (PDV)', action: 'responde TIMEOUT/PENDENTE (UNKNOWN, retryAllowed=false); não cancela a chamada; abre trava de resultado tardio', authority: 'não é autoridade sobre o resultado financeiro' },
      { layer: 'DestaxaHostBridge / IPC', timeout: 'nenhum para TX_START/TX_CONTINUE/TX_FINALIZE; 120000ms para operações não transacionais', meaning: 'transporte', action: 'espera resposta do host ou queda do processo; timeout explícito → HOST_TIMEOUT UNKNOWN com lock mantido', authority: 'autoridade somente sobre falha de transporte (HOST_CRASHED/OFFLINE/UNAVAILABLE → UNKNOWN)' },
      { layer: 'TEF Native Host', timeout: 'nenhum', meaning: 'executa a chamada síncrona da DLL até o fim', action: 'nunca interrompe a DLL; uma operação por vez (HOST_BUSY)', authority: 'autoridade sobre serialização' },
      { layer: 'Destaxa DLL / Client', timeout: DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO, meaning: 'Client controla os próprios prazos; 08 = tempo limite de espera excedido', action: 'resultado 00/03/04/09/08/A0/A1/99 classificado pela política TEF-05', authority: 'autoridade sobre o resultado financeiro' },
      { layer: 'COLETA/99', timeout: 'campo timeout (segundos) enviado pelo Client em cada coleta', meaning: 'prazo da AC para responder a coleta; ultrapassado, o Client cancela a transação', action: 'informativo para a UI da coleta; não vira timeout global nem timer do CDS', authority: 'Client Destaxa' },
      { layer: 'Reconciliação', timeout: 'nenhum', meaning: 'desfecho seguro após UNKNOWN/00 tardio/A0/A1/queda', action: 'TefManager.reconciliarResultadoTardio (usuário + observação) somente após o desfecho da chamada; libera a trava', authority: 'operador' }
    ],
    timeoutBehavior: {
      physicalCancellation: false,
      cdsResponse: 'TIMEOUT / PENDENTE / UNKNOWN / retryAllowed=false com o mesmo transacaoId',
      hostKeepsRunning: true,
      timeoutBeforeAdapterCall: 'autorização não é enviada; linha marcada erro (TEF_TIMEOUT_ANTES_DO_ENVIO)'
    },
    lateResultBehavior: {
      '00': 'CONFIRMED_SUCCESS registrado; linha permanece pendente; SUCCESS somente após reconciliação; nunca nova cobrança',
      '03/04/09': 'CONFIRMED_DENIED; linha negada; trava liberada',
      '08': 'UNKNOWN; reconciliação obrigatória',
      A0: 'UNCONFIRMED; reconciliação obrigatória',
      A1: 'BLOCKED; reconciliação obrigatória (confirmar/cancelar pendentes)',
      '99/erro/queda': 'PENDING/UNKNOWN; reconciliação obrigatória',
      automaticNewAuthorization: false,
      scenarios: Object.fromEntries(Object.entries(evidencias.cenarios).map(([k, c]) => [k, resumoCenario(c)]))
    },
    transactionLock: {
      tefManager: 'trava de resultado tardio (AGUARDANDO_RESULTADO_TARDIO → RECONCILIACAO_PENDENTE); nova autorização → TEF_RESULTADO_PENDENTE antes de criar linha/transactionId',
      nativeHost: 'cliente mantém a operação em voo até resposta/queda (HOST_BUSY); queda durante TX → reconciliação pendente e reinício só com reconciliado=true',
      release: 'automática somente em negação confirmada tardia; demais casos por reconciliação explícita',
      residualRisk: 'trava reconstruída do banco após reinício (TEF-DESTAXA-06C-PERSISTENCIA: linhas tef_transacoes pendente); o host (processo filho) é encerrado junto com o aplicativo; a DLL sinaliza A1 para transação não confirmada'
    },
    reconciliation: {
      api: 'TefManager.reconciliarResultadoTardio(transacaoId, { financialState: CONFIRMED_SUCCESS|CONFIRMED_DENIED|CANCELLED, usuario, observacao })',
      guards: ['TEF_RECONCILIACAO_SEM_TRAVA', 'TEF_RECONCILIACAO_PREMATURA', 'TEF_RECONCILIACAO_INVALIDA'],
      sendsNewAuthorization: false
    },
    mainProcess: { pid: process.pid, dllLoads: cargasDllMain },
    hostProcess: nativo ? { processType: nativo.processType, pid: nativo.hostPid, versions: nativo.hostVersions, tripwire: nativo.tripwire, clientCode: nativo.client.code } : null,
    realTransactions: transacoesDepois,
    realTransactionalCalls: chamadasReais,
    database: { newTransactions: transacoesDepois, window: '24h', tefConfiguracaoAmbiente: ambientePersistido },
    scope: { changedFiles: arquivosAlterados, forbiddenAreasTouched: false },
    tests: { executed: executados.length, passed: passou, failed: falhou, failures: falhas },
    regressions: evidencias.regressoes,
    result: aprovado ? 'READY_FOR_REAL_R$1' : 'BLOCKED_FOR_REAL_TRANSACTION'
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, `${JSON.stringify(relatorio, null, 2)}\n`, 'utf8');
  console.log(`\nRelatório: ${path.relative(RAIZ, RELATORIO)} → ${relatorio.result}`);
  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
