'use strict';

/**
 * SPRINT 51.46 — CLI dry-run do runner controlado RECUPERACAO_PROTOCOLAR_TX3.
 *
 * Não chama iniciaClientDestaxa / finalizaTransacaoDestaxa / DLL / NativeHost / V$Pague.
 * Não emite permit real. Gate permanece OFF.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const {
  executarRunnerRecuperacaoProtocolarTx3,
  TOKEN_GO_PO,
  PATH_NOME,
  OPERACAO_AUTORIZADA,
  SPRINT
} = require(path.join(root, 'backend/services/tef/destaxa/tefRunnerRecuperacaoProtocolarTx3.js'));

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const OUT = path.join(__dirname, 'dry-run-resultado.json');

const forcarExecucaoReal = process.argv.includes('--executar-real');
const dryRun = !forcarExecucaoReal;

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

const resultado = executarRunnerRecuperacaoProtocolarTx3({
  linha,
  venda,
  pedido: {
    transacaoId: 3,
    operation: 'TX_FINALIZE',
    confirmacao: 0,
    operador: 'PO/Cicero — SPRINT-51.46 dry-run',
    confirmacaoExplicitaPo: true,
    tokenGoPo: TOKEN_GO_PO,
    executarReal: forcarExecucaoReal === true
  },
  evidenciasPendencia,
  estadoSessaoDestaxa: {
    codigoInitClient: 'A1',
    fonte: evidenciasPendencia.fonteEvidenciaA1,
    timeout: false
  },
  dryRun
});

const out = {
  ts: new Date().toISOString(),
  sprint: SPRINT,
  path: PATH_NOME,
  dryRun: true,
  execucaoReal: false,
  dllChamada: resultado.dllChamada === true,
  nativeHostChamado: resultado.nativeHostChamado === true,
  vespagueChamado: resultado.vespagueChamado === true,
  permitLedgerEscrito: resultado.permitLedgerEscrito === true,
  gateGlobal: resultado.gateGlobal || null,
  ok: resultado.ok === true,
  elegivel: resultado.elegivel === true,
  abortado: resultado.abortado === true,
  codigo: resultado.codigo || null,
  mensagem: resultado.mensagem,
  runId: resultado.runId || null,
  identidade: resultado.identidade || null,
  sessao: resultado.sessao || null,
  exclusividade: resultado.exclusividade || null,
  autorizacaoPo: resultado.autorizacaoPo || null,
  permit: resultado.permit || null,
  procedimentoExecucao: resultado.procedimentoExecucao || [],
  auditoriaResumo: (resultado.auditoria || []).map((a) => ({
    fase: a.fase,
    evento: a.evento,
    codigo: a.codigo || null
  })),
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
process.exit(resultado.ok ? 0 : 1);
