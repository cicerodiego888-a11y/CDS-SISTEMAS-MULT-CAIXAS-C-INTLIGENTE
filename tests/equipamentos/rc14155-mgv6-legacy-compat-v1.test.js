/**
 * RC14.15.5 / RC14.15.9 — Compatibilidade MGV6 (PLU = código do item)
 * npm run test:mgv6-legacy-compat-v1
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
const { DESCRICAO_MAX_LEGADO, REGISTRO_LENGTH } = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');

const FIXTURES = path.join(__dirname, '../fixtures/mgv6/legacy-compat');

const LEGADO = [
  { nome: 'Frango Do Dia Kg', plu: '1', preco: 11.5, tx: '000000001' },
  { nome: 'Picadinho Kg', plu: '2', preco: 28.99, tx: '000000002' },
  { nome: 'Costela Bovina Kg', plu: '3', preco: 21.99, tx: '000000003' },
  { nome: 'Carne De Charque Kg', plu: '103', preco: 44.99, tx: '000000103' },
  { nome: 'Batata Inglesa .', plu: '150', preco: 5.99, tx: '000000150' },
  { nome: 'Milho Grão Kg', plu: '39', codigo: '012841', preco: 2.79, tx: '000000039' },
  { nome: 'Milho Grao', plu: '12746', preco: 2.5, tx: '000012746' },
  { nome: 'Pêra Unidade', plu: '12780', preco: 3.5, tx: '000012780' },
  {
    nome: 'Carne Congelada De Bovino Sem Osso Maminha Da Alcatra - Qtde',
    plu: '13007',
    preco: 41.99,
    tx: '000013007',
    descEsperada: 'Carne Congelada De Bovino Sem Osso Maminha Da Alca'
  }
];

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-legacy-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

describe('RC14.15.9 — padding bloco TT+Z+CCCCCC', () => {
  const casos = [
    ['1', '000000001'],
    ['39', '000000039'],
    ['12746', '000012746'],
    ['13007', '000013007']
  ];
  for (const [raw, expected] of casos) {
    it(`PLU ${raw} → bloco ${expected}`, () => {
      assert.equal(identity.formatarCodigoItem9(raw), expected);
    });
  }

  it('PLU 39 sozinho resolve', () => {
    const id = identity.resolverIdentidade({
      codigo: '012841',
      nome: 'Milho Grão Kg',
      plu: '39',
      integrar_balanca: 1
    });
    assert.equal(id.codigoItem, '39');
    assert.equal(id.cccccc, '000039');
  });

  it('mais de 9 dígitos → MGV6_CODE_OVERFLOW', () => {
    assert.throws(
      () => identity.formatarCodigoItem9('1234567890'),
      (e) => e.code === CODES.CODE_OVERFLOW
    );
  });
});

describe('RC14.15.9 — Fixtures PLU = código do item', () => {
  for (const p of LEGADO) {
    it(`${p.nome} → TX ${p.tx}`, () => {
      const reg = builder.buildRecord({
        plu: p.plu,
        nome: p.nome,
        codigo: p.codigo,
        preco: p.preco,
        integrar_balanca: 1
      }, {});
      assert.equal(reg.length, REGISTRO_LENGTH);
      assert.equal(reg.substring(2, 11), p.tx);
      if (p.descEsperada) {
        assert.equal(reg.substring(20, 20 + p.descEsperada.length), p.descEsperada);
        assert.equal(p.descEsperada.length, DESCRICAO_MAX_LEGADO);
      }
    });
  }
});

describe('RC14.15.9 — Milho 39 e 12746 distintos; codigo_mgv6 ignorado', () => {
  it('Milho Grão Kg PLU 39 → 000000039', () => {
    const reg = builder.buildRecord({
      codigo: '012841',
      plu: '39',
      nome: 'Milho Grão Kg',
      preco: 2.79,
      integrar_balanca: 1
    }, {});
    assert.equal(reg.substring(2, 11), '000000039');
  });

  it('Milho Grao PLU 12746 → 000012746', () => {
    const reg = builder.buildRecord({
      plu: '12746',
      nome: 'Milho Grao',
      preco: 2.5,
      integrar_balanca: 1
    }, {});
    assert.equal(reg.substring(2, 11), '000012746');
  });

  it('PLU 39 + codigo_mgv6 12746 → PLU vence', () => {
    const reg = builder.buildRecord({
      plu: '39',
      codigo_mgv6: '12746',
      nome: 'Milho Grão Kg',
      preco: 2.79,
      integrar_balanca: 1
    }, {});
    assert.equal(reg.substring(2, 11), '000000039');
  });

  it('Sem PLU + codigo_mgv6 → PLU_REQUIRED', () => {
    assert.throws(
      () => builder.buildRecord({
        codigo_mgv6: '12746',
        nome: 'Milho Grao',
        preco: 2.5,
        integrar_balanca: 1
      }, {}),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });
});

describe('RC14.15.5 — 1 produto Frango sem TCP', () => {
  it('1 registro 320 chars inicia com 01000000001', async () => {
    const folder = path.join(tmpRoot, 'frango');
    fs.mkdirSync(folder, { recursive: true });
    const result = await exporter.exportarProdutos([
      { plu: '1', nome: 'Frango Do Dia Kg', preco: 11.5, integrar_balanca: 1 }
    ], {
      exportFolder: folder,
      fileName: 'TXITENS.TXT',
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF',
      autoLaunch: false
    });
    assert.equal(result.quantidade, 1);
    assert.equal(result.registroLength, 320);
    const text = fs.readFileSync(result.caminho).toString('latin1');
    assert.ok(text.startsWith('01000000001001150000Frango Do Dia Kg'));
  });
});

describe('RC14.15.9 — fonte não usa TCP / UI sem Código MGV6', () => {
  it('IdentityResolver / FileBuilder / SyncService sem TCP', () => {
    const root = path.join(__dirname, '../../backend/motores/equipamentos/mgv6');
    for (const f of ['MGV6IdentityResolver.js', 'MGV6FileBuilder.js', 'MGV6SyncService.js']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      assert.doesNotMatch(src, /require\(['"].*ConnectionManager/);
      assert.doesNotMatch(src, /require\(['"].*ToledoPrixIVDriver/);
      assert.doesNotMatch(src, /upload-plus/);
    }
  });

  it('produtos.js sem campo codigo_mgv6', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/produtos.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /id=["']codigo_mgv6["']/);
    assert.doesNotMatch(src, /Código MGV6/);
  });
});

describe('RC14.15.9 — fixture JSON', () => {
  it('documenta 39 e 12746 como itens distintos via PLU', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'produtos-comprovados.json'), 'utf8'));
    const milho39 = meta.produtos.find((p) => p.plu === '39');
    const milho12746 = meta.produtos.find((p) => p.plu === '12746');
    assert.ok(milho39);
    assert.ok(milho12746);
    assert.equal(milho39.txEsperado, '000000039');
    assert.equal(milho12746.txEsperado, '000012746');
  });
});
