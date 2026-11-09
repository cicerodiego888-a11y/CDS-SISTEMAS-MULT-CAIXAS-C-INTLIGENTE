'use strict';

/**
 * TEF-DESTAXA-51.12 — RUNNER OPERACIONAL DESATIVADO
 *
 * Este arquivo NÃO executa CRT, TX_*, DLL, NativeHost nem consome auth.
 * A versão histórica inequivalente (transactionId sintético + persistenciaConfirmada
 * forjada sem INSERT) está em:
 *   tef-51-10-runner.HISTORICO-INEQ-51.10.js
 *
 * Homologação operacional futura: somente PDV vivo + TefManager.autorizar
 * (INSERT real em tef_transacoes → lastID → preparacaoComPersistencia).
 *
 * Motivo (51.11 COMPROVADA): runner forjou tx-5110-* sem linha em tef_transacoes;
 * TX_CONTINUE bloqueado corretamente; tentativa 51.10 permanece UNKNOWN.
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const MOTIVO = {
  sprint: 'TEF-DESTAXA-51.12',
  status: 'RUNNER_OPERACIONAL_DESATIVADO',
  ok: false,
  classificacao: 'BLOQUEADO',
  mensagem:
    'Runner 51.10 desativado para homologação operacional. '
    + 'Não forja transactionId nem persistenciaConfirmada. '
    + 'Use PDV vivo + TefManager (INSERT real antes de qualquer TX).',
  historicoInequivalente: 'tef-51-10-runner.HISTORICO-INEQ-51.10.js',
  tentativa5110: {
    transactionId: 'tx-5110-2dbbb6922eb64990',
    financialState: 'UNKNOWN',
    preservado: true
  },
  em: new Date().toISOString()
};

function gravarAbort() {
  try {
    fs.writeFileSync(
      path.join(OUT_DIR, 'runner-51-12-desativado.json'),
      `${JSON.stringify(MOTIVO, null, 2)}\n`,
      'utf8'
    );
  } catch (_) { /* best-effort */ }
  try {
    process.stdout.write(`${JSON.stringify({ event: 'runner.desativado.51.12', ...MOTIVO })}\n`);
  } catch (_) { /* ignore */ }
}

function abortar() {
  gravarAbort();
  // Electron ou Node: sair sem carregar adapter/DLL
  try {
    const { app } = require('electron');
    if (app && typeof app.whenReady === 'function') {
      app.whenReady().then(() => {
        gravarAbort();
        app.exit(3);
      }).catch(() => process.exit(3));
      return;
    }
  } catch (_) { /* não é Electron */ }
  process.exit(3);
}

abortar();
