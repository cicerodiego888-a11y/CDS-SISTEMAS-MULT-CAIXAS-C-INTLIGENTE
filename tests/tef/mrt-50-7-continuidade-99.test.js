'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DB_DIR_TESTE = path.join(
  os.tmpdir(),
  `cds-mrt-50-7-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
);
const REPORT_PATH = path.join(ROOT, 'docs/build/mrt-50-7-continuidade-99-report.json');

process.env.CDS_TEST_ISOLAR_BANCO = '1';
process.env.DB_DIR = DB_DIR_TESTE;
process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
delete process.env.DESTAXA_CONTINUIDADE_PERSISTENTE;

const db = require('../../backend/database');
const repository = require('../../backend/services/tef/tefRepository');
const persistencia = require('../../backend/services/tef/destaxa/destaxaContinuidadePersistencia');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const TefManager = require('../../backend/services/tef/TefManager').TefManager;
const {
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  ERROS_CONTINUIDADE,
  normalizarAcaoContinuidade
} = require('../../backend/services/tef/destaxa/destaxaContinuidadeContrato');

const SUFFIX = crypto.randomBytes(5).toString('hex');
const ACAO = Object.freeze({
  tipo: 'OPCAO',
  mensagem: 'Tipo do Cartao',
  opcoes: ['Credito', 'Debito', 'Voucher'],
  tipoDado: 'X',
  timeout: '120',
  chave: 'transacao_tipo_cartao'
});

const resultados = [];
const transacoesTeste = [];

function assertGateOff() {
  process.env[REAL_TRANSACTION_ENV] = '0';
  assert.strictEqual(transacaoRealHabilitada(), false);
}

function whenReady() {
  return new Promise((resolve, reject) => {
    db.whenReady((error) => (error ? reject(error) : resolve()));
  });
}

function novoDriver() {
  const chamadas = { inicia: 0, continua: 0, finaliza: 0 };
  const driver = {
    iniciarTransacaoDestaxa() {
      chamadas.inicia += 1;
      throw new Error('TX_START proibido no teste MRT-50.7');
    },
    continuarTransacaoDestaxa() {
      chamadas.continua += 1;
      return {
        sucesso: true,
        codigoDestaxa: '00',
        financialState: 'CONFIRMED_SUCCESS',
        estado: 'FINALIZADO'
      };
    },
    finalizarTransacaoDestaxa() {
      chamadas.finaliza += 1;
      return {
        sucesso: true,
        codigoDestaxa: '00',
        financialState: 'CONFIRMED_SUCCESS',
        estado: 'FINALIZADO'
      };
    }
  };
  const bridge = {
    iniciarTransacaoDestaxa: (...args) => driver.iniciarTransacaoDestaxa(...args),
    continuarTransacaoDestaxa: (...args) => driver.continuarTransacaoDestaxa(...args),
    finalizarTransacaoDestaxa: (...args) => driver.finalizarTransacaoDestaxa(...args)
  };
  return { chamadas, driver, bridge };
}

async function criarFixture({
  action = ACAO,
  solicitadaEm = new Date().toISOString(),
  registrarSolicitacao = true
} = {}) {
  const token = `${SUFFIX}_${crypto.randomBytes(4).toString('hex')}`;
  const idempotencyKey = `mrt39_mrt507_${token}`;
  const operationId = `op_mrt507_${token}`;
  const fingerprint = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  const transacao = await persistencia.criarTransacaoContinuidadeTeste({
    idempotencyKey,
    operationId,
    fingerprint
  });
  transacoesTeste.push(transacao.id);
  const identidade = {
    transactionId: String(transacao.id),
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    fingerprint
  };
  if (registrarSolicitacao) {
    const solicitacao = await persistencia.registrarSolicitacao99(transacao.id, {
      acao: action,
      solicitadaEm
    });
    assert.strictEqual(solicitacao.ok, true, solicitacao.mensagem);
    assert.strictEqual(solicitacao.duravel, true);
    assert.strictEqual(solicitacao.confirmada, true);
  }
  return {
    id: String(transacao.id),
    idempotencyKey,
    operationId,
    fingerprint,
    identidade,
    solicitadaEm: registrarSolicitacao ? new Date(solicitadaEm).toISOString() : null
  };
}

function novoAdapter(mock) {
  return new DestaxaRealAdapter(
    { pdvCodigo: 'PDV-MRT507', caixaCodigo: 'CX-MRT507' },
    { bridge: mock.bridge, executionMode: 'in-process' }
  );
}

async function continuar(fixture, mock, extra = {}) {
  return novoAdapter(mock).continuarPagamento({
    transacao_id: fixture.id,
    idempotency_key: fixture.idempotencyKey,
    idempotency_key_persistida: fixture.idempotencyKey,
    identidadePersistida: fixture.identidade,
    resposta_continuidade: 'Credito',
    acao: ACAO,
    solicitadaEm: fixture.solicitadaEm,
    ambienteOperador: { tty: true },
    ...extra
  });
}

async function gravarPayload(fixture, update) {
  const transacao = await persistencia.buscarTransacao(fixture.id);
  const payload = { ...(transacao.payload_retorno || {}) };
  update(payload);
  await new Promise((resolve, reject) => {
    repository.atualizarTransacao(fixture.id, {
      status: 'pendente',
      payload_retorno: payload
    }, (error) => (error ? reject(error) : resolve()));
  });
}

function verificarBloqueio(nome, resultado, mock, detalhes = {}) {
  assert.notStrictEqual(resultado?.sucesso, true, `${nome}: fluxo deveria falhar fechado`);
  assert.strictEqual(mock.chamadas.continua, 0, `${nome}: TX_CONTINUE chegou ao driver`);
  assert.strictEqual(mock.chamadas.inicia, 0, `${nome}: TX_START chegou ao driver`);
  assert.strictEqual(mock.chamadas.finaliza, 0, `${nome}: TX_FINALIZE chegou ao driver`);
  resultados.push({
    cenario: nome,
    resultado: 'PASSOU',
    codigo: resultado?.codigo || null,
    contadores: { ...mock.chamadas },
    ...detalhes
  });
}

async function testarRespostaValida() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const resultado = await continuar(fixture, mock);
  assert.strictEqual(resultado.sucesso, true, resultado.mensagem);
  assert.deepStrictEqual(mock.chamadas, { inicia: 0, continua: 1, finaliza: 1 });
  const recuperada = await persistencia.recuperarSolicitacao99(fixture.id);
  const resposta = recuperada.respostas.find((item) =>
    item.solicitadaEm === recuperada.solicitacao99.solicitadaEm);
  assert.ok(resposta);
  assert.deepStrictEqual(resposta.identidade, fixture.identidade);
  assert.deepStrictEqual(resposta.acao, normalizarAcaoContinuidade(ACAO));
  resultados.push({
    cenario: 'Persistência confirmada, identidade correspondente e timestamp válido',
    resultado: 'PASSOU',
    solicitadaEm: recuperada.solicitacao99.solicitadaEm,
    respostaDuravel: true,
    contadores: { ...mock.chamadas }
  });
  return fixture;
}

async function testarFalhaDeGravacao() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const runOriginal = db.run;
  db.run = function runFalhando(sql, ...args) {
    if (/UPDATE\s+tef_transacoes/i.test(String(sql))) {
      const callback = args[args.length - 1];
      return callback.call({ changes: 0 }, new Error('falha simulada de gravação'));
    }
    return runOriginal.call(this, sql, ...args);
  };
  try {
    const resultado = await continuar(fixture, mock);
    verificarBloqueio('Falha na gravação', resultado, mock);
  } finally {
    db.run = runOriginal;
  }
}

async function testarPersistenciaIndisponivel() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const getOriginal = db.get;
  db.get = function getIndisponivel(sql, params, callback) {
    if (/FROM\s+tef_transacoes/i.test(String(sql))) {
      return callback(new Error('armazenamento indisponível'));
    }
    return getOriginal.call(this, sql, params, callback);
  };
  try {
    const resultado = await continuar(fixture, mock);
    verificarBloqueio('Persistência indisponível', resultado, mock);
  } finally {
    db.get = getOriginal;
  }
}

async function testarRetornoInvalidoPersistencia() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const registrarOriginal = persistencia.registrarRespostaOperador;
  persistencia.registrarRespostaOperador = async () => ({
    ok: true,
    duravel: true,
    confirmada: false
  });
  try {
    const resultado = await continuar(fixture, mock);
    verificarBloqueio('Retorno inválido da persistência', resultado, mock);
  } finally {
    persistencia.registrarRespostaOperador = registrarOriginal;
  }
}

async function testarRecuperacaoAposReinicio() {
  const fixture = await criarFixture();
  const expected = (await persistencia.recuperarSolicitacao99(fixture.id))
    .solicitacao99.solicitadaEm;
  const script = `
    process.env.CDS_TEST_ISOLAR_BANCO = '1';
    process.env.DB_DIR = ${JSON.stringify(DB_DIR_TESTE)};
    process.env.DESTAXA_REAL_TRANSACTION_ENABLED = '0';
    const db = require(${JSON.stringify(path.join(ROOT, 'backend/database.js'))});
    const persistencia = require(${JSON.stringify(path.join(
      ROOT,
      'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js'
    ))});
    db.whenReady((err) => {
      if (err) { console.error(err.message); process.exit(2); }
      persistencia.recuperarSolicitacao99(${JSON.stringify(fixture.id)})
        .then((r) => {
          console.log(JSON.stringify({ ok: r.ok, solicitadaEm: r.solicitacao99?.solicitadaEm }));
          process.exit(r.ok ? 0 : 3);
        })
        .catch((e) => { console.error(e.message); process.exit(4); });
    });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CDS_TEST_ISOLAR_BANCO: '1',
      DB_DIR: DB_DIR_TESTE,
      DESTAXA_REAL_TRANSACTION_ENABLED: '0'
    }
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const recuperacao = JSON.parse(child.stdout.trim().split(/\r?\n/).pop());
  assert.strictEqual(recuperacao.ok, true);
  assert.strictEqual(recuperacao.solicitadaEm, expected);
  const mock = novoDriver();
  const resultado = await continuar(fixture, mock);
  assert.strictEqual(resultado.sucesso, true, resultado.mensagem);
  assert.strictEqual(mock.chamadas.continua, 1);
  resultados.push({
    cenario: 'Reinicialização recupera o timestamp original',
    resultado: 'PASSOU',
    solicitadaEmOriginal: expected,
    solicitadaEmRecuperado: recuperacao.solicitadaEm,
    contadores: { ...mock.chamadas }
  });
}

