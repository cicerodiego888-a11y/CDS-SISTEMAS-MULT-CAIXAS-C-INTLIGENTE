/**
 * CC-e V1 — Carta de Correção Eletrônica (tpEvento 110110)
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const cce = require('../../backend/services/fiscal/cartaCorrecaoNfe');

const CHAVE =
  '23260112345678000190550010000000011000000010';

function openMemDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
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

describe('CC-e V1 — XML evento 110110', () => {
  it('TESTE 1 — XML contém tpEvento, nSeqEvento=1, xCorrecao e chNFe', () => {
    const texto = 'Correcao do endereco de entrega informado na NF-e.';
    const xml = cce.montarXmlEventoCce({
      chave: CHAVE,
      cnpj: '12345678000190',
      codigoUf: '23',
      ambiente: 2,
      nSeqEvento: 1,
      xCorrecao: texto,
      dhEvento: '2026-09-24T12:00:00-03:00'
    });

    assert.match(xml, /<tpEvento>110110<\/tpEvento>/);
    assert.match(xml, /<nSeqEvento>1<\/nSeqEvento>/);
    assert.match(xml, new RegExp(`<chNFe>${CHAVE}<\\/chNFe>`));
    assert.match(xml, /<descEvento>Carta de Correção<\/descEvento>/);
    assert.match(xml, /<xCorrecao>/);
    assert.ok(xml.includes(texto) || xml.includes('Correcao'));
    assert.match(xml, new RegExp(`Id="ID110110${CHAVE}01"`));

    const valid = cce.validarXmlEventoCce(xml, { chave: CHAVE, nSeq: 1, xCorrecao: texto });
    assert.equal(valid.ok, true, valid.erros?.join('; '));
  });
});

describe('CC-e V1 — sequencial por NF-e', () => {
  it('TESTE 2 — segunda CC-e usa nSeqEvento = 2', () => {
    assert.equal(cce.calcularProximoSeqEvento(0), 1);
    assert.equal(cce.calcularProximoSeqEvento(1), 2);
    assert.equal(cce.calcularProximoSeqEvento(19), 20);
    assert.throws(() => cce.calcularProximoSeqEvento(20), /Limite/);
  });
});

describe('CC-e V1 — validação de texto', () => {
  it('TESTE 3 — texto com menos de 15 caracteres', () => {
    const r = cce.validarTextoCorrecao('curto demais');
    assert.equal(r.ok, false);
    assert.match(r.erro, /mínimo|minimo|15/i);
  });

  it('TESTE 4 — texto acima de 1000 caracteres', () => {
    const r = cce.validarTextoCorrecao('x'.repeat(1001));
    assert.equal(r.ok, false);
    assert.match(r.erro, /máximo|maximo|1000/i);
  });

  it('aceita texto válido após trim', () => {
    const r = cce.validarTextoCorrecao('  Correcao do campo de observacoes da NF-e.  ');
    assert.equal(r.ok, true);
    assert.equal(r.texto.startsWith('Correcao'), true);
  });
});

describe('CC-e V1 — bloqueio por status', () => {
  it('TESTE 5 — NF-e rejeitada bloqueia CC-e', () => {
    assert.throws(
      () => cce.assertNotaPermiteCce({ id: 1, status: 'rejeitada' }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'NFE_NAO_AUTORIZADA');
        return true;
      }
    );
  });

  it('TESTE 6 — NF-e cancelada bloqueia CC-e', () => {
    assert.throws(
      () => cce.assertNotaPermiteCce({ id: 1, status: 'cancelada' }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'NFE_CANCELADA');
        return true;
      }
    );
  });

  it('autorizada permite CC-e', () => {
    assert.equal(cce.assertNotaPermiteCce({ id: 1, status: 'autorizada' }), true);
  });
});

describe('CC-e V1 — concorrência de sequencial', () => {
  it('TESTE 7 — UNIQUE (nfe_id, n_seq_evento) impede duplicidade', async () => {
    const db = await openMemDb();
    await run(
      db,
      `CREATE TABLE nfe_cce_eventos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nfe_id INTEGER NOT NULL,
        n_seq_evento INTEGER NOT NULL,
        x_correcao TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente',
        UNIQUE(nfe_id, n_seq_evento)
      )`
    );

    await run(db, `INSERT INTO nfe_cce_eventos (nfe_id, n_seq_evento, x_correcao) VALUES (10, 1, 'primeira')`);

    let uniqueHit = false;
    try {
      await run(db, `INSERT INTO nfe_cce_eventos (nfe_id, n_seq_evento, x_correcao) VALUES (10, 1, 'duplicada')`);
    } catch (err) {
      uniqueHit = /UNIQUE|constraint/i.test(String(err.message || err));
    }
    assert.equal(uniqueHit, true);

    const row = await get(db, `SELECT COUNT(*) AS qtd FROM nfe_cce_eventos WHERE nfe_id = 10 AND n_seq_evento = 1`);
    assert.equal(Number(row.qtd), 1);

    await new Promise((resolve) => db.close(() => resolve()));
  });
});

describe('CC-e V1 — infraestrutura e rotas', () => {
  it('reutiliza RecepcaoEvento4 SVRS e XSDs existentes', () => {
    const urlHom = cce.getRecepcaoEventoUrlNfe(2);
    assert.match(urlHom, /recepcaoevento4\.asmx/i);
    assert.match(urlHom, /homologacao/i);

    const schemaDir = path.join(__dirname, '../../backend/schemas/nfe_v4.00');
    for (const f of [
      'CCe_v1.00.xsd',
      'envCCe_v1.00.xsd',
      'retEnvCCe_v1.00.xsd',
      'procCCeNFe_v1.00.xsd',
      'leiauteCCe_v1.00.xsd'
    ]) {
      assert.equal(fs.existsSync(path.join(schemaDir, f)), true, `faltando ${f}`);
    }
  });

  it('rotas POST/GET /notas/:id/cce existem', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/nfe.js'), 'utf8');
    assert.match(rotas, /\/notas\/:id\/cce/);
    assert.match(rotas, /transmitirCartaCorrecao/);
    assert.match(rotas, /listarCartasCorrecao/);
  });

  it('UI Central possui Carta de Correção e aviso de restrições', () => {
    const ui = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/nfe-central.js'), 'utf8');
    assert.match(ui, /abrirModalCartaCorrecaoNfe/);
    assert.match(ui, /abrirHistoricoCartaCorrecaoNfe/);
    assert.match(ui, /TRANSMITIR CC-e/);
    assert.match(ui, /não pode ser utilizada para alterar valores/i);
  });

  it('serviço não altera XML original da NF-e (somente evento)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/fiscal/cartaCorrecaoNfe.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /UPDATE\s+nfe_notas\s+SET\s+xml_/i);
    assert.match(src, /tpEvento.*110110|110110/);
  });
});
