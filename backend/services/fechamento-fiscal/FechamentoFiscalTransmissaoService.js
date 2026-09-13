/**
 * Sprint 04 — Transmissão / autorização SEFAZ (somente HOMOLOGAÇÃO).
 * Reutiliza motor NFC-e existente. NÃO baixa estoque / financeiro / caixa / vendas.
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
  const m = String(raw || '').match(/<cStat>\s*(\d+)\s*<\/cStat>/i);
  return m ? m[1] : null;
}

function extrairXMotivo(raw) {
  const m = String(raw || '').match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
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
  if (typeof deps.incrementaNumeroFiscal === 'function') {
    return deps.incrementaNumeroFiscal(config);
  }
  const { incrementaNumeroFiscal } = require('../fiscal/configService');
  return incrementaNumeroFiscal();
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

function montarStatusFechamento(docs) {
  const statuses = docs.map((d) => d.status);
  if (statuses.every((s) => s === DOC_STATUS.AUTORIZADO)) return STATUS.AUTORIZADO;
  if (statuses.some((s) => s === DOC_STATUS.EMITINDO || s === DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO)) {
    return STATUS.EMITINDO;
  }
  if (statuses.some((s) => s === DOC_STATUS.AUTORIZADO)) {
    // parcial: autorizados + rejeitados/erro
    if (statuses.some((s) => s === DOC_STATUS.REJEITADO)) return STATUS.REJEITADO;
    if (statuses.some((s) => s === DOC_STATUS.ERRO)) return STATUS.ERRO;
    return STATUS.AUTORIZADO;
  }
  if (statuses.every((s) => s === DOC_STATUS.REJEITADO)) return STATUS.REJEITADO;
  if (statuses.some((s) => s === DOC_STATUS.REJEITADO)) return STATUS.REJEITADO;
  if (statuses.some((s) => s === DOC_STATUS.ERRO)) return STATUS.ERRO;
  return STATUS.EMITINDO;
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

  // Sprint 04: somente homologação — produção sempre bloqueada
  if (ambiente === AMBIENTE.PRODUCAO) {
    const err = new Error('AMBIENTE DE PRODUÇÃO → BLOQUEADO nesta Sprint. Use homologação.');
    err.statusCode = 403;
    err.code = 'PRODUCAO_BLOQUEADA';
    throw err;
  }
  if (ambiente !== AMBIENTE.HOMOLOGACAO) {
    const err = new Error('Transmissão do Fechamento Fiscal permitida somente em HOMOLOGAÇÃO nesta Sprint.');
    err.statusCode = 403;
    err.code = 'AMBIENTE_NAO_HOMOLOGACAO';
    throw err;
  }

  return { ff, config, ambiente };
}

/**
 * Transmite documentos do fechamento (homologação).
 * Idempotente por documento AUTORIZADO.
 */
async function transmitirFechamento(fechamentoId, opts = {}, deps = {}) {
  return comLockTransmitir(fechamentoId, () => _transmitirFechamentoInterno(fechamentoId, opts, deps));
}

async function _transmitirFechamentoInterno(fechamentoId, opts = {}, deps = {}) {
  const db = getDb(deps.db);
  const id = Number(fechamentoId);
  const snapshotAntes = deps.capturarSnapshot !== false ? await snapshotComercial(db) : null;

  const { ff, config, ambiente } = await exigirPrecondicoesTransmissao({
    db, fechamentoId: id, opts, deps
  });

  // Já totalmente autorizado → idempotência do fechamento
  if (ff.status === STATUS.AUTORIZADO) {
    const docs = await listarDocumentos(db, id);
    return {
      ok: true,
      idempotente: true,
      status: STATUS.AUTORIZADO,
      mensagem: 'FECHAMENTO FISCAL AUTORIZADO (já existente)',
      documentos: docs,
      ambiente,
      transmissao_habilitada: true,
      protecao: { comercial_inalterado: true }
    };
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

      // Numeração real somente agora
      if (!numero) {
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
      const xMotivo = extrairXMotivo(raw) || envio.message || null;
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
          : null
      });

      logTecnico('documento_transmitido', {
        fechamento_id: id,
        documento_id: doc.id,
        status: statusFinal,
        cStat,
        duracao_ms: duracao,
        ambiente
      });

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
        duracao_ms: duracao
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
  const statusFinal = montarStatusFechamento(docsFinais);
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

  return {
    ok: statusFinal === STATUS.AUTORIZADO,
    status: statusFinal,
    ambiente,
    transmissao_habilitada: true,
    producao_bloqueada: true,
    resumo: {
      total: docsFinais.length,
      autorizados,
      rejeitados,
      erros,
      valor_total: ff.valor_informado
    },
    documentos: docsFinais,
    resultados,
    mensagem: statusFinal === STATUS.AUTORIZADO
      ? '✓ FECHAMENTO FISCAL AUTORIZADO'
      : (rejeitados ? '⚠ DOCUMENTO(S) REJEITADO(S)' : 'Transmissão concluída com pendências'),
    data_referencia_comercial: ff.data_referencia_comercial || ff.data_fechamento,
    protecao: {
      snapshot_antes: snapshotAntes,
      snapshot_depois: snapshotDepois,
      comercial_inalterado: snapshotAntes && snapshotDepois
        ? JSON.stringify(snapshotAntes) === JSON.stringify(snapshotDepois)
        : true
    }
  };
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
  if (Number(config.ambiente) !== AMBIENTE.HOMOLOGACAO) {
    const err = new Error('Recuperação permitida somente em HOMOLOGAÇÃO nesta Sprint.');
    err.statusCode = 403;
    err.code = 'AMBIENTE_NAO_HOMOLOGACAO';
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
  const statusFinal = montarStatusFechamento(docsFinais);
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

  return {
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
}

module.exports = {
  transmitirFechamento,
  recuperarFechamento,
  montarStatusFechamento,
  extrairCStat,
  extrairXMotivo
};
