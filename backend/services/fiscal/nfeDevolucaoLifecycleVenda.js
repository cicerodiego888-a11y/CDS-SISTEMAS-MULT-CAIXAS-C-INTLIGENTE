/**
 * RC5 — Ciclo de vida oficial da NF-e de Devolução de Venda (reutiliza motor RC4).
 * Não altera o pipeline Builder → Assinatura → Validação → SEFAZ → DANFE (RC1–RC3).
 * Centraliza: estados, consulta automática (cStat 103), sync, cancelamento oficial,
 * histórico de eventos, XML versionado, auditoria e reenvio seguro.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { assinarEvento } = require('./signer');
const { carregarCertificadoPfx } = require('./certificateService');
const { compactarXml, onlyDigits } = require('./utils');
const { getFiscalSubDir } = require('./paths');
const { montarLote, enviarLote } = require('./soapClient');
const { parseRetornoAutorizacaoNfe } = require('./nfeRetornoAutorizacao');
const { consultarProtocolo } = require('./consultaProtocoloRuntime');
const { enviarCancelamento } = require('./cancelamentoRuntime');
const { ModelType } = require('./core/ModelType');
const { validarMotivoTexto } = require('../validacao/validarMotivoTexto');
const { classificarErro } = require('./nfeErros');
const {
  ESTADOS,
  EVENTOS,
  uiDoEstado,
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  mensagemRejeicaoDetalhada,
  xmlRejeicaoFiscalDefinitiva,
  mensagemReenvioXmlEstruturalmenteRejeitado
} = require('./nfeDevolucaoEstados');
const {
  cancelarNfeDevolucaoVenda,
  persistirItensNfeDevolucaoVenda
} = require('./controleSaldoDevolucaoVenda');
const { getCancelamentoUrlNfe, validarPrazoCancelamento } = require('./cancelarNfe');
const { getUrlNFe55 } = require('./nfeEmissorVenda');

const BACKOFF_MS = [3000, 8000, 15000, 30000, 60000];
const consultaTimers = new Map();

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

function agoraLocal() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function pastaLog() {
  return getFiscalSubDir('debug/nfe-devolucao');
}

function appendLog(arquivo, linha) {
  try {
    const pasta = pastaLog();
    const stamp = new Date().toISOString();
    fs.appendFileSync(
      path.join(pasta, arquivo),
      `[${stamp}] ${typeof linha === 'string' ? linha : JSON.stringify(linha)}\n`,
      'utf8'
    );
  } catch (_) { /* ignore */ }
}

let schemaOk = false;

async function garantirSchemaLifecycle() {
  if (schemaOk) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucoes_venda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER NOT NULL,
      numero INTEGER,
      serie INTEGER,
      chave_acesso TEXT,
      chave_referenciada TEXT,
      protocolo TEXT,
      ambiente INTEGER,
      status TEXT,
      natureza_operacao TEXT,
      cfop TEXT,
      xml_enviado TEXT,
      xml_retorno TEXT,
      danfe_html TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const alters = [
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN recibo TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN fila_estado TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN consultado_em TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN sincronizado_em TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN cstat_retorno TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xmotivo_retorno TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN consulta_auto_tentativas INTEGER DEFAULT 0`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN proxima_consulta_em TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN protocolo_cancelamento TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xml_gerado TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xml_assinado TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xml_autorizado TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xml_cancelamento TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN danfe_html_cancelado TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN tempo_resposta_ms INTEGER`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN ultimo_ip TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN ultimo_computador TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN rejeicao_codigo TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN rejeicao_motivo TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xml_hash TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN xml_assinado_hash TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN cnf TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN tp_emis TEXT`,
    `ALTER TABLE nfe_devolucoes_venda ADD COLUMN identidade_congelada INTEGER DEFAULT 0`
  ];
  for (const sql of alters) {
    try {
      await dbRun(sql);
    } catch (_) { /* coluna já existe */ }
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_venda_eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_devolucao_id INTEGER NOT NULL,
      venda_id INTEGER,
      evento TEXT NOT NULL,
      status TEXT,
      cstat TEXT,
      xmotivo TEXT,
      mensagem TEXT,
      usuario_id INTEGER,
      usuario_nome TEXT,
      ip TEXT,
      computador TEXT,
      tempo_resposta_ms INTEGER,
      detalhes_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_venda_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_devolucao_id INTEGER,
      venda_id INTEGER,
      usuario_id INTEGER,
      usuario_nome TEXT,
      acao TEXT NOT NULL,
      status TEXT,
      ip TEXT,
      computador TEXT,
      tempo_resposta_ms INTEGER,
      detalhes_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  schemaOk = true;
}

async function obterNota(notaId) {
  await garantirSchemaLifecycle();
  return dbGet(`SELECT * FROM nfe_devolucoes_venda WHERE id = ?`, [Number(notaId)]);
}

async function atualizarNota(notaId, fields = {}) {
  await garantirSchemaLifecycle();
  const nota = await obterNota(notaId);
  const { filtrarCamposIdentidadeSeCongelado } = require('./nfeIdentityService');
  const seguro = filtrarCamposIdentidadeSeCongelado(nota, fields);
  const cols = [];
  const params = [];
  for (const [k, v] of Object.entries(seguro)) {
    if (v === undefined) continue;
    cols.push(`${k} = ?`);
    params.push(v);
  }
  if (!cols.length) return;
  cols.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(Number(notaId));
  await dbRun(`UPDATE nfe_devolucoes_venda SET ${cols.join(', ')} WHERE id = ?`, params);
}

/**
 * Persiste XML versionado sem sobrescrever versões anteriores.
 */
async function persistirXmlsVersionados(notaId, {
  xmlGerado,
  xmlAssinado,
  xmlAutorizado,
  xmlCancelamento,
  xmlRetorno
} = {}) {
  const nota = await obterNota(notaId);
  if (!nota) return;
  const patch = {};
  if (xmlGerado && !nota.xml_gerado) patch.xml_gerado = xmlGerado;
  if (xmlAssinado) {
    if (!nota.xml_assinado) patch.xml_assinado = xmlAssinado;
    if (!nota.xml_enviado) patch.xml_enviado = xmlAssinado;
  }
  if (xmlAutorizado && !nota.xml_autorizado) patch.xml_autorizado = xmlAutorizado;
  if (xmlCancelamento && !nota.xml_cancelamento) patch.xml_cancelamento = xmlCancelamento;
  if (xmlRetorno != null) patch.xml_retorno = xmlRetorno;
  if (Object.keys(patch).length) await atualizarNota(notaId, patch);
}

async function registrarEvento({
  notaId,
  compraId,
  evento,
  status,
  cStat,
  xMotivo,
  mensagem,
  usuarioId,
  usuarioNome,
  ip,
  computador,
  tempoRespostaMs,
  detalhes
} = {}) {
  await garantirSchemaLifecycle();
  await dbRun(`
    INSERT INTO nfe_devolucao_venda_eventos (
      nfe_devolucao_id, venda_id, evento, status, cstat, xmotivo, mensagem,
      usuario_id, usuario_nome, ip, computador, tempo_resposta_ms, detalhes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    Number(notaId),
    compraId != null ? Number(compraId) : null,
    String(evento || 'evento'),
    status || null,
    cStat || null,
    xMotivo || null,
    mensagem || null,
    usuarioId || null,
    usuarioNome || null,
    ip || null,
    computador || null,
    tempoRespostaMs != null ? Number(tempoRespostaMs) : null,
    detalhes != null ? JSON.stringify(detalhes) : null
  ]);
  appendLog('eventos.log', {
    notaId, compraId, evento, status, cStat, xMotivo, mensagem
  });
}

