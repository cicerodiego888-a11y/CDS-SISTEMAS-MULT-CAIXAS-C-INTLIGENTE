'use strict';

const { consultarProtocolo } = require('../fiscal/consultaProtocoloRuntime');
const { ModelType } = require('../fiscal/core/ModelType');
const { getFiscalConfig } = require('../fiscal/configService');
const { parseRetornoAutorizacaoNfe } = require('../fiscal/nfeRetornoAutorizacao');
const { extrairChaveConflito539 } = require('../fiscal/nfeNumeracaoNfeService');
const { gravarAuditoria } = require('../auditoria');
const {
  SITUACAO_NFCE,
  extrairCStats,
  classificarSituacaoFiscalDaVenda
} = require('./NfceSituacaoFiscalService');

const CSTAT_CANCELADA = new Set(['101', '135', '136', '155']);
const CSTAT_SEM_AUTORIZACAO = new Set(['217']);
const CSTAT_PENDENTE = new Set(['103', '104', '105', '106', '108', '109', '656']);

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function tag(xml, nome) {
  const match = String(xml || '').match(new RegExp(`<${nome}[^>]*>\\s*([^<]*)\\s*</${nome}>`, 'i'));
  return match ? String(match[1]).trim() : null;
}

function interpretarRespostaConsulta(consulta) {
  if (!consulta || consulta.success !== true) {
    return {
      situacao_fiscal: SITUACAO_NFCE.ERRO,
      motivo: consulta?.error || consulta?.message || 'Falha técnica na consulta fiscal.',
      erro_tecnico: consulta?.error || consulta?.message || 'CONSULTA_SEM_SUCESSO',
      cstat_consulta: consulta?.cStat || null,
      cstats_consulta: []
    };
  }

  const evidencia = String(consulta.body || '');
  const parsed = parseRetornoAutorizacaoNfe(evidencia);
  const cstats = extrairCStats(evidencia);
  const cStat = parsed.cStat || consulta.cStat || cstats[0] || null;
  const xMotivo = parsed.xMotivo || consulta.xMotivo || tag(evidencia, 'xMotivo');
  const protocolo = parsed.nProt || tag(evidencia, 'nProt');
  const chaveRetornada = parsed.chNFe || tag(evidencia, 'chNFe');
  const texto = `${xMotivo || ''}\n${evidencia}`;

  if (cstats.some((c) => CSTAT_CANCELADA.has(c)) || /cancelamento homologado|cancelad[ao]/i.test(texto)) {
    return {
      situacao_fiscal: SITUACAO_NFCE.CANCELADA,
      motivo: xMotivo || 'Cancelamento confirmado pela consulta fiscal.',
      cstat_consulta: cStat,
      cstats_consulta: cstats,
      protocolo,
      chave_retornada: chaveRetornada,
      erro_tecnico: null
    };
  }

  if (
    (parsed.status === 'autorizada' || cstats.includes('100') || cstats.includes('150'))
    && Boolean(protocolo)
  ) {
    return {
      situacao_fiscal: SITUACAO_NFCE.AUTORIZADA,
      motivo: xMotivo || 'Documento autorizado localizado na SEFAZ.',
      cstat_consulta: ['100', '150'].find((c) => cstats.includes(c)) || cStat,
      cstats_consulta: cstats,
      protocolo,
      chave_retornada: chaveRetornada,
      erro_tecnico: null
    };
  }

  if (cStat && CSTAT_SEM_AUTORIZACAO.has(String(cStat))) {
    return {
      situacao_fiscal: SITUACAO_NFCE.REJEITADA,
      motivo: xMotivo || 'A consulta confirmou que o documento não consta na SEFAZ.',
      cstat_consulta: String(cStat),
      cstats_consulta: cstats,
      protocolo: null,
      chave_retornada: chaveRetornada,
      erro_tecnico: null
    };
  }

  if (!cStat || CSTAT_PENDENTE.has(String(cStat))) {
    return {
      situacao_fiscal: SITUACAO_NFCE.PENDENTE,
      motivo: xMotivo || 'Situação fiscal ainda não confirmada.',
      cstat_consulta: cStat,
      cstats_consulta: cstats,
      protocolo: null,
      chave_retornada: chaveRetornada,
      erro_tecnico: null
    };
  }

  return {
    situacao_fiscal: SITUACAO_NFCE.DESCONHECIDA,
    motivo: xMotivo || 'Resposta da consulta não pôde ser interpretada com segurança.',
    cstat_consulta: String(cStat),
    cstats_consulta: cstats,
    protocolo: protocolo || null,
    chave_retornada: chaveRetornada,
    erro_tecnico: null
  };
}

