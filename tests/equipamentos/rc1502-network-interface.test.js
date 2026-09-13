/**
 * RC15.0.2 — Protocolo TCP/IP × Interface física (ETHERNET | WLAN | UNKNOWN)
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  NETWORK_INTERFACE,
  NETWORK_PROTOCOL,
  normalizarInterface,
  rotuloInterface,
  extrairInterfaceDoPayload,
  montarNetwork
} = require('../../backend/motores/equipamentos/drivers/toledo/ToledoNetworkInfo');
const ToledoPrixIVDriver = require('../../backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver');
const { diagnostics } = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics');
const { PARAMETROS_META } = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationProfile');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC15.0.2 — normalizarInterface', () => {
  it('reconhece ETHERNET e WLAN', () => {
    assert.equal(normalizarInterface('ETHERNET'), NETWORK_INTERFACE.ETHERNET);
    assert.equal(normalizarInterface('WLAN'), NETWORK_INTERFACE.WLAN);
    assert.equal(normalizarInterface('Wi-Fi'), NETWORK_INTERFACE.WLAN);
    assert.equal(normalizarInterface('wifi'), NETWORK_INTERFACE.WLAN);
  });

  it('nunca assume ETHERNET para vazio / desconhecido', () => {
    assert.equal(normalizarInterface(null), NETWORK_INTERFACE.UNKNOWN);
    assert.equal(normalizarInterface(undefined), NETWORK_INTERFACE.UNKNOWN);
    assert.equal(normalizarInterface(''), NETWORK_INTERFACE.UNKNOWN);
    assert.equal(normalizarInterface('TCP'), NETWORK_INTERFACE.UNKNOWN);
    assert.equal(normalizarInterface('foobar'), NETWORK_INTERFACE.UNKNOWN);
  });

  it('rótulo UNKNOWN é explícito', () => {
    assert.equal(rotuloInterface(NETWORK_INTERFACE.UNKNOWN), 'Não informado pelo equipamento');
    assert.equal(rotuloInterface(NETWORK_INTERFACE.WLAN), 'WLAN');
    assert.equal(rotuloInterface(NETWORK_INTERFACE.ETHERNET), 'Ethernet');
  });
});

describe('RC15.0.2 — montarNetwork / extrair', () => {
  it('payload INTERFACE WLAN', () => {
    assert.equal(extrairInterfaceDoPayload({ INTERFACE: 'WLAN' }), NETWORK_INTERFACE.WLAN);
    assert.equal(extrairInterfaceDoPayload({ parametros: { INTERFACE: 'ETHERNET' } }), NETWORK_INTERFACE.ETHERNET);
  });

  it('bloco network sem default Ethernet', () => {
    const n = montarNetwork({
      ip: '10.0.0.170',
      port: 9000,
      interface: null
    });
    assert.equal(n.protocol, NETWORK_PROTOCOL.TCP_IP);
    assert.equal(n.interface, NETWORK_INTERFACE.UNKNOWN);
    assert.equal(n.ip, '10.0.0.170');
    assert.equal(n.port, 9000);
    assert.match(n.interface_label, /Não informado/);
    assert.ok(n.mensagem);
  });

  it('WLAN explícito', () => {
    const n = montarNetwork({
      ip: '10.0.0.170',
      port: 9000,
      interface: 'WLAN',
      source: 'equipamento'
    });
    assert.equal(n.protocol, 'TCP/IP');
    assert.equal(n.interface, 'WLAN');
    assert.equal(n.interface_label, 'WLAN');
    assert.equal(n.mensagem, null);
  });
});

describe('RC15.0.2 — getNetworkInterface', () => {
  it('lê interface do cadastro sem assumir cabo', async () => {
    const drv = new ToledoPrixIVDriver({});
    const wlan = await drv.getNetworkInterface({
      equipamento: { ip: '10.0.0.170', porta: 9000, interface_rede: 'WLAN' }
    });
    assert.equal(wlan.interface, 'WLAN');
    assert.equal(wlan.protocol, 'TCP/IP');
    assert.equal(wlan.source, 'cadastro');

    const unknown = await drv.getNetworkInterface({
      equipamento: { ip: '10.0.0.170', porta: 9000, transporte: 'ethernet' }
    });
    assert.equal(unknown.interface, 'UNKNOWN');
    assert.match(unknown.mensagem || '', /Não informado/);
  });
});

describe('RC15.0.2 — diagnostics.network', () => {
  it('expõe network e não usa transport como interface', async () => {
    const d = await diagnostics({
      host: '10.0.0.170',
      porta: 9000,
      probe: false,
      INTERFACE: 'WLAN',
      equipamento: { fabricante: 'Toledo', modelo: 'Prix IV Uno' }
    });
    assert.ok(d.network);
    assert.equal(d.network.protocol, 'TCP/IP');
    assert.equal(d.network.interface, 'WLAN');
    assert.equal(d.network.ip, '10.0.0.170');
    assert.equal(d.network.port, 9000);
    assert.equal(d.transport, undefined);
  });

  it('sem INTERFACE → UNKNOWN (não Ethernet)', async () => {
    const d = await diagnostics({
      host: '10.0.0.170',
      porta: 9000,
      probe: false
    });
    assert.equal(d.network.protocol, 'TCP/IP');
    assert.equal(d.network.interface, 'UNKNOWN');
    assert.notEqual(d.network.interface, 'ETHERNET');
    assert.match(d.network.interface_label, /Não informado/);
  });
});

describe('RC15.0.2 — perfil + painel', () => {
  it('PARAMETROS_META.INTERFACE é somente leitura', () => {
    assert.ok(PARAMETROS_META.INTERFACE);
    assert.deepEqual(PARAMETROS_META.INTERFACE.valores, ['ETHERNET', 'WLAN']);
    assert.equal(PARAMETROS_META.INTERFACE.editavel, false);
    assert.equal(PARAMETROS_META.INTERFACE.padrao, null);
  });

  it('painel exibe Protocolo/Interface e não inferir Ethernet/TCP por IP', () => {
    const src = read('frontend/erp/js/central-equipamentos.js');
    assert.match(src, /id="diagInterface"/);
    assert.match(src, /id="diagProtocoloRede"/);
    assert.match(src, /id="diagInterfaceRede"/);
    assert.match(src, /body\.network/);
    assert.doesNotMatch(src, /eq\.ip \|\| eq\.porta \? 'Ethernet\/TCP'/);
    assert.match(src, /Não informado pelo equipamento/);
  });
});
