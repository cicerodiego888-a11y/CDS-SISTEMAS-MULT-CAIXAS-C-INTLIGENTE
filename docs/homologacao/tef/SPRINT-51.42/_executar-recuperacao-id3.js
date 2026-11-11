'use strict';

/**
 * Execução one-shot SPRINT 51.42 — recuperação administrativa TEF id=3.
 * Sem DLL / NativeHost / CRT / permit / gate / fiscal.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const {
  recuperarAdministrativamenteAprovadoId3,
  persistirRecuperacaoAprovadoSqliteSync,
  OPERACAO_AUTORIZADA_51_42
} = require(path.join(
  root,
  'backend/services/tef/tefRecuperacaoAdministrativaAprovadoId3.js'
));

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const OUT = path.join(__dirname, 'resultado-recuperacao-id3.json');

function snapshot(db) {
  const tx = db.prepare(`
    SELECT id, status, valor, tipo, nsu, autorizacao, venda_id, codigo_resposta,
           substr(mensagem_resposta, 1, 200) AS mensagem_resposta,
           length(comprovante_cliente) AS len_comp_cli,
           length(comprovante_estabelecimento) AS len_comp_loj,
           length(payload_retorno) AS len_payload,
           idempotency_key, criado_em, atualizado_em
    FROM tef_transacoes WHERE id = 3
  `).get();
  const tx2 = db.prepare(
    'SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 2'
  ).get();
  const venda = db.prepare(`
    SELECT id, total, valor_fiscal, status, status_pagamento, tef_transacao_id, forma_pagamento
    FROM vendas WHERE id = 66
  `).get();
  const recebimentos = db.prepare(`
    SELECT id, venda_id, valor, tipo_recebimento, status, tef_transacao_id
    FROM venda_recebimentos WHERE venda_id = 66
  `).all();
  const logs = db.prepare(`
    SELECT id, tipo, mensagem, criado_em
    FROM tef_logs
    WHERE CAST(transacao_id AS TEXT) = '3'
    ORDER BY id DESC
    LIMIT 5
  `).all();
  const pendentes = db.prepare(
    "SELECT id, status FROM tef_transacoes WHERE status = 'pendente'"
  ).all();
  return { tx, tx2, venda, recebimentos, logs, pendentes };
}

const dryRun = process.argv.includes('--dry-run');

const db = new DatabaseSync(DB, dryRun ? { readOnly: true } : {});

const antes = snapshot(db);
const linha = db.prepare('SELECT * FROM tef_transacoes WHERE id = 3').get();
const venda = db.prepare('SELECT * FROM vendas WHERE id = 66').get();

const pedido = {
  transacaoId: 3,
  operador: 'PO/Cicero — SPRINT-51.42',
  observacao:
    'Autorização explícita do Product Owner para recuperação administrativa da TEF ID 3 '
    + '(Destaxa 00; NSU 2338; auth 211139; venda 66). Sem nova CRT/FINALIZE/permit.',
  confirmacaoExplicitaPo: true
};

let resultado;
try {
  if (dryRun) {
    resultado = recuperarAdministrativamenteAprovadoId3({
      linha,
      venda,
      pedido,
      persistir: () => ({ dryRun: true })
    });
  } else {
    resultado = recuperarAdministrativamenteAprovadoId3({
      linha,
      venda,
      pedido,
      persistir: (ctx) => persistirRecuperacaoAprovadoSqliteSync(db, ctx)
    });
  }
} catch (error) {
  const out = {
    ok: false,
    dryRun,
    erro: {
      code: error.code || null,
      message: error.message,
      detalhes: error.detalhes || null
    },
    antes,
    operacao: OPERACAO_AUTORIZADA_51_42
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.error(JSON.stringify(out, null, 2));
  db.close();
  process.exit(1);
}

const depois = dryRun ? antes : snapshot(db);
const out = {
  ok: true,
  dryRun,
  ts: new Date().toISOString(),
  db: DB,
  resultado: {
    ok: resultado.ok,
    idempotente: resultado.idempotente,
    alterado: resultado.alterado,
    statusAnterior: resultado.statusAnterior,
    statusPosterior: resultado.statusPosterior,
    financialState: resultado.financialState,
    nsu: resultado.nsu,
    autorizacao: resultado.autorizacao,
    mensagem: resultado.mensagem,
    persistencia: resultado.persistencia || null
  },
  auditoriaResumo: resultado.auditoria
    ? {
        sprint: resultado.auditoria.sprint,
        origem: resultado.auditoria.origem,
        operador: resultado.auditoria.operador,
        horario: resultado.auditoria.horario,
        evidenciaDestaxa: resultado.auditoria.evidenciaDestaxa,
        vinculoVenda: resultado.auditoria.vinculoVenda,
        preservacoes: resultado.auditoria.preservacoes
      }
    : null,
  antes,
  depois,
  confirmacoes: {
    tx3Aprovado: depois.tx && depois.tx.status === 'aprovado',
    nsu2338: depois.tx && String(depois.tx.nsu) === '2338',
    auth211139: depois.tx && String(depois.tx.autorizacao) === '211139',
    comprovantesIntactos: depois.tx
      && depois.tx.len_comp_cli === antes.tx.len_comp_cli
      && depois.tx.len_comp_loj === antes.tx.len_comp_loj
      && depois.tx.len_payload === antes.tx.len_payload,
    venda66Vinculada: depois.venda && Number(depois.venda.tef_transacao_id) === 3,
    totaisInalterados: depois.venda
      && Number(depois.venda.total) === Number(antes.venda.total)
      && Number(depois.venda.valor_fiscal) === Number(antes.venda.valor_fiscal),
    recebimentosInalterados: JSON.stringify(depois.recebimentos)
      === JSON.stringify(antes.recebimentos),
    tx2Intocada: JSON.stringify(depois.tx2) === JSON.stringify(antes.tx2),
    semPendentes: (depois.pendentes || []).length === 0
  }
};

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
db.close();
