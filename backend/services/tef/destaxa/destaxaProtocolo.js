'use strict';

/**
 * Protocolo de parâmetros Destaxa 1.83 (fonte: docs oficiais 06/07/08/09/10).
 * Formato entrada/saída: chave=valor;chave=valor
 *
 * Identificação de ações no retorno 99 (doc 07 + Anexo I):
 * - OPÇÃO: presença do campo `opcao` (lista separada por `|`)
 * - COLETA: presença do campo `tipo` (sem `opcao`)
 * - DISPLAY: presença de `mensagem` sem `tipo` e sem `opcao`
 *
 * NÃO usar `acao=DISPLAY|COLETA|OPCAO` — esse formato NÃO está na documentação.
 */

const {
  CODIGO_ACAO_SOLICITADA,
  CODIGO_CLIENT_OK,
  CODIGOS_RESULTADO,
  CLASSIFICACAO_CODIGO,
  ESTADOS_TRANSACAO,
  TIPOS_ACAO,
  CAMPOS_META_ENTRADA
} = require('./destaxaConstantes');
const {
  classificarCodigoFinanceiro
} = require('../tefFinancialSafetyPolicy');

function comSegurancaFinanceira(resultado) {
  return {
    ...resultado,
    ...classificarCodigoFinanceiro(resultado.codigo, resultado.estadoTransacao)
  };
}

function parseParametrosDestaxa(texto) {
  const mapa = {};
  if (!texto || !String(texto).trim()) return mapa;
  for (const parte of String(texto).split(';')) {
    const p = parte.trim();
    if (!p || !p.includes('=')) continue;
    const idx = p.indexOf('=');
    const chave = p.slice(0, idx).trim();
    const valor = p.slice(idx + 1).trim();
    if (chave) mapa[chave] = valor;
  }
  return mapa;
}

/**
 * Monta string Destaxa "chave=valor;chave=valor".
 * Remove chaves de metadado do adapter (operacao/funcao/campos) — não fazem parte
 * do parâmetro `entrada` da DLL (operacao é parâmetro separado em iniciaTransacaoDestaxa).
 * Ordem: não confirmado na doc como obrigatória; usa ordem de inserção do objeto.
 */
function buildTransactionInput(campos = {}) {
  const pares = [];
  const chaves = [];
  for (const [chave, valor] of Object.entries(campos || {})) {
    if (CAMPOS_META_ENTRADA.has(chave)) continue;
    if (valor == null) continue;
    if (typeof valor === 'object') continue;
    const texto = String(valor).trim();
    if (!texto || texto === 'undefined' || texto === 'null') continue;
    pares.push(`${chave}=${texto}`);
    chaves.push(chave);
  }
  return {
    texto: pares.join(';'),
    chaves,
    campos: { ...campos }
  };
}

function classificarCodigoTransacao(codigo) {
  const chave = String(codigo || '').trim().toUpperCase();
  const meta = CODIGOS_RESULTADO[chave] || null;

  if (chave === CODIGO_CLIENT_OK) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.SUCCESS,
      estadoTransacao: ESTADOS_TRANSACAO.SUCCESS,
      conhecido: true,
      descricao: meta?.descricao || 'API executada com sucesso'
    });
  }
  if (chave === CODIGO_ACAO_SOLICITADA) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.ACTION_REQUIRED,
      estadoTransacao: ESTADOS_TRANSACAO.WAITING_ACTION,
      conhecido: true,
      descricao: meta?.descricao || 'Client solicita uma ação da AC'
    });
  }
  if (chave === '08') {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.TIMEOUT,
      estadoTransacao: ESTADOS_TRANSACAO.TIMEOUT,
      conhecido: true,
      descricao: meta?.descricao || 'Tempo limite de espera excedido'
    });
  }
  if (['03', '04', '09'].includes(chave)) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.DENIED,
      estadoTransacao: ESTADOS_TRANSACAO.DENIED,
      conhecido: Boolean(meta),
      descricao: meta?.descricao || 'Transação cancelada'
    });
  }
  if (chave === 'A0') {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.UNCONFIRMED,
      estadoTransacao: ESTADOS_TRANSACAO.UNCONFIRMED,
      conhecido: true,
      descricao: meta?.descricao || 'Uma ou mais transações não foram confirmadas corretamente'
    });
  }
  if (chave === 'A1') {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.BLOCKED,
      estadoTransacao: ESTADOS_TRANSACAO.BLOCKED,
      conhecido: true,
      descricao: meta?.descricao || 'Existem transações não confirmadas'
    });
  }
  if (['FF', 'F0', 'F1', 'F2', 'FE', '05', '06', '07'].includes(chave)) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.ERROR,
      estadoTransacao: ESTADOS_TRANSACAO.ERROR,
      conhecido: Boolean(meta),
      descricao: meta?.descricao || 'Erro'
    });
  }
  return comSegurancaFinanceira({
    codigo: chave || '??',
    classificacao: CLASSIFICACAO_CODIGO.UNKNOWN,
    estadoTransacao: ESTADOS_TRANSACAO.UNKNOWN,
    conhecido: false,
    descricao: 'Código Destaxa não documentado em 09-tabela-codigos-de-retorno'
  });
}

