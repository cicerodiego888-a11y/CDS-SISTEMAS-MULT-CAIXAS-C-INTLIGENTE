/**
 * Sprint 04 + 07.2 — Transmissão / autorização SEFAZ (PRODUÇÃO e HOMOLOGAÇÃO).
 * Reutiliza motor NFC-e existente. NÃO baixa estoque / financeiro / caixa / vendas.
 * PRODUÇÃO não é bloqueio artificial: exige configuração fiscal válida.
 */

'use strict';

const crypto = require('crypto');
const { STATUS, DOC_STATUS, STATUS_PODEM_TRANSMITIR, AMBIENTE, TP_EMIS } = require('./constants');
const moduloConfig = require('./fechamentoFiscalModuloConfig');
const { snapshotComercial } = require('./FechamentoFiscalElegibilidadeService');
const { listarDocumentos, gerarXmlDocumento } = require('./FechamentoFiscalPreparacaoService');
const { agoraLocal } = require('./FechamentoFiscalValidacaoService');

/** Lock em processo — evita BEGIN aninhado na mesma conexão SQLite (duplo clique / Promise.all). */
const locksTransmitir = new Map();

async function comLockTransmitir(fechamentoId, fn) {
  const key = String(fechamentoId);
  while (locksTransmitir.has(key)) {
    try { await locksTransmitir.get(key); } catch (_) { /* ignore */ }
  }
  let liberar;
  const gate = new Promise((resolve) => { liberar = resolve; });
  locksTransmitir.set(key, gate);
  try {
    return await fn();
  } finally {
    locksTransmitir.delete(key);
    liberar();
  }
}

function getDb(dbOverride) {
  if (dbOverride) return dbOverride;
  return require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function logTecnico(evento, payload = {}) {
  const safe = { ...payload };
  delete safe.certificadoSenha;
  delete safe.senha;
  delete safe.certificado;
  // eslint-disable-next-line no-console
  console.log(`[FechamentoFiscal:TX] ${evento}`, JSON.stringify(safe));
}

function hashXml(xml) {
  return crypto.createHash('sha256').update(String(xml || '')).digest('hex');
}

function extrairCStat(raw) {
  // Preferir cStat do documento (infProt), não o do lote (ex.: 104).
  const texto = String(raw || '');
  const prot = texto.match(/<infProt[\s\S]*?<cStat>\s*(\d+)\s*<\/cStat>/i);
  if (prot) return prot[1];
  const m = texto.match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
  return m ? m[1] : null;
}

function extrairXMotivo(raw) {
  // Preferir xMotivo do documento (infProt), não o do lote ("Lote processado").
  const texto = String(raw || '');
  const prot = texto.match(/<infProt[\s\S]*?<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  if (prot) return prot[1].trim();
  const m = texto.match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  return m ? m[1].trim() : null;
}

function extrairNProt(raw) {
  const m = String(raw || '').match(/<nProt>\s*([^<]+)\s*<\/nProt>/i);
  return m ? m[1].trim() : null;
}

function extrairNRec(raw) {
  const m = String(raw || '').match(/<nRec>\s*([^<]+)\s*<\/nRec>/i);
  return m ? m[1].trim() : null;
}

function isTimeoutError(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  return code === 'ECONNABORTED' || /timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg);
}

function isRejeicaoFiscal(cStat, raw) {
  const st = String(cStat || '');
  if (!st) return /rejeic/i.test(String(raw || ''));
  if (st === '100' || st === '150') return false;
  // 104 = lote recebido (sincrono normalmente traz prot); tratar como processamento se sem prot
  if (st === '104') return false;
  return /^\d+$/.test(st);
}

async function resolverConfig(deps) {
  if (typeof deps.getFiscalConfig === 'function') {
    return deps.getFiscalConfig();
  }
  const { getFiscalConfig } = require('../fiscal/configService');
  return getFiscalConfig({ validarUrls: false });
}

async function reservarNumero(deps, config) {
  if (typeof deps.reservarProximaNumeracaoFiscal === 'function') {
    const r = await deps.reservarProximaNumeracaoFiscal({
      cnpj: config.cnpj,
      ambiente: config.ambiente,
      modelo: '65',
      serie: config.serie,
      origem: 'FECHAMENTO_FISCAL'
    });
    return r && r.numero != null ? r.numero : r;
  }
  // LEGACY inject (testes antigos): se ainda passarem incrementaNumeroFiscal, aceitar.
  if (typeof deps.incrementaNumeroFiscal === 'function') {
    return deps.incrementaNumeroFiscal(config);
  }
  const { reservarProximaNumeracaoFiscal } = require('../fiscal/numeracaoFiscalService');
  const reserva = await reservarProximaNumeracaoFiscal({
    cnpj: config.cnpj,
    ambiente: config.ambiente,
    modelo: '65',
    serie: config.serie,
    origem: 'FECHAMENTO_FISCAL'
  });
  return reserva.numero;
}

async function assinarXml({ config, xmlSemAssinatura, chave }, deps) {
  if (typeof deps.assinarDocumento === 'function') {
    return deps.assinarDocumento({ config, xmlSemAssinatura, chave });
  }

  const { carregarCertificadoPfx } = require('../fiscal/certificateService');
  const { assinarNFe } = require('../fiscal/signer');
  const { gerarQRCodeNFCe } = require('../fiscal/qrcode');
  const { compactarXml } = require('../fiscal/utils');

  if (!config.certificadoPath) {
    const err = new Error('Certificado digital não configurado.');
    err.code = 'CERTIFICADO_AUSENTE';
    err.statusCode = 400;
    throw err;
  }

  const certificado = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);
  const xmlParaAssinar = compactarXml(xmlSemAssinatura);
  const assinatura = assinarNFe(xmlParaAssinar, certificado.privateKeyPem, certificado.certPem);

  const consultaUrlQr = String(config.urls?.consultaQr || '').trim();
  const urlConsulta = String(config.urls?.consultaChave || '').trim();
  if (!consultaUrlQr || !urlConsulta) {
    const err = new Error('URLs de QR Code / consulta chave não configuradas para o ambiente.');
    err.code = 'URL_CONSULTA_AUSENTE';
    err.statusCode = 400;
    throw err;
  }

  const qrCodeUrl = gerarQRCodeNFCe({
    chave,
    ambiente: config.ambiente,
    idCSC: config.idCSC,
    CSC: config.tokenCSC,
    consultaUrl: consultaUrlQr,
    uf: config.uf
  });

  const infNFeSupl = `<infNFeSupl><qrCode><![CDATA[${qrCodeUrl}]]></qrCode><urlChave>${urlConsulta}</urlChave></infNFeSupl>`;
  let xmlAssinadoFinal = assinatura.xmlAssinado;
  const signatureMatch = xmlAssinadoFinal.match(/(<Signature[\s>])/);
  if (signatureMatch) {
    xmlAssinadoFinal = xmlAssinadoFinal.replace(signatureMatch[0], `${infNFeSupl}${signatureMatch[0]}`);
  } else {
    xmlAssinadoFinal = xmlAssinadoFinal.replace('</NFe>', `${infNFeSupl}</NFe>`);
  }

  return { xmlAssinado: xmlAssinadoFinal, qrCodeUrl };
}

