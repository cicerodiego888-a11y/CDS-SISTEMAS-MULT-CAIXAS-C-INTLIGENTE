'use strict';

const PROVIDER = 'DESTAXA';
const MODO_REAL = 'REAL';
const APLICACAO = 'CDS Sistemas';
const DLL_NAME = 'libdll-integracao-tef.dll';

const EXPORTS_OBRIGATORIOS = [
  'iniciaClientDestaxa',
  'iniciaTransacaoDestaxa',
  'continuaTransacaoDestaxa',
  'finalizaTransacaoDestaxa'
];

const ESTADOS = Object.freeze({
  DLL_NOT_FOUND: 'DLL_NOT_FOUND',
  DLL_FOUND: 'DLL_FOUND',
  DLL_LOADED: 'DLL_LOADED',
  EXPORTS_VALID: 'EXPORTS_VALID',
  CLIENT_NOT_INITIALIZED: 'CLIENT_NOT_INITIALIZED',
  CLIENT_INITIALIZED: 'CLIENT_INITIALIZED',
  CLIENT_ERROR: 'CLIENT_ERROR'
});

/**
 * Estados de preparação do ambiente real, independentes dos estados da DLL.
 * Um Client inicializado não implica PinPad conectado nem transação liberada.
 */
const ESTADOS_PREPARACAO = Object.freeze({
  PINPAD_NOT_DETECTED: 'PINPAD_NOT_DETECTED',
  PINPAD_DETECTED: 'PINPAD_DETECTED',
  TRANSACTION_BLOCKED: 'TRANSACTION_BLOCKED',
  READY_FOR_TRANSACTION: 'READY_FOR_TRANSACTION',
  AMBIENTE_PREPARADO_AGUARDANDO_PINPAD: 'AMBIENTE_PREPARADO_AGUARDANDO_PINPAD'
});

const ERROS = Object.freeze({
  DESTAXA_DLL_NOT_FOUND: 'DESTAXA_DLL_NOT_FOUND',
  DESTAXA_DLL_LOAD_FAILED: 'DESTAXA_DLL_LOAD_FAILED',
  DESTAXA_EXPORT_MISSING: 'DESTAXA_EXPORT_MISSING',
  DESTAXA_CLIENT_INIT_FAILED: 'DESTAXA_CLIENT_INIT_FAILED',
  DESTAXA_INVALID_CONFIGURATION: 'DESTAXA_INVALID_CONFIGURATION',
  DESTAXA_ARCHITECTURE_NOT_SUPPORTED: 'DESTAXA_ARCHITECTURE_NOT_SUPPORTED',
  DESTAXA_ARCHITECTURE_MISMATCH: 'DESTAXA_ARCHITECTURE_NOT_SUPPORTED',
  DESTAXA_TRANSACAO_EM_ANDAMENTO: 'DESTAXA_TRANSACAO_EM_ANDAMENTO',
  DESTAXA_TRANSACAO_NAO_ENCONTRADA: 'DESTAXA_TRANSACAO_NAO_ENCONTRADA',
  DESTAXA_TRANSACAO_REAL_BLOQUEADA: 'DESTAXA_TRANSACAO_REAL_BLOQUEADA',
  DESTAXA_TRANSACAO_SEM_CONTEXTO: 'DESTAXA_TRANSACAO_SEM_CONTEXTO',
  DESTAXA_REAL_TRANSACTION_DISABLED: 'DESTAXA_REAL_TRANSACTION_DISABLED',
  DESTAXA_OPERACAO_NAO_PERMITIDA: 'DESTAXA_OPERACAO_NAO_PERMITIDA',
  DESTAXA_VALOR_NAO_PERMITIDO: 'DESTAXA_VALOR_NAO_PERMITIDO',
  DESTAXA_AMBIENTE_NAO_PERMITIDO: 'DESTAXA_AMBIENTE_NAO_PERMITIDO',
  DESTAXA_PROVIDER_INVALIDO: 'DESTAXA_PROVIDER_INVALIDO',
  DESTAXA_VSPAGUE_INDISPONIVEL: 'DESTAXA_VSPAGUE_INDISPONIVEL',
  DESTAXA_PINPAD_NAO_DETECTADO: 'DESTAXA_PINPAD_NAO_DETECTADO',
  DESTAXA_REAL_ADAPTER_INDISPONIVEL: 'DESTAXA_REAL_ADAPTER_INDISPONIVEL'
});

