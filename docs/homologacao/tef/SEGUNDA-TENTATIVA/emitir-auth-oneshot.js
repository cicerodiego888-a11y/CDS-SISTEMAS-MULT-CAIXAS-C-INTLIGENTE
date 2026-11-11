'use strict';

/**
 * Emissão one-shot — segunda tentativa TEF homologação.
 * NÃO executa CRT. NÃO liga gate global. NÃO reutiliza permit anterior.
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
const issuedAntes = antes
  ? JSON.parse(antes).autorizacoes.filter((a) => a.status === 'ISSUED')
  : [];
if (issuedAntes.length) {
  console.error(JSON.stringify({
    ok: false,
    erro: 'Já existe ISSUED no ledger — não emitir outro sem consumir/expirar',
    issuedAntes
  }, null, 2));
  process.exit(2);
}

const resultado = auth.emitirAutorizacaoExcepcional({
  motivo: 'TEF-SEGUNDA-TENTATIVA-homologacao-debito-r1',
  emitidoPor: 'product-owner-go-verbal-pinpad-presente'
});
const depois = fs.readFileSync(ledgerPath, 'utf8');

const out = {
  ok: resultado.ok === true,
  autorizacao: resultado.autorizacao || null,
  ledgerPath,
  gateProcess: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null,
  instrucao: 'UMA CRT R$1,00 débito COM4 no PDV oficial Electron 5700. Sem retry se UNKNOWN.',
  ledgerDepoisPreview: JSON.parse(depois).autorizacoes.slice(-3).map((a) => ({
    id: a.authorizationId,
    status: a.status,
    valorCentavos: a.valorCentavos,
    expiresAt: a.expiresAt,
    motivo: a.motivo
  }))
};

fs.writeFileSync(path.join(__dirname, 'emissao-autorizacao.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
