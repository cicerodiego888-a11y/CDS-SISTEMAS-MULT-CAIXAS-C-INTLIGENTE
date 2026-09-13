const { criarMonitoringResult } = require('../MonitoringResult');

/** Stubs remanescentes M1/M2 — Estoque, Comercial, Alertas. */
function criarStubProvider(id, payloadKey) {
  return {
    id,
    async collect() {
      return criarMonitoringResult({
        success: true,
        source: `${id}Provider`,
        metrics: { tempoConsultaMs: 0, stub: true },
        data: {
          [payloadKey]: {},
          status: 'structured',
          mensagem: 'Provider estruturado — dados em sprint futura do Monitoring Engine.'
        },
        warnings: [`${id}: stub`]
      });
    }
  };
}

module.exports = {
  EstoqueProvider: criarStubProvider('estoque', 'estoque'),
  ComercialProvider: criarStubProvider('comercial', 'comercial'),
  AlertasProvider: criarStubProvider('alertas', 'alertas')
};
