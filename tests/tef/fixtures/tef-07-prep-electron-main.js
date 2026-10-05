/**
 * TEF-DESTAXA-07-PREP — coleta de prontidão no runtime real do CDS (Electron main).
 *
 * Executado por: electron tests/tef/fixtures/tef-07-prep-electron-main.js
 * Somente leitura: nenhuma escrita em configuração, nenhuma linha em tef_transacoes.
 * Função nativa permitida: iniciaClientDestaxa (host com tripwire). As funções
 * transacionais nunca são alcançadas: o fluxo para em prepararAutorizacao (gate fechado).
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { app } = require('electron');

const RAIZ = path.resolve(__dirname, '../../..');
const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
const r = (rel) => require(path.join(RAIZ, rel));

/** Resolve somente após o pipe aceitar a linha: app.exit() antes disso pode truncar o resultado. */
function emitir(dados) {
  return new Promise((resolve) => process.stdout.write(`\n@@PREP07 ${JSON.stringify(dados)}\n`, () => resolve()));
}

function consultar(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));
}

async function contagemBanco(db) {
  const linhas = await consultar(db, 'SELECT status, COUNT(*) AS n FROM tef_transacoes GROUP BY status');
  const por = Object.fromEntries(linhas.map((l) => [l.status, l.n]));
  return {
    total: linhas.reduce((s, l) => s + l.n, 0),
    pendentes: por.pendente || 0,
    aprovadas: por.aprovado || 0,
    negadas: por.negado || 0,
    canceladas: por.cancelado || 0,
    erros: por.erro || 0,
    porStatus: por
  };
}

