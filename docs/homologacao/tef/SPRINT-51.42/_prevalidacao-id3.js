'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const OUT = path.join(__dirname, 'prevalidacao-id3.json');

const db = new DatabaseSync(DB, { readOnly: true });

const cols = db.prepare('PRAGMA table_info(tef_transacoes)').all().map((c) => c.name);
const vcols = db.prepare('PRAGMA table_info(vendas)').all().map((c) => c.name);

const txRaw = db.prepare('SELECT * FROM tef_transacoes WHERE id = 3').get();
const tx = txRaw
  ? {
      id: txRaw.id,
      status: txRaw.status,
      valor: txRaw.valor,
      tipo: txRaw.tipo,
      nsu: txRaw.nsu,
      autorizacao: txRaw.autorizacao,
      venda_id: txRaw.venda_id,
      provedor: txRaw.provedor,
      codigo_resposta: txRaw.codigo_resposta,
      mensagem_resposta: txRaw.mensagem_resposta,
      idempotency_key: txRaw.idempotency_key,
      adquirente: txRaw.adquirente,
      bandeira: txRaw.bandeira,
      codigo_transacao: txRaw.codigo_transacao,
      len_comp_cli: txRaw.comprovante_cliente
        ? String(txRaw.comprovante_cliente).length
        : 0,
      len_comp_loj: txRaw.comprovante_estabelecimento
        ? String(txRaw.comprovante_estabelecimento).length
        : 0,
      len_payload: txRaw.payload_retorno
        ? String(txRaw.payload_retorno).length
        : 0,
      criado_em: txRaw.criado_em,
      atualizado_em: txRaw.atualizado_em,
      campos: Object.keys(txRaw)
    }
  : null;

const tx2 = db.prepare(
  'SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE id = 2'
).get();

const venda = db.prepare(`
  SELECT id, total, valor_fiscal, status, status_pagamento, tef_transacao_id, forma_pagamento
  FROM vendas WHERE id = 66
`).get();

let recebimentos = [];
try {
  recebimentos = db.prepare(`
    SELECT id, venda_id, valor, tipo_recebimento, forma, status, tef_transacao_id
    FROM venda_recebimentos WHERE venda_id = 66
  `).all();
} catch (e) {
  try {
    recebimentos = db.prepare(`
      SELECT id, venda_id, valor, tipo_recebimento, status, tef_transacao_id
      FROM venda_recebimentos WHERE venda_id = 66
    `).all();
  } catch (e2) {
    recebimentos = [{ erro: String(e2.message || e2) }];
  }
}

const recTef3 = db.prepare(`
  SELECT id, venda_id, valor, tef_transacao_id
  FROM venda_recebimentos
  WHERE tef_transacao_id = 3 OR CAST(tef_transacao_id AS TEXT) = '3'
`).all();

const pendentes = db.prepare(
  "SELECT id, status, nsu, autorizacao, venda_id FROM tef_transacoes WHERE status = 'pendente'"
).all();

const logs = db.prepare(`
  SELECT id, tipo, mensagem, substr(payload, 1, 900) AS p, criado_em
  FROM tef_logs WHERE CAST(transacao_id AS TEXT) = '3' ORDER BY id
`).all();

const out = {
  ts: new Date().toISOString(),
  db: DB,
  cols,
  vendasTemTefTransacaoId: vcols.includes('tef_transacao_id'),
  tx3: tx,
  tx2,
  venda66: venda,
  recebimentos66: recebimentos,
  recebimentosComTef3: recTef3,
  pendentes,
  logs: logs.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    mensagem: l.mensagem,
    criado_em: l.criado_em,
    codigoDestaxa: (String(l.p).match(/"codigoDestaxa":"([^"]+)"/) || [])[1]
      || (String(l.p).match(/"codigo":"([^"]+)"/) || [])[1]
      || null,
    nsu: (String(l.p).match(/"nsu":"([^"]+)"/) || [])[1]
      || (String(l.p).match(/"nsu":(\d+)/) || [])[1]
      || null,
    autorizacao: (String(l.p).match(/"autorizacao":"([^"]+)"/) || [])[1] || null,
    nsuRede: (String(l.p).match(/"nsuRede":"([^"]+)"/) || [])[1]
      || (String(l.p).match(/"nsu_rede":"([^"]+)"/) || [])[1]
      || null,
    financialState: (String(l.p).match(/"financialState":"([^"]+)"/) || [])[1] || null,
    snippet: String(l.p).slice(0, 280)
  }))
};

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
db.close();
