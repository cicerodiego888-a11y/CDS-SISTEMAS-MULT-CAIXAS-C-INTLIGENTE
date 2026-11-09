'use strict';

/**
 * TEF-DESTAXA-51.10 — emissão pontual one-shot (não faz CRT).
 * Uso: node docs/homologacao/tef/TEF-DESTAXA-51.10/emitir-auth-oneshot.js
 */

const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..', '..', '..', '..');
const auth = require(path.join(root, 'backend/services/tef/destaxa/destaxaAutorizacaoExcepcional'));

const ledgerPath = path.join(
  process.env.LOCALAPPDATA || '',
  'CDS-SISTEMAS',
  'tef',
  'destaxa-autorizacao-excepcional.json'
);

const antes = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : null;
const resultado = auth.emitirAutorizacaoExcepcional({
  motivo: 'TEF-DESTAXA-51.10-homologacao-tx-continue-r1',
  emitidoPor: 'responsavel-autorizado-51.10'
});
const depois = fs.readFileSync(ledgerPath, 'utf8');

const out = {
  ok: resultado.ok === true,
  autorizacao: resultado.autorizacao || null,
  ledgerPath,
  gateProcess: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  ledgerAntesPreview: antes ? JSON.parse(antes).autorizacoes.map((a) => ({
    id: a.authorizationId,
    status: a.status
  })) : [],
  ledgerDepoisPreview: JSON.parse(depois).autorizacoes.map((a) => ({
    id: a.authorizationId,
    status: a.status,
    expiresAt: a.expiresAt
  }))
};

fs.writeFileSync(
  path.join(__dirname, 'emissao-autorizacao.json'),
  `${JSON.stringify(out, null, 2)}\n`,
  'utf8'
);
console.log(JSON.stringify(out, null, 2));
