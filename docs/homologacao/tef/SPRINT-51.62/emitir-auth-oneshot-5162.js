'use strict';

/**
 * SPRINT 51.62 — One-shot Destaxa R$1,00 débito para cobrança MANUAL no PDV.
 * NÃO executa CRT / TX_* / /api/tef/pagar. NÃO liga gate global.
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

const EXPECTED_SESSION = '91ce63acec0f09b2efba16571dad4c74';
const TTL_MS = 30 * 60 * 1000; // 30 min — curto, suficiente para operador

function main() {
  if (String(process.env[REAL_TRANSACTION_ENV] || '') === '1') {
    const out = { ok: false, erro: 'DESTAXA_REAL_TRANSACTION_ENABLED=1 — abortar' };
    fs.writeFileSync(path.join(__dirname, 'emissao-autorizacao.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }
  process.env[REAL_TRANSACTION_ENV] = '0';

  const precheckPath = path.join(__dirname, 'precheck.json');
  if (!fs.existsSync(precheckPath)) {
    const out = { ok: false, erro: 'precheck.json ausente — rode _precheck.js antes' };
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }
  const pre = JSON.parse(fs.readFileSync(precheckPath, 'utf8'));
  if (!pre.ok) {
    const out = { ok: false, classificacao: 'BLOCKED_WITH_EVIDENCE', precheck: pre.checks };
    fs.writeFileSync(path.join(__dirname, 'emissao-autorizacao.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }
  if (pre.alive?.hostSessionId !== EXPECTED_SESSION) {
    const out = {
      ok: false,
      erro: 'Sessão precheck diverge da esperada',
      esperada: EXPECTED_SESSION,
      atual: pre.alive?.hostSessionId || null
    };
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
  let max;
  let pendentes;
  try {
    max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
    pendentes = db.prepare(
      "SELECT id FROM tef_transacoes WHERE status='pendente' OR lower(coalesce(status,''))='unknown'"
    ).all();
  } finally {
    db.close();
  }
  if (Number(max.maxId) !== 4 || pendentes.length) {
    const out = { ok: false, erro: 'precheck TEF imediato', max, pendentes };
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  const ledgerPath = auth.obterCaminhoLedger();
  const antes = fs.existsSync(ledgerPath)
    ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    : { autorizacoes: [] };
  const issuedAntes = (antes.autorizacoes || []).filter((a) => a.status === 'ISSUED');
  if (issuedAntes.length) {
    const out = {
      ok: false,
      classificacao: 'BLOQUEADO_DUPLICIDADE',
      erro: 'Já existe ISSUED — não emitir outro',
      issuedAntes
    };
    fs.writeFileSync(path.join(__dirname, 'emissao-autorizacao.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  let resultado;
  try {
    resultado = auth.emitirAutorizacaoExcepcional({
      motivo: 'SPRINT-51.62-oneshot-manual-pdv-debito-r1',
      emitidoPor: 'product-owner-go-verbal-51.62',
      vinculo: VINCOLO,
      ttlMs: TTL_MS
    });
  } catch (error) {
    const out = {
      ok: false,
      classificacao: 'EMISSAO_RECUSADA',
      codigo: error.codigo || null,
      mensagem: error.message,
      authorizationIdExistente: error.authorizationIdExistente || null
    };
    fs.writeFileSync(path.join(__dirname, 'emissao-autorizacao.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.error(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const inspecao = auth.inspecionarAutorizacaoExcepcional(
    resultado.autorizacao?.authorizationId
  );
  const encontrar = auth.encontrarAutorizacaoIssuidaCompativel({
    valorCentavos: 100,
    tipoPdv: 'debito',
    operacao: 'CRT',
    vinculo: VINCOLO
  });

  const expiresAt = resultado.autorizacao?.expiresAt || null;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;
  const validadeBrasilia = expiresAtMs
    ? new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(expiresAtMs) + ' (America/Sao_Paulo)'
    : null;

  const out = {
    ok: resultado.ok === true && inspecao.ok === true && encontrar.ok === true,
    classificacao: 'READY_FOR_MANUAL_PDV_PAYMENT',
    sprint: 'SPRINT-51.62',
    autorizacao: resultado.autorizacao,
    inspecaoSemConsumo: {
      ok: inspecao.ok,
      status: inspecao.autorizacao?.status || null,
      authorizationId: inspecao.autorizacao?.authorizationId || null
    },
    disponivelAoPdvSemConsumo: encontrar.ok === true,
    validadeBrasilia,
    expiresAtUtc: expiresAt,
    ttlMs: TTL_MS,
    sessaoUtilizada: {
      hostSessionId: EXPECTED_SESSION,
      erpPid: pre.erp?.ProcessId || 16744,
      hostPid: pre.host?.ProcessId || 13940
    },
    vinculo: VINCOLO,
    gateProcess: process.env[REAL_TRANSACTION_ENV] || null,
    gateGlobalLigado: false,
    cobrancaExecutadaPeloCursor: false,
    txStartContinueFinalize: false,
    apiTefPagar: false,
    maxTefId: max.maxId,
    avisoFiscal: pre.avisoFiscal,
    instrucao: [
      'No PDV oficial (ERP 16744), dentro do TTL:',
      '1) Abrir caixa / venda homologação R$ 1,00 débito Destaxa Gertec COM4.',
      '2) Uma única tentativa. Sem retry / PIX / crédito / cancel / estorno.',
      '3) Se UNKNOWN/timeout/ambíguo: interromper e preservar evidências.',
      '4) Gate global permanece OFF.',
      '5) Transmissão NFC-e/SEFAZ: somente com autorização fiscal separada do PO.'
    ]
  };

  fs.writeFileSync(
    path.join(__dirname, 'emissao-autorizacao.json'),
    `${JSON.stringify(out, null, 2)}\n`
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main();
