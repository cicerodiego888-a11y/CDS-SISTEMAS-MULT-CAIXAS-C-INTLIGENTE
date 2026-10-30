'use strict';

/**
 * MRT-13/14 — Continuidade e persistência da identidade do adapter no ciclo TEF.
 *
 * Autorização (MRT-12): RouteDecision → adapter + persiste identidade na transação.
 * Consulta / cancelamento / estorno / reimpressão: resolvem adapter a partir do
 * vínculo da transação (coluna provedor + payload.identidadeAdapter), NÃO por
 * obterAdapter() LIMIT 1 arbitrário.
 *
 * MRT-14 — Durabilidade:
 * - Âncora: coluna tef_transacoes.provedor (não é atualizada por atualizarTransacao).
 * - Enriquecimento: payload.identidadeAdapter / roteamento / execucao — devem ser
 *   preservados em todo rewrite de payload_retorno (mesclarPayloadPreservandoIdentidade).
 * - Memória (_pendencias): espelho; reconstruída de linhas pendentes após reinício.
 *
 * status() de instalação (sem transação) permanece em obterAdapter (singleton).
 * Não presume que todo provedor suporte consulta/cancelamento/estorno igualmente.
 */

const { criarAdapter, provedorReconhecido } = require('./tefFactory');

const CICLO_CODES = Object.freeze({
  ADAPTER_OK: 'CICLO_ADAPTER_OK',
  TRANSACAO_AUSENTE: 'CICLO_TRANSACAO_AUSENTE',
  PROVEDOR_AUSENTE: 'CICLO_PROVEDOR_AUSENTE',
  PROVEDOR_NAO_RECONHECIDO: 'CICLO_PROVEDOR_NAO_RECONHECIDO',
  ADAPTER_INDISPONIVEL: 'CICLO_ADAPTER_INDISPONIVEL',
  OPERACAO_NAO_SUPORTADA_DOC: 'CICLO_OPERACAO_CAPACIDADE_DOCUMENTAL'
});

/** Aliases históricos (adapter.nome / DEFAULT SITEF) → chave factory. */
const ALIASES_PROVEDOR = Object.freeze({
  destaxa: 'destaxa',
  paygo: 'paygo',
  sitef: 'sitef',
  clisitef: 'sitef',
  stone: 'stone',
  cielo: 'cielo',
  rede: 'rede',
  getnet: 'getnet'
});

function erroCiclo(codigo, mensagem, detalhes = {}) {
  const error = new Error(mensagem);
  error.codigo = codigo;
  error.code = codigo;
  error.detalhes = detalhes;
  error.tefAdapterCiclo = true;
  return error;
}

/**
 * Normaliza identidade de provedor persistida (chave factory ou nome do adapter).
 * @returns {string|null}
 */
/**
 * @returns {{ chave: string|null, bruto: string|null, vazio: boolean, reconhecido: boolean }}
 */
function classificarProvedorCiclo(valor) {
  if (valor == null || String(valor).trim() === '') {
    return { chave: null, bruto: null, vazio: true, reconhecido: false };
  }
  const bruto = String(valor).trim();
  const lower = bruto.toLowerCase();
  const chave = ALIASES_PROVEDOR[lower]
    || (provedorReconhecido(lower) ? lower : null);
  return {
    chave,
    bruto,
    vazio: false,
    reconhecido: Boolean(chave && provedorReconhecido(chave))
  };
}

function normalizarProvedorCiclo(valor) {
  return classificarProvedorCiclo(valor).chave;
}

/** Chaves de identidade que não podem ser descartadas em rewrite de payload. */
const CHAVES_IDENTIDADE_PAYLOAD = Object.freeze([
  'identidadeAdapter',
  'identidade_adapter',
  'roteamento',
  'execucao'
]);

