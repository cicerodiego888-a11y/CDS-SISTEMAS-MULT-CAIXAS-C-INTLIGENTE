'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const LEDGER = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

(async () => {
  const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
  const tx2 = await get(
    db,
    `SELECT id, status, valor, tipo, nsu, autorizacao, comprovante_cliente, comprovante_estabelecimento,
            criado_em, atualizado_em
     FROM tef_transacoes WHERE id = 2`
  );
  const ativas = await all(
    db,
    `SELECT id, status, valor, tipo, venda_id, atualizado_em
     FROM tef_transacoes
     WHERE LOWER(COALESCE(status,'')) IN (
       'pendente','em_andamento','processando','aguardando','unknown','inconclusivo','autorizada'
     )
     OR UPPER(COALESCE(status,'')) IN ('UNKNOWN','PENDING','INCONCLUSIVO')
     ORDER BY id DESC`
  );
  const cfg = await get(
    db,
    `SELECT id, habilitado, provedor, ambiente, timeout FROM tef_configuracao ORDER BY id LIMIT 1`
  );
  const pinpads = await all(db, `SELECT * FROM tef_pinpads`).catch(() => []);
  const leaseUltimos = await all(
    db,
    `SELECT id, tipo, mensagem, substr(payload,1,400) AS p, criado_em
     FROM tef_logs
     WHERE payload LIKE '%lease%'
     ORDER BY id DESC LIMIT 8`
  );
  db.close();

  let ledger = { exists: fs.existsSync(LEDGER), issued: [], consumedCount: 0 };
  if (ledger.exists) {
    const raw = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    const auths = raw.autorizacoes || [];
    ledger.issued = auths.filter((a) => a.status === 'ISSUED').map((a) => ({
      id: a.authorizationId,
      valorCentavos: a.valorCentavos,
      expiresAt: a.expiresAt
    }));
    ledger.consumedCount = auths.filter((a) => a.status === 'CONSUMED').length;
  }

  const out = {
    ts: new Date().toISOString(),
    tx2,
    ativasOuUnknown: ativas,
    tefConfig: cfg,
    pinpads,
    leaseUltimos: leaseUltimos.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      mensagem: r.mensagem,
      acao: (String(r.p).match(/"acao":"([^"]+)"/) || [])[1] || null,
      leaseId: (String(r.p).match(/"leaseId":"([^"]+)"/) || [])[1] || null,
      liberado: (String(r.p).match(/"liberado":(true|false)/) || [])[1] || null,
      criado_em: r.criado_em
    })),
    ledger,
    gateEnv: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
    nota: 'Allocator de lease é em memória do processo Electron atual — limpo no boot.'
  };

  fs.writeFileSync(
    path.join(__dirname, '_precheck-pos-restore.json'),
    `${JSON.stringify(out, null, 2)}\n`
  );
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
