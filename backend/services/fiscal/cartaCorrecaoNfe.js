/**
 * CC-e V1 — Carta de Correção Eletrônica (tpEvento 110110).
 * Evento vinculado à NF-e 55 autorizada. Não altera XML original da NF-e.
 * Reutiliza: assinarEvento, certificado, getFiscalConfig, RecepcaoEvento4 (via cancelamentoRuntime).
 */

'use strict';

const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { assinarEvento } = require('./signer');
const { carregarCertificadoPfx } = require('./certificateService');
const { compactarXml, extrairChaveEProtocoloAutorizados, xmlEscape } = require('./utils');
const { enviarCancelamento } = require('./cancelamentoRuntime');
const { ModelType } = require('./core/ModelType');

const TP_EVENTO_CCE = '110110';
const DESC_EVENTO = 'Carta de Correção';
const X_COND_USO =
  'A Carta de Correção é disciplinada pelo § 1º-A do art. 7º do Convênio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularização de erro ocorrido na emissão de documento fiscal, desde que o erro não esteja relacionado com: I - as variáveis que determinam o valor do imposto tais como: base de cálculo, alíquota, diferença de preço, quantidade, valor da operação ou da prestação; II - a correção de dados cadastrais que implique mudança do remetente ou do destinatário; III - a data de emissão ou de saída.';

const MIN_CORRECAO = 15;
const MAX_CORRECAO = 1000;
const MAX_SEQ = 20;

const AVISO_RESTRICOES =
  'A Carta de Correção não pode ser utilizada para alterar valores, impostos, quantidade, destinatário, remetente ou datas da NF-e.';

function fiscalError(message, statusCode = 400, codigo = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (codigo) {
    err.codigo = codigo;
    err.code = codigo;
  }
  return err;
}

function calcularProximoSeqEvento(maxSeqAtual) {
  const proximo = Number(maxSeqAtual || 0) + 1;
  if (!Number.isInteger(proximo) || proximo < 1) {
    throw fiscalError('Sequencial de CC-e inválido.', 400, 'CCE_SEQ_INVALIDO');
  }
  if (proximo > MAX_SEQ) {
    throw fiscalError(
      `Limite de ${MAX_SEQ} Cartas de Correção atingido para esta NF-e.`,
      400,
      'CCE_LIMITE_SEQ'
    );
  }
  return proximo;
}

function assertNotaPermiteCce(nota) {
  if (!nota) {
    throw fiscalError('NF-e não encontrada.', 404, 'NFE_NAO_ENCONTRADA');
  }
  const st = String(nota.status || '').toLowerCase();
  if (st === 'cancelada') {
    throw fiscalError('NF-e cancelada não admite Carta de Correção.', 400, 'NFE_CANCELADA');
  }
  if (st !== 'autorizada') {
    throw fiscalError(
      `Somente NF-e autorizada admite CC-e (status atual: ${nota.status || '—'}).`,
      400,
      'NFE_NAO_AUTORIZADA'
    );
  }
  return true;
}

