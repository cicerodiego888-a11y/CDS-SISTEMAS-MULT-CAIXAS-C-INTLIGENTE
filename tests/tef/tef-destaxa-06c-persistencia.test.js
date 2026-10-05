/**
 * TEF-DESTAXA-06C-PERSISTENCIA — recuperação de resultado TEF pendente após reinício.
 *
 * Cada "PDV" é um processo Node separado (fixtures/tef-06c-persistencia-worker.js) com
 * TefManager + tefRepository reais sobre banco temporário (schema copiado do banco
 * oficial, somente estrutura). Reinício = novo processo sobre o mesmo banco.
 * Adapter com mapeamento real do DestaxaRealAdapter sobre resultado simulado.
 * Proibido: iniciaTransacaoDestaxa / continuaTransacaoDestaxa / finalizaTransacaoDestaxa reais.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';
if (String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1') {
  console.error(`BLOQUEADO: ${REAL_TRANSACTION_ENV} deve permanecer desabilitada na 06C-PERSISTENCIA`);
  process.exit(2);
}

const sqlite3 = require('sqlite3');
const RAIZ = path.resolve(__dirname, '../..');
const WORKER = path.join(__dirname, 'fixtures', 'tef-06c-persistencia-worker.js');
const RELATORIO = path.join(RAIZ, 'docs', 'build', 'tef-destaxa-06c-persistencia-report.json');
const BANCO_OFICIAL = path.join(process.env.DB_DIR || path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados'), 'mercadao.db');
const PAN = '4111111111111111';
const SENHA = '739182';
const CVV = '917';
const CAMPOS_LOG_RECUPERACAO = ['transactionId', 'status', 'estado', 'financialState', 'resultCode', 'provider', 'criadoEm', 'execucaoOrigemAtiva', 'retryAllowed'];

const verificador = require('../../backend/services/tef/destaxa/destaxaNativeHostVerifier');
const { ERROS, transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');

let passou = 0;
let falhou = 0;
const falhas = [];
const executados = [];
const saidasWorkers = [];
const workers = [];
const bancosTemporarios = [];

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

// ------------------------------------------------ sqlite direto (somente leitura no oficial)
function abrir(arquivo, modo) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(arquivo, modo, (err) => (err ? reject(err) : resolve(db)));
  });
}
function todos(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
}
function fechar(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}
async function consultarArquivo(arquivo, sql, params = []) {
  const db = await abrir(arquivo, sqlite3.OPEN_READONLY);
  try {
    return await todos(db, sql, params);
  } finally {
    await fechar(db);
  }
}

// ------------------------------------------------ workers
function iniciarWorker(dbDir, passos) {
  const proc = spawn(process.execPath, [WORKER, JSON.stringify({ passos })], {
    cwd: RAIZ,
    env: { ...process.env, DB_DIR: dbDir, [REAL_TRANSACTION_ENV]: '0' },
    windowsHide: true
  });
  const estado = { proc, passos: [], saida: '', erro: null, codigo: undefined, ouvintes: [] };
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    const texto = chunk.toString('utf8');
    estado.saida += texto;
    buffer += texto;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (linha.startsWith('@@PASSO ')) estado.passos.push(JSON.parse(linha.slice(8)));
      if (linha.startsWith('@@ERRO ')) estado.erro = JSON.parse(linha.slice(7));
      estado.ouvintes.forEach((fn) => fn());
    }
  });
  proc.stderr.on('data', (chunk) => { estado.saida += chunk.toString('utf8'); });
  estado.fim = new Promise((resolve) => proc.on('exit', (codigo) => {
    estado.codigo = codigo;
    saidasWorkers.push(estado.saida);
    resolve(estado);
  }));
  estado.aguardarPasso = (nome, ms = 60000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout aguardando ${nome}`)), ms);
    const verificar = () => {
      const p = estado.passos.find((x) => x.passo === nome);
      if (p) {
        clearTimeout(timer);
        resolve(p);
        return true;
      }
      if (estado.codigo !== undefined) {
        clearTimeout(timer);
        reject(new Error(`worker encerrou sem passo ${nome}: ${estado.erro?.mensagem || estado.saida.slice(-500)}`));
        return true;
      }
      return false;
    };
    if (!verificar()) {
      estado.ouvintes.push(verificar);
      estado.fim.then(verificar);
    }
  });
  estado.matar = () => { try { proc.kill('SIGKILL'); } catch (_) { /* já encerrado */ } return estado.fim; };
  workers.push(estado);
  return estado;
}

async function rodarWorker(dbDir, passos) {
  const w = await iniciarWorker(dbDir, passos).fim;
  if (w.erro) throw new Error(`worker falhou: ${w.erro.mensagem}\n${w.erro.stack}`);
  return w;
}

/**
 * Dois processos executando os mesmos passos TEF no mesmo instante. O boot do
 * database.js (migrações) é escalonado; somente as operações TEF são simultâneas.
 */
