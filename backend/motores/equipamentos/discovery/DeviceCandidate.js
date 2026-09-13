/**
 * Sprint 14.1 — DeviceCandidate
 * Candidato de equipamento ativo na rede (sem fabricante/modelo).
 */

'use strict';

const crypto = require('crypto');

class DeviceCandidate {
  /**
   * @param {{host:string, porta:number, transporte?:string, status?:string, latencia?:number|null, descobertaEm?:string, id?:string}} dados
   */
  constructor(dados = {}) {
    this.id = dados.id || DeviceCandidate.gerarId(dados.host, dados.porta);
    this.host = String(dados.host || '');
    this.porta = Number(dados.porta) || 0;
    this.transporte = dados.transporte || 'TCP';
    this.status = dados.status || 'ONLINE';
    this.latencia = dados.latencia != null ? Number(dados.latencia) : null;
    this.descobertaEm = dados.descobertaEm || new Date().toISOString();
  }

  static gerarId(host, porta) {
    const base = `${host}:${porta}`;
    return crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
  }

  /**
   * Formato da API Sprint 14.1.
   */
  paraApi() {
    return {
      id: this.id,
      host: this.host,
      porta: this.porta,
      transporte: this.transporte,
      status: this.status,
      latencia: this.latencia,
      descobertaEm: this.descobertaEm
    };
  }

  /**
   * Resposta enxuta do endpoint.
   */
  paraLista() {
    return {
      host: this.host,
      porta: this.porta,
      status: this.status,
      latencia: this.latencia
    };
  }
}

module.exports = DeviceCandidate;
module.exports.DeviceCandidate = DeviceCandidate;
