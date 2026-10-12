'use strict';

/**
 * Revalidação, na leitura, do resultado MIIP gravado no documento por regra anterior
 * (resultado sem VERSAO_REGRA_IDENTIFICACAO). Nada é gravado: o documento continua com o
 * resultado original até ser reprocessado com autorização.
 *
 * Os candidatos gravados passam pelas regras atuais — cProd só vale no mapeamento do
 * fornecedor, descrição exige palavra descritiva em comum, barreira de compatibilidade e
 * política V2 — e a decisão é remontada pelo mapper canônico. Revalidar só remove ou
 * rebaixa candidatos; candidato que não estava gravado só aparece com novo processamento.
 *
 * @module motores/miip/utils/MiipRevalidacaoResultadoPersistido
 */

const {
  VERSAO_REGRA_IDENTIFICACAO,
  MOTOR_FORNECEDOR,
  MOTOR_GTIN,
  aplicarPoliticaNoResultado
} = require('../core/MiipIdentificacaoV2Policy');
const { mapearDecisaoPipelineParaImportacao } = require('./MiipResultadoImportacaoMapper');
const ProductCompatibilityGuard = require('./ProductCompatibilityGuard');
const { extrairTokensDescricao, avaliarDescricao } = require('./evidenciaDescricao');
const { pontuarMotivos } = require('../engines/mubc/MotorUniversalBuscaCandidatos');
const MiipImportacaoXmlService = require('../services/MiipImportacaoXmlService');

const MOTOR_MUBC = 'motor_mubc';
const ORIGEM_REVALIDACAO = 'resultado_gravado_por_regra_anterior';

function decididoPelaRegraAtual(resultado) {
  return resultado?.regraIdentificacao === VERSAO_REGRA_IDENTIFICACAO;
}

function nomeDoCandidato(candidato) {
  return candidato?.produto?.nome ?? candidato?.snapshot?.nome ?? candidato?.nome ?? candidato?.produtoNome ?? '';
}

function normalizarCandidato(candidato) {
  if (!candidato || typeof candidato !== 'object') return null;
  const produtoId = Number(candidato.produtoId ?? candidato.produto_id ?? candidato.produto?.id ?? candidato.snapshot?.id);
  if (!Number.isFinite(produtoId) || produtoId <= 0) return null;
  let motores = [];
  if (Array.isArray(candidato.motoresQueVotaram)) motores = candidato.motoresQueVotaram;
  else if (Array.isArray(candidato.motores)) motores = candidato.motores;
  return {
    ...candidato,
    produtoId,
    scoreTotal: Number(candidato.scoreTotal ?? candidato.score ?? 0),
    motoresQueVotaram: [...motores],
    evidencias: (Array.isArray(candidato.evidencias) ? candidato.evidencias : [])
      .filter((ev) => ev && typeof ev === 'object')
  };
}

/** Selecionado primeiro (é o objeto completo do pipeline), depois a lista resumida, sem repetir produto. */
function candidatosGravados(resultado) {
  const vistos = new Set();
  const lista = [];
  [resultado?.candidatoSelecionado, ...(Array.isArray(resultado?.candidatos) ? resultado.candidatos : [])]
    .forEach((c) => {
      const candidato = normalizarCandidato(c);
      if (!candidato || vistos.has(candidato.produtoId)) return;
      vistos.add(candidato.produtoId);
      lista.push(candidato);
    });
  return lista;
}

/**
 * Regras atuais sobre um motivo/evidência gravado.
 * @returns {Object|null} item revisado, ou null quando deixou de ser evidência
 */
function revisarMotivo(motivo, tokensXml, nomeCandidato) {
  const tipo = String(motivo?.tipo || '').toLowerCase();
  if (tipo === 'codigo_fornecedor' && motivo?.motor !== MOTOR_FORNECEDOR) return null;
  if (tipo === 'descricao' || tipo === 'descricao_medida') {
    const descricao = avaliarDescricao(tokensXml, nomeCandidato);
    if (!descricao) return null;
    if (descricao.tipo === tipo) return motivo;
    const rotulo = descricao.tipo === 'descricao' ? 'Descrição semelhante' : 'Só medida ou unidade coincide';
    return {
      ...motivo,
      tipo: descricao.tipo,
      tokens: descricao.tokens,
      ...(motivo.valor !== undefined ? { valor: descricao.tokens } : {}),
      ...(motivo.rotulo !== undefined ? { rotulo } : {}),
      ...(motivo.descricao !== undefined ? { descricao: rotulo } : {})
    };
  }
  return motivo;
}

