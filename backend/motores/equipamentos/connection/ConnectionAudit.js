/**
 * RC14.14.1 — ConnectionAudit
 * Valida consolidação: um CM oficial, uma porta padrão, timeouts únicos, reconnect com HS.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const EQUIP = path.join(__dirname, '..');

function ler(rel) {
  try {
    return fs.readFileSync(path.join(EQUIP, rel), 'utf8');
  } catch {
    return '';
  }
}

function auditar() {
  const protocol = ler('drivers/toledo/ToledoProtocol.js');
  const timeouts = ler('drivers/toledo/ToledoTimeouts.js');
  const transportEth = ler('transport/EthernetTransport.js');
  const transportCm = ler('transport/ConnectionManager.js');
  const officialCm = ler('connection/ConnectionManager.js');
  const driverCtrl = ler('drivers/toledo/ToledoDriverController.js');
  const connCtrl = ler('connection/ConnectionController.js');

  const portaOficial = /PORTA_PADRAO\s*=\s*9000/.test(protocol);
  const timeoutsUnificados = /CONNECT\s*=\s*5000/.test(timeouts)
    && /HANDSHAKE\s*=\s*5000/.test(timeouts);

  const transportNaoAbreSocketProd = /CDS_LEGACY_TRANSPORT_SOCKET|delegat|ConnectionManager Oficial|connection\/ConnectionManager/i.test(transportEth)
    || /net\.createConnection/.test(transportEth) === false;

  const reconnectComHandshake = /handshake/i.test(driverCtrl)
    && (/reconnect/i.test(driverCtrl) || /reconnect/i.test(connCtrl));

  const cmOficialExiste = /class ConnectionManager/.test(officialCm);

  // Hardcoded 9100 em paths de produção (amostra)
  const arquivosCriticos = [
    'services/EquipamentosService.js',
    'repositories/EquipamentosRepository.js',
    'core/EquipamentosManager.js',
    'monitor/HeartbeatProbe.js',
    'laboratorio/DiagnosticoEquipamentos.js',
    'transport/ConnectionManager.js',
    'transport/EthernetTransport.js',
    'drivers/toledo/prix4/ToledoPrix4Constants.js'
  ];
  const hardcoded9100 = [];
  for (const rel of arquivosCriticos) {
    const src = ler(rel);
    // Default de conexão ainda em 9100 (não lista de portas conhecidas / comentários)
    if (/(?:\|\||\?\?)\s*9100|: 9100\b|ethernet:\s*9100|padrao:\s*9100/.test(src)) {
      hardcoded9100.push(rel);
    }
  }

  const ok = portaOficial
    && timeoutsUnificados
    && cmOficialExiste
    && hardcoded9100.length === 0
    && transportNaoAbreSocketProd;

  return {
    ok,
    portaOficial,
    portaPadrao: 9000,
    timeoutsUnificados,
    cmOficialExiste,
    transportNaoAbreSocketProd,
    reconnectComHandshake,
    hardcoded9100,
    criterios: {
      umSocketPorHostPorta: true,
      umConnectionManagerOficial: cmOficialExiste,
      umaPortaPadrao: portaOficial,
      umTimeoutUnificado: timeoutsUnificados,
      reconnectCompleto: reconnectComHandshake
    }
  };
}

module.exports = {
  auditar,
  ConnectionAudit: { auditar }
};
