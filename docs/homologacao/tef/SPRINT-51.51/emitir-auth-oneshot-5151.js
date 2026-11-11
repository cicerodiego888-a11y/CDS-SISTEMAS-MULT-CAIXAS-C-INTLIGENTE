'use strict';

/**
 * SPRINT 51.51 — Emissão one-shot controlada pós-recuperação TX3.
 *
 * NÃO executa CRT / TX_* / /api/tef/pagar.
 * NÃO liga DESTAXA_REAL_TRANSACTION_ENABLED.
 *
 * Pré-checagens: gate OFF, PinPad Gertec COM4, sem ISSUED ativo, max TEF id=3.
 *
 * Uso:
 *   node docs/homologacao/tef/SPRINT-51.51/emitir-auth-oneshot-5151.js
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const auth = require(path.join(root, 'backend/services/tef/destaxa/destaxaAutorizacaoExcepcional'));
const { REAL_TRANSACTION_ENV } = require(path.join(root, 'backend/services/tef/destaxa/destaxaConstantes'));

const ledgerPath = auth.obterCaminhoLedger();
const DB_PATH = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';

const VINCOLO = Object.freeze({
  provedor: 'destaxa',
  portaCom: 'COM4',
  pinpadCodigo: 'GERTEC_PPC930',
  canal: 'pdv_oficial'
});

function precheck() {
  const falhas = [];
  const gate = String(process.env[REAL_TRANSACTION_ENV] ?? '').trim();
  if (gate === '1') {
    falhas.push(`${REAL_TRANSACTION_ENV}=1 — emissão one-shot exige gate OFF`);
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const pin = db.prepare(`
      SELECT porta_com, codigo, fabricante, modelo, habilitado, ativo
      FROM tef_pinpads WHERE id = 1
    `).get();
    const max = db.prepare('SELECT MAX(id) AS maxId FROM tef_transacoes').get();
    const pendentes = db.prepare(`
      SELECT id, status FROM tef_transacoes WHERE status = 'pendente'
    `).all();

    if (!pin || Number(pin.habilitado) !== 1 || Number(pin.ativo) !== 1) {
      falhas.push('PinPad id=1 não habilitado/ativo');
    }
    if (String(pin?.porta_com || '').toUpperCase() !== 'COM4') {
      falhas.push(`porta_com esperada COM4; atual=${pin?.porta_com || '(vazia)'}`);
    }
    if (String(pin?.codigo || '').toUpperCase() !== 'GERTEC_PPC930') {
      falhas.push(`pinpad codigo esperado GERTEC_PPC930; atual=${pin?.codigo || '(vazio)'}`);
    }
    if (Number(max?.maxId) !== 3) {
      falhas.push(`MAX(tef_transacoes.id) esperado 3; atual=${max?.maxId}`);
    }
    if (pendentes.length) {
      falhas.push(`TEF pendente(s): ${pendentes.map((p) => p.id).join(',')}`);
    }

    return { falhas, pin, max, pendentes, gate };
  } finally {
    db.close();
  }
}

function main() {
  // Não forçar gate OFF silenciosamente: se estiver 1, precheck/emissão abortam.
  if (process.env[REAL_TRANSACTION_ENV] == null || process.env[REAL_TRANSACTION_ENV] === '') {
    process.env[REAL_TRANSACTION_ENV] = '0';
  }

  const checagem = precheck();
  if (checagem.falhas.length) {
    const out = {
      ok: false,
      classificacao: 'BLOQUEADO_PRECHECK',
      falhas: checagem.falhas,
      gate: checagem.gate
    };
    fs.writeFileSync(
      path.join(__dirname, 'emissao-autorizacao.json'),
      `${JSON.stringify(out, null, 2)}\n`,
      'utf8'
    );
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }

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
    fs.writeFileSync(
      path.join(__dirname, 'emissao-autorizacao.json'),
      `${JSON.stringify(out, null, 2)}\n`,
      'utf8'
    );
    console.error(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  let resultado;
  try {
    resultado = auth.emitirAutorizacaoExcepcional({
      motivo: 'SPRINT-51.51-pos-recuperacao-tx3-homologacao-debito-r1',
      emitidoPor: 'sprint-51.51-liberacao-controlada',
      vinculo: VINCOLO
    });
  } catch (error) {
    const out = {
      ok: false,
      classificacao: 'EMISSAO_RECUSADA',
      codigo: error.codigo || null,
      mensagem: error.message,
      gateProcess: process.env[REAL_TRANSACTION_ENV] || null
    };
    fs.writeFileSync(
      path.join(__dirname, 'emissao-autorizacao.json'),
      `${JSON.stringify(out, null, 2)}\n`,
      'utf8'
    );
    console.error(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  const depois = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const out = {
    ok: resultado.ok === true,
    classificacao: 'LIBERACAO_ONESHOT_EMITIDA',
    autorizacao: resultado.autorizacao || null,
    vinculo: VINCOLO,
    ledgerPath,
    gateProcess: process.env[REAL_TRANSACTION_ENV] || null,
    gateGlobalLigado: false,
    cobrancaExecutada: false,
    instrucao: [
      'No PDV oficial (Electron), dentro do TTL:',
      '1) Confirmar mensagem de prontidão (sem bloqueio de gate).',
      '2) Uma única venda R$ 1,00 débito Destaxa Gertec COM4.',
      '3) Sem retry / PIX / crédito / cancelamento / estorno.',
      '4) Se UNKNOWN/timeout: interromper e preservar evidências.',
      '5) Gate global deve permanecer OFF.'
    ],
    ledgerDepoisPreview: (depois.autorizacoes || []).slice(-3).map((a) => ({
      id: a.authorizationId,
      status: a.status,
      valorCentavos: a.valorCentavos,
      expiresAt: a.expiresAt,
      vinculo: a.vinculo || null,
      motivo: a.motivo
    })),
    precheck: {
      pin: checagem.pin,
      maxId: checagem.max?.maxId,
      pendentes: checagem.pendentes
    }
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
