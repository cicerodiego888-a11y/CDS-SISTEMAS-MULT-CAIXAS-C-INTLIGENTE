/**
 * RC14.15.20 — CCCCCC do TXITENS = PLU com padStart(6), nunca centavos.
 * npm run test:mgv6-txitens-plu-cccccc-v1
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  formatMGV6ItemCode,
  formatMGV6Price,
  buildRecord,
  buildProdutos
} = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const identity = require('../../backend/motores/equipamentos/mgv6/MGV6IdentityResolver');

function ccccccDaLinha(reg) {
  return String(reg).slice(5, 11);
}

function precoBlocoDaLinha(reg) {
  return String(reg).slice(11, 20);
}

describe('RC14.15.20 — formatMGV6ItemCode', () => {
  it('PLU numérico → CCCCCC 6 posições', () => {
    assert.equal(formatMGV6ItemCode(1), '000001');
    assert.equal(formatMGV6ItemCode(3), '000003');
    assert.equal(formatMGV6ItemCode(25), '000025');
    assert.equal(formatMGV6ItemCode(30), '000030');
    assert.equal(formatMGV6ItemCode(35), '000035');
    assert.equal(formatMGV6ItemCode(45), '000045');
    assert.equal(formatMGV6ItemCode(99), '000099');
    assert.equal(formatMGV6ItemCode(12746), '012746');
  });

  it('não trata PLU como centavos / *100', () => {
    assert.notEqual(formatMGV6ItemCode(25), '002500');
    assert.notEqual(formatMGV6ItemCode(30), '003000');
    assert.notEqual(formatMGV6ItemCode(35), '003500');
    assert.notEqual(formatMGV6ItemCode(45), '004500');
    assert.notEqual(formatMGV6ItemCode(25), '000300');
  });

  it('25.00 / 30.0 não viram 2500 / 300', () => {
    assert.equal(formatMGV6ItemCode('25.00'), '000025');
    assert.equal(formatMGV6ItemCode('30.0'), '000030');
    assert.equal(formatMGV6ItemCode('35.0'), '000035');
    assert.equal(formatMGV6ItemCode('45.0'), '000045');
  });

  it('não reutiliza formatter de preço', () => {
    assert.notEqual(formatMGV6ItemCode(25), formatMGV6Price(25));
    assert.equal(formatMGV6Price(2500).slice(0, 6), '002500');
    assert.equal(formatMGV6ItemCode(25), '000025');
  });
});

describe('RC14.15.20 — linha TXITENS completa (só CCCCCC muda)', () => {
  const preco = 11.5;
  const blocoPreco = '001150000';

  it('PLU 25 → CCCCCC 000025; preço intacto', () => {
    const reg = buildRecord({
      plu: 25,
      nome: 'Produto PLU 25',
      preco,
      integrar_balanca: 1
    }, {});
    assert.equal(reg.length, 320);
    assert.equal(ccccccDaLinha(reg), '000025');
    assert.notEqual(ccccccDaLinha(reg), '002500');
    assert.equal(precoBlocoDaLinha(reg), blocoPreco);
    assert.equal(reg.slice(0, 11), '01000000025');
  });

  it('PLU 35 → CCCCCC 000035', () => {
    const reg = buildRecord({
      plu: 35,
      nome: 'Produto PLU 35',
      preco,
      integrar_balanca: 1
    }, {});
    assert.equal(ccccccDaLinha(reg), '000035');
    assert.notEqual(ccccccDaLinha(reg), '000350');
    assert.equal(precoBlocoDaLinha(reg), blocoPreco);
  });

  it('PLU 45 → CCCCCC 000045', () => {
    const reg = buildRecord({
      plu: 45,
      nome: 'Produto PLU 45',
      preco,
      integrar_balanca: 1
    }, {});
    assert.equal(ccccccDaLinha(reg), '000045');
    assert.notEqual(ccccccDaLinha(reg), '000450');
    assert.equal(precoBlocoDaLinha(reg), blocoPreco);
  });

  it('arquivo gerado: 25/30/35/45 nas posições CCCCCC', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-rc141520-'));
    const { registros, texto } = buildProdutos([
      { plu: '25.00', nome: 'A', preco: 25, integrar_balanca: 1 },
      { plu: '30.0', nome: 'B', preco: 3, integrar_balanca: 1 },
      { plu: '35.0', nome: 'C', preco: 3.5, integrar_balanca: 1 },
      { plu: '45.0', nome: 'D', preco: 4.5, integrar_balanca: 1 }
    ], { lineEnding: 'CRLF', encoding: 'WINDOWS-1252' });

    const esperados = ['000025', '000030', '000035', '000045'];
    const proibidos = ['002500', '000300', '000350', '000450'];
    for (let i = 0; i < registros.length; i += 1) {
      assert.equal(registros[i].length, 320);
      assert.equal(ccccccDaLinha(registros[i]), esperados[i]);
      assert.notEqual(ccccccDaLinha(registros[i]), proibidos[i]);
    }
    assert.match(texto, /\r\n/);

    const out = path.join(folder, 'TXITENS.TXT');
    fs.writeFileSync(out, texto);
    const relido = fs.readFileSync(out, 'latin1').split('\r\n').filter((l) => l.length);
    assert.equal(relido[0].slice(5, 11), '000025');
    assert.equal(relido[1].slice(5, 11), '000030');
    assert.equal(relido[2].slice(5, 11), '000035');
    assert.equal(relido[3].slice(5, 11), '000045');
    fs.rmSync(folder, { recursive: true, force: true });
  });
});

describe('RC14.15.20 — PLU no CDS permanece o inteiro', () => {
  it('25.00 resolve para PLU 25, não 2500', () => {
    const id = identity.resolverIdentidade({
      nome: 'X',
      plu: '25.00',
      integrar_balanca: 1
    });
    assert.equal(id.plu, '25');
    assert.equal(id.cccccc, '000025');
    assert.equal(id.codigoItem9, '000000025');
  });
});
