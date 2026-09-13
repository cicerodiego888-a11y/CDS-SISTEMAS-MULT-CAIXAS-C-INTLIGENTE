'use strict';

module.exports = {
  codigo: 'BEMATECH_BP5',
  fabricante: 'Bematech',
  modelo: 'BP5',
  versao: '2.0.0-oficial',
  transportes: ['serial'],
  protocolos: ['bematech-bp5'],
  firmware_conhecido: ['BP5-1.8', 'BP5-2.0', 'BP5-2.1'],
  firmware_padrao: 'BP5-2.0',
  keywords: ['bematech', 'bp5'],
  handshake: {
    passos: ['abrir_serial', 'cmd_ENQ', 'ack', 'ler_firmware', 'ler_serie', 'capacidades'],
    timeout_ms: 3200
  },
  heartbeat: { intervalo_ms: 55000, timeout_ms: 2400, tipo_teste: 'PING_LOGICO' },
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
      { chave: 'enq_sem_ack', penalidade: 22 },
      { chave: 'plu_duplicado', penalidade: 8 }
    ]
  },
  comandos_diagnostico: [
    { codigo: 'ENQ', descricao: 'Enquiry / presença' },
    { codigo: 'STAT', descricao: 'Status BP5' },
    { codigo: 'CLR', descricao: 'Limpar buffer' }
  ],
  diagnosticos: [
    {
      codigo: 'OFFLINE',
      alerta: 'Bematech BP5 offline',
      problema: 'ENQ sem ACK',
      solucao: 'Verificar cabo e configuração serial',
      recomendacao: 'Executar comando STAT',
      severidade: 'erro'
    },
    {
      codigo: 'BUFFER',
      alerta: 'Buffer saturado',
      problema: 'Fila interna cheia',
      solucao: 'Enviar CLR e reduzir lote',
      recomendacao: 'Sincronizar PLUs em blocos de 50',
      severidade: 'aviso'
    }
  ],
  configSchema: {
    versao: '1.0',
    campos: [
      { chave: 'baud_rate', tipo: 'number', padrao: 9600 },
      { chave: 'timeout_ms', tipo: 'number', padrao: 3200 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' },
      { chave: 'lote_max', tipo: 'number', padrao: 50 }
    ]
  }
};
