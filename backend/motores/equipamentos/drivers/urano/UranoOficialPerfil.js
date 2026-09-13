'use strict';

module.exports = {
  codigo: 'URANO_POP',
  fabricante: 'Urano',
  modelo: 'POP',
  versao: '2.0.0-oficial',
  transportes: ['serial'],
  protocolos: ['urano-pop'],
  firmware_conhecido: ['UPOP-1.4', 'UPOP-1.5', 'UPOP-2.0'],
  firmware_padrao: 'UPOP-1.5',
  keywords: ['urano', 'pop'],
  handshake: {
    passos: ['abrir_serial', 'cmd_WHO', 'ler_modelo', 'ler_firmware', 'ler_serie', 'ready'],
    timeout_ms: 3000
  },
  heartbeat: { intervalo_ms: 60000, timeout_ms: 2000, tipo_teste: 'PING_LOGICO' },
  sync: {
    produtos: true,
    plu: true,
    departamentos: true,
    configuracoes: true,
    promocoes: true,
    etiquetas: false
  },
  health: {
    fatores: [
      { chave: 'buffer_overflow', penalidade: 18 },
      { chave: 'eco_ausente', penalidade: 12 }
    ]
  },
  comandos_diagnostico: [
    { codigo: 'WHO', descricao: 'Identidade Urano' },
    { codigo: 'VER', descricao: 'Versão/firmware' },
    { codigo: 'TST', descricao: 'Autoteste' }
  ],
  diagnosticos: [
    {
      codigo: 'OFFLINE',
      alerta: 'Urano POP offline',
      problema: 'Sem resposta na serial',
      solucao: 'Conferir baud rate 9600 e cabo',
      recomendacao: 'Executar comando WHO',
      severidade: 'erro'
    },
    {
      codigo: 'PROTOCOLO',
      alerta: 'Erro de protocolo Urano',
      problema: 'Frame inválido ou checksum',
      solucao: 'Reenviar comando com intervalo maior',
      recomendacao: 'Atualizar driver oficial se persistir',
      severidade: 'aviso'
    }
  ],
  configSchema: {
    versao: '1.0',
    campos: [
      { chave: 'baud_rate', tipo: 'number', padrao: 9600 },
      { chave: 'timeout_ms', tipo: 'number', padrao: 3000 },
      { chave: 'departamento_padrao', tipo: 'number', padrao: 1 },
      { chave: 'unidade', tipo: 'string', padrao: 'kg' }
    ]
  }
};
