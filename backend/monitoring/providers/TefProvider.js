/**
 * TefProvider — estrutura M2 com mock (sem SDK TEF).
 */

const { criarMonitoringResult } = require('../MonitoringResult');

const TefProvider = {
  id: 'tef',

  async collect() {
    return criarMonitoringResult({
      success: true,
      source: 'TefProvider',
      metrics: { tempoConsultaMs: 0, stub: true, sdk: false },
      data: {
        tef: {
          aprovadas: 0,
          negadas: 0,
          pendentes: 0,
          valorAprovado: 0,
          valorNaoFiscal: 0,
          mock: true,
          mensagem: 'Estrutura TEF preparada — integração SDK em sprint futura.'
        }
      },
      warnings: ['tef: mock M2 — sem SDK']
    });
  }
};

module.exports = TefProvider;
