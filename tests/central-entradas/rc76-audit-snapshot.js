/**
 * RC7.6 — Auditoria read-only (homologação operacional).
 * NÃO altera banco nem código de produção.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const out = { ok: true, dbPath: DB_PATH, geradoEm: new Date().toISOString() };

function openDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve) => {
    db.all(sql, params, (err, rows) => {
      if (err) resolve([{ _erro: err.message, _sql: sql.slice(0, 100) }]);
      else resolve(rows || []);
    });
  });
}

function get(db, sql, params = []) {
  return all(db, sql, params).then((rows) => rows[0] || null);
}

function closeDb(db) {
  return new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function main() {
  let db;
  try {
    db = await openDb();
  } catch (e) {
    out.ok = false;
    out.dbError = String(e.message || e);
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  out.tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'central%' ORDER BY name"))
    .map((r) => r.name)
    .filter(Boolean);

  out.allTablesSample = (await all(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
    .map((r) => r.name)
    .filter(Boolean);

  out.docsByStatusTipo = await all(db, `
    SELECT status, tipo_documento AS tipoDocumento, COUNT(*) AS c
    FROM central_entradas_documentos
    GROUP BY status, tipo_documento
    ORDER BY c DESC
  `);

  out.origem = await all(db, `
    SELECT COALESCE(origem,'(null)') AS origem, COUNT(*) AS c
    FROM central_entradas_documentos
    GROUP BY origem
  `);

  out.idade = await all(db, `
    SELECT
      CASE
        WHEN julianday('now') - julianday(COALESCE(data_emissao, created_at)) < 0.1 THEN 'recem_<2.4h'
        WHEN julianday('now') - julianday(COALESCE(data_emissao, created_at)) < 1 THEN 'algumas_horas'
        WHEN julianday('now') - julianday(COALESCE(data_emissao, created_at)) < 7 THEN 'alguns_dias'
        ELSE 'mais_antiga'
      END AS faixa,
      COUNT(*) AS c
    FROM central_entradas_documentos
    GROUP BY 1
  `);

  out.totais = {
    total: (await get(db, 'SELECT COUNT(*) AS c FROM central_entradas_documentos'))?.c,
    resNfe: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_documentos WHERE tipo_documento='RES_NFE'"))?.c,
    procNfe: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_documentos WHERE tipo_documento IN ('PROC_NFE','NFE')"))?.c,
    aguardandoXml: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_documentos WHERE status='AGUARDANDO_XML_COMPLETO'"))?.c,
    upload: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_documentos WHERE lower(COALESCE(origem,'')) LIKE '%upload%'"))?.c,
    dfe: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_documentos WHERE lower(COALESCE(origem,'')) LIKE '%dfe%' OR origem IN ('sefaz','dist_dfe')"))?.c
  };

  out.amostraRecente = await all(db, `
    SELECT id, status, tipo_documento AS tipoDocumento, origem, substr(chave,1,20) AS chavePrefix,
           nsu, data_emissao AS dataEmissao, created_at AS createdAt
    FROM central_entradas_documentos
    ORDER BY datetime(COALESCE(data_emissao, created_at)) DESC
    LIMIT 12
  `);

  out.eventosTipos = await all(db, `
    SELECT tipo, COUNT(*) AS c
    FROM central_entradas_eventos
    GROUP BY tipo
    ORDER BY c DESC
    LIMIT 50
  `);

  out.eventosManifestacao = await all(db, `
    SELECT id, tipo, resultado, sucesso, duracao_ms AS duracaoMs,
           substr(descricao,1,180) AS descricao, created_at AS createdAt
    FROM central_entradas_eventos
    WHERE tipo LIKE '%MANIFEST%' OR tipo LIKE '%CIENCIA%' OR descricao LIKE '%210210%' OR descricao LIKE '%cStat%'
    ORDER BY id DESC
    LIMIT 25
  `);

  out.eventosSync = await all(db, `
    SELECT id, tipo, resultado, sucesso, duracao_ms AS duracaoMs,
           substr(descricao,1,200) AS descricao, created_at AS createdAt
    FROM central_entradas_eventos
    WHERE tipo LIKE 'SYNC%' OR tipo LIKE '%DFE%' OR tipo LIKE '%656%' OR tipo LIKE '%593%'
       OR tipo LIKE '%GATE%' OR tipo LIKE '%XML_WAIT%' OR tipo LIKE '%SOAP%'
    ORDER BY id DESC
    LIMIT 40
  `);

  out.eventosXmlWait = await all(db, `
    SELECT id, tipo, resultado, sucesso, duracao_ms AS duracaoMs,
           substr(descricao,1,180) AS descricao, created_at AS createdAt
    FROM central_entradas_eventos
    WHERE tipo LIKE '%XML_WAIT%' OR tipo LIKE '%AGUARDANDO%' OR descricao LIKE '%XML_WAIT%'
    ORDER BY id DESC
    LIMIT 20
  `);

  out.tempoMedioSync = await get(db, `
    SELECT ROUND(AVG(duracao_ms),1) AS mediaMs, COUNT(*) AS n,
           MIN(duracao_ms) AS minMs, MAX(duracao_ms) AS maxMs
    FROM central_entradas_eventos
    WHERE tipo IN ('SYNC_CONCLUIDA','SYNC_ERRO') AND duracao_ms IS NOT NULL AND duracao_ms > 0
  `);

  out.tempoMedioParser = await get(db, `
    SELECT ROUND(AVG(duracao_ms),1) AS mediaMs, COUNT(*) AS n
    FROM central_entradas_eventos
    WHERE tipo LIKE '%PARSER%' AND duracao_ms IS NOT NULL AND duracao_ms > 0
  `);

  out.tempoMedioMiip = await get(db, `
    SELECT ROUND(AVG(duracao_ms),1) AS mediaMs, COUNT(*) AS n
    FROM central_entradas_eventos
    WHERE tipo LIKE '%MIIP%' AND duracao_ms IS NOT NULL AND duracao_ms > 0
  `);

  out.tempoMedioManifest = await get(db, `
    SELECT ROUND(AVG(duracao_ms),1) AS mediaMs, COUNT(*) AS n
    FROM central_entradas_eventos
    WHERE (tipo LIKE '%MANIFEST%' OR tipo LIKE '%CIENCIA%') AND duracao_ms IS NOT NULL AND duracao_ms > 0
  `);

  out.tempoMedioXmlWait = await get(db, `
    SELECT ROUND(AVG(duracao_ms),1) AS mediaMs, COUNT(*) AS n
    FROM central_entradas_eventos
    WHERE tipo LIKE '%XML_WAIT%' AND duracao_ms IS NOT NULL AND duracao_ms > 0
  `);

  out.contagemEventosCriticos = {
    syncOk: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE tipo='SYNC_CONCLUIDA'"))?.c,
    syncErro: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE tipo='SYNC_ERRO'"))?.c,
    e656: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE tipo LIKE '%656%' OR descricao LIKE '%656%' OR descricao LIKE '%Consumo Indevido%'"))?.c,
    e593: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE tipo LIKE '%593%' OR descricao LIKE '%593%'"))?.c,
    cienciaOk: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE (tipo LIKE '%CIENCIA%' OR tipo LIKE '%MANIFEST%') AND (sucesso=1 OR resultado LIKE '%135%' OR resultado LIKE '%573%' OR descricao LIKE '%135%' OR descricao LIKE '%573%')"))?.c,
    cienciaRej: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE (tipo LIKE '%CIENCIA%' OR tipo LIKE '%MANIFEST%') AND (sucesso=0 OR resultado LIKE '%rej%' OR descricao LIKE '%215%')"))?.c,
    downloadAuto: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE tipo LIKE '%DOWNLOAD%' AND (tipo LIKE '%AUTO%' OR descricao LIKE '%auto%')"))?.c,
    downloadManual: (await get(db, "SELECT COUNT(*) AS c FROM central_entradas_eventos WHERE tipo LIKE '%DOWNLOAD%' OR tipo LIKE '%SOLICITAR_XML%' OR tipo LIKE '%XML_SOLICIT%'"))?.c
  };

  out.nsu = await get(db, `
    SELECT ult_nsu AS ultNsu, max_nsu AS maxNsu, cnpj, ambiente, data_sincronizacao AS dataSync, updated_at AS updatedAt
    FROM central_entradas_nsu
    ORDER BY id DESC LIMIT 1
  `);

  out.configChaves = (await all(db, 'SELECT chave FROM central_entradas_config ORDER BY chave'))
    .map((r) => r.chave)
    .filter(Boolean);

  const xmlWaitRow = await get(db, `
    SELECT chave, valor, tipo, updated_at AS updatedAt
    FROM central_entradas_config
    WHERE chave = 'xml_wait_scheduler_state'
  `);
  out.xmlWaitState = null;
  if (xmlWaitRow?.valor) {
    try {
      out.xmlWaitState = typeof xmlWaitRow.valor === 'string'
        ? JSON.parse(xmlWaitRow.valor)
        : xmlWaitRow.valor;
      out.xmlWaitUpdatedAt = xmlWaitRow.updatedAt;
    } catch (e) {
      out.xmlWaitStateParseError = e.message;
      out.xmlWaitStateRawLen = String(xmlWaitRow.valor).length;
    }
  }

  const gateRow = await get(db, `
    SELECT chave, valor, updated_at AS updatedAt
    FROM central_entradas_config
    WHERE chave IN ('sefaz_operational_gate_state','sefaz_gate_state','operational_gate_state')
    LIMIT 1
  `);
  out.gateState = null;
  if (gateRow?.valor) {
    try {
      out.gateState = typeof gateRow.valor === 'string' ? JSON.parse(gateRow.valor) : gateRow.valor;
      out.gateKey = gateRow.chave;
      out.gateUpdatedAt = gateRow.updatedAt;
    } catch (e) {
      out.gateStateParseError = e.message;
    }
  }

  out.fiscalHintsCentral = await all(db, `
    SELECT chave, substr(CAST(valor AS TEXT),1,140) AS valor
    FROM central_entradas_config
    WHERE chave LIKE '%fiscal%' OR chave LIKE '%ambiente%' OR chave LIKE '%cnpj%' OR chave LIKE '%cert%'
       OR chave LIKE '%gate%' OR chave LIKE '%xml_wait%' OR chave LIKE '%scheduler%'
    ORDER BY chave
    LIMIT 50
  `);

  // Config fiscal global (tabelas comuns do ERP)
  for (const table of ['configuracoes', 'config', 'sistema_config', 'fiscal_config', 'empresa']) {
    const exists = (out.allTablesSample || []).includes(table);
    if (!exists) continue;
    const cols = await all(db, `PRAGMA table_info(${table})`);
    out[`pragma_${table}`] = cols.map((c) => c.name);
    const sample = await all(db, `SELECT * FROM ${table} LIMIT 5`);
    out[`sample_${table}`] = sample.map((row) => {
      const slim = {};
      for (const [k, v] of Object.entries(row || {})) {
        const key = String(k).toLowerCase();
        if (/ambiente|cnpj|cert|fiscal|nsu|sefaz|path/.test(key)) {
          slim[k] = typeof v === 'string' && v.length > 160 ? v.slice(0, 160) + '…' : v;
        }
      }
      return slim;
    });
  }

  // chave/valor style configs
  for (const table of ['configuracoes_sistema', 'app_config', 'parametros', 'cds_config']) {
    if (!(out.allTablesSample || []).includes(table)) continue;
    const rows = await all(db, `SELECT * FROM ${table} LIMIT 5`);
    if (rows[0]?._erro) {
      out[`kv_${table}`] = rows;
    } else {
      out[`kv_${table}`] = rows;
    }
  }

  // Try generic chave/valor if configuracoes has those columns
  if ((out.allTablesSample || []).includes('configuracoes')) {
    const colNames = (out.pragma_configuracoes || []).map((n) => String(n).toLowerCase());
    if (colNames.includes('chave') || colNames.includes('key')) {
      const chaveCol = colNames.includes('chave') ? 'chave' : 'key';
      const valorCol = colNames.includes('valor') ? 'valor' : (colNames.includes('value') ? 'value' : null);
      if (valorCol) {
        out.fiscalKv = await all(db, `
          SELECT ${chaveCol} AS chave, substr(CAST(${valorCol} AS TEXT),1,160) AS valor
          FROM configuracoes
          WHERE lower(${chaveCol}) LIKE '%fiscal%' OR lower(${chaveCol}) LIKE '%ambiente%'
             OR lower(${chaveCol}) LIKE '%cnpj%' OR lower(${chaveCol}) LIKE '%cert%'
          ORDER BY ${chaveCol}
          LIMIT 40
        `);
      }
    }
  }

  out.historicoRecente = await all(db, `
    SELECT documento_id AS documentoId, status_anterior AS de, status_novo AS para,
           substr(COALESCE(detalhe,''),1,120) AS detalhe, created_at AS createdAt
    FROM central_entradas_historico
    ORDER BY id DESC
    LIMIT 25
  `);

  out.exemplosUpload = await all(db, `
    SELECT id, status, tipo_documento AS tipo, origem, data_emissao AS emissao, created_at AS createdAt
    FROM central_entradas_documentos
    WHERE lower(COALESCE(origem,'')) LIKE '%upload%'
    ORDER BY id DESC LIMIT 5
  `);

  out.exemplosRes = await all(db, `
    SELECT id, status, tipo_documento AS tipo, origem, nsu, data_emissao AS emissao
    FROM central_entradas_documentos
    WHERE tipo_documento='RES_NFE'
    ORDER BY id DESC LIMIT 5
  `);

  out.exemplosProc = await all(db, `
    SELECT id, status, tipo_documento AS tipo, origem, nsu, data_emissao AS emissao
    FROM central_entradas_documentos
    WHERE tipo_documento IN ('PROC_NFE','NFE')
    ORDER BY id DESC LIMIT 5
  `);

  out.exemplosAguardando = await all(db, `
    SELECT id, status, tipo_documento AS tipo, nsu, substr(chave,1,44) AS chave, updated_at AS updatedAt
    FROM central_entradas_documentos
    WHERE status='AGUARDANDO_XML_COMPLETO'
    ORDER BY id DESC LIMIT 8
  `);

  // Memory/CPU not in DB — note process snapshot if possible
  try {
    const mu = process.memoryUsage();
    out.auditorProcessMemory = {
      rssMb: Math.round(mu.rss / 1024 / 1024),
      heapUsedMb: Math.round(mu.heapUsed / 1024 / 1024)
    };
  } catch { /* ignore */ }

  await closeDb(db);

  const outPath = path.join(__dirname, 'rc76-audit-snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE', outPath);
  console.log(JSON.stringify({
    totais: out.totais,
    idade: out.idade,
    origem: out.origem,
    tempoMedioSync: out.tempoMedioSync,
    tempoMedioParser: out.tempoMedioParser,
    tempoMedioMiip: out.tempoMedioMiip,
    tempoMedioManifest: out.tempoMedioManifest,
    tempoMedioXmlWait: out.tempoMedioXmlWait,
    contagemEventosCriticos: out.contagemEventosCriticos,
    nsu: out.nsu,
    hasXmlWait: Boolean(out.xmlWaitState),
    hasGate: Boolean(out.gateState),
    eventosTop: (out.eventosTipos || []).slice(0, 15),
    fiscalKv: out.fiscalKv || out.fiscalHintsCentral
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
