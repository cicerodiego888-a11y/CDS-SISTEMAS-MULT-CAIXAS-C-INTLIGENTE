'use strict';

/**
 * Runner dry-run SPRINT 51.45 — RECUPERACAO_PROTOCOLAR_TX3.
 * Não chama DLL / NativeHost / V$Pague. Não emite permit real (ledger intacto).
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const {
  planejarRecuperacaoProtocolarTx3,
  OPERACAO_AUTORIZADA,
  PATH_NOME
} = require(path.join(root, 'backend/services/tef/destaxa/tefRecuperacaoProtocolarTx3.js'));

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const OUT = path.join(__dirname, 'dry-run-resultado.json');

const db = new DatabaseSync(DB, { readOnly: true });
const linha = db.prepare('SELECT * FROM tef_transacoes WHERE id = 3').get();
const venda = db.prepare(
  'SELECT id, total, status, status_pagamento, tef_transacao_id, forma_pagamento FROM vendas WHERE id = 66'
).get();
const pendentes = db.prepare(
  "SELECT id, status, nsu, autorizacao FROM tef_transacoes WHERE status = 'pendente'"
).all();
db.close();

const evidenciasPendencia = {
  codigoInitClient: 'A1',
  nsu: linha?.nsu,
  autorizacao: linha?.autorizacao,
  codigoVespague: OPERACAO_AUTORIZADA.codigoVespague,
  pendenciasOperacionaisCds: pendentes,
  finalizeDestaxaPosteriorATx3: false,
  multiplasPendenciasDestaxa: false,
  confirmacaoExclusividadePo: true,
  fonteEvidenciaA1:
    'NativeHost observability 2026-11-10T21:44:57Z requestId=1a83ad933cc4fb7b (SPRINT-51.43)'
};

const plano = planejarRecuperacaoProtocolarTx3({
  linha,
  venda,
  pedido: {
    transacaoId: 3,
    operador: 'PO/Cicero — SPRINT-51.45 dry-run',
    confirmacaoExplicitaPo: true,
    confirmacao: 0
  },
  evidenciasPendencia,
  dryRun: true
});

const out = {
  ts: new Date().toISOString(),
  path: PATH_NOME,
  dryRun: true,
  execucaoReal: false,
  dllChamada: false,
  nativeHostChamado: false,
  permitLedgerEscrito: plano.permit?.ledgerEscrito === true,
  gateGlobal: plano.gateGlobal || null,
  elegivel: plano.elegivel === true,
  ok: plano.ok === true,
  codigo: plano.codigo || null,
  mensagem: plano.mensagem,
  identidade: plano.identidade || null,
  exclusividade: plano.exclusividade || null,
  hostPermit: plano.permit?.hostPermit || null,
  exceptionalPermitResumo: plano.permit?.exceptionalPermit
    ? {
        purpose: plano.permit.exceptionalPermit.purpose,
        operation: plano.permit.exceptionalPermit.operation,
        confirmacao: plano.permit.exceptionalPermit.confirmacao,
        transactionId: plano.permit.exceptionalPermit.transactionId,
        dryRun: plano.permit.exceptionalPermit.dryRun,
        oneShot: plano.permit.exceptionalPermit.oneShot
      }
    : null,
  passosPrevistos: plano.passosPrevistos || [],
  passosProibidos: plano.passosProibidos || [],
  snapshotReadonly: {
    tx3: linha
      ? {
          id: linha.id,
          status: linha.status,
          nsu: linha.nsu,
          autorizacao: linha.autorizacao,
          venda_id: linha.venda_id,
          idempotency_key: linha.idempotency_key
        }
      : null,
    venda66: venda,
    pendentes
  }
};

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(plano.ok ? 0 : 1);