/**
 * Gate financeiro: somente DESTAXA_REAL_TRANSACTION_ENABLED=1 libera
 * iniciaTransacaoDestaxa/continuaTransacaoDestaxa/finalizaTransacaoDestaxa reais.
 */
const REAL_TRANSACTION_ENV = 'DESTAXA_REAL_TRANSACTION_ENABLED';

function transacaoRealHabilitada() {
  return String(process.env[REAL_TRANSACTION_ENV] || '').trim() === '1';
}

/** Única operação real permitida até nova sprint. */
const OPERACOES_REAIS_PERMITIDAS = Object.freeze(['CRT']);

/** Homologação real: valor único R$1,00. */
const VALOR_HOMOLOGACAO_CENTAVOS = 100;
const AMBIENTE_TRANSACAO_REAL = 'homologacao';

/** Formato de `transacao_valor` confirmado na documentação oficial Destaxa 1.83. */
const FORMATO_VALOR_DESTAXA = Object.freeze({
  confirmed: true,
  format: 'reais com ponto decimal e 2 casas (100 centavos → "1.00")',
  source: Object.freeze([
    'docs/06-api-iniciatransacaodestaxa.md: transacao_valor "Ex: 100.99"; exemplo "transacao_valor=99.99"',
    'examples/dotnet/Program.cs: "transacao_valor=100.00", "transacao_valor=23.49"',
    'examples/java App.java: "transacao_valor=100.00", "transacao_valor=23.49"',
    'examples/clang/src/main.c: "transacao_valor=108.96", "transacao_valor=100.00"'
  ])
});

const DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO = 'DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO';

/**
 * Timeouts na documentação oficial Destaxa 1.83. Não existe timeout global/CRT
 * documentado; nenhum valor numérico do CDS deriva desta documentação.
 */
const CONTRATO_TIMEOUT_DESTAXA = Object.freeze({
  globalTimeout: DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO,
  coleta: Object.freeze({
    campo: 'timeout',
    unidade: 'segundos',
    significado: 'tempo máximo que o Client aguardará a resposta da AC a uma coleta; ultrapassado, a transação será cancelada pelo Client',
    escopo: 'resposta da AC à ação de coleta corrente (entre o retorno 99 e a próxima continuaTransacaoDestaxa)',
    timeoutTotalDaTransacao: false,
    variacaoPorEtapa: 'não documentada — o campo é enviado junto de cada ação de coleta',
    autoridade: 'Client Destaxa',
    source: 'docs/10-acoes-de-coleta.md: "campo timeout — Indica o tempo máximo em segundos que o Client aguardará a resposta do AC. Se o tempo for ultrapassado a transação será cancelada."'
  }),
  codigo08: Object.freeze({
    codigo: '08',
    significado: 'Tempo limite de espera excedido',
    source: 'docs/09-tabela-codigos-de-retorno.md'
  }),
  chamadaEmAndamento: Object.freeze({
    limite: null,
    source: 'docs/07-api-continuatransacaodestaxa.md: "a AC deve aguardar o fim da chamada"'
  }),
  sources: Object.freeze([
    'docs/00-introducao.md',
    'docs/01-usando-a-dll-fluxo-simples.md',
    'docs/02-usando-a-dll-fluxo-multi-transacao.md',
    'docs/03-usando-a-dll.md',
    'docs/04-interface-dll-ac.md',
    'docs/05-api-iniciaclientdestaxa.md',
    'docs/06-api-iniciatransacaodestaxa.md',
    'docs/07-api-continuatransacaodestaxa.md',
    'docs/08-api-finalizatransacaodestaxa.md',
    'docs/09-tabela-codigos-de-retorno.md',
    'docs/10-acoes-de-coleta.md',
    'docs/dll-integracao-tef.html',
    'examples/clang/src/main.c',
    'examples/dotnet/Program.cs',
    'examples/java/app/src/main/java/com/destaxa/example/App.java'
  ])
});

