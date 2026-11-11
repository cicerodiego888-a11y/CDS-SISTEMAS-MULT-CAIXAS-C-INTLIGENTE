'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const root = path.resolve(__dirname, '..', '..', '..', '..');
const db = new DatabaseSync(DB, { readOnly: true });

const tx = db.prepare('SELECT * FROM tef_transacoes WHERE id = 3').get();
const logRetorno = db.prepare(
  "SELECT id, tipo, mensagem, payload, criado_em FROM tef_logs WHERE id = 36"
).get();
const logCiclo = db.prepare(
  "SELECT id, tipo, mensagem, payload, criado_em FROM tef_logs WHERE id = 35"
).get();

function buscar(texto, patterns) {
  const out = {};
  for (const [k, re] of Object.entries(patterns)) {
    const m = String(texto || '').match(re);
    out[k] = m ? m[1] : null;
  }
  return out;
}

const patterns = {
  nsu: /"nsu"\s*:\s*"?([^",}\s]+)"?/,
  autorizacao: /"autorizacao"\s*:\s*"?([^",}\s]+)"?/,
  nsuRede: /"nsuRede"\s*:\s*"?([^",}\s]+)"?|"nsu_rede"\s*:\s*"?([^",}\s]+)"?/,
  codigoDestaxa: /"codigoDestaxa"\s*:\s*"([^"]+)"/,
  codigo: /"codigo"\s*:\s*"([^"]+)"/,
  estado: /"estado"\s*:\s*"([^"]+)"/
};

const fromRetorno = buscar(logRetorno?.payload, patterns);
const fromCiclo = buscar(logCiclo?.payload, patterns);

let decrypt = { ok: false, erro: null, nsuRede: null, codigo: null, estado: null };
try {
  const cryptoService = require(path.join(root, 'backend/services/crypto/cryptoService'));
  const payload = cryptoService.descriptografarObjeto(tx.payload_retorno);
  decrypt = {
    ok: true,
    nsu: payload?.nsu || payload?.resultado?.nsu || null,
    autorizacao: payload?.autorizacao || payload?.resultado?.autorizacao || null,
    nsuRede: payload?.nsuRede || payload?.nsu_rede || payload?.resultado?.nsuRede || null,
    codigoDestaxa: payload?.codigoDestaxa || payload?.resultado?.codigoDestaxa || null,
    keys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 40) : []
  };
  const flat = JSON.stringify(payload);
  const m = flat.match(/241255/);
  decrypt.contains241255 = !!m;
  const mNsuRede = flat.match(/"nsuRede":"([^"]+)"|"nsu_rede":"([^"]+)"|"nsuHost":"([^"]+)"/i);
  decrypt.nsuRedeMatch = mNsuRede ? (mNsuRede[1] || mNsuRede[2] || mNsuRede[3]) : null;
} catch (e) {
  decrypt.erro = e.message;
}

const comprovanteCli = String(tx.comprovante_cliente || '');
const comprovanteLooksEncrypted = comprovanteCli.startsWith('{') || comprovanteCli.includes('ciphertext');

console.log(JSON.stringify({
  fromRetorno,
  fromCiclo,
  decrypt,
  comprovanteLooksEncrypted,
  comprovanteCliHead: comprovanteCli.slice(0, 120),
  retornoContains241255: String(logRetorno?.payload || '').includes('241255'),
  cicloContains241255: String(logCiclo?.payload || '').includes('241255'),
  retornoContains00: /"codigoDestaxa":"00"|"codigo":"00"/.test(String(logRetorno?.payload || ''))
    || /"codigoDestaxa":"00"|"codigo":"00"/.test(String(logCiclo?.payload || ''))
}, null, 2));

db.close();
