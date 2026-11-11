'use strict';

/**
 * TEF-DESTAXA-51.27 — Reconciliação administrativa INEXISTENT (id=1).
 * Sem CRT, DLL, NativeHost ou gate financeiro.
 *
 * node tests/tef/tef-destaxa-51-27-reconciliacao-inexistente.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '../..');
const TEF_MANAGER = path.join(ROOT, 'backend/services/tef/TefManager.js');
const HASH_51_20 = 'F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C';

const {
  OPERACAO_AUTORIZADA_51_27,
  STATUS_ADMINISTRATIVO,
  FINANCIAL_STATE_ALVO,
  TIPO_LOG,
  validarPedidoReconciliacaoInexistente,
  reconciliarAdministrativamenteInexistente,
  persistirInexistenteSqliteSync,
  ePendenciaOperacionalAtiva,
  eTerminalAdministrativoInexistente,
  contaComoPendenciaBloqueadora,
  simularExclusividadeAposStatus
} = require('../../backend/services/tef/tefReconciliacaoAdministrativaInexistente');

const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');
const tefContrato = require('../../backend/services/tef/tefContrato');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.stack || error.message}`);
  }
}

function linhaBase(overrides = {}) {
  return {
    id: 1,
    venda_id: null,
    status: 'pendente',
    provedor: 'destaxa',
    tipo: 'cartao_debito',
    valor: 1,
    nsu: null,
    autorizacao: null,
    idempotency_key: OPERACAO_AUTORIZADA_51_27.idempotency_key,
    adquirente: null,
    bandeira: null,
    codigo_transacao: '1',
    criado_em: '2026-11-09 16:58:43',
    atualizado_em: '2026-11-09 16:59:12',
    ...overrides
  };
}

function pedidoBase(overrides = {}) {
  return {
    transacaoId: 1,
    operador: 'Product Owner — CDS',
    observacao:
      'Reconciliação administrativa TEF-DESTAXA-51.27 id=1: Destaxa informou que sem aproximação/continuaTransacao não houve aprovação e não existe pendência na adquirente. Log histórico V$Pague (timeout AC + 78). Sem FINALIZE DLL.',
    confirmacaoExplicitaPo: true,
    referenciaDestaxa:
      'WhatsApp Integração Destaxa — sem continuaTransacao / sem aproximação → não aprovada; nada pendente.',
    referenciaLogHistorico:
      'vspague-client.log + CDS 51.17: START→99→CONTINUE HOST_SECURITY_OPERATION_BLOCKED; timeout AC; resposta 78.',
    ...overrides
  };
}

function criarDbMemoria() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tef_transacoes (
      id INTEGER PRIMARY KEY,
      venda_id INTEGER,
      tipo TEXT NOT NULL,
      valor DECIMAL(10,2) NOT NULL,
      status TEXT DEFAULT 'pendente',
      provedor TEXT,
      nsu TEXT,
      autorizacao TEXT,
      codigo_transacao TEXT,
      mensagem_resposta TEXT,
      idempotency_key TEXT UNIQUE,
      criado_em DATETIME,
      atualizado_em DATETIME
    );
    CREATE TABLE tef_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transacao_id INTEGER,
      tipo TEXT,
      mensagem TEXT,
      payload TEXT,
      hash_integridade TEXT,
      criado_em DATETIME
    );
    CREATE TABLE lancamentos_financeiros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tef_transacao_id INTEGER,
      valor REAL
    );
    CREATE TABLE eventos_fiscais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tef_transacao_id INTEGER,
      tipo TEXT
    );
  `);
  db.prepare(`
    INSERT INTO tef_transacoes (
      id, venda_id, tipo, valor, status, provedor, nsu, autorizacao,
      codigo_transacao, idempotency_key, criado_em, atualizado_em
    ) VALUES (1, NULL, 'cartao_debito', 1, 'pendente', 'destaxa', NULL, NULL,
              '1', ?, '2026-11-09 16:58:43', '2026-11-09 16:59:12')
  `).run(OPERACAO_AUTORIZADA_51_27.idempotency_key);
  return db;
}

console.log('\n=== TEF-DESTAXA-51.27 — Reconciliação INEXISTENT ===\n');

test('Hash 51.20 TefManager preservado', () => {
  const buf = fs.readFileSync(TEF_MANAGER);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
  assert.strictEqual(hash, HASH_51_20);
});

test('Contrato expõe NAO_REALIZADA e policy expõe INEXISTENT', () => {
  assert.strictEqual(tefContrato.STATUS.NAO_REALIZADA, 'nao_realizada');
  assert.strictEqual(FINANCIAL_STATES.INEXISTENT, 'INEXISTENT');
  assert.strictEqual(FINANCIAL_STATES.CANCELLED, 'CANCELLED');
  assert.notStrictEqual(FINANCIAL_STATES.INEXISTENT, FINANCIAL_STATES.CANCELLED);
  assert.strictEqual(tefContrato.normalizarStatus('nao_realizada'), 'nao_realizada');
  assert.strictEqual(STATUS_ADMINISTRATIVO, 'nao_realizada');
  assert.strictEqual(FINANCIAL_STATE_ALVO, 'INEXISTENT');
});

test('INEXISTENT não mapeia para CANCELLED / cancelado', () => {
  assert.notStrictEqual(STATUS_ADMINISTRATIVO, tefContrato.STATUS.CANCELADO);
  assert.notStrictEqual(FINANCIAL_STATE_ALVO, FINANCIAL_STATES.CANCELLED);
});

test('Reconciliação id=1 com evidência — permitida', () => {
  const eventos = [];
  const resultado = reconciliarAdministrativamenteInexistente({
    linha: linhaBase(),
    pedido: pedidoBase(),
    persistir: ({ update, log }) => {
      eventos.push({ update, log });
      return { changes: 1 };
    }
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.alterado, true);
  assert.strictEqual(resultado.statusPosterior, 'nao_realizada');
  assert.strictEqual(resultado.financialState, 'INEXISTENT');
  assert.strictEqual(resultado.nsu, null);
  assert.strictEqual(resultado.autorizacao, null);
  assert.strictEqual(eventos.length, 1);
  assert.strictEqual(eventos[0].log.tipo, TIPO_LOG);
  assert.strictEqual(eventos[0].update.status, 'nao_realizada');
});

test('ID diferente de 1 — não autorizado', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(pedidoBase({ transacaoId: 2 }), linhaBase({ id: 2 })),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_ID_NAO_AUTORIZADO'
  );
});

test('Idempotency divergente — bloqueio', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(
      pedidoBase(),
      linhaBase({ idempotency_key: 'outra-chave' })
    ),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_IDEMPOTENCY_DIVERGENTE'
  );
});

test('Valor divergente — bloqueio', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(pedidoBase(), linhaBase({ valor: 2 })),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_VALOR_DIVERGENTE'
  );
});

test('Modalidade divergente — bloqueio', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(
      pedidoBase(),
      linhaBase({ tipo: 'cartao_credito' })
    ),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_MODALIDADE_DIVERGENTE'
  );
});

test('Observação ausente — bloqueio', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(pedidoBase({ observacao: '  ' }), linhaBase()),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_OBSERVACAO_AUSENTE'
  );
});

test('Operador ausente — bloqueio', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(pedidoBase({ operador: '' }), linhaBase()),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_OPERADOR_AUSENTE'
  );
});

test('Confirmação explícita ausente — bloqueio', () => {
  assert.throws(
    () => validarPedidoReconciliacaoInexistente(
      pedidoBase({ confirmacaoExplicitaPo: false }),
      linhaBase()
    ),
    (err) => err.code === 'TEF_RECONC_INEXISTENTE_CONFIRMACAO_AUSENTE'
  );
});

test('Reconciliação duplicada — idempotente', () => {
  const resultado = reconciliarAdministrativamenteInexistente({
    linha: linhaBase({ status: 'nao_realizada' }),
    pedido: pedidoBase(),
    persistir: () => {
      throw new Error('não deve persistir em idempotência');
    }
  });
  assert.strictEqual(resultado.ok, true);
  assert.strictEqual(resultado.idempotente, true);
  assert.strictEqual(resultado.alterado, false);
  assert.strictEqual(resultado.statusPosterior, 'nao_realizada');
});

test('Estado UNKNOWN/pendente sem autorização — continua bloqueado', () => {
  assert.strictEqual(ePendenciaOperacionalAtiva('pendente'), true);
  assert.strictEqual(contaComoPendenciaBloqueadora('pendente'), true);
  const exclusividade = simularExclusividadeAposStatus(['pendente']);
  assert.strictEqual(exclusividade.bloqueada, true);
  assert.strictEqual(exclusividade.pendentesAtivos, 1);
});

test('Estado INEXISTENT/nao_realizada — não conta como pendência ativa', () => {
  assert.strictEqual(eTerminalAdministrativoInexistente('nao_realizada'), true);
  assert.strictEqual(ePendenciaOperacionalAtiva('nao_realizada'), false);
  assert.strictEqual(contaComoPendenciaBloqueadora('nao_realizada'), false);
  const exclusividade = simularExclusividadeAposStatus(['nao_realizada']);
  assert.strictEqual(exclusividade.bloqueada, false);
  assert.strictEqual(exclusividade.pendentesAtivos, 0);
});

test('Nova transação com outra UNKNOWN — continua bloqueada', () => {
  const exclusividade = simularExclusividadeAposStatus(['nao_realizada', 'pendente']);
  assert.strictEqual(exclusividade.bloqueada, true);
  assert.strictEqual(exclusividade.pendentesAtivos, 1);
});

test('Persistência SQLite: NSU/autorização/venda null; sem financeiro/fiscal', () => {
  const db = criarDbMemoria();
  const resultado = reconciliarAdministrativamenteInexistente({
    linha: linhaBase(),
    pedido: pedidoBase(),
    persistir: (ctx) => persistirInexistenteSqliteSync(db, ctx)
  });
  assert.strictEqual(resultado.ok, true);

  const row = db.prepare('SELECT * FROM tef_transacoes WHERE id = 1').get();
  assert.strictEqual(row.status, 'nao_realizada');
  assert.strictEqual(row.nsu, null);
  assert.strictEqual(row.autorizacao, null);
  assert.strictEqual(row.venda_id, null);
  assert.ok(String(row.mensagem_resposta || '').includes('INEXISTENT'));

  const logs = db.prepare('SELECT * FROM tef_logs WHERE transacao_id = 1').all();
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].tipo, TIPO_LOG);
  const payload = JSON.parse(logs[0].payload);
  assert.strictEqual(payload.financialState, 'INEXISTENT');
  assert.strictEqual(payload.statusAnterior, 'pendente');
  assert.strictEqual(payload.statusPosterior, 'nao_realizada');
  assert.strictEqual(payload.preservacoes.semLancamentoFinanceiro, true);
  assert.strictEqual(payload.preservacoes.semEventoFiscal, true);
  assert.strictEqual(payload.preservacoes.semChamadaDll, true);

  const fin = db.prepare('SELECT COUNT(*) AS c FROM lancamentos_financeiros').get();
  const fis = db.prepare('SELECT COUNT(*) AS c FROM eventos_fiscais').get();
  assert.strictEqual(fin.c, 0);
  assert.strictEqual(fis.c, 0);

  // criarTransacaoExclusiva equivalente: sem pendente → INSERT permitido
  const podeInserir = db.prepare(`
    SELECT CASE WHEN EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')
      THEN 0 ELSE 1 END AS livre
  `).get();
  assert.strictEqual(podeInserir.livre, 1);

  // Outra UNKNOWN (pendente) bloquearia
  db.prepare(`
    INSERT INTO tef_transacoes (id, tipo, valor, status, provedor, idempotency_key)
    VALUES (99, 'cartao_debito', 1, 'pendente', 'destaxa', 'outra-unknown')
  `).run();
  const bloqueada = db.prepare(`
    SELECT CASE WHEN EXISTS (SELECT 1 FROM tef_transacoes WHERE status = 'pendente')
      THEN 1 ELSE 0 END AS bloqueada
  `).get();
  assert.strictEqual(bloqueada.bloqueada, 1);

  db.close();
});

test('Gate DESTAXA permanece OFF neste processo de teste', () => {
  const gate = String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').toLowerCase();
  assert.ok(gate === '' || gate === '0' || gate === 'false' || gate === 'off');
});

console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
process.exit(falhou > 0 ? 1 : 0);