function getRecepcaoEventoUrlNfe(ambiente) {
  return Number(ambiente) === 1
    ? 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
    : 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx';
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function normalizarTipoDocumento(tipo) {
  const t = String(tipo || 'VENDA').trim().toUpperCase();
  if (t === 'DEVOLUCAO_COMPRA' || t === 'DEV. COMPRA' || t === 'DEV_COMPRA') return 'DEVOLUCAO_COMPRA';
  if (t === 'DEVOLUCAO_VENDA' || t === 'DEV. VENDA' || t === 'DEV_VENDA') return 'DEVOLUCAO_VENDA';
  return 'VENDA';
}

function resolverFonteDocumento(tipo) {
  const documentoTipo = normalizarTipoDocumento(tipo);
  if (documentoTipo === 'DEVOLUCAO_COMPRA') {
    return { documentoTipo, tabela: 'nfe_devolucoes_compra' };
  }
  if (documentoTipo === 'DEVOLUCAO_VENDA') {
    return { documentoTipo, tabela: 'nfe_devolucoes_venda' };
  }
  return { documentoTipo: 'VENDA', tabela: 'nfe_notas' };
}

function extrairXmlAutorizacaoNota(nota) {
  return String(
    nota?.xml_retorno ||
    nota?.xml_autorizado ||
    nota?.xml_assinado ||
    nota?.xml_enviado ||
    ''
  );
}

async function garantirTabelaCce() {
  await dbRun(
    `CREATE TABLE IF NOT EXISTS nfe_cce_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_id INTEGER NOT NULL,
      documento_tipo TEXT NOT NULL DEFAULT 'VENDA',
      chave_nfe TEXT NOT NULL,
      n_seq_evento INTEGER NOT NULL,
      x_correcao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      c_stat TEXT,
      x_motivo TEXT,
      protocolo TEXT,
      dh_evento TEXT,
      dh_recebimento TEXT,
      xml_envio TEXT,
      xml_retorno TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  // Migração V1→V2: remove FK exclusiva de nfe_notas e passa a aceitar devoluções.
  const cols = await dbAll(`PRAGMA table_info(nfe_cce_eventos)`);
  const hasDocumentoTipo = cols.some((c) => String(c.name) === 'documento_tipo');
  if (!hasDocumentoTipo) {
    await dbRun(`ALTER TABLE nfe_cce_eventos ADD COLUMN documento_tipo TEXT NOT NULL DEFAULT 'VENDA'`);
  }

  const sqlCreate = await dbGet(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='nfe_cce_eventos'`
  );
  const precisaRebuild = /REFERENCES\s+nfe_notas/i.test(String(sqlCreate?.sql || ''))
    || !/documento_tipo/i.test(String(sqlCreate?.sql || ''))
    || !/UNIQUE\s*\(\s*documento_tipo/i.test(String(sqlCreate?.sql || ''));

  if (precisaRebuild) {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS nfe_cce_eventos_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nfe_id INTEGER NOT NULL,
        documento_tipo TEXT NOT NULL DEFAULT 'VENDA',
        chave_nfe TEXT NOT NULL,
        n_seq_evento INTEGER NOT NULL,
        x_correcao TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente',
        c_stat TEXT,
        x_motivo TEXT,
        protocolo TEXT,
        dh_evento TEXT,
        dh_recebimento TEXT,
        xml_envio TEXT,
        xml_retorno TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(documento_tipo, nfe_id, n_seq_evento),
        UNIQUE(chave_nfe, n_seq_evento)
      )
    `);
    await dbRun(`
      INSERT OR IGNORE INTO nfe_cce_eventos_v2 (
        id, nfe_id, documento_tipo, chave_nfe, n_seq_evento, x_correcao, status,
        c_stat, x_motivo, protocolo, dh_evento, dh_recebimento, xml_envio, xml_retorno,
        created_at, updated_at
      )
      SELECT
        id, nfe_id, COALESCE(NULLIF(documento_tipo,''), 'VENDA'), chave_nfe, n_seq_evento, x_correcao, status,
        c_stat, x_motivo, protocolo, dh_evento, dh_recebimento, xml_envio, xml_retorno,
        created_at, updated_at
      FROM nfe_cce_eventos
    `);
    await dbRun(`DROP TABLE nfe_cce_eventos`);
    await dbRun(`ALTER TABLE nfe_cce_eventos_v2 RENAME TO nfe_cce_eventos`);
  }

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_cce_nfe_id ON nfe_cce_eventos(nfe_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_cce_chave ON nfe_cce_eventos(chave_nfe)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_nfe_cce_doc ON nfe_cce_eventos(documento_tipo, nfe_id)`);
}

function normalizarCorrecao(texto) {
  return String(texto == null ? '' : texto).trim();
}

/**
 * Validação estrutural alinhada ao XSD (sem interpretador semântico agressivo).
 */
function validarTextoCorrecao(xCorrecao) {
  const texto = normalizarCorrecao(xCorrecao);
  if (!texto) {
    return { ok: false, erro: 'Informe o texto da correção (xCorrecao).' };
  }
  if (texto.length < MIN_CORRECAO) {
    return {
      ok: false,
      erro: `A correção deve ter no mínimo ${MIN_CORRECAO} caracteres.`
    };
  }
  if (texto.length > MAX_CORRECAO) {
    return {
      ok: false,
      erro: `A correção deve ter no máximo ${MAX_CORRECAO} caracteres.`
    };
  }
  return { ok: true, texto };
}

function validarXmlEventoCce(xml, { chave, nSeq, xCorrecao } = {}) {
  const src = String(xml || '');
  const erros = [];
  if (!src.includes(`<tpEvento>${TP_EVENTO_CCE}</tpEvento>`)) {
    erros.push('tpEvento 110110 ausente');
  }
  if (chave && !src.includes(`<chNFe>${chave}</chNFe>`)) {
    erros.push('chNFe divergente');
  }
  if (nSeq != null && !src.includes(`<nSeqEvento>${Number(nSeq)}</nSeqEvento>`)) {
    erros.push('nSeqEvento divergente');
  }
  if (!src.includes('<descEvento>Carta de Correção</descEvento>')) {
    erros.push('descEvento inválido');
  }
  if (!src.includes('<xCorrecao>')) erros.push('xCorrecao ausente');
  if (!src.includes('<xCondUso>')) erros.push('xCondUso ausente');
  if (!/Id="ID110110\d{44}\d{2}"/.test(src)) {
    erros.push('Id do infEvento inválido');
  }
  if (xCorrecao && !src.includes(xmlEscape(xCorrecao).slice(0, 40))) {
    // apenas sanidade — texto completo já escapado no XML
  }
  if (erros.length) {
    return { ok: false, erros };
  }
  return { ok: true, erros: [] };
}

function nowDhEvento() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}-03:00`;
}

function montarXmlEventoCce({
  chave,
  cnpj,
  codigoUf,
  ambiente,
  nSeqEvento,
  xCorrecao,
  dhEvento
} = {}) {
  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  const seq = Number(nSeqEvento);
  const id = `ID${TP_EVENTO_CCE}${chaveLimpa}${String(seq).padStart(2, '0')}`;
  const dh = dhEvento || nowDhEvento();

  return compactarXml(`
    <evento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
      <infEvento Id="${id}">
        <cOrgao>${String(codigoUf || '23').replace(/\D/g, '').padStart(2, '0')}</cOrgao>
        <tpAmb>${Number(ambiente) === 1 ? 1 : 2}</tpAmb>
        <CNPJ>${String(cnpj || '').replace(/\D/g, '')}</CNPJ>
        <chNFe>${chaveLimpa}</chNFe>
        <dhEvento>${dh}</dhEvento>
        <tpEvento>${TP_EVENTO_CCE}</tpEvento>
        <nSeqEvento>${seq}</nSeqEvento>
        <verEvento>1.00</verEvento>
        <detEvento versao="1.00">
          <descEvento>${DESC_EVENTO}</descEvento>
          <xCorrecao>${xmlEscape(xCorrecao)}</xCorrecao>
          <xCondUso>${xmlEscape(X_COND_USO)}</xCondUso>
        </detEvento>
      </infEvento>
    </evento>`);
}

async function obterProximoSeqEvento(chaveNfe) {
  const chave = String(chaveNfe || '').replace(/\D/g, '');
  const row = await dbGet(
    `SELECT COALESCE(MAX(n_seq_evento), 0) AS max_seq FROM nfe_cce_eventos WHERE chave_nfe = ?`,
    [chave]
  );
  return calcularProximoSeqEvento(row?.max_seq);
}

async function carregarNotaAutorizada(notaId, tipo = 'VENDA') {
  const id = Number(notaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw fiscalError('nota_id inválido.');
  }
  const { documentoTipo, tabela } = resolverFonteDocumento(tipo);
  let nota = null;
  try {
    nota = await dbGet(`SELECT * FROM ${tabela} WHERE id = ?`, [id]);
  } catch (err) {
    if (documentoTipo !== 'VENDA' && /no such table/i.test(String(err.message || err))) {
      throw fiscalError(`Tabela de NF-e ${documentoTipo} indisponível.`, 404, 'NFE_TIPO_INDISPONIVEL');
    }
    throw err;
  }
  assertNotaPermiteCce(nota);
  const xmlAuth = extrairXmlAutorizacaoNota(nota);
  const auth = extrairChaveEProtocoloAutorizados(xmlAuth);
  const chave = String(auth?.chaveAcesso || nota.chave_acesso || '').replace(/\D/g, '');
  if (chave.length !== 44) {
    throw fiscalError('NF-e sem chave de acesso válida.', 400, 'CHAVE_INVALIDA');
  }
  return { nota, chave, documentoTipo, tabela };
}

function parseRetornoEvento(raw) {
  const body = String(raw || '');
  // Lote retorna cStat 128; o evento vem em retEvento/infEvento (cStat 135/136 quando registrado).
  const blocoEvento =
    (body.match(/<retEvento[\s\S]*?<\/retEvento>/i) || [])[0] ||
    (body.match(/<infEvento[\s\S]*?<\/infEvento>/i) || [])[0] ||
    body;

  const cStatLote = (body.match(/<retEnvEvento[\s\S]*?<cStat>(\d+)<\/cStat>/i) || [])[1] || null;
  const cStat =
    (blocoEvento.match(/<cStat>(\d+)<\/cStat>/i) || [])[1] ||
    (body.match(/<cStat>(\d+)<\/cStat>/i) || [])[1] ||
    null;
  const xMotivo =
    (blocoEvento.match(/<xMotivo>([^<]*)<\/xMotivo>/i) || [])[1] ||
    (body.match(/<xMotivo>([^<]*)<\/xMotivo>/i) || [])[1] ||
    null;
  const protocolo = (blocoEvento.match(/<nProt>(\d+)<\/nProt>/i) || body.match(/<nProt>(\d+)<\/nProt>/i) || [])[1] || null;
  const dhRegEvento =
    (blocoEvento.match(/<dhRegEvento>([^<]*)<\/dhRegEvento>/i) ||
      body.match(/<dhRegEvento>([^<]*)<\/dhRegEvento>/i) ||
      [])[1] || null;
  const registrado = cStat === '135' || cStat === '136';
  return { cStat, cStatLote, xMotivo, protocolo, dhRegEvento, registrado };
}

/**
 * Transmite CC-e para a SEFAZ.
 * @param {number|string} notaId
 * @param {{ xCorrecao?: string, x_correcao?: string }} body
 * @param {object} [deps] — injeção opcional (testes): getFiscalConfig, enviarCancelamento, assinarEvento, carregarCertificadoPfx
 */
async function transmitirCartaCorrecao(notaId, body = {}, deps = {}) {
  await garantirTabelaCce();

  const getConfig = deps.getFiscalConfig || getFiscalConfig;
  const enviar = deps.enviarCancelamento || enviarCancelamento;
  const assinar = deps.assinarEvento || assinarEvento;
  const carregarCert = deps.carregarCertificadoPfx || carregarCertificadoPfx;

  const validacao = validarTextoCorrecao(body.xCorrecao != null ? body.xCorrecao : body.x_correcao);
  if (!validacao.ok) {
    throw fiscalError(validacao.erro, 400, 'CCE_TEXTO_INVALIDO');
  }
  const xCorrecao = validacao.texto;

  const tipoDoc = body.tipo || body.documento_tipo || body.documentoTipo || 'VENDA';
  const { nota, chave, documentoTipo } = await carregarNotaAutorizada(notaId, tipoDoc);
  const config = await getConfig();
  const ambNota = Number(nota.ambiente != null ? nota.ambiente : config.ambiente);
  const ambCfg = Number(config.ambiente);
  if (ambNota && ambCfg && ambNota !== ambCfg) {
    throw fiscalError(
      `Ambiente da NF-e (${ambNota}) diverge do ambiente fiscal configurado (${ambCfg}).`,
      400,
      'CCE_AMBIENTE'
    );
  }

  const nSeqEvento = await obterProximoSeqEvento(chave);
  const dhEvento = nowDhEvento();

  const eventoXml = montarXmlEventoCce({
    chave,
    cnpj: config.cnpj,
    codigoUf: config.codigoUf,
    ambiente: config.ambiente,
    nSeqEvento,
    xCorrecao,
    dhEvento
  });

  const validXml = validarXmlEventoCce(eventoXml, { chave, nSeq: nSeqEvento, xCorrecao });
  if (!validXml.ok) {
    throw fiscalError(
      `XML da CC-e inválido: ${validXml.erros.join('; ')}`,
      500,
      'CCE_XML_INVALIDO'
    );
  }

  let eventoId;
  try {
    const insert = await dbRun(
      `INSERT INTO nfe_cce_eventos (
        nfe_id, documento_tipo, chave_nfe, n_seq_evento, x_correcao, status, dh_evento, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pendente', ?, datetime('now','localtime'), datetime('now','localtime'))`,
      [nota.id, documentoTipo, chave, nSeqEvento, xCorrecao, dhEvento]
    );
    eventoId = insert.lastID;
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err.message || err))) {
      throw fiscalError(
        `Sequencial CC-e ${nSeqEvento} já utilizado para esta NF-e.`,
        409,
        'CCE_SEQ_DUPLICADO'
      );
    }
    throw err;
  }

  let xmlAssinado = '';
  let soap = '';
  let raw = '';
  let parsed = {
    cStat: null,
    cStatLote: null,
    xMotivo: null,
    protocolo: null,
    dhRegEvento: null,
    registrado: false
  };

  try {
    const certificado = carregarCert(config.certificadoPath, config.certificadoSenha);
    const assinatura = assinar(
      eventoXml,
      certificado.privateKeyPem,
      certificado.certPem
    );
    xmlAssinado = assinatura.xmlAssinado;

    const idLote = String(Date.now()).slice(-15);
    const envEvento = compactarXml(`
      <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
        <idLote>${idLote}</idLote>
        ${xmlAssinado}
      </envEvento>`);

    soap = `<?xml version="1.0" encoding="utf-8"?>
      <soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                       xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                       xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
        <soap12:Header>
          <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
            <cUF>${String(config.codigoUf || '23').replace(/\D/g, '').padStart(2, '0')}</cUF>
            <versaoDados>1.00</versaoDados>
          </nfeCabecMsg>
        </soap12:Header>
        <soap12:Body>
          <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
            ${envEvento}
          </nfeDadosMsg>
        </soap12:Body>
      </soap12:Envelope>`;

    const envio = await enviar({
      envelope: soap,
      modelo: ModelType.NFE,
      ambiente: config.ambiente,
      cUF: config.codigoUf,
      chave,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha,
      url: getRecepcaoEventoUrlNfe(config.ambiente)
    });

    if (!envio.success) {
      throw fiscalError(
        envio.error || 'Falha no envio da CC-e à SEFAZ.',
        502,
        'CCE_TRANSMISSAO'
      );
    }

    raw = String(envio.body || '');
    parsed = parseRetornoEvento(raw);
  } catch (err) {
    await dbRun(
      `UPDATE nfe_cce_eventos SET
        status = 'erro',
        c_stat = ?,
        x_motivo = ?,
        xml_envio = ?,
        xml_retorno = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?`,
      [
        parsed.cStat,
        err.message || String(err),
        xmlAssinado || eventoXml,
        raw || null,
        eventoId
      ]
    );
    throw err;
  }

  const statusFinal = parsed.registrado ? 'registrada' : 'rejeitada';
  await dbRun(
    `UPDATE nfe_cce_eventos SET
      status = ?,
      c_stat = ?,
      x_motivo = ?,
      protocolo = ?,
      dh_recebimento = ?,
      xml_envio = ?,
      xml_retorno = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?`,
    [
      statusFinal,
      parsed.cStat,
      parsed.xMotivo,
      parsed.protocolo,
      parsed.dhRegEvento,
      xmlAssinado || eventoXml,
      raw,
      eventoId
    ]
  );

  return {
    success: parsed.registrado,
    status: statusFinal,
    avisoRestricoes: AVISO_RESTRICOES,
    sefaz: {
      cStatLote: parsed.cStatLote,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      protocolo: parsed.protocolo,
      dhRegEvento: parsed.dhRegEvento
    },
    evento: {
      id: eventoId,
      nfe_id: nota.id,
      documento_tipo: documentoTipo,
      chave_nfe: chave,
      n_seq_evento: nSeqEvento,
      x_correcao: xCorrecao,
      status: statusFinal,
      c_stat: parsed.cStat,
      c_stat_lote: parsed.cStatLote,
      x_motivo: parsed.xMotivo,
      protocolo: parsed.protocolo,
      dh_evento: dhEvento,
      dh_recebimento: parsed.dhRegEvento
    },
    message: parsed.registrado
      ? 'CC-e registrada com sucesso.'
      : `CC-e rejeitada pela SEFAZ${parsed.cStat ? ` (cStat ${parsed.cStat})` : ''}.`
  };
}

