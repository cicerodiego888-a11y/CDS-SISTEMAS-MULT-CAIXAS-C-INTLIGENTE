/**
 * Substituição operacional de devolução por manifestação 210240
 * (Operação não Realizada). Não cancela nem altera a NF-e anterior.
 */

'use strict';

const dbPadrao = require('../../database');
const { gravarAuditoria } = require('../auditoria');
const { sanitizarInfCplNfe } = require('./sanitizarInfCplNfe');

let dbOverride = null;
function setDbForTests(dbInst) {
  dbOverride = dbInst || null;
}
function db() {
  return dbOverride || dbPadrao;
}

const TP_EVENTO_210240 = '210240';
const DESC_EVENTO_210240 = 'Operação não Realizada';
const TIPO_RELACAO = 'MANIFESTACAO_210240';
const ORIGEM_XML = 'XML_SEFAZ';
const ORIGEM_MANUAL = 'INFORMADO_USUARIO';

function dbRun(sql, params = []) {
  const conn = db();
  return new Promise((resolve, reject) => {
    conn.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  const conn = db();
  return new Promise((resolve, reject) => {
    conn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(sql, params = []) {
  const conn = db();
  return new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function tag(xml, name) {
  const m = String(xml || '').match(new RegExp(`<${name}[^>]*>\\s*([^<]*)\\s*</${name}>`, 'i'));
  return m ? String(m[1]).trim() : null;
}

function erro(message, code, statusCode = 400, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode, ...extra });
}

function padSerie(serie) {
  const n = String(serie == null ? '1' : serie).replace(/\D/g, '') || '1';
  return n.padStart(3, '0');
}

function montarObservacaoSubstituicao({ numero, serie, chaveAnterior, chaveCompra } = {}) {
  const chaveAnt = onlyDigits(chaveAnterior || '');
  const chaveOrigem = onlyDigits(chaveCompra || '');
  const bloco100 = (
    `Nova NF-e de devolucao emitida em substituicao operacional a NF-e no ${numero}, serie ${padSerie(serie)}`
    + (chaveAnt.length === 44 ? `, chave de acesso ${chaveAnt}` : '')
    + ', em razao de manifestacao do destinatario - evento 210240 (Operacao nao Realizada), '
    + 'relacionada a divergencia nos valores informados na NF-e anterior.'
  );
  const texto = chaveOrigem.length === 44
    ? `${bloco100} Devolucao referente a NF-e ${chaveOrigem}.`
    : bloco100;
  return sanitizarInfCplNfe(texto);
}

function trace210240(etapa, dados = {}) {
  const seguro = {
    etapa,
    compraId: dados.compraId != null ? Number(dados.compraId) : null,
    rascunhoId: dados.rascunhoId || null,
    notaId: dados.notaId || null,
    origemNfeDevolucaoId: dados.origemNfeDevolucaoId || null,
    documento_original_id: dados.documento_original_id || null,
    substituicaoId: dados.substituicaoId || null,
    chaveNFAnterior: dados.chaveNFAnterior || dados.chaveAnterior || null,
    evento210240: dados.evento210240 != null ? dados.evento210240 : null,
    origemResolvida: dados.origemResolvida || null,
    saldoNormal: dados.saldoNormal,
    restanteExcecao: dados.restanteExcecao,
    saldoDisponivel: dados.saldoDisponivel,
    quantidadeSolicitada: dados.quantidadeSolicitada,
    produto: dados.produto || null,
    resultado: dados.resultado || null
  };
  // eslint-disable-next-line no-console
  console.info('[DEVOLUCAO][TRACE_210240]', JSON.stringify(seguro));
}

function parsearXmlEventoManifestacao(xmlEvento) {
  const raw = String(xmlEvento || '').trim();
  if (!raw) return null;
  const tpEvento = onlyDigits(tag(raw, 'tpEvento') || '').slice(0, 6);
  const descEvento = tag(raw, 'descEvento') || DESC_EVENTO_210240;
  const chave = onlyDigits(tag(raw, 'chNFe'));
  const cnpj = onlyDigits(tag(raw, 'CNPJ') || tag(raw, 'CPF'));
  const nSeqEvento = Number(tag(raw, 'nSeqEvento') || 0) || null;
  const dhEvento = tag(raw, 'dhEvento');
  const nProt = tag(raw, 'nProt');
  const cStat = tag(raw, 'cStat');
  const xMotivo = tag(raw, 'xMotivo');
  const xJust = tag(raw, 'xJust');
  return {
    tpEvento,
    descEvento,
    chaveNfe: chave || null,
    cnpjManifestante: cnpj || null,
    nSeqEvento,
    dhEvento,
    nProt,
    cStat,
    xMotivo,
    xJust,
    xmlEvento: raw
  };
}

async function garantirTabelasSubstituicaoDevolucao() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_manifestacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nfe_devolucao_id INTEGER NOT NULL,
      chave_nfe TEXT,
      tp_evento TEXT NOT NULL,
      desc_evento TEXT,
      cnpj_manifestante TEXT,
      n_seq_evento INTEGER,
      dh_evento TEXT,
      n_prot TEXT,
      c_stat TEXT,
      x_motivo TEXT,
      x_just TEXT,
      xml_evento TEXT,
      origem_registro TEXT NOT NULL,
      validado_sistema INTEGER NOT NULL DEFAULT 0,
      usuario_id INTEGER,
      usuario_nome TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbRun(`
    CREATE INDEX IF NOT EXISTS idx_nfe_dev_manif_nota
    ON nfe_devolucao_manifestacoes(nfe_devolucao_id, tp_evento)
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucoes_substituicoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      devolucao_anterior_id INTEGER NOT NULL,
      nova_devolucao_id INTEGER,
      rascunho_id INTEGER,
      compra_id INTEGER,
      chave_nfe_anterior TEXT,
      tipo_relacao TEXT NOT NULL,
      tp_evento TEXT NOT NULL,
      desc_evento TEXT,
      protocolo_evento TEXT,
      data_evento TEXT,
      justificativa_evento TEXT,
      observacao TEXT,
      manifestacao_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbRun(`
    CREATE INDEX IF NOT EXISTS idx_nfe_dev_subst_ant
    ON nfe_devolucoes_substituicoes(devolucao_anterior_id)
  `);
  for (const sql of [
    `ALTER TABLE nfe_devolucoes_substituicoes ADD COLUMN usuario_id INTEGER`,
    `ALTER TABLE nfe_devolucoes_substituicoes ADD COLUMN usuario_nome TEXT`,
    `ALTER TABLE nfe_devolucoes_substituicoes ADD COLUMN efetivada INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE nfe_devolucoes_substituicoes ADD COLUMN efetivada_em DATETIME`
  ]) {
    try { await dbRun(sql); } catch (_) { /* coluna já existe */ }
  }
  await dbRun(`
    CREATE TABLE IF NOT EXISTS nfe_devolucao_substituicao_auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      substituicao_id INTEGER,
      devolucao_anterior_id INTEGER,
      nova_devolucao_id INTEGER,
      manifestacao_id INTEGER,
      usuario_id INTEGER,
      usuario_nome TEXT,
      saldo_normal TEXT,
      saldo_excecao TEXT,
      quantidade_liberada_por_substituicao TEXT,
      itens_json TEXT,
      motivo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function eh210240(tp) {
  return onlyDigits(tp) === TP_EVENTO_210240;
}

async function obterManifestacao210240(nfeDevolucaoId) {
  await garantirTabelasSubstituicaoDevolucao();
  return dbGet(`
    SELECT * FROM nfe_devolucao_manifestacoes
    WHERE nfe_devolucao_id = ? AND tp_evento = ?
    ORDER BY id DESC LIMIT 1
  `, [Number(nfeDevolucaoId), TP_EVENTO_210240]);
}

async function obterEvidencia210240(nfeDevolucaoId, rascunho) {
  const tabela = await obterManifestacao210240(nfeDevolucaoId);
  if (tabela) return { ok: true, fonte: 'tabela_manifestacoes', manifestacao: tabela };

  if (rascunho && /210240/.test(String(rascunho.observacoes || ''))) {
    return {
      ok: true,
      fonte: 'rascunho.observacoes',
      manifestacao: {
        nfe_devolucao_id: Number(nfeDevolucaoId),
        tp_evento: TP_EVENTO_210240,
        desc_evento: DESC_EVENTO_210240,
        origem_registro: ORIGEM_MANUAL,
        validado_sistema: 0
      }
    };
  }

  const aud = await dbGet(`
    SELECT id, acao, detalhes FROM auditoria
    WHERE referencia_id = ?
      AND (
        acao LIKE '%210240%'
        OR IFNULL(detalhes, '') LIKE '%210240%'
      )
    ORDER BY id DESC LIMIT 1
  `, [Number(nfeDevolucaoId)]).catch(() => null);
  if (aud) {
    return {
      ok: true,
      fonte: 'auditoria',
      manifestacao: {
        id: aud.id,
        nfe_devolucao_id: Number(nfeDevolucaoId),
        tp_evento: TP_EVENTO_210240,
        desc_evento: DESC_EVENTO_210240,
        origem_registro: ORIGEM_MANUAL,
        validado_sistema: 0
      }
    };
  }
  return { ok: false, fonte: null, manifestacao: null };
}

async function obterUltimaManifestacao(nfeDevolucaoId) {
  await garantirTabelasSubstituicaoDevolucao();
  return dbGet(`
    SELECT * FROM nfe_devolucao_manifestacoes
    WHERE nfe_devolucao_id = ?
    ORDER BY id DESC LIMIT 1
  `, [Number(nfeDevolucaoId)]);
}

async function obterSubstituicaoPorAnterior(devolucaoAnteriorId) {
  await garantirTabelasSubstituicaoDevolucao();
  return dbGet(`
    SELECT * FROM nfe_devolucoes_substituicoes
    WHERE devolucao_anterior_id = ?
    ORDER BY id DESC LIMIT 1
  `, [Number(devolucaoAnteriorId)]);
}

async function listarIdsDevolucoesSubstituidasComNova(compraId) {
  try {
    const rows = await dbAll(`
      SELECT s.devolucao_anterior_id
      FROM nfe_devolucoes_substituicoes s
      INNER JOIN nfe_devolucoes_compra n ON n.id = s.nova_devolucao_id
      WHERE s.compra_id = ?
        AND s.tipo_relacao = ?
        AND (
          IFNULL(s.efetivada, 0) = 1
          OR LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
        )
    `, [Number(compraId), TIPO_RELACAO]);
    return rows.map((r) => Number(r.devolucao_anterior_id)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function round3(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

async function somarConsumoAutorizadoPorItem(devolucaoAnteriorId) {
  const rows = await dbAll(`
    SELECT i.compra_item_id, i.produto_id, COALESCE(SUM(i.quantidade), 0) AS qtd
    FROM nfe_devolucoes_substituicoes s
    INNER JOIN nfe_devolucoes_compra n ON n.id = s.nova_devolucao_id
    INNER JOIN nfe_devolucao_compra_itens i ON i.nfe_devolucao_id = n.id
    WHERE s.devolucao_anterior_id = ?
      AND s.tipo_relacao = ?
      AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
    GROUP BY i.compra_item_id, i.produto_id
  `, [Number(devolucaoAnteriorId), TIPO_RELACAO]).catch(() => []);
  const mapa = {};
  const porProduto = {};
  for (const r of rows || []) {
    const itemId = Number(r.compra_item_id);
    const prodId = Number(r.produto_id || 0);
    if (itemId > 0) mapa[itemId] = round3((mapa[itemId] || 0) + Number(r.qtd || 0));
    if (prodId > 0) porProduto[prodId] = round3((porProduto[prodId] || 0) + Number(r.qtd || 0));
  }
  mapa._porProduto = porProduto;
  return mapa;
}

function mensagemQuantidadeJaUtilizada(numeroAnterior) {
  return `A quantidade já foi utilizada em uma nova NF-e de devolução relacionada à NF-e ${numeroAnterior}.`;
}

async function registrarManifestacaoDevolucao(notaId, dados = {}, opcoes = {}) {
  await garantirTabelasSubstituicaoDevolucao();
  const nota = await dbGet(`SELECT * FROM nfe_devolucoes_compra WHERE id = ?`, [Number(notaId)]);
  if (!nota) throw erro('NF-e de devolução não encontrada.', 'DOCUMENTO_INVALIDO', 404);

  const snapshot = {
    id: nota.id,
    status: nota.status,
    chave_acesso: nota.chave_acesso,
    protocolo: nota.protocolo
  };

  let extraido = null;
  let origemRegistro = ORIGEM_MANUAL;
  let validadoSistema = 0;

  if (dados.xmlEvento) {
    extraido = parsearXmlEventoManifestacao(dados.xmlEvento);
    if (!extraido || !eh210240(extraido.tpEvento)) {
      throw erro('XML do evento não contém tpEvento 210240.', 'EVENTO_INVALIDO');
    }
    const chaveNota = onlyDigits(nota.chave_acesso);
    if (extraido.chaveNfe && chaveNota && extraido.chaveNfe !== chaveNota) {
      throw erro('A chave do evento não corresponde à NF-e informada.', 'CHAVE_DIVERGENTE');
    }
    origemRegistro = ORIGEM_XML;
    validadoSistema = 1;
  } else if (dados.informadoUsuario === true || dados.manual === true) {
    extraido = {
      tpEvento: TP_EVENTO_210240,
      descEvento: dados.descEvento || DESC_EVENTO_210240,
      chaveNfe: onlyDigits(dados.chaveNfe || nota.chave_acesso),
      cnpjManifestante: onlyDigits(dados.cnpjManifestante || dados.cnpj || ''),
      nSeqEvento: Number(dados.nSeqEvento || 1) || 1,
      dhEvento: dados.dhEvento || new Date().toISOString(),
      nProt: dados.nProt || dados.protocoloEvento || null,
      cStat: dados.cStat || null,
      xMotivo: dados.xMotivo || null,
      xJust: dados.xJust || dados.justificativa || null,
      xmlEvento: null
    };
    origemRegistro = ORIGEM_MANUAL;
    validadoSistema = 0;
  } else {
    throw erro(
      'Informe o XML do evento 210240 ou registre manualmente com informadoUsuario=true (não validado pela SEFAZ no sistema).',
      'MANIFESTACAO_INCOMPLETA'
    );
  }

  const insert = await dbRun(`
    INSERT INTO nfe_devolucao_manifestacoes (
      nfe_devolucao_id, chave_nfe, tp_evento, desc_evento, cnpj_manifestante,
      n_seq_evento, dh_evento, n_prot, c_stat, x_motivo, x_just, xml_evento,
      origem_registro, validado_sistema, usuario_id, usuario_nome
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    nota.id,
    extraido.chaveNfe || nota.chave_acesso,
    extraido.tpEvento,
    extraido.descEvento,
    extraido.cnpjManifestante,
    extraido.nSeqEvento,
    extraido.dhEvento,
    extraido.nProt,
    extraido.cStat,
    extraido.xMotivo,
    extraido.xJust,
    extraido.xmlEvento,
    origemRegistro,
    validadoSistema,
    opcoes.usuarioId || null,
    opcoes.usuarioNome || null
  ]);

  const notaDepois = await dbGet(`SELECT status, chave_acesso, protocolo FROM nfe_devolucoes_compra WHERE id = ?`, [nota.id]);
  if (
    String(notaDepois.status) !== String(snapshot.status)
    || String(notaDepois.chave_acesso || '') !== String(snapshot.chave_acesso || '')
    || String(notaDepois.protocolo || '') !== String(snapshot.protocolo || '')
  ) {
    throw erro('A NF-e anterior foi alterada indevidamente. Operação abortada.', 'INTEGRIDADE_ORIGEM', 500);
  }

  await gravarAuditoria({
    usuario_id: opcoes.usuarioId || null,
    usuario_nome: opcoes.usuarioNome || null,
    modulo: 'nfe_devolucao_compra',
    acao: 'REGISTRO_MANIFESTACAO_210240',
    referencia_tipo: 'nfe_devolucao_compra',
    referencia_id: nota.id,
    detalhes: {
      tp_evento: extraido.tpEvento,
      origem_registro: origemRegistro,
      validado_sistema: validadoSistema,
      n_prot: extraido.nProt,
      status_nfe_inalterado: snapshot.status
    },
    ip_requisicao: opcoes.ip || null
  }).catch(() => {});

  return {
    success: true,
    manifestacaoId: insert.lastID,
    origemRegistro,
    validadoSistema: Boolean(validadoSistema),
    avisoManual: origemRegistro === ORIGEM_MANUAL
      ? 'Registro informado pelo usuário — não é evento SEFAZ validado pelo sistema.'
      : null,
    nota: {
      id: nota.id,
      status: snapshot.status,
      chave: snapshot.chave_acesso,
      protocolo: snapshot.protocolo
    },
    evento: extraido
  };
}

async function criarRelacaoSubstituicao({
  notaAnterior,
  rascunhoId,
  manifestacao,
  observacao,
  usuarioId,
  usuarioNome,
  forcar = false
}) {
  await garantirTabelasSubstituicaoDevolucao();
  const existenteMesmoRascunho = await dbGet(`
    SELECT * FROM nfe_devolucoes_substituicoes
    WHERE devolucao_anterior_id = ? AND rascunho_id = ?
    ORDER BY id DESC LIMIT 1
  `, [Number(notaAnterior.id), Number(rascunhoId) || 0]);
  if (existenteMesmoRascunho && !existenteMesmoRascunho.efetivada) {
    return existenteMesmoRascunho;
  }

  const pendentes = await dbAll(`
    SELECT s.*, n.status AS nova_status
    FROM nfe_devolucoes_substituicoes s
    LEFT JOIN nfe_devolucoes_compra n ON n.id = s.nova_devolucao_id
    WHERE s.devolucao_anterior_id = ?
      AND IFNULL(s.efetivada, 0) = 0
      AND (
        s.nova_devolucao_id IS NULL
        OR LOWER(TRIM(COALESCE(n.status, ''))) NOT IN ('rejeitada', 'cancelada', 'erro_assinatura')
      )
  `, [Number(notaAnterior.id)]);
  if (pendentes.length && !forcar) {
    throw erro(
      'Já existe uma substituição operacional pendente para esta NF-e. Conclua ou descarte a anterior antes de criar outra.',
      'SUBSTITUICAO_ATIVA',
      409
    );
  }

  const insert = await dbRun(`
    INSERT INTO nfe_devolucoes_substituicoes (
      devolucao_anterior_id, nova_devolucao_id, rascunho_id, compra_id,
      chave_nfe_anterior, tipo_relacao, tp_evento, desc_evento,
      protocolo_evento, data_evento, justificativa_evento, observacao, manifestacao_id,
      usuario_id, usuario_nome, efetivada
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `, [
    notaAnterior.id,
    rascunhoId || null,
    notaAnterior.compra_id,
    notaAnterior.chave_acesso,
    TIPO_RELACAO,
    TP_EVENTO_210240,
    DESC_EVENTO_210240,
    manifestacao.n_prot || manifestacao.nProt || null,
    manifestacao.dh_evento || manifestacao.dhEvento || null,
    manifestacao.x_just || manifestacao.xJust || null,
    observacao || null,
    manifestacao.id || null,
    usuarioId || null,
    usuarioNome || null
  ]);
  return dbGet(`SELECT * FROM nfe_devolucoes_substituicoes WHERE id = ?`, [insert.lastID]);
}

async function efetivarSubstituicaoAposAutorizacao({
  devolucaoAnteriorId,
  novaDevolucaoId,
  rascunhoId
}) {
  await garantirTabelasSubstituicaoDevolucao();
  const nova = await dbGet(`SELECT id, status FROM nfe_devolucoes_compra WHERE id = ?`, [Number(novaDevolucaoId)]);
  if (!nova || String(nova.status || '').toLowerCase() !== 'autorizada') {
    return { efetivada: false, motivo: 'nova_nf_nao_autorizada' };
  }
  const row = (rascunhoId
    ? await dbGet(
      `SELECT * FROM nfe_devolucoes_substituicoes WHERE rascunho_id = ? AND devolucao_anterior_id = ? ORDER BY id DESC LIMIT 1`,
      [Number(rascunhoId), Number(devolucaoAnteriorId)]
    )
    : null) || await obterSubstituicaoPorAnterior(devolucaoAnteriorId);
  if (!row) return { efetivada: false, motivo: 'relacao_ausente' };
  await dbRun(`
    UPDATE nfe_devolucoes_substituicoes
    SET nova_devolucao_id = ?, efetivada = 1, efetivada_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [Number(novaDevolucaoId), row.id]);
  return { efetivada: true, substituicao: await dbGet(`SELECT * FROM nfe_devolucoes_substituicoes WHERE id = ?`, [row.id]) };
}

async function resolverContextoSubstituicao210240({
  compraId,
  origemDevolucaoId,
  rascunho,
  chaveAnterior
} = {}) {
  await garantirTabelasSubstituicaoDevolucao();
  const rascunhoId = rascunho && rascunho.id ? Number(rascunho.id) : null;
  const candidatos = [];
  const marcar = (id, fonte) => {
    const n = Number(id || 0);
    if (n > 0) candidatos.push({ id: n, fonte });
  };

  marcar(rascunho && rascunho.origem_nfe_devolucao_id, 'rascunho.origem_nfe_devolucao_id');
  marcar(origemDevolucaoId, 'origemNfeDevolucaoId');
  marcar(rascunho && rascunho.documento_original_id, 'rascunho.documento_original_id');

  if (rascunhoId) {
    const porRascunho = await dbGet(`
      SELECT id, devolucao_anterior_id FROM nfe_devolucoes_substituicoes
      WHERE rascunho_id = ? ORDER BY id DESC LIMIT 1
    `, [rascunhoId]).catch(() => null);
    if (porRascunho && porRascunho.devolucao_anterior_id) {
      marcar(porRascunho.devolucao_anterior_id, 'substituicao.rascunho_id');
    }
  }

  if (compraId) {
    const porCompra = await dbGet(`
      SELECT id, devolucao_anterior_id FROM nfe_devolucoes_substituicoes
      WHERE compra_id = ? AND IFNULL(efetivada, 0) = 0
      ORDER BY id DESC LIMIT 1
    `, [Number(compraId)]).catch(() => null);
    if (porCompra && porCompra.devolucao_anterior_id) {
      marcar(porCompra.devolucao_anterior_id, 'substituicao.pendente_compra');
    }

    const porManif = await dbGet(`
      SELECT n.id AS devolucao_anterior_id
      FROM nfe_devolucoes_compra n
      LEFT JOIN nfe_devolucao_manifestacoes m
        ON m.nfe_devolucao_id = n.id AND REPLACE(TRIM(m.tp_evento), ' ', '') = ?
      WHERE n.compra_id = ?
        AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
        AND (
          m.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM auditoria a
            WHERE a.referencia_id = n.id
              AND (a.acao LIKE '%210240%' OR IFNULL(a.detalhes, '') LIKE '%210240%')
          )
        )
      ORDER BY n.id DESC LIMIT 1
    `, [TP_EVENTO_210240, Number(compraId)]).catch(() => null);
    if (porManif && porManif.devolucao_anterior_id) {
      marcar(porManif.devolucao_anterior_id, 'manifestacao_210240_compra');
    }
  }

  const chave = onlyDigits(chaveAnterior || '');
  if (chave.length === 44) {
    const porChave = await dbGet(`
      SELECT n.id AS devolucao_anterior_id
      FROM nfe_devolucoes_compra n
      INNER JOIN nfe_devolucao_manifestacoes m
        ON m.nfe_devolucao_id = n.id AND REPLACE(TRIM(m.tp_evento), ' ', '') = ?
      WHERE n.chave_acesso = ?
        AND LOWER(TRIM(COALESCE(n.status, ''))) = 'autorizada'
      ORDER BY n.id DESC LIMIT 1
    `, [TP_EVENTO_210240, chave]).catch(() => null);
    if (porChave && porChave.devolucao_anterior_id) {
      marcar(porChave.devolucao_anterior_id, 'manifestacao_210240_chave');
    }
  }

  const visto = new Set();
  for (const cand of candidatos) {
    if (!cand.id || visto.has(cand.id)) continue;
    visto.add(cand.id);
    const evidencia = await obterEvidencia210240(cand.id, rascunho);
    if (!evidencia.ok) continue;
    const manif = evidencia.manifestacao;
    const nota = await dbGet(`SELECT * FROM nfe_devolucoes_compra WHERE id = ?`, [cand.id]);
    if (!nota || String(nota.status || '').toLowerCase() !== 'autorizada') continue;
    const subst = await obterSubstituicaoPorAnterior(cand.id);
    const ctx = {
      ativo: true,
      origemDevolucaoId: cand.id,
      notaAnteriorId: cand.id,
      chaveAnterior: nota.chave_acesso || null,
      numeroAnterior: nota.numero,
      serieAnterior: padSerie(nota.serie),
      evento: TP_EVENTO_210240,
      substituicaoId: subst && subst.id,
      rascunhoId,
      compraId: Number(nota.compra_id || compraId || 0) || null,
      fonte: cand.fonte,
      manifestacao: manif
    };
    trace210240('contexto_resolvido', {
      compraId: ctx.compraId,
      rascunhoId,
      notaId: ctx.notaAnteriorId,
      origemNfeDevolucaoId: ctx.origemDevolucaoId,
      documento_original_id: rascunho && rascunho.documento_original_id,
      substituicaoId: ctx.substituicaoId,
      chaveNFAnterior: ctx.chaveAnterior,
      evento210240: true,
      origemResolvida: cand.fonte
    });
    return ctx;
  }

  const vazio = {
    ativo: false,
    origemDevolucaoId: (candidatos[0] && candidatos[0].id) || null,
    notaAnteriorId: null,
    chaveAnterior: null,
    numeroAnterior: null,
    serieAnterior: null,
    evento: null,
    substituicaoId: null,
    rascunhoId,
    compraId: compraId || null,
    fonte: null,
    manifestacao: null
  };
  trace210240('contexto_nao_resolvido', {
    compraId,
    rascunhoId,
    origemNfeDevolucaoId: origemDevolucaoId || null,
    documento_original_id: rascunho && rascunho.documento_original_id,
    evento210240: false,
    origemResolvida: null
  });
  return vazio;
}

async function resolverOrigemSubstituicao210240(opts) {
  const ctx = await resolverContextoSubstituicao210240(opts);
  return {
    origemDevolucaoId: ctx.origemDevolucaoId,
    fonte: ctx.fonte,
    manifestacao: ctx.manifestacao,
    contexto: ctx
  };
}

async function resolverExcecaoSaldoManifestacao210240({ origemDevolucaoId, compraId, rascunho, chaveAnterior } = {}) {
  const contexto = await resolverContextoSubstituicao210240({
    compraId,
    origemDevolucaoId,
    rascunho,
    chaveAnterior
  });
  if (!contexto.ativo) {
    const tentativa = Number(origemDevolucaoId || contexto.origemDevolucaoId || 0);
    if (tentativa) {
      const outra = await obterUltimaManifestacao(tentativa);
      if (outra && !eh210240(outra.tp_evento)) {
        return { aplicar: false, motivo: 'manifestacao_diferente', tpEvento: outra.tp_evento, contexto };
      }
      if (!outra) return { aplicar: false, motivo: 'sem_manifestacao_210240', contexto };
    }
    return { aplicar: false, motivo: contexto.fonte ? 'contexto_incompleto' : 'sem_origem', contexto };
  }
  const origemId = Number(contexto.origemDevolucaoId || 0);
  if (!origemId) return { aplicar: false, motivo: 'sem_origem', contexto };

  const nota = await dbGet(`SELECT * FROM nfe_devolucoes_compra WHERE id = ?`, [origemId]);
  if (!nota) return { aplicar: false, motivo: 'nota_nao_encontrada' };

  const st = String(nota.status || '').toLowerCase();
  if (st === 'cancelada') {
    return { aplicar: false, fluxo: 'cancelamento', motivo: 'nf_cancelada_usar_fluxo_normal' };
  }
  if (st !== 'autorizada') {
    return { aplicar: false, motivo: 'nf_anterior_nao_autorizada' };
  }

  const manif = contexto.manifestacao && eh210240(contexto.manifestacao.tp_evento)
    ? contexto.manifestacao
    : await obterManifestacao210240(origemId);
  if (!manif || !eh210240(manif.tp_evento)) {
    const outra = await obterUltimaManifestacao(origemId);
    if (outra && !eh210240(outra.tp_evento)) {
      return { aplicar: false, motivo: 'manifestacao_diferente', tpEvento: outra.tp_evento };
    }
    return { aplicar: false, motivo: 'sem_manifestacao_210240' };
  }

  const itens = await dbAll(`
    SELECT i.compra_item_id, i.quantidade, i.produto_id, p.nome AS produto_nome, p.codigo AS produto_codigo
    FROM nfe_devolucao_compra_itens i
    LEFT JOIN produtos p ON p.id = i.produto_id
    WHERE i.nfe_devolucao_id = ?
  `, [origemId]);

  const liberacaoPorItem = {};
  const liberacaoPorProduto = {};
  const liberacaoPorNome = {};
  for (const it of itens) {
    const key = Number(it.compra_item_id);
    const prod = Number(it.produto_id || 0);
    const nome = String(it.produto_nome || it.produto_codigo || '').trim().toUpperCase();
    if (key > 0) {
      liberacaoPorItem[key] = round3((liberacaoPorItem[key] || 0) + Number(it.quantidade || 0));
    }
    if (prod > 0) {
      liberacaoPorProduto[prod] = round3((liberacaoPorProduto[prod] || 0) + Number(it.quantidade || 0));
    }
    if (nome) {
      liberacaoPorNome[nome] = round3((liberacaoPorNome[nome] || 0) + Number(it.quantidade || 0));
    }
  }
  const consumo = await somarConsumoAutorizadoPorItem(origemId);
  const consumidoPorItem = { ...consumo };
  delete consumidoPorItem._porProduto;
  const consumidoPorProduto = consumo._porProduto || {};
  const restantePorItem = {};
  const restantePorProduto = {};
  let quantidadeRestante = 0;
  let quantidadeConsumida = 0;
  for (const [itemId, lib] of Object.entries(liberacaoPorItem)) {
    const cons = round3(consumidoPorItem[itemId] || 0);
    const rest = round3(Math.max(0, lib - cons));
    restantePorItem[itemId] = rest;
    quantidadeRestante = round3(quantidadeRestante + rest);
    quantidadeConsumida = round3(quantidadeConsumida + cons);
  }
  for (const [pid, lib] of Object.entries(liberacaoPorProduto)) {
    restantePorProduto[pid] = round3(Math.max(0, Number(lib) - Number(consumidoPorProduto[pid] || 0)));
  }

  return {
    aplicar: true,
    fluxo: 'substituicao_210240',
    consumida: quantidadeRestante <= 1e-9,
    devolucaoAnteriorId: origemId,
    excluirDevolucaoIds: [],
    notaAnterior: {
      id: nota.id,
      numero: nota.numero,
      serie: nota.serie,
      chave: nota.chave_acesso,
      protocolo: nota.protocolo,
      status: nota.status
    },
    manifestacao: {
      ...manif,
      origem_registro: manif.origem_registro,
      validado_sistema: Number(manif.validado_sistema) === 1,
      eventoSefazValidado: Number(manif.validado_sistema) === 1 && manif.origem_registro === ORIGEM_XML
    },
    contexto,
    liberacaoPorItem,
    liberacaoPorProduto,
    liberacaoPorNome,
    consumidoPorItem,
    consumidoPorProduto,
    restantePorItem,
    restantePorProduto,
    quantidadeLiberada: Object.values(liberacaoPorItem).reduce((s, q) => s + Number(q || 0), 0),
    quantidadeConsumida,
    quantidadeRestante,
    mensagemEsgotada: mensagemQuantidadeJaUtilizada(nota.numero)
  };
}

function restanteDoItem(excecao, it) {
  const restante = (excecao && excecao.restantePorItem) || {};
  const porProd = (excecao && excecao.restantePorProduto) || {};
  const porItem = round3(
    restante[it.compra_item_id]
    || restante[String(it.compra_item_id)]
    || 0
  );
  if (porItem > 0) return porItem;
  const pid = Number(it.produto_id || 0);
  if (pid > 0 && porProd[pid] != null) return round3(porProd[pid]);
  const nome = String(it.produto_nome || it.produto_codigo || '').trim().toUpperCase();
  const porNome = (excecao && excecao.liberacaoPorNome) || {};
  const consNome = (excecao && excecao.consumidoPorNome) || {};
  if (nome && porNome[nome] != null) {
    return round3(Math.max(0, Number(porNome[nome] || 0) - Number(consNome[nome] || 0)));
  }
  return 0;
}

function logSaldo210240(linhas) {
  for (const l of linhas || []) {
    // eslint-disable-next-line no-console
    console.info('[DEVOLUCAO][SALDO_210240]', JSON.stringify({
      notaAnterior: l.notaAnterior,
      chaveAnterior: l.chaveAnterior,
      produto: l.produto,
      compra_item_id: l.compra_item_id,
      saldoNormal: l.saldoNormal,
      quantidadeNFAnterior: l.quantidadeNFAnterior,
      quantidadeJaSubstituida: l.quantidadeJaSubstituida,
      restanteExcecao: l.restanteExcecao,
      saldoDisponivel: l.saldoDisponivel,
      quantidadeSolicitada: l.quantidadeSolicitada,
      resultado: l.resultado
    }));
  }
}

async function calcularSaldoDisponivelParaDevolucao({
  compraId,
  origemDevolucaoId,
  rascunho,
  itensSolicitados,
  carregarSaldos
} = {}) {
  const saldosNormais = await carregarSaldos(compraId, { naoExcluirSubstituidas: true });
  const excecao = await resolverExcecaoSaldoManifestacao210240({
    origemDevolucaoId,
    compraId,
    rascunho
  });
  const saldos = excecao.aplicar
    ? aplicarRestanteExcecaoNosSaldos(saldosNormais, excecao)
    : saldosNormais;
  trace210240('calculo_saldo', {
    compraId,
    rascunhoId: rascunho && rascunho.id,
    origemNfeDevolucaoId: origemDevolucaoId || (excecao.contexto && excecao.contexto.origemDevolucaoId),
    documento_original_id: rascunho && rascunho.documento_original_id,
    substituicaoId: excecao.contexto && excecao.contexto.substituicaoId,
    chaveNFAnterior: excecao.notaAnterior && excecao.notaAnterior.chave,
    evento210240: Boolean(excecao.aplicar),
    origemResolvida: (excecao.contexto && excecao.contexto.fonte) || null,
    saldoNormal: saldosNormais.totais && saldosNormais.totais.saldo,
    restanteExcecao: excecao.quantidadeRestante,
    saldoDisponivel: saldos.totais && saldos.totais.saldo
  });
  const porId = new Map((saldos.itens || []).map((i) => [Number(i.compra_item_id), i]));
  const porProd = new Map();
  for (const i of (saldos.itens || [])) {
    const pid = Number(i.produto_id || 0);
    if (pid > 0 && !porProd.has(pid)) porProd.set(pid, i);
  }
  const detalhe = (itensSolicitados || []).map((req) => {
    const itemId = Number(req.compra_item_id || req.id);
    const base = porId.get(itemId) || porProd.get(Number(req.produto_id || 0)) || {};
    const qtd = Number(req.quantidade || 0);
    const saldoNormal = Number(base.saldo_normal != null ? base.saldo_normal : (excecao.aplicar ? 0 : base.saldo) || 0);
    const rest = restanteDoItem(excecao, {
      compra_item_id: itemId,
      produto_id: req.produto_id || base.produto_id,
      produto_nome: req.produto_nome || base.produto_nome,
      produto_codigo: req.produto_codigo || base.produto_codigo
    });
    const disponivel = round3(saldoNormal + rest);
    const ok = qtd <= disponivel + 1e-9;
    return {
      notaAnterior: excecao.notaAnterior && excecao.notaAnterior.numero,
      chaveAnterior: excecao.notaAnterior && excecao.notaAnterior.chave,
      produto: req.produto_nome || base.produto_nome || itemId,
      compra_item_id: itemId,
      saldoNormal,
      saldoExcecao210240: rest,
      saldoDisponivel: disponivel,
      quantidadeSolicitada: qtd,
      quantidadePermitida: disponivel,
      quantidadeNFAnterior: (excecao.liberacaoPorItem && excecao.liberacaoPorItem[itemId]) || 0,
      quantidadeJaSubstituida: (excecao.consumidoPorItem && excecao.consumidoPorItem[itemId]) || 0,
      restanteExcecao: rest,
      resultado: ok ? 'PERMITIDO' : 'BLOQUEADO'
    };
  });
  if (excecao.aplicar || (detalhe && detalhe.length)) {
    logSaldo210240(detalhe);
    for (const l of detalhe) {
      trace210240('item', {
        compraId,
        rascunhoId: rascunho && rascunho.id,
        notaId: excecao.devolucaoAnteriorId,
        origemNfeDevolucaoId: excecao.devolucaoAnteriorId,
        chaveNFAnterior: l.chaveAnterior,
        evento210240: Boolean(excecao.aplicar),
        origemResolvida: excecao.contexto && excecao.contexto.fonte,
        produto: l.produto,
        saldoNormal: l.saldoNormal,
        restanteExcecao: l.restanteExcecao,
        saldoDisponivel: l.saldoDisponivel,
        quantidadeSolicitada: l.quantidadeSolicitada,
        resultado: l.resultado
      });
    }
  }
  return {
    saldos,
    saldosNormais,
    excecao,
    itens: detalhe,
    saldoNormal: saldosNormais.totais,
    saldoExcecao210240: excecao.aplicar ? (saldos.totais || null) : null,
    saldoDisponivel: (saldos.totais && saldos.totais.saldo) || 0
  };
}

function aplicarRestanteExcecaoNosSaldos(saldosNormais, excecao) {
  const itens = (saldosNormais.itens || []).map((it) => {
    const rest = restanteDoItem(excecao, it);
    const saldo = round3((Number(it.saldo) || 0) + rest);
    return {
      ...it,
      saldo_normal: it.saldo,
      quantidade_liberada_substituicao: rest,
      saldo,
      quantidade_maxima: saldo
    };
  });
  const totalSaldo = round3(itens.reduce((s, i) => s + i.saldo, 0));
  return {
    ...saldosNormais,
    itens,
    totais: {
      ...saldosNormais.totais,
      saldo: totalSaldo,
      saldo_normal: saldosNormais.totais.saldo,
      saldo_excecao: totalSaldo
    },
    excecaoSubstituicao: {
      aplicada: true,
      consumida: Boolean(excecao.consumida),
      saldo_normal: saldosNormais.totais,
      saldo_excecao: { ...saldosNormais.totais, saldo: totalSaldo },
      quantidade_liberada_por_substituicao: excecao.quantidadeRestante,
      quantidade_consumida: excecao.quantidadeConsumida,
      devolucao_anterior: excecao.devolucaoAnteriorId,
      manifestacao_evento: TP_EVENTO_210240,
      eventoSefazValidado: Boolean(excecao.manifestacao && excecao.manifestacao.eventoSefazValidado)
    }
  };
}

async function registrarAuditoriaExcecaoSaldo({
  substituicaoId,
  excecao,
  saldosNormais,
  saldosExcecao,
  itensSolicitados,
  usuarioId,
  usuarioNome,
  novaDevolucaoId
}) {
  await garantirTabelasSubstituicaoDevolucao();
  await dbRun(`
    INSERT INTO nfe_devolucao_substituicao_auditoria (
      substituicao_id, devolucao_anterior_id, nova_devolucao_id, manifestacao_id,
      usuario_id, usuario_nome, saldo_normal, saldo_excecao,
      quantidade_liberada_por_substituicao, itens_json, motivo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    substituicaoId || null,
    excecao.devolucaoAnteriorId,
    novaDevolucaoId || null,
    excecao.manifestacao && excecao.manifestacao.id,
    usuarioId || null,
    usuarioNome || null,
    JSON.stringify((saldosNormais && saldosNormais.totais) || {}),
    JSON.stringify((saldosExcecao && saldosExcecao.totais) || {}),
    String(excecao.quantidadeLiberada || 0),
    JSON.stringify(itensSolicitados || []),
    'SUBSTITUICAO_OPERACIONAL_210240'
  ]);
  await gravarAuditoria({
    usuario_id: usuarioId || null,
    usuario_nome: usuarioNome || null,
    modulo: 'nfe_devolucao_compra',
    acao: 'EXCECAO_SALDO_210240',
    referencia_tipo: 'nfe_devolucao_compra',
    referencia_id: excecao.devolucaoAnteriorId,
    detalhes: {
      devolucao_anterior: excecao.devolucaoAnteriorId,
      nova_devolucao: novaDevolucaoId || null,
      manifestacao_evento: TP_EVENTO_210240,
      saldo_normal: saldosNormais && saldosNormais.totais,
      saldo_excecao: saldosExcecao && saldosExcecao.totais,
      quantidade_liberada_por_substituicao: excecao.quantidadeLiberada,
      itens: itensSolicitados
    }
  }).catch(() => {});
}

function montarBlocoDevolucaoRelacionada(excecao) {
  if (!excecao || !excecao.aplicar) return null;
  const n = excecao.notaAnterior;
  return {
    titulo: 'DEVOLUÇÃO RELACIONADA',
    nfAnterior: n.numero,
    serie: padSerie(n.serie),
    chave: n.chave,
    statusSefaz: 'AUTORIZADA',
    manifestacao: `${TP_EVENTO_210240} — ${DESC_EVENTO_210240}`,
    relacao: 'SUBSTITUIÇÃO OPERACIONAL',
    novaEmissao: true,
    aviso: 'A NF-e anterior permanece AUTORIZADA na SEFAZ.'
  };
}

module.exports = {
  TP_EVENTO_210240,
  DESC_EVENTO_210240,
  TIPO_RELACAO,
  ORIGEM_XML,
  ORIGEM_MANUAL,
  garantirTabelasSubstituicaoDevolucao,
  parsearXmlEventoManifestacao,
  montarObservacaoSubstituicao,
  eh210240,
  obterManifestacao210240,
  obterEvidencia210240,
  obterUltimaManifestacao,
  obterSubstituicaoPorAnterior,
  listarIdsDevolucoesSubstituidasComNova,
  somarConsumoAutorizadoPorItem,
  mensagemQuantidadeJaUtilizada,
  registrarManifestacaoDevolucao,
  criarRelacaoSubstituicao,
  efetivarSubstituicaoAposAutorizacao,
  resolverContextoSubstituicao210240,
  resolverOrigemSubstituicao210240,
  resolverExcecaoSaldoManifestacao210240,
  trace210240,
  aplicarRestanteExcecaoNosSaldos,
  restanteDoItem,
  calcularSaldoDisponivelParaDevolucao,
  registrarAuditoriaExcecaoSaldo,
  montarBlocoDevolucaoRelacionada,
  setDbForTests
};
