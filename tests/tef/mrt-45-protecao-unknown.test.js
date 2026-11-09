'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt45-tef-'));
process.env.DB_DIR = TEST_DB_DIR;
const database = require('../../backend/database');

const DestaxaTransacaoOrquestrador = require('../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador');
const { classificarCodigoTransacao } = require('../../backend/services/tef/destaxa/destaxaProtocolo');
const { DestaxaNativeHostRuntime, TEST_MODE_ENV } = require('../../backend/services/tef/destaxa/DestaxaNativeHost');
const { DestaxaNativeHostClient } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { OPERACOES_HOST, criarRequest, criarResponse, ERROS_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const { transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

const CODIGOS_UNKNOWN = ['05', '06', '07', 'F1', 'F2', 'FE'];
const CODIGOS_NEGACAO = ['03', '04', '09'];
let repository;
let tefPendenciasService;
let tefManagerSingleton;

async function aguardarBancoTemporarioPronto() {
  const limite = Date.now() + 30000;
  while (!database.isReady()) {
    if (Date.now() >= limite) throw new Error('Banco temporario MRT-45 nao ficou pronto');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function novoHost(codigo, contadores) {
  const driver = {
    nome: 'mock',
    iniciaTransacaoDestaxa() {
      contadores.inicia += 1;
      return { codigo: contadores.inicia === 1 ? codigo : '03', saida: '' };
    },
    continuaTransacaoDestaxa() {
      contadores.continua += 1;
      return { codigo: '99', saida: '' };
    },
    finalizaTransacaoDestaxa() {
      contadores.finaliza += 1;
      return { codigo: '00', saida: '' };
    }
  };
  const orquestrador = new DestaxaTransacaoOrquestrador({ driver });
  const bridge = {
    getTransacaoContexto: () => orquestrador.getContexto(),
    getOrquestradorTransacao: () => orquestrador,
    iniciarTransacaoDestaxa: (operacao, campos, opcoes) => orquestrador.iniciarTransacao(operacao, campos, opcoes),
    continuarTransacaoDestaxa: (resposta) => orquestrador.continuarTransacao(resposta),
    finalizarTransacaoDestaxa: (confirmacao) => orquestrador.finalizarTransacao(confirmacao),
    isLoaded: () => false,
    getDiagnostics: () => ({ dllLoaded: false })
  };
  return new DestaxaNativeHostRuntime({
    bridge,
    modoTeste: true,
    encerrarProcesso: () => {}
  });
}

function iniciarNoHost(host, transactionId) {
  return host._executarNativa({
    operation: OPERACOES_HOST.TX_START,
    transactionId,
    payload: { operacao: 'CRT', campos: { valor: 100 } }
  });
}

async function verificarPersistenciaAposReinicio(codigo) {
  const transactionId = `mrt45-${codigo}`;
  const financialState = classificarCodigoTransacao(codigo).financialState;
  const persistedRow = {
    id: transactionId,
    status: 'pendente',
    provedor: 'DESTAXA',
    tipo: 'CRT',
    criado_em: '2026-01-01T00:00:00.000Z',
    idempotency_key: `idem-${transactionId}`,
    payload_retorno: {
      resultadoTardio: { codigo, financialState },
      identidadeOperacao: { transactionId, idempotency_key: `idem-${transactionId}` }
    }
  };
  const worker = `
    const database = require('./backend/database');
    const row = JSON.parse(process.argv[1]);
    const aguardarBanco = async () => {
      const limite = Date.now() + 30000;
      while (!database.isReady()) {
        if (Date.now() >= limite) throw new Error('Banco temporario do worker MRT-45 nao ficou pronto');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    aguardarBanco().then(async () => {
      const repository = require('./backend/services/tef/tefRepository');
      repository.listarTransacoesPendentes = (callback) => setImmediate(() => callback(null, [row]));
      const TefManagerModule = require('./backend/services/tef/TefManager');
      const manager = new TefManagerModule.TefManager({ recuperarNoInicio: false });
      const trava = await manager.recarregarPendencias();
      const recuperada = manager._pendencias.get(String(row.id)).recuperacao;
      await TefManagerModule.garantirRecuperacao();
      process.stdout.write('@@MRT45@@' + JSON.stringify({
        transacaoId: trava.transacaoId,
        estado: trava.estado,
        financialState: trava.financialState,
        codigoBloqueio: manager._respostaTravaResultadoTardio().codigo,
        idempotency_key: recuperada.idempotency_key,
        transacaoRecuperada: recuperada.transacaoId
      }) + '\\n');
    }).then(() => new Promise((resolve, reject) => {
      database.close((error) => (error ? reject(error) : resolve()));
    })).catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
  `;
  const raiz = path.resolve(__dirname, '../..');
  const workerDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mrt45-restart-'));
  let resultado;
  try {
    resultado = spawnSync(process.execPath, ['-e', worker, JSON.stringify(persistedRow)], {
      cwd: raiz,
      env: { ...process.env, DB_DIR: workerDbDir, DESTAXA_REAL_TRANSACTION_ENABLED: '0' },
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    });
  } finally {
    fs.rmSync(workerDbDir, { recursive: true, force: true });
  }
  assert.strictEqual(resultado.status, 0, resultado.stderr || resultado.stdout);
  const linhaResultado = resultado.stdout.split(/\r?\n/).find((linha) => linha.includes('@@MRT45@@'));
  assert.ok(linhaResultado, resultado.stdout);
  const recuperada = JSON.parse(linhaResultado.slice(linhaResultado.indexOf('@@MRT45@@') + 9));
  assert.strictEqual(recuperada.transacaoId, transactionId);
  assert.strictEqual(recuperada.estado, 'RECONCILIACAO_PENDENTE');
  assert.strictEqual(recuperada.financialState, FINANCIAL_STATES.UNKNOWN);
  assert.strictEqual(recuperada.codigoBloqueio, 'TEF_RESULTADO_PENDENTE');
  assert.strictEqual(recuperada.idempotency_key, `idem-${transactionId}`);
  assert.strictEqual(recuperada.transacaoRecuperada, transactionId);
}

async function verificarClienteHostComMock() {
  const client = new DestaxaNativeHostClient({ env: { [TEST_MODE_ENV]: '1' }, timeoutMs: 5000 });
  try {
    const configurado = await client.enviar(OPERACOES_HOST.CONFIGURE_MOCK, {
      passos: [
        { fn: 'inicia', codigo: 'F2', saida: '' },
        { fn: 'inicia', codigo: '03', saida: '' }
      ]
    });
    assert.strictEqual(configurado.output.sucesso, true);

    const primeira = await client.enviar(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: { valor: 100 } },
      { transactionId: 'tx-ipc-f2' }
    );
    assert.strictEqual(primeira.output.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(client.getEstado().reconciliacaoPendente.transactionId, 'tx-ipc-f2');

    const bloqueada = await client.enviar(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: { valor: 100 } },
      { transactionId: 'tx-ipc-retry' }
    );
    assert.strictEqual(bloqueada.error.code, ERROS_HOST.HOST_RECONCILIATION_PENDING);
    const status = await client.enviar(OPERACOES_HOST.STATUS);
    assert.strictEqual(status.output.mockContadores.iniciaTransacaoDestaxa, 1);

    const reconciliacao = await client.reconciliarTransacao('tx-ipc-f2', {
      financialState: 'CONFIRMED_DENIED',
      usuario: 'mrt45-ipc-test',
      observacao: 'resultado persistido e confirmado no teste isolado',
      confirmacao_explicita: true,
      persistida: true
    });
    assert.strictEqual(reconciliacao.sucesso, false);
    assert.strictEqual(client.getEstado().reconciliacaoPendente.transactionId, 'tx-ipc-f2');

    const depois = await client.enviar(
      OPERACOES_HOST.TX_START,
      { operacao: 'CRT', campos: { valor: 100 } },
      { transactionId: 'tx-ipc-after-reconciliation' }
    );
    assert.strictEqual(depois.error.code, ERROS_HOST.HOST_RECONCILIATION_PENDING);
    return { bypassDiretoBloqueado: true, marcadorMantido: true, novaTransacaoBloqueada: true };
  } finally {
    await client.encerrar();
  }
}

async function verificarServicoDeReconciliacao() {
  const etapas = [];
  const manager = {
    reconciliarResultadoTardio(transactionId, dados) {
      etapas.push('persistencia');
      assert.strictEqual(transactionId, 'tx-service');
      assert.strictEqual(dados.financialState, 'CONFIRMED_DENIED');
      return { transacaoId: transactionId, status: 'negado', travaLiberada: true };
    },
    async reconciliarNativeHost(transactionId, dados, resultado) {
      etapas.push('native-host');
      assert.strictEqual(transactionId, 'tx-service');
      assert.strictEqual(dados.confirmacao_explicita, true);
      assert.strictEqual(resultado.status, 'negado');
      return {
        sucesso: true,
        transactionId,
        hostAtualizado: true,
        travaLiberada: true
      };
    }
  };
  const resultado = await tefPendenciasService.reconciliarExplicita({
    tefManager: manager,
    repository: { registrarLog() {} },
    transacaoId: 'tx-service',
    financialState: 'CONFIRMED_DENIED',
    usuario: 'mrt45-operador',
    observacao: 'comprovante de negação confirmado',
    confirmacao_explicita: true
  });
  assert.deepStrictEqual(etapas, ['persistencia', 'native-host']);
  assert.strictEqual(resultado.sucesso, true);
  assert.strictEqual(resultado.travaLiberada, true);
}

async function main() {
  await aguardarBancoTemporarioPronto();
  repository = require('../../backend/services/tef/tefRepository');
  repository.listarTransacoesPendentes = (callback) => setImmediate(() => callback(null, []));
  const TefManagerModule = require('../../backend/services/tef/TefManager');
  tefManagerSingleton = TefManagerModule;
  tefPendenciasService = require('../../backend/services/tef/tefPendenciasService');
  assert.strictEqual(transacaoRealHabilitada(), false, 'gate financeiro deve permanecer OFF');
  assert.notStrictEqual(String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim(), '1');
  const evidencias = { porCodigo: {}, negacoesConcludentes: {}, gateFinanceiro: false };

  for (const codigo of CODIGOS_UNKNOWN) {
    const classificacao = classificarCodigoTransacao(codigo);
    assert.strictEqual(classificacao.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(classificacao.estadoTransacao, 'ERROR');

    const contadores = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost(codigo, contadores);
    const primeira = iniciarNoHost(host, `tx-${codigo}`);
    assert.strictEqual(primeira.financialState, FINANCIAL_STATES.UNKNOWN);
    assert.strictEqual(primeira.estado, 'ERROR');

    assert.throws(
      () => iniciarNoHost(host, `tx-segunda-${codigo}`),
      (error) => error.code === ERROS_HOST.HOST_RECONCILIATION_PENDING
    );
    assert.strictEqual(contadores.inicia, 1, `${codigo}: TX_START adicional não pode chamar o driver`);
    assert.strictEqual(contadores.continua, 0);
    assert.strictEqual(contadores.finaliza, 0);

    const client = new DestaxaNativeHostClient({ env: {} });
    const request = criarRequest(OPERACOES_HOST.TX_START, {}, `tx-client-${codigo}`);
    client._estado = 'BUSY';
    client._emVoo = {
      req: request,
      expirado: false,
      inicio: Date.now(),
      timer: null,
      resolve: () => {}
    };
    client._aoMensagem(criarResponse(request, {
      output: {
        financialState: FINANCIAL_STATES.UNKNOWN,
        contexto: { transactionId: request.transactionId, financialState: FINANCIAL_STATES.UNKNOWN }
      }
    }));
    const bloqueioCliente = await client.enviar(OPERACOES_HOST.TX_START, {}, { transactionId: `tx-retry-${codigo}` });
    assert.strictEqual(bloqueioCliente.error.code, ERROS_HOST.HOST_RECONCILIATION_PENDING);
    const reinicioSemRecon = await client.reiniciar();
    assert.strictEqual(reinicioSemRecon.codigo, ERROS_HOST.HOST_RECONCILIATION_PENDING);

    await verificarPersistenciaAposReinicio(codigo);
    evidencias.porCodigo[codigo] = {
      classificacaoFinanceira: classificacao.financialState,
      estadoTecnico: classificacao.estadoTransacao,
      bloqueioNativeHost: true,
      chamadasDriver: contadores,
      retryBloqueadoNoCliente: true,
      travaRecuperadaAposReinicio: true
    };
  }

  for (const codigo of CODIGOS_NEGACAO) {
    const classificacao = classificarCodigoTransacao(codigo);
    assert.notStrictEqual(classificacao.financialState, FINANCIAL_STATES.UNKNOWN);
    const contadores = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost(codigo, contadores);
    const primeira = iniciarNoHost(host, `tx-negado-${codigo}`);
    assert.notStrictEqual(primeira.financialState, FINANCIAL_STATES.UNKNOWN);
    const segunda = iniciarNoHost(host, `tx-negado-segunda-${codigo}`);
    assert.strictEqual(segunda.financialState, classificacao.financialState);
    assert.strictEqual(contadores.inicia, 2);
    evidencias.negacoesConcludentes[codigo] = {
      classificacaoFinanceira: classificacao.financialState,
      segundaTentativaPermitida: true
    };
  }

  evidencias.integracaoClienteNativeHost = await verificarClienteHostComMock();
  await verificarServicoDeReconciliacao();
  evidencias.reconciliacaoViaServico = 'persistência antes da liberação NativeHost';

  {
    const contadores = { inicia: 0, continua: 0, finaliza: 0 };
    const host = novoHost('F1', contadores);
    const primeira = iniciarNoHost(host, 'tx-reconciliar');
    const invalida = host._processar(criarRequest(OPERACOES_HOST.RECONCILE, {
      transactionId: 'tx-reconciliar',
      financialState: 'CONFIRMED_DENIED',
      usuario: 'mrt45-teste',
      observacao: 'sem confirmação persistida',
      confirmacao_explicita: true,
      persistida: false
    }, 'tx-reconciliar'));
    assert.strictEqual(invalida.error.code, ERROS_HOST.HOST_RECONCILIATION_PENDING);
    assert.throws(
      () => iniciarNoHost(host, 'tx-apos-reconciliacao-invalida'),
      (error) => error.code === ERROS_HOST.HOST_RECONCILIATION_PENDING
    );

    const bypassDireto = host._processar(criarRequest(OPERACOES_HOST.RECONCILE, {
      transactionId: 'tx-reconciliar',
      financialState: 'CONFIRMED_DENIED',
      usuario: 'mrt45-teste',
      observacao: 'resultado confirmado no procedimento autorizado',
      confirmacao_explicita: true,
      persistida: true
    }, 'tx-reconciliar'));
    assert.strictEqual(bypassDireto.error.code, ERROS_HOST.HOST_RECONCILIATION_PENDING);
    assert.throws(
      () => iniciarNoHost(host, 'tx-apos-reconciliacao-direta'),
      (error) => error.code === ERROS_HOST.HOST_RECONCILIATION_PENDING
    );
    assert.strictEqual(contadores.inicia, 1);
    evidencias.reconciliacaoExplicita = {
      resultadoInicial: primeira.financialState,
      tentativaDiretaComPersistidaTrue: 'bloqueada',
      identidadePreservada: 'tx-reconciliar',
      chamadasDriver: contadores.inicia
    };
  }

  console.log(JSON.stringify({ sucesso: true, evidencias }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (tefManagerSingleton) {
    await tefManagerSingleton.garantirRecuperacao().catch((error) => {
      console.error(`Falha na recuperacao mock MRT-45: ${error.message}`);
      process.exitCode = 1;
    });
  }
  await new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  }).catch((error) => {
    console.error(`Falha ao fechar banco temporario MRT-45: ${error.message}`);
    process.exitCode = 1;
  });
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});
