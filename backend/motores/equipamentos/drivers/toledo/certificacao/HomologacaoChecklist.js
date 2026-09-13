/**
 * Sprint 14.12 — Checklist de homologação V2.0
 */

'use strict';

const CHECKLIST = Object.freeze([
  { id: 'discovery', item: 'Descoberta', sprint: '14.1' },
  { id: 'fingerprint', item: 'Identificação', sprint: '14.2' },
  { id: 'connection', item: 'Conexão', sprint: '14.3' },
  { id: 'handshake', item: 'Handshake', sprint: '14.4/14.6' },
  { id: 'ping', item: 'Ping', sprint: '14.4/14.6' },
  { id: 'plu_upload', item: 'Upload PLUs', sprint: '14.7' },
  { id: 'plu_download', item: 'Download PLUs', sprint: '14.8' },
  { id: 'sync', item: 'Sincronização', sprint: '14.8' },
  { id: 'weight', item: 'Leitura de Peso', sprint: '14.9' },
  { id: 'config', item: 'Configuração', sprint: '14.11' },
  { id: 'monitor', item: 'Monitor', sprint: '14.10' },
  { id: 'lab', item: 'Laboratório', sprint: '14.5' },
  { id: 'logs', item: 'Logs', sprint: '14.x' },
  { id: 'auditoria', item: 'Auditoria', sprint: '14.12' },
  { id: 'apis', item: 'APIs', sprint: '14.x' },
  { id: 'frontend', item: 'Front-end', sprint: '14.x' },
  { id: 'persistencia', item: 'Persistência', sprint: '14.x' },
  { id: 'testes', item: 'Testes', sprint: '14.12' }
]);

/**
 * @param {Record<string, boolean|{ok:boolean, note?:string}>} evidencias
 */
function avaliarChecklist(evidencias = {}) {
  const itens = CHECKLIST.map((c) => {
    const ev = evidencias[c.id];
    let status = 'PENDENTE';
    let note = null;
    if (ev === true || (ev && ev.ok === true)) {
      status = 'OK';
      note = ev && ev.note ? ev.note : null;
    } else if (ev === false || (ev && ev.ok === false)) {
      status = 'FAIL';
      note = ev && ev.note ? ev.note : null;
    }
    return { ...c, status, note };
  });
  const ok = itens.filter((i) => i.status === 'OK').length;
  const fail = itens.filter((i) => i.status === 'FAIL').length;
  const pendente = itens.filter((i) => i.status === 'PENDENTE').length;
  return {
    itens,
    resumo: { total: itens.length, ok, fail, pendente },
    homologado: fail === 0 && pendente === 0
  };
}

module.exports = {
  CHECKLIST,
  avaliarChecklist
};
