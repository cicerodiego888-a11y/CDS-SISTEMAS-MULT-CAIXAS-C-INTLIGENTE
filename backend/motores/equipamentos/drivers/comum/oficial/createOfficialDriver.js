'use strict';

/**
 * Factory de Drivers Oficiais RC4.0
 * Extende BaseDriver sem alterar o Framework.
 * Discovery Serial/USB reutiliza helpers existentes (sem alterar DiscoveryService).
 */

const BaseDriver = require('../../BaseDriver');
const SerialPortDiscovery = require('../../../discovery/SerialPortDiscovery');
const UsbDeviceDiscovery = require('../../../discovery/UsbDeviceDiscovery');
const core = require('./DriverOficialCore');

function createOfficialDriver(perfil) {
  if (!perfil || !perfil.codigo) {
    throw new Error('Perfil oficial inválido: codigo obrigatório');
  }

  class DriverOficialRC4 extends BaseDriver {
    constructor(config = {}) {
      super(config);
      this.modo = 'oficial';
      this._perfil = perfil;
      this._conectado = false;
      this._identidade = core.montarIdentidade(perfil);
      this._configRuntime = { ...this._defaultsConfig() };
      this._configBackup = null;
      this._ultimaLatenciaMs = null;
      this._metricas = {
        latencia_ms: null,
        erro_protocolo: false,
        fila: 0,
        timeout: false,
        firmware_incompativel: false,
        desconectado: true
      };

      this.serialDiscovery = new SerialPortDiscovery({
        driver_codigo: perfil.codigo,
        fabricante: perfil.fabricante,
        modelo: perfil.modelo,
        keywords: perfil.keywords || [],
        vidPids: perfil.vidPids || [],
        aceitarGenerico: false,
        protocolo: (perfil.protocolos || [])[0] || null
      });
      this.usbDiscovery = new UsbDeviceDiscovery({
        driver_codigo: perfil.codigo,
        fabricante: perfil.fabricante,
        modelo: perfil.modelo,
        keywords: perfil.keywords || [],
        vidPids: perfil.vidPids || [],
        aceitarGenerico: false,
        protocolo: (perfil.protocolos || [])[0] || null
      });
    }

    _defaultsConfig() {
      const schema = core.schemaConfigPadrao(perfil);
      const out = {};
      for (const c of schema.campos) out[c.chave] = c.padrao;
      return out;
    }

    _baseResultado(metodo, extras = {}) {
      return {
        sucesso: extras.sucesso !== false,
        simulado: extras.simulado !== false,
        comunicacao_real: extras.comunicacao_real === true,
        oficial: true,
        metodo,
        driver: this.informacoes(),
        timestamp: core.agora(),
        ...extras
      };
    }

    fabricante() { return perfil.fabricante; }
    modelo() { return perfil.modelo; }
    versao() { return perfil.versao || '2.0.0-oficial'; }

    transportesSuportados() {
      return [...(perfil.transportes || ['serial'])];
    }

    informacoes() {
      return {
        codigo: perfil.codigo,
        fabricante: this.fabricante(),
        modelo: this.modelo(),
        versao: this.versao(),
        modo: this.modo,
        oficial: true,
        transportes: this.transportesSuportados(),
        protocolos: [...(perfil.protocolos || [])],
        firmware_conhecido: [...(perfil.firmware_conhecido || [])],
        capacidades: core.montarCapacidades(perfil),
        identidade: { ...this._identidade },
        heartbeat: this.heartbeatPerfil(),
        conectado: this._conectado
      };
    }

    /** Perfil opcional consumido pelo Heartbeat (sem alterar Heartbeat). */
    heartbeatPerfil() {
      return {
        intervalo_ms: perfil.heartbeat?.intervalo_ms || 30000,
        timeout_ms: perfil.heartbeat?.timeout_ms || 3000,
        tipo_teste: perfil.heartbeat?.tipo_teste || 'HANDSHAKE'
      };
    }

    async handshake() {
      const passos = [...(perfil.handshake?.passos || [
        'abrir_canal', 'identificar', 'ler_firmware', 'confirmar'
      ])];
      const evidencias = [];
      for (const passo of passos) {
        evidencias.push({
          passo,
          ok: true,
          em: core.agora()
        });
      }

      this._identidade = core.montarIdentidade(perfil, {
        numero_serie: this._identidade.numero_serie
          || `SIM-${perfil.codigo}-${Date.now().toString(36).toUpperCase()}`,
        firmware: this._identidade.firmware || (perfil.firmware_conhecido || [])[0] || null,
        handshake_em: core.agora()
      });

      this._conectado = true;
      this._metricas.desconectado = false;

      return this._baseResultado('handshake', {
        simulado: true,
        comunicacao_real: false,
        passos,
        evidencias,
        identidade: this._identidade,
        timeout_ms: perfil.handshake?.timeout_ms || 3000
      });
    }

    async identificar() {
      if (!this._identidade.numero_serie) {
        await this.handshake();
      }
      return this._baseResultado('identificar', {
        identidade: {
          ...this._identidade,
          numero_serie: this._identidade.numero_serie,
          firmware: this._identidade.firmware,
          modelo: this._identidade.modelo,
          versao: this.versao()
        }
      });
    }

    contribuirHealth(metricas = {}) {
      this._metricas = { ...this._metricas, ...metricas };
      if (metricas.latencia_ms != null) this._ultimaLatenciaMs = metricas.latencia_ms;
      return core.calcularHealthDriver(perfil, this._metricas);
    }

    healthScore(metricas = {}) {
      return this.contribuirHealth(metricas);
    }

    async conectar(cfg = {}) {
      if (cfg && Object.keys(cfg).length) {
        this.config = { ...this.config, ...cfg };
      }
      const hs = await this.handshake();
      return this._baseResultado('conectar', {
        handshake: hs,
        online: true
      });
    }

    async desconectar() {
      this._conectado = false;
      this._metricas.desconectado = true;
      return this._baseResultado('desconectar', { online: false });
    }

    async configurar(cfg = {}) {
      return this.aplicarConfiguracao(cfg);
    }

    async status() {
      const health = this.contribuirHealth({
        desconectado: !this._conectado,
        latencia_ms: this._ultimaLatenciaMs
      });
      return this._baseResultado('status', {
        online: this._conectado,
        identidade: this._identidade,
        health,
        latencia_ms: this._ultimaLatenciaMs,
        config: { ...this._configRuntime }
      });
    }

    async diagnostico() {
      const health = this.contribuirHealth({
        desconectado: !this._conectado,
        firmware_incompativel: this._metricas.firmware_incompativel
      });
      const diag = core.montarDiagnostico(perfil, {
        simulado: true,
        comunicacao_real: false,
        identidade: this._identidade,
        health,
        componentes: {
          discovery: true,
          handshake: true,
          diagnostico: true,
          monitoramento: true,
          sincronizacao: true,
          configuracao: true
        },
        ativos: this._conectado ? {} : { OFFLINE: true }
      });
      return this._baseResultado('diagnostico', {
        ...diag,
        comandos: (perfil.comandos_diagnostico || []).map((c) => ({
          codigo: c.codigo || c,
          descricao: c.descricao || String(c)
        }))
      });
    }

    async lerConfiguracao() {
      const schema = core.schemaConfigPadrao(perfil);
      return this._baseResultado('lerConfiguracao', {
        configuracao: { ...this._configRuntime },
        schema
      });
    }

    async compararConfiguracao(desejada = {}) {
      const cmp = core.compararConfig(this._configRuntime, desejada);
      return this._baseResultado('compararConfiguracao', cmp);
    }

    async aplicarConfiguracao(cfg = {}) {
      this._configRuntime = { ...this._configRuntime, ...(cfg || {}) };
      this.config = { ...this.config, ...this._configRuntime };
      return this._baseResultado('aplicarConfiguracao', {
        configuracao: { ...this._configRuntime }
      });
    }

    async backupConfiguracao() {
      this._configBackup = {
        em: core.agora(),
        configuracao: { ...this._configRuntime }
      };
      return this._baseResultado('backupConfiguracao', { backup: this._configBackup });
    }

    async restaurarConfiguracao(backup = null) {
      const fonte = backup?.configuracao || this._configBackup?.configuracao;
      if (!fonte) {
        return this._baseResultado('restaurarConfiguracao', {
          sucesso: false,
          mensagem: 'Nenhum backup disponível'
        });
      }
      this._configRuntime = { ...fonte };
      return this._baseResultado('restaurarConfiguracao', {
        configuracao: { ...this._configRuntime }
      });
    }

    async sincronizarProduto(produto) {
      const plu = core.mapearProdutoPlu(produto, perfil);
      return this._baseResultado('sincronizarProduto', {
        plu,
        tipo: 'produto'
      });
    }

    async sincronizarProdutos(produtos = []) {
      const lista = Array.isArray(produtos) ? produtos : [];
      const mapeados = lista.map((p) => core.mapearProdutoPlu(p, perfil));
      return this._baseResultado('sincronizarProdutos', {
        quantidade: lista.length,
        plus: mapeados,
        tipo: 'produtos'
      });
    }

    async sincronizarPromocao(promocao) {
      return this._baseResultado('sincronizarPromocao', {
        promocao: promocao || {},
        tipo: 'promocao'
      });
    }

    async sincronizarDepartamento(departamento) {
      return this._baseResultado('sincronizarDepartamento', {
        departamento: departamento || {},
        tipo: 'departamento'
      });
    }

    async sincronizarEtiqueta(etiqueta) {
      return this._baseResultado('sincronizarEtiqueta', {
        etiqueta: etiqueta || {},
        tipo: 'etiqueta'
      });
    }

    async sincronizarConfiguracoes(cfg = {}) {
      const aplicado = await this.aplicarConfiguracao(cfg);
      return this._baseResultado('sincronizarConfiguracoes', {
        configuracao: aplicado.configuracao,
        tipo: 'configuracoes'
      });
    }

    async removerProduto(codigo) {
      return this._baseResultado('removerProduto', { codigo, tipo: 'remover_produto' });
    }

    async obterPeso() {
      return this._baseResultado('obterPeso', {
        peso: 0,
        unidade: this._configRuntime.unidade || 'kg',
        estavel: false
      });
    }

    async zerar() {
      return this._baseResultado('zerar', { mensagem: 'Zerar solicitado' });
    }

    async reiniciar() {
      this._conectado = false;
      await this.conectar();
      return this._baseResultado('reiniciar', { online: this._conectado });
    }

    async descobrir(opcoes = {}) {
      const transporte = String(opcoes.transporte || '').toLowerCase();
      const candidatos = [];
      const erros = [];
      let probesTotal = 0;
      let probesOk = 0;

      const acumular = (r) => {
        candidatos.push(...(r.candidatos || []));
        erros.push(...(r.erros || []));
        probesTotal += Number(r.meta?.probes_total || 0);
        probesOk += Number(r.meta?.probes_ok || 0);
      };

      const transports = this.transportesSuportados();
      const podeSerial = transports.includes('serial');
      const podeUsb = transports.includes('usb');
      const podeEth = transports.includes('ethernet');

      if (transporte === 'serial' && podeSerial) {
        acumular(await this.serialDiscovery.descobrir(opcoes));
      } else if (transporte === 'usb' && podeUsb) {
        acumular(await this.usbDiscovery.descobrir(opcoes));
      } else if (transporte === 'ethernet' && podeEth) {
        // Discovery ethernet específico fica no perfil (opcional); sem alterar DiscoveryService.
        if (typeof perfil.descobrirEthernet === 'function') {
          acumular(await perfil.descobrirEthernet(opcoes, this));
        }
      } else if (!transporte) {
        if (podeSerial) acumular(await this.serialDiscovery.descobrir(opcoes));
        if (podeUsb) acumular(await this.usbDiscovery.descobrir(opcoes));
        if (podeEth && typeof perfil.descobrirEthernet === 'function') {
          acumular(await perfil.descobrirEthernet(opcoes, this));
        }
      }

      // Enriquece candidatos com capacidades oficiais
      const caps = core.montarCapacidades(perfil);
      for (const c of candidatos) {
        c.capacidades = { ...(c.capacidades || {}), ...caps, oficial: true };
        c.driver_oficial = true;
      }

      return this._baseResultado('descobrir', {
        simulado: false,
        comunicacao_real: true,
        candidatos,
        erros,
        meta: { probes_total: probesTotal, probes_ok: probesOk }
      });
    }
  }

  Object.defineProperty(DriverOficialRC4, 'name', { value: perfil.codigo });
  return DriverOficialRC4;
}

module.exports = createOfficialDriver;