async function registrarAuditoria({
  notaId,
  compraId,
  usuarioId,
  usuarioNome,
  acao,
  status,
  ip,
  computador,
  tempoRespostaMs,
  detalhes
} = {}) {
  await garantirSchemaLifecycle();
  await dbRun(`
    INSERT INTO nfe_devolucao_venda_auditoria (
      nfe_devolucao_id, venda_id, usuario_id, usuario_nome, acao, status,
      ip, computador, tempo_resposta_ms, detalhes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    notaId != null ? Number(notaId) : null,
    compraId != null ? Number(compraId) : null,
    usuarioId || null,
    usuarioNome || null,
    String(acao || 'acao'),
    status || null,
    ip || null,
    computador || null,
    tempoRespostaMs != null ? Number(tempoRespostaMs) : null,
    detalhes != null ? JSON.stringify(detalhes) : null
  ]);
}

function montarXmlAutorizado(xmlAssinado, xmlRetorno, parsed) {
  const nfe = String(xmlAssinado || '').match(/<NFe[\s\S]*?<\/NFe>/i);
  const prot = String(xmlRetorno || '').match(/<protNFe[\s\S]*?<\/protNFe>/i);
  if (nfe && prot) {
    return `<?xml version="1.0" encoding="UTF-8"?>`
      + `<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">`
      + `${nfe[0]}${prot[0]}</nfeProc>`;
  }
  if (parsed?.sucesso && xmlAssinado) return xmlAssinado;
  return null;
}

function cancelarTimerConsulta(notaId) {
  const t = consultaTimers.get(Number(notaId));
  if (t) {
    clearTimeout(t);
    consultaTimers.delete(Number(notaId));
  }
}

