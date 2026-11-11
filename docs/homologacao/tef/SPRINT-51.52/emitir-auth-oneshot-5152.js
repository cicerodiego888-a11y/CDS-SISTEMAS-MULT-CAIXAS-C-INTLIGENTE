'use strict';

/**
 * SPRINT 51.52 — Reemissão urgente one-shot (até 22:00 BRT 10/11/2026).
 * NÃO executa cobrança. NÃO liga gate global. NÃO reinicia ERP.
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const auth = require(path.join(root, 'backend/services/tef/destaxa/destaxaAutorizacaoExcepcional'));
const { REAL_TRANSACTION_ENV } = require(path.join(root, 'backend/services/tef/destaxa/destaxaConstantes'));

const VINCOLO = Object.freeze({
  provedor: 'destaxa',
  portaCom: 'COM4',
  pinpadCodigo: 'GERTEC_PPC930',
  canal: 'pdv_oficial'
});

// 22:00 BRT = 01:00 UTC (10/11/2026 22:00 -03 → 11/11/2026 01:00Z)
const EXPIRES_AT_MS = Date.parse('2026-11-11T01:00:00.000Z');

function main() {
  if (String(process.env[REAL_TRANSACTION_ENV] || '') === '1') {
    const out = { ok: false, erro: 'DESTAXA_REAL_TRANSACTION_ENABLED=1 — abortar' };
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }
  process.env[REAL_TRANSACTION_ENV] = '0';

  const agora = Date.now();
  if (!(EXPIRES_AT_MS > agora)) {
    const out = {
      ok: false,
      erro: 'Validade 22:00 BRT já ultrapassada',
      agora: new Date(agora).toISOString()
    };
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }
  const ttlMs = EXPIRES_AT_MS - agora;

  const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
  let max;
  let pendentes;
  try {
    max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
    pendentes = db.prepare("SELECT id FROM tef_transacoes WHERE status = 'pendente'").all();
  } finally {
    db.close();
  }
  if (Number(max.maxId) !== 3 || pendentes.length) {
    const out = { ok: false, erro: 'precheck TEF', max, pendentes };
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  let resultado;
  try {
    resultado = auth.emitirAutorizacaoExcepcional({
      motivo: 'SPRINT-51.52-reemissao-urgente-homologacao-debito-r1',
      emitidoPor: 'product-owner-go-verbal-51.52',
      vinculo: VINCOLO,
      ttlMs
    });
  } catch (error) {
    const out = {
      ok: false,
      codigo: error.codigo || null,
      mensagem: error.message,
      authorizationIdExistente: error.authorizationIdExistente || null
    };
    fs.writeFileSync(
      path.join(__dirname, 'emissao-autorizacao.json'),
      `${JSON.stringify(out, null, 2)}\n`,
      'utf8'
    );
    console.error(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const out = {
    ok: resultado.ok === true,
    classificacao: 'LIBERACAO_ONESHOT_REEMITIDA',
    sprint: 'SPRINT-51.52',
    autorizacao: resultado.autorizacao,
    validadeBrasilia: '2026-11-10 22:00:00 -03:00',
    expiresAtUtc: resultado.autorizacao?.expiresAt || null,
    gateProcess: process.env[REAL_TRANSACTION_ENV] || null,
    gateGlobalLigado: false,
    cobrancaExecutada: false,
    txStartContinueFinalize: false,
    maxTefId: max.maxId,
    erpReiniciado: false,
    vinculo: VINCOLO,
    instrucao: 'Cobrança manual no PDV após confirmação de prontidão. Sem retry/PIX/crédito/cancel/estorno. Se UNKNOWN/timeout: interromper.'
  };

  fs.writeFileSync(
    path.join(__dirname, 'emissao-autorizacao.json'),
    `${JSON.stringify(out, null, 2)}\n`,
    'utf8'
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main();