/**
 * Códigos de 2 caracteres — docs/09-tabela-codigos-de-retorno.md (Destaxa 1.83).
 * Descrições alinhadas ao texto oficial.
 */
const CODIGOS_RESULTADO = Object.freeze({
  '00': { sucesso: true, fase: 'geral', descricao: 'API executada com sucesso.' },
  '03': { sucesso: false, fase: 'transacao', descricao: 'Transação cancelada pelo operador.' },
  '04': { sucesso: false, fase: 'transacao', descricao: 'Transação cancelada pelo cliente.' },
  '05': { sucesso: false, fase: 'geral', descricao: 'Dados coletados insuficientes ou invalidos' },
  '06': { sucesso: false, fase: 'geral', descricao: 'Problemas entre o V$PagueClient e V$PagueServer.' },
  '07': { sucesso: false, fase: 'transacao', descricao: 'Problemas entre o V$PagueServer e a Rede.' },
  '08': { sucesso: false, fase: 'geral', descricao: 'Tempo limite de espera excedido.' },
  '09': { sucesso: false, fase: 'transacao', descricao: 'Transação cancelada pelo Client.' },
  '99': { sucesso: false, fase: 'transacao', descricao: 'Client solicita uma ação da AC. Pode ser imprimir um texto na tela ou realizar uma coleta.' },
  FF: { sucesso: false, fase: 'geral', descricao: 'Parâmetros passados para a API são inválidos.' },
  F0: { sucesso: false, fase: 'geral', descricao: 'A chamada a API é invalida. Este erro pode aconter quando chamar alguma API na sequencia errada.' },
  F1: { sucesso: false, fase: 'geral', descricao: 'Erro de comunicacao com o client.' },
  F2: { sucesso: false, fase: 'geral', descricao: 'Erro interno da DLL. Este erro indica falta de recursos para alocar memória ou de disco.' },
  FE: { sucesso: false, fase: 'geral', descricao: 'Erro não identificado ou inesperado.' },
  A0: { sucesso: false, fase: 'transacao', descricao: 'Uma ou mais transação não foi confirmada corretamente. Será necessário verificar os logs para mais detalhes.' },
  A1: { sucesso: false, fase: 'transacao', descricao: 'Existem transações não confirmada. Será necessário que as confirme ou cancele antes de iniciar novas transações.' }
});

const CODIGO_CLIENT_OK = '00';
const CODIGO_ACAO_SOLICITADA = '99';

/** docs/06 — tabela de operações (CRT documentado). */
const OPERACOES = Object.freeze({
  CRT: 'CRT',
  PIX: 'PIX',
  MOB: 'MOB',
  PRE: 'PRE',
  EST: 'EST',
  CPF: 'CPF',
  CST: 'CST'
});

/**
 * Campos de entrada CRT documentados em docs/06 ("Algumas informações aceitas").
 * Lista não exaustiva oficialmente — outros campos: não confirmado na documentação.
 */
const CAMPOS_ENTRADA_CRT_DOCUMENTADOS = Object.freeze({
  transacao_pagamento: 'A vista | Parcelado | Pré-datado',
  transacao_tipo_cartao: 'Débito | Credito',
  transacao_valor: 'maior que zero; reais com ponto e 2 casas; exemplo 100.99'
});

/** Chaves do adapter que NÃO entram no parâmetro `entrada` da DLL. */
const CAMPOS_META_ENTRADA = new Set(['operacao', 'funcao', 'campos']);

/**
 * Buffers — docs/04-interface-dll-ac.md
 * resultado: 2 bytes; saida: sugerido 99000 bytes.
 */
const BUFFER_RESULTADO_BYTES = 2;
const BUFFER_SAIDA_BYTES_SUGERIDO = 99000;

/**
 * Encoding — docs/04: char* = array de bytes 0-255 conforme tabela ASCII.
 * Implementação CDS: latin1 (mapeamento 1:1 byte↔char 0-255).
 */
const ENCODING_DESTAXA = 'latin1';

/** Anexo I — campo tipo (coleta). */
const TIPOS_DADO_COLETA = Object.freeze({
  ASTERISCO: '*',
  ALFABETICO: 'A',
  DATA_HORA: 'D',
  NUMERICO: 'N',
  ALFANUMERICO: 'X'
});

