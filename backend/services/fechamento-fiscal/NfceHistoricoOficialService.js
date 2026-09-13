/**
 * Sprint 08.1 — Integra NFC-e autorizada do Fechamento Fiscal do Dia
 * no histórico oficial (nfce_notas → tela Fiscal → NFC-e Emitidas).
 *
 * NÃO transmite. NÃO cria venda/financeiro/estoque.
 * Persistência somente após AUTORIZADO (cStat 100/150).
 */
'use strict';

const { DOC_STATUS } = require('./constants');

const ORIGEM_FECHAMENTO = 'fechamento_fiscal_dia';

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

async function garantirColunasHistorico(db) {
  const cols = await all(db, 'PRAGMA table_info(nfce_notas)');
  if (!cols.length) return { ok: false, motivo: 'nfce_notas ausente' };
  const names = new Set(cols.map((c) => c.name));
  const alters = [];
  if (!names.has('fechamento_fiscal_id')) {
    alters.push('ALTER TABLE nfce_notas ADD COLUMN fechamento_fiscal_id INTEGER');
  }
  if (!names.has('fechamento_documento_id')) {
    alters.push('ALTER TABLE nfce_notas ADD COLUMN fechamento_documento_id INTEGER');
  }
  if (!names.has('origem')) {
    alters.push("ALTER TABLE nfce_notas ADD COLUMN origem TEXT DEFAULT 'venda'");
  }
  for (const sql of alters) {
    try {
      await run(db, sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err.message || ''))) throw err;
    }
  }

  const vendaCol = cols.find((c) => c.name === 'venda_id');
  if (vendaCol && Number(vendaCol.notnull) === 1) {
    await tornarVendaIdOpcional(db);
  }
  return { ok: true };
}

/**
 * SQLite: recria nfce_notas permitindo venda_id NULL (NFC-e de fechamento
 * agrega várias vendas e não deve ser vinculada a uma venda comercial artificial).
 */