async function coletar() {
  if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
    throw new Error(`${REAL_TRANSACTION_ENV} deve permanecer desabilitada no 07-PREP`);
  }

  // Tripwire no host (processo filho herda) e contador de cargas da DLL no Main.
  const { TRIPWIRE_ENV } = r('backend/services/tef/destaxa/DestaxaNativeHost');
  process.env[TRIPWIRE_ENV] = '1';
  const koffiLoader = r('backend/services/tef/destaxa/destaxaKoffiLoader');
  let cargasDllMain = 0;
  const carregarOriginal = koffiLoader.carregarBiblioteca;
  koffiLoader.carregarBiblioteca = function contar(...args) {
    cargasDllMain += 1;
    return carregarOriginal.apply(this, args);
  };

  const db = r('backend/database');
  await new Promise((resolve, reject) => db.whenReady((e) => (e ? reject(e) : resolve())));
  const bancoAntes = await contagemBanco(db);

  const saida = {
    runtime: {
      electron: process.versions.electron || null,
      node: process.versions.node,
      abi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      processType: process.type || null,
      pid: process.pid
    },
    gate: { env: REAL_TRANSACTION_ENV, valor: process.env[REAL_TRANSACTION_ENV] ?? null },
    banco: { antes: bancoAntes }
  };

  // 2 — configuração lida do banco
  const tefConfigService = r('backend/services/tef/tefConfigService');
  const [linhaCfg] = await consultar(db, 'SELECT id, habilitado, provedor, ambiente, timeout, tentativas, tipo_integracao FROM tef_configuracao ORDER BY id LIMIT 1');
  const cfg = await tefConfigService.obterConfiguracao();
  saida.configuracao = {
    linha: linhaCfg || null,
    tefProvedor: cfg.tefProvedor,
    tefAmbiente: cfg.tefAmbiente,
    tefModo: tefConfigService.resolverModoAdapter(cfg.tefAmbiente),
    pinpadModelo: cfg.pinpadModelo,
    pinpadNome: cfg.pinpadNome,
    pinpadHabilitado: cfg.pinpadHabilitado,
    portaCom: cfg.portaCom,
    tefTentativasPersistido: cfg.tefTentativas,
    tefTimeoutPersistido: cfg.tefTimeout,
    validacaoModoReal: tefConfigService.validarConfiguracao(cfg, { modoAdapter: 'real' })
  };

  // 9/17 — pendências e recuperação (TefManager real, somente leitura)
  const TefManager = r('backend/services/tef/TefManager');
  const travaRecuperada = await TefManager.garantirRecuperacao();
  saida.lock = { pendentesBanco: bancoAntes.pendentes, travaRecuperada, pendenciasEmMemoria: TefManager._pendencias.size };

  // 3 — factory (sem fallback)
  const tefFactory = r('backend/services/tef/tefFactory');
  const DestaxaRealAdapter = r('backend/services/tef/adapters/DestaxaRealAdapter');
  const { ERROS, OPERACOES, OPERACOES_REAIS_PERMITIDAS, CONTRATO_TIMEOUT_DESTAXA, transacaoRealHabilitada } = r('backend/services/tef/destaxa/destaxaConstantes');
  const adapter = await tefFactory.obterAdapter();
  let semFallback = null;
  try {
    tefFactory.criarAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, {
      verificarDisponibilidadeReal: () => ({ disponivel: false, codigo: ERROS.DESTAXA_DLL_NOT_FOUND, mensagem: 'pré-voo: indisponível simulado' })
    });
    semFallback = 'CRIOU_ADAPTER';
  } catch (error) {
    semFallback = error.codigo || error.code || error.message;
  }
  saida.factory = {
    classe: adapter.constructor.name,
    instanciaReal: adapter instanceof DestaxaRealAdapter,
    modo: adapter.modo,
    execucaoNativa: adapter.execucaoNativa || null,
    semFallbackQuandoIndisponivel: semFallback,
    contratoTimeout: adapter.contratoTimeout || null
  };

  // 4 — DLL (arquivo, hash, koffi) sem carregar no Main
  const resolver = r('backend/services/tef/destaxa/destaxaDllResolver');
  const binarios = r('backend/services/tef/destaxa/destaxaBinarios');
  const resolucao = resolver.resolverDll({});
  const esperado = binarios.arquivos['win-x64'];
  const conteudo = resolucao.dllPath && fs.existsSync(resolucao.dllPath) ? fs.readFileSync(resolucao.dllPath) : null;
  let koffiPath = null;
  try { koffiPath = require.resolve('koffi', { paths: [RAIZ] }); } catch (_) { koffiPath = null; }
  saida.dll = {
    path: resolucao.dllPath || null,
    arch: resolucao.dllArch || null,
    processArch: resolucao.processArch || process.arch,
    tamanho: conteudo ? conteudo.length : null,
    sha256: conteudo ? crypto.createHash('sha256').update(conteudo).digest('hex').toUpperCase() : null,
    sha256Esperado: esperado.sha256,
    tamanhoEsperado: esperado.tamanho,
    versaoPacote: binarios.versaoPacote,
    koffiDisponivel: Boolean(koffiPath),
    disponibilidade: DestaxaRealAdapter.verificarDisponibilidade({})
  };

  // 5/6/7/11/12 — caminho real até o gate (LOAD + iniciaClientDestaxa no host)
  const { obterClienteCompartilhado } = r('backend/services/tef/destaxa/DestaxaNativeHostClient');
  const { OPERACOES_HOST } = r('backend/services/tef/destaxa/destaxaNativeHostProtocolo');
  const cliente = obterClienteCompartilhado();

  // Detecção VSPague/PPC930 (sdkDetector, PowerShell síncrono no Main) medida à parte.
  const detectorSdk = r('backend/services/tef/sdkDetector');
  const janelasDetector = [];
  const originaisDetector = {};
  for (const nome of ['detectarVsPagueClient', 'detectarGertecPPC930']) {
    originaisDetector[nome] = detectorSdk[nome];
    detectorSdk[nome] = function medir(...args) {
      const inicio = Date.now();
      try {
        return originaisDetector[nome].apply(this, args);
      } finally {
        janelasDetector.push({ nome, inicio, fim: Date.now() });
      }
    };
  }
  const intervalos = [];
  let ultimo = Date.now();
  const hb = setInterval(() => {
    const agora = Date.now();
    intervalos.push({ inicio: ultimo, fim: agora });
    ultimo = agora;
  }, 10);
  const inicioPrep = Date.now();
  const preparacao = await adapter.prepararAutorizacao({ tipo: 'credito', valor: 1, parcelas: 1 });
  const duracaoPrep = Date.now() - inicioPrep;
  clearInterval(hb);
  intervalos.push({ inicio: ultimo, fim: Date.now() });
  Object.assign(detectorSdk, originaisDetector);
  const sobrepoeDetector = (i) => janelasDetector.some((j) => i.inicio < j.fim + 5 && i.fim > j.inicio - 5);
  const gap = (lista) => lista.reduce((m, i) => Math.max(m, i.fim - i.inicio), 0);
  const checks = preparacao.resposta?.preparacao || preparacao.contexto?.checks || {};
  saida.preparacao = {
    pronto: preparacao.pronto,
    readiness: preparacao.readiness || preparacao.resposta?.readiness || null,
    codigo: preparacao.resposta?.codigo || null,
    transacaoId: preparacao.resposta?.transacaoId ?? null,
    transactionAttempted: preparacao.resposta?.transactionAttempted ?? null,
    checks
  };

  // Valores/operações proibidos: recusados antes de qualquer chamada ao host.
  const recusas = {};
  for (const [nome, dados] of Object.entries({
    'R$100 (valor=100)': { tipo: 'credito', valor: 100 },
    'R$0,01 (valor=0.01)': { tipo: 'credito', valor: 0.01 }
  })) {
    const p = await adapter.prepararAutorizacao(dados);
    recusas[nome] = p.resposta?.codigo || (p.pronto ? 'PRONTO' : null);
  }
  const protocolo = r('backend/services/tef/destaxa/destaxaProtocolo');
  const errosFormato = {};
  for (const invalido of [0, 1.5, '100', '1', null]) {
    try {
      errosFormato[String(invalido)] = protocolo.formatarValorDestaxa(invalido);
    } catch (error) {
      errosFormato[String(invalido)] = error.codigo || error.code || 'ERRO';
    }
  }
  saida.valor = {
    internoCentavos: checks.crt?.valueCents ?? null,
    destaxa: protocolo.formatarValorDestaxa(100),
    entradaCrt: checks.crt?.input || null,
    builder: protocolo.buildCrtInput({ valorCentavos: 100 }).texto,
    recusas,
    formatoRecusado: errosFormato
  };
  saida.operacao = {
    operacao: checks.crt?.operation || null,
    permitidas: OPERACOES_REAIS_PERMITIDAS,
    naoPermitidas: ['PIX', 'EST', 'CST', 'PRE', 'CPF'].filter((op) => !OPERACOES_REAIS_PERMITIDAS.includes(op))
  };

  // 7 — PPC930 USB (VID/PID) somente leitura
  const detector = r('backend/services/tef/sdkDetector');
  const usb = detector.listarDispositivosUsb().filter((d) => d.vid === '1753');
  saida.pinpad = { checks: checks.pinpad || null, usb };

  // 8/19 — host, IPC, operação em voo, tripwire
  const ping = await cliente.enviar(OPERACOES_HOST.PING);
  const status = await cliente.enviar(OPERACOES_HOST.STATUS);
  const estadoHost = cliente.getEstado();
  saida.nativeHost = {
    estado: estadoHost.estado,
    pid: estadoHost.pid,
    processType: estadoHost.processType,
    versions: estadoHost.versions,
    emVoo: estadoHost.emVoo || null,
    reconciliacaoPendente: estadoHost.reconciliacaoPendente || null,
    ipcPing: ping.output?.pong === true,
    tripwire: status.output?.tripwire === true,
    modoTeste: status.output?.modoTeste === true,
    gateRealNoHost: status.output?.gateReal === true,
    contadores: status.output?.contadores || null,
    operacaoAtivaNoHost: status.output?.operacaoAtiva ?? null,
    mainPid: process.pid,
    cargasDllMain,
    mainResponsivo: {
      duracaoPrepMs: duracaoPrep,
      ticks: intervalos.length,
      maiorIntervaloForaDetectorMs: gap(intervalos.filter((i) => !sobrepoeDetector(i))),
      maiorIntervaloTotalMs: gap(intervalos),
      detectorSincrono: janelasDetector.map((j) => ({ nome: j.nome, bloqueioMs: j.fim - j.inicio }))
    }
  };
  await cliente.encerrar();

  // 13 — tentativas efetivas
  const tefRetryService = r('backend/services/tef/tefRetryService');
  let chamadasRetry = 0;
  let erroRetry = null;
  const logOriginal = console.log;
  console.log = () => {};
  try {
    await tefRetryService.autorizarComRetry(async () => { chamadasRetry += 1; throw new Error('connect ETIMEDOUT'); }, { provider: 'destaxa' });
  } catch (error) {
    erroRetry = error;
  } finally {
    console.log = logOriginal;
  }
  saida.tentativas = {
    efetivas: chamadasRetry,
    retryAllowed: erroRetry?.retryAllowed ?? null,
    persistidoNaoConsumido: cfg.tefTentativas
  };

  // 14 — timeout
  saida.timeout = {
    envTefTimeoutMs: process.env.TEF_TIMEOUT_MS ?? null,
    tefManagerMs: TefManager.timeout,
    destaxaGlobal: CONTRATO_TIMEOUT_DESTAXA.globalTimeout,
    ipcTransacional: CONTRATO_TIMEOUT_DESTAXA.chamadaEmAndamento?.limite ?? null
  };

  // 15 — interação 99 (driver mock, sem DLL)
  const Orquestrador = r('backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
  const MockDriver = r('backend/services/tef/destaxa/destaxaTransacaoMockDriver');
  const mock = new MockDriver([
    { fn: 'inicia', codigo: '99', saida: 'mensagem=Insira ou passe o cartão' },
    { fn: 'continua', codigo: '99', saida: 'mensagem=Digite os 4 últimos dígitos;tipo=N;timeout=30' },
    { fn: 'continua', codigo: '99', saida: 'mensagem=Selecione;opcao=Credito a vista|Credito parcelado' },
    { fn: 'continua', codigo: '00', saida: '' }
  ]);
  const orq = new Orquestrador({ driver: mock });
  const passos99 = [];
  const registrar = (res) => passos99.push({ codigo: res.codigoDestaxa, estado: res.estado, classificacao: res.classificacao, acao: res.acao?.tipo || null, retryAllowed: res.retryAllowed, erro: res.classificacao === 'ERROR' });
  registrar(orq.iniciarTransacaoCRT(protocolo.buildCrtInput({ valorCentavos: 100 }).campos, { transactionId: 'mock-07' }));
  registrar(orq.continuarTransacao({ displayAck: true }));
  registrar(orq.continuarTransacao('1234'));
  registrar(orq.continuarTransacao('Credito a vista'));
  saida.interacao99 = { passos: passos99, mockNaoDll: true };

  // 16 — classificação dos resultados
  saida.resultados = Object.fromEntries(['00', '03', '08', 'A0', 'A1'].map((c) => {
    const x = protocolo.classificarCodigoTransacao(c);
    return [c, { classificacao: x.classificacao, financialState: x.financialState, retryAllowed: x.retryAllowed }];
  }));

  // 18 — banco depois
  saida.banco.depois = await contagemBanco(db);
  saida.gate.habilitado = transacaoRealHabilitada();
  saida.operacoesNativasUsadas = ['LOAD', 'INIT_CLIENT (iniciaClientDestaxa)', 'STATUS', 'PING'];
  koffiLoader.carregarBiblioteca = carregarOriginal;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) => db.close(() => resolve()));
  return saida;
}

app.whenReady().then(async () => {
  try {
    await emitir({ ok: true, dados: await coletar() });
    app.exit(0);
  } catch (error) {
    await emitir({ ok: false, erro: error.message, stack: error.stack });
    app.exit(1);
  }
});