/** Estados da máquina de transação Destaxa (protocolo CRT / retorno 99). */
const ESTADOS_TRANSACAO = Object.freeze({
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  WAITING_ACTION: 'WAITING_ACTION',
  DISPLAY: 'DISPLAY',
  COLLECT: 'COLLECT',
  OPTION: 'OPTION',
  FINALIZING: 'FINALIZING',
  SUCCESS: 'SUCCESS',
  DENIED: 'DENIED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
  PENDING: 'PENDING',
  UNCONFIRMED: 'UNCONFIRMED',
  BLOCKED: 'BLOCKED',
  ERROR: 'ERROR'
});

const CLASSIFICACAO_CODIGO = Object.freeze({
  SUCCESS: 'SUCCESS',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  DENIED: 'DENIED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
  UNCONFIRMED: 'UNCONFIRMED',
  BLOCKED: 'BLOCKED',
  ERROR: 'ERROR'
});

/**
 * finalizaTransacaoDestaxa(confirmacao) — docs/08-api-finalizatransacaodestaxa.md:
 * 0 = Client pode confirmar as transações
 * 9 = cancelamento será executado
 */
const FINALIZACAO_CONFIRMAR = 0;
const FINALIZACAO_CANCELAR = 9;

/**
 * Tipos de ação 99 (CDS) — identificação real na saída usa campos
 * mensagem / tipo / opcao (docs/07), não um campo `acao=`.
 */
const TIPOS_ACAO = Object.freeze({
  DISPLAY: 'DISPLAY',
  COLETA: 'COLETA',
  OPCAO: 'OPCAO'
});

function pastaArquitetura(arch = process.arch) {
  if (arch === 'x64') return 'win-x64';
  if (arch === 'ia32') return 'win-ia32';
  return null;
}

function rotuloArquiteturaDll(arch = process.arch) {
  if (arch === 'x64') return 'x64';
  if (arch === 'ia32') return 'x86';
  return String(arch || '');
}

function criarErro(codigo, mensagem, detalhes = {}) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  erro.provedor = PROVIDER;
  erro.detalhes = detalhes || {};
  return erro;
}

function interpretarCodigoResultado(codigo) {
  const chave = String(codigo || '').trim().toUpperCase();
  const meta = CODIGOS_RESULTADO[chave] || CODIGOS_RESULTADO[codigo] || null;
  return {
    codigo: chave,
    sucesso: chave === CODIGO_CLIENT_OK,
    conhecido: Boolean(meta),
    fase: meta?.fase || 'desconhecida',
    descricao: meta?.descricao || 'Código Destaxa não documentado nesta sprint'
  };
}

module.exports = {
  PROVIDER,
  MODO_REAL,
  APLICACAO,
  DLL_NAME,
  EXPORTS_OBRIGATORIOS,
  ESTADOS,
  ESTADOS_PREPARACAO,
  ERROS,
  REAL_TRANSACTION_ENV,
  transacaoRealHabilitada,
  OPERACOES_REAIS_PERMITIDAS,
  VALOR_HOMOLOGACAO_CENTAVOS,
  AMBIENTE_TRANSACAO_REAL,
  FORMATO_VALOR_DESTAXA,
  DESTAXA_GLOBAL_TIMEOUT_NAO_DOCUMENTADO,
  CONTRATO_TIMEOUT_DESTAXA,
  CODIGOS_RESULTADO,
  CODIGO_CLIENT_OK,
  CODIGO_ACAO_SOLICITADA,
  OPERACOES,
  CAMPOS_ENTRADA_CRT_DOCUMENTADOS,
  CAMPOS_META_ENTRADA,
  BUFFER_RESULTADO_BYTES,
  BUFFER_SAIDA_BYTES_SUGERIDO,
  ENCODING_DESTAXA,
  TIPOS_DADO_COLETA,
  ESTADOS_TRANSACAO,
  CLASSIFICACAO_CODIGO,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR,
  TIPOS_ACAO,
  pastaArquitetura,
  rotuloArquiteturaDll,
  criarErro,
  interpretarCodigoResultado
};
