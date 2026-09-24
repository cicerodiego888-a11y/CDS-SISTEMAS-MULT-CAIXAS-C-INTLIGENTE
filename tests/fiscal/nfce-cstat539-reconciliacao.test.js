/**
 * Sprint — Reconciliação CStat 539 com chave existente na SEFAZ
 * Caso real: nNF 16/17 fechamento 5
 *
 * Executar: node --test tests/fiscal/nfce-cstat539-reconciliacao.test.js
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const {
  reconciliarCstat539Documento,
  interpretarConsulta539,
  MAX_RECONCILIACOES_539_POR_CICLO,
  RESULTADO,
  extrairChaveConflito539
} = require('../../backend/services/fechamento-fiscal/NfceCstat539ReconciliacaoService');
const {
  parseChaveNfce
} = require('../../backend/services/fiscal/nfceNumeracaoOcupadosService');
const { proximoLivreDeConjunto } = require('../../backend/services/fiscal/numeracaoFiscalService');
const {
  recalcularSaldoFechamento,
  obterBaseNovaEmissao
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalSaldoService');
const { DOC_STATUS, STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const { garantirSchemaFechamentoFiscal } = require('../../backend/services/fechamento-fiscal/schema/fechamentoFiscalSchema');
const { toCentavos } = require('../../backend/services/fiscal/modeloTotais');

const CHAVE_16 = '23260968645756000121650010000000161675387937';
const CHAVE_17 = '23260968645756000121650010000000171343985539';

function openDb(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

describe('CStat 539 — reconciliação com chave SEFAZ', () => {
  let db;
  let ffId;
  let docId;
  const ocupados = [];

  before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-539-'));
    db = await openDb(path.join(dir, 't.db'));
    await run(db, `CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)`);
    await run(db, `INSERT INTO configuracoes VALUES ('fechamento_fiscal_do_dia','ATIVADO')`);
    await run(db, `INSERT INTO configuracoes VALUES ('cnpj','68645756000121')`);
    await new Promise((resolve, reject) => {
      garantirSchemaFechamentoFiscal(db, (err) => (err ? reject(err) : resolve()));
    });
    for (const sql of [
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_principal REAL`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_emitido_autorizado REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE fechamentos_fiscais ADD COLUMN valor_pendente_emissao REAL NOT NULL DEFAULT 0`
    ]) {
      try { await run(db, sql); } catch (_) { /* */ }
    }

    const ins = await run(
      db,
      `INSERT INTO fechamentos_fiscais (
        data_fechamento, cnpj, valor_informado, valor_distribuido, status,
        valor_principal, valor_emitido_autorizado, valor_pendente_emissao
      ) VALUES ('2026-09-22','68645756000121',687.76,437.77,'AUTORIZACAO_PARCIAL',687.76,249.99,437.77)`
    );
    ffId = ins.lastID;

    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        ffId, 1, DOC_STATUS.AUTORIZADO, 249.99, '100', 'PROT13',
        '23260968645756000121650010000000131123456789', 13
      ]
    );

    const d = await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, serie, ambiente, numero)
       VALUES (?,?,?,?,?,?,?)`,
      [ffId, 2, DOC_STATUS.PRONTO_EMISSAO, 249.97, 1, 2, 16]
    );
    docId = d.lastID;
  });

  function depsBase(consultaFn) {
    return {
      consultarProtocolo: consultaFn,
      aplicarOcupacaoPorRejeicao539Nfce: async (p) => {
        ocupados.push({
          numero: p.numeroEnviado,
          chave: extrairChaveConflito539(p.xMotivo, p.xmlRetorno),
          origem: '539'
        });
        return {
          chaveSefaz: extrairChaveConflito539(p.xMotivo, p.xmlRetorno),
          numeroOcupadoSefaz: parseChaveNfce(extrairChaveConflito539(p.xMotivo, p.xmlRetorno))?.numero,
          numeroOcupadoLocal: p.numeroEnviado,
          mesmaChave: false
        };
      },
      registrarNumeroOcupadoSefazNfce: async (p) => {
        ocupados.push({ numero: p.numero, chave: p.chave, origem: p.origem });
        return p;
      }
    };
  }

  const xml539_16 =
    `<retEnviNFe><cStat>539</cStat>`
    + `<xMotivo>Rejeicao: Duplicidade de NF-e, com diferenca na Chave de Acesso [chNFe:${CHAVE_16}]</xMotivo>`
    + `</retEnviNFe>`;

  const xml539_17 =
    `<retEnviNFe><cStat>539</cStat>`
    + `<xMotivo>Rejeicao: Duplicidade de NF-e, com diferenca na Chave de Acesso [chNFe:${CHAVE_17}]</xMotivo>`
    + `</retEnviNFe>`;

  it('extrai chaves reais 16 e 17', () => {
    assert.equal(extrairChaveConflito539(null, xml539_16), CHAVE_16);
    assert.equal(extrairChaveConflito539(null, xml539_17), CHAVE_17);
    assert.equal(parseChaveNfce(CHAVE_16).numero, 16);
    assert.equal(parseChaveNfce(CHAVE_17).numero, 17);
  });

  it('A) 539 + chave existente autorizada e associável (mesma chave)', async () => {
    const chave = CHAVE_16;
    const r = await reconciliarCstat539Documento({
      db,
      fechamentoId: ffId,
      documento: { id: docId, valor_total: 249.97, serie: 1, ambiente: 2 },
      config: { cnpj: '68645756000121', ambiente: 2, serie: 1, codigoUf: '23' },
      numeroEnviado: 16,
      chaveEnviada: chave, // mesma chave → associação segura
      xMotivo: `Duplicidade [chNFe:${chave}]`,
      xmlRetorno: xml539_16,
      contadorCiclo: 0,
      deps: depsBase(async () => ({
        success: true,
        cStat: '100',
        body: `<retConsSitNFe><cStat>100</cStat><nProt>PROT539A</nProt><chNFe>${chave}</chNFe></retConsSitNFe>`,
        protocolo: 'PROT539A'
      }))
    });
    assert.equal(r.resultado, RESULTADO.AUTORIZADO);
    assert.equal(r.statusDocumento, DOC_STATUS.AUTORIZADO);
    assert.equal(r.contabilizarValor, true);
    const row = await get(db, `SELECT status, protocolo, chave_acesso FROM fechamentos_fiscais_documentos WHERE id=?`, [docId]);
    assert.equal(row.status, DOC_STATUS.AUTORIZADO);
    assert.equal(row.protocolo, 'PROT539A');
  });

  it('B) 539 + chave autorizada NÃO associável → OCUPADO sem contabilizar', async () => {
    // reset doc
    await run(
      db,
      `UPDATE fechamentos_fiscais_documentos SET status=?, protocolo=NULL, chave_acesso=NULL, cstat=NULL WHERE id=?`,
      [DOC_STATUS.PRONTO_EMISSAO, docId]
    );
    const r = await reconciliarCstat539Documento({
      db,
      fechamentoId: ffId,
      documento: { id: docId, valor_total: 249.97, serie: 1, ambiente: 2 },
      config: { cnpj: '68645756000121', ambiente: 2, serie: 1 },
      numeroEnviado: 16,
      chaveEnviada: '23260968645756000121650010000000169999999999', // chave diferente
      xMotivo: `Duplicidade [chNFe:${CHAVE_16}]`,
      xmlRetorno: xml539_16,
      contadorCiclo: 1,
      deps: depsBase(async () => ({
        success: true,
        cStat: '100',
        body: `<retConsSitNFe><cStat>100</cStat><nProt>PROT-OUTRO</nProt><chNFe>${CHAVE_16}</chNFe></retConsSitNFe>`,
        protocolo: 'PROT-OUTRO'
      }))
    });
    assert.equal(r.resultado, RESULTADO.OCUPADO);
    assert.equal(r.contabilizarValor, false);
    assert.equal(r.statusDocumento, DOC_STATUS.REJEITADO);
    assert.match(r.mensagem, /SEFAZ|reconcili/i);
  });

  it('C) 539 + chave não localizada', async () => {
    const r = await reconciliarCstat539Documento({
      db,
      fechamentoId: ffId,
      documento: { id: docId, valor_total: 187.80, serie: 1, ambiente: 2 },
      config: { cnpj: '68645756000121', ambiente: 2, serie: 1 },
      numeroEnviado: 17,
      chaveEnviada: '23260968645756000121650010000000178888888888',
      xMotivo: `Duplicidade [chNFe:${CHAVE_17}]`,
      xmlRetorno: xml539_17,
      contadorCiclo: 2,
      deps: depsBase(async () => ({
        success: true,
        cStat: '217',
        body: '<retConsSitNFe><cStat>217</cStat><xMotivo>NF-e nao consta</xMotivo></retConsSitNFe>'
      }))
    });
    assert.equal(r.resultado, RESULTADO.NAO_LOCALIZADO);
    assert.equal(r.contabilizarValor, false);
    assert.ok(ocupados.some((o) => Number(o.numero) === 17 || o.chave === CHAVE_17));
  });

  it('D/E) múltiplos 539 — nNF 16 e 17 ocupados; pular na numeração', () => {
    const livre = proximoLivreDeConjunto(14, [14, 15, 16, 17]);
    assert.equal(livre, 18);
    assert.ok(ocupados.some((o) => Number(o.numero) === 16 || o.chave === CHAVE_16));
    assert.ok(ocupados.some((o) => Number(o.numero) === 17 || o.chave === CHAVE_17));
  });

  it('F) proteção contra loop (máx 10)', async () => {
    const r = await reconciliarCstat539Documento({
      db,
      fechamentoId: ffId,
      documento: { id: docId, valor_total: 10, serie: 1 },
      config: { cnpj: '68645756000121', ambiente: 2, serie: 1 },
      numeroEnviado: 99,
      chaveEnviada: CHAVE_16,
      xMotivo: `x [chNFe:${CHAVE_16}]`,
      xmlRetorno: xml539_16,
      contadorCiclo: MAX_RECONCILIACOES_539_POR_CICLO,
      deps: depsBase(async () => ({ success: true, cStat: '100', body: '' }))
    });
    assert.equal(r.resultado, RESULTADO.LIMITE_LOOP);
    assert.equal(r.statusFechamentoSugerido, STATUS.PENDENTE_RECUPERACAO);
  });

  it('G) recuperação não duplica valor (chave já autorizada)', async () => {
    // doc 13 already auth with different chave; try to associate CHAVE that is already on another auth — 
    // create second auth with CHAVE_16
    await run(
      db,
      `INSERT INTO fechamentos_fiscais_documentos
        (fechamento_fiscal_id, sequencia, status, valor_total, cstat, protocolo, chave_acesso, numero)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ffId, 90, DOC_STATUS.AUTORIZADO, 100, '100', 'PX', CHAVE_16, 90]
    );
    const r = await reconciliarCstat539Documento({
      db,
      fechamentoId: ffId,
      documento: { id: docId, valor_total: 100, serie: 1, ambiente: 2 },
      config: { cnpj: '68645756000121', ambiente: 2, serie: 1 },
      numeroEnviado: 16,
      chaveEnviada: CHAVE_16,
      xMotivo: `Dup [chNFe:${CHAVE_16}]`,
      xmlRetorno: xml539_16,
      contadorCiclo: 3,
      deps: depsBase(async () => ({
        success: true,
        cStat: '100',
        body: `<retConsSitNFe><cStat>100</cStat><nProt>P</nProt><chNFe>${CHAVE_16}</chNFe></retConsSitNFe>`,
        protocolo: 'P'
      }))
    });
    assert.equal(r.resultado, RESULTADO.OCUPADO);
    assert.equal(r.associacao && r.associacao.motivo, 'CHAVE_JA_CONTABILIZADA');
    assert.equal(r.contabilizarValor, false);
  });

  it('H/I) saldo após 539 sem nova auth: principal 687.76 / emitido 249.99+100 / parcial preservado', async () => {
    // reset doc16 to rejeitado (não contar)
    await run(
      db,
      `UPDATE fechamentos_fiscais_documentos SET status=? WHERE id=?`,
      [DOC_STATUS.REJEITADO, docId]
    );
    const s = await recalcularSaldoFechamento(db, ffId);
    assert.equal(toCentavos(s.valor_principal), 68776);
    // 249.99 + 100 (doc 90) = 349.99
    assert.equal(toCentavos(s.valor_emitido_autorizado), 34999);
    assert.equal(toCentavos(s.valor_pendente_emissao), 33777);
    assert.equal(s.concluido, false);
  });

  it('J) continuação somente pelo pendente', async () => {
    const base = await obterBaseNovaEmissao(db, ffId);
    assert.equal(toCentavos(base.valor_nova_tentativa), toCentavos(base.valor_pendente_emissao));
    assert.notEqual(toCentavos(base.valor_nova_tentativa), 68776);
  });

  it('interpretarConsulta539 — casos A/B/C', () => {
    assert.equal(interpretarConsulta539({ success: true, cStat: '100', body: '<cStat>100</cStat><nProt>1</nProt>' }).autorizado, true);
    assert.equal(interpretarConsulta539({ success: true, cStat: '217', xMotivo: 'nao consta', body: '' }).encontrado, false);
    assert.equal(interpretarConsulta539({ success: false, error: 'timeout' }).erro, true);
  });

  it('código: transmissão chama reconciliação 539; UI tem mensagem', () => {
    const tx = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'),
      'utf8'
    );
    assert.match(tx, /reconciliarCstat539Documento/);
    assert.match(tx, /_reconciliacoes539/);
    assert.match(tx, /_pararPorLimite539/);
    const ui = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/fechamento-fiscal-dia.js'),
      'utf8'
    );
    assert.match(ui, /numeração já existente na SEFAZ/i);
    assert.match(ui, /reconciliando o documento antes de continuar/i);
  });
});
