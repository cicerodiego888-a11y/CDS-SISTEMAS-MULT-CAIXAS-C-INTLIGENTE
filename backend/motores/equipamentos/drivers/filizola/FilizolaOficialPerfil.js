'use strict';

/**
 * Perfil oficial Filizola Platina — RC4.0
 */

module.exports = {
  codigo: 'FILIZOLA_PLATINA',
  fabricante: 'Filizola',
  modelo: 'Platina',
  versao: '2.0.0-oficial',
  transportes: ['serial', 'ethernet'],
  protocolos: ['filizola-platina'],
  firmware_conhecido: ['FPL-2.1', 'FPL-2.2', 'FPL-3.0'],
  firmware_padrao: 'FPL-2.2',
  keywords: ['filizola', 'platina'],
  handshake: {
    passos: ['abrir_porta', 'cmd_ID', 'ler_modelo', 'ler_firmware', 'ler_serie', 'ack'],
    timeout_ms: 3500
  },
  heartbeat: { intervalo_ms: 45000, timeout_ms: 2500, tipo_teste: 'HANDSHAKE' },
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
      { chave: 'erro_checksum', penalidade: 15 },
      { chave: 'porta_ocupada', penalidade: 20 }
    ]
  },
  comandos_diagnostico: [
    { codigo: 'ID', descricao: 'Identificação do equipamento' },
    { codigo: 'ST', descricao: 'Status operacional' },
    { codigo: 'FW', descricao: 'Consulta firmware' },
    { codigo: 'SN', descricao: 'Número de série' }
  ],
  diagnosticos: [
    {
      codigo: 'OFFLINE',
      alerta: 'Filizola sem comunicação',
      problema: 'Porta serial/Ethernet inacessível',
      solucao: 'Verificar cabo, porta COM e IP',
      recomendacao: 'Testar handshake e reiniciar a balança',
      severidade: 'erro'
    },
    {
      codigo: 'FW_DESATUALIZADO',
      alerta: 'Firmware fora da lista conhecida',
      problema: 'Firmware incompatível com o driver oficial',
      solucao: 'Atualizar firmware Filizola para FPL-2.x/3.0',
      recomendacao: 'Homologar nova versão no laboratório',
      severidade: 'aviso'
    },
    {
      codigo: 'FILA_ALTA',
      alerta: 'Fila de sincronização elevada',
      problema: 'PLUs acumulando sem confirmação',
      solucao: 'Reduzir lote e reenviar',
      recomendacao: 'Monitorar heartbeat e timeouts',
      severidade: 'aviso'
    }
  ],
  configSchema: {
    versao: '1.0',
    campos: [
      { chave: 'baud_rate', tipo: 'number', padrao: 9600 },
      { chave: 'timeout_ms', tipo: 'number', padrao: 3500 },
      { chave: 'porta_tcp', tipo: 'number', padrao: 9100 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' },
      { chave: 'eco_serial', tipo: 'boolean', padrao: false }
    ]
  }
};
