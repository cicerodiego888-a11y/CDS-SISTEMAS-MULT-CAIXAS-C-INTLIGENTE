/**
 * Processo de teste da TEF-DESTAXA-06C-PERSISTENCIA (um "PDV" isolado).
 *
 * Exige DB_DIR apontando para diretório temporário: TefManager e tefRepository
 * reais sobre schema real (database.js) — nunca o banco oficial.
 * Adapter: mapeamento real do DestaxaRealAdapter sobre resultado simulado; nenhuma
 * DLL carregada, nenhuma chamada transacional Destaxa.
 *
 * argv[2] = JSON { passos: [...] }. Cada passo imprime "@@PASSO <json>".
 */
'use strict';

const path = require('path');

const RAIZ = path.resolve(__dirname, '../../..');
const BANCO_OFICIAL = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados');
if (!process.env.DB_DIR || path.resolve(process.env.DB_DIR) === path.resolve(BANCO_OFICIAL)) {
  console.error('BLOQUEADO: DB_DIR temporário obrigatório');
  process.exit(3);
}
if (String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1') {
  console.error('BLOQUEADO: gate financeiro deve permanecer fechado');
  process.exit(2);
}

const koffiLoader = require(path.join(RAIZ, 'backend/services/tef/destaxa/destaxaKoffiLoader'));
let tentativasDll = 0;
koffiLoader.carregarBiblioteca = koffiLoader.obterKoffi = () => {
  tentativasDll += 1;
  throw new Error('DLL proibida no worker de persistência');
};

const tefFactory = require(path.join(RAIZ, 'backend/services/tef/tefFactory'));
let adapter = null;
tefFactory.obterAdapter = async () => adapter;
require(path.join(RAIZ, 'backend/services/tef/tefLockService')).comLock = async (_chave, fn) => fn();
require(path.join(RAIZ, 'backend/services/tef/tefFraudDetectionService')).analisarTransacao = async () => ({ suspeita: false });
const notificacoes = require(path.join(RAIZ, 'backend/services/tef/tefFailureNotificationService'));
notificacoes.notificarFalhaTimeout = async () => {};
notificacoes.notificarFalhaGenerica = async () => {};
require(path.join(RAIZ, 'backend/services/tef/tefCircuitBreakerService')).executarComCircuitBreaker = async (_nome, fn) => fn();
require(path.join(RAIZ, 'backend/services/tef/tefFiscalValidator')).validarTransacao = () => ({ valido: true, erros: [] });

const db = require(path.join(RAIZ, 'backend/database'));
const cryptoService = require(path.join(RAIZ, 'backend/services/crypto/cryptoService'));
const DestaxaRealAdapter = require(path.join(RAIZ, 'backend/services/tef/adapters/DestaxaRealAdapter'));
const { classificarCodigoTransacao } = require(path.join(RAIZ, 'backend/services/tef/destaxa/destaxaProtocolo'));
const tefManager = require(path.join(RAIZ, 'backend/services/tef/TefManager'));

const contadores = { adapter: 0, transactionIds: [] };
let comportamento = { codigo: '00', atrasoMs: 0, pendurar: false };

function criarAdapter() {
  const base = new DestaxaRealAdapter({ provedor: 'destaxa', ambiente: 'homologacao' }, { bridge: {} });
  return {
    nome: base.nome,
    contratoTimeout: base.contratoTimeout,
    async prepararAutorizacao() {
      return { pronto: true, contexto: { clientInitializationCode: '00' } };
    },
    async autorizarPagamento(_dados, preparacao) {
      contadores.adapter += 1;
      contadores.transactionIds.push(preparacao.transactionId);
      const atual = { ...comportamento };
      if (atual.pendurar) await new Promise(() => {});
      if (atual.atrasoMs) await new Promise((resolve) => setTimeout(resolve, atual.atrasoMs));
      const c = classificarCodigoTransacao(atual.codigo);
      return base._mapearResultadoCrt({
        sucesso: atual.codigo === '00',
        codigoDestaxa: c.codigo,
        classificacao: c.classificacao,
        financialState: c.financialState,
        estado: c.estadoTransacao,
        retryReason: c.retryReason,
        descricao: c.descricao,
        saida: '',
        contexto: { transactionId: preparacao.transactionId }
      }, preparacao.contexto);
    }
  };
}
adapter = criarAdapter();

function sql(metodo, consulta, params = []) {
  return new Promise((resolve, reject) => {
    db[metodo](consulta, params, function (err, rows) {
      if (err) return reject(err);
      resolve(metodo === 'run' ? { id: this.lastID, changes: this.changes } : rows);
    });
  });
}

function pronto() {
  return new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
}

function emitir(passo, dados) {
  process.stdout.write(`@@PASSO ${JSON.stringify({ passo, ...dados })}\n`);
}

async function contarLinhas() {
  const [row] = await sql('all', 'SELECT COUNT(*) AS n FROM tef_transacoes');
  return row.n;
}