function mesmaLista(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function revisarCandidato(candidato, tokensXml) {
  const nome = nomeDoCandidato(candidato);
  const evidencias = candidato.evidencias
    .map((ev) => revisarMotivo(ev, tokensXml, nome))
    .filter(Boolean);
  const motivosGravados = candidato.atributosExtraidos?.motivosRelevancia;
  const motivosRelevancia = Array.isArray(motivosGravados)
    ? motivosGravados.map((m) => revisarMotivo(m, tokensXml, nome)).filter(Boolean)
    : null;

  const alterado = !mesmaLista(evidencias, candidato.evidencias)
    || (motivosRelevancia && !mesmaLista(motivosRelevancia, motivosGravados));
  if (!alterado) return candidato;

  const revisado = {
    ...candidato,
    evidencias,
    ...(motivosRelevancia ? { atributosExtraidos: { ...candidato.atributosExtraidos, motivosRelevancia } } : {})
  };
  const soBusca = candidato.motoresQueVotaram.every((m) => m !== MOTOR_GTIN && m !== MOTOR_FORNECEDOR);
  if (soBusca) {
    const base = motivosRelevancia
      || evidencias.filter((ev) => ev.motor === MOTOR_MUBC || ev.motor == null)
        .map((ev) => ({ tipo: ev.tipo, tokens: Number.isFinite(Number(ev.valor)) ? Number(ev.valor) : undefined }));
    revisado.scoreTotal = pontuarMotivos(base);
    revisado.scoreRecalculado = true;
  }
  return revisado;
}

/** Mesma barreira aplicada no pipeline aos candidatos que vieram só da busca. */
function compativel(candidato, itemXml) {
  const veioDaBusca = candidato.motoresQueVotaram.includes(MOTOR_MUBC)
    && !candidato.motoresQueVotaram.includes(MOTOR_GTIN)
    && !candidato.motoresQueVotaram.includes(MOTOR_FORNECEDOR);
  if (!veioDaBusca) return true;
  const guard = ProductCompatibilityGuard.avaliar({
    itemXml,
    produtoCds: {
      ...(candidato.produto || {}),
      nome: nomeDoCandidato(candidato),
      ncm: candidato.snapshot?.ncm ?? candidato.produto?.ncm ?? candidato.ncm,
      snapshot: candidato.snapshot || null
    },
    motivosMatch: candidato.evidencias.map((ev) => ev.tipo)
  });
  return !(guard.bloqueado || guard.compativel === false);
}

/**
 * @param {Object} resultado - resultado de importação gravado (parse_json.miip_importacao.resultados[i])
 * @param {Object} [contexto]
 * @param {string} [contexto.fornecedorCnpj] - CNPJ do emitente (não fica no produtoXML)
 * @returns {Object} o próprio resultado, se já decidido pela regra atual; senão, um novo resultado revalidado
 */
function revalidarResultadoPersistido(resultado, contexto = {}) {
  if (!resultado || typeof resultado !== 'object' || decididoPelaRegraAtual(resultado)) {
    return resultado;
  }

  const produtoXML = resultado.produtoXML || {};
  const itemXml = {
    ...produtoXML,
    fornecedor_cnpj: produtoXML.fornecedor_cnpj ?? produtoXML.fornecedorCnpj ?? contexto.fornecedorCnpj ?? null
  };
  const tokensXml = extrairTokensDescricao(produtoXML.produto_nome ?? produtoXML.descricao ?? produtoXML.xProd ?? '');

  const candidatos = candidatosGravados(resultado)
    .map((c) => revisarCandidato(c, tokensXml))
    .filter((c) => compativel(c, itemXml));

  const pipeline = aplicarPoliticaNoResultado(itemXml, { candidatos, decisao: {} });
  const revalidado = mapearDecisaoPipelineParaImportacao(null, pipeline);

  const anteriorId = Number(resultado.produtoEncontrado?.id) || null;
  const novoId = Number(revalidado.produtoEncontrado?.id) || null;
  const alterado = anteriorId !== novoId
    || resultado.acao !== revalidado.acao
    || Boolean(resultado.associadoAutomaticamente) !== revalidado.associadoAutomaticamente
    || Boolean(resultado.precisaConfirmacao) !== revalidado.precisaConfirmacao
    || Boolean(resultado.precisaCadastro) !== revalidado.precisaCadastro
    || Number(resultado.score ?? 0) !== revalidado.score;

  return {
    ...resultado,
    ...revalidado,
    indice: resultado.indice,
    produtoXML: resultado.produtoXML,
    operacaoId: resultado.operacaoId ?? null,
    mie: resultado.mie ?? null,
    revalidacao: {
      origem: ORIGEM_REVALIDACAO,
      regraAnterior: resultado.regraIdentificacao ?? null,
      alterado,
      anterior: {
        acao: resultado.acao ?? null,
        produtoId: anteriorId,
        score: Number(resultado.score ?? 0),
        associadoAutomaticamente: Boolean(resultado.associadoAutomaticamente)
      }
    }
  };
}

function contarResumo(resultados, anterior = {}) {
  return {
    ...(anterior && typeof anterior === 'object' ? anterior : {}),
    totalItens: resultados.length,
    identificadosAutomaticamente: resultados.filter((r) => r?.associadoAutomaticamente).length,
    precisamConfirmacao: resultados.filter((r) => r?.precisaConfirmacao).length,
    precisamCadastro: resultados.filter((r) => r?.precisaCadastro).length
  };
}

/**
 * @param {Object[]} resultados
 * @param {Object} [contexto]
 * @returns {{ resultados: Object[], revalidados: number, alterados: number }}
 */
function revalidarResultados(resultados, contexto = {}) {
  let revalidados = 0;
  let alterados = 0;
  const lista = (Array.isArray(resultados) ? resultados : []).map((r) => {
    const novo = revalidarResultadoPersistido(r, contexto);
    if (novo !== r) {
      revalidados += 1;
      if (novo.revalidacao?.alterado) alterados += 1;
    }
    return novo;
  });
  return { resultados: lista, revalidados, alterados };
}

/**
 * Bloco { resultados, resumo, ... } (parse_json.miip_importacao ou miip_resumo_json).
 *
 * @param {Object|null} bloco
 * @param {Object} [contexto]
 * @returns {Object|null}
 */
function revalidarBlocoMiipPersistido(bloco, contexto = {}) {
  if (!bloco || typeof bloco !== 'object' || !Array.isArray(bloco.resultados)) return bloco;
  const { resultados, revalidados, alterados } = revalidarResultados(bloco.resultados, contexto);
  if (revalidados === 0) return bloco;
  return {
    ...bloco,
    resultados,
    resumo: contarResumo(resultados, bloco.resumo),
    revalidacao: {
      origem: ORIGEM_REVALIDACAO,
      regra: VERSAO_REGRA_IDENTIFICACAO,
      revalidados,
      alterados
    }
  };
}

/** Escolha do operador gravada na revisão: a revalidação nunca desfaz. */
function itemDecididoNaRevisao(item) {
  return Boolean(item?.miip_revisao_status || item?.miip_revisao_decisao
    || (Array.isArray(item?.correcoes_produto) && item.correcoes_produto.length));
}

function alinharItem(item, anterior, novo) {
  if (!item || typeof item !== 'object' || novo === anterior) return item;
  const alinhado = { ...item, miip_resultado: novo };

  const sugestao = MiipImportacaoXmlService.paraSugestaoUi(novo);
  if (sugestao) alinhado.miip_sugestao = sugestao;
  else delete alinhado.miip_sugestao;

  const vinculoAutomaticoAnterior = anterior?.associadoAutomaticamente && Number(anterior?.produtoEncontrado?.id);
  if (
    vinculoAutomaticoAnterior
    && !novo.associadoAutomaticamente
    && Number(item.produto_id) === vinculoAutomaticoAnterior
    && !itemDecididoNaRevisao(item)
  ) {
    alinhado.produto_id = null;
  }
  return alinhado;
}

/**
 * Parse gravado do documento (parse_json): resultados, resumo e itens coerentes com a regra atual.
 * Retorna o mesmo objeto quando não há resultado de regra anterior.
 *
 * @param {Object|null} parse
 * @returns {Object|null}
 */
function revalidarParseMiipPersistido(parse) {
  if (!parse || typeof parse !== 'object') return parse;
  const bloco = parse.miip_importacao;
  const contexto = { fornecedorCnpj: parse.fornecedor_cnpj || parse.fornecedorCnpj || null };
  const blocoNovo = revalidarBlocoMiipPersistido(bloco, contexto);
  if (blocoNovo === bloco) return parse;

  const itens = Array.isArray(parse.itens)
    ? parse.itens.map((item, posicao) => {
      const anterior = bloco.resultados[posicao];
      const novo = blocoNovo.resultados[posicao];
      return alinharItem(item, anterior, novo);
    })
    : parse.itens;

  return { ...parse, miip_importacao: blocoNovo, itens };
}

module.exports = {
  ORIGEM_REVALIDACAO,
  decididoPelaRegraAtual,
  revalidarResultadoPersistido,
  revalidarResultados,
  revalidarBlocoMiipPersistido,
  revalidarParseMiipPersistido,
  itemDecididoNaRevisao
};