async function enviarLote({ config, xmlAssinado, numero }, deps) {
  if (typeof deps.enviarAutorizacao === 'function') {
    return deps.enviarAutorizacao({ config, xmlAssinado, numero });
  }
  const { montarLote } = require('../fiscal/soapClient');
  const { enviarAutorizacao } = require('../fiscal/autorizacaoRuntime');
  const loteXml = montarLote(xmlAssinado, String(numero));
  return enviarAutorizacao({
    url: config.urls?.autorizacao,
    loteXml,
    ambiente: config.ambiente,
    cUF: config.codigoUf || '23',
    versaoDados: '4.00',
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha
  });
}

async function consultarDoc({ config, chave }, deps) {
  if (typeof deps.consultarProtocolo === 'function') {
    return deps.consultarProtocolo({ config, chave });
  }
  const { consultarProtocolo } = require('../fiscal/consultaProtocoloRuntime');
  return consultarProtocolo({
    chave,
    ambiente: config.ambiente,
    modelo: 'NFCE',
    cUF: config.codigoUf || '23',
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha
  });
}

async function registrarTentativa(db, row) {
  try {
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_transmissoes (
        fechamento_fiscal_id, documento_id, usuario_id, tentativa, ambiente, status,
        cstat, xmotivo, chave_acesso, protocolo, duracao_ms, xml_enviado_hash,
        retorno_resumo, erro_tecnico, valor_transmitido, numero_nfce, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.fechamento_fiscal_id,
        row.documento_id,
        row.usuario_id || null,
        row.tentativa || 1,
        row.ambiente || null,
        row.status || null,
        row.cstat || null,
        row.xmotivo || null,
        row.chave_acesso || null,
        row.protocolo || null,
        row.duracao_ms != null ? row.duracao_ms : null,
        row.xml_enviado_hash || null,
        row.retorno_resumo != null ? String(row.retorno_resumo).slice(0, 2000) : null,
        row.erro_tecnico != null ? String(row.erro_tecnico).slice(0, 1000) : null,
        row.valor_transmitido != null ? Number(row.valor_transmitido) : null,
        row.numero_nfce != null ? Number(row.numero_nfce) : null,
        agoraLocal()
      ]
    );
  } catch (_) {
    // Compatibilidade se migração ainda não aplicou colunas novas
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_transmissoes (
        fechamento_fiscal_id, documento_id, usuario_id, tentativa, ambiente, status,
        cstat, xmotivo, chave_acesso, protocolo, duracao_ms, xml_enviado_hash,
        retorno_resumo, erro_tecnico, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.fechamento_fiscal_id,
        row.documento_id,
        row.usuario_id || null,
        row.tentativa || 1,
        row.ambiente || null,
        row.status || null,
        row.cstat || null,
        row.xmotivo || null,
        row.chave_acesso || null,
        row.protocolo || null,
        row.duracao_ms != null ? row.duracao_ms : null,
        row.xml_enviado_hash || null,
        row.retorno_resumo != null ? String(row.retorno_resumo).slice(0, 2000) : null,
        row.erro_tecnico != null ? String(row.erro_tecnico).slice(0, 1000) : null,
        agoraLocal()
      ]
    );
  }
}