async function doisWorkersSimultaneos(dbDir, passos) {
  const em = Date.now() + 15000;
  const w1 = iniciarWorker(dbDir, [{ acao: 'barreira', em }, ...passos]);
  await w1.aguardarPasso('inicio');
  const w2 = iniciarWorker(dbDir, [{ acao: 'barreira', em }, ...passos]);
  await w2.aguardarPasso('inicio');
  const fins = await Promise.all([w1.fim, w2.fim]);
  for (const w of fins) {
    if (w.erro) throw new Error(`worker falhou: ${w.erro.mensagem}\n${w.erro.stack}`);
  }
  return fins;
}

function passo(w, nome, ordem = 0) {
  const lista = w.passos.filter((p) => p.passo === nome);
  const p = lista[ordem];
  assert.ok(p, `passo ${nome}#${ordem} ausente (exit ${w.codigo}): ${w.erro?.mensagem || w.saida.slice(-800)}`);
  return p;
}

// ------------------------------------------------ bancos temporários
let TEMPLATE_DIR = null;

async function criarTemplate() {
  TEMPLATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-tef06c-template-'));
  bancosTemporarios.push(TEMPLATE_DIR);
  const oficial = await abrir(BANCO_OFICIAL, sqlite3.OPEN_READONLY);
  const esquema = await todos(oficial, `SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END`);
  await fechar(oficial);
  const destino = await abrir(path.join(TEMPLATE_DIR, 'mercadao.db'), sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  for (const obj of esquema) {
    await new Promise((resolve) => destino.exec(obj.sql, () => resolve()));
  }
  await fechar(destino);
  // Migrações do database.js aplicadas uma vez sobre o template.
  await rodarWorker(TEMPLATE_DIR, []);
  return esquema.filter((o) => o.type === 'table').length;
}

function novoBanco(nome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cds-tef06c-${nome}-`));
  bancosTemporarios.push(dir);
  for (const arq of fs.readdirSync(TEMPLATE_DIR)) {
    if (/^mercadao\.db/.test(arq)) fs.copyFileSync(path.join(TEMPLATE_DIR, arq), path.join(dir, arq));
  }
  return dir;
}

function arquivoBanco(dir) {
  return path.join(dir, 'mercadao.db');
}

async function linhasTef(dir) {
  return consultarArquivo(arquivoBanco(dir), 'SELECT id, status FROM tef_transacoes ORDER BY id');
}

async function logsTef(dir) {
  return consultarArquivo(arquivoBanco(dir), 'SELECT transacao_id, tipo, mensagem, payload FROM tef_logs ORDER BY id');
}

function hashArquivo(rel) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, rel))).digest('hex');
}

const TRAVA = { AGUARDANDO: 'AGUARDANDO_RESULTADO_TARDIO', RECONCILIACAO: 'RECONCILIACAO_PENDENTE' };

async function main() {
  console.log('\nTEF-DESTAXA-06C-PERSISTENCIA\n');
  const evidencias = { cenarios: {}, regressoes: [] };

  const oficialAntes = (await consultarArquivo(BANCO_OFICIAL, 'SELECT COUNT(*) AS n FROM tef_transacoes'))[0].n;
  const tabelasTemplate = await criarTemplate();

  await test('segurança: gate financeiro fechado e banco oficial nunca usado pelos workers', () => {
    assert.strictEqual(transacaoRealHabilitada(), false);
    assert.ok(!bancosTemporarios.some((d) => path.resolve(d) === path.dirname(path.resolve(BANCO_OFICIAL))));
    assert.ok(tabelasTemplate > 0);
  });

  // ================================================= A: UNKNOWN + queda + reinício
  const A = novoBanco('unknown');
  const a1 = await rodarWorker(A, [
    { acao: 'autorizar', pendurar: true, timeoutMs: 300 },
    { acao: 'linhas' },
    { acao: 'morrer' }
  ]);
  const aTimeout = passo(a1, 'autorizar');
  const txA = String(aTimeout.resposta.transacao_id);
  const aLinhasAposQueda = await linhasTef(A);
  const a2 = await rodarWorker(A, [
    { acao: 'recuperar' },
    { acao: 'autorizar', codigo: '00' },
    { acao: 'reconciliar', id: txA, financialState: 'CANCELLED' },
    { acao: 'autorizar', codigo: '00' }
  ]);
  const aRecuperado = passo(a2, 'recuperar');
  const aBloqueado = passo(a2, 'autorizar', 0);
  const aReconciliado = passo(a2, 'reconciliar');
  const aLiberado = passo(a2, 'autorizar', 1);
  const a3 = await rodarWorker(A, [{ acao: 'recuperar' }]);
  const aLogs = await logsTef(A);
  evidencias.cenarios.unknownRestart = {
    txA,
    cdsResult: { codigo: aTimeout.resposta.codigo, status: aTimeout.resposta.status, financialState: aTimeout.resposta.financialState },
    workerExitCode: a1.codigo,
    rowsAfterCrash: aLinhasAposQueda,
    recoveredLock: aRecuperado.trava,
    blockedAttempt: { codigo: aBloqueado.resposta.codigo, transacaoId: aBloqueado.resposta.transacaoId, linhasAntes: aBloqueado.linhasAntes, linhasDepois: aBloqueado.linhasDepois, adapterCalls: aBloqueado.novasChamadasAdapter },
    reconciliation: aReconciliado.resultado || aReconciliado.codigo,
    afterReconciliation: { status: aLiberado.resposta.status, transacaoId: aLiberado.resposta.transacao_id, adapterCalls: aLiberado.novasChamadasAdapter },
    finalRows: await linhasTef(A)
  };

  await test('1: UNKNOWN persistido (timeout com chamada nativa em andamento → linha pendente no banco)', () => {
    assert.strictEqual(aTimeout.resposta.codigo, 'TIMEOUT');
    assert.strictEqual(aTimeout.resposta.financialState, 'UNKNOWN');
    assert.strictEqual(aTimeout.trava.estado, TRAVA.AGUARDANDO);
    const linha = passo(a1, 'linhas').linhas.find((l) => String(l.id) === txA);
    assert.strictEqual(linha.status, 'pendente');
    assert.strictEqual(linha.payload.execucao.pid, passo(a1, 'inicio').pid);
    assert.strictEqual(a1.codigo, 137, 'processo deve cair abruptamente');
    assert.deepStrictEqual(aLinhasAposQueda.map((l) => [String(l.id), l.status]), [[txA, 'pendente']]);
  });

  await test('2: UNKNOWN recuperado após reinício (novo processo, dono morto → RECONCILIACAO_PENDENTE)', () => {
    const t = aRecuperado.trava;
    assert.ok(t, 'trava não reconstruída');
    assert.strictEqual(t.transacaoId, txA);
    assert.strictEqual(t.estado, TRAVA.RECONCILIACAO);
    assert.strictEqual(t.financialState, 'UNKNOWN');
    assert.strictEqual(t.origem, 'persistida');
    assert.notStrictEqual(passo(a2, 'inicio').pid, passo(a1, 'inicio').pid);
  });

  await test('9: reinício recupera a trava e registra TEF_RESULTADO_PENDENTE_RECUPERADO uma vez', () => {
    const logs = aLogs.filter((l) => l.tipo === 'TEF_RESULTADO_PENDENTE_RECUPERADO' && String(l.transacao_id) === txA);
    assert.strictEqual(logs.length, 1, JSON.stringify(aLogs.map((l) => [l.transacao_id, l.tipo])));
    const payload = JSON.parse(logs[0].payload);
    assert.strictEqual(payload.estado, TRAVA.RECONCILIACAO);
    assert.strictEqual(payload.execucaoOrigemAtiva, false);
    assert.deepStrictEqual(Object.keys(payload).filter((k) => !CAMPOS_LOG_RECUPERACAO.includes(k)), []);
  });

  await test('10: nova autorização bloqueada após reinício (TX-A continua sendo a operação pendente)', () => {
    assert.strictEqual(aBloqueado.resposta.sucesso, false);
    assert.strictEqual(aBloqueado.resposta.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(aBloqueado.resposta.retryAllowed, false);
    assert.strictEqual(String(aBloqueado.resposta.transacao_pendente_id), txA);
  });

  await test('11: nenhum novo transactionId (nenhuma linha TX-B criada)', () => {
    assert.strictEqual(aBloqueado.resposta.transacaoId, null);
    assert.strictEqual(aBloqueado.linhasAntes, 1);
    assert.strictEqual(aBloqueado.linhasDepois, 1);
    assert.deepStrictEqual(aBloqueado.transactionIds, []);
  });

  await test('12: nenhuma nova chamada ao adapter', () => {
    assert.strictEqual(aBloqueado.novasChamadasAdapter, 0);
    assert.strictEqual(aBloqueado.adapterTotal, 0);
  });

  await test('13: nenhuma nova cobrança (sem chamada ao adapter/DLL, nenhuma linha aprovada)', () => {
    assert.strictEqual(aBloqueado.tentativasDll, 0);
    assert.strictEqual(aBloqueado.koffiNoProcesso, false);
    const bloqueadas = aLogs.filter((l) => l.tipo === 'INICIO');
    assert.strictEqual(bloqueadas.length, 2, 'somente TX-A (antes da queda) e a autorização pós-reconciliação iniciaram');
  });

  await test('14: reconciliação libera a trava e persiste o desfecho', () => {
    assert.strictEqual(aReconciliado.ok, true);
    assert.strictEqual(aReconciliado.resultado.travaLiberada, true);
    assert.strictEqual(aReconciliado.trava, null);
    const linhaA = evidencias.cenarios.unknownRestart.finalRows.find((l) => String(l.id) === txA);
    assert.strictEqual(linhaA.status, 'cancelado');
    assert.ok(aLogs.some((l) => l.tipo === 'RECONCILIACAO_RESULTADO_TARDIO' && String(l.transacao_id) === txA));
  });

  await test('15: nova autorização permitida após reconciliação (uma única chamada, novo transactionId)', () => {
    assert.strictEqual(aLiberado.resposta.status, 'aprovado');
    assert.notStrictEqual(String(aLiberado.resposta.transacao_id), txA);
    assert.strictEqual(aLiberado.novasChamadasAdapter, 1);
    assert.strictEqual(passo(a3, 'recuperar').trava, null, 'novo reinício não encontra pendência');
  });

  // ================================================= B: pendentes dentro do prazo (99/A0/A1/08)
  const B = novoBanco('codigos');
  const b1 = await rodarWorker(B, [{ acao: 'autorizar', codigo: '99' }, { acao: 'autorizar', codigo: '00' }]);
  const b2 = await rodarWorker(B, [{ acao: 'recuperar' }, { acao: 'reconciliar', financialState: 'CANCELLED' }, { acao: 'autorizar', codigo: 'A0' }]);
  const b3 = await rodarWorker(B, [{ acao: 'recuperar' }, { acao: 'reconciliar', financialState: 'CANCELLED' }, { acao: 'autorizar', codigo: 'A1' }]);
  const b4 = await rodarWorker(B, [{ acao: 'recuperar' }, { acao: 'reconciliar', financialState: 'CANCELLED' }, { acao: 'autorizar', codigo: '08' }]);
  const b5 = await rodarWorker(B, [{ acao: 'recuperar' }, { acao: 'reconciliar', financialState: 'CONFIRMED_DENIED' }, { acao: 'autorizar', codigo: '00' }]);
  const recuperados = {
    '99': passo(b2, 'recuperar').trava,
    A0: passo(b3, 'recuperar').trava,
    A1: passo(b4, 'recuperar').trava,
    '08': passo(b5, 'recuperar').trava
  };
  evidencias.cenarios.inTimePending = Object.fromEntries(Object.entries(recuperados).map(([k, t]) => [k, t && { estado: t.estado, financialState: t.financialState, codigo: t.codigo }]));
  const verificarRecuperado = (codigo, financialState) => {
    const t = recuperados[codigo];
    assert.ok(t, `pendência ${codigo} não recuperada`);
    assert.strictEqual(t.estado, TRAVA.RECONCILIACAO);
    assert.strictEqual(t.financialState, financialState);
    assert.strictEqual(t.codigo, codigo);
  };

  await test('3: PENDING (99) persistido e recuperado; bloqueia no mesmo processo e após reinício', () => {
    const r = passo(b1, 'autorizar', 0);
    assert.strictEqual(r.resposta.status, 'pendente');
    assert.strictEqual(r.trava.estado, TRAVA.RECONCILIACAO);
    const segunda = passo(b1, 'autorizar', 1);
    assert.strictEqual(segunda.resposta.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(segunda.novasChamadasAdapter, 0);
    verificarRecuperado('99', 'PENDING');
  });

  await test('4: UNCONFIRMED (A0) persistido e recuperado', () => {
    assert.strictEqual(passo(b2, 'autorizar').resposta.status, 'pendente');
    verificarRecuperado('A0', 'UNCONFIRMED');
  });

  await test('5: BLOCKED (A1) persistido e recuperado', () => {
    assert.strictEqual(passo(b3, 'autorizar').resposta.status, 'pendente');
    verificarRecuperado('A1', 'BLOCKED');
  });

  await test('UNKNOWN (08 dentro do prazo) persistido e recuperado; negação confirmada libera', async () => {
    assert.strictEqual(passo(b4, 'autorizar').resposta.status, 'pendente');
    verificarRecuperado('08', 'UNKNOWN');
    assert.strictEqual(passo(b5, 'reconciliar').resultado.status, 'negado');
    assert.strictEqual(passo(b5, 'autorizar').resposta.status, 'aprovado');
    const statusFinais = (await linhasTef(B)).map((l) => l.status);
    assert.deepStrictEqual(statusFinais, ['cancelado', 'cancelado', 'cancelado', 'negado', 'aprovado']);
  });

  // ================================================= C: histórico final não bloqueia
  const C = novoBanco('historico');
  const c1 = await rodarWorker(C, [{
    acao: 'semear',
    linhas: [{ status: 'aprovado' }, { status: 'negado' }, { status: 'cancelado' }, { status: 'erro', payload: { codigo: 'TEF_TIMEOUT_ANTES_DO_ENVIO', transactionAttempted: false } }]
  }]);
  const c2 = await rodarWorker(C, [{ acao: 'recuperar' }, { acao: 'autorizar', codigo: '00' }]);
  const idsHistorico = passo(c1, 'semear').ids.map(String);
  const cAutorizacao = passo(c2, 'autorizar');
  const cLogs = await logsTef(C);
  evidencias.cenarios.history = { seeded: ['aprovado', 'negado', 'cancelado', 'erro'], lockAfterRestart: passo(c2, 'recuperar').trava, newAuthorization: cAutorizacao.resposta.status };
  const verificarHistorico = (indice, status) => {
    assert.strictEqual(passo(c2, 'recuperar').trava, null, `${status} antigo não pode bloquear`);
    assert.ok(!cLogs.some((l) => l.tipo === 'TEF_RESULTADO_PENDENTE_RECUPERADO' && String(l.transacao_id) === idsHistorico[indice]));
    assert.strictEqual(cAutorizacao.resposta.status, 'aprovado');
    assert.strictEqual(cAutorizacao.novasChamadasAdapter, 1);
  };
  await test('6: transação aprovada antiga não bloqueia', () => verificarHistorico(0, 'aprovado'));
  await test('7: transação negada antiga não bloqueia', () => verificarHistorico(1, 'negado'));
  await test('8: transação cancelada antiga não bloqueia (nem erro sem envio)', () => {
    verificarHistorico(2, 'cancelado');
    verificarHistorico(3, 'erro');
  });

  // ================================================= D: múltiplas pendências
  const D = novoBanco('multiplas');
  const d1 = await rodarWorker(D, [{
    acao: 'semear',
    linhas: [{ status: 'aprovado' }, { status: 'pendente', payload: { financialState: 'UNKNOWN' } }, { status: 'pendente', payload: { resultadoTardio: { codigo: 'A0', financialState: 'UNCONFIRMED' } } }]
  }]);
  const [, p1, p2] = passo(d1, 'semear').ids.map(String);
  const d2 = await rodarWorker(D, [
    { acao: 'recuperar' },
    { acao: 'autorizar' },
    { acao: 'reconciliar', id: p1, financialState: 'CANCELLED' },
    { acao: 'autorizar' },
    { acao: 'reconciliar', id: p2, financialState: 'CONFIRMED_SUCCESS' },
    { acao: 'autorizar' }
  ]);
  const dLogs = await logsTef(D);
  evidencias.cenarios.multiplePending = { pending: [p1, p2], recovered: passo(d2, 'recuperar').trava?.pendentes, finalRows: await linhasTef(D) };
  await test('17: múltiplas pendências tratadas corretamente (todas recuperadas; liberação somente após reconciliar todas)', () => {
    const t = passo(d2, 'recuperar').trava;
    assert.deepStrictEqual(t.pendentes, [p1, p2]);
    assert.strictEqual(t.transacaoId, p1);
    assert.strictEqual(passo(d2, 'autorizar', 0).resposta.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(passo(d2, 'reconciliar', 0).trava.transacaoId, p2);
    assert.strictEqual(passo(d2, 'autorizar', 1).resposta.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(passo(d2, 'autorizar', 1).novasChamadasAdapter, 0);
    assert.strictEqual(passo(d2, 'reconciliar', 1).trava, null);
    assert.strictEqual(passo(d2, 'autorizar', 2).resposta.status, 'aprovado');
    assert.strictEqual(passo(d2, 'autorizar', 2).adapterTotal, 1);
    for (const id of [p1, p2]) {
      assert.strictEqual(dLogs.filter((l) => l.tipo === 'TEF_RESULTADO_PENDENTE_RECUPERADO' && String(l.transacao_id) === id).length, 1);
    }
  });

  // ================================================= E: concorrência
  const E = novoBanco('concorrencia');
  const [e1, e2] = await doisWorkersSimultaneos(E, [{ acao: 'autorizar', codigo: '00', atrasoMs: 1500 }]);
  const eRespostas = [passo(e1, 'autorizar'), passo(e2, 'autorizar')];
  const eLinhas = await linhasTef(E);
  await test('concorrência: dois processos autorizando ao mesmo tempo → uma operação financeira, uma recusa', () => {
    assert.ok(passo(e1, 'barreira').esperouMs > 0 && passo(e2, 'barreira').esperouMs > 0, 'barreira não sincronizou');
    const codigos = eRespostas.map((r) => r.resposta.status === 'aprovado' ? 'aprovado' : r.resposta.codigo).sort();
    assert.deepStrictEqual(codigos, ['TEF_RESULTADO_PENDENTE', 'aprovado']);
    assert.strictEqual(eRespostas.reduce((s, r) => s + r.adapterTotal, 0), 1);
    assert.strictEqual(eLinhas.length, 1);
  });

  const e3 = await rodarWorker(E, [{ acao: 'semear', linhas: [{ status: 'pendente', payload: { financialState: 'UNKNOWN' } }] }]);
  const idPendenteE = String(passo(e3, 'semear').ids[0]);
  const [e4, e5] = await doisWorkersSimultaneos(E, [{ acao: 'recuperar' }, { acao: 'autorizar' }]);
  await test('concorrência: dois processos inicializando com pendência → ambos recuperam a trava e recusam', () => {
    for (const w of [e4, e5]) {
      assert.strictEqual(passo(w, 'recuperar').trava.transacaoId, idPendenteE);
      assert.strictEqual(passo(w, 'autorizar').resposta.codigo, 'TEF_RESULTADO_PENDENTE');
      assert.strictEqual(passo(w, 'autorizar').adapterTotal, 0);
    }
  });

  const e6 = await rodarWorker(E, [
    { acao: 'reconciliar', id: idPendenteE, financialState: 'CANCELLED' },
    { acao: 'autorizarParalelo', n: 3, codigo: '00', atrasoMs: 400 }
  ]);
  const paralelo = passo(e6, 'autorizarParalelo');
  evidencias.cenarios.concurrency = {
    twoProcessesAuthorizing: eRespostas.map((r) => r.resposta.status === 'aprovado' ? 'aprovado' : r.resposta.codigo),
    twoProcessesStarting: [e4, e5].map((w) => passo(w, 'autorizar').resposta.codigo),
    sameProcessParallel: paralelo.respostas.map((r) => r.status === 'aprovado' ? 'aprovado' : r.codigo)
  };
  await test('concorrência: autorizações simultâneas no mesmo processo → uma única chamada ao adapter', () => {
    assert.strictEqual(passo(e6, 'reconciliar').ok, true);
    const aprovadas = paralelo.respostas.filter((r) => r.status === 'aprovado');
    assert.strictEqual(aprovadas.length, 1);
    assert.ok(paralelo.respostas.filter((r) => r.status !== 'aprovado').every((r) => ['TEF_AUTORIZACAO_EM_ANDAMENTO', 'TEF_RESULTADO_PENDENTE'].includes(r.codigo)));
    assert.strictEqual(paralelo.novasChamadasAdapter, 1);
    assert.strictEqual(paralelo.linhasDepois - paralelo.linhasAntes, 1);
  });

  // ================================================= G: operação nativa ativa → reconciliação prematura
  const G = novoBanco('ativa');
  const g1 = iniciarWorker(G, [
    { acao: 'autorizar', pendurar: true, timeoutMs: 300 },
    { acao: 'reconciliar' },
    { acao: 'autorizar' },
    { acao: 'manterVivo' }
  ]);
  let g2 = null;
  let g3 = null;
  try {
    await g1.aguardarPasso('manterVivo');
    g2 = await rodarWorker(G, [{ acao: 'recuperar' }, { acao: 'reconciliar' }, { acao: 'autorizar' }]);
  } finally {
    await g1.matar();
  }
  g3 = await rodarWorker(G, [{ acao: 'recuperar' }, { acao: 'reconciliar', financialState: 'CANCELLED' }, { acao: 'autorizar', codigo: '00' }]);
  const gLogs = await logsTef(G);
  evidencias.cenarios.activeNativeCall = {
    sameProcessReconciliation: passo(g1, 'reconciliar').codigo,
    otherProcessWhileOwnerAlive: { estado: g2 && passo(g2, 'recuperar').trava?.estado, reconciliation: g2 && passo(g2, 'reconciliar').codigo },
    afterOwnerDied: { estado: passo(g3, 'recuperar').trava?.estado, reconciliation: passo(g3, 'reconciliar').ok, newAuthorization: passo(g3, 'autorizar').resposta.status }
  };
  await test('16: operação nativa ativa impede reconciliação prematura (mesmo processo e outro processo)', () => {
    assert.strictEqual(passo(g1, 'reconciliar').codigo, 'TEF_RECONCILIACAO_PREMATURA');
    assert.strictEqual(passo(g1, 'autorizar', 1).resposta.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(passo(g1, 'autorizar', 1).adapterTotal, 1);
    assert.strictEqual(passo(g2, 'recuperar').trava.estado, TRAVA.AGUARDANDO);
    assert.strictEqual(passo(g2, 'reconciliar').codigo, 'TEF_RECONCILIACAO_PREMATURA');
    assert.strictEqual(passo(g2, 'autorizar').resposta.codigo, 'TEF_RESULTADO_PENDENTE');
    assert.strictEqual(passo(g2, 'autorizar').adapterTotal, 0);
    const logG2 = gLogs.find((l) => l.tipo === 'TEF_RESULTADO_PENDENTE_RECUPERADO');
    assert.strictEqual(JSON.parse(logG2.payload).execucaoOrigemAtiva, true);
    assert.strictEqual(passo(g3, 'recuperar').trava.estado, TRAVA.RECONCILIACAO);
    assert.strictEqual(passo(g3, 'reconciliar').ok, true);
    assert.strictEqual(passo(g3, 'autorizar').resposta.status, 'aprovado');
  });

  // ================================================= dados sensíveis
  const todosLogs = [];
  for (const dir of [A, B, C, D, E, G]) todosLogs.push(...await logsTef(dir));
  await test('18: nenhum dado sensível (PAN, senha, CVV) em tef_logs nem na saída dos processos', () => {
    const textos = [...todosLogs.map((l) => `${l.mensagem || ''} ${l.payload || ''}`), ...saidasWorkers];
    for (const texto of textos) {
      assert.ok(!texto.includes(PAN), 'PAN em claro');
      assert.ok(!texto.includes(SENHA), 'senha em claro');
      assert.ok(!/"cvv"\s*:\s*"917"/i.test(texto), 'CVV em claro');
    }
    const inicio = todosLogs.find((l) => l.tipo === 'INICIO');
    assert.ok(inicio, 'log INICIO esperado para verificar mascaramento');
    const recuperacoes = todosLogs.filter((l) => l.tipo === 'TEF_RESULTADO_PENDENTE_RECUPERADO');
    assert.ok(recuperacoes.length >= 8);
    for (const l of recuperacoes) {
      assert.deepStrictEqual(Object.keys(JSON.parse(l.payload)).filter((k) => !CAMPOS_LOG_RECUPERACAO.includes(k)), []);
    }
  });

  // ================================================= invariantes de arquitetura
  const fonteManager = fs.readFileSync(path.join(RAIZ, 'backend/services/tef/TefManager.js'), 'utf8');
  const fonteRepo = fs.readFileSync(path.join(RAIZ, 'backend/services/tef/tefRepository.js'), 'utf8');
  const arquivosHost = [
    'backend/services/tef/destaxa/DestaxaNativeHost.js',
    'backend/services/tef/destaxa/DestaxaNativeHostClient.js',
    'backend/services/tef/destaxa/DestaxaHostBridge.js',
    'backend/services/tef/destaxa/destaxaNativeHostProtocolo.js'
  ];
  await test('arquitetura: sem nova tabela, sem segunda máquina de estados, Native Host isolado', () => {
    assert.ok(!/CREATE TABLE/i.test(fonteManager) && !/CREATE TABLE/i.test(fonteRepo));
    assert.strictEqual((fonteManager.match(/Object\.freeze\(\{\s*AGUARDANDO_RESULTADO/g) || []).length, 1);
    assert.ok(/WHERE NOT EXISTS \(SELECT 1 FROM tef_transacoes WHERE status = 'pendente'\)/.test(fonteRepo));
    for (const rel of arquivosHost) {
      const fonte = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
      assert.ok(!/tefRepository|require\([^)]*database|TefManager'\)/.test(fonte), `${rel} não pode acessar persistência`);
    }
    assert.ok(workers.every((w) => w.passos.every((p) => (p.tentativasDll ?? 0) === 0 && p.koffiNoProcesso !== true)));
  });

  // ================================================= nativo real (tripwire)
  let nativo = null;
  await test('nativo real: host carrega DLL, iniciaClientDestaxa=00, transacionais bloqueadas; Main sem DLL', async () => {
    // O cliente do host faz unref() do processo filho: sem outro handle ativo o loop encerraria.
    const manterLoop = setInterval(() => {}, 1000);
    try {
      nativo = await verificador.verificarNativoReal();
    } finally {
      clearInterval(manterLoop);
    }
    assert.strictEqual(nativo.tripwire, true);
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
  await test('chamadas transacionais reais da DLL = 0 (tripwire) e gate fechado', () => {
    assert.deepStrictEqual(chamadasReais, { inicia: 0, continua: 0, finaliza: 0 });
    assert.strictEqual(transacaoRealHabilitada(), false);
  });

  // ================================================= banco oficial
  const oficialDepois = (await consultarArquivo(BANCO_OFICIAL, 'SELECT COUNT(*) AS n FROM tef_transacoes'))[0].n;
  await test('banco oficial: nenhuma transação nova em tef_transacoes', () => {
    assert.strictEqual(oficialDepois, oficialAntes);
  });
  let ambientePersistido = null;
  await test('banco oficial: tef_configuracao.ambiente permanece homologacao', async () => {
    const [row] = await consultarArquivo(BANCO_OFICIAL, 'SELECT ambiente FROM tef_configuracao ORDER BY id DESC LIMIT 1');
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

  // ================================================= regressões
  if (String(process.env.TEF_06C_PERSISTENCIA_SKIP_REGRESSOES || '').trim() !== '1') {
    const scripts = [
      'test:tef-01', 'test:tef-02', 'test:tef-fluxo',
      'test:tef-destaxa-01', 'test:tef-destaxa-02', 'test:tef-destaxa-03',
      'test:tef-destaxa-prep-04b', 'test:tef-destaxa-05', 'test:tef-destaxa-06a',
      'test:tef-destaxa-06b', 'test:tef-destaxa-06c-prep', 'test:tef-destaxa-06c-mitigacao',
      'test:tef-destaxa-06c-timeout'
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

  for (const dir of bancosTemporarios) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* WAL ainda aberto */ }
  }

  // ================================================= relatório
  const aprovado = falhou === 0;
  const relatorio = {
    sprint: 'TEF-DESTAXA-06C-PERSISTENCIA',
    timestamp: new Date().toISOString(),
    transactionExecuted: false,
    realTransactionGate: { env: REAL_TRANSACTION_ENV, enabled: transacaoRealHabilitada() },
    existingModelUsed: {
      table: 'tef_transacoes (sem nova tabela, sem nova coluna)',
      blockingColumn: "status = 'pendente'",
      ownerMetadata: 'payload_retorno (criptografado) na criação: { execucao: { instancia, pid, iniciadoEm } }',
      auditTrail: 'tef_logs: TRAVA_RESULTADO_TARDIO, RESULTADO_TARDIO, TEF_RESULTADO_PENDENTE_RECUPERADO, RECONCILIACAO_RESULTADO_TARDIO',
      stateMachine: 'nenhuma nova: status do tefContrato (pendente/aprovado/negado/cancelado/erro) + ESTADOS_TRAVA_RESULTADO_TARDIO existente (TEF-06C-TIMEOUT)'
    },
    blockingStates: {
      persistedStatus: 'pendente',
      financialStates: ['UNKNOWN', 'PENDING', 'UNCONFIRMED', 'BLOCKED', 'CONFIRMED_SUCCESS tardio aguardando reconciliação'],
      protocolStates: ['STARTING', 'WAITING_ACTION', 'DISPLAY', 'COLLECT', 'OPTION', 'FINALIZING', 'TIMEOUT', 'UNKNOWN', 'PENDING', 'UNCONFIRMED', 'BLOCKED'],
      source: 'DestaxaRealAdapter STATUS_POR_CLASSIFICACAO (ACTION_REQUIRED/TIMEOUT/UNKNOWN/UNCONFIRMED/BLOCKED → pendente) e TefManager._registrarResultadoTardio'
    },
    finalStates: {
      statuses: ['aprovado', 'negado', 'cancelado', 'erro'],
      note: "erro inclui TEF_TIMEOUT_ANTES_DO_ENVIO (transactionAttempted=false) e códigos FF/F0/F1/F2/FE/05/06/07; nunca bloqueiam"
    },
    recoveryStrategy: {
      trigger: 'construtor do TefManager (setImmediate) + garantirRecuperacao() aguardada em autorizar(); falha na leitura → TEF_RECUPERACAO_PENDENCIAS_FALHOU (fail-closed)',
      query: "tefRepository.listarTransacoesPendentes(): SELECT … FROM tef_transacoes WHERE status = 'pendente'",
      classification: {
        [TRAVA.AGUARDANDO]: 'linha criada por processo ainda vivo (process.kill(pid, 0)) ou chamada em andamento nesta instância',
        [TRAVA.RECONCILIACAO]: 'processo dono encerrado/reiniciado ou desfecho pendente já recebido'
      },
      log: { tipo: 'TEF_RESULTADO_PENDENTE_RECUPERADO', campos: CAMPOS_LOG_RECUPERACAO, dadosSensiveis: false },
      sourceOfTruth: 'banco; mapa em memória é espelho recarregado antes de cada autorização enquanto houver pendência',
      atomicInsert: "tefRepository.criarTransacaoExclusiva(): INSERT … SELECT … WHERE NOT EXISTS (status = 'pendente') — exclusão mútua entre processos",
      inProcessMutex: 'TEF_AUTORIZACAO_EM_ANDAMENTO para autorizações simultâneas no mesmo processo'
    },
    behaviorAfterRestart: evidencias.cenarios.unknownRestart,
    reconciliationBehavior: {
      api: 'TefManager.reconciliarResultadoTardio(transacaoId, { financialState, usuario, observacao })',
      releasesLock: true,
      prematureRefused: evidencias.cenarios.activeNativeCall,
      multiplePending: evidencias.cenarios.multiplePending,
      sendsNewAuthorization: false
    },
    scenarios: evidencias.cenarios,
    residualRisks: [
      'Reuso de PID pelo Windows pode fazer um dono morto parecer vivo: efeito conservador (reconciliação recusada como prematura), nunca libera cobrança.',
      'Reconciliação continua manual (operador) — nenhuma liberação automática exceto negação confirmada tardia.'
    ],
    nativeHost: { architectureChanged: false, files: Object.fromEntries(arquivosHost.map((rel) => [rel, hashArquivo(rel)])) },
    hostProcess: nativo ? { processType: nativo.processType, pid: nativo.hostPid, tripwire: nativo.tripwire, clientCode: nativo.client.code } : null,
    realTransactionalCalls: chamadasReais,
    workersDllLoadAttempts: workers.reduce((s, w) => s + Math.max(0, ...w.passos.map((p) => p.tentativasDll || 0)), 0),
    database: {
      official: BANCO_OFICIAL,
      tefTransacoesBefore: oficialAntes,
      tefTransacoesAfter: oficialDepois,
      newTransactions: oficialDepois - oficialAntes,
      tefConfiguracaoAmbiente: ambientePersistido,
      configurationChanged: false,
      testDatabases: 'temporários (schema copiado do oficial, sem dados), removidos ao final'
    },
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
  for (const w of workers) { try { w.proc.kill('SIGKILL'); } catch (_) { /* encerrado */ } }
  console.error(error.stack || error.message);
  process.exit(1);
});