async function tornarVendaIdOpcional(db) {
  const flag = await get(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='nfce_notas'`);
  if (!flag) return;
  const cols = await all(db, 'PRAGMA table_info(nfce_notas)');
  const vendaCol = cols.find((c) => c.name === 'venda_id');
  if (!vendaCol || Number(vendaCol.notnull) !== 1) return;

  await run(db, 'BEGIN');
  try {
    await run(db, `
      CREATE TABLE IF NOT EXISTS nfce_notas_ff_mig (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER,
        numero INTEGER NOT NULL,
        serie INTEGER NOT NULL,
        chave_acesso TEXT,
        ambiente INTEGER DEFAULT 2,
        status TEXT DEFAULT 'pendente',
        xml_enviado TEXT,
        xml_retorno TEXT,
        protocolo TEXT,
        recibo TEXT,
        qr_code_url TEXT,
        danfe_html TEXT,
        fechamento_fiscal_id INTEGER,
        fechamento_documento_id INTEGER,
        origem TEXT DEFAULT 'venda',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const names = cols.map((c) => c.name);
    const hasOrigem = names.includes('origem');
    const hasFf = names.includes('fechamento_fiscal_id');
    const hasFd = names.includes('fechamento_documento_id');
    await run(db, `
      INSERT INTO nfce_notas_ff_mig (
        id, venda_id, numero, serie, chave_acesso, ambiente, status,
        xml_enviado, xml_retorno, protocolo, recibo, qr_code_url, danfe_html,
        fechamento_fiscal_id, fechamento_documento_id, origem, created_at, updated_at
      )
      SELECT
        id, venda_id, numero, serie, chave_acesso, ambiente, status,
        xml_enviado, xml_retorno, protocolo, recibo, qr_code_url, danfe_html,
        ${hasFf ? 'fechamento_fiscal_id' : 'NULL'},
        ${hasFd ? 'fechamento_documento_id' : 'NULL'},
        ${hasOrigem ? "COALESCE(origem, 'venda')" : "'venda'"},
        created_at, updated_at
      FROM nfce_notas
    `);
    await run(db, 'DROP TABLE nfce_notas');
    await run(db, 'ALTER TABLE nfce_notas_ff_mig RENAME TO nfce_notas');
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_nfce_notas_chave ON nfce_notas(chave_acesso)');
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_nfce_notas_numero ON nfce_notas(numero, serie, ambiente)');
    await run(db, 'CREATE INDEX IF NOT EXISTS idx_nfce_notas_ff ON nfce_notas(fechamento_fiscal_id)');
    await run(db, 'COMMIT');
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

function mapStatusOficial(statusDoc) {
  const st = String(statusDoc || '').toUpperCase();
  if (st === DOC_STATUS.AUTORIZADO || st === 'AUTORIZADA') return 'autorizada';
  if (st === DOC_STATUS.REJEITADO || st === 'REJEITADA') return 'rejeitada';
  if (st === 'CANCELADA' || st === 'CANCELADO') return 'cancelada';
  return null;
}

/**
 * Persiste/atualiza nfce_notas somente para documento AUTORIZADO.
 * Idempotente por chave_acesso (preferencial) ou série/número/ambiente + fechamento_documento_id.
 */
async function persistirNfceAutorizadaDoFechamento(db, documento, opts = {}) {
  await garantirColunasHistorico(db);

  const doc = documento || {};
  const statusOficial = mapStatusOficial(doc.status);
  if (statusOficial !== 'autorizada') {
    return {
      ok: false,
      ignorado: true,
      motivo: `Status ${doc.status} não gera NFC-e autorizada no histórico oficial.`
    };
  }

  const chave = String(doc.chave_acesso || '').trim();
  const numero = Number(doc.numero);
  const serie = Number(doc.serie || 1);
  const ambiente = Number(doc.ambiente != null ? doc.ambiente : 1);
  const fechamentoId = Number(opts.fechamentoId || doc.fechamento_fiscal_id || 0) || null;
  const documentoId = Number(doc.id || opts.documentoId || 0) || null;

  if (!chave && !(numero > 0)) {
    return { ok: false, erro: 'Documento autorizado sem chave/número.' };
  }

  let existente = null;
  if (chave) {
    existente = await get(db, `SELECT * FROM nfce_notas WHERE chave_acesso = ? ORDER BY id DESC LIMIT 1`, [chave]);
  }
  if (!existente && numero > 0) {
    existente = await get(
      db,
      `SELECT * FROM nfce_notas
       WHERE CAST(numero AS INTEGER) = ?
         AND CAST(serie AS INTEGER) = ?
         AND CAST(ambiente AS INTEGER) = ?
         AND (
           fechamento_documento_id = ?
           OR (origem = ? AND fechamento_fiscal_id = ?)
         )
       ORDER BY id DESC LIMIT 1`,
      [numero, serie, ambiente, documentoId, ORIGEM_FECHAMENTO, fechamentoId]
    );
  }

  const xmlEnviado = doc.xml_enviado || doc.xml_assinado || doc.xml_preparado || null;
  const xmlRetorno = doc.xml_retorno || doc.xml_autorizado || null;
  const protocolo = doc.protocolo || null;
  const recibo = doc.recibo || null;

  if (existente) {
    await run(
      db,
      `UPDATE nfce_notas
       SET status = ?,
           xml_enviado = COALESCE(?, xml_enviado),
           xml_retorno = COALESCE(?, xml_retorno),
           protocolo = COALESCE(?, protocolo),
           recibo = COALESCE(?, recibo),
           chave_acesso = COALESCE(?, chave_acesso),
           numero = COALESCE(?, numero),
           serie = COALESCE(?, serie),
           ambiente = COALESCE(?, ambiente),
           fechamento_fiscal_id = COALESCE(?, fechamento_fiscal_id),
           fechamento_documento_id = COALESCE(?, fechamento_documento_id),
           origem = ?,
           updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [
        'autorizada',
        xmlEnviado,
        xmlRetorno,
        protocolo,
        recibo,
        chave || null,
        numero || null,
        serie,
        ambiente,
        fechamentoId,
        documentoId,
        ORIGEM_FECHAMENTO,
        existente.id
      ]
    );
    let danfe = null;
    try {
      danfe = await gerarEPersistirDanfeNfce(db, existente.id);
    } catch (_) { /* DANFE opcional */ }
    return {
      ok: true,
      idempotente: true,
      nfce_id: existente.id,
      chave_acesso: chave || existente.chave_acesso,
      numero: numero || existente.numero,
      danfe_html: Boolean(danfe && danfe.html),
      protocolo: protocolo || existente.protocolo
    };
  }

  const ins = await run(
    db,
    `INSERT INTO nfce_notas (
       venda_id, numero, serie, chave_acesso, ambiente, status,
       xml_enviado, xml_retorno, protocolo, recibo, qr_code_url, danfe_html,
       fechamento_fiscal_id, fechamento_documento_id, origem,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
    [
      null,
      numero,
      serie,
      chave || null,
      ambiente,
      'autorizada',
      xmlEnviado,
      xmlRetorno,
      protocolo,
      recibo,
      fechamentoId,
      documentoId,
      ORIGEM_FECHAMENTO
    ]
  );

  let danfe = null;
  try {
    danfe = await gerarEPersistirDanfeNfce(db, ins.lastID);
  } catch (_) { /* DANFE opcional */ }

  return {
    ok: true,
    idempotente: false,
    nfce_id: ins.lastID,
    chave_acesso: chave,
    numero,
    danfe_html: Boolean(danfe && danfe.html),
    protocolo
  };
}

function extrairQrCodeUrlDoXml(xml) {
  const texto = String(xml || '');
  const cdata = texto.match(/<qrCode[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/qrCode>/i);
  if (cdata) return cdata[1].trim();
  const plain = texto.match(/<qrCode[^>]*>\s*([^<]+)\s*<\/qrCode>/i);
  return plain ? plain[1].trim() : null;
}

/**
 * Gera DANFE NFC-e reutilizando danfe.js / DanfeTermicoRenderer.
 * Fonte: nfce_notas + snapshot do documento do fechamento (itens/pagamentos persistidos).
 * Não transmite. Não cria venda.
 */
async function obterDanfeHtmlPorNfceId(db, nfceId) {
  await garantirColunasHistorico(db);
  const id = Number(nfceId);
  const nota = await get(db, `SELECT * FROM nfce_notas WHERE id = ?`, [id]);
  if (!nota) {
    const err = new Error('NFC-e não encontrada.');
    err.statusCode = 404;
    throw err;
  }
  if (!/autoriz/i.test(String(nota.status || ''))) {
    const err = new Error('Cupom Fiscal autorizado só está disponível para NFC-e autorizada.');
    err.statusCode = 400;
    throw err;
  }
  if (!nota.chave_acesso || !nota.numero || !nota.protocolo) {
    const err = new Error('NFC-e autorizada sem chave/número/protocolo completos.');
    err.statusCode = 400;
    throw err;
  }

  if (nota.danfe_html && String(nota.danfe_html).length > 50) {
    let totalCache = null;
    if (nota.fechamento_documento_id) {
      const rowTot = await get(
        db,
        `SELECT COALESCE(SUM(valor_total), 0) AS total
         FROM fechamentos_fiscais_documentos_itens WHERE documento_id = ?`,
        [nota.fechamento_documento_id]
      );
      totalCache = rowTot ? Number(rowTot.total || 0) : null;
    }
    return {
      html: nota.danfe_html,
      htmlTermico: nota.danfe_html,
      textoTermico: '',
      nota,
      total: totalCache,
      cache: true
    };
  }

  return gerarEPersistirDanfeNfce(db, id);
}

async function gerarEPersistirDanfeNfce(db, nfceId, deps = {}) {
  const getFiscalConfig = deps.getFiscalConfig
    || require('../fiscal/configService').getFiscalConfig;
  const { gerarDanfeHtml, montarDadosDanfe } = deps.danfe
    || require('../fiscal/danfe');
  const DanfeTermicoRenderer = deps.DanfeTermicoRenderer
    || require('../fiscal/DanfeTermicoRenderer');

  const nota = await get(db, `SELECT * FROM nfce_notas WHERE id = ?`, [nfceId]);
  if (!nota) return null;

  let itens = [];
  let pags = [];
  if (nota.fechamento_documento_id) {
    itens = await all(
      db,
      `SELECT produto_id, descricao, quantidade, valor_unitario, valor_total, unidade
       FROM fechamentos_fiscais_documentos_itens
       WHERE documento_id = ?
       ORDER BY ordem, id`,
      [nota.fechamento_documento_id]
    );
    pags = await all(
      db,
      `SELECT forma_pagamento, valor, operadora
       FROM fechamentos_fiscais_documentos_pagamentos
       WHERE documento_id = ?
       ORDER BY id`,
      [nota.fechamento_documento_id]
    );
  }

  const total = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0)
    || pags.reduce((s, p) => s + Number(p.valor || 0), 0);

  const config = await getFiscalConfig({ validarUrls: false });
  const ambiente = Number(nota.ambiente != null ? nota.ambiente : config.ambiente || 1);
  const qrCodeUrl = nota.qr_code_url
    || extrairQrCodeUrlDoXml(nota.xml_enviado)
    || extrairQrCodeUrlDoXml(nota.xml_retorno)
    || '';

  const itensDanfe = itens.map((it) => ({
    produto_id: it.produto_id,
    produto_nome: it.descricao,
    nome: it.descricao,
    quantidade: Number(it.quantidade || 0),
    preco_unitario: Number(it.valor_unitario || 0),
    subtotal: Number(it.valor_total || 0),
    valor_fiscal: Number(it.valor_total || 0)
  }));

  const payloadDanfe = {
    venda: {
      total,
      desconto: 0,
      forma_pagamento: (pags[0] && pags[0].forma_pagamento) || 'cartao',
      pagamentos: pags.map((p) => ({
        forma_pagamento: p.forma_pagamento || 'cartao',
        valor: Number(p.valor || 0)
      })),
      tpAmb: ambiente
    },
    itens: itensDanfe,
    itensFiscal: itensDanfe,
    empresa: {
      nome: config.nomeEmpresa,
      nomeFantasia: config.nomeFantasia || config.nomeEmpresa,
      razaoSocial: config.razaoSocial || config.nomeEmpresa,
      cnpj: config.cnpj,
      endereco: config.endereco,
      telefone: config.telefone,
      logradouro: config.logradouro,
      numero: config.numeroEndereco,
      bairro: config.bairro,
      municipio: config.municipioNome,
      uf: config.uf,
      cep: config.cep,
      larguraMm: config.danfeLarguraMm || 80
    },
    chave: nota.chave_acesso,
    numero: nota.numero,
    serie: nota.serie || config.serie,
    qrCodeUrl,
    tributos: null,
    nota: {
      tpAmb: ambiente,
      protocolo: nota.protocolo || null,
      data_autorizacao: nota.updated_at || nota.created_at || null
    }
  };

  const dadosDanfe = await montarDadosDanfe(payloadDanfe);
  const danfeHtml = await gerarDanfeHtml(dadosDanfe);
  let termico = { html: danfeHtml, texto: '' };
  try {
    termico = DanfeTermicoRenderer.gerar(dadosDanfe);
  } catch (_) { /* termico opcional */ }

  if (danfeHtml) {
    await run(
      db,
      `UPDATE nfce_notas
       SET danfe_html = ?, qr_code_url = COALESCE(?, qr_code_url), updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [danfeHtml, qrCodeUrl || null, nota.id]
    );
  }

  return {
    html: danfeHtml,
    htmlTermico: termico.html || danfeHtml,
    textoTermico: termico.texto || '',
    nota: { ...nota, danfe_html: danfeHtml, qr_code_url: qrCodeUrl || nota.qr_code_url },
    total,
    cache: false
  };
}

/**
 * Sincroniza todos os documentos AUTORIZADOS de um fechamento para nfce_notas.
 * Seguro para reexecução (idempotente). Não transmite.
 */
async function sincronizarHistoricoNfceDoFechamento(db, fechamentoId) {
  const id = Number(fechamentoId);
  const docs = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_documentos
     WHERE fechamento_fiscal_id = ?
       AND UPPER(status) = 'AUTORIZADO'
     ORDER BY id`,
    [id]
  );
  const resultados = [];
  for (const doc of docs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await persistirNfceAutorizadaDoFechamento(db, doc, { fechamentoId: id });
    resultados.push({ documento_id: doc.id, ...r });
  }
  return {
    ok: true,
    fechamento_id: id,
    quantidade: docs.length,
    resultados
  };
}

module.exports = {
  ORIGEM_FECHAMENTO,
  garantirColunasHistorico,
  persistirNfceAutorizadaDoFechamento,
  sincronizarHistoricoNfceDoFechamento,
  mapStatusOficial,
  obterDanfeHtmlPorNfceId,
  gerarEPersistirDanfeNfce,
  extrairQrCodeUrlDoXml
};
