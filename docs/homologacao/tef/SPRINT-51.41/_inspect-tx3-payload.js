'use strict';
const sqlite3 = require('sqlite3');
const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
db.get('SELECT id, status, nsu, autorizacao, payload_retorno FROM tef_transacoes WHERE id = 3', (err, row) => {
  if (err) {
    console.error(err);
    db.close();
    process.exit(1);
  }
  let payload = row && row.payload_retorno;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (_) { /* maybe encrypted */ }
  }
  const out = {
    id: row && row.id,
    status: row && row.status,
    nsu: row && row.nsu,
    autorizacao: row && row.autorizacao,
    payloadType: typeof payload,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : null,
    financialState: payload && payload.financialState,
    codigoDestaxa: payload && (payload.codigoDestaxa || payload.codigo),
    evidenciasDestaxa00: payload && payload.evidenciasDestaxa00
      ? {
        nsu: payload.evidenciasDestaxa00.transacao_nsu,
        autorizacao: payload.evidenciasDestaxa00.transacao_autorizacao,
        confirmada: payload.evidenciasDestaxa00.confirmada,
        keys: Object.keys(payload.evidenciasDestaxa00)
      }
      : null,
    resultadoTardio: payload && payload.resultadoTardio || null,
    reconciliacao: payload && payload.reconciliacao || null,
    mensagem: payload && payload.mensagem
  };
  console.log(JSON.stringify(out, null, 2));
  db.close();
});
