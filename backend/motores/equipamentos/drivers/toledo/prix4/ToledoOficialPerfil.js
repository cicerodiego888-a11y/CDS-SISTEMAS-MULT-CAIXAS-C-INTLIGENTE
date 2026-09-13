'use strict';

/**
 * Perfil oficial Toledo Prix 4 — inteligência RC4.0 (dentro do driver).
 */

const { FIRMWARE_CONHECIDO, TIMEOUTS } = require('./ToledoPrix4Constants');

module.exports = {
  codigo: 'TOLEDO_PRIX4_UNO',
  fabricante: 'Toledo',
  modelo: 'Prix 4 Uno',
  versao: '2.0.0-oficial',
  transportes: ['ethernet'],
  protocolos: ['toledo-prix4', 'ethernet-tcp'],
  firmware_conhecido: [...FIRMWARE_CONHECIDO, '90BX'],
  firmware_padrao: '90AX',
  handshake: {
    passos: ['tcp_connect', 'HS', 'ler_firmware', 'ler_serie', 'capacidades', 'ack'],
    timeout_ms: TIMEOUTS.handshake || 5000
  },
  heartbeat: {
    intervalo_ms: TIMEOUTS.heartbeat || 30000,
    timeout_ms: TIMEOUTS.ping || 2000,
    tipo_teste: 'TCP_CONNECT'
  },
  sync: {
    produtos: true,
    plu: true,
    departamentos: true,
    configuracoes: true,
    promocoes: true,
    etiquetas: true
  },
  health: {
    fatores: [
      { chave: 'latencia', penalidade: 15 },
      { chave: 'erro_protocolo', penalidade: 20 },
      { chave: 'fila', penalidade: 10 },
      { chave: 'timeout', penalidade: 15 },
      { chave: 'firmware_incompativel', penalidade: 30 }
    ]
  },
  comandos_diagnostico: [
    { codigo: 'HS', descricao: 'Handshake Toledo' },
    { codigo: 'PN', descricao: 'Ping lógico' },
    { codigo: 'ST', descricao: 'Status' },
    { codigo: 'RS', descricao: 'Receber status estendido' }
  ],
  diagnosticos: [
    {
      codigo: 'OFFLINE',
      alerta: 'Toledo sem comunicação TCP',
      problema: 'Host/porta inacessíveis',
      solucao: 'Validar IP, porta 9000 e firewall',
      recomendacao: 'Rodar discovery Ethernet e teste de conexão',
      severidade: 'erro'
    },
    {
      codigo: 'FIRMWARE',
      alerta: 'Firmware Toledo incompatível',
      problema: 'Firmware fora da lista homologada (90AX)',
      solucao: 'Atualizar firmware ou homologar nova versão',
      recomendacao: 'Consultar laboratório CDS',
      severidade: 'erro'
    },
    {
      codigo: 'PROTOCOLO',
      alerta: 'Erro de protocolo Toledo',
      problema: 'Frame/HS inválido',
      solucao: 'Reenviar handshake e verificar cabo/rede',
      recomendacao: 'Capturar pacotes no laboratório',
      severidade: 'aviso'
    },
    {
      codigo: 'FILA',
      alerta: 'Fila de sync elevada',
      problema: 'Muitos PLUs pendentes',
      solucao: 'Reduzir lote e reprocessar fila',
      recomendacao: 'Monitorar latência e timeouts',
      severidade: 'aviso'
    },
    {
      codigo: 'TIMEOUT',
      alerta: 'Timeout de comando',
      problema: 'Resposta excedeu limite',
      solucao: 'Aumentar timeout e verificar rede',
      recomendacao: 'Usar heartbeat Toledo',
      severidade: 'aviso'
    }
  ],
  configSchema: {
    versao: '1.0',
    campos: [
      { chave: 'host', tipo: 'string', padrao: '' },
      { chave: 'porta_tcp', tipo: 'number', padrao: 9000 },
      { chave: 'timeout_ms', tipo: 'number', padrao: 5000 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' },
      { chave: 'firmware_esperado', tipo: 'string', padrao: '90AX' }
    ]
  }
};
