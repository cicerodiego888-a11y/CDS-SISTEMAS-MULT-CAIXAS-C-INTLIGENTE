/**
 * Sprint 15.7 — DeviceProfile: contrato canônico de um Driver Profile.
 */

'use strict';

const { parseManifest } = require('./DriverManifest');
const { temCapability } = require('./DriverCapabilities');

class DeviceProfile {
  /**
   * @param {Object} manifesto
   * @param {Object} [opcoes]
   */
  constructor(manifesto = {}, opcoes = {}) {
    const m = parseManifest(manifesto);
    this.id = m.id;
    this.codigo = m.codigo;
    this.fabricante = m.fabricante;
    this.modelo = m.modelo;
    this.categoria = m.categoria;
    this.protocolo = m.protocolo;
    this.protocolos = m.protocolos;
    this.transportes = m.transportes;
    this.versao = m.versao;
    this.prioridade = m.prioridade;
    this.discovery = m.discovery;
    this.capabilities = m.capabilities;
    this.capabilitiesLista = m.capabilitiesLista;
    this.driverModule = m.driverModule;
    this.nomeExibicao = m.nomeExibicao;
    this.status = m.status;
    this.motorMinimo = m.motorMinimo;
    this.meta = m.meta;

    this.origem = opcoes.origem || 'manifest';
    this.caminho = opcoes.caminho || null;
    this.Classe = opcoes.Classe || null;
    this.validacao = opcoes.validacao || null;
    this.compatibilidade = opcoes.compatibilidade || null;
    this.carregadoEm = opcoes.carregadoEm || new Date().toISOString();
    this.tempoCargaMs = opcoes.tempoCargaMs != null ? opcoes.tempoCargaMs : null;
    this.estado = opcoes.estado || 'registrado';
    this.erros = Array.isArray(opcoes.erros) ? opcoes.erros : [];
    this.equipamentosCount = Number(opcoes.equipamentosCount) || 0;
  }

  static fromManifest(raw, opcoes = {}) {
    return new DeviceProfile(raw, opcoes);
  }

  temCapability(nome) {
    return temCapability(this.capabilities, nome);
  }

  toJSON() {
    return {
      id: this.id,
      codigo: this.codigo,
      fabricante: this.fabricante,
      modelo: this.modelo,
      categoria: this.categoria,
      protocolo: this.protocolo,
      protocolos: this.protocolos,
      transportes: this.transportes,
      versao: this.versao,
      prioridade: this.prioridade,
      discovery: this.discovery,
      capabilities: this.capabilities,
      capabilitiesLista: this.capabilitiesLista,
      driverModule: this.driverModule,
      nomeExibicao: this.nomeExibicao,
      status: this.status,
      motorMinimo: this.motorMinimo,
      meta: this.meta,
      origem: this.origem,
      caminho: this.caminho,
      estado: this.estado,
      erros: this.erros,
      validacao: this.validacao,
      compatibilidade: this.compatibilidade,
      carregadoEm: this.carregadoEm,
      tempoCargaMs: this.tempoCargaMs,
      equipamentosCount: this.equipamentosCount,
      implementado: Boolean(this.Classe),
      registrado: true
    };
  }
}

module.exports = DeviceProfile;
