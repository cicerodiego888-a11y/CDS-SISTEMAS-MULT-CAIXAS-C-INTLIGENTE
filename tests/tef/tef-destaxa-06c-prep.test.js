/**
 * TEF-DESTAXA-06C-PREP — pré-validação final antes do primeiro R$1,00.
 *
 * Permitido: carregar DLL, validar exports, iniciaClientDestaxa(), detectar
 * VSPague/PPC930, ler/gravar configuração pela camada oficial.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais.
 * A análise da chamada nativa bloqueante usa somente stubs.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Worker } = require('worker_threads');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada na 06C-PREP`);
  process.exit(2);
}

const RAIZ = path.resolve(__dirname, '../..');
const DOCS_DESTAXA = process.env.DESTAXA_DOCS_DIR
  || 'C:\\Users\\cicer\\Desktop\\DLL DESTAXA\\1_83-20260831T165940Z-1-001\\1_83';
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-06c-prep-report.json');

const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const DestaxaTransacaoMockDriver = require('../../backend/services/tef/destaxa/destaxaTransacaoMockDriver');
const tefFactory = require('../../backend/services/tef/tefFactory');
const tefConfigService = require('../../backend/services/tef/tefConfigService');
const tefRetryService = require('../../backend/services/tef/tefRetryService');
const { classificarErroFinanceiro, FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const {
  buildCrtInput,
  formatarValorDestaxa,
  valorReaisParaCentavos
} = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const {
  ERROS,
  OPERACOES,
  FORMATO_VALOR_DESTAXA,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

let passou = 0;
let falhou = 0;
const falhas = [];

async function test(nome, fn) {
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

// ------------------------------------------------------------------ fakes
function criarLoaderFake() {
  const contadores = { client: 0, inicia: 0, continua: 0, finaliza: 0 };
  const falhar = (chave) => () => {
    contadores[chave] += 1;
    throw new Error(`${chave} não deveria ser chamado`);
  };
  return {
    contadores,
    carregarBiblioteca() {
      return {
        exports: {
          iniciaClientDestaxa(resultado) {
            contadores.client += 1;
            resultado.write('00', 0, 'latin1');
          },
          iniciaTransacaoDestaxa: falhar('inicia'),
          continuaTransacaoDestaxa: falhar('continua'),
          finalizaTransacaoDestaxa: falhar('finaliza')
        },
        unload() {}
      };
    }
  };
}

const resolverFake = {
  resolverDll: () => ({ sucesso: true, dllPath: 'memoria/libdll-integracao-tef.dll', dllExists: true, origem: 'teste' })
};

function criarAdapterControlado() {
  const loader = criarLoaderFake();
  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    {
      nativeLoader: loader,
      resolver: resolverFake,
      configService: {
        async obterConfiguracao() {
          return { tefProvedor: 'destaxa', pinpadHabilitado: 'true', portaCom: 'COM3' };
        },
        validarConfiguracao() {
          return { valida: true, pendencias: [] };
        }
      },
      sdkDetector: {
        detectarVsPagueClient: () => ({ detectado: true, executando: true, responding: true, pid: 1 }),
        detectarGertecPPC930: () => ({ detectado: true, estado: 'DETECTADO', porta: 'COM3', modelo: 'Gertec PPC930', usb: true })
      }
    }
  );
  return { adapter, loader };
}

/** Stub de função nativa síncrona: ocupa a thread como a DLL faria. */
function chamadaNativaSincronaFake(duracaoMs, codigo) {
  const fim = Date.now() + duracaoMs;
  while (Date.now() < fim) { /* thread ocupada */ }
  return codigo;
}

