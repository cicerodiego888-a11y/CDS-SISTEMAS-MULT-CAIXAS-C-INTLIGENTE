'use strict';

/**
 * Acesso seguro ao CIP — plugins nunca fazem SQL de negócio.
 */
async function cipAnalyze(db, origem = 'cia-apps') {
  const { obterCip } = require('../../motores/cip');
  return obterCip(db).analyze({ origem, dryRun: true, automacao: false });
}

async function cipInsights(db, origem = 'cia-apps') {
  const { obterCip } = require('../../motores/cip');
  return obterCip(db).insights({ origem, force: true });
}

async function cipForecast(db, origem = 'cia-apps') {
  const { obterCip } = require('../../motores/cip');
  return obterCip(db).forecast({ origem });
}

async function cipRecommend(db, origem = 'cia-apps') {
  const { obterCip } = require('../../motores/cip');
  return obterCip(db).recommendations({ origem });
}

function matchIntent(mensagem, patterns) {
  const t = String(mensagem || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  for (const [intent, regs] of Object.entries(patterns)) {
    for (const r of regs) {
      if (r.test(t)) return intent;
    }
  }
  return 'help';
}

module.exports = {
  cipAnalyze,
  cipInsights,
  cipForecast,
  cipRecommend,
  matchIntent
};