const DADOS_VENDA = Object.freeze({
  tipo: 'credito',
  valor: 1.0,
  numero_cartao: '4111111111111111',
  senha: '739182',
  cvv: '917'
});

async function executar(manager, passo) {
  switch (passo.acao) {
    case 'semear': {
      await manager.garantirRecuperacao();
      const ids = [];
      for (const linha of passo.linhas) {
        const payload = linha.payload ? cryptoService.criptografarObjeto(linha.payload) : null;
        const r = await sql('run', `INSERT INTO tef_transacoes (tipo, valor, parcelas, status, provedor, payload_retorno, criado_em, atualizado_em)
          VALUES ('credito', 1.0, 1, ?, 'destaxa', ?, datetime('now'), datetime('now'))`, [linha.status, payload]);
        ids.push(r.id);
      }
      return { ids };
    }
    case 'barreira': {
      const espera = Math.max(0, passo.em - Date.now());
      await new Promise((resolve) => setTimeout(resolve, espera));
      return { esperouMs: espera };
    }
    case 'recuperar': {
      const trava = await manager.garantirRecuperacao();
      return { trava };
    }
    case 'autorizar': {
      comportamento = { codigo: passo.codigo || '00', atrasoMs: passo.atrasoMs || 0, pendurar: passo.pendurar === true };
      const linhasAntes = await contarLinhas();
      const adapterAntes = contadores.adapter;
      const resposta = await manager.autorizar({ ...DADOS_VENDA }, passo.timeoutMs || 5000);
      return {
        resposta,
        linhasAntes,
        linhasDepois: await contarLinhas(),
        novasChamadasAdapter: contadores.adapter - adapterAntes,
        trava: manager.obterTravaResultadoTardio()
      };
    }
    case 'autorizarParalelo': {
      comportamento = { codigo: passo.codigo || '00', atrasoMs: passo.atrasoMs || 0, pendurar: false };
      const adapterAntes = contadores.adapter;
      const linhasAntes = await contarLinhas();
      const respostas = await Promise.all(
        Array.from({ length: passo.n || 2 }, () => manager.autorizar({ ...DADOS_VENDA }, passo.timeoutMs || 5000))
      );
      return {
        respostas,
        linhasAntes,
        linhasDepois: await contarLinhas(),
        novasChamadasAdapter: contadores.adapter - adapterAntes
      };
    }
    case 'reconciliar': {
      await manager.garantirRecuperacao();
      try {
        const id = passo.id ?? manager.obterTravaResultadoTardio()?.transacaoId;
        const r = manager.reconciliarResultadoTardio(id, {
          financialState: passo.financialState || 'CANCELLED',
          usuario: 'operador-teste-06c',
          observacao: 'reconciliação de teste (sem transação real)'
        });
        await manager._aguardarEscritas();
        return { ok: true, resultado: r, trava: manager.obterTravaResultadoTardio() };
      } catch (error) {
        return { ok: false, codigo: error.code, trava: manager.obterTravaResultadoTardio() };
      }
    }
    case 'linhas': {
      const rows = await sql('all', 'SELECT id, status, payload_retorno FROM tef_transacoes ORDER BY id');
      return {
        linhas: rows.map((r) => {
          let payload = null;
          try {
            payload = r.payload_retorno ? cryptoService.descriptografarObjeto(r.payload_retorno) : null;
          } catch (_) {
            payload = null;
          }
          return { id: r.id, status: r.status, payload };
        })
      };
    }
    case 'aguardar':
      await new Promise((resolve) => setTimeout(resolve, passo.ms));
      return {};
    case 'manterVivo':
      emitir('manterVivo', { pid: process.pid });
      await new Promise(() => {});
      return {};
    case 'morrer':
      // Queda abrupta do processo (sem shutdown ordenado).
      process.exit(137);
      return {};
    default:
      throw new Error(`passo desconhecido: ${passo.acao}`);
  }
}

async function principal() {
  const { passos } = JSON.parse(process.argv[2] || '{"passos":[]}');
  await pronto();
  const manager = tefManager;
  emitir('inicio', { pid: process.pid, instancia: manager._instanciaId });
  for (const passo of passos) {
    const resultado = await executar(manager, passo);
    emitir(passo.acao, {
      ...resultado,
      adapterTotal: contadores.adapter,
      transactionIds: contadores.transactionIds.slice(),
      tentativasDll,
      koffiNoProcesso: Object.keys(require.cache).some((m) => /[\\/]koffi[\\/]/.test(m))
    });
  }
  await manager._aguardarEscritas();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await new Promise((resolve) => db.close(() => resolve()));
  process.exit(0);
}

principal().catch((error) => {
  process.stdout.write(`@@ERRO ${JSON.stringify({ mensagem: error.message, stack: error.stack })}\n`);
  process.exit(1);
});