function lerPayloadTransacao(transacao) {
  if (!transacao) return {};
  const p = transacao.payload_retorno;
  if (!p) return {};
  if (typeof p === 'object') return p;
  if (typeof p !== 'string') return {};

  // MRT-14 — payload pode estar criptografado (tefRepository) ou JSON puro legado
  try {
    const cryptoService = require('../crypto/cryptoService');
    if (typeof cryptoService.descriptografarObjeto === 'function') {
      const dec = cryptoService.descriptografarObjeto(p);
      if (dec && typeof dec === 'object') return dec;
    }
  } catch (_) { /* tenta JSON abaixo */ }

  try {
    const parsed = JSON.parse(p);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Mescla payload novo com anterior preservando identidade do ciclo (MRT-14).
 * Não altera a coluna `provedor` — isso é responsabilidade do INSERT inicial.
 */
function mesclarPayloadPreservandoIdentidade(payloadNovo, payloadAnterior = null, identidadeExtra = null) {
  const anterior = payloadAnterior && typeof payloadAnterior === 'object' ? payloadAnterior : {};
  let novo;
  if (payloadNovo == null) {
    novo = {};
  } else if (typeof payloadNovo === 'object') {
    novo = { ...payloadNovo };
  } else {
    novo = { resposta: payloadNovo };
  }

  const identidade = identidadeExtra
    || novo.identidadeAdapter
    || novo.identidade_adapter
    || anterior.identidadeAdapter
    || anterior.identidade_adapter
    || null;
  const roteamento = novo.roteamento != null ? novo.roteamento : (anterior.roteamento || null);
  const execucao = novo.execucao != null ? novo.execucao : (anterior.execucao || null);

  const mesclado = {
    ...anterior,
    ...novo
  };

  if (identidade) {
    mesclado.identidadeAdapter = identidade;
    delete mesclado.identidade_adapter;
  }
  if (roteamento) mesclado.roteamento = roteamento;
  if (execucao) mesclado.execucao = execucao;

  return mesclado;
}

/**
 * Normaliza linha do banco para uso no ciclo (descriptografa payload se necessário).
 */
function hidratarTransacaoParaCiclo(linha) {
  if (!linha) return null;
  const payload = lerPayloadTransacao(linha);
  return {
    ...linha,
    payload_retorno: payload
  };
}

/**
 * Extrai identidade contínua da transação (sem criar adapter).
 */
function extrairIdentidadeTransacao(transacao) {
  if (!transacao) {
    return {
      ok: false,
      codigo: CICLO_CODES.TRANSACAO_AUSENTE,
      mensagem: 'Transação TEF ausente — impossível resolver adapter do ciclo',
      provedor: null,
      adapterNome: null,
      terminalTefId: null,
      ambiente: null,
      codigoTransacaoProvedor: null,
      identidade: null
    };
  }

  const payload = lerPayloadTransacao(transacao);
  const idStored = payload.identidadeAdapter || payload.identidade_adapter || null;
  const roteamento = payload.roteamento || null;

  const classif = classificarProvedorCiclo(
    (idStored && idStored.provedor)
      || transacao.provedor
      || null
  );

  if (classif.vazio) {
    return {
      ok: false,
      codigo: CICLO_CODES.PROVEDOR_AUSENTE,
      mensagem: 'Provedor ausente na transação TEF — sem fallback para configuração global LIMIT 1',
      provedor: null,
      adapterNome: idStored?.adapterNome || null,
      terminalTefId: idStored?.terminalTefId || roteamento?.terminalTefId || null,
      ambiente: idStored?.ambiente || null,
      codigoTransacaoProvedor: transacao.codigo_transacao || null,
      identidade: idStored
    };
  }

  if (!classif.reconhecido) {
    return {
      ok: false,
      codigo: CICLO_CODES.PROVEDOR_NAO_RECONHECIDO,
      mensagem: `Provedor da transação não reconhecido: ${classif.bruto}`,
      provedor: classif.bruto,
      adapterNome: idStored?.adapterNome || null,
      terminalTefId: idStored?.terminalTefId || roteamento?.terminalTefId || null,
      ambiente: idStored?.ambiente || null,
      codigoTransacaoProvedor: transacao.codigo_transacao || null,
      identidade: idStored
    };
  }

  const provedor = classif.chave;

  return {
    ok: true,
    codigo: CICLO_CODES.ADAPTER_OK,
    mensagem: 'Identidade do ciclo resolvida a partir da transação',
    provedor,
    adapterNome: idStored?.adapterNome || null,
    terminalTefId: idStored?.terminalTefId
      || roteamento?.terminalTefId
      || null,
    ambiente: idStored?.ambiente || null,
    codigoTransacaoProvedor: transacao.codigo_transacao || idStored?.codigoTransacaoProvedor || null,
    fonte: idStored?.fonte || null,
    registroSnapshot: idStored?.registro || null,
    identidade: idStored,
    roteamento
  };
}

/**
 * Monta snapshot persistível na autorização (MRT-13).
 */
function montarIdentidadeAdapterPersistencia(selecao, adapter) {
  const registro = selecao?.registro || {};
  return {
    provedor: String(selecao?.provedor || '').toLowerCase() || null,
    adapterNome: adapter?.nome || null,
    terminalTefId: selecao?.terminalTefId != null ? String(selecao.terminalTefId) : null,
    ambiente: selecao?.ambiente || registro.ambiente || null,
    fonte: selecao?.fonte || null,
    executionMode: selecao?.executionMode || null,
    registro: {
      provedor: String(selecao?.provedor || registro.provedor || '').toLowerCase() || null,
      ambiente: selecao?.ambiente || registro.ambiente || null,
      empresa_codigo: registro.empresa_codigo || registro.empresaCodigo || null,
      loja_codigo: registro.loja_codigo || registro.lojaCodigo || null,
      terminal_codigo: registro.terminal_codigo || registro.terminalCodigo || null
    }
  };
}

async function carregarRegistroBaseInstalacao(dependencias = {}) {
  const tefConfigRepository = dependencias.tefConfigRepository
    || require('../../repositories/tefConfigRepository');
  const tefConfigService = dependencias.tefConfigService
    || require('./tefConfigService');

  const registroDb = await tefConfigRepository.buscarConfiguracaoPrincipal();
  if (!registroDb) return null;

  let config;
  try {
    config = await tefConfigService.obterConfiguracao();
  } catch (_) {
    return { ...registroDb };
  }
  if (config && config._defaultsAplicados) return null;

  return {
    ...registroDb,
    ...(typeof tefConfigService.configParaRegistroAdapter === 'function'
      ? tefConfigService.configParaRegistroAdapter(config)
      : {})
  };
}

/**
 * Resolve adapter para operação posterior do ciclo a partir da transação.
 * Sem fallback arbitrário para outro provedor / LIMIT 1 cego.
 */
async function obterAdapterDaTransacao(transacao, opcoes = {}) {
  const identidade = extrairIdentidadeTransacao(transacao);
  if (!identidade.ok) {
    throw erroCiclo(identidade.codigo, identidade.mensagem, {
      transacaoId: transacao?.id || null,
      provedorBruto: transacao?.provedor || null
    });
  }

  const base = opcoes.registroBase !== undefined
    ? opcoes.registroBase
    : await carregarRegistroBaseInstalacao(opcoes.dependencias || {});

  const snapshot = identidade.registroSnapshot || {};
  const registro = {
    ...(base && typeof base === 'object' ? base : {}),
    ...snapshot,
    provedor: identidade.provedor,
    ambiente: identidade.ambiente
      || snapshot.ambiente
      || (base && (base.ambiente || base.tefAmbiente))
      || 'simulacao'
  };

  let adapter;
  try {
    adapter = criarAdapter(registro, opcoes.adapterOpcoes || {});
  } catch (error) {
    throw erroCiclo(
      error.codigo || error.code || CICLO_CODES.ADAPTER_INDISPONIVEL,
      error.message || `Adapter indisponível para provedor "${identidade.provedor}"`,
      {
        provedor: identidade.provedor,
        terminalTefId: identidade.terminalTefId,
        causa: error.detalhes || null
      }
    );
  }

  if (!adapter) {
    throw erroCiclo(
      CICLO_CODES.ADAPTER_INDISPONIVEL,
      `Adapter inexistente para provedor "${identidade.provedor}" — sem fallback global`,
      { provedor: identidade.provedor }
    );
  }

  return {
    adapter,
    provedor: identidade.provedor,
    adapterNome: identidade.adapterNome || adapter.nome || null,
    terminalTefId: identidade.terminalTefId,
    ambiente: registro.ambiente,
    codigoTransacaoProvedor: identidade.codigoTransacaoProvedor,
    fonte: 'tef_transacao',
    codigo: CICLO_CODES.ADAPTER_OK,
    mensagem: identidade.mensagem,
    registro
  };
}

/**
 * Documentação de capacidades — não altera fluxo financeiro.
 * Adapters concretos podem lançar "não implementado"; aqui só registra expectativa.
 */
function capacidadeOperacaoDocumental(provedor, operacao) {
  const p = normalizarProvedorCiclo(provedor);
  const op = String(operacao || '').toLowerCase();
  const matriz = {
    destaxa: {
      autorizar: true,
      consultar: true,
      cancelar: true,
      estornar: true,
      reimprimir: true,
      status: true,
      nota: 'Capacidades Destaxa dependem do Native Host / modo; cancelamento segue TEF-17'
    },
    sitef: {
      autorizar: true,
      consultar: 'sdk',
      cancelar: 'sdk',
      estornar: 'sdk',
      reimprimir: 'sdk',
      status: true,
      nota: 'SiTef real — não presumir paridade com Destaxa (MRT-13 documental)'
    },
    paygo: {
      autorizar: true,
      consultar: 'sdk',
      cancelar: 'sdk',
      estornar: 'sdk',
      reimprimir: 'sdk',
      status: true,
      nota: 'PayGo real — não presumir paridade com Destaxa (MRT-13 documental)'
    }
  };
  const row = matriz[p] || {
    autorizar: true,
    consultar: 'desconhecido',
    cancelar: 'desconhecido',
    estornar: 'desconhecido',
    reimprimir: 'desconhecido',
    status: true,
    nota: 'Provedor sem matriz documental específica'
  };
  return {
    provedor: p,
    operacao: op,
    suportado: row[op] === true ? true : row[op] === 'sdk' ? 'sdk_pendente' : row[op] != null ? row[op] : false,
    matriz: row,
    codigo: CICLO_CODES.OPERACAO_NAO_SUPORTADA_DOC
  };
}

module.exports = {
  CICLO_CODES,
  ALIASES_PROVEDOR,
  CHAVES_IDENTIDADE_PAYLOAD,
  classificarProvedorCiclo,
  normalizarProvedorCiclo,
  lerPayloadTransacao,
  mesclarPayloadPreservandoIdentidade,
  hidratarTransacaoParaCiclo,
  extrairIdentidadeTransacao,
  montarIdentidadeAdapterPersistencia,
  carregarRegistroBaseInstalacao,
  obterAdapterDaTransacao,
  capacidadeOperacaoDocumental,
  erroCiclo
};
