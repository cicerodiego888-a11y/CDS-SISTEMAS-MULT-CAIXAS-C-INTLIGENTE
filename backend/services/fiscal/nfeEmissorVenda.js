/**
 * Emissor NF-e modelo 55 para venda (Sprint 3.2).
 * Sidecar pós-Núcleo — NÃO altera emissor NFC-e (emissor.js).
 * Reutiliza: certificado, assinatura, montarLote, enviarLote, getFiscalConfig.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfig, setConfiguracao } = require('./configService');
const { carregarCertificadoPfx } = require('./certificateService');
const { assinarNFe } = require('./signer');
const { montarLote, enviarLote } = require('./soapClient');
const { extrairChaveEProtocoloAutorizados } = require('./utils');
const { getFiscalSubDir } = require('./paths');
const { buildNfeXml, itemEntraNaNfe } = require('./xmlBuilderNfeVenda');
const { validarXmlFiscal } = require('./validarXmlFiscal');
const { gerarDanfeNfeHtml } = require('./danfeNfe');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');
const { iniciarAuditoriaXmlNfe } = require('./nfeXmlAuditoria');
const { traceNfe } = require('./nfeTrace');
const configService = require('../configuracaoService');

const MSG_CHAVE_PRIVADA =
  'Não foi possível obter a chave privada do certificado digital.';
const MSG_CERT_PEM =
  'Não foi possível obter o certificado digital (PEM).';

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug/nfe-venda');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo ?? ''), 'utf8');
}

/** Logs exclusivos do sidecar NF-e — não usados pela NFC-e. */
function logNfe(mensagem) {
  console.log(`[NFE] ${mensagem}`);
}

/**
 * RC3.15.5 — garante PEM de chave privada (string) antes de assinarNFe.
 * Evita o erro Node "key.key ... Received undefined" ao passar objeto/undefined.
 */
function assertPrivateKeyPemNfe(privateKeyPem) {
  if (privateKeyPem == null || typeof privateKeyPem !== 'string') {
    const err = new Error(MSG_CHAVE_PRIVADA);
    err.code = 'CERT_PRIVATE_KEY_INVALID';
    throw err;
  }
  const pem = privateKeyPem.trim();
  if (!pem) {
    const err = new Error(MSG_CHAVE_PRIVADA);
    err.code = 'CERT_PRIVATE_KEY_INVALID';
    throw err;
  }
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) {
    const err = new Error(MSG_CHAVE_PRIVADA);
    err.code = 'CERT_PRIVATE_KEY_INVALID';
    throw err;
  }
  return pem;
}

function assertCertPemNfe(certPem) {
  if (certPem == null || typeof certPem !== 'string' || !String(certPem).trim()) {
    const err = new Error(MSG_CERT_PEM);
    err.code = 'CERT_PEM_INVALID';
    throw err;
  }
  if (!/-----BEGIN CERTIFICATE-----/.test(certPem)) {
    const err = new Error(MSG_CERT_PEM);
    err.code = 'CERT_PEM_INVALID';
    throw err;
  }
  return certPem;
}

/**
 * Checklist pré-assinatura NF-e: PFX no disco, senha tipada, carga + PEM válidos.
 * Retorna apenas strings PEM para o contrato assinarNFe(xml, privateKeyPem, certPem).
 */
function carregarEValidarCertificadoNfe(config) {
  const pathPfx = String(config.certificadoPath || '').trim();
  if (!pathPfx || !fs.existsSync(pathPfx)) {
    const err = new Error('Certificado A1/PFX não encontrado.');
    err.code = 'CERT_AUSENTE';
    throw err;
  }
  logNfe('Certificado localizado');

  if (config.certificadoSenha != null && typeof config.certificadoSenha !== 'string') {
    const err = new Error('Senha do certificado digital inválida.');
    err.code = 'CERT_SENHA_INVALIDA';
    throw err;
  }
  logNfe('Senha válida');

  const material = carregarCertificadoPfx(pathPfx, config.certificadoSenha || '');
  logNfe('PFX carregado');

  const privateKeyPem = assertPrivateKeyPemNfe(material.privateKeyPem);
  logNfe('Chave privada extraída');
  logNfe('PrivateKey OK');

  const certPem = assertCertPemNfe(material.certPem);
  logNfe('Certificado extraído');
  logNfe('Certificado OK');

  return { privateKeyPem, certPem };
}