async function testarManagerPersisteTimestampOriginal() {
  const fixture = await criarFixture({ registrarSolicitacao: false });
  const timestampOriginal = new Date(Date.now() - 1500).toISOString();
  const manager = new TefManager({
    recuperarNoInicio: false,
    nativeHostClient: {
      configurarChavePublicaReconciliacao() {},
      configurarProvedorBootstrapSeguranca() {}
    }
  });
  const persistida = await manager._persistirSolicitacao99(
    fixture.id,
    {
      requerContinuacao: true,
      acao: ACAO,
      solicitadaEm: timestampOriginal,
      codigoDestaxa: '99'
    },
    { idempotency_key: fixture.idempotencyKey }
  );
  const recuperada = await persistencia.recuperarSolicitacao99(fixture.id);
  assert.strictEqual(persistida.duravel, true);
  assert.strictEqual(recuperada.solicitacao99.solicitadaEm, timestampOriginal);
  assert.strictEqual(manager._continuidadeCrt.solicitadaEm, timestampOriginal);
  resultados.push({
    cenario: 'TefManager persiste e preserva o timestamp no recebimento da solicitação',
    resultado: 'PASSOU',
    timestampOriginal,
    timestampPersistido: recuperada.solicitacao99.solicitadaEm
  });
}

async function testarTimestampInvalido(tipo, valor) {
  const fixture = await criarFixture();
  await gravarPayload(fixture, (payload) => {
    const solicitacao = payload.continuidade.solicitacao99;
    if (tipo === 'ausente') delete solicitacao.solicitadaEm;
    else solicitacao.solicitadaEm = valor;
  });
  const mock = novoDriver();
  const resultado = await continuar(fixture, mock);
  verificarBloqueio(`Timestamp ${tipo}`, resultado, mock);
}

