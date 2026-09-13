/**
 * RC14.15.7 — MGV6 Legacy Flow V1.0
 * npm run test:mgv6-legacy-flow-v1
 *
 * PLU + Integrar com Balança (Código MGV6 não obrigatório).
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const identity = require('../../backend/motores/equipamentos/mgv6/MGV6IdentityResolver');
const builder = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const exporter = require('../../backend/motores/equipamentos/mgv6/MGV6Exporter');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');
const { REGISTRO_LENGTH, DESCRICAO_MAX_LEGADO } = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');
const encoding = require('../../backend/motores/equipamentos/mgv6/MGV6Encoding');

const ROOT = path.join(__dirname, '../..');

const MILHO = {
  id: 1192,
  codigo: '012841',
  nome: 'Milho Grão Kg',
  plu: '39',
  integrar_balanca: 1,
  produto_fracionado: 1,
  preco: 2.5,
  preco_venda: 2.5,
  codigo_barras: '7891234567890'
};

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-flow-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

describe('RC14.15.7 — PLU obrigatório / Código MGV6 opcional', () => {
  it('1. Produto com PLU 39 é aceito', () => {
    const id = identity.resolverIdentidade(MILHO);
    assert.equal(id.plu, '39');
    assert.equal(id.codigoItem, '39');
    assert.equal(id.origem, 'PLU');
    assert.equal(id.codigoItem9, '000000039');
  });

  it('2. Sem PLU → MGV6_PRODUCT_PLU_REQUIRED', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Sem PLU',
        integrar_balanca: 1,
        produto_fracionado: 1,
        codigo: '999',
        codigo_barras: '789'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });

  it('3. Integrar com Balança = NÃO → não exporta', () => {
    const { resolvidos, excluidos } = identity.resolverLista([
      { ...MILHO, integrar_balanca: 0 }
    ]);
    assert.equal(resolvidos.length, 0);
    assert.equal(excluidos.length, 1);
  });

  it('4. Com PLU não precisa de Código MGV6', () => {
    const p = { ...MILHO };
    delete p.codigo_mgv6;
    delete p.codigoMgv6;
    const reg = builder.buildRecord(p, {});
    assert.equal(reg.substring(2, 11), '000000039');
    assert.doesNotThrow(() => identity.resolverIdentidade(p));
  });

  it('5. EAN não é utilizado como PLU', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Só EAN',
        integrar_balanca: 1,
        codigo_barras: '7891234567890',
        codigo: '012841'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
    const reg = builder.buildRecord(MILHO, {});
    assert.notEqual(reg.substring(2, 11), '789123456');
    assert.equal(reg.substring(2, 11), '000000039');
  });
});

describe('RC14.15.7 — TXITENS físico', () => {
  it('6–9. arquivo 320 + CRLF + WINDOWS-1252', async () => {
    const folder = path.join(tmpRoot, 'tx');
    fs.mkdirSync(folder, { recursive: true });
    const result = await exporter.exportarProdutos([MILHO], {
      exportFolder: folder,
      fileName: 'TXITENS.TXT',
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF',
      autoLaunch: false
    });
    assert.equal(result.arquivo, 'TXITENS.TXT');
    assert.equal(result.registroLength, 320);
    const bytes = fs.readFileSync(result.caminho);
    assert.equal(bytes.length, 322);
    assert.ok(bytes.subarray(320, 322).equals(Buffer.from('\r\n')));
    const rebuild = encoding.encodeText(
      builder.buildRecord(MILHO, {}) + '\r\n',
      'WINDOWS-1252'
    );
    assert.ok(bytes.equals(rebuild));
  });

  it('10. descrição limitada a 50 caracteres', () => {
    const reg = builder.buildRecord({
      plu: '1',
      integrar_balanca: 1,
      nome: 'X'.repeat(80),
      preco: 1
    }, {});
    assert.equal(reg.length, REGISTRO_LENGTH);
    assert.equal(reg.substring(20, 20 + DESCRICAO_MAX_LEGADO), 'X'.repeat(50));
  });
});

describe('RC14.15.7 — Milho PLU 39', () => {
  it('11. código interno 012841 / PLU 39 é exportado', () => {
    const reg = builder.buildRecord(MILHO, {});
    assert.equal(reg.length, 320);
    assert.equal(reg.substring(0, 2), '01');
    assert.equal(reg.substring(2, 11), '000000039');
    assert.ok(reg.includes('Milho'));
    assert.notEqual(reg.substring(2, 11), '000012841');
  });
});

describe('RC14.15.7 — exclusividade TCP', () => {
  it('12. Sync/Builder/Identity sem TCP', () => {
    const dir = path.join(ROOT, 'backend/motores/equipamentos/mgv6');
    for (const f of ['MGV6IdentityResolver.js', 'MGV6FileBuilder.js', 'MGV6SyncService.js']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.doesNotMatch(src, /require\(['"].*ConnectionManager/);
      assert.doesNotMatch(src, /require\(['"].*ToledoPrixIVDriver/);
      assert.doesNotMatch(src, /upload-plus/);
    }
  });

  it('13. modo TCP permanece documentado no PluController', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/drivers/toledo/plu/PluController.js'),
      'utf8'
    );
    assert.match(src, /garantirModoTcp|MODO_ENVIO|modo_envio/);
  });
});

describe('RC14.15.9 — PLU exclusivo; codigo_mgv6 ignorado', () => {
  it('conflito PLU 39 + codigo_mgv6 12746 → PLU vence', () => {
    const id = identity.resolverIdentidade({
      ...MILHO,
      codigo_mgv6: '12746'
    });
    assert.equal(id.origem, 'PLU');
    assert.equal(id.codigoItem, '39');
  });

  it('item independente PLU 12746 (Milho Grao)', () => {
    const id = identity.resolverIdentidade({
      nome: 'Milho Grao',
      plu: '12746',
      integrar_balanca: 1
    });
    assert.equal(id.origem, 'PLU');
    assert.equal(id.codigoItem, '12746');
  });

  it('sem PLU + codigo_mgv6 → PLU_REQUIRED', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'Legado',
        integrar_balanca: 1,
        codigo_mgv6: '12746'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });
});