/** Reproduz o padrão de TefManager.autorizar: timer + persistência assíncrona após a chamada. */
function simularPadraoTefManager({ timeoutMs, duracaoNativaMs }) {
  const eventos = { nativaRetornou: null };
  const promessa = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout de ${timeoutMs}ms excedido na operação TEF`));
    }, timeoutMs);
    setImmediate(() => {
      eventos.nativaRetornou = chamadaNativaSincronaFake(duracaoNativaMs, '00');
      fs.stat(__filename, () => {
        clearTimeout(timer);
        resolve({ codigo: eventos.nativaRetornou });
      });
    });
  });
  return { promessa, eventos };
}

function contarTicksDurante(executar) {
  return new Promise((resolve) => {
    let ticks = 0;
    const heartbeat = setInterval(() => { ticks += 1; }, 10);
    Promise.resolve(executar()).then(() => {
      const duranteChamada = ticks;
      clearInterval(heartbeat);
      resolve(duranteChamada);
    });
  });
}

function consultarDb(sql, params = []) {
  const db = require('../../backend/database');
  return new Promise((resolve, reject) => {
    db.whenReady((erro) => {
      if (erro) return reject(erro);
      db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row)));
    });
  });
}

async function contarTransacoes24h() {
  const row = await consultarDb("SELECT COUNT(*) AS n FROM tef_transacoes WHERE criado_em >= datetime('now','-1 day')");
  return row.n;
}

async function main() {
  console.log('\nTEF-DESTAXA-06C-PREP — PRÉ-VALIDAÇÃO FINAL (sem transação)\n');

  const coleta = {
    valueFormat: null,
    configuration: null,
    koffiAsync: null,
    nodeReport: null,
    electronReport: null,
    newTransactions: null
  };

  const transacoesAntes = await contarTransacoes24h();

  await test('segurança: gate financeiro desabilitado', () => {
    assert.notStrictEqual(String(process.env[REAL_TRANSACTION_ENV] || '').trim(), '1');
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  await test('banco: nenhuma transação TEF nas últimas 24h (início)', () => {
    assert.strictEqual(transacoesAntes, 0);
  });

  // ------------------------------------------------------ A — formato do valor
  await test('A: docs oficiais Destaxa 1.83 exigem reais com ponto e 2 casas', () => {
    const doc06 = fs.readFileSync(path.join(DOCS_DESTAXA, 'docs', '06-api-iniciatransacaodestaxa.md'), 'utf8');
    assert.match(doc06, /`transacao_valor`[^\n]*Ex: `100\.99`/);
    assert.match(doc06, /transacao_valor=99\.99/);
    const dotnet = fs.readFileSync(path.join(DOCS_DESTAXA, 'examples', 'dotnet', 'Program.cs'), 'utf8');
    assert.match(dotnet, /transacao_valor=100\.00/);
    assert.match(dotnet, /transacao_valor=23\.49/);
    const clang = fs.readFileSync(path.join(DOCS_DESTAXA, 'examples', 'clang', 'src', 'main.c'), 'utf8');
    assert.match(clang, /transacao_valor=108\.96/);
    const todos = `${doc06}\n${dotnet}\n${clang}`;
    assert.strictEqual(/transacao_valor=\d+(;|"|$)/m.test(todos), false, 'nenhum exemplo oficial usa centavos inteiros');
    assert.strictEqual(FORMATO_VALOR_DESTAXA.confirmed, true);
  });

  await test('A: conversão única CDS (centavos) → Destaxa (reais "0.00")', () => {
    assert.strictEqual(formatarValorDestaxa(100), '1.00');
    assert.strictEqual(formatarValorDestaxa(1), '0.01');
    assert.strictEqual(formatarValorDestaxa(2349), '23.49');
    assert.strictEqual(formatarValorDestaxa(9999), '99.99');
    assert.strictEqual(formatarValorDestaxa(10099), '100.99');
    assert.strictEqual(formatarValorDestaxa(10896), '108.96');
    for (const invalido of [0, -1, 1.5, '100', null, undefined, NaN]) {
      assert.throws(() => formatarValorDestaxa(invalido), (e) => e.codigo === ERROS.DESTAXA_VALOR_NAO_PERMITIDO);
    }
  });

  await test('A: builder CRT (sem DLL) → transacao_valor=1.00', () => {
    const entrada = buildCrtInput({ valorCentavos: 100 });
    assert.strictEqual(entrada.texto, 'transacao_valor=1.00');
    assert.deepStrictEqual(entrada.chaves, ['transacao_valor']);
    assert.strictEqual(/operacao/i.test(entrada.texto), false);
  });

  await test('A: caminho valor → centavos → string final → entrada da DLL', async () => {
    assert.strictEqual(valorReaisParaCentavos(1), 100);
    const { adapter } = criarAdapterControlado();
    const preparacao = await adapter.prepararAutorizacao({ tipo: 'credito', valor: 1 });
    assert.strictEqual(preparacao.pronto, false);
    assert.strictEqual(preparacao.resposta.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(preparacao.resposta.preparacao.crt.valueCents, 100);
    assert.strictEqual(preparacao.resposta.preparacao.crt.input, 'transacao_valor=1.00');

    const capturado = [];
    const mock = new DestaxaTransacaoMockDriver([{ fn: 'inicia', codigo: '00', saida: '' }]);
    const original = mock.iniciaTransacaoDestaxa.bind(mock);
    mock.iniciaTransacaoDestaxa = (operacao, entrada) => {
      capturado.push({ operacao, entrada });
      return original(operacao, entrada);
    };
    const orq = new DestaxaTransacaoOrquestrador({ driver: mock });
    orq.iniciarTransacaoCRT(buildCrtInput({ valorCentavos: 100 }).campos, { transactionId: 'tx-a' });
    assert.deepStrictEqual(capturado, [{ operacao: 'CRT', entrada: 'transacao_valor=1.00' }]);
    coleta.valueFormat = { confirmed: true, format: '1.00', sent: capturado[0].entrada };
  });

  // --------------------------------------------- B — persistência homologacao
  await test('B: banco persistido com provedor destaxa / ambiente homologacao', async () => {
    const row = await consultarDb('SELECT provedor, ambiente FROM tef_configuracao ORDER BY id LIMIT 1');
    assert.strictEqual(row.provedor, 'destaxa');
    assert.strictEqual(row.ambiente, 'homologacao');
  });

  await test('B: processo novo relê o banco e a Factory escolhe DestaxaRealAdapter', () => {
    const script = [
      "const db = require('./backend/database');",
      'db.whenReady(async () => {',
      "  const repo = require('./backend/repositories/tefConfigRepository');",
      "  const factory = require('./backend/services/tef/tefFactory');",
      '  const reg = await repo.buscarConfiguracaoPrincipal();',
      '  const adapter = await factory.obterAdapter();',
      "  process.stdout.write('\\n06CPREP_RELOAD ' + JSON.stringify({ pid: process.pid, ambiente: reg.ambiente, provedor: reg.provedor, classe: adapter.constructor.name, modo: adapter.modo }) + '\\n');",
      '  process.exit(0);',
      '});'
    ].join('\n');
    const r = spawnSync(process.execPath, ['-e', script], { cwd: RAIZ, encoding: 'utf8', windowsHide: true, timeout: 120000, env: { ...process.env, [REAL_TRANSACTION_ENV]: '0' } });
    const linha = String(r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('06CPREP_RELOAD '));
    assert.ok(linha, `saída sem marcador: ${r.stderr}`);
    const dados = JSON.parse(linha.slice('06CPREP_RELOAD '.length));
    assert.notStrictEqual(dados.pid, process.pid);
    assert.strictEqual(dados.ambiente, 'homologacao');
    assert.strictEqual(dados.provedor, 'destaxa');
    assert.strictEqual(dados.classe, 'DestaxaRealAdapter');
    assert.strictEqual(dados.modo, 'real');
  });

  await test('B: camada de persistência rejeita ambiente inválido', () => {
    for (const valido of ['simulacao', 'homologacao', 'producao', null]) {
      tefConfigService.garantirAmbientePersistivel({ principal: { ambiente: valido } });
    }
    assert.throws(
      () => tefConfigService.garantirAmbientePersistivel({ principal: { ambiente: 'homolog' } }),
      (e) => e.codigo === 'TEF_AMBIENTE_INVALIDO' && e.statusCode === 400
    );
  });

  // ------------------------------------------------- C — seleção do adapter
  const disponivel = () => ({ disponivel: true });
  await test('C1: destaxa/homologacao/real → DestaxaRealAdapter', () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, { verificarDisponibilidadeReal: disponivel });
    assert.ok(adapter instanceof DestaxaRealAdapter);
    assert.strictEqual(adapter.modo, 'real');
  });

  await test('C2: destaxa/simulacao → adapter simulado (real nunca consultado)', () => {
    let consultado = false;
    const adapter = tefFactory.criarAdapter(
      { provedor: 'destaxa', ambiente: 'simulacao' },
      { verificarDisponibilidadeReal: () => { consultado = true; return { disponivel: true }; } }
    );
    assert.strictEqual(adapter instanceof DestaxaRealAdapter, false);
    assert.notStrictEqual(adapter.modo, 'real');
    assert.strictEqual(typeof adapter.prepararAutorizacao, 'undefined');
    assert.strictEqual(consultado, false);
  });

  // ----------------------------------------------- D — sem fallback silencioso
  await test('D: homologacao com adapter real indisponível → erro explícito', () => {
    assert.throws(
      () => tefFactory.criarAdapter(
        { provedor: 'destaxa', ambiente: 'homologacao' },
        { verificarDisponibilidadeReal: () => ({ disponivel: false, codigo: ERROS.DESTAXA_DLL_NOT_FOUND, mensagem: 'DLL ausente' }) }
      ),
      (e) => e.codigo === ERROS.DESTAXA_REAL_ADAPTER_INDISPONIVEL && /DLL ausente/.test(e.message)
    );
  });

  await test('D: ambiente desconhecido → erro explícito (não cai em simulação)', () => {
    assert.throws(
      () => tefFactory.criarAdapter({ provedor: 'destaxa', ambiente: 'teste' }, { verificarDisponibilidadeReal: disponivel }),
      (e) => e.codigo === 'DESTAXA_AMBIENTE_INVALIDO'
    );
  });

  await test('D: disponibilidade real sem DLL ou sem koffi → indisponível', () => {
    const semDll = DestaxaRealAdapter.verificarDisponibilidade({}, {
      resolver: { resolverDll: () => ({ sucesso: false, codigo: ERROS.DESTAXA_DLL_NOT_FOUND, mensagem: 'não encontrada' }) }
    });
    assert.strictEqual(semDll.disponivel, false);
    assert.strictEqual(semDll.codigo, ERROS.DESTAXA_DLL_NOT_FOUND);
    const semKoffi = DestaxaRealAdapter.verificarDisponibilidade({}, {
      resolver: resolverFake,
      resolverModulo: () => { throw new Error('Cannot find module koffi'); }
    });
    assert.strictEqual(semKoffi.disponivel, false);
    assert.strictEqual(semKoffi.codigo, ERROS.DESTAXA_REAL_ADAPTER_INDISPONIVEL);
  });

  await test('D: disponibilidade real nesta máquina (DLL x64 + koffi) sem carregar a DLL', () => {
    const r = DestaxaRealAdapter.verificarDisponibilidade({});
    assert.strictEqual(r.disponivel, true, r.mensagem);
    assert.match(String(r.dllPath).replace(/\\/g, '/'), /win-x64\/libdll-integracao-tef\.dll$/);
  });

  await test('D: validação coerente — simulacao não permite adapter real', () => {
    const v = tefConfigService.validarConfiguracao(
      { tefHabilitado: 'true', tefProvedor: 'destaxa', tefAmbiente: 'simulacao' },
      { modoAdapter: 'real' }
    );
    assert.strictEqual(v.valida, false);
    assert.ok(v.pendencias.includes('Ambiente simulacao não permite adapter real'));
  });

  // -------------------------------------------------- E — Destaxa + PPC930
  await test('E: configuração oficial Destaxa + PPC930 em COM3, válida para modo real', async () => {
    await new Promise((resolve, reject) => require('../../backend/database').whenReady((e) => (e ? reject(e) : resolve())));
    const cfg = await tefConfigService.obterConfiguracao();
    assert.strictEqual(cfg.tefProvedor, 'destaxa');
    assert.strictEqual(cfg.tefAmbiente, 'homologacao');
    assert.strictEqual(tefConfigService.resolverModoAdapter(cfg.tefAmbiente), 'real');
    assert.match(String(cfg.pinpadModelo), /PPC930/i);
    assert.strictEqual(cfg.portaCom, 'COM3');
    assert.strictEqual(String(cfg.pinpadHabilitado), 'true');
    const v = tefConfigService.validarConfiguracao(cfg, { modoAdapter: 'real' });
    assert.strictEqual(v.valida, true, v.pendencias.join('; '));
    coleta.configuration = {
      provider: cfg.tefProvedor,
      environment: cfg.tefAmbiente,
      adapterMode: v.modoAdapter,
      persisted: true
    };
  });

  // ------------------------------------------ F — chamada nativa bloqueante
  await test('F: chamada síncrona congela o event loop (heartbeat não avança)', async () => {
    const ticks = await contarTicksDurante(() => { chamadaNativaSincronaFake(250, '99'); });
    assert.strictEqual(ticks, 0);
  });

  await test('F: timer do TefManager expira durante a chamada e vence a persistência (00 vira TIMEOUT)', async () => {
    const { promessa, eventos } = simularPadraoTefManager({ timeoutMs: 50, duracaoNativaMs: 200 });
    let erro = null;
    try { await promessa; } catch (e) { erro = e; }
    assert.strictEqual(eventos.nativaRetornou, '00');
    assert.ok(erro, 'esperado timeout apesar do retorno 00');
    const decisao = classificarErroFinanceiro(erro);
    assert.strictEqual(decisao.state, 'TIMEOUT');
    assert.strictEqual(decisao.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(decisao.retryAllowed, false);
  });

  await test('F: controle — chamada abaixo do timeout resolve com o código nativo', async () => {
    const { promessa } = simularPadraoTefManager({ timeoutMs: 500, duracaoNativaMs: 20 });
    assert.deepStrictEqual(await promessa, { codigo: '00' });
  });

  await test('F: isolamento em worker mantém o event loop principal responsivo (stub)', async () => {
    const worker = new Worker(
      'const fim = Date.now() + 250; while (Date.now() < fim) {} require("worker_threads").parentPort.postMessage("99");',
      { eval: true }
    );
    const ticks = await contarTicksDurante(() => new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    }));
    await worker.terminate();
    assert.ok(ticks >= 5, `heartbeat esperado durante chamada isolada; ticks=${ticks}`);
  });

  await test('F: exports Koffi reais oferecem .async (sem chamar nenhuma função transacional)', () => {
    const destaxaKoffiLoader = require('../../backend/services/tef/destaxa/destaxaKoffiLoader');
    const destaxaDllResolver = require('../../backend/services/tef/destaxa/destaxaDllResolver');
    const resolucao = destaxaDllResolver.resolverDll({});
    assert.strictEqual(resolucao.sucesso, true);
    const lib = destaxaKoffiLoader.carregarBiblioteca(resolucao.dllPath);
    try {
      const nomes = ['iniciaTransacaoDestaxa', 'continuaTransacaoDestaxa', 'finalizaTransacaoDestaxa'];
      coleta.koffiAsync = Object.fromEntries(nomes.map((n) => [n, typeof lib.exports[n]?.async === 'function']));
    } finally {
      lib.unload();
    }
    assert.ok(Object.values(coleta.koffiAsync).every(Boolean), JSON.stringify(coleta.koffiAsync));
  });

  // ------------------------------------------------ G — timeout sem retry
  for (const mensagem of ['Timeout de 30000ms excedido na operação TEF', 'connect ETIMEDOUT', 'read ECONNRESET', 'connect ECONNREFUSED']) {
    await test(`G: "${mensagem}" → 1 tentativa, UNKNOWN, sem retry`, async () => {
      let chamadas = 0;
      let erro = null;
      try {
        await tefRetryService.autorizarComRetry(async () => {
          chamadas += 1;
          throw new Error(mensagem);
        }, { transactionId: 'tx-g', provider: 'destaxa' });
      } catch (e) { erro = e; }
      assert.strictEqual(chamadas, 1);
      assert.strictEqual(erro.retryAllowed, false);
      assert.strictEqual(erro.tefFinancialDecision.financialState, FINANCIAL_STATES.UNKNOWN);
    });
  }

  await test('G: com a DLL ocupada nenhuma nova cobrança começa antes do retorno', async () => {
    const ordem = [];
    const chamada = new Promise((resolve) => setImmediate(() => {
      ordem.push('nativa_inicio');
      chamadaNativaSincronaFake(150, '08');
      ordem.push('nativa_fim');
      resolve();
    }));
    setTimeout(() => ordem.push('segunda_cobranca'), 10);
    await chamada;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepStrictEqual(ordem, ['nativa_inicio', 'nativa_fim', 'segunda_cobranca']);
  });

  await test('G: 08 (timeout Destaxa) deixa contexto UNKNOWN e bloqueia nova transação', () => {
    const mock = new DestaxaTransacaoMockDriver([{ fn: 'inicia', codigo: '08', saida: '' }]);
    const orq = new DestaxaTransacaoOrquestrador({ driver: mock });
    const r = orq.iniciarTransacaoCRT(buildCrtInput({ valorCentavos: 100 }).campos, { transactionId: 'tx-08' });
    assert.strictEqual(r.retryAllowed, false);
    const nova = orq.iniciarTransacaoCRT(buildCrtInput({ valorCentavos: 100 }).campos);
    assert.strictEqual(nova.codigoDestaxa, ERROS.DESTAXA_TRANSACAO_EM_ANDAMENTO);
    assert.strictEqual(nova.contexto.transactionId, 'tx-08');
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
  });

  // --------------------------------------------- H — transactionId preservado
  await test('H: 1 operação = 1 transactionId através de 99 → continua → 08', () => {
    const mock = new DestaxaTransacaoMockDriver([
      { fn: 'inicia', codigo: '99', saida: 'mensagem=Insira o cartão' },
      { fn: 'continua', codigo: '99', saida: 'mensagem=Processando' },
      { fn: 'continua', codigo: '08', saida: '' }
    ]);
    const orq = new DestaxaTransacaoOrquestrador({ driver: mock });
    const r1 = orq.iniciarTransacaoCRT(buildCrtInput({ valorCentavos: 100 }).campos, { transactionId: '77' });
    const r2 = orq.continuarTransacao({ displayAck: true });
    const r3 = orq.continuarTransacao({ displayAck: true });
    for (const r of [r1, r2, r3]) assert.strictEqual(r.contexto.transactionId, '77');
    const nova = orq.iniciarTransacaoCRT({});
    assert.strictEqual(nova.contexto.transactionId, '77');
    assert.strictEqual(mock.contadores.iniciaTransacaoDestaxa, 1);
  });

  await test('H: gate fechado não cria transactionId', async () => {
    const { adapter, loader } = criarAdapterControlado();
    const r = await adapter.autorizarPagamento({ tipo: 'credito', valor: 1 });
    assert.strictEqual(r.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    assert.strictEqual(r.transacaoId, null);
    assert.strictEqual(r.transactionAttempted, false);
    assert.deepStrictEqual(
      { inicia: loader.contadores.inicia, continua: loader.contadores.continua, finaliza: loader.contadores.finaliza },
      { inicia: 0, continua: 0, finaliza: 0 }
    );
  });

  // ------------------------------------------------- I — gate ainda fechado
  await test('I: bridge recusa habilitar transação real sem a flag', () => {
    const loader = criarLoaderFake();
    const bridge = new DestaxaNativeBridge({ config: {}, nativeLoader: loader, resolver: resolverFake });
    bridge.load();
    bridge.iniciarClient({});
    const h = bridge.habilitarTransacaoReal();
    assert.strictEqual(h.sucesso, false);
    assert.strictEqual(h.codigo, ERROS.DESTAXA_REAL_TRANSACTION_DISABLED);
    const r = bridge.iniciarTransacaoDestaxa(OPERACOES.CRT, { transacao_valor: '1.00' });
    assert.strictEqual(r.codigo, ERROS.DESTAXA_TRANSACAO_REAL_BLOQUEADA);
    assert.strictEqual(loader.contadores.inicia, 0);
  });

  process.env.DESTAXA_CRT_PATH_CHECK = '1';
  const { DestaxaCrtRealPathVerifier, RESULT_READY, caminhoRelatorio } = require('../../backend/services/tef/destaxa/destaxaCrtRealPathVerifier');

  await test('I: Node real (banco persistido, sem override) — DLL/Client/VSPague/PPC930 e gate bloqueia antes da DLL', async () => {
    const { relatorio } = await new DestaxaCrtRealPathVerifier().executar();
    coleta.nodeReport = relatorio;
    assert.strictEqual(relatorio.result, RESULT_READY, JSON.stringify(relatorio, null, 2));
    assert.strictEqual(relatorio.environment, 'homologacao');
    assert.strictEqual(relatorio.adapterMode, 'real');
    assert.strictEqual(relatorio.dll.loaded, true);
    assert.strictEqual(relatorio.dll.exports, 4);
    assert.strictEqual(relatorio.client.code, '00');
    assert.strictEqual(relatorio.vspague.running, true);
    assert.strictEqual(relatorio.pinpad.model, 'PPC930');
    assert.strictEqual(relatorio.pinpad.port, 'COM3');
    assert.strictEqual(relatorio.pinpad.detected, true);
    assert.strictEqual(relatorio.crt.input, 'transacao_valor=1.00');
    assert.strictEqual(relatorio.realTransactionGate.enabled, false);
    assert.deepStrictEqual(
      [relatorio.transaction.iniciaCalls, relatorio.transaction.continuaCalls, relatorio.transaction.finalizaCalls],
      [0, 0, 0]
    );
  });

  await test('I: Electron 22.3.27 real — mesma verificação no runtime do CDS', () => {
    const electronPath = require('electron');
    const r = spawnSync(electronPath, ['.'], {
      cwd: RAIZ,
      env: { ...process.env, DESTAXA_CRT_PATH_CHECK: '1', DESTAXA_CRT_PATH_CHECK_ELECTRON: '1', [REAL_TRANSACTION_ENV]: '0' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024
    });
    if (r.status !== 0) {
      process.stdout.write(r.stdout || '');
      process.stderr.write(r.stderr || '');
    }
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.status, 0);
    const report = JSON.parse(fs.readFileSync(caminhoRelatorio(), 'utf8'));
    const e = report.runs.electron;
    coleta.electronReport = e;
    assert.strictEqual(e.runtime.electron, '22.3.27');
    assert.strictEqual(e.runtime.node, '16.17.1');
    assert.strictEqual(e.runtime.abi, '110');
    assert.strictEqual(e.result, RESULT_READY);
    assert.strictEqual(e.environment, 'homologacao');
    assert.strictEqual(e.crt.input, 'transacao_valor=1.00');
    assert.strictEqual(e.transaction.iniciaCalls + e.transaction.continuaCalls + e.transaction.finalizaCalls, 0);
  });

  const transacoesDepois = await contarTransacoes24h();
  coleta.newTransactions = transacoesDepois;
  await test('banco: nenhuma transação TEF nas últimas 24h (fim)', () => {
    assert.strictEqual(transacoesDepois, 0);
  });

  // ---------------------------------------------------------------- relatório
  const node = coleta.nodeReport || {};
  const electron = coleta.electronReport || {};
  const chamadas = ['iniciaCalls', 'continuaCalls', 'finalizaCalls'].map((k) => (node.transaction?.[k] || 0) + (electron.transaction?.[k] || 0));
  const relatorio = {
    sprint: 'TEF-DESTAXA-06C-PREP',
    timestamp: new Date().toISOString(),
    transactionExecuted: false,
    realTransactionGate: { env: REAL_TRANSACTION_ENV, enabled: transacaoRealHabilitada() },
    valueFormat: {
      confirmed: coleta.valueFormat?.confirmed === true,
      format: coleta.valueFormat?.format || null,
      internalValueCents: 100,
      sent: coleta.valueFormat?.sent || null,
      conversion: 'destaxaProtocolo.formatarValorDestaxa (única conversão CDS→Destaxa)',
      source: FORMATO_VALOR_DESTAXA.source
    },
    configuration: coleta.configuration,
    pinpad: { model: node.pinpad?.model || null, port: node.pinpad?.port || null, detected: node.pinpad?.detected === true },
    dll: { loaded: node.dll?.loaded === true, exports: node.dll?.exports || 0, path: node.dll?.path || null },
    client: { initialized: node.client?.initialized === true, code: node.client?.code || null },
    vspague: { running: node.vspague?.running === true, responding: node.vspague?.responding === true },
    electron: electron.runtime
      ? { version: electron.runtime.electron, node: electron.runtime.node, abi: electron.runtime.abi, result: electron.result }
      : null,
    nativeCall: {
      synchronous: true,
      blockingRisk: true,
      finding: 'NATIVE_CALL_BLOCKING_RISK',
      evidence: [
        'destaxaKoffiLoader/criarDriverTransacaoNativo chamam as funções Koffi de forma síncrona na thread do processo principal',
        'docs/07: após DISPLAY a AC deve aguardar o fim da chamada; exemplo clang usa laço síncrono while(resultado == "99")',
        'teste F: event loop congelado durante a chamada; timer do TefManager expira e vence a persistência (00 reportado como TIMEOUT)',
        'chamada nativa travada não pode ser interrompida no mesmo processo; falha da DLL derruba o processo principal'
      ],
      koffiAsyncAvailable: coleta.koffiAsync,
      recommendedIsolation: 'Processo host TEF dedicado (Electron utilityProcess ou fork com ELECTRON_RUN_AS_NODE) dono da DLL, do orquestrador e do transactionId, com IPC e chamadas serializadas; alternativa mínima: Koffi .async (thread libuv) serializado no mesmo processo',
      timeoutStrategy: 'TIMEOUT → UNKNOWN → SEM RETRY; enquanto houver chamada nativa em voo o lock TEF permanece retido e nenhuma nova cobrança é aceita; resolução somente pelo retorno da DLL ou reconciliação',
      mitigationRequiredBefore06C: true
    },
    transaction: { iniciaCalls: chamadas[0], continuaCalls: chamadas[1], finalizaCalls: chamadas[2] },
    database: { newTransactions: coleta.newTransactions, window: '24h' },
    tests: { passed: passou, failed: falhou, failures: falhas },
    result: falhou === 0 ? 'READY_FOR_06C' : 'NOT_READY_FOR_06C'
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