async function testarTimestampExpirado() {
  const fixture = await criarFixture({
    action: { ...ACAO, timeout: '1' },
    solicitadaEm: new Date(Date.now() - 5000).toISOString()
  });
  const mock = novoDriver();
  const resultado = await continuar(fixture, mock, {
    acao: { ...ACAO, timeout: '1' }
  });
  verificarBloqueio('Timestamp expirado', resultado, mock);
}

async function testarReplay() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const first = await continuar(fixture, mock);
  assert.strictEqual(first.sucesso, true, first.mensagem);
  const continuesBeforeReplay = mock.chamadas.continua;
  const replay = await continuar(fixture, mock);
  assert.notStrictEqual(replay.sucesso, true);
  assert.strictEqual(mock.chamadas.continua, continuesBeforeReplay);
  assert.strictEqual(mock.chamadas.inicia, 0);
  resultados.push({
    cenario: 'Replay da mesma resposta rejeitado',
    resultado: 'PASSOU',
    deltaContadores: {
      inicia: 0,
      continua: mock.chamadas.continua - continuesBeforeReplay,
      finaliza: 0
    },
    codigo: replay.codigo
  });
}

async function testarIdentidadeDivergente() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const resultado = await continuar(fixture, mock, {
    identidadePersistida: {
      ...fixture.identidade,
      fingerprint: 'fingerprint-divergente'
    }
  });
  verificarBloqueio('Resposta vinculada a outra identidade', resultado, mock);
}

