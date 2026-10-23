'use strict';

const { sanitizarErroItem } = require('../fiscal/diagnosticoItensFiscais');

const MAX_MESSAGE_LENGTH = 500;

function sanitizarMensagem(valor) {
  let mensagem = String(valor == null ? '' : valor)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, '[conteúdo sensível omitido]')
    .replace(/\b(?:bearer|basic)\s+[a-z0-9+/=._-]+/gi, '[credencial omitida]')
    .replace(/\b(password|passwd|senha|token|secret|authorization|certificadoSenha)\b\s*[:=]\s*[^,;\s]+/gi, '$1=[omitido]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento omitido]')
    .replace(/<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, '[conteúdo XML omitido]')
    .replace(/<[^>]*>/g, '[conteúdo XML omitido]')
    .replace(/\s+at\s+[\w.$/\\-]+(?::\d+){1,2}\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!mensagem) return 'Falha técnica sem mensagem segura disponível.';
  if (mensagem.length > MAX_MESSAGE_LENGTH) {
    mensagem = `${mensagem.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`;
  }
  return mensagem;
}

function normalizarCodigo(valor) {
  const codigo = String(valor || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(codigo) ? codigo : 'XML_ERRO';
}

function criarDiagnosticoPreparacao({
  etapa,
  codigo,
  mensagem,
  correlationId,
  ocorridoEm,
  componente,
  errosItens
}) {
  const itens = sanitizarErrosItens(errosItens);
  return {
    etapa: ['montagem_xml', 'validacao_xml', 'geracao_xml'].includes(etapa)
      ? etapa
      : 'geracao_xml',
    codigo: normalizarCodigo(codigo),
    mensagem: sanitizarMensagem(mensagem),
    correlationId: String(correlationId || ''),
    ocorridoEm: String(ocorridoEm || new Date().toISOString()),
    componente: componente === 'xmlBuilder' || componente === 'validarXmlFiscal'
      ? componente
      : 'FechamentoFiscalPreparacaoService',
    ...(itens.length ? { erros_itens: itens } : {})
  };
}

function sanitizarErrosItens(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map(sanitizarErroItem).filter(Boolean).map((e) => ({
    ...e,
    mensagem: sanitizarMensagem(e.mensagem)
  }));
}

function sanitizarDiagnosticosDocumentos(documentos) {
  if (!Array.isArray(documentos)) return [];

  return documentos.flatMap((documento) => {
    if (!documento || typeof documento !== 'object' || !Array.isArray(documento.erros)) return [];
    return documento.erros.map((erro) => {
      const itens = sanitizarErrosItens(erro?.erros_itens);
      return {
        id: documento.id != null && documento.id !== ''
          && Number.isSafeInteger(Number(documento.id))
          ? Number(documento.id)
          : undefined,
        sequencia: documento.sequencia != null && documento.sequencia !== ''
          && Number.isSafeInteger(Number(documento.sequencia))
          ? Number(documento.sequencia)
          : undefined,
        etapa: ['montagem_xml', 'validacao_xml', 'geracao_xml'].includes(erro?.etapa)
          ? erro.etapa
          : 'geracao_xml',
        codigo: normalizarCodigo(erro?.codigo),
        mensagem: sanitizarMensagem(erro?.mensagem),
        ...(itens.length ? { erros_itens: itens } : {})
      };
    });
  });
}

function criarPayloadErroXml(erro) {
  const correlationId = /^[A-Za-z0-9._-]{1,100}$/.test(String(erro?.correlationId || ''))
    ? String(erro.correlationId)
    : undefined;
  const documentos = sanitizarDiagnosticosDocumentos(erro?.documentos);
  const errosItens = documentos.flatMap((d) => (d.erros_itens || []).map((item) => ({
    documento_id: d.id,
    sequencia: d.sequencia,
    ...item
  })));
  return {
    error: 'Falha ao gerar XML de um ou mais documentos.',
    code: 'XML_ERRO',
    ...(correlationId ? { correlationId } : {}),
    documentos,
    ...(errosItens.length ? { erros_itens: errosItens } : {})
  };
}

module.exports = {
  criarPayloadErroXml,
  criarDiagnosticoPreparacao,
  sanitizarDiagnosticosDocumentos,
  sanitizarMensagem
};