function agendarConsultaAutomatica(notaId, tentativaIndex = 0) {
  const id = Number(notaId);
  cancelarTimerConsulta(id);
  const delay = BACKOFF_MS[Math.min(tentativaIndex, BACKOFF_MS.length - 1)];
  const proxima = new Date(Date.now() + delay).toISOString().slice(0, 19).replace('T', ' ');
  atualizarNota(id, {
    proxima_consulta_em: proxima,
    consulta_auto_tentativas: tentativaIndex,
    fila_estado: 'aguardando'
  }).catch(() => {});

  const timer = setTimeout(async () => {
    consultaTimers.delete(id);
    try {
      await executarConsultaAutomatica(id, tentativaIndex);
    } catch (err) {
      appendLog('consulta.log', { notaId: id, erro: err.message, tentativa: tentativaIndex });
      if (tentativaIndex + 1 < BACKOFF_MS.length) {
        agendarConsultaAutomatica(id, tentativaIndex + 1);
      }
    }
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  consultaTimers.set(id, timer);
}

/**
 * Após persistir a nota no emit: sincroniza estado RC4, eventos e consulta auto.
 */
async function aposPersistirEmissao(notaId, ctx = {}) {
  await garantirSchemaLifecycle();
  const started = Date.now();
  const nota = await obterNota(notaId);
  if (!nota) return null;

  const parsed = ctx.parsed || parseRetornoAutorizacaoNfe(ctx.xmlRetorno || nota.xml_retorno || '');
  const raw = ctx.xmlRetorno != null ? ctx.xmlRetorno : (nota.xml_retorno || '');
  const status = ctx.status || parsed.status || nota.status;
  const recibo = parsed.recibo || null;
  const agora = agoraLocal();

  await persistirXmlsVersionados(notaId, {
    xmlGerado: ctx.xmlGerado,
    xmlAssinado: ctx.xmlAssinado || nota.xml_enviado,
    xmlRetorno: raw,
    xmlAutorizado: status === ESTADOS.AUTORIZADA
      ? montarXmlAutorizado(ctx.xmlAssinado || nota.xml_enviado, raw, parsed)
      : null
  });

  // Timeline básica do pipeline (sem alterar emissão)
  if (ctx.xmlGerado) {
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.XML_GERADO,
      status: ESTADOS.RASCUNHO, mensagem: 'XML Gerado',
      usuarioId: ctx.usuarioId, usuarioNome: ctx.usuarioNome, ip: ctx.ip, computador: ctx.computador
    });
  }
  if (ctx.xmlAssinado) {
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.ASSINADO,
      status: ESTADOS.ASSINANDO, mensagem: 'Assinado',
      usuarioId: ctx.usuarioId, usuarioNome: ctx.usuarioNome
    });
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.VALIDADO,
      status: ESTADOS.VALIDANDO, mensagem: 'Validação concluída',
      usuarioId: ctx.usuarioId, usuarioNome: ctx.usuarioNome
    });
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.ENVIADO,
      status: ESTADOS.ENVIANDO, mensagem: 'Enviado',
      usuarioId: ctx.usuarioId, usuarioNome: ctx.usuarioNome
    });
  }

  const patch = {
    status,
    recibo: recibo || nota.recibo || null,
    protocolo: parsed.nProt || nota.protocolo || null,
    cstat_retorno: parsed.cStat || null,
    xmotivo_retorno: parsed.xMotivo || null,
    sincronizado_em: agora,
    tempo_resposta_ms: ctx.tempoRespostaMs != null ? ctx.tempoRespostaMs : (Date.now() - started),
    ultimo_ip: ctx.ip || null,
    ultimo_computador: ctx.computador || null
  };

  if (status === ESTADOS.AUTORIZADA) {
    patch.fila_estado = 'autorizado';
    patch.consultado_em = parsed.dhRecbto
      ? String(parsed.dhRecbto).replace('T', ' ').slice(0, 19)
      : agora;
    patch.rejeicao_codigo = null;
    patch.rejeicao_motivo = null;
    cancelarTimerConsulta(notaId);
    await atualizarNota(notaId, patch);
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.AUTORIZADO,
      status, cStat: parsed.cStat, xMotivo: parsed.xMotivo,
      mensagem: 'Autorizado',
      usuarioId: ctx.usuarioId, usuarioNome: ctx.usuarioNome,
      tempoRespostaMs: patch.tempo_resposta_ms
    });
    if (nota.danfe_html || ctx.danfeGerado) {
      await registrarEvento({
        notaId, compraId: nota.venda_id, evento: EVENTOS.DANFE_GERADO,
        status, mensagem: 'DANFE Gerado'
      });
    }
  } else if (status === ESTADOS.PROCESSANDO || status === 'lote_enviado') {
    const st = parsed.cStat === '103' ? ESTADOS.LOTE_ENVIADO : ESTADOS.PROCESSANDO;
    patch.status = st;
    patch.fila_estado = 'aguardando';
    await atualizarNota(notaId, patch);
    await registrarEvento({
      notaId, compraId: nota.venda_id,
      evento: EVENTOS.LOTE_RECEBIDO,
      status: st,
      cStat: parsed.cStat,
      xMotivo: parsed.xMotivo,
      mensagem: parsed.cStat === '103' ? 'Lote Recebido' : 'Lote em processamento',
      detalhes: { recibo }
    });
    appendLog('emissao.log', { notaId, status: st, recibo, cStat: parsed.cStat });
    agendarConsultaAutomatica(notaId, 0);
  } else if (status === ESTADOS.DENEGADA) {
    patch.fila_estado = 'erro';
    patch.rejeicao_codigo = parsed.cStat;
    patch.rejeicao_motivo = parsed.xMotivo;
    await atualizarNota(notaId, patch);
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.DENEGADO,
      status, cStat: parsed.cStat, xMotivo: parsed.xMotivo,
      mensagem: mensagemRejeicaoDetalhada(parsed.cStat, parsed.xMotivo)
    });
  } else if (status === ESTADOS.ERRO_ASSINATURA || status === ESTADOS.ERRO_COMUNICACAO || status === ESTADOS.ERRO_VALIDACAO) {
    patch.fila_estado = 'erro';
    await atualizarNota(notaId, patch);
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.ERRO,
      status, mensagem: ctx.message || parsed.xMotivo || status
    });
  } else {
    const { acaoDoCstat, ACOES } = require('./classificarRetornoSefaz');
    const acao = acaoDoCstat(parsed.cStat);
    patch.fila_estado = 'erro';
    patch.rejeicao_codigo = parsed.cStat;
    patch.rejeicao_motivo = parsed.xMotivo;
    if (acao === ACOES.EXIGE_NOVA_IDENTIDADE) {
      const { diagnosticarDuplicidadeNfe } = require('./nfeIdentityService');
      const consultaSefaz = typeof ctx.consultaSefaz === 'function'
        ? ctx.consultaSefaz
        : async (chave) => {
          try {
            const config = await getFiscalConfig();
            const consulta = await consultarProtocolo({
              chave,
              modelo: ModelType.NFE,
              ambiente: nota.ambiente || config.ambiente,
              cUF: config.codigoUf,
              certificadoPath: config.certificadoPath,
              certificadoSenha: config.certificadoSenha
            });
            if (!consulta || !consulta.success) {
              return { indeterminado: true, erro: (consulta && consulta.error) || 'consulta falhou' };
            }
            const p = parseRetornoAutorizacaoNfe(String(consulta.body || ''));
            return { cStat: p.cStat, nProt: p.nProt, chNFe: chave, xMotivo: p.xMotivo };
          } catch (e) {
            return { indeterminado: true, erro: String(e.message || e) };
          }
        };
      const diag = await diagnosticarDuplicidadeNfe({
        vendaId: nota.venda_id,
        nota: { ...nota, id: notaId },
        parsed,
        xmlAtual: ctx.xmlAssinado || nota.xml_enviado,
        consultaSefaz,
        documentosRelacionados: ctx.documentosRelacionados
      });
      patch.status = diag.estadoFinal || ESTADOS.CONFLITO_IDENTIDADE;
      if (diag.decisao === 'SINCRONIZAR_DOCUMENTO_AUTORIZADO') {
        patch.status = ESTADOS.AUTORIZADA;
        patch.fila_estado = 'autorizado';
        patch.rejeicao_codigo = null;
        patch.rejeicao_motivo = null;
        if (diag.consultaSefaz && diag.consultaSefaz.nProt) patch.protocolo = diag.consultaSefaz.nProt;
      }
      await atualizarNota(notaId, patch);
      await registrarEvento({
        notaId, compraId: nota.venda_id, evento: EVENTOS.REJEITADO,
        status: patch.status,
        cStat: parsed.cStat,
        xMotivo: parsed.xMotivo,
        mensagem: mensagemRejeicaoDetalhada(parsed.cStat, parsed.xMotivo),
        detalhes: { diagnostico539: diag, decisao: diag.decisao }
      });
    } else {
      patch.status = ESTADOS.REJEITADA;
      await atualizarNota(notaId, patch);
      await registrarEvento({
        notaId, compraId: nota.venda_id, evento: EVENTOS.REJEITADO,
        status: ESTADOS.REJEITADA,
        cStat: parsed.cStat,
        xMotivo: parsed.xMotivo,
        mensagem: mensagemRejeicaoDetalhada(parsed.cStat, parsed.xMotivo),
        detalhes: { xmlEnviado: Boolean(nota.xml_enviado || ctx.xmlAssinado), xmlRetorno: Boolean(raw) }
      });
    }
  }

  await registrarAuditoria({
    notaId,
    compraId: nota.venda_id,
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    acao: 'emissao',
    status: patch.status || status,
    ip: ctx.ip,
    computador: ctx.computador,
    tempoRespostaMs: patch.tempo_resposta_ms,
    detalhes: { cStat: parsed.cStat, xMotivo: parsed.xMotivo, recibo }
  });
  appendLog('emissao.log', {
    notaId,
    status: patch.status || status,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    recibo
  });

  return obterNota(notaId);
}