async function testarFalhaLeituraAposGravacao() {
  const fixture = await criarFixture();
  const mock = novoDriver();
  const runOriginal = db.run;
  const getOriginal = db.get;
  let updateRealizado = false;
  let falhouNaReleitura = false;
  db.run = function runMonitorado(sql, ...args) {
    const ehUpdate = /UPDATE\s+tef_transacoes/i.test(String(sql));
    const callback = args[args.length - 1];
    if (!ehUpdate) return runOriginal.call(this, sql, ...args);
    return runOriginal.call(this, sql, ...args.slice(0, -1), function onUpdate(err) {
      if (!err && this.changes === 1) updateRealizado = true;
      callback.call(this, err);
    });
  };
  db.get = function getComFalhaDeReleitura(sql, params, callback) {
    if (updateRealizado
      && !falhouNaReleitura
      && /FROM\s+tef_transacoes/i.test(String(sql))) {
      falhouNaReleitura = true;
      return callback(new Error('falha simulada na releitura pós-gravação'));
    }
    return getOriginal.call(this, sql, params, callback);
  };
  try {
    const resultado = await continuar(fixture, mock);
    verificarBloqueio('Falha de leitura após gravação', resultado, mock, {
      gravaçãoConfirmadaAntesDaFalha: updateRealizado,
      falhouNaReleitura
    });
    const transacao = await persistencia.buscarTransacao(fixture.id);
    assert.strictEqual(transacao.status, 'pendente');
    const manager = new TefManager({
      recuperarNoInicio: false,
      nativeHostClient: {
        configurarChavePublicaReconciliacao() {},
        configurarProvedorBootstrapSeguranca() {}
      }
    });
    await manager.recarregarPendencias();
    assert.strictEqual(manager._pendencias.has(fixture.id), true);
    resultados.push({
      cenario: 'Falha no fluxo mantém identidade bloqueada após recuperação',
      resultado: 'PASSOU',
      transacaoPendente: true,
      identidadeNoMapaDeBloqueios: manager._pendencias.has(fixture.id),
      contadores: { ...mock.chamadas }
    });
  } finally {
    db.run = runOriginal;
    db.get = getOriginal;
  }
}

async function main() {
  assertGateOff();
  await whenReady();
  const banco = persistencia.caminhoBancoEfetivo();
  assert.ok(path.resolve(banco.dbPath).startsWith(path.resolve(DB_DIR_TESTE)));

  await testarRespostaValida();
  await testarFalhaDeGravacao();
  await testarPersistenciaIndisponivel();
  await testarRetornoInvalidoPersistencia();
  await testarManagerPersisteTimestampOriginal();
  await testarRecuperacaoAposReinicio();
  await testarTimestampInvalido('ausente');
  await testarTimestampInvalido('inválido', 'nao-e-uma-data');
  await testarTimestampExpirado();
  await testarReplay();
  await testarIdentidadeDivergente();
  await testarFalhaLeituraAposGravacao();

  const report = {
    sprint: 'MRT-50.7',
    titulo: 'Correção fail-closed da continuidade Destaxa 99',
    classificacaoFinal: 'TESTADO',
    banco: {
      diretorio: banco.dbDir,
      caminho: banco.dbPath,
      sqliteTemporario: true,
      bancoOficialAcessado: false
    },
    gateFinanceiro: false,
    dllCarregada: false,
    operacoesFinanceirasReais: 0,
    contadoresDriver: resultados.map((item) => ({
      cenario: item.cenario,
      ...item.contadores
    })),
    cenarios: resultados,
    arquivosProducaoAlterados: [
      'backend/services/tef/TefManager.js',
      'backend/services/tef/adapters/DestaxaRealAdapter.js',
      'backend/services/tef/destaxa/destaxaContinuidadeContrato.js',
      'backend/services/tef/destaxa/destaxaContinuidadePersistencia.js',
      'backend/services/tef/destaxa/destaxaCrtCicloOrquestracao.js'
    ],
    geradoEm: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    sucesso: true,
    cenarios: resultados.length,
    falhas: 0,
    gateFinanceiro: false,
    dllCarregada: false,
    operacoesFinanceirasReais: 0,
    contadoresDriver: report.contadoresDriver
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (typeof db.close === 'function') {
      await new Promise((resolve) => db.close(() => resolve()));
    }
    if (path.resolve(DB_DIR_TESTE).startsWith(path.resolve(os.tmpdir()))
      && path.basename(DB_DIR_TESTE).startsWith('cds-mrt-50-7-')) {
      fs.rmSync(DB_DIR_TESTE, { recursive: true, force: true });
    }
  });
