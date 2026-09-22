/**
 * Auditoria operacional do SEFAZ Query Gate (em memória + log).
 */
'use strict';

const { AUDIT_MAX } = require('./sefazGateConstants');

class SEFAZQueryAudit {
  constructor(opts = {}) {
    this._max = opts.max != null ? Number(opts.max) : AUDIT_MAX;
    /** @type {Array<object>} */
    this._hist = [];
    this._logger = opts.logger || console;
  }

  registrar(evento) {
    const row = Object.freeze({
      timestamp: new Date().toISOString(),
      request_id: evento.request_id || null,
      cnpj: evento.cnpj || null,
      ambiente: evento.ambiente != null ? evento.ambiente : null,
      tipo: evento.tipo || null,
      origem: evento.origem || null,
      status: evento.status || null,
      cStat: evento.cStat || null,
      xMotivo: evento.xMotivo || null,
      nsu_anterior: evento.nsu_anterior || null,
      nsu_solicitado: evento.nsu_solicitado || null,
      nsu_retorno: evento.nsu_retorno || null,
      tempo_execucao: evento.tempo_execucao != null ? evento.tempo_execucao : null,
      erro_tecnico: evento.erro_tecnico || null,
      motivo: evento.motivo || null
    });
    this._hist.push(row);
    if (this._hist.length > this._max) {
      this._hist.splice(0, this._hist.length - this._max);
    }
    const tag = evento.logTag || '[SEFAZ-GATE]';
    this._logger.log(
      `${tag} request=${row.request_id} cnpj=${row.cnpj} tipo=${row.tipo}`
      + ` status=${row.status} cStat=${row.cStat || '-'} origem=${row.origem}`
      + (row.motivo ? ` reason=${row.motivo}` : '')
    );
    return row;
  }

  listarRecentes(limite = 20) {
    const n = Math.min(Math.max(Number(limite) || 20, 1), this._max);
    return this._hist.slice(-n).reverse();
  }

  ultima() {
    return this._hist.length ? this._hist[this._hist.length - 1] : null;
  }

  _resetForTests() {
    this._hist = [];
  }
}

module.exports = {
  SEFAZQueryAudit,
  queryAuditPadrao: new SEFAZQueryAudit()
};
