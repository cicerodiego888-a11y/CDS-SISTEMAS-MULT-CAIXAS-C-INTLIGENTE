'use strict';

module.exports = {
  codigo: 'ELGEN_BALANCA',
  fabricante: 'Elgin',
  modelo: 'DP30',
  versao: '2.0.0-oficial',
  transportes: ['serial'],
  protocolos: ['elgin-dp30'],
  firmware_conhecido: ['EDP-3.1', 'EDP-3.2', 'EDP-4.0'],
  firmware_padrao: 'EDP-3.2',
  keywords: ['elgin', 'dp30'],
  handshake: {
    passos: ['abrir_serial', 'cmd_INIT', 'ler_modelo', 'ler_firmware', 'ler_serie', 'ok'],
    timeout_ms: 3000
  },
  heartbeat: { intervalo_ms: 40000, timeout_ms: 2200, tipo_teste: 'HANDSHAKE' },
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
      { chave: 'init_falhou', penalidade: 20 },
      { chave: 'etiqueta_invalida', penalidade: 10 }
    ]
  },
  comandos_diagnostico: [
    { codigo: 'INIT', descricao: 'Inicialização Elgin' },
    { codigo: 'CFG', descricao: 'Ler configuração' },
    { codigo: 'DIAG', descricao: 'Autodiagnóstico' }
  ],
  diagnosticos: [
    {
      codigo: 'OFFLINE',
      alerta: 'Elgin DP30 offline',
      problema: 'Sem handshake INIT',
      solucao: 'Conferir porta e energia',
      recomendacao: 'Reiniciar balança e repetir INIT',
      severidade: 'erro'
    },
    {
      codigo: 'TIMEOUT',
      alerta: 'Timeout Elgin',
      problema: 'Comando excedeu tempo limite',
      solucao: 'Aumentar timeout_ms',
      recomendacao: 'Verificar interferência serial',
      severidade: 'aviso'
    }
  ],
  configSchema: {
    versao: '1.0',
    campos: [
      { chave: 'baud_rate', tipo: 'number', padrao: 9600 },
      { chave: 'timeout_ms', tipo: 'number', padrao: 3000 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' },
      { chave: 'imprimir_automatico', tipo: 'boolean', padrao: false }
    ]
  }
};
