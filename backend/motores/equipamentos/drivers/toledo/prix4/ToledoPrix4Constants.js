/**
 * ToledoPrix4Constants — Constantes do driver Toledo Prix 4 Uno.
 *
 * Firmware conhecido: 90AX
 * Comunicação prevista: Ethernet TCP (sem implementação nesta sprint).
 *
 * @module ToledoPrix4Constants
 */

const FABRICANTE = 'Toledo';
const MODELO = 'Prix 4 Uno';
const CODIGO_DRIVER = 'TOLEDO_PRIX4_UNO';
const VERSAO_DRIVER = '0.3.0-tcp';

/** @type {string[]} Firmwares homologados ou conhecidos */
const FIRMWARE_CONHECIDO = ['90AX'];

/** @type {string[]} Identificadores de protocolo */
const PROTOCOLOS = ['toledo-prix4', 'ethernet-tcp'];

/** @type {string[]} Transportes suportados (comunicação real em sprint futura) */
const TRANSPORTES = ['ethernet'];

/** Portas padrão para comunicação Ethernet TCP */
const PORTAS_PADRAO = {
  ethernet: 9000,
  alternativa: 4001
};

/** Timeouts em milissegundos */
const TIMEOUTS = {
  conexao: 5000,
  handshake: 5000,
  ping: 2000,
  heartbeat: 30000,
  comando: 3000,
  receberPeso: 1500,
  discovery: 10000
};

/** Limites de campos conforme protocolo Toledo Prix 4 */
const LIMITES = {
  pluMax: 999999,
  descricaoReduzidaMax: 22,
  departamentoMax: 99,
  precoMaxCasas: 2
};

/** Códigos de comando do protocolo (preparação — sem implementação) */
const COMANDOS = {
  HANDSHAKE: 'HS',
  PING: 'PN',
  STATUS: 'ST',
  ENVIAR_PRODUTO: 'EP',
  ATUALIZAR_PRODUTO: 'UP',
  REMOVER_PRODUTO: 'RP',
  ENVIAR_PROMOCAO: 'PR',
  ENVIAR_DEPARTAMENTO: 'DP',
  ENVIAR_ETIQUETA: 'ET',
  ENVIAR_LOTE: 'LT',
  RECEBER_PESO: 'PW',
  RECEBER_STATUS: 'RS'
};

/** Unidades aceitas pela balança */
const UNIDADES = ['kg', 'g', 'un'];

module.exports = {
  FABRICANTE,
  MODELO,
  CODIGO_DRIVER,
  VERSAO_DRIVER,
  FIRMWARE_CONHECIDO,
  PROTOCOLOS,
  TRANSPORTES,
  PORTAS_PADRAO,
  TIMEOUTS,
  LIMITES,
  COMANDOS,
  UNIDADES
};
