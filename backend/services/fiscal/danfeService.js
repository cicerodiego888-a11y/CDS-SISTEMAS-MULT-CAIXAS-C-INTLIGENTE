/**
 * Central de DANFE — NF-e modelo 55 (venda, devolução de compra, devolução de venda).
 * Localiza o documento persistido e entrega DANFE / XML autorizado / PDF.
 * Não emite, não assina, não reserva numeração e não reconstrói identidade fiscal.
 */

'use strict';

const db = require('../../database');
const { gerarDanfeNfeHtml, gerarDanfeNfePdf } = require('./danfeNfe');

const TIPOS = Object.freeze({
  VENDA: 'VENDA',
  DEVOLUCAO_COMPRA: 'DEVOLUCAO_COMPRA',
  DEVOLUCAO_VENDA: 'DEVOLUCAO_VENDA'
});

const TABELAS = Object.freeze({
  [TIPOS.VENDA]: 'nfe_notas',
  [TIPOS.DEVOLUCAO_COMPRA]: 'nfe_devolucoes_compra',
  [TIPOS.DEVOLUCAO_VENDA]: 'nfe_devolucoes_venda'
});

function onlyDigits(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function fiscalError(message, code, statusCode = 400) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function normalizarTipoDocumento(tipo) {
  const t = String(tipo || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (t === 'VENDA' || t === 'NFE' || t === 'NF_E' || t === 'NORMAL') return TIPOS.VENDA;
  if (t === 'DEVOLUCAO_COMPRA' || t === 'COMPRA' || t === 'DEV_COMPRA') return TIPOS.DEVOLUCAO_COMPRA;
  if (t === 'DEVOLUCAO_VENDA' || t === 'VENDA_DEVOLUCAO' || t === 'DEV_VENDA') return TIPOS.DEVOLUCAO_VENDA;
  return null;
}

function statusEhAutorizado(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'autorizada' || s === 'autorizado' || s === '100' || s === '150';
}

function statusBloqueiaDanfeAutorizado(status) {
  const s = String(status || '').trim().toLowerCase();
  return (
    !s
    || s === 'rascunho'
    || s.includes('pendente')
    || s.includes('rejeit')
    || s.includes('erro')
    || s.includes('deneg')
    || s === 'transmitindo'
    || s === 'processando'
  );
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function tagXml(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function extrairXmlPersistido(row) {
  const autorizado = String(row?.xml_autorizado || '').trim();
  if (autorizado) return autorizado;

  const retorno = String(row?.xml_retorno || '');
  const enviado = String(row?.xml_enviado || row?.xml_assinado || '');
  const nfeProc = retorno.match(/<nfeProc[\s\S]*?<\/nfeProc>/i);
  if (nfeProc) return nfeProc[0];
  if (retorno.includes('<protNFe') && enviado.includes('<NFe')) {
    const nfe = enviado.match(/<NFe[\s\S]*?<\/NFe>/i);
    const prot = retorno.match(/<protNFe[\s\S]*?<\/protNFe>/i);
    if (nfe && prot) {
      return `<?xml version="1.0" encoding="UTF-8"?>`
        + `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">`
        + `${nfe[0]}${prot[0]}</nfeProc>`;
    }
  }
  return '';
}

function validarIdentidadeDocumento(doc, esperado = {}) {
  if (!doc) {
    throw fiscalError('Documento fiscal não encontrado.', 'DOCUMENTO_NAO_ENCONTRADO', 404);
  }
  const chaveDoc = onlyDigits(doc.chave);
  const chaveEsp = onlyDigits(esperado.chave);
  if (chaveEsp && chaveDoc && chaveEsp !== chaveDoc) {
    throw fiscalError(
      'A chave de acesso não corresponde ao documento persistido.',
      'IDENTIDADE_DIVERGENTE',
      409
    );
  }
  if (esperado.numero != null && esperado.numero !== '' && String(doc.numero) !== String(esperado.numero)) {
    throw fiscalError('O número da NF-e não corresponde ao documento persistido.', 'IDENTIDADE_DIVERGENTE', 409);
  }
  if (esperado.serie != null && esperado.serie !== '' && String(doc.serie) !== String(esperado.serie)) {
    throw fiscalError('A série da NF-e não corresponde ao documento persistido.', 'IDENTIDADE_DIVERGENTE', 409);
  }
  if (chaveDoc && chaveDoc.length !== 44) {
    throw fiscalError('NF-e sem chave de acesso válida (44 dígitos).', 'CHAVE_INVALIDA', 409);
  }
  return true;
}

function validarDocumentoAutorizado(doc, esperado = {}) {
  validarIdentidadeDocumento(doc, esperado);
  if (!statusEhAutorizado(doc.status)) {
    throw fiscalError(
      'DANFE autorizado só está disponível para NF-e com status AUTORIZADA.',
      'DOCUMENTO_NAO_AUTORIZADO',
      409
    );
  }
  if (statusBloqueiaDanfeAutorizado(doc.status)) {
    throw fiscalError(
      'Este documento não pode ser apresentado como DANFE autorizado.',
      'DOCUMENTO_NAO_AUTORIZADO',
      409
    );
  }
  return true;
}

function mapearDocumento(tipo, row) {
  if (!row) return null;
  return {
    modelo: '55',
    tipo,
    id: Number(row.id),
    numero: row.numero,
    serie: row.serie,
    chave: onlyDigits(row.chave_acesso),
    status: row.status,
    protocolo: row.protocolo || null,
    recibo: row.recibo || null,
    dhAutorizacao: row.dh_recbto || row.autorizado_em || row.updated_at || row.created_at || null,
    natureza: row.natureza_operacao || null,
    cfop: row.cfop || null,
    chaveReferenciada: onlyDigits(row.chave_referenciada || ''),
    origemId: row.venda_id || row.compra_id || null,
    danfeHtml: row.danfe_html || null,
    xmlAutorizado: row.xml_autorizado || null,
    xmlEnviado: row.xml_enviado || row.xml_assinado || null,
    xmlRetorno: row.xml_retorno || null,
    destinatarioNome: row.cliente_nome || row.fornecedor || null,
    destinatarioDoc: row.cliente_cpf || row.fornecedor_cnpj || null,
    row
  };
}

async function buscarLinhaPorTipoId(tipo, id) {
  const tabela = TABELAS[tipo];
  if (!tabela) return null;
  return dbGet(`SELECT * FROM ${tabela} WHERE id = ?`, [Number(id)]);
}

async function buscarLinhaPorChave(chave) {
  const ch = onlyDigits(chave);
  if (ch.length !== 44) return null;
  const venda = await dbGet(`SELECT * FROM nfe_notas WHERE chave_acesso = ? ORDER BY id DESC LIMIT 1`, [ch]);
  if (venda) return { tipo: TIPOS.VENDA, row: venda };
  const compra = await dbGet(
    `SELECT * FROM nfe_devolucoes_compra WHERE chave_acesso = ? ORDER BY id DESC LIMIT 1`,
    [ch]
  );
  if (compra) return { tipo: TIPOS.DEVOLUCAO_COMPRA, row: compra };
  const devVenda = await dbGet(
    `SELECT * FROM nfe_devolucoes_venda WHERE chave_acesso = ? ORDER BY id DESC LIMIT 1`,
    [ch]
  );
  if (devVenda) return { tipo: TIPOS.DEVOLUCAO_VENDA, row: devVenda };
  return null;
}

async function obterDocumentoFiscal(ref = {}) {
  const chave = onlyDigits(ref.chave);
  let tipo = normalizarTipoDocumento(ref.tipo || ref.origem);
  const id = Number(ref.id || ref.notaId || ref.nota_id || 0) || null;

  if (!tipo && chave) {
    const achado = await buscarLinhaPorChave(chave);
    if (!achado) throw fiscalError('Documento fiscal não encontrado.', 'DOCUMENTO_NAO_ENCONTRADO', 404);
    return mapearDocumento(achado.tipo, achado.row);
  }
  if (!tipo) {
    throw fiscalError('Informe o tipo do documento (VENDA, DEVOLUCAO_COMPRA ou DEVOLUCAO_VENDA).', 'TIPO_INVALIDO', 400);
  }
  if (!id && chave) {
    const achado = await buscarLinhaPorChave(chave);
    if (!achado || achado.tipo !== tipo) {
      throw fiscalError('Documento fiscal não encontrado.', 'DOCUMENTO_NAO_ENCONTRADO', 404);
    }
    return mapearDocumento(achado.tipo, achado.row);
  }
  if (!id) throw fiscalError('Informe o id do documento fiscal.', 'ID_INVALIDO', 400);

  const row = await buscarLinhaPorTipoId(tipo, id);
  const doc = mapearDocumento(tipo, row);
  if (!doc) throw fiscalError('Documento fiscal não encontrado.', 'DOCUMENTO_NAO_ENCONTRADO', 404);
  validarIdentidadeDocumento(doc, { chave: ref.chave, numero: ref.numero, serie: ref.serie });
  return doc;
}

function aplicarCssImpressaoA4(html) {
  const css = `
<style id="cds-danfe-print-a4">
  @page { size: A4 portrait; margin: 5mm; }
  html, body { background: #fff; }
  .danfe-toolbar, .no-print { display: block; }
  @media print {
    .danfe-toolbar, .no-print, button { display: none !important; }
    body { margin: 0; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>`;
  const src = String(html || '');
  if (/id="cds-danfe-print-a4"/.test(src)) return src;
  if (/<\/head>/i.test(src)) return src.replace(/<\/head>/i, `${css}</head>`);
  return css + src;
}

async function montarHtmlDanfe(doc, { previa = false } = {}) {
  const xml = extrairXmlPersistido(doc.row || doc);
  const html = await gerarDanfeNfeHtml({
    xml,
    chave: doc.chave,
    numero: doc.numero,
    serie: doc.serie,
    protocolo: doc.protocolo,
    status: previa ? 'PREVIA' : (doc.status || 'autorizada'),
    natureza: doc.natureza,
    dhAutorizacao: doc.dhAutorizacao,
    chaveReferenciada: doc.chaveReferenciada,
    venda: { cliente_nome: doc.destinatarioNome, cliente_cpf: doc.destinatarioDoc }
  });
  return aplicarCssImpressaoA4(html);
}

async function obterDanfe(ref = {}) {
  const doc = await obterDocumentoFiscal(ref);
  validarDocumentoAutorizado(doc, ref);
  const html = await montarHtmlDanfe(doc);
  return { documento: resumirDocumento(doc), html, xml: extrairXmlPersistido(doc.row || doc) };
}

async function obterXmlAutorizado(ref = {}) {
  const doc = await obterDocumentoFiscal(ref);
  validarDocumentoAutorizado(doc, ref);
  const xml = extrairXmlPersistido(doc.row || doc);
  if (!xml) {
    throw fiscalError('XML autorizado não está persistido para este documento.', 'XML_NAO_DISPONIVEL', 404);
  }
  const chaveXml = onlyDigits(tagXml(xml, 'chNFe') || xml.match(/Id="NFe(\d{44})"/i)?.[1]);
  if (chaveXml && doc.chave && chaveXml !== doc.chave) {
    throw fiscalError(
      'O XML persistido não corresponde à chave do documento.',
      'IDENTIDADE_DIVERGENTE',
      409
    );
  }
  const nome = `NFE-${doc.chave || doc.id}.xml`;
  return { documento: resumirDocumento(doc), xml, nome };
}

function gerarPdfDanfeBuffer(doc, extra = {}) {
  const xml = extra.xml || extrairXmlPersistido(doc.row || extra.row || doc);
  return gerarDanfeNfePdf({
    xml,
    chave: extra.chave || doc.chave,
    numero: extra.numero != null ? extra.numero : doc.numero,
    serie: extra.serie != null ? extra.serie : doc.serie,
    protocolo: extra.protocolo || doc.protocolo,
    status: extra.status || doc.status || 'autorizada',
    dhAutorizacao: extra.dhAutorizacao || doc.dhAutorizacao,
    chaveReferenciada: extra.chaveReferenciada || doc.chaveReferenciada,
    natureza: extra.natureza || doc.natureza,
    venda: extra.venda,
    itens: extra.itens,
    empresa: extra.empresa
  });
}

async function obterPdfDanfe(ref = {}) {
  const doc = await obterDocumentoFiscal(ref);
  validarDocumentoAutorizado(doc, ref);
  const xml = extrairXmlPersistido(doc.row || doc);
  const html = await montarHtmlDanfe(doc);
  const buffer = gerarDanfeNfePdf({
    xml,
    chave: doc.chave,
    numero: doc.numero,
    serie: doc.serie,
    protocolo: doc.protocolo,
    status: doc.status,
    dhAutorizacao: doc.dhAutorizacao,
    chaveReferenciada: doc.chaveReferenciada
  });
  const nome = documentoNomePdf(doc);
  return { documento: resumirDocumento(doc), html, buffer, nome };
}

function documentoNomePdf(doc) {
  return doc.chave
    ? `DANFE-${doc.chave}.pdf`
    : `DANFE-NFE-${doc.numero || doc.id}-SERIE-${doc.serie || '1'}.pdf`;
}

function resumirDocumento(doc) {
  return {
    modelo: '55',
    tipo: doc.tipo,
    id: doc.id,
    numero: doc.numero,
    serie: doc.serie,
    chave: doc.chave,
    status: doc.status,
    protocolo: doc.protocolo,
    dhAutorizacao: doc.dhAutorizacao,
    chaveReferenciada: doc.chaveReferenciada || null,
    autorizado: statusEhAutorizado(doc.status)
  };
}

module.exports = {
  TIPOS,
  normalizarTipoDocumento,
  statusEhAutorizado,
  statusBloqueiaDanfeAutorizado,
  validarIdentidadeDocumento,
  validarDocumentoAutorizado,
  extrairXmlPersistido,
  aplicarCssImpressaoA4,
  gerarPdfDanfeBuffer,
  obterDocumentoFiscal,
  obterDanfe,
  obterXmlAutorizado,
  obterPdfDanfe
};