async function listarCartasCorrecao(notaId, tipo = 'VENDA') {
  await garantirTabelaCce();
  const id = Number(notaId);
  if (!Number.isInteger(id) || id <= 0) {
    throw fiscalError('nota_id inválido.');
  }
  const { documentoTipo, tabela } = resolverFonteDocumento(tipo);
  let nota = null;
  try {
    nota = await dbGet(
      `SELECT id, numero, serie, chave_acesso, status FROM ${tabela} WHERE id = ?`,
      [id]
    );
  } catch (err) {
    if (/no such table/i.test(String(err.message || err))) {
      throw fiscalError('NF-e não encontrada.', 404);
    }
    throw err;
  }
  if (!nota) {
    throw fiscalError('NF-e não encontrada.', 404);
  }
  const eventos = await dbAll(
    `SELECT id, nfe_id, documento_tipo, chave_nfe, n_seq_evento, x_correcao, status, c_stat, x_motivo,
            protocolo, dh_evento, dh_recebimento, created_at, updated_at
     FROM nfe_cce_eventos
     WHERE (documento_tipo = ? AND nfe_id = ?)
        OR (chave_nfe = ? AND ? <> '')
     ORDER BY n_seq_evento ASC`,
    [documentoTipo, id, String(nota.chave_acesso || '').replace(/\D/g, ''), String(nota.chave_acesso || '').replace(/\D/g, '')]
  );
  // Dedup por id caso OR retorne duplicados
  const seen = new Set();
  const unicos = [];
  for (const e of eventos) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    unicos.push(e);
  }
  return {
    success: true,
    nfe: {
      id: nota.id,
      numero: nota.numero,
      serie: nota.serie,
      chave_acesso: nota.chave_acesso,
      status: nota.status,
      tipo: documentoTipo
    },
    eventos: unicos,
    avisoRestricoes: AVISO_RESTRICOES
  };
}

module.exports = {
  TP_EVENTO_CCE,
  DESC_EVENTO,
  X_COND_USO,
  AVISO_RESTRICOES,
  MIN_CORRECAO,
  MAX_CORRECAO,
  MAX_SEQ,
  garantirTabelaCce,
  validarTextoCorrecao,
  validarXmlEventoCce,
  montarXmlEventoCce,
  calcularProximoSeqEvento,
  assertNotaPermiteCce,
  normalizarTipoDocumento,
  resolverFonteDocumento,
  obterProximoSeqEvento,
  transmitirCartaCorrecao,
  listarCartasCorrecao,
  getRecepcaoEventoUrlNfe,
  parseRetornoEvento
};
