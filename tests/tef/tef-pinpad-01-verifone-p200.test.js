/**
 * TEF-PINPAD-01 — Cadastro Verifone P200 (selecionável, sem integração financeira).
 * Ambiente isolado: não abre mercadao.db oficial.
 *
 * Executar: node tests/tef/tef-pinpad-01-verifone-p200.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const pinpadCatalog = require('../../backend/services/tef/pinpads/pinpadCatalog');
const PinpadFactory = require('../../backend/services/tef/pinpads/PinpadFactory');
const PinpadNaoIntegrado = require('../../backend/services/tef/pinpads/PinpadNaoIntegrado');
const GertecPPC930 = require('../../backend/services/tef/pinpads/GertecPPC930');
const VerifonePinpad = require('../../backend/services/tef/pinpads/VerifonePinpad');

let passou = 0;
let falhou = 0;
const resultados = [];

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      resultados.push({ nome, ok: true });
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      resultados.push({ nome, ok: false, erro: error.message });
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

async function main() {
  console.log('\n=== TEF-PINPAD-01 Verifone P200 ===\n');

  await test('Catálogo estático lista GERTEC_PPC930 e VERIFONE_P200', () => {
    const ativos = pinpadCatalog.listarAtivos();
    const codigos = ativos.map((m) => m.codigo);
    assert.ok(codigos.includes('GERTEC_PPC930'), 'PPC930 ausente');
    assert.ok(codigos.includes('VERIFONE_P200'), 'P200 ausente');
  });

  await test('P200 marcada NAO_INTEGRADO; PPC930 INTEGRADO', () => {
    const p200 = pinpadCatalog.resolverPorCodigo('VERIFONE_P200');
    const ppc = pinpadCatalog.resolverPorCodigo('GERTEC_PPC930');
    assert.strictEqual(p200.integracaoTefStatus, 'NAO_INTEGRADO');
    assert.strictEqual(ppc.integracaoTefStatus, 'INTEGRADO');
    assert.strictEqual(p200.adquirenteSugerido, null);
    assert.ok(Array.isArray(p200.interfacesFisicasDocumentadas));
    assert.ok(p200.interfacesFisicasDocumentadas.includes('USB_CDC_SERIAL'));
    assert.ok(p200.interfacesFisicasDocumentadas.includes('USB_RNDIS'));
  });

  await test('P200 não herda protocolo/driver Gertec', () => {
    const p200 = pinpadCatalog.MODELOS.VERIFONE_P200;
    const ppc = pinpadCatalog.MODELOS.GERTEC_PPC930;
    assert.notStrictEqual(p200.interfaceEsperada, ppc.interfaceEsperada);
    assert.strictEqual(p200.interfaceEsperada, null);
    assert.ok(!/gertec|v\$pague|vspague/i.test(String(p200.descricaoConexao || '')));
  });

  await test('Factory: VERIFONE_P200 → PinpadNaoIntegrado (não VerifonePinpad stub)', async () => {
    assert.strictEqual(PinpadFactory.resolverClassePinpad({ codigo: 'VERIFONE_P200' }), PinpadNaoIntegrado);
    assert.strictEqual(PinpadFactory.resolverClassePinpad({ fabricante: 'Verifone', modelo: 'P200' }), PinpadNaoIntegrado);
    const inst = await PinpadFactory.obterPinpad({ codigo: 'VERIFONE_P200', pinpadModelo: 'VERIFONE_P200' });
    assert.ok(inst instanceof PinpadNaoIntegrado);
    assert.notStrictEqual(inst.constructor, VerifonePinpad);
    assert.notStrictEqual(inst.constructor, GertecPPC930);
  });

  await test('Factory: GERTEC_PPC930 permanece GertecPPC930', async () => {
    assert.strictEqual(PinpadFactory.resolverClassePinpad({ codigo: 'GERTEC_PPC930' }), GertecPPC930);
    const inst = await PinpadFactory.obterPinpad({ codigo: 'GERTEC_PPC930' });
    assert.ok(inst instanceof GertecPPC930);
  });

  await test('P200 recusa conectar e iniciarPagamento (sem simulação)', async () => {
    const inst = await PinpadFactory.obterPinpad({ codigo: 'VERIFONE_P200' });
    let erroConectar = null;
    try {
      await inst.conectar();
    } catch (e) {
      erroConectar = e;
    }
    assert.ok(erroConectar, 'conectar deveria falhar');
    assert.strictEqual(erroConectar.code, 'PINPAD_NAO_INTEGRADO');

    let erroPagamento = null;
    try {
      await inst.iniciarPagamento({ valor: 10, tipo: 'credito' });
    } catch (e) {
      erroPagamento = e;
    }
    assert.ok(erroPagamento, 'iniciarPagamento deveria falhar');
    assert.strictEqual(erroPagamento.code, 'PINPAD_NAO_INTEGRADO');

    const st = await inst.status();
    assert.strictEqual(st.online, false);
    assert.strictEqual(st.integracaoTefStatus, 'NAO_INTEGRADO');
  });

  await test('UI fallback contém opção VERIFONE_P200 e aviso de não integrado', () => {
    const uiPath = path.join(__dirname, '../../frontend/erp/js/configuracao_tef.js');
    const src = fs.readFileSync(uiPath, 'utf8');
    assert.ok(src.includes('value="VERIFONE_P200"'), 'option P200 ausente no HTML estático');
    assert.ok(src.includes('value="GERTEC_PPC930"'), 'option PPC930 ausente');
    assert.ok(src.includes('TEF ainda não integrado') || src.includes('ainda não está disponível'), 'aviso ausente');
    assert.ok(src.includes("VERIFONE_P200:"), 'mapa PINPAD_MODELOS_MAPA sem P200');
  });

  await test('Persistência isolada: seed + round-trip pinpad P200', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tef-pinpad-01-'));
    const dbPath = path.join(dir, 'tef-pinpad-01.db');
    const db = new sqlite3.Database(dbPath);

    try {
      await run(db, `
        CREATE TABLE tef_pinpad_catalogo (
          codigo TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          fabricante TEXT,
          modelo TEXT,
          adquirente_sugerido TEXT,
          ativo INTEGER DEFAULT 1
        )
      `);
      await run(db, `
        CREATE TABLE tef_pinpads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tef_configuracao_id INTEGER,
          habilitado INTEGER,
          codigo TEXT,
          nome TEXT,
          fabricante TEXT,
          modelo TEXT,
          tipo_conexao TEXT,
          porta_com TEXT,
          ip TEXT,
          porta INTEGER,
          serial TEXT,
          ativo INTEGER DEFAULT 1
        )
      `);

      for (const row of [
        ['GERTEC_PPC930', 'Gertec PPC930', 'Gertec', 'PPC930', 'Rede', 1],
        ['VERIFONE_P200', 'Verifone P200', 'Verifone', 'P200', null, 1]
      ]) {
        await run(db, `
          INSERT INTO tef_pinpad_catalogo (codigo, nome, fabricante, modelo, adquirente_sugerido, ativo)
          VALUES (?, ?, ?, ?, ?, ?)
        `, row);
      }

      const catalogo = await all(db, 'SELECT codigo FROM tef_pinpad_catalogo WHERE ativo = 1 ORDER BY codigo');
      assert.deepStrictEqual(catalogo.map((r) => r.codigo), ['GERTEC_PPC930', 'VERIFONE_P200']);

      const meta = pinpadCatalog.resolverPorCodigo('VERIFONE_P200');
      await run(db, `
        INSERT INTO tef_pinpads (tef_configuracao_id, habilitado, codigo, nome, fabricante, modelo, tipo_conexao, ativo)
        VALUES (1, 1, ?, ?, ?, ?, 'usb', 1)
      `, [meta.codigo, meta.nome, meta.fabricante, meta.modelo]);

      const lido = await get(db, 'SELECT * FROM tef_pinpads WHERE codigo = ?', ['VERIFONE_P200']);
      assert.ok(lido, 'config P200 não persistiu');
      assert.strictEqual(lido.fabricante, 'Verifone');
      assert.strictEqual(lido.modelo, 'P200');
      assert.strictEqual(lido.tipo_conexao, 'usb');

      const classe = PinpadFactory.resolverClassePinpad({
        codigo: lido.codigo,
        fabricante: lido.fabricante,
        modelo: lido.modelo
      });
      assert.strictEqual(classe, PinpadNaoIntegrado);
    } finally {
      await new Promise((resolve) => db.close(resolve));
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);

  const reportHint = {
    sprint: 'TEF-PINPAD-01',
    passou,
    falhou,
    resultados
  };
  process.stdout.write(`TEF_PINPAD_01_SUMMARY=${JSON.stringify(reportHint)}\n`);

  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