function montarStatusFechamento(docs) {
  const statuses = docs.map((d) => d.status);
  if (!statuses.length) return STATUS.EMITINDO;
  if (statuses.every((s) => s === DOC_STATUS.AUTORIZADO)) return STATUS.AUTORIZADO;

  const temAutorizado = statuses.some((s) => s === DOC_STATUS.AUTORIZADO);
  const temRejeitado = statuses.some((s) => s === DOC_STATUS.REJEITADO);
  const temErro = statuses.some((s) => s === DOC_STATUS.ERRO);
  const temPendenteRecuperacao = statuses.some(
    (s) => s === DOC_STATUS.EMITINDO || s === DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO
  );

  if (temPendenteRecuperacao) {
    return STATUS.PENDENTE_RECUPERACAO;
  }

  if (temAutorizado && (temRejeitado || temErro)) {
    return STATUS.AUTORIZACAO_PARCIAL;
  }

  if (temAutorizado) return STATUS.AUTORIZADO;
  if (statuses.every((s) => s === DOC_STATUS.REJEITADO)) return STATUS.REJEITADO;
  if (temRejeitado && !temAutorizado) return STATUS.REJEITADO;
  if (temErro) return STATUS.ERRO;
  return STATUS.EMITINDO;
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Diagnóstico real de prontidão para transmissão (PRODUÇÃO ou HOMOLOGAÇÃO).
 * Não trata ambiente PRODUÇÃO como erro.
 */
function diagnosticarProntidaoTransmissao(config = {}, opts = {}) {
  const pendencias = [];
  const ambiente = Number(config.ambiente);
  const ambienteOk = ambiente === AMBIENTE.PRODUCAO || ambiente === AMBIENTE.HOMOLOGACAO;
  if (!ambienteOk) {
    pendencias.push({
      campo: 'ambiente',
      codigo: 'AMBIENTE_AUSENTE',
      mensagem: 'Ambiente fiscal não configurado (produção ou homologação).'
    });
  }

  const cnpj = onlyDigits(config.cnpj);
  if (cnpj.length !== 14) {
    pendencias.push({
      campo: 'cnpj',
      codigo: 'CNPJ_AUSENTE',
      mensagem: 'CNPJ do emitente não configurado ou inválido.'
    });
  }

  const uf = String(config.uf || '').trim();
  if (!uf) {
    pendencias.push({
      campo: 'uf',
      codigo: 'UF_AUSENTE',
      mensagem: 'UF do emitente não configurada.'
    });
  }

  const serie = Number(config.serie);
  if (!(serie >= 0) || Number.isNaN(serie)) {
    pendencias.push({
      campo: 'serie',
      codigo: 'SERIE_AUSENTE',
      mensagem: 'Série fiscal não configurada.'
    });
  }

  const temCert = Boolean(config.certificadoPath || config.certificado_path)
    || opts.certificadoOpcional === true
    || typeof opts.assinarDocumento === 'function';
  if (!temCert) {
    pendencias.push({
      campo: 'certificado',
      codigo: 'CERTIFICADO_AUSENTE',
      mensagem: 'Certificado digital não configurado.'
    });
  }

  const idCsc = String(config.idCSC || config.id_csc || '').trim();
  const tokenCsc = String(config.tokenCSC || config.token_csc || '').trim();
  if (!idCsc || !tokenCsc) {
    pendencias.push({
      campo: 'csc',
      codigo: 'CSC_AUSENTE',
      mensagem: 'CSC/token NFC-e não configurado para o ambiente.'
    });
  }

  const urls = config.urls || {};
  if (!String(urls.autorizacao || '').trim()) {
    pendencias.push({
      campo: 'endpoint',
      codigo: 'URL_AUTORIZACAO_AUSENTE',
      mensagem: 'Endpoint SEFAZ de autorização não configurado para o ambiente.'
    });
  }
  if (!String(urls.consultaQr || '').trim() || !String(urls.consultaChave || '').trim()) {
    pendencias.push({
      campo: 'endpoint',
      codigo: 'URL_CONSULTA_AUSENTE',
      mensagem: 'URLs de QR Code / consulta chave não configuradas para o ambiente.'
    });
  }

  const ok = pendencias.length === 0;
  return {
    ok,
    ambiente: ambienteOk ? ambiente : null,
    ambiente_label: ambiente === AMBIENTE.PRODUCAO
      ? 'PRODUÇÃO'
      : (ambiente === AMBIENTE.HOMOLOGACAO ? 'HOMOLOGAÇÃO' : null),
    transmissao_habilitada: ok,
    producao_bloqueada: false,
    pendencias,
    mensagem: ok
      ? (ambiente === AMBIENTE.PRODUCAO
        ? 'Ambiente fiscal em PRODUÇÃO — transmissão habilitada.'
        : 'Ambiente fiscal em HOMOLOGAÇÃO — ambiente de testes.')
      : (pendencias[0] && pendencias[0].mensagem) || 'Configuração fiscal incompleta.'
  };
}

async function exigirPrecondicoesTransmissao({ db, fechamentoId, opts, deps }) {
  const permitido = deps.moduloOn != null
    ? Boolean(deps.moduloOn)
    : await moduloConfig.estaAtivadaAsync(db);
  if (!permitido) {
    const err = new Error('Fechamento Fiscal do Dia está desativado. Ative em Configurações → Avançado → Fiscal.');
    err.statusCode = 403;
    err.code = 'MODULO_OFF';
    throw err;
  }

  if (opts.data_hora_emissao || opts.dhEmi || opts.forcar_dhEmi) {
    const err = new Error('Hora retroativa arbitrária não é permitida na transmissão.');
    err.statusCode = 400;
    err.code = 'HORA_RETROATIVA_PROIBIDA';
    throw err;
  }

  const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [fechamentoId]);
  if (!ff) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  if (!STATUS_PODEM_TRANSMITIR.includes(ff.status) && ff.status !== STATUS.AUTORIZADO) {
    const err = new Error(`Status ${ff.status} não permite transmissão.`);
    err.statusCode = 400;
    err.code = 'STATUS_INVALIDO';
    throw err;
  }

  const config = await resolverConfig(deps);
  const ambiente = Number(config.ambiente);

  const diagnostico = diagnosticarProntidaoTransmissao(config, {
    certificadoOpcional: deps.certificadoOpcional === true,
    assinarDocumento: deps.assinarDocumento
  });
  if (!diagnostico.ok) {
    const first = diagnostico.pendencias[0] || {};
    const err = new Error(first.mensagem || 'Configuração fiscal incompleta para transmissão.');
    err.statusCode = 400;
    err.code = first.codigo || 'CONFIG_FISCAL_INCOMPLETA';
    err.pendencias = diagnostico.pendencias;
    err.diagnostico = diagnostico;
    throw err;
  }

  const cnpjConfig = onlyDigits(config.cnpj);
  const cnpjFechamento = onlyDigits(ff.cnpj);
  if (cnpjFechamento && cnpjConfig && cnpjFechamento !== cnpjConfig) {
    const err = new Error('CNPJ do fechamento diverge do CNPJ da configuração fiscal. Transmissão bloqueada.');
    err.statusCode = 403;
    err.code = 'CNPJ_DIVERGENTE';
    throw err;
  }

  if (
    opts.empresa_id != null
    && ff.empresa_id != null
    && String(opts.empresa_id) !== String(ff.empresa_id)
  ) {
    const err = new Error('Fechamento pertence a outra empresa. Transmissão bloqueada.');
    err.statusCode = 403;
    err.code = 'EMPRESA_DIVERGENTE';
    throw err;
  }

  return { ff, config, ambiente, diagnostico };
}

/**
 * Transmite documentos do fechamento (PRODUÇÃO ou HOMOLOGAÇÃO).
 * Idempotente por documento AUTORIZADO.
 */
async function transmitirFechamento(fechamentoId, opts = {}, deps = {}) {
  return comLockTransmitir(fechamentoId, () => _transmitirFechamentoInterno(fechamentoId, opts, deps));
}