async function sincronizarStatusDaConsulta(notaId, body, ctx = {}) {
  const nota = await obterNota(notaId);
  if (!nota) return null;
  const parsed = parseRetornoAutorizacaoNfe(body);
  const cStat = parsed.cStat;
  const xMotivo = parsed.xMotivo;
  const protocolo = parsed.nProt || nota.protocolo;
  const agora = agoraLocal();

  let statusNovo = nota.status;
  if (cStat === '100' || cStat === '150' || parsed.status === 'autorizada') {
    statusNovo = ESTADOS.AUTORIZADA;
  } else if (cStat === '101' || cStat === '135' || cStat === '155') {
    statusNovo = ESTADOS.CANCELADA;
  } else if (cStat === '110' || cStat === '301' || cStat === '302' || parsed.status === 'denegada') {
    statusNovo = ESTADOS.DENEGADA;
  } else if ((cStat === '103' || cStat === '104' || cStat === '105') && !parsed.temInfProt) {
    statusNovo = ESTADOS.PROCESSANDO;
  } else if (parsed.status === 'rejeitada' || (cStat && parsed.temInfProt)) {
    statusNovo = ESTADOS.REJEITADA;
  } else if (cStat) {
    statusNovo = ESTADOS.REJEITADA;
  }

  const patch = {
    status: statusNovo,
    protocolo: protocolo || null,
    cstat_retorno: cStat,
    xmotivo_retorno: xMotivo,
    consultado_em: agora,
    sincronizado_em: agora,
    xml_retorno: body,
    tempo_resposta_ms: ctx.tempoRespostaMs || null
  };

  if (statusNovo === ESTADOS.AUTORIZADA) {
    patch.fila_estado = 'autorizado';
    patch.rejeicao_codigo = null;
    patch.rejeicao_motivo = null;
    const xmlAut = montarXmlAutorizado(nota.xml_assinado || nota.xml_enviado, body, parsed);
    if (xmlAut && !nota.xml_autorizado) patch.xml_autorizado = xmlAut;
    cancelarTimerConsulta(notaId);
  } else if (statusNovo === ESTADOS.PROCESSANDO) {
    patch.fila_estado = 'aguardando';
  } else if (statusNovo === ESTADOS.CANCELADA) {
    patch.fila_estado = 'cancelado';
    cancelarTimerConsulta(notaId);
  } else {
    patch.fila_estado = 'erro';
    patch.rejeicao_codigo = cStat;
    patch.rejeicao_motivo = xMotivo;
    cancelarTimerConsulta(notaId);
  }

  await atualizarNota(notaId, patch);

  const evento = statusNovo === ESTADOS.AUTORIZADA
    ? EVENTOS.AUTORIZADO
    : (statusNovo === ESTADOS.DENEGADA
      ? EVENTOS.DENEGADO
      : (statusNovo === ESTADOS.REJEITADA ? EVENTOS.REJEITADO : EVENTOS.CONSULTA));

  await registrarEvento({
    notaId,
    compraId: nota.venda_id,
    evento: ctx.automatica ? EVENTOS.CONSULTA_AUTOMATICA : evento,
    status: statusNovo,
    cStat,
    xMotivo,
    mensagem: statusNovo === ESTADOS.REJEITADA || statusNovo === ESTADOS.DENEGADA
      ? mensagemRejeicaoDetalhada(cStat, xMotivo)
      : (xMotivo || `Status sincronizado: ${statusNovo}`),
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome || (ctx.automatica ? 'sistema-auto' : null),
    tempoRespostaMs: ctx.tempoRespostaMs,
    detalhes: { automatica: Boolean(ctx.automatica) }
  });

  // RC3: persistir itens se autorização chegou via consulta (não no envio síncrono)
  if (statusNovo === ESTADOS.AUTORIZADA && ctx.itensEspelhados) {
    try {
      await persistirItensNfeDevolucaoVenda({
        nfeDevolucaoId: notaId,
        compraId: nota.venda_id,
        itens: ctx.itensEspelhados,
        usuarioId: ctx.usuarioId || null,
        usuarioNome: ctx.usuarioNome || null
      });
    } catch (_) { /* itens podem já existir */ }
  }

  appendLog('consulta.log', { notaId, status: statusNovo, cStat, xMotivo, automatica: ctx.automatica });
  return { ...nota, ...patch, status: statusNovo, cStat, xMotivo, protocolo };
}

