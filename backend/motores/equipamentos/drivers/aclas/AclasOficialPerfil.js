'use strict';

module.exports = {
  codigo: 'ACLAS_LS2',
  fabricante: 'Aclas',
  modelo: 'LS2',
  versao: '2.0.0-oficial',
  transportes: ['serial', 'usb'],
  protocolos: ['aclas-ls2'],
  firmware_conhecido: ['ALS2-1.0', 'ALS2-1.2', 'ALS2-2.0'],
  firmware_padrao: 'ALS2-1.2',
  keywords: ['aclas', 'ls2'],
  vidPids: [
    { vid: '1A86', pid: '7523' },
    { vid: '0403', pid: '6001' }
  ],
  handshake: {
    passos: ['enum_usb', 'abrir_canal', 'cmd_INFO', 'ler_firmware', 'ler_serie', 'capacidades'],
    timeout_ms: 4000
  },
  heartbeat: { intervalo_ms: 50000, timeout_ms: 2500, tipo_teste: 'LEITURA_SIMPLES' },
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
      { chave: 'usb_reconnect', penalidade: 10 },
      { chave: 'vid_pid_desconhecido', penalidade: 8 }
    ]
  },
  comandos_diagnostico: [
    { codigo: 'INFO', descricao: 'Identificação Aclas' },
    { codigo: 'USB', descricao: 'Status USB/VID-PID' },
    { codigo: 'MEM', descricao: 'Memória PLU' }
  ],
  diagnosticos: [
    {
      codigo: 'OFFLINE',
      alerta: 'Aclas LS2 sem comunicação',
      problema: 'USB/Serial não responde',
      solucao: 'Reconectar cabo e validar VID/PID',
      recomendacao: 'Usar conversor homologado',
      severidade: 'erro'
    },
    {
      codigo: 'MEMORIA',
      alerta: 'Memória PLU saturada',
      problema: 'Limite de produtos atingido',
      solucao: 'Remover PLUs antigos',
      recomendacao: 'Sincronizar em lotes menores',
      severidade: 'aviso'
    }
  ],
  configSchema: {
    versao: '1.0',
    campos: [
      { chave: 'baud_rate', tipo: 'number', padrao: 115200 },
      { chave: 'timeout_ms', tipo: 'number', padrao: 4000 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' },
      { chave: 'modo_usb', tipo: 'boolean', padrao: true }
    ]
  }
};