async function recuperarSituacaoDuplicidade(input = {}, deps = {}) {
  const db = deps.db || require('../../database');
  const consultar = deps.consultarProtocolo || consultarProtocolo;
  const carregarConfig = deps.getFiscalConfig || getFiscalConfig;
  const auditar = deps.gravarAuditoria || gravarAuditoria;
  const vendaId = Number(input.venda_id || 0);
  const nfceId = Number(input.nfce_id || 0);

  if (input.confirmacao_consulta !== true) {
    throw Object.assign(new Error('Confirmação explícita obrigatória antes de consultar a SEFAZ.'), {
      code: 'CONFIRMACAO_CONSULTA_OBRIGATORIA',
      statusCode: 400
    });
  }

  if (!(vendaId > 0)) {
    throw Object.assign(new Error('Venda inválida para recuperação fiscal.'), {
      code: 'VENDA_INVALIDA',
      statusCode: 400
    });
  }

  const nota = await get(
    db,
    `SELECT * FROM nfce_notas
     WHERE venda_id = ? ${nfceId > 0 ? 'AND id = ?' : ''}
     ORDER BY id DESC LIMIT 1`,
    nfceId > 0 ? [vendaId, nfceId] : [vendaId]
  );
  if (!nota) {
    throw Object.assign(new Error('Tentativa de NFC-e não encontrada para a venda.'), {
      code: 'NFCE_NAO_ENCONTRADA',
      statusCode: 404
    });
  }

  const atual = await classificarSituacaoFiscalDaVenda(db, vendaId);
  const repetivel = [
    SITUACAO_NFCE.DUPLICIDADE_PENDENTE,
    SITUACAO_NFCE.PENDENTE,
    SITUACAO_NFCE.ERRO,
    SITUACAO_NFCE.DESCONHECIDA
  ].includes(atual.situacao);
  if (!repetivel && input.forcar !== true) {
    return {
      ...atual,
      success: true,
      consultou_sefaz: false,
      reutilizado: true,
      mensagem: 'Situação fiscal definitiva já recuperada; nenhuma nova consulta foi feita.'
    };
  }

  const cstatsOriginais = extrairCStats(nota.xml_retorno);
  if (
    !cstatsOriginais.includes('539')
    && String(nota.status || '').toLowerCase() !== 'rejeitada_duplicidade'
  ) {
    throw Object.assign(new Error('A tentativa selecionada não possui evidência de cStat 539.'), {
      code: 'NFCE_NAO_E_DUPLICIDADE_539',
      statusCode: 409
    });
  }

  const chaveConsultada = extrairChaveConflito539(null, nota.xml_retorno);
  if (!chaveConsultada || String(chaveConsultada).length !== 44) {
    throw Object.assign(new Error('O retorno cStat 539 não contém uma chave SEFAZ válida para consulta.'), {
      code: 'CHAVE_539_NAO_ENCONTRADA',
      statusCode: 422
    });
  }

  const inicio = Date.now();
  let consulta = null;
  let decisao;
  let config = null;
  try {
    config = await carregarConfig({ validarUrls: false });
    consulta = await consultar({
      chave: chaveConsultada,
      modelo: ModelType.NFCE,
      ambiente: nota.ambiente || config.ambiente,
      cUF: config.codigoUf,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha
    });
    decisao = interpretarRespostaConsulta(consulta);
  } catch (err) {
    decisao = {
      situacao_fiscal: SITUACAO_NFCE.ERRO,
      motivo: 'Não foi possível consultar a situação fiscal.',
      cstat_consulta: null,
      cstats_consulta: [],
      protocolo: null,
      chave_retornada: null,
      erro_tecnico: String(err?.message || err)
    };
  }

  const detalhes = {
    venda_id: vendaId,
    nfce_id: Number(nota.id),
    chave_consultada: chaveConsultada,
    chave_retornada: decisao.chave_retornada || null,
    cstat_original: cstatsOriginais.includes('539') ? '539' : cstatsOriginais[0] || null,
    cstats_originais: cstatsOriginais,
    resultado_consulta: decisao.motivo,
    cstat_consulta: decisao.cstat_consulta || null,
    cstats_consulta: decisao.cstats_consulta || [],
    novo_cstat: decisao.cstat_consulta || null,
    situacao_fiscal: decisao.situacao_fiscal,
    protocolo: decisao.protocolo || null,
    ambiente: Number(nota.ambiente || config?.ambiente || 2),
    consultado_em: new Date().toISOString(),
    origem_recuperacao: 'FECHAMENTO_FISCAL_DUPLICIDADE_539',
    erro_tecnico: decisao.erro_tecnico || null,
    duracao_ms: Date.now() - inicio,
    evidencia_disponivel: Boolean(consulta?.body),
    evidencia_consulta: consulta?.body || null,
    fonte_consulta: consulta?.source || null
  };

  await auditar({
    usuario_id: input.usuario_id || null,
    usuario_nome: input.usuario_nome || null,
    modulo: 'fechamento_fiscal',
    acao: 'recuperar_duplicidade_nfce',
    referencia_tipo: 'nfce',
    referencia_id: Number(nota.id),
    detalhes,
    ip_requisicao: input.ip_requisicao || null
  });

  return {
    success: decisao.situacao_fiscal !== SITUACAO_NFCE.ERRO,
    consultou_sefaz: true,
    reutilizado: false,
    ...detalhes,
    evidencia_consulta: undefined,
    mensagem: decisao.motivo
  };
}

module.exports = {
  interpretarRespostaConsulta,
  recuperarSituacaoDuplicidade
};
