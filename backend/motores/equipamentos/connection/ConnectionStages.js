/**
 * RC14.14.1 / RC15.0.1 / RC14.14.5 — Etapas de conexão (diagnóstico)
 * Cada etapa é independente: TCP ≠ Handshake ≠ Health ≠ Driver.
 * Quando o diagnóstico foi solicitado, nunca deixar etapa em "Não iniciado".
 */

'use strict';

const {
  TCP_CONNECT_STATUS,
  HANDSHAKE_STATUS,
  rotuloTcp,
  rotuloHandshake
} = require('./TcpConnectStatus');

const ETAPAS = Object.freeze({
  TCP_CONNECT: 'TCP_CONNECT',
  HANDSHAKE: 'HANDSHAKE',
  HEALTH: 'HEALTH',
  DRIVER: 'DRIVER',
  READ: 'READ'
});

/**
 * @param {boolean|null|undefined} valor — true ok, false falha, null/undefined não executado/iniciado
 * @param {{solicitado?:boolean}} [opts]
 * @returns {'OK'|'FALHA'|'NAO_EXECUTADO'|'NAO_INICIADO'}
 */
function estadoEtapa(valor, opts = {}) {
  if (valor === true) return 'OK';
  if (valor === false) return 'FALHA';
  // RC14.14.5 — diagnóstico solicitado ⇒ "Não executado" (nunca "Não iniciado")
  if (opts.solicitado === true) return 'NAO_EXECUTADO';
  return 'NAO_INICIADO';
}

function rotuloEstado(estado) {
  if (estado === 'OK') return 'OK';
  if (estado === 'FALHA') return 'Falha';
  if (estado === 'NAO_EXECUTADO') return 'Não executado';
  return 'Não iniciado';
}

/**
 * @param {Object} partial
 * @returns {Object}
 */
function montarEtapasConexao(partial = {}) {
  const solicitado = partial.diagnosticoSolicitado === true;
  const tcpCodigo = partial.tcpCodigo
    || (partial.tcp === true
      ? TCP_CONNECT_STATUS.OK
      : (partial.tcp === false
        ? (partial.tcpCodigo || TCP_CONNECT_STATUS.SOCKET_EXCEPTION)
        : TCP_CONNECT_STATUS.NOT_STARTED));

  const hsCodigo = partial.handshakeCodigo
    || (partial.handshake === true
      ? HANDSHAKE_STATUS.OK
      : (partial.handshake === false
        ? (partial.handshakeCodigo || HANDSHAKE_STATUS.ERROR)
        : HANDSHAKE_STATUS.NOT_STARTED));

  const tcpEstado = estadoEtapa(partial.tcp, { solicitado });
  const hsEstado = estadoEtapa(partial.handshake, { solicitado });
  const healthEstado = estadoEtapa(partial.health, { solicitado });
  const driverEstado = estadoEtapa(partial.driver, { solicitado });

  const etapas = [
    {
      id: 1,
      chave: ETAPAS.TCP_CONNECT,
      titulo: 'TCP Connect',
      ok: partial.tcp === true ? true : (partial.tcp === false ? false : null),
      estado: tcpEstado,
      codigo: tcpCodigo,
      rotulo: rotuloTcp(tcpCodigo),
      erro: partial.tcp === false
        ? (partial.tcpErro || rotuloTcp(tcpCodigo))
        : (partial.tcp == null
          ? (solicitado ? 'Não executado' : 'Não iniciado')
          : null),
      latenciaMs: partial.tcpLatenciaMs != null ? partial.tcpLatenciaMs : null
    },
    {
      id: 2,
      chave: ETAPAS.HANDSHAKE,
      titulo: 'Handshake',
      ok: partial.handshake === true ? true : (partial.handshake === false ? false : null),
      estado: hsEstado,
      codigo: hsCodigo,
      rotulo: rotuloHandshake(hsCodigo),
      erro: partial.handshake === false
        ? (partial.handshakeErro || rotuloHandshake(hsCodigo))
        : (partial.handshake == null
          ? (solicitado ? 'Não executado' : 'Não iniciado')
          : null),
      latenciaMs: partial.handshakeLatenciaMs != null ? partial.handshakeLatenciaMs : null
    },
    {
      id: 3,
      chave: ETAPAS.HEALTH,
      titulo: 'Health',
      ok: partial.health === true ? true : (partial.health === false ? false : null),
      estado: healthEstado,
      codigo: partial.health === true ? 'HEALTH_OK' : (partial.health === false ? 'HEALTH_FAIL' : 'HEALTH_NOT_EXECUTED'),
      rotulo: rotuloEstado(healthEstado),
      erro: partial.health === false
        ? (partial.healthErro || 'Health degradado')
        : (partial.health == null
          ? (solicitado ? 'Não executado' : 'Não iniciado')
          : null)
    },
    {
      id: 4,
      chave: ETAPAS.DRIVER,
      titulo: 'Driver',
      ok: partial.driver === true ? true : (partial.driver === false ? false : null),
      estado: driverEstado,
      codigo: partial.driver === true ? 'DRIVER_OK' : (partial.driver === false ? 'DRIVER_FAIL' : 'DRIVER_NOT_EXECUTED'),
      rotulo: rotuloEstado(driverEstado),
      erro: partial.driver === false
        ? (partial.driverErro || 'Driver offline')
        : (partial.driver == null
          ? (solicitado ? 'Não executado' : 'Não iniciado')
          : null)
    }
  ];

  if (partial.incluirRead === true || partial.read != null) {
    const readEstado = estadoEtapa(partial.read, { solicitado });
    etapas.push({
      id: 5,
      chave: ETAPAS.READ,
      titulo: 'Read',
      ok: partial.read === true ? true : (partial.read === false ? false : null),
      estado: readEstado,
      codigo: partial.read === true ? 'READ_OK' : (partial.read === false ? 'READ_FAIL' : 'READ_NOT_EXECUTED'),
      rotulo: rotuloEstado(readEstado),
      erro: partial.read === false
        ? (partial.readErro || 'Falha de leitura')
        : (partial.read == null
          ? (solicitado ? 'Não executado' : 'Não iniciado')
          : null)
    });
  }

  // Primeira falha real (false) — etapas null não contam como falha de pipeline
  const falha = etapas.find((e) => e.ok === false) || null;
  const iniciadas = etapas.filter((e) => e.ok !== null);
  const todasOk = iniciadas.length > 0 && iniciadas.every((e) => e.ok === true);

  return {
    etapas,
    sucesso: todasOk,
    etapaFalha: falha ? falha.chave : null,
    etapaFalhaTitulo: falha ? falha.titulo : null,
    etapaFalhaCodigo: falha ? falha.codigo : null,
    etapaFalhaErro: falha ? falha.erro : null
  };
}

module.exports = {
  ETAPAS,
  montarEtapasConexao,
  estadoEtapa
};
