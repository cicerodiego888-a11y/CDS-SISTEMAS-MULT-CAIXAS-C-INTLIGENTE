/**
 * RC14.15.5 — MGV6 TXITENS.TXT — Aderência ao arquivo real do cliente
 * npm run test:mgv6-txitens-real-v1
 *
 * GOLDEN: tests/fixtures/mgv6/real-client/TXITENS.TXT
 * Produto: PLU 99 / TESTE CDS SISTEMAS / R$ 2,99
 * Registro: 01000000099000299000TESTE CDS SISTEMAS + espaços até 320 + CRLF
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const builder = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const exporter = require('../../backend/motores/equipamentos/mgv6/MGV6Exporter');
const encoding = require('../../backend/motores/equipamentos/mgv6/MGV6Encoding');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');
const { LAYOUT_ID, REGISTRO_LENGTH } = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');

const ROOT = path.join(__dirname, '../..');
const FIXTURE_DIR = path.join(__dirname, '../fixtures/mgv6/real-client');
const GOLDEN_TXT = path.join(FIXTURE_DIR, 'TXITENS.TXT');
const GOLDEN_META = path.join(FIXTURE_DIR, 'produto-real.json');

const PRODUTO_REAL = {
  plu: '99',
  nome: 'TESTE CDS SISTEMAS',
  preco: 2.99,
  preco_venda: 2.99
};

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-txitens-real-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

function separarRegistros(buf) {
  const text = buf.toString('latin1');
  const parts = text.split('\r\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

describe('RC14.15.5 — GOLDEN produto real TESTE CDS SISTEMAS', () => {
  it('posições do registro real', () => {
    const record = builder.buildRecord(PRODUTO_REAL, {});
    assert.equal(record.length, 320);
    assert.equal(record.substring(0, 2), '01');
    assert.equal(record.substring(2, 11), '000000099');
    assert.equal(record.substring(11, 20), '000299000');
    assert.equal(record.substring(20, 38), 'TESTE CDS SISTEMAS');
    assert.equal(record.substring(38, 320), ' '.repeat(320 - 38));
    assert.ok(/^ +$/.test(record.substring(38, 320)));
  });

  it('formatarCampoNumericoMgv6: 2.99 → 000299000', () => {
    assert.equal(builder.formatarCampoNumericoMgv6(299), '000299000');
    assert.equal(builder.formatarCampoNumericoMgv6(299).length, 9);
  });

  it('comparação byte a byte com fixture real-client/TXITENS.TXT', () => {
    assert.ok(fs.existsSync(GOLDEN_TXT), 'fixture TXITENS.TXT ausente');
    const expected = fs.readFileSync(GOLDEN_TXT);
    const { buffer, registros, layout } = builder.buildProdutos([PRODUTO_REAL], {
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF',
      fileName: 'TXITENS.TXT'
    });
    assert.equal(layout, LAYOUT_ID);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].length, REGISTRO_LENGTH);
    assert.equal(buffer.equals(expected), true, 'golden byte-a-byte diverge');
  });

  it('arquivo físico: 320 + CRLF (322 bytes WINDOWS-1252)', async () => {
    const folder = path.join(tmpRoot, 'one');
    fs.mkdirSync(folder, { recursive: true });
    const result = await exporter.exportarProdutos([PRODUTO_REAL], {
      exportFolder: folder,
      fileName: 'TXITENS.TXT',
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF'
    });
    assert.equal(result.arquivo, 'TXITENS.TXT');
    assert.equal(result.layout, 'MGV6-REAL-CLIENT-V1');
    const bytes = fs.readFileSync(result.caminho);
    assert.equal(bytes.length, 322);
    assert.ok(bytes.subarray(320, 322).equals(Buffer.from('\r\n')));
    const regs = separarRegistros(bytes);
    assert.equal(regs.length, 1);
    assert.equal(regs[0].length, 320);
    assert.ok(bytes.equals(fs.readFileSync(GOLDEN_TXT)));
  });

  it('meta fixture documenta origem e posições', () => {
    const meta = JSON.parse(fs.readFileSync(GOLDEN_META, 'utf8'));
    assert.equal(meta.layout, 'MGV6-REAL-CLIENT-V1');
    assert.equal(meta.produto.plu || meta.produto.codigo_mgv6, '99');
    assert.equal(meta.posicoes.campoNumerico.valor, '000299000');
    assert.equal(meta.registroLength, 320);
  });
});

describe('RC14.15.5 — múltiplos produtos (isolamento)', () => {
  it('1 / 2 / 3 produtos: cada registro 320 + CRLF independente', () => {
    const p1 = { plu: '99', nome: 'TESTE CDS SISTEMAS', preco: 2.99 };
    const p2 = { plu: '1', nome: 'Frango Do Dia Kg', preco: 10.5 };
    const p3 = { plu: '2', nome: 'Picadinho Kg', preco: 28.99 };

    for (const lista of [[p1], [p1, p2], [p1, p2, p3]]) {
      const { buffer, registros } = builder.buildProdutos(lista, {
        encoding: 'WINDOWS-1252',
        lineEnding: 'CRLF'
      });
      assert.equal(registros.length, lista.length);
      assert.ok(registros.every((r) => r.length === 320));
      const parts = separarRegistros(buffer);
      assert.equal(parts.length, lista.length);
      assert.ok(parts.every((r) => r.length === 320));
      // conteúdo lógico do primeiro permanece intacto
      assert.equal(parts[0].substring(0, 38), '01000000099000299000TESTE CDS SISTEMAS');
    }
  });
});

describe('RC14.15.5 — overflow / size', () => {
  it('descrição > 50 → truncada ao legado; registro permanece 320', () => {
    const record = builder.buildRecord({ plu: '1', nome: 'Z'.repeat(301), preco: 1 }, {});
    assert.equal(record.length, 320);
    assert.equal(record.substring(20, 70), 'Z'.repeat(50));
  });

  it('campo numérico overflow rejeitado sem truncar', () => {
    assert.throws(
      () => builder.formatarCampoNumericoMgv6(100000),
      (e) => e.code === CODES.PRICE_INVALID
    );
    assert.throws(
      () => builder.formatarCampoNumericoMgv6('1234567890'),
      (e) => e.code === CODES.PRICE_INVALID
    );
  });
});

describe('RC14.15.5 — exclusividade MGV6 × TCP (fonte)', () => {
  it('enviar-produtos declara Layout MGV6-REAL-CLIENT-V1', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/enviar-produtos-balanca.js'),
      'utf8'
    );
    assert.match(src, /MGV6-REAL-CLIENT-V1/);
    assert.match(src, /TXITENS\.TXT/);
  });

  it('FileBuilder não chama TCP', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6FileBuilder.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /ConnectionManager|upload-plus|ToledoPrixIVDriver/);
    assert.match(src, /formatarCampoNumericoMgv6/);
  });
});

describe('RC14.15.5 — encoding WINDOWS-1252 do golden', () => {
  it('buffer golden é WINDOWS-1252 (ASCII do registro real)', () => {
    const expected = fs.readFileSync(GOLDEN_TXT);
    const rebuild = encoding.encodeText(
      builder.buildRecord(PRODUTO_REAL, {}) + '\r\n',
      'WINDOWS-1252'
    );
    assert.ok(expected.equals(rebuild));
  });
});