async function _transmitirFechamentoInterno(fechamentoId, opts = {}, deps = {}) {
  const db = getDb(deps.db);
  const id = Number(fechamentoId);
  const snapshotAntes = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;
  const saldoSvc = require('./FechamentoFiscalSaldoService');

  const { ff, config, ambiente } = await exigirPrecondicoesTransmissao({
    db, fechamentoId: id, opts, deps
  });

  // Congela valor_principal na 1ª transmissão; recalcula emitido/pendente do banco
  await saldoSvc.garantirValorPrincipal(
    db,
    id,
    ff.valor_distribuido > 0 ? ff.valor_distribuido : ff.valor_informado
  );
  let saldoPre = await saldoSvc.recalcularSaldoFechamento(db, id);

  // Legado/parcial: rota antiga (REJEITADO / AUTORIZACAO_PARCIAL) não transmite valor principal
  {
    const st = String(ff.status || '').toUpperCase();
    const parcialComSaldo = Number(saldoPre.valor_emitido_autorizado) > 0
      && Number(saldoPre.valor_pendente_emissao) > 0;
    if (
      parcialComSaldo
      && (st === STATUS.REJEITADO || st === STATUS.AUTORIZACAO_PARCIAL || st === STATUS.ERRO)
      && opts.continuar_emissao !== true
      && opts.continuar !== true
    ) {
      const bloqueioTx = saldoSvc.bloquearEmissaoIntegralSeParcial(saldoPre, {});
      if (bloqueioTx) throw bloqueioTx;
    }
  }

  // Já totalmente autorizado → idempotência do fechamento
  if (ff.status === STATUS.AUTORIZADO || saldoPre.concluido) {
    const docs = await listarDocumentos(db, id);
    const out = {
      ok: true,
      idempotente: true,
      status: STATUS.AUTORIZADO,
      mensagem: 'FECHAMENTO FISCAL AUTORIZADO (já existente)',
      documentos: docs,
      ambiente,
      transmissao_habilitada: true,
      protecao: { comercial_inalterado: true }
    };
    return saldoSvc.anexarSaldoAoResultado(out, saldoPre);
  }

  // Trava: se já EMITINDO sem documentos pendentes de envio novo, preferir recuperar
  await run(db, 'BEGIN IMMEDIATE');
  let lock;
  try {
    lock = await get(db, `SELECT status FROM fechamentos_fiscais WHERE id = ?`, [id]);
    if (lock.status === STATUS.AUTORIZADO) {
      await run(db, 'ROLLBACK');
      const docs = await listarDocumentos(db, id);
      return {
        ok: true,
        idempotente: true,
        status: STATUS.AUTORIZADO,
        documentos: docs,
        ambiente,
        transmissao_habilitada: true
      };
    }
    await run(
      db,
      `UPDATE fechamentos_fiscais SET status = ?, atualizado_em = ? WHERE id = ?`,
      [STATUS.EMITINDO, agoraLocal(), id]
    );
    await run(db, 'COMMIT');
  } catch (e) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }

  const docs = await listarDocumentos(db, id);
  if (!docs.length) {
    const err = new Error('Não há documentos preparados para transmitir.');
    err.statusCode = 400;
    err.code = 'SEM_DOCUMENTOS';
    throw err;
  }

  // Proteção: docs a transmitir não podem exceder o pendente nem repetir o principal
  if (Number(saldoPre.valor_emitido_autorizado) > 0 && Number(saldoPre.valor_pendente_emissao) > 0) {
    const { toCentavos: tc, arredondarMoeda: am } = require('../fiscal/modeloTotais');
    let somaCents = 0;
    for (const d of docs) {
      const st = String(d.status || '').toUpperCase();
      if (st === DOC_STATUS.AUTORIZADO || st === 'AUTORIZADA') continue;
      somaCents += tc(d.valor_total);
    }
    const pendCents = tc(saldoPre.valor_pendente_emissao);
    const princCents = tc(saldoPre.valor_principal);
    if (somaCents > pendCents + 1) {
      const err = new Error(
        `Documentos preparados (R$ ${am(somaCents / 100).toFixed(2)}) excedem o saldo pendente ` +
        `(R$ ${am(saldoPre.valor_pendente_emissao).toFixed(2)}). Use CONTINUAR EMISSÃO.`
      );
      err.statusCode = 409;
      err.code = 'FECHAMENTO_SALDO_EXCEDE_PENDENTE';
      err.saldo = saldoPre;
      throw err;
    }
    if (somaCents >= princCents - 1 && princCents > pendCents) {
      const bloqueio = saldoSvc.bloquearEmissaoIntegralSeParcial(saldoPre, {});
      if (bloqueio) throw bloqueio;
    }
  }

  const resultados = [];
  const dataEmissao = agoraLocal();

  for (const doc of docs) {
    // Nunca retransmitir autorizado
    if (doc.status === DOC_STATUS.AUTORIZADO && (doc.chave_acesso || doc.protocolo)) {
      resultados.push({
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: DOC_STATUS.AUTORIZADO,
        idempotente: true,
        chave_acesso: doc.chave_acesso,
        protocolo: doc.protocolo,
        mensagem: 'Documento já autorizado — não retransmitido.'
      });
      continue;
    }

    // Em EMITINDO / possível processamento → recuperar, não gerar novo
    if (
      (doc.status === DOC_STATUS.EMITINDO || doc.status === DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO)
      && (doc.chave_acesso || doc.chave_acesso_provisoria)
    ) {
      const recuperado = await recuperarDocumento(db, doc, config, opts, deps);
      resultados.push(recuperado);
      continue;
    }

    // Só transmite PRONTO / REJEITADO (reprocessamento) / ERRO técnico sem chave
    const podeEnviar = [
      DOC_STATUS.PRONTO_EMISSAO,
      DOC_STATUS.XML_GERADO,
      DOC_STATUS.VALIDADO,
      DOC_STATUS.REJEITADO,
      DOC_STATUS.ERRO
    ].includes(doc.status);

    if (!podeEnviar) {
      resultados.push({
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: doc.status,
        mensagem: `Status ${doc.status} não elegível para nova transmissão.`
      });
      continue;
    }

    if (!doc.xml_preparado && !(doc.itens || []).length) {
      resultados.push({
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: DOC_STATUS.ERRO,
        codigo: 'XML_AUSENTE',
        mensagem: 'Documento sem XML/snapshot válido.'
      });
      continue;
    }

    const t0 = Date.now();
    const tentativa = Number(doc.tentativa || 0) + 1;
    let numero = doc.numero;
    let xmlAssinado = null;
    let chave = doc.chave_acesso || null;

    try {
      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET status = ?, tentativa = ?, data_hora_emissao = COALESCE(data_hora_emissao, ?), atualizado_em = ?
         WHERE id = ?`,
        [DOC_STATUS.EMITINDO, tentativa, dataEmissao, agoraLocal(), doc.id]
      );

      // Numeração real somente agora — autoridade única: reservarProximaNumeracaoFiscal (modelo 65).
      // Documento REJEITADO NÃO reutiliza o nNF anterior; reserva o próximo oficial.
      if (!numero || doc.status === DOC_STATUS.REJEITADO) {
        numero = await reservarNumero(deps, config);
      }

      const snapshots = (doc.itens || []).map((it) => {
        if (it.snapshot_json) {
          try { return JSON.parse(it.snapshot_json); } catch (_) { /* fallthrough */ }
        }
        return {
          produto_id: it.produto_id,
          descricao: it.descricao,
          ncm: it.ncm,
          cest: it.cest,
          cfop: it.cfop,
          csosn: it.csosn,
          origem: it.origem,
          unidade: it.unidade,
          quantidade: it.quantidade,
          valor_unitario: it.valor_unitario,
          valor_total: it.valor_total,
          desconto: it.desconto || 0,
          acrescimo: it.acrescimo || 0
        };
      });

      const pags = doc.pagamentos || [];
      const gerado = await gerarXmlDocumento({
        config,
        snapshotItens: snapshots,
        pagamentos: pags,
        valorTotal: Number(doc.valor_total),
        numero,
        buildFn: deps.buildNfceXml
      });

      chave = gerado.chave;
      const assinado = await assinarXml({
        config,
        xmlSemAssinatura: gerado.xml,
        chave
      }, deps);
      xmlAssinado = assinado.xmlAssinado;

      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET numero = ?, serie = ?, ambiente = ?, tp_emis = ?,
             chave_acesso = ?, chave_acesso_provisoria = ?,
             xml_preparado = ?, xml_assinado = ?, xml_enviado = ?, xml_hash = ?,
             data_hora_emissao = ?, atualizado_em = ?
         WHERE id = ?`,
        [
          numero,
          String(config.serie),
          ambiente,
          TP_EMIS.NORMAL,
          chave,
          chave,
          gerado.xml,
          xmlAssinado,
          xmlAssinado,
          gerado.hash,
          dataEmissao,
          agoraLocal(),
          doc.id
        ]
      );

      const envio = await enviarLote({ config, xmlAssinado, numero }, deps);
      const raw = String(envio.raw || envio.body || envio.message || '');
      const cStat = envio.cStat || extrairCStat(raw);
      const xMotivo = envio.xMotivo || extrairXMotivo(raw) || envio.message || null;
      const protocolo = extrairNProt(raw) || envio.protocolo || null;
      const recibo = extrairNRec(raw);
      const duracao = Date.now() - t0;

      let extrairChaveEProtocoloAutorizados = null;
      try {
        extrairChaveEProtocoloAutorizados = require('../fiscal/utils').extrairChaveEProtocoloAutorizados;
      } catch (_) { /* optional */ }

      let statusFinal = DOC_STATUS.ERRO;
      let chaveFinal = chave;
      let xmlAutorizado = null;

      if (cStat === '100' || cStat === '150' || raw.includes('<cStat>100</cStat>')) {
        statusFinal = DOC_STATUS.AUTORIZADO;
        if (typeof extrairChaveEProtocoloAutorizados === 'function') {
          const auth = extrairChaveEProtocoloAutorizados(raw);
          if (auth?.chaveAcesso) chaveFinal = auth.chaveAcesso;
        }
        xmlAutorizado = xmlAssinado; // protNFe anexado quando disponível no raw
        if (raw.includes('<protNFe') || raw.includes('<nfeProc')) {
          xmlAutorizado = raw.includes('<nfeProc') ? raw : xmlAssinado;
        }
      } else if (String(cStat) === '539' || raw.includes('<cStat>539</cStat>')) {
        // Reconciliação obrigatória: não só rejeitar/incrementar
        if (typeof opts._reconciliacoes539 !== 'number') opts._reconciliacoes539 = 0;
        let recon = null;
        try {
          const {
            reconciliarCstat539Documento,
            RESULTADO: R539
          } = require('./NfceCstat539ReconciliacaoService');
          recon = await reconciliarCstat539Documento({
            db,
            fechamentoId: id,
            documento: doc,
            config,
            numeroEnviado: numero,
            chaveEnviada: chave,
            xMotivo,
            xmlRetorno: raw,
            contadorCiclo: opts._reconciliacoes539,
            deps
          });
          opts._reconciliacoes539 += 1;
          statusFinal = recon.statusDocumento || DOC_STATUS.REJEITADO;
          if (recon.chaveSefaz && recon.resultado === R539.AUTORIZADO) {
            chaveFinal = recon.chaveSefaz;
            if (recon.protocolo) {
              // protocolo local shadow — aplicado no UPDATE abaixo via variável
            }
          }
          if (recon.resultado === R539.LIMITE_LOOP || recon.statusFechamentoSugerido === STATUS.PENDENTE_RECUPERACAO) {
            opts._pararPorLimite539 = true;
          }
          resultados.push({
            documento_id: doc.id,
            sequencia: doc.sequencia,
            status: statusFinal,
            numero,
            serie: String(config.serie),
            chave_acesso: recon.chaveSefaz || chaveFinal,
            protocolo: recon.protocolo || protocolo,
            cstat: '539',
            xmotivo: xMotivo,
            duracao_ms: duracao,
            reconciliacao_539: recon,
            mensagem_usuario: recon.mensagem
          });
        } catch (e539) {
          statusFinal = DOC_STATUS.REJEITADO;
          logTecnico('numeracao_539_erro', {
            documento_id: doc.id,
            erro: e539.message || String(e539)
          });
          resultados.push({
            documento_id: doc.id,
            sequencia: doc.sequencia,
            status: statusFinal,
            numero,
            serie: String(config.serie),
            chave_acesso: chaveFinal,
            protocolo,
            cstat: '539',
            xmotivo: xMotivo,
            duracao_ms: duracao,
            mensagem_usuario:
              'Foi identificada uma numeração já existente na SEFAZ. '
              + 'O sistema está reconciliando o documento antes de continuar.',
            erro_reconciliacao: e539.message || String(e539)
          });
        }

        const protocolo539 = (recon && recon.protocolo) || protocolo;
        const chave539 = (recon && recon.resultado === 'AUTORIZADO' && recon.chaveSefaz)
          ? recon.chaveSefaz
          : chaveFinal;
        const dataAuth539 = statusFinal === DOC_STATUS.AUTORIZADO ? agoraLocal() : null;

        // Se reconciliacao já persistiu AUTORIZADO, não sobrescrever com REJEITADO
        if (!(recon && recon.resultado === 'AUTORIZADO')) {
          await run(
            db,
            `UPDATE fechamentos_fiscais_documentos
             SET status = ?, cstat = ?, xmotivo = ?, protocolo = COALESCE(?, protocolo),
                 chave_acesso = COALESCE(?, chave_acesso), xml_retorno = ?,
                 data_hora_autorizacao = COALESCE(?, data_hora_autorizacao),
                 atualizado_em = ?
             WHERE id = ?`,
            [
              statusFinal,
              '539',
              xMotivo,
              protocolo539,
              chave539,
              raw || null,
              dataAuth539,
              agoraLocal(),
              doc.id
            ]
          );
        } else {
          chaveFinal = chave539;
        }

        await registrarTentativa(db, {
          fechamento_fiscal_id: id,
          documento_id: doc.id,
          usuario_id: opts.usuario_id,
          tentativa,
          ambiente,
          status: statusFinal,
          cstat: '539',
          xmotivo: xMotivo,
          chave_acesso: chave539 || chaveFinal,
          protocolo: protocolo539,
          duracao_ms: duracao,
          xml_enviado_hash: hashXml(xmlAssinado),
          retorno_resumo: (recon && recon.mensagem) || xMotivo || '539',
          valor_transmitido: Number(doc.valor_total || 0),
          numero_nfce: numero
        });

        if (statusFinal === DOC_STATUS.AUTORIZADO) {
          try {
            const { persistirNfceAutorizadaDoFechamento } = require('./NfceHistoricoOficialService');
            const historicoNfce = await persistirNfceAutorizadaDoFechamento(db, {
              id: doc.id,
              fechamento_fiscal_id: id,
              status: statusFinal,
              numero,
              serie: config.serie,
              ambiente,
              chave_acesso: chaveFinal,
              protocolo: protocolo539,
              recibo,
              xml_enviado: xmlAssinado,
              xml_assinado: xmlAssinado,
              xml_retorno: raw || null,
              xml_autorizado: xmlAssinado
            }, { fechamentoId: id });
            const last = resultados[resultados.length - 1];
            if (last && last.documento_id === doc.id) last.historico_nfce = historicoNfce;
          } catch (histErr) {
            logTecnico('historico_nfce_erro', {
              fechamento_id: id,
              documento_id: doc.id,
              erro: histErr.message || String(histErr)
            });
          }
        }

        logTecnico('documento_transmitido', {
          fechamento_id: id,
          documento_id: doc.id,
          status: statusFinal,
          cStat: '539',
          reconciliacao: recon && recon.resultado,
          duracao_ms: duracao,
          ambiente
        });

        if (opts._pararPorLimite539) {
          break;
        }
        continue;
      } else if (isRejeicaoFiscal(cStat, raw)) {
        statusFinal = DOC_STATUS.REJEITADO;
      } else if (!envio.success && (envio.timeout || isTimeoutError(envio))) {
        statusFinal = DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO;
      } else if (!cStat && !envio.success) {
        statusFinal = DOC_STATUS.ERRO;
      } else {
        statusFinal = DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO;
      }

      const dataAuth = statusFinal === DOC_STATUS.AUTORIZADO ? agoraLocal() : null;

      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET status = ?, cstat = ?, xmotivo = ?, protocolo = ?, recibo = ?,
             chave_acesso = ?, xml_retorno = ?, xml_autorizado = COALESCE(?, xml_autorizado),
             data_hora_autorizacao = ?, atualizado_em = ?
         WHERE id = ?`,
        [
          statusFinal,
          cStat,
          xMotivo,
          protocolo,
          recibo,
          chaveFinal,
          raw || null,
          xmlAutorizado,
          dataAuth,
          agoraLocal(),
          doc.id
        ]
      );

      await registrarTentativa(db, {
        fechamento_fiscal_id: id,
        documento_id: doc.id,
        usuario_id: opts.usuario_id,
        tentativa,
        ambiente,
        status: statusFinal,
        cstat: cStat,
        xmotivo: xMotivo,
        chave_acesso: chaveFinal,
        protocolo,
        duracao_ms: duracao,
        xml_enviado_hash: hashXml(xmlAssinado),
        retorno_resumo: xMotivo || cStat,
        erro_tecnico: statusFinal === DOC_STATUS.ERRO || statusFinal === DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO
          ? (envio.message || null)
          : null,
        valor_transmitido: statusFinal === DOC_STATUS.AUTORIZADO
          ? Number(doc.valor_total || 0)
          : Number(doc.valor_total || 0),
        numero_nfce: numero
      });

      logTecnico('documento_transmitido', {
        fechamento_id: id,
        documento_id: doc.id,
        status: statusFinal,
        cStat,
        duracao_ms: duracao,
        ambiente
      });

      // Sprint 08.1 — após AUTORIZADO, integrar no histórico oficial (nfce_notas).
      let historicoNfce = null;
      if (statusFinal === DOC_STATUS.AUTORIZADO) {
        try {
          const { persistirNfceAutorizadaDoFechamento } = require('./NfceHistoricoOficialService');
          historicoNfce = await persistirNfceAutorizadaDoFechamento(db, {
            id: doc.id,
            fechamento_fiscal_id: id,
            status: statusFinal,
            numero,
            serie: config.serie,
            ambiente,
            chave_acesso: chaveFinal,
            protocolo,
            recibo,
            xml_enviado: xmlAssinado,
            xml_assinado: xmlAssinado,
            xml_retorno: raw || null,
            xml_autorizado: xmlAutorizado
          }, { fechamentoId: id });
          logTecnico('historico_nfce_persistido', {
            fechamento_id: id,
            documento_id: doc.id,
            nfce_id: historicoNfce?.nfce_id,
            idempotente: historicoNfce?.idempotente
          });
        } catch (histErr) {
          logTecnico('historico_nfce_erro', {
            fechamento_id: id,
            documento_id: doc.id,
            erro: histErr.message || String(histErr)
          });
        }
      }

      resultados.push({
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: statusFinal,
        numero,
        serie: String(config.serie),
        chave_acesso: chaveFinal,
        protocolo,
        cstat: cStat,
        xmotivo: xMotivo,
        duracao_ms: duracao,
        historico_nfce: historicoNfce
      });
    } catch (err) {
      const duracao = Date.now() - t0;
      const timeout = isTimeoutError(err);
      const statusFinal = timeout
        ? DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO
        : DOC_STATUS.ERRO;

      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET status = ?, xmotivo = ?, chave_acesso = COALESCE(chave_acesso, ?),
             numero = COALESCE(numero, ?), xml_assinado = COALESCE(xml_assinado, ?),
             xml_enviado = COALESCE(xml_enviado, ?), atualizado_em = ?
         WHERE id = ?`,
        [
          statusFinal,
          err.message || String(err),
          chave,
          numero || null,
          xmlAssinado,
          xmlAssinado,
          agoraLocal(),
          doc.id
        ]
      ).catch(() => {});

      await registrarTentativa(db, {
        fechamento_fiscal_id: id,
        documento_id: doc.id,
        usuario_id: opts.usuario_id,
        tentativa,
        ambiente,
        status: statusFinal,
        chave_acesso: chave,
        duracao_ms: duracao,
        xml_enviado_hash: xmlAssinado ? hashXml(xmlAssinado) : null,
        erro_tecnico: err.message || String(err)
      }).catch(() => {});

      logTecnico('documento_erro', {
        fechamento_id: id,
        documento_id: doc.id,
        status: statusFinal,
        timeout,
        erro: err.message
      });

      resultados.push({
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: statusFinal,
        mensagem: err.message || String(err),
        timeout: Boolean(timeout),
        codigo: timeout ? 'TIMEOUT' : (err.code || 'ERRO_TECNICO')
      });
    }
  }

  const docsFinais = await listarDocumentos(db, id);
  let statusFinal = montarStatusFechamento(docsFinais);

  if (opts._pararPorLimite539) {
    statusFinal = STATUS.PENDENTE_RECUPERACAO;
  }

  const ultimoAuth = resultados
    .filter((r) => r.status === DOC_STATUS.AUTORIZADO && !r.idempotente)
    .reduce((s, r) => {
      const doc = docsFinais.find((d) => Number(d.id) === Number(r.documento_id));
      return s + (doc ? Number(doc.valor_total || 0) : 0);
    }, 0);

  const saldo = await saldoSvc.recalcularSaldoFechamento(db, id, {
    ultimoAutorizado: ultimoAuth > 0 ? ultimoAuth : null
  });

  if (saldo.concluido) {
    statusFinal = STATUS.AUTORIZADO;
  } else if (opts._pararPorLimite539) {
    statusFinal = STATUS.PENDENTE_RECUPERACAO;
  } else if (
    Number(saldo.valor_emitido_autorizado) > 0
    && statusFinal !== STATUS.PENDENTE_RECUPERACAO
  ) {
    statusFinal = STATUS.AUTORIZACAO_PARCIAL;
  }

  const dataAuthFech = statusFinal === STATUS.AUTORIZADO ? agoraLocal() : null;

  await run(
    db,
    `UPDATE fechamentos_fiscais
     SET status = ?,
         data_hora_emissao = COALESCE(data_hora_emissao, ?),
         data_hora_autorizacao = COALESCE(?, data_hora_autorizacao),
         atualizado_em = ?
     WHERE id = ?`,
    [statusFinal, dataEmissao, dataAuthFech, agoraLocal(), id]
  );

  const snapshotDepois = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;
  const autorizados = docsFinais.filter((d) => d.status === DOC_STATUS.AUTORIZADO).length;
  const rejeitados = docsFinais.filter((d) => d.status === DOC_STATUS.REJEITADO).length;
  const erros = docsFinais.filter((d) =>
    d.status === DOC_STATUS.ERRO || d.status === DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO
  ).length;

  const docsComHistorico = docsFinais.map((d) => {
    const r = resultados.find((x) => Number(x.documento_id) === Number(d.id));
    if (r && r.historico_nfce) {
      return { ...d, historico_nfce: r.historico_nfce };
    }
    return d;
  });

  let mensagem = statusFinal === STATUS.AUTORIZADO
    ? '✓ FECHAMENTO FISCAL AUTORIZADO'
    : statusFinal === STATUS.AUTORIZACAO_PARCIAL
      ? `⚠ AUTORIZAÇÃO PARCIAL — emitido R$ ${Number(saldo.valor_emitido_autorizado).toFixed(2)} · restante R$ ${Number(saldo.valor_pendente_emissao).toFixed(2)}`
      : statusFinal === STATUS.PENDENTE_RECUPERACAO
        ? '⟳ PENDENTE DE RECUPERAÇÃO — consulte status antes de nova identidade'
        : (rejeitados ? '⚠ DOCUMENTO(S) REJEITADO(S)' : 'Transmissão concluída com pendências');

  const tem539 = resultados.some((r) =>
    String(r.cstat) === '539' || (r.reconciliacao_539 && r.reconciliacao_539.reconciliacao)
  );
  if (tem539) {
    mensagem =
      'Foi identificada uma numeração já existente na SEFAZ. '
      + 'O sistema está reconciliando o documento antes de continuar.\n'
      + mensagem;
  }

  if (saldo.mensagens && saldo.mensagens.length) {
    mensagem = `${mensagem}\n${saldo.mensagens.join('\n')}`;
  }

  const out = {
    ok: statusFinal === STATUS.AUTORIZADO,
    status: statusFinal,
    ambiente,
    transmissao_habilitada: true,
    producao_bloqueada: false,
    ambiente_label: ambiente === AMBIENTE.PRODUCAO ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO',
    resumo: {
      total: docsComHistorico.length,
      autorizados,
      rejeitados,
      erros,
      valor_total: ff.valor_informado,
      valor_principal: saldo.valor_principal,
      valor_emitido_autorizado: saldo.valor_emitido_autorizado,
      valor_pendente_emissao: saldo.valor_pendente_emissao
    },
    documentos: docsComHistorico,
    resultados,
    mensagem,
    data_referencia_comercial: ff.data_referencia_comercial || ff.data_fechamento,
    protecao: {
      snapshot_antes: snapshotAntes,
      snapshot_depois: snapshotDepois,
      comercial_inalterado: snapshotAntes && snapshotDepois
        ? JSON.stringify(snapshotAntes) === JSON.stringify(snapshotDepois)
        : true
    }
  };
  return saldoSvc.anexarSaldoAoResultado(out, saldo);
}

