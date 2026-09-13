/**
 * Preflight obrigatório da NF-e de devolução — único ponto antes de assinar/transmitir.
 */

'use strict';

const { auditarNfe } = require('./auditoriaFiscalNfe');
const { calcularHashXml, validarChaveContraXml } = require('./nfeXmlIdentityService');
const {
  parseChaveNfe,
  validarDisponibilidadeNumero,
  validarConflitoDeChave,
  identidadeDoBuilt
} = require('./nfeIdentityService');
const { classificarRetornoSefaz, ACOES } = require('./classificarRetornoSefaz');
const { lockAtivo } = require('./nfeEmissionLockService');

function preflightNfeDevolucao({
  tipoDocumento = 'DEVOLUCAO_COMPRA',
  xml,
  built,
  config = {},
  itens,
  compraId,
  vendaId,
  documentosPorChave = [],
  documentosPorNumero = [],
  estadoAnterior = {},
  xmlAssinadoAnterior = null
} = {}) {
  const erros = [];
  const chave = built && built.chave;
  const parsed = parseChaveNfe(chave);

  const auditoria = auditarNfe({
    tipoDocumento,
    emitente: { cnpj: config.cnpj },
    itens,
    xml,
    contexto: {
      compraId,
      vendaId,
      nfeNumero: parsed && parsed.numero,
      debugPrefix: compraId != null ? String(compraId) : (vendaId != null ? `venda-${vendaId}` : null)
    }
  });
  if (!auditoria.aprovado) {
    erros.push(...auditoria.erros);
  }

  try {
    validarChaveContraXml(chave, xml);
  } catch (e) {
    erros.push({ codigo: e.code || 'CHAVE_INVALIDA', mensagem: e.message, severidade: 'ERRO' });
  }

  if (parsed && config.cnpj && parsed.cnpj !== String(config.cnpj).replace(/\D/g, '').padStart(14, '0')) {
    erros.push({
      codigo: 'IDENTIDADE_CNPJ',
      mensagem: 'CNPJ da chave diverge do emitente configurado.',
      severidade: 'ERRO'
    });
  }

  const xmlHash = xml ? calcularHashXml(xml) : null;

  const { numeroOcupadoSefazEmMemoria } = require('./nfeNumeracaoNfeService');
  if (parsed && numeroOcupadoSefazEmMemoria({
    numero: parsed.numero,
    serie: built && built.serie,
    ambiente: config.ambiente
  })) {
    erros.push({
      codigo: 'NUMERO_OCUPADO_SEFAZ',
      mensagem:
        `O número ${parsed.numero}/${built && built.serie} já existe na SEFAZ com outra chave de acesso (rejeição 539). `
        + 'Não retransmita. Uma nova NF-e deve usar o próximo número livre da série.',
      severidade: 'ERRO'
    });
  }

  try {
    validarDisponibilidadeNumero({
      numero: parsed && parsed.numero,
      serie: built && built.serie,
      ambiente: config.ambiente,
      documentos: documentosPorNumero
    });
  } catch (e) {
    erros.push({ codigo: e.code || 'NUMERO_FISCAL_EM_USO', mensagem: e.message, severidade: 'ERRO' });
  }

  try {
    validarConflitoDeChave({
      chave,
      xml,
      documentos: documentosPorChave
    });
  } catch (e) {
    erros.push({ codigo: e.code || 'CHAVE_XML_CONFLITO', mensagem: e.message, severidade: 'ERRO' });
  }

  if (xmlAssinadoAnterior && xml && calcularHashXml(xml) !== calcularHashXml(xmlAssinadoAnterior)) {
    const mesmaChave = documentosPorChave.some((d) =>
      String(d.chave_acesso || '').replace(/\D/g, '') === String(chave || '').replace(/\D/g, '')
    );
    if (mesmaChave) {
      erros.push({
        codigo: 'CHAVE_XML_CONFLITO',
        mensagem:
          'Conflito fiscal: esta chave de acesso já está associada a um documento com conteúdo diferente. Uma nova NF-e deve receber nova identidade fiscal.',
        severidade: 'ERRO'
      });
    }
  }

  const cls = classificarRetornoSefaz(
    estadoAnterior.cstat_retorno || estadoAnterior.rejeicao_codigo,
    estadoAnterior.xmotivo_retorno
  );
  if (cls.acao === ACOES.EXIGE_CORRECAO || cls.acao === ACOES.EXIGE_NOVA_IDENTIDADE) {
    if (estadoAnterior.chave_acesso && String(estadoAnterior.chave_acesso).replace(/\D/g, '') === String(chave || '').replace(/\D/g, '')) {
      erros.push({
        codigo: 'NOVA_IDENTIDADE_OBRIGATORIA',
        mensagem: cls.mensagemReenvio || 'Esta rejeição exige nova emissão com nova identidade fiscal.',
        severidade: 'ERRO'
      });
    }
  }
  if (cls.acao === ACOES.SINCRONIZAR_DOCUMENTO_EXISTENTE) {
    erros.push({
      codigo: 'SINCRONIZAR_ANTES_TRANSMITIR',
      mensagem: cls.mensagemReenvio,
      severidade: 'ERRO'
    });
  }

  const lockEscopo = compraId != null
    ? `devolucao-compra:${compraId}`
    : (vendaId != null ? `devolucao-venda:${vendaId}` : null);
  if (lockEscopo && !lockAtivo(lockEscopo)) {
    /* preflight pode rodar com lock já adquirido pelo caller */
  }

  const aprovado = erros.length === 0 && auditoria.aprovado;
  const relatorio = {
    aprovado,
    xmlHash,
    identidade: identidadeDoBuilt(built || {}, { cnpj: config.cnpj, ambiente: config.ambiente }),
    classificacaoAnterior: cls,
    auditoria,
    erros,
    preflightObrigatorio: true
  };

  return relatorio;
}

function assertPreflightAprovado(relatorio) {
  if (!relatorio || !relatorio.aprovado) {
    const msg = (relatorio && relatorio.erros || [])
      .map((e) => e.mensagem)
      .filter(Boolean)
      .join('\n') || 'Preflight fiscal reprovado.';
    const err = new Error(msg);
    err.code = 'PREFLIGHT_REPROVADO';
    err.preflight = relatorio;
    throw err;
  }
  return relatorio;
}

module.exports = {
  preflightNfeDevolucao,
  assertPreflightAprovado
};
