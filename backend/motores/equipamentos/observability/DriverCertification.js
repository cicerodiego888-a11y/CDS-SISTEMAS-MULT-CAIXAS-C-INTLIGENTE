/**
 * Sprint 15.8 — DriverCertification (itens padronizados)
 */

'use strict';

const ITENS = Object.freeze([
  { id: 'discovery', label: 'Discovery', peso: 10 },
  { id: 'connection', label: 'Connection', peso: 15 },
  { id: 'protocol', label: 'Protocol', peso: 15 },
  { id: 'identification', label: 'Identification', peso: 10 },
  { id: 'diagnostics', label: 'Diagnostics', peso: 10 },
  { id: 'synchronization', label: 'Synchronization', peso: 15 },
  { id: 'scheduler', label: 'Scheduler', peso: 5 },
  { id: 'telemetry', label: 'Telemetry', peso: 5 },
  { id: 'rollback', label: 'Rollback', peso: 5 },
  { id: 'sdk', label: 'SDK Profile', peso: 10 }
]);

/**
 * @param {Object} evidencias - mapa id → true | false | { ok, note? }
 */
function avaliarItens(evidencias = {}) {
  const itens = ITENS.map((item) => {
    const ev = evidencias[item.id];
    let status = 'PENDENTE';
    let note = null;
    if (ev === true) status = 'OK';
    else if (ev === false) status = 'FAIL';
    else if (ev && typeof ev === 'object') {
      status = ev.ok === true ? 'OK' : (ev.ok === false ? 'FAIL' : 'PENDENTE');
      note = ev.note || null;
    }
    return { ...item, status, note };
  });

  const ok = itens.filter((i) => i.status === 'OK').length;
  const fail = itens.filter((i) => i.status === 'FAIL').length;
  const pendente = itens.filter((i) => i.status === 'PENDENTE').length;
  const pesoTotal = itens.reduce((a, i) => a + i.peso, 0);
  const pesoOk = itens.filter((i) => i.status === 'OK').reduce((a, i) => a + i.peso, 0);
  const nota = pesoTotal ? Number(((pesoOk / pesoTotal) * 100).toFixed(1)) : 0;

  let resultado = 'REPROVADO';
  if (fail === 0 && pendente === 0 && ok === itens.length) resultado = 'APROVADO';
  else if (fail === 0 && nota >= 70) resultado = 'APROVADO_COM_RESSALVAS';
  else if (nota >= 50) resultado = 'CONDICIONAL';

  return {
    itens,
    resumo: { total: itens.length, ok, fail, pendente, nota, resultado }
  };
}

module.exports = {
  ITENS,
  avaliarItens
};