async function recuperarDocumento(db, doc, config, opts, deps) {
  const chave = doc.chave_acesso || doc.chave_acesso_provisoria;
  if (!chave) {
    return {
      documento_id: doc.id,
      sequencia: doc.sequencia,
      status: doc.status,
      mensagem: 'Sem chave para recuperação.'
    };
  }

  const t0 = Date.now();
  try {
    const consulta = await consultarDoc({ config, chave }, deps);
    const raw = String(consulta.raw || consulta.body || '');
    const cStat = consulta.cStat || extrairCStat(raw);
    const xMotivo = extrairXMotivo(raw);
    const protocolo = extrairNProt(raw);

    if (cStat === '100' || cStat === '150') {
      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET status = ?, cstat = ?, xmotivo = ?, protocolo = ?,
             chave_acesso = ?, xml_retorno = ?, xml_autorizado = COALESCE(xml_autorizado, xml_assinado, xml_enviado),
             data_hora_autorizacao = ?, atualizado_em = ?
         WHERE id = ?`,
        [DOC_STATUS.AUTORIZADO, cStat, xMotivo, protocolo, chave, raw || null, agoraLocal(), agoraLocal(), doc.id]
      );
      await registrarTentativa(db, {
        fechamento_fiscal_id: doc.fechamento_fiscal_id,
        documento_id: doc.id,
        usuario_id: opts.usuario_id,
        tentativa: Number(doc.tentativa || 0) + 1,
        ambiente: Number(config.ambiente),
        status: DOC_STATUS.AUTORIZADO,
        cstat: cStat,
        xmotivo: xMotivo,
        chave_acesso: chave,
        protocolo,
        duracao_ms: Date.now() - t0,
        retorno_resumo: 'RECUPERACAO_AUTORIZADO'
      });
      try {
        const { persistirNfceAutorizadaDoFechamento } = require('./NfceHistoricoOficialService');
        const docAtualizado = await get(db, `SELECT * FROM fechamentos_fiscais_documentos WHERE id = ?`, [doc.id]);
        await persistirNfceAutorizadaDoFechamento(db, docAtualizado || {
          ...doc,
          status: DOC_STATUS.AUTORIZADO,
          cstat: cStat,
          xmotivo: xMotivo,
          protocolo,
          chave_acesso: chave,
          xml_retorno: raw || null
        }, { fechamentoId: doc.fechamento_fiscal_id });
      } catch (histErr) {
        logTecnico('historico_nfce_erro_recuperacao', {
          documento_id: doc.id,
          erro: histErr.message || String(histErr)
        });
      }
      return {
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: DOC_STATUS.AUTORIZADO,
        recuperado: true,
        chave_acesso: chave,
        protocolo,
        cstat: cStat
      };
    }

    if (isRejeicaoFiscal(cStat, raw)) {
      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET status = ?, cstat = ?, xmotivo = ?, xml_retorno = ?, atualizado_em = ?
         WHERE id = ?`,
        [DOC_STATUS.REJEITADO, cStat, xMotivo, raw || null, agoraLocal(), doc.id]
      );
      return {
        documento_id: doc.id,
        sequencia: doc.sequencia,
        status: DOC_STATUS.REJEITADO,
        recuperado: true,
        cstat: cStat,
        xmotivo: xMotivo
      };
    }

    return {
      documento_id: doc.id,
      sequencia: doc.sequencia,
      status: doc.status,
      recuperado: false,
      cstat: cStat,
      xmotivo: xMotivo,
      mensagem: 'SEFAZ ainda sem autorização definitiva.'
    };
  } catch (err) {
    return {
      documento_id: doc.id,
      sequencia: doc.sequencia,
      status: doc.status,
      recuperado: false,
      mensagem: err.message || String(err)
    };
  }
}

