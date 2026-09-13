/**
 * RC14.14.1 — Consolidação da camada de conexão oficial
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  PORTA_PADRAO,
  LIMITS
} = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');
const ToledoTimeouts = require('../../backend/motores/equipamentos/drivers/toledo/ToledoTimeouts');
const { auditar } = require('../../backend/motores/equipamentos/connection/ConnectionAudit');
const { montarEtapasConexao } = require('../../backend/motores/equipamentos/connection/ConnectionStages');
const connectionManager = require('../../backend/motores/equipamentos/connection/ConnectionManager');
const EthernetTransportLegado = require('../../backend/motores/equipamentos/transport/EthernetTransport');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('RC14.14.1 — Porta única', () => {
  it('PORTA_PADRAO = 9000', () => {
    assert.equal(PORTA_PADRAO, 9000);
  });

  it('cadastro ERP e repository não usam default 9100', () => {
    const front = read('frontend/erp/js/equipamentos.js');
    assert.match(front, /porta_tcp \|\| 9000|:\s*9000/);
    assert.doesNotMatch(front, /\|\| 9100/);
    const repo = read('backend/motores/equipamentos/repositories/EquipamentosRepository.js');
    assert.match(repo, /PORTA_PADRAO/);
    assert.doesNotMatch(repo, /\?\? 9100/);
  });
});

describe('RC14.14.1 — Timeout único', () => {
  it('ToledoTimeouts 5000 em CONNECT/HANDSHAKE/READ/WRITE', () => {
    assert.equal(ToledoTimeouts.CONNECT, 5000);
    assert.equal(ToledoTimeouts.HANDSHAKE, 5000);
    assert.equal(ToledoTimeouts.READ, 5000);
    assert.equal(ToledoTimeouts.WRITE, 5000);
    assert.equal(LIMITS.connectTimeoutMs, 5000);
    assert.equal(LIMITS.handshakeTimeoutMs, 5000);
  });
});

describe('RC14.14.1 — ConnectionManager único / socket', () => {
  it('transport legado não abre net.createConnection em produção', () => {
    const src = read('backend/motores/equipamentos/transport/EthernetTransport.js');
    assert.match(src, /CDS_LEGACY_TRANSPORT_SOCKET/);
    assert.match(src, /connection\/ConnectionManager/);
    assert.match(src, /delegad/);
  });

  it('CM oficial expõe connect/reconnect/isConnected', () => {
    assert.equal(typeof connectionManager.connect, 'function');
    assert.equal(typeof connectionManager.reconnect, 'function');
    assert.equal(typeof connectionManager.isConnected, 'function');
    assert.equal(typeof connectionManager.getTcp, 'function');
  });

  it('CONNECTED_ALREADY no pool', () => {
    const src = read('backend/motores/equipamentos/connection/ConnectionManager.js');
    assert.match(src, /CONNECTED_ALREADY/);
  });
});

describe('RC14.14.1 — Reconnect completo', () => {
  it('Driver e rotas com reconnect + handshake', () => {
    const driver = read('backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js');
    assert.match(driver, /async reconnect/);
    assert.match(driver, /handshake/);
    const ctrl = read('backend/motores/equipamentos/drivers/toledo/ToledoDriverController.js');
    assert.match(ctrl, /function reconnect/);
    const rotas = read('backend/rotas/equipamentos.js');
    assert.match(rotas, /driver\/toledo\/reconnect/);
    const connCtrl = read('backend/motores/equipamentos/connection/ConnectionController.js');
    assert.match(connCtrl, /getOrCreateDriver/);
    assert.match(connCtrl, /driver\.reconnect/);
  });
});

describe('RC14.14.1 — Diagnóstico por etapas', () => {
  it('montarEtapasConexao', () => {
    const ok = montarEtapasConexao({
      tcp: true, handshake: true, health: true, driver: true
    });
    assert.equal(ok.sucesso, true);
    assert.equal(ok.etapaFalha, null);

    const fail = montarEtapasConexao({
      tcp: true, handshake: false, handshakeErro: 'timeout', health: false, driver: true
    });
    assert.equal(fail.sucesso, false);
    assert.equal(fail.etapaFalha, 'HANDSHAKE');
  });

  it('diagnostics inclui etapas_conexao', () => {
    const src = read('backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js');
    assert.match(src, /etapas_conexao/);
    assert.match(src, /montarEtapasConexao/);
  });
});

describe('RC14.14.1 — APIs usam CM oficial', () => {
  it('EquipamentosService usa connection/ConnectionManager', () => {
    const src = read('backend/motores/equipamentos/services/EquipamentosService.js');
    assert.match(src, /connection\/ConnectionManager/);
    assert.doesNotMatch(src, /transport\/ConnectionManager/);
    assert.doesNotMatch(src, /new EthernetTransport/);
  });

  it('monitor ConnectionMonitor usa CM oficial', () => {
    const src = read('backend/motores/equipamentos/monitor/ConnectionMonitor.js');
    assert.match(src, /connection\/ConnectionManager/);
  });
});

describe('RC14.14.1 — ConnectionAudit', () => {
  it('auditoria estrutural passa', () => {
    const r = auditar();
    assert.equal(r.portaOficial, true);
    assert.equal(r.timeoutsUnificados, true);
    assert.equal(r.cmOficialExiste, true);
    assert.equal(r.hardcoded9100.length, 0, `ainda há 9100 em: ${r.hardcoded9100.join(', ')}`);
    assert.equal(r.ok, true);
  });
});

describe('RC14.14.1 — Transport legado instancia sem abrir socket', () => {
  it('EthernetTransport default porta = PORTA_PADRAO', () => {
    const t = new EthernetTransportLegado({ host: '127.0.0.1' });
    assert.equal(t.porta, PORTA_PADRAO);
  });
});