async function consultarSituacaoDevolucao(notaId, ctx = {}) {
  await garantirSchemaLifecycle();
  const started = Date.now();
  const nota = await obterNota(notaId);
  if (!nota) {
    throw Object.assign(new Error('NF-e de devolução não encontrada.'), {
      code: 'NOTA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }
  const chave = onlyDigits(nota.chave_acesso);
  if (chave.length !== 44) {
    throw Object.assign(new Error('NF-e sem chave de acesso válida para consulta.'), {
      code: 'CHAVE_INVALIDA',
      statusCode: 400
    });
  }

  const config = await getFiscalConfig();
  await atualizarNota(notaId, { fila_estado: 'consulta' });

  const consulta = await consultarProtocolo({
    chave,
    modelo: ModelType.NFE,
    ambiente: nota.ambiente || config.ambiente,
    cUF: config.codigoUf,
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha
  });

  const tempo = Date.now() - started;
  if (!consulta.success) {
    await registrarAuditoria({
      notaId,
      compraId: nota.venda_id,
      acao: 'consulta',
      status: 'erro',
      usuarioId: ctx.usuarioId,
      usuarioNome: ctx.usuarioNome,
      ip: ctx.ip,
      computador: ctx.computador,
      tempoRespostaMs: tempo,
      detalhes: { erro: consulta.error || consulta.message }
    });
    throw Object.assign(new Error(consulta.error || 'Falha na consulta SEFAZ.'), {
      statusCode: 502,
      body: consulta
    });
  }

  const body = String(consulta.body || '');
  const sync = await sincronizarStatusDaConsulta(notaId, body, {
    ...ctx,
    tempoRespostaMs: tempo,
    automatica: Boolean(ctx.automatica)
  });

  await registrarAuditoria({
    notaId,
    compraId: nota.venda_id,
    acao: ctx.automatica ? 'consulta_automatica' : 'consulta',
    status: sync.status,
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip,
    computador: ctx.computador,
    tempoRespostaMs: tempo,
    detalhes: { cStat: sync.cStat, xMotivo: sync.xMotivo }
  });

  const ui = uiDoEstado(sync.status);
  return {
    success: true,
    notaId: Number(notaId),
    status: sync.status,
    statusUi: ui,
    cStat: sync.cStat,
    xMotivo: sync.xMotivo,
    protocolo: sync.protocolo,
    recibo: sync.recibo || nota.recibo,
    mensagem: sync.status === ESTADOS.REJEITADA || sync.status === ESTADOS.DENEGADA
      ? mensagemRejeicaoDetalhada(sync.cStat, sync.xMotivo)
      : (sync.xMotivo || ui.label),
    consultadoEm: sync.consultado_em || agoraLocal()
  };
}

async function executarConsultaAutomatica(notaId, tentativaIndex = 0) {
  const nota = await obterNota(notaId);
  if (!nota) return;
  const st = String(nota.status || '').toLowerCase();
  if (![ESTADOS.PROCESSANDO, ESTADOS.LOTE_ENVIADO, 'pendente_reenvio'].includes(st)) {
    return;
  }
  try {
    const out = await consultarSituacaoDevolucao(notaId, {
      automatica: true,
      usuarioNome: 'sistema-auto'
    });
    if ([ESTADOS.PROCESSANDO, ESTADOS.LOTE_ENVIADO].includes(out.status)
      && tentativaIndex + 1 < BACKOFF_MS.length) {
      agendarConsultaAutomatica(notaId, tentativaIndex + 1);
    }
  } catch (err) {
    if (tentativaIndex + 1 < BACKOFF_MS.length) {
      agendarConsultaAutomatica(notaId, tentativaIndex + 1);
    } else {
      await atualizarNota(notaId, {
        status: ESTADOS.ERRO_COMUNICACAO,
        fila_estado: 'erro',
        xmotivo_retorno: err.message
      });
    }
  }
}

async function cancelarNfeDevolucaoOficial(notaId, {
  motivo,
  usuarioId,
  usuarioNome,
  ip,
  computador,
  forcarPrazo = false
} = {}) {
  await garantirSchemaLifecycle();
  const started = Date.now();
  const nota = await obterNota(notaId);
  if (!nota) {
    throw Object.assign(new Error('NF-e de devolução não encontrada.'), {
      code: 'NOTA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }
  if (!podeCancelarDevolucao(nota)) {
    throw Object.assign(
      new Error('Somente NF-e autorizada pode ser cancelada.'),
      { code: 'STATUS_INVALIDO', statusCode: 400 }
    );
  }

  const validacaoJustificativa = validarMotivoTexto(motivo);
  if (!validacaoJustificativa.valido) {
    throw Object.assign(new Error(validacaoJustificativa.erro), {
      code: 'MOTIVO_INVALIDO',
      statusCode: 400
    });
  }

  if (!forcarPrazo) {
    const prazo = validarPrazoCancelamento(nota);
    if (!prazo.ok) {
      throw Object.assign(new Error(prazo.erro), {
        statusCode: 400,
        codigo: 'PRAZO_CANCELAMENTO'
      });
    }
  }

  const config = await getFiscalConfig();
  const chaveAcesso = onlyDigits(nota.chave_acesso);
  const protocolo = nota.protocolo;
  if (!chaveAcesso || chaveAcesso.length !== 44 || !protocolo) {
    throw Object.assign(new Error('NF-e autorizada sem chave ou protocolo.'), {
      statusCode: 400
    });
  }

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const dataEvento = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}-03:00`;
  const idLote = String(Date.now()).slice(-15);
  const nSeqEvento = '1';
  const justificativa = String(motivo).trim();

  const eventoXml = `
    <evento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
      <infEvento Id="ID110111${chaveAcesso}${nSeqEvento.padStart(2, '0')}">
        <cOrgao>${config.codigoUf}</cOrgao>
        <tpAmb>${config.ambiente}</tpAmb>
        <CNPJ>${String(config.cnpj || '').replace(/\D/g, '')}</CNPJ>
        <chNFe>${chaveAcesso}</chNFe>
        <dhEvento>${dataEvento}</dhEvento>
        <tpEvento>110111</tpEvento>
        <nSeqEvento>${nSeqEvento}</nSeqEvento>
        <verEvento>1.00</verEvento>
        <detEvento versao="1.00">
          <descEvento>Cancelamento</descEvento>
          <nProt>${protocolo}</nProt>
          <xJust>${justificativa}</xJust>
        </detEvento>
      </infEvento>
    </evento>`;

  const certificado = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);
  const assinatura = assinarEvento(
    compactarXml(eventoXml),
    certificado.privateKeyPem,
    certificado.certPem
  );

  const envEvento = `
    <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
      <idLote>${idLote}</idLote>
      ${assinatura.xmlAssinado}
    </envEvento>`;

  const soap = `<?xml version="1.0" encoding="utf-8"?>
    <soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                     xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                     xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
      <soap12:Header>
        <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
          <cUF>${config.codigoUf}</cUF>
          <versaoDados>1.00</versaoDados>
        </nfeCabecMsg>
      </soap12:Header>
      <soap12:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
          ${compactarXml(envEvento)}
        </nfeDadosMsg>
      </soap12:Body>
    </soap12:Envelope>`;

  const envio = await enviarCancelamento({
    envelope: soap,
    modelo: ModelType.NFE,
    ambiente: config.ambiente,
    cUF: config.codigoUf,
    chave: chaveAcesso,
    protocolo,
    xJust: justificativa,
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha,
    url: getCancelamentoUrlNfe(config.ambiente)
  });

  const tempo = Date.now() - started;
  const raw = String(envio.body || '');
  appendLog('cancelamento.log', {
    notaId, success: envio.success, chave: chaveAcesso, bytes: raw.length
  });

  if (!envio.success) {
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.ERRO,
      status: ESTADOS.ERRO_COMUNICACAO,
      mensagem: envio.error || 'Falha no cancelamento SEFAZ',
      tempoRespostaMs: tempo
    });
    throw Object.assign(new Error(envio.error || 'Falha no cancelamento SEFAZ.'), {
      statusCode: 502,
      body: envio
    });
  }

  const cStatOk = /<cStat>135<\/cStat>|<cStat>136<\/cStat>|<cStat>155<\/cStat>/.test(raw);
  const protEvento = (raw.match(/<nProt>(\d+)<\/nProt>/) || [])[1] || null;
  const cStat = (raw.match(/<cStat>(\d+)<\/cStat>/) || [])[1] || null;
  const xMotivo = (raw.match(/<xMotivo>([^<]*)<\/xMotivo>/) || [])[1] || null;

  if (cStatOk) {
    // RC3: reabre saldo automaticamente
    const local = await cancelarNfeDevolucaoVenda(notaId, {
      motivo: justificativa,
      usuarioId,
      usuarioNome
    });
    await atualizarNota(notaId, {
      protocolo_cancelamento: protEvento,
      xml_cancelamento: raw,
      cstat_retorno: cStat,
      xmotivo_retorno: xMotivo,
      sincronizado_em: agoraLocal(),
      tempo_resposta_ms: tempo,
      fila_estado: 'cancelado',
      danfe_html_cancelado: gerarDanfeCanceladoHtml(nota, protEvento, justificativa)
    });
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.CANCELADO,
      status: ESTADOS.CANCELADA, cStat, xMotivo,
      mensagem: 'Cancelada',
      usuarioId, usuarioNome, ip, computador, tempoRespostaMs: tempo,
      detalhes: { protocoloCancelamento: protEvento }
    });
    await registrarEvento({
      notaId, compraId: nota.venda_id, evento: EVENTOS.CANCELADO,
      status: ESTADOS.CANCELADA,
      mensagem: `Protocolo Cancelamento: ${protEvento || '-'}`,
      detalhes: { protocoloCancelamento: protEvento }
    });
    await registrarAuditoria({
      notaId, compraId: nota.venda_id, acao: 'cancelamento',
      status: ESTADOS.CANCELADA, usuarioId, usuarioNome, ip, computador,
      tempoRespostaMs: tempo, detalhes: { protocoloCancelamento: protEvento, cStat }
    });
    return {
      success: true,
      status: ESTADOS.CANCELADA,
      notaId: Number(notaId),
      protocoloCancelamento: protEvento,
      cStat,
      xMotivo,
      message: 'NF-e de devolução cancelada na SEFAZ. Saldo reaberto automaticamente.',
      saldos: local.saldos
    };
  }

  await atualizarNota(notaId, {
    status: ESTADOS.CANCELAMENTO_REJEITADO,
    xml_cancelamento: raw,
    cstat_retorno: cStat,
    xmotivo_retorno: xMotivo,
    sincronizado_em: agoraLocal(),
    fila_estado: 'erro',
    tempo_resposta_ms: tempo
  });
  await registrarEvento({
    notaId, compraId: nota.venda_id, evento: EVENTOS.CANCELAMENTO_REJEITADO,
    status: ESTADOS.CANCELAMENTO_REJEITADO, cStat, xMotivo,
    mensagem: mensagemRejeicaoDetalhada(cStat, xMotivo),
    usuarioId, usuarioNome, tempoRespostaMs: tempo
  });
  await registrarAuditoria({
    notaId, compraId: nota.venda_id, acao: 'cancelamento',
    status: ESTADOS.CANCELAMENTO_REJEITADO, usuarioId, usuarioNome, ip, computador,
    tempoRespostaMs: tempo, detalhes: { cStat, xMotivo }
  });

  return {
    success: false,
    status: ESTADOS.CANCELAMENTO_REJEITADO,
    notaId: Number(notaId),
    cStat,
    xMotivo,
    message: mensagemRejeicaoDetalhada(cStat, xMotivo),
    sefaz: raw
  };
}

function gerarDanfeCanceladoHtml(nota, protocoloCancelamento, motivo) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DANFE Cancelado</title>
<style>body{font-family:Arial,sans-serif;padding:24px} .banner{background:#c62828;color:#fff;padding:12px;text-align:center;font-size:22px;font-weight:bold}
.meta{margin-top:16px;line-height:1.6}</style></head><body>
<div class="banner">NF-e CANCELADA</div>
<div class="meta">
<p><strong>Número:</strong> ${nota.numero || '-'} / <strong>Série:</strong> ${nota.serie || '-'}</p>
<p><strong>Chave:</strong> ${nota.chave_acesso || '-'}</p>
<p><strong>Protocolo autorização:</strong> ${nota.protocolo || '-'}</p>
<p><strong>Protocolo cancelamento:</strong> ${protocoloCancelamento || '-'}</p>
<p><strong>Motivo:</strong> ${String(motivo || '').replace(/</g, '&lt;')}</p>
</div></body></html>`;
}

/**
 * Reenvio seguro: reenvia XML assinado já persistido (sem nova numeração).
 */
async function reenviarNfeDevolucao(notaId, ctx = {}) {
  await garantirSchemaLifecycle();
  const started = Date.now();
  const nota = await obterNota(notaId);
  if (!nota) {
    throw Object.assign(new Error('NF-e de devolução não encontrada.'), {
      code: 'NOTA_NAO_ENCONTRADA',
      statusCode: 404
    });
  }
  if (!podeReenviarDevolucao(nota)) {
    if (xmlRejeicaoFiscalDefinitiva(nota)) {
      throw Object.assign(
        new Error(mensagemReenvioXmlEstruturalmenteRejeitado(nota)),
        { code: 'REENVIO_XML_INVALIDO', statusCode: 400 }
      );
    }
    throw Object.assign(
      new Error(`Reenvio não permitido para status "${nota.status}".`),
      { code: 'REENVIO_BLOQUEADO', statusCode: 400 }
    );
  }
  const xmlAssinado = nota.xml_assinado || nota.xml_enviado;
  if (!xmlAssinado) {
    throw Object.assign(new Error('Não há XML assinado para reenvio.'), {
      code: 'XML_AUSENTE',
      statusCode: 400
    });
  }
  const { calcularHashXml } = require('./nfeXmlIdentityService');
  const hashAtual = calcularHashXml(xmlAssinado);
  const hashPersistido = nota.xml_assinado_hash || nota.xml_hash;
  if (hashPersistido && hashPersistido !== hashAtual) {
    throw Object.assign(
      new Error(
        'Conflito fiscal: esta chave de acesso já está associada a um documento com conteúdo diferente. Uma nova NF-e deve receber nova identidade fiscal.'
      ),
      { code: 'CHAVE_XML_CONFLITO', statusCode: 400 }
    );
  }

  const config = await getFiscalConfig();
  const loteXml = montarLote(xmlAssinado, String(nota.numero || Date.now()));
  await atualizarNota(notaId, { status: ESTADOS.ENVIANDO, fila_estado: 'transmitindo' });
  await registrarEvento({
    notaId, compraId: nota.venda_id, evento: EVENTOS.REENVIO,
    status: ESTADOS.ENVIANDO, mensagem: 'Reenvio iniciado',
    usuarioId: ctx.usuarioId, usuarioNome: ctx.usuarioNome, ip: ctx.ip, computador: ctx.computador
  });

  let soapResponse;
  try {
    soapResponse = await enviarLote({
      url: getUrlNFe55(config),
      loteXml,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha,
      cUF: config.codigoUf,
      versaoDados: '4.00'
    });
  } catch (commErr) {
    await atualizarNota(notaId, {
      status: ESTADOS.ERRO_COMUNICACAO,
      fila_estado: 'erro',
      xmotivo_retorno: String(commErr.message || commErr)
    });
    throw Object.assign(new Error('Erro de comunicação no reenvio.'), {
      statusCode: 502,
      code: 'ERRO_COMUNICACAO',
      detalhe: String(commErr.message || commErr)
    });
  }

  const raw = String(soapResponse.raw || soapResponse.message || '');
  const parsed = parseRetornoAutorizacaoNfe(raw);
  const tempo = Date.now() - started;

  await aposPersistirEmissao(notaId, {
    parsed,
    xmlRetorno: raw,
    xmlAssinado,
    status: parsed.status,
    tempoRespostaMs: tempo,
    usuarioId: ctx.usuarioId,
    usuarioNome: ctx.usuarioNome,
    ip: ctx.ip,
    computador: ctx.computador,
    message: parsed.xMotivo
  });

  const atualizada = await obterNota(notaId);
  return {
    success: atualizada.status === ESTADOS.AUTORIZADA,
    notaId: Number(notaId),
    status: atualizada.status,
    cStat: parsed.cStat,
    xMotivo: parsed.xMotivo,
    protocolo: atualizada.protocolo,
    recibo: atualizada.recibo,
    message: atualizada.status === ESTADOS.AUTORIZADA
      ? 'NF-e de devolução autorizada no reenvio.'
      : (mensagemRejeicaoDetalhada(parsed.cStat, parsed.xMotivo) || parsed.xMotivo),
    tempoRespostaMs: tempo
  };
}

async function listarEventosDevolucao(notaId) {
  await garantirSchemaLifecycle();
  const rows = await dbAll(`
    SELECT * FROM nfe_devolucao_venda_eventos
    WHERE nfe_devolucao_id = ?
    ORDER BY id ASC
  `, [Number(notaId)]);
  return rows.map((r) => ({
    id: r.id,
    evento: r.evento,
    status: r.status,
    cStat: r.cstat,
    xMotivo: r.xmotivo,
    mensagem: r.mensagem,
    usuarioNome: r.usuario_nome,
    createdAt: r.created_at,
    hora: String(r.created_at || '').slice(11, 16) || null,
    detalhes: r.detalhes_json ? (() => { try { return JSON.parse(r.detalhes_json); } catch { return null; } })() : null
  }));
}

async function obterPainelStatus(notaId) {
  await garantirSchemaLifecycle();
  const nota = await obterNota(notaId);
  if (!nota) return null;
  const ui = uiDoEstado(nota.status);
  const eventos = await listarEventosDevolucao(notaId);
  return {
    status: nota.status,
    statusUi: ui,
    numero: nota.numero,
    serie: nota.serie,
    chave: nota.chave_acesso,
    recibo: nota.recibo,
    protocolo: nota.protocolo,
    protocoloCancelamento: nota.protocolo_cancelamento,
    ultimaConsulta: nota.consultado_em || nota.sincronizado_em,
    cStat: nota.cstat_retorno,
    xMotivo: nota.xmotivo_retorno,
    rejeicao: nota.rejeicao_codigo
      ? mensagemRejeicaoDetalhada(nota.rejeicao_codigo, nota.rejeicao_motivo)
      : null,
    xmls: {
      gerado: Boolean(nota.xml_gerado),
      assinado: Boolean(nota.xml_assinado || nota.xml_enviado),
      autorizado: Boolean(nota.xml_autorizado),
      cancelamento: Boolean(nota.xml_cancelamento)
    },
    danfe: {
      original: Boolean(nota.danfe_html),
      cancelado: Boolean(nota.danfe_html_cancelado)
    },
    acoes: {
      consultar: Boolean(nota.chave_acesso),
      reenviar: podeReenviarDevolucao(nota),
      cancelar: podeCancelarDevolucao(nota)
    },
    timeline: eventos
  };
}

async function obterXmlVersionado(notaId, tipo = 'assinado') {
  const nota = await obterNota(notaId);
  if (!nota) return null;
  const t = String(tipo || 'assinado').toLowerCase();
  if (t === 'gerado') return nota.xml_gerado || null;
  if (t === 'autorizado') return nota.xml_autorizado || null;
  if (t === 'cancelamento') return nota.xml_cancelamento || null;
  if (t === 'retorno') return nota.xml_retorno || null;
  return nota.xml_assinado || nota.xml_enviado || null;
}

module.exports = {
  garantirSchemaLifecycle,
  aposPersistirEmissao,
  consultarSituacaoDevolucao,
  cancelarNfeDevolucaoOficial,
  reenviarNfeDevolucao,
  listarEventosDevolucao,
  obterPainelStatus,
  obterXmlVersionado,
  obterNota,
  mensagemRejeicaoDetalhada,
  agendarConsultaAutomatica,
  sincronizarStatusDaConsulta,
  podeReenviarDevolucao,
  podeCancelarDevolucao,
  ESTADOS,
  EVENTOS,
  uiDoEstado
};