async function recuperarFechamento(fechamentoId, opts = {}, deps = {}) {
  const db = getDb(deps.db);
  const id = Number(fechamentoId);
  const snapshotAntes = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;

  const permitido = deps.moduloOn != null
    ? Boolean(deps.moduloOn)
    : await moduloConfig.estaAtivadaAsync(db);
  if (!permitido) {
    const err = new Error('Fechamento Fiscal do Dia está desativado.');
    err.statusCode = 403;
    err.code = 'MODULO_OFF';
    throw err;
  }

  const ff = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [id]);
  if (!ff) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  const config = await resolverConfig(deps);
  const diagnostico = diagnosticarProntidaoTransmissao(config, {
    certificadoOpcional: deps.certificadoOpcional === true,
    assinarDocumento: deps.assinarDocumento
  });
  if (!diagnostico.ok) {
    const first = diagnostico.pendencias[0] || {};
    const err = new Error(first.mensagem || 'Configuração fiscal incompleta para recuperação.');
    err.statusCode = 400;
    err.code = first.codigo || 'CONFIG_FISCAL_INCOMPLETA';
    err.pendencias = diagnostico.pendencias;
    throw err;
  }

  const docs = await listarDocumentos(db, id);
  const alvos = docs.filter((d) =>
    d.status === DOC_STATUS.EMITINDO
    || d.status === DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO
    || (d.status === DOC_STATUS.ERRO && (d.chave_acesso || d.chave_acesso_provisoria))
  );

  const resultados = [];
  for (const doc of alvos) {
    resultados.push(await recuperarDocumento(db, doc, config, opts, deps));
  }

  const docsFinais = await listarDocumentos(db, id);
  let statusFinal = montarStatusFechamento(docsFinais);
  const saldoSvc = require('./FechamentoFiscalSaldoService');
  const saldo = await saldoSvc.recalcularSaldoFechamento(db, id);
  if (saldo.concluido) statusFinal = STATUS.AUTORIZADO;
  else if (Number(saldo.valor_emitido_autorizado) > 0 && statusFinal !== STATUS.PENDENTE_RECUPERACAO) {
    statusFinal = STATUS.AUTORIZACAO_PARCIAL;
  }
  await run(
    db,
    `UPDATE fechamentos_fiscais
     SET status = ?,
         data_hora_autorizacao = CASE WHEN ? = 'AUTORIZADO' THEN COALESCE(data_hora_autorizacao, ?) ELSE data_hora_autorizacao END,
         atualizado_em = ?
     WHERE id = ?`,
    [statusFinal, statusFinal, agoraLocal(), agoraLocal(), id]
  );

  const snapshotDepois = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;

  const out = {
    ok: true,
    status: statusFinal,
    resultados,
    documentos: docsFinais,
    ambiente: Number(config.ambiente),
    protecao: {
      snapshot_antes: snapshotAntes,
      snapshot_depois: snapshotDepois,
      comercial_inalterado: snapshotAntes && snapshotDepois
        ? JSON.stringify(snapshotAntes) === JSON.stringify(snapshotDepois)
        : true
    }
  };
  return saldoSvc.anexarSaldoAoResultado(out, saldo);
}

module.exports = {
  transmitirFechamento,
  recuperarFechamento,
  montarStatusFechamento,
  diagnosticarProntidaoTransmissao,
  extrairCStat,
  extrairXMotivo
};
