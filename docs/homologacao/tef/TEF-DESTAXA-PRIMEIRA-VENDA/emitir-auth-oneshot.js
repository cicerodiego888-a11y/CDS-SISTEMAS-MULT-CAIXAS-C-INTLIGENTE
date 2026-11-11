'use strict';

/**
 * Emissão pontual one-shot para a 1ª venda de homologação Destaxa.
 * NÃO executa CRT / TX / pagamento. NÃO liga o gate global.
 *
 * Usar SOMENTE após GO verbal do Product Owner, imediatamente antes da venda no PDV.
 *
 * Uso:
 *   node docs/homologacao/tef/TEF-DESTAXA-PRIMEIRA-VENDA/emitir-auth-oneshot.js
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
  motivo: 'TEF-DESTAXA-PRIMEIRA-VENDA-homologacao-debito-r1',
  emitidoPor: 'product-owner-go-verbal'
});
const depois = fs.readFileSync(ledgerPath, 'utf8');

const out = {
  ok: resultado.ok === true,
  autorizacao: resultado.autorizacao || null,
  ledgerPath,
  gateProcess: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  instrucao: 'Dentro de 30 min: no PDV oficial, venda R$ 1,00 débito COM4 — uma única operação. Sem retry se UNKNOWN.',
  ledgerAntesPreview: antes
    ? JSON.parse(antes).autorizacoes.map((a) => ({ id: a.authorizationId, status: a.status }))
    : [],
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