/**
 * Interpreta saída do retorno 99 conforme docs/07 e Anexo I (docs/10).
 */
function parseAcaoSolicitada(saidaBruta) {
  const parametros = parseParametrosDestaxa(saidaBruta);
  const mensagem = parametros.mensagem || '';
  const temOpcao = Object.prototype.hasOwnProperty.call(parametros, 'opcao');
  const temTipo = Object.prototype.hasOwnProperty.call(parametros, 'tipo');

  if (temOpcao) {
    const opcoes = String(parametros.opcao || '')
      .split('|')
      .map((o) => o.trim())
      .filter(Boolean);
    return {
      tipo: TIPOS_ACAO.OPCAO,
      mensagem,
      opcoes,
      tipoDado: parametros.tipo || null,
      mascara: parametros.mascara || null,
      chave: parametros.chave || null,
      timeout: parametros.timeout || null,
      parametros
    };
  }

  if (temTipo) {
    return {
      tipo: TIPOS_ACAO.COLETA,
      mensagem,
      tipoDado: parametros.tipo || null,
      mascara: parametros.mascara || null,
      chave: parametros.chave || null,
      timeout: parametros.timeout || null,
      parametros
    };
  }

  if (mensagem) {
    return {
      tipo: TIPOS_ACAO.DISPLAY,
      mensagem,
      parametros
    };
  }

  return {
    tipo: null,
    mensagem: '',
    parametros,
    acaoDesconhecida: true,
    observacao: 'saida 99 sem mensagem/tipo/opcao — formato não reconhecido pela doc 07'
  };
}

function estadoPorAcao(acao) {
  if (!acao?.tipo) return ESTADOS_TRANSACAO.WAITING_ACTION;
  if (acao.tipo === TIPOS_ACAO.DISPLAY) return ESTADOS_TRANSACAO.DISPLAY;
  if (acao.tipo === TIPOS_ACAO.COLETA) return ESTADOS_TRANSACAO.COLLECT;
  if (acao.tipo === TIPOS_ACAO.OPCAO) return ESTADOS_TRANSACAO.OPTION;
  return ESTADOS_TRANSACAO.WAITING_ACTION;
}

/**
 * Monta entrada de continuaTransacaoDestaxa após ação 99.
 * Doc 07: coleta → informacao=<valor>; display → entrada vazia.
 * Resposta de opção: não confirmado se deve usar `informacao` ou `opcao` — doc cita
 * informacao para coleta; para opção o valor selecionado também usa informacao
 * quando a AC digitou/escolheu (inferência não feita — preferir informacao se valor dado).
 */
function buildContinuaInput(resposta = {}) {
  if (resposta == null || resposta === '') {
    return buildTransactionInput({});
  }
  if (typeof resposta === 'string') {
    // Se já veio no formato Destaxa, preservar; se for só o valor coletado, usar informacao=
    if (resposta.includes('=')) {
      return { texto: resposta, chaves: ['raw'], campos: { raw: resposta } };
    }
    return buildTransactionInput({ informacao: resposta });
  }
  if (resposta.informacao != null) {
    return buildTransactionInput({ informacao: resposta.informacao });
  }
  if (resposta.entradaVazia === true || resposta.displayAck === true) {
    return buildTransactionInput({});
  }
  // Não inventar alias valor→informacao sem doc; aceitar apenas chaves Destaxa explícitas
  return buildTransactionInput(resposta);
}

module.exports = {
  parseParametrosDestaxa,
  buildTransactionInput,
  buildContinuaInput,
  classificarCodigoTransacao,
  parseAcaoSolicitada,
  estadoPorAcao
};
