'use strict';

/**
 * RC12.1 — Inicialização dos adapters de observabilidade.
 * Observe-only; falha de adapter não derruba o boot.
 * @module observabilidade/adapters
 */

function obsLog(evento, extra = {}) {
  console.log(JSON.stringify({
    tag: 'OBS',
    evento,
    ts: new Date().toISOString(),
    ...extra
  }));
}

/**
 * @returns {{ ok: boolean, adapters: object }}
 */
function iniciarAdapters() {
  const resultados = {};

  const lista = [
    ['central', () => require('./centralAdapter').iniciar()],
    ['equipment', () => require('./equipmentAdapter').iniciar()],
    ['fiscalSoap', () => require('./fiscalSoapAdapter').iniciar()],
    ['miip', () => require('./miipAdapter').iniciar()]
  ];

  for (const [nome, fn] of lista) {
    try {
      resultados[nome] = fn();
    } catch (err) {
      resultados[nome] = {
        ok: false,
        reason: err && err.message ? err.message : String(err)
      };
    }
    obsLog('OBS ROUTE', {
      fase: 'adapter_init',
      adapter: nome,
      ok: !!(resultados[nome] && resultados[nome].ok),
      reason: resultados[nome] && resultados[nome].reason ? resultados[nome].reason : null
    });
  }

  return {
    ok: Object.values(resultados).every((r) => r && r.ok),
    adapters: resultados
  };
}

module.exports = {
  iniciarAdapters,
  bootAdapter: require('./bootAdapter'),
  lazyAdapter: require('./lazyAdapter'),
  centralAdapter: require('./centralAdapter'),
  equipmentAdapter: require('./equipmentAdapter'),
  fiscalSoapAdapter: require('./fiscalSoapAdapter'),
  miipAdapter: require('./miipAdapter')
};
