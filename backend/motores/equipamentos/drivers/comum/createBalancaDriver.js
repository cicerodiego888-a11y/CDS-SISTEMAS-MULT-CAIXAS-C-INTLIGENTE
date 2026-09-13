'use strict';

/**
 * Factory de drivers de balança Serial/USB (RC2).
 * Estende BaseDriver; discovery delegado a SerialPortDiscovery / UsbDeviceDiscovery.
 */

const BaseDriver = require('../BaseDriver');
const SerialPortDiscovery = require('../../discovery/SerialPortDiscovery');
const UsbDeviceDiscovery = require('../../discovery/UsbDeviceDiscovery');

function createBalancaDriver(spec) {
  const {
    codigo,
    fabricante,
    modelo,
    versao = '1.0.0',
    transportes = ['serial'],
    protocolos = [],
    keywords = [],
    vidPids = [],
    aceitarGenerico = false
  } = spec;

  class DriverBalancaRC2 extends BaseDriver {
    constructor(config = {}) {
      super(config);
      this.modo = 'estrutura';
      this._transportes = [...transportes];
      this._spec = {
        driver_codigo: codigo,
        fabricante,
        modelo,
        keywords,
        vidPids,
        aceitarGenerico,
        protocolo: protocolos[0] || null
      };
      this.serialDiscovery = new SerialPortDiscovery(this._spec);
      this.usbDiscovery = new UsbDeviceDiscovery(this._spec);
    }

    fabricante() { return fabricante; }
    modelo() { return modelo; }
    versao() { return versao; }
    transportesSuportados() { return [...this._transportes]; }

    informacoes() {
      return {
        codigo,
        fabricante,
        modelo,
        versao,
        transportes: [...this._transportes],
        protocolos: [...protocolos],
        modo: this.modo
      };
    }

    _stub(metodo, extras = {}) {
      return {
        sucesso: true,
        simulado: true,
        comunicacao_real: false,
        metodo,
        driver: this.informacoes(),
        timestamp: new Date().toISOString(),
        ...extras
      };
    }

    async conectar() { return this._stub('conectar'); }
    async desconectar() { return this._stub('desconectar'); }
    async configurar(cfg) { return this._stub('configurar', { config: cfg || {} }); }
    async status() { return this._stub('status'); }
    async diagnostico() { return this._stub('diagnostico'); }
    async sincronizarProduto() { return this._stub('sincronizarProduto'); }
    async sincronizarProdutos() { return this._stub('sincronizarProdutos'); }
    async sincronizarPromocao() { return this._stub('sincronizarPromocao'); }
    async sincronizarDepartamento() { return this._stub('sincronizarDepartamento'); }
    async sincronizarEtiqueta() { return this._stub('sincronizarEtiqueta'); }
    async removerProduto() { return this._stub('removerProduto'); }
    async obterPeso() { return this._stub('obterPeso'); }
    async zerar() { return this._stub('zerar'); }
    async reiniciar() { return this._stub('reiniciar'); }

    /**
     * DiscoveryService passa opcoes.transporte = 'serial' | 'usb'.
     * @param {Object} [opcoes]
     */
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

      const podeSerial = this._transportes.includes('serial');
      const podeUsb = this._transportes.includes('usb');

      if (transporte === 'serial' && podeSerial) {
        acumular(await this.serialDiscovery.descobrir(opcoes));
      } else if (transporte === 'usb' && podeUsb) {
        acumular(await this.usbDiscovery.descobrir(opcoes));
      } else if (!transporte) {
        if (podeSerial) acumular(await this.serialDiscovery.descobrir(opcoes));
        if (podeUsb) acumular(await this.usbDiscovery.descobrir(opcoes));
      }

      return {
        sucesso: true,
        simulado: false,
        comunicacao_real: true,
        candidatos,
        erros,
        meta: { probes_total: probesTotal, probes_ok: probesOk },
        driver: this.informacoes(),
        metodo: 'descobrir',
        timestamp: new Date().toISOString()
      };
    }
  }

  Object.defineProperty(DriverBalancaRC2, 'name', { value: codigo });
  return DriverBalancaRC2;
}

module.exports = createBalancaDriver;