function getUrlNFe55(config) {
  return Number(config.ambiente) === 1
    ? 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx'
    : 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
}

function getConfiguracao(chave, padrao = '') {
  return new Promise((resolve, reject) => {
    db.get('SELECT valor FROM configuracoes WHERE chave = ?', [chave], (err, row) => {
      if (err) return reject(err);
      resolve(row?.valor || padrao);
    });
  });
}

async function proximoNumeroNFeVenda() {
  const { reservarProximoNumeroNfe } = require('./nfeNumeracaoNfeService');
  const serie = Number(await getConfiguracao('fiscal_serie_nfe', await getConfiguracao('fiscal_serie', '1'))) || 1;
  const ambiente = Number(await getConfiguracao('fiscal_ambiente', '2')) || 2;
  const cnpj = await getConfiguracao('cnpj', '');
  return reservarProximoNumeroNfe({ serie, ambiente, cnpj });
}

function garantirTabelaNfeNotas() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS nfe_notas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        pedido_id INTEGER,
        numero INTEGER NOT NULL,
        serie INTEGER NOT NULL,
        chave_acesso TEXT,
        ambiente INTEGER DEFAULT 2,
        status TEXT DEFAULT 'pendente',
        xml_enviado TEXT,
        xml_retorno TEXT,
        protocolo TEXT,
        recibo TEXT,
        danfe_html TEXT,
        natureza_operacao TEXT,
        cfop TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venda_id) REFERENCES vendas(id)
      )
    `, (err) => (err ? reject(err) : resolve()));
  });
}

function carregarVendaParaNfe(vendaId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        v.*,
        c.nome AS cliente_nome,
        c.cpf_cnpj AS cliente_cpf,
        c.rua AS cliente_rua,
        c.numero AS cliente_numero,
        c.bairro AS cliente_bairro,
        c.cidade AS cliente_cidade,
        c.uf AS cliente_uf,
        c.cep AS cliente_cep
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [vendaId], (err, venda) => {
      if (err) return reject(err);
      if (!venda) return reject(new Error('Venda não encontrada.'));

      db.all(`
        SELECT
          vi.*,
          p.nome AS produto_nome,
          p.ncm AS produto_ncm,
          p.cfop,
          p.csosn,
          p.origem,
          p.codigo AS produto_codigo,
          p.unidade
        FROM vendas_itens vi
        INNER JOIN produtos p ON p.id = vi.produto_id
        WHERE vi.venda_id = ?
        ORDER BY vi.id
      `, [vendaId], (itErr, itens) => {
        if (itErr) return reject(itErr);

        db.all(`
          SELECT forma_pagamento, valor, tipo_recebimento
          FROM venda_recebimentos
          WHERE venda_id = ? AND status = 'aprovado'
          ORDER BY id
        `, [vendaId], (recErr, recebimentos) => {
          if (recErr) return reject(recErr);
          if (recebimentos && recebimentos.length) {
            venda.pagamentos = recebimentos;
            return resolve({ venda, itens: itens || [] });
          }
          db.all(
            'SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ?',
            [vendaId],
            (pgErr, pags) => {
              if (pgErr) return reject(pgErr);
              venda.pagamentos = pags || [];
              resolve({ venda, itens: itens || [] });
            }
          );
        });
      });
    });
  });
}

function salvarNotaNfe(payload) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1`,
      [payload.venda_id],
      (selErr, row) => {
        if (selErr) return reject(selErr);
        if (row) {
          db.run(`
            UPDATE nfe_notas SET
              numero = ?, serie = ?, chave_acesso = ?, ambiente = ?, status = ?,
              xml_enviado = ?, xml_retorno = ?, protocolo = ?, recibo = ?, danfe_html = ?,
              natureza_operacao = ?, cfop = ?,
              updated_at = datetime('now','localtime')
            WHERE id = ?
          `, [
            payload.numero, payload.serie, payload.chave_acesso || '', payload.ambiente,
            payload.status, payload.xml_enviado || '', payload.xml_retorno || '',
            payload.protocolo || '', payload.recibo || '', payload.danfe_html || '',
            payload.natureza_operacao || null, payload.cfop || null, row.id
          ], (uErr) => (uErr ? reject(uErr) : resolve(row.id)));
          return;
        }
        db.run(`
          INSERT INTO nfe_notas (
            venda_id, pedido_id, numero, serie, chave_acesso, ambiente, status,
            xml_enviado, xml_retorno, protocolo, recibo, danfe_html,
            natureza_operacao, cfop
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          payload.venda_id, payload.pedido_id || null, payload.numero, payload.serie,
          payload.chave_acesso || '', payload.ambiente, payload.status,
          payload.xml_enviado || '', payload.xml_retorno || '',
          payload.protocolo || '', payload.recibo || '', payload.danfe_html || '',
          payload.natureza_operacao || null, payload.cfop || null
        ], function onIns(iErr) {
          if (iErr) return reject(iErr);
          resolve(this.lastID);
        });
      }
    );
  });
}

/**
 * Emite NF-e 55 para uma venda já criada pelo Núcleo.
 * @param {number} vendaId
 * @param {object} [opcoes]
 * @param {object} [opcoes.dadosNfe]
 * @param {number} [opcoes.pedidoId]
 */
async function emitirNfePorVendaId(vendaId, opcoes = {}) {
  // RC3.16.13 — confirma qual backend o Electron está executando (somente diagnóstico)
  console.log('[RC3.16.12] Backend NF-e carregado');
  console.log('[RC3.16.12] Arquivo:', __filename);
  console.log('[RC3.16.12] app.asar:', String(__filename).includes('app.asar') ? 'SIM' : 'NÃO');

  // RC3.16.11 — TRACE (não altera emissão)
  traceNfe('emitirNfePorVendaId', {
    vendaId,
    pedidoId: opcoes.pedidoId || null,
    forcarReemissao: Boolean(opcoes.forcarReemissao),
    arquivo: __filename
  });

  if (!configService.recursoHabilitado('nfe')) {
    return {
      success: false,
      status: 'modulo_desabilitado',
      message: 'Módulo NF-e desabilitado na implantação.'
    };
  }

  await garantirTabelaNfeNotas();

  const id = Number(vendaId);
  const { venda, itens } = await carregarVendaParaNfe(id);

  if (String(venda.status_pagamento || '') !== 'quitada' && Number(venda.valor_nao_fiscal || 0) > 0) {
    // espelha gate do núcleo: preferir quitada; se só NF, status pode ser quitada forçado
  }

  const existente = await new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM nfe_notas WHERE venda_id = ? AND status = 'autorizada' ORDER BY id DESC LIMIT 1`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
  if (existente) {
    return {
      success: true,
      reused: true,
      status: 'autorizada',
      notaId: existente.id,
      numero: existente.numero,
      serie: existente.serie,
      chaveAcesso: existente.chave_acesso,
      protocolo: existente.protocolo,
      danfeHtml: existente.danfe_html
    };
  }

  if (!itens.length) {
    return { success: false, status: 'sem_itens', message: 'Venda sem itens para NF-e.' };
  }

  // Hotfix: SEFAZ recebe exclusivamente itens/qtds/valores fiscais do Motor.
  const itensFiscais = itens.filter(itemEntraNaNfe);
  if (!itensFiscais.length) {
    return {
      success: false,
      status: 'sem_itens_fiscais',
      message: 'Venda sem parcela fiscal do Motor para emissão de NF-e.'
    };
  }

  const config = await getFiscalConfig();
  config.serieNfe = Number(await getConfiguracao('fiscal_serie_nfe', String(config.serie || 1))) || 1;

  if (!config.nomeEmpresa || !config.cnpj || !config.ie) {
    return { success: false, status: 'configuracao_pendente', message: 'Configuração fiscal incompleta.' };
  }
  if (!config.certificadoPath || !fs.existsSync(config.certificadoPath)) {
    return { success: false, status: 'configuracao_pendente', message: 'Certificado A1/PFX não encontrado.' };
  }
  if (config.certificadoSenha != null && typeof config.certificadoSenha !== 'string') {
    return {
      success: false,
      status: 'configuracao_pendente',
      message: 'Senha do certificado digital inválida.',
      codigo: 'CERT_SENHA_INVALIDA'
    };
  }

  const dadosNfe = opcoes.dadosNfe || {};

  // RC3.16.12 — valida identificador do dest ANTES de consumir número / montar XML
  try {
    const {
      montarDocumentoDestinatarioNfe,
      assertDestinatarioIdentificadoNfe
    } = require('./xmlBuilderNfeVenda');
    console.log('[RC3.16.12] Validando destinatário...');
    assertDestinatarioIdentificadoNfe(montarDocumentoDestinatarioNfe(venda, dadosNfe));
    console.log('[RC3.16.12] Destinatário validado.');
  } catch (destErr) {
    if (destErr && destErr.code === 'DEST_SEM_DOCUMENTO') {
      console.log('[RC3.16.12] BLOQUEADO: destinatário sem documento.');
      return {
        success: false,
        status: 'erro_validacao',
        message: destErr.message,
        code: 'DEST_SEM_DOCUMENTO',
        codigo: 'DEST_SEM_DOCUMENTO'
      };
    }
    throw destErr;
  }

  const numero = await proximoNumeroNFeVenda();

  // RC3.16.10 — auditoria exclusiva (não altera regras / builder / assinatura / SOAP)
  traceNfe('iniciarAuditoriaXmlNfe', { vendaId: id, numero, serie: config.serieNfe });
  const auditoriaXml = iniciarAuditoriaXmlNfe({ config, venda, dadosNfe, vendaId: id });

  let built;
  try {
    traceNfe('buildNfeXml', { vendaId: id, numero, serie: config.serieNfe });
    built = buildNfeXml({ config, venda, itens: itensFiscais, numero, dadosNfe });
  } catch (buildErr) {
    // RC3.16.12 — bloqueio local (sem envio SEFAZ)
    if (buildErr && (buildErr.code === 'DEST_SEM_DOCUMENTO'
      || String(buildErr.message || '').includes('SEM CPF, CNPJ OU ID ESTRANGEIRO'))) {
      console.log('[RC3.16.12] BLOQUEADO: destinatário sem documento.');
      return {
        success: false,
        status: 'erro_validacao',
        message: buildErr.message,
        code: 'DEST_SEM_DOCUMENTO',
        codigo: 'DEST_SEM_DOCUMENTO'
      };
    }
    throw buildErr;
  }

  try {
    validarXmlFiscal({
      xml: built.xmlSemAssinatura,
      fase: 'pre_assinatura',
      modeloDoc: '55',
      validarXsd: false
    });
  } catch (validErr) {
    return {
      success: false,
      status: 'erro_validacao',
      message: validErr.message || 'XML NF-e inconsistente.',
      code: validErr.code || 'XML_INVALIDO',
      detalhes: validErr.detalhes || null
    };
  }

  let xmlAssinado;
  try {
    salvarDebug(`venda-${id}-01-original.xml`, built.xmlSemAssinatura);
    if (!built.xmlSemAssinatura || !String(built.xmlSemAssinatura).trim()) {
      throw new Error('XML NF-e não foi gerado.');
    }
    logNfe('XML criado');
    logNfe('XML OK');

    // RC3.16.10 — XML original (pré-assinatura) + DEST / xNome / schema
    try { auditoriaXml.aposGerarXml(built.xmlSemAssinatura); } catch (_) { /* diagnóstico não bloqueia */ }

    const { privateKeyPem, certPem } = carregarEValidarCertificadoNfe(config);

    logNfe('Assinando...');
    traceNfe('assinarNFe', { vendaId: id, numero, chave: built.chave });
    // Contrato oficial (igual NFC-e): apenas strings PEM — nunca o objeto cert.
    const assinatura = assinarNFe(built.xmlSemAssinatura, privateKeyPem, certPem);
    xmlAssinado = assinatura?.xmlAssinado;
    if (!xmlAssinado) {
      throw new Error('Assinatura da NF-e não gerou XML.');
    }
    logNfe('Assinatura concluída');
    salvarDebug(`venda-${id}-02-assinado.xml`, xmlAssinado);

    // RC3.16.10 — XML assinado exatamente como será transmitido
    try { auditoriaXml.aposAssinar(xmlAssinado); } catch (_) { /* diagnóstico não bloqueia */ }
  } catch (signErr) {
    const { classificarErro } = require('./nfeErros');
    const rawMsg = String(signErr.message || signErr);
    const amigavel = classificarErro({ erro: rawMsg });
    const mensagemClara = signErr && typeof signErr.code === 'string' && signErr.code.startsWith('CERT_')
      ? rawMsg
      : (amigavel.mensagem || rawMsg);
    const notaId = await salvarNotaNfe({
      venda_id: id,
      pedido_id: opcoes.pedidoId || venda.pedido_id,
      numero,
      serie: built.serie,
      chave_acesso: built.chave,
      ambiente: config.ambiente,
      status: 'erro_assinatura',
      xml_enviado: built.xmlSemAssinatura,
      xml_retorno: rawMsg,
      natureza_operacao: dadosNfe.natureza_operacao,
      cfop: dadosNfe.cfop
    });
    return {
      success: false,
      notaId,
      status: 'erro_assinatura',
      message: mensagemClara,
      sugestao: amigavel.sugestao || null,
      codigo: signErr.code || amigavel.codigo || 'ERRO_ASSINATURA'
    };
  }

  const lote = montarLote(xmlAssinado, 1);
  let soapResponse;
  try {
    // RC3.16.10 — evidência imediatamente anterior ao envio SOAP
    try { auditoriaXml.antesEnvioSefaz(); } catch (_) { /* diagnóstico não bloqueia */ }
    logNfe('Enviando lote');
    traceNfe('enviarLote', {
      vendaId: id,
      numero,
      url: getUrlNFe55(config),
      tamanhoLote: Buffer.byteLength(String(lote || ''), 'utf8')
    });
    soapResponse = await enviarLote({
      url: getUrlNFe55(config),
      loteXml: lote,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha
    });
  } catch (txErr) {
    const notaId = await salvarNotaNfe({
      venda_id: id,
      pedido_id: opcoes.pedidoId || venda.pedido_id,
      numero,
      serie: built.serie,
      chave_acesso: built.chave,
      ambiente: config.ambiente,
      status: 'erro_transmissao',
      xml_enviado: xmlAssinado,
      xml_retorno: String(txErr.message || txErr),
      natureza_operacao: dadosNfe.natureza_operacao,
      cfop: dadosNfe.cfop
    });
    try {
      const { aplicarResultadoEmissao } = require('./nfeOperacionalService');
      await aplicarResultadoEmissao(notaId, {
        status: 'erro_transmissao',
        message: String(txErr.message || txErr)
      }, {
        vendaId: id,
        usuarioId: opcoes.usuarioId,
        usuarioNome: opcoes.usuarioNome,
        chave: built.chave,
        numero,
        acao: opcoes.forcarReemissao ? 'reenvio' : 'emissao',
        empresa: config.nomeEmpresa
      });
    } catch (_) { /* ignore */ }
    return { success: false, notaId, status: 'erro_transmissao', message: txErr.message };
  }

  const raw = String(soapResponse?.raw || soapResponse?.body || soapResponse || '');
  salvarDebug(`venda-${id}-03-retorno.xml`, raw);

  // RC3.16.3 — status oficial via protNFe/infProt (não o cStat do lote)
  traceNfe('parseRetornoAutorizacaoNfe', { vendaId: id, numero, bytesRetorno: Buffer.byteLength(raw, 'utf8') });
  const parsed = parseRetornoAutorizacaoNfe(raw);
  traceNfe('parserRetorno_resultado', {
    vendaId: id,
    status: parsed.status,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo
  });
  let status = parsed.status;
  let protocolo = parsed.nProt || '';
  let chaveFinal = parsed.chNFe || built.chave;
  if (status === 'autorizada' && !protocolo) {
    const extraido = extrairChaveEProtocoloAutorizados(raw);
    if (extraido?.chave) chaveFinal = extraido.chave;
    if (extraido?.protocolo) protocolo = extraido.protocolo;
  }

  const empresa = {
    nome: config.nomeEmpresa,
    cnpj: config.cnpj,
    ie: config.ie,
    endereco: config.logradouro || config.endereco
  };

  let danfeHtml = '';
  try {
    danfeHtml = await gerarDanfeNfeHtml({
      venda,
      itens: itensFiscais,
      empresa,
      chave: chaveFinal,
      numero,
      serie: built.serie,
      protocolo,
      status,
      natureza: dadosNfe.natureza_operacao,
      dadosNfe
    });
  } catch (danfeErr) {
    console.warn('[NFe] DANFE:', danfeErr.message);
  }

  const notaId = await salvarNotaNfe({
    venda_id: id,
    pedido_id: opcoes.pedidoId || venda.pedido_id,
    numero,
    serie: built.serie,
    chave_acesso: chaveFinal,
    ambiente: config.ambiente,
    status,
    xml_enviado: xmlAssinado,
    xml_retorno: raw,
    protocolo,
    danfe_html: danfeHtml,
    natureza_operacao: dadosNfe.natureza_operacao,
    cfop: dadosNfe.cfop
  });

  try {
    const { registrarHistoricoNfe } = require('./nfeCentralService');
    await registrarHistoricoNfe({
      notaId,
      evento: status === 'autorizada' ? 'autorizacao' : (status.startsWith('erro') ? 'erro' : 'emissao'),
      usuarioId: opcoes.usuarioId || null,
      usuarioNome: opcoes.usuarioNome || null,
      detalhes: { vendaId: id, numero, serie: built.serie, chave: chaveFinal, status, protocolo }
    });
  } catch (_) { /* histórico não bloqueia emissão */ }

  try {
    const { aplicarResultadoEmissao } = require('./nfeOperacionalService');
    const op = await aplicarResultadoEmissao(notaId, {
      status,
      message: status === 'autorizada'
        ? 'NF-e autorizada.'
        : (parsed.xMotivo || raw),
      xml_retorno: raw
    }, {
      vendaId: id,
      usuarioId: opcoes.usuarioId || null,
      usuarioNome: opcoes.usuarioNome || null,
      chave: chaveFinal,
      numero,
      protocolo,
      tempoRespostaMs: null,
      tentativas: opcoes.forcarReemissao ? undefined : 1,
      acao: opcoes.forcarReemissao ? 'reenvio' : 'emissao',
      empresa: config.nomeEmpresa,
      xmlEnviado: xmlAssinado
    });
    if (op?.status) status = op.status;
    if (op?.nProt) protocolo = op.nProt;
  } catch (_) { /* operacional não bloqueia */ }

  if (status === 'autorizada') {
    try {
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE vendas SET status = 'EMITIDA' WHERE id = ?`,
          [id],
          (err) => (err ? reject(err) : resolve())
        );
      });
    } catch (_) { /* coluna/status livre */ }
  }

  return {
    success: status === 'autorizada',
    status,
    notaId,
    numero,
    serie: built.serie,
    chaveAcesso: chaveFinal,
    protocolo,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    cStatLote: parsed.cStatLote,
    dhRecbto: parsed.dhRecbto,
    danfeHtml,
    message: status === 'autorizada'
      ? 'NF-e autorizada.'
      : (parsed.xMotivo || `NF-e não autorizada (status: ${status}).`)
  };
}

async function obterNotaNfePorVenda(vendaId) {
  await garantirTabelaNfeNotas();
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM nfe_notas WHERE venda_id = ? ORDER BY id DESC LIMIT 1`,
      [vendaId],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

module.exports = {
  emitirNfePorVendaId,
  obterNotaNfePorVenda,
  garantirTabelaNfeNotas,
  proximoNumeroNFeVenda,
  getUrlNFe55,
  // RC3.15.5 — helpers de robustez (testes / auditoria); não usados pela NFC-e
  assertPrivateKeyPemNfe,
  assertCertPemNfe,
  carregarEValidarCertificadoNfe,
  MSG_CHAVE_PRIVADA,
  MSG_CERT_PEM
};
