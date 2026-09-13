/**
 * RC14.15.4 — MGV6 TXITENS.TXT Compatibility V1.0
 * npm run test:mgv6-txitens-v1
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cfgMod = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');
const builder = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const exporter = require('../../backend/motores/equipamentos/mgv6/MGV6Exporter');
const syncService = require('../../backend/motores/equipamentos/mgv6/MGV6SyncService');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');

const ROOT = path.join(__dirname, '../..');
const FIXTURE_DIR = path.join(__dirname, '../fixtures/mgv6');
const GOLDEN_TXITENS = path.join(FIXTURE_DIR, 'expected.TXITENS.TXT');
const FIXTURE_101 = path.join(FIXTURE_DIR, 'expected-101.TXITENS.TXT');
const ESTRUTURA = path.join(FIXTURE_DIR, 'estrutura-txitens.json');

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-txitens-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

/**
 * Lê arquivo físico e separa registros por CRLF (sem incluir CRLF no registro).
 * @param {Buffer} buf
 * @returns {string[]}
 */
function separarRegistros(buf) {
  const text = buf.toString('latin1');
  const parts = text.split('\r\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function cfgPasta(folder, extra = {}) {
  return {
    exportFolder: folder,
    fileName: 'TXITENS.TXT',
    encoding: 'WINDOWS-1252',
    lineEnding: 'CRLF',
    autoLaunch: false,
    ...extra
  };
}

describe('RC14.15.4 — defaults TXITENS', () => {
  it('fileName operacional é TXITENS.TXT', () => {
    assert.equal(cfgMod.DEFAULTS.fileName, 'TXITENS.TXT');
    assert.equal(cfgMod.FILE_NAME_OPERACIONAL, 'TXITENS.TXT');
    assert.equal(cfgMod.REGISTRO_LENGTH, 320);
    assert.equal(cfgMod.normalizar({}).fileName, 'TXITENS.TXT');
  });

  it('CDS.TXT legado é normalizado para TXITENS.TXT', () => {
    assert.equal(cfgMod.normalizar({ fileName: 'CDS.TXT' }).fileName, 'TXITENS.TXT');
  });
});

describe('RC14.15.4 — build registro 320', () => {
  it('1 registro possui exatamente 320 caracteres', () => {
    const reg = builder.buildRecord({
      plu: '1',
      nome: 'TESTE CDS SISTEMAS',
      preco: 2.7
    }, {});
    assert.equal(reg.length, 320);
    assert.equal(reg.slice(0, 2), '01');
    assert.ok(reg.endsWith(' '));
    assert.equal(reg.trimEnd().includes('TESTE CDS SISTEMAS'), true);
  });

  it('2 registros — cada um com 320', () => {
    const { registros } = builder.buildProdutos([
      { plu: '1', nome: 'A', preco: 1 },
      { plu: '2', nome: 'B', preco: 2 }
    ], {});
    assert.equal(registros.length, 2);
    assert.ok(registros.every((r) => r.length === 320));
  });

  it('101 registros — cada um com 320', () => {
    const produtos = [];
    for (let i = 1; i <= 101; i += 1) {
      produtos.push({
        plu: String(i),
        nome: `Produto ${String(i).padStart(3, '0')} Kg`,
        preco: 1 + ((i % 50) / 100)
      });
    }
    const { registros, buffer } = builder.buildProdutos(produtos, {
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF'
    });
    assert.equal(registros.length, 101);
    assert.ok(registros.every((r) => r.length === 320));
    const expected = fs.readFileSync(FIXTURE_101);
    assert.ok(buffer.equals(expected), 'fixture 101 diverge');
  });

  it('padding com espaços (não truncar conteúdo lógico)', () => {
    const logico = builder.buildConteudoLogico({
      plu: '39',
      nome: 'Milho em Grao KG',
      preco: 2.7
    }, {});
    const reg = builder.padRegistro(logico.conteudo, { codigo: logico.codigo });
    assert.equal(reg.length, 320);
    assert.equal(reg.trimEnd(), logico.conteudo);
    assert.equal(reg.slice(logico.conteudo.length), ' '.repeat(320 - logico.conteudo.length));
  });

  it('descrição longa truncada ao máximo legado (50 chars)', () => {
    const desc = 'X'.repeat(301);
    const reg = builder.buildRecord({ plu: '1', nome: desc, preco: 1 }, {});
    assert.equal(reg.length, 320);
    assert.equal(reg.substring(20, 70), 'X'.repeat(50));
    assert.equal(reg.substring(70, 320), ' '.repeat(250));
  });
});

describe('RC14.15.4 — arquivo físico TXITENS.TXT', () => {
  it('exportera TXITENS.TXT, WINDOWS-1252, CRLF, 1 registro de 320 bytes', async () => {
    const folder = path.join(tmpRoot, 'one');
    fs.mkdirSync(folder, { recursive: true });
    const result = await exporter.exportarProdutos([
      { plu: '1', nome: 'TESTE CDS SISTEMAS', preco: 2.7 }
    ], cfgPasta(folder));

    assert.equal(result.arquivo, 'TXITENS.TXT');
    assert.equal(result.encoding, 'WINDOWS-1252');
    assert.equal(result.lineEnding, 'CRLF');
    assert.equal(result.registroLength, 320);
    assert.ok(fs.existsSync(path.join(folder, 'TXITENS.TXT')));
    assert.equal(fs.existsSync(path.join(folder, 'CDS.TXT')), false);

    const bytes = fs.readFileSync(result.caminho);
    assert.ok(bytes.includes(Buffer.from('\r\n')));
    const regs = separarRegistros(bytes);
    assert.equal(regs.length, 1);
    assert.equal(regs[0].length, 320);
    // bytes do registro (sem CRLF) = 320
    assert.equal(bytes.length, 320 + 2);
  });

  it('lote gera um único TXITENS.TXT com N registros de 320', async () => {
    const folder = path.join(tmpRoot, 'lote');
    fs.mkdirSync(folder, { recursive: true });
    const produtos = [
      { plu: '1', nome: 'Frango Do Dia Kg', preco: 10.5 },
      { plu: '2', nome: 'Picadinho Kg', preco: 28.99 },
      { plu: '3', nome: 'Costela Bovina Kg', preco: 19.99 }
    ];
    const result = await exporter.exportarProdutos(produtos, cfgPasta(folder));
    assert.equal(result.arquivo, 'TXITENS.TXT');
    assert.equal(result.quantidade, 3);
    const files = fs.readdirSync(folder).filter((f) => f.toUpperCase().endsWith('.TXT'));
    assert.deepEqual(files, ['TXITENS.TXT']);

    const regs = separarRegistros(fs.readFileSync(result.caminho));
    assert.equal(regs.length, 3);
    assert.ok(regs.every((r) => r.length === 320));
    assert.ok(fs.readFileSync(result.caminho).equals(fs.readFileSync(GOLDEN_TXITENS)));
  });

  it('overflow de código no lote não grava arquivo parcialmente inválido', async () => {
    const folder = path.join(tmpRoot, 'overflow');
    fs.mkdirSync(folder, { recursive: true });
    await assert.rejects(
      () => exporter.exportarProdutos([
        { plu: '1', nome: 'Ok', preco: 1 },
        { plu: '1234567890', nome: 'Overflow', preco: 1 }
      ], cfgPasta(folder)),
      (e) => e.code === CODES.CODE_OVERFLOW || e.code === CODES.PRODUTO_INVALID
    );
    assert.equal(fs.existsSync(path.join(folder, 'TXITENS.TXT')), false);
  });
});

describe('RC14.15.4 — estrutura vs fixture', () => {
  it('fixture estrutura documenta campos comprovados e 320', () => {
    const meta = JSON.parse(fs.readFileSync(ESTRUTURA, 'utf8'));
    assert.equal(meta.arquivo, 'TXITENS.TXT');
    assert.equal(meta.registroLength, 320);
    assert.equal(meta.encoding, 'WINDOWS-1252');
    assert.equal(meta.lineEnding, 'CRLF');
    assert.equal(meta.camposComprovados.tipoRegistro.inicio, 0);
    assert.equal(meta.camposComprovados.codigo.inicio, 2);
    assert.equal(meta.camposComprovados.preco.inicio, 11);
    assert.equal(meta.camposComprovados.descricao.inicio, 20);
  });

  it('golden TXITENS: 3 registros × 320 + CRLF', () => {
    const buf = fs.readFileSync(GOLDEN_TXITENS);
    const regs = separarRegistros(buf);
    assert.equal(regs.length, 3);
    assert.ok(regs.every((r) => r.length === 320));
    assert.equal(regs[0].slice(0, 20), '01000000001001050000');
    assert.ok(regs[0].trimEnd().endsWith('Frango Do Dia Kg'));
  });
});

describe('RC14.15.4 — modo MGV6 sem TCP / TCP intacto (fonte)', () => {
  it('modo TCP bloqueia sync (sem gerar TXT)', async () => {
    const folder = path.join(tmpRoot, 'tcp-block');
    fs.mkdirSync(folder, { recursive: true });
    await assert.rejects(
      () => syncService.syncProdutos(14154, [{ plu: '1', nome: 'A', preco: 1 }], {
        obterModoEnvio: async () => 'TCP',
        obterConfig: async () => cfgPasta(folder),
        pularChecagemEquipamento: true
      }),
      (e) => e.code === CODES.MODO_ENVIO_TCP
    );
    assert.equal(fs.existsSync(path.join(folder, 'TXITENS.TXT')), false);
  });

  it('MGV6 export path não referencia upload-plus/connect no builder', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6FileBuilder.js'),
      'utf8'
    );
    assert.doesNotMatch(src, /upload-plus|ConnectionManager|ToledoPrixIVDriver/);
  });

  it('enviar-produtos MGV6 usa TXITENS e não TCP', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/enviar-produtos-balanca.js'),
      'utf8'
    );
    assert.match(src, /TXITENS\.TXT/);
    assert.match(src, /Registro:.*320.*caracteres|registroLength \|\| 320/);
    const mgv6Fn = src.slice(src.indexOf('async function epbEnviarSelecionadosMGV6'));
    const body = mgv6Fn.slice(0, mgv6Fn.indexOf('async function epbEnviarSelecionados'));
    assert.doesNotMatch(body, /upload-plus/);
    assert.doesNotMatch(body, /\/connect/);
  });

  it('PluController TCP permanece com garantirModoTcp', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/drivers/toledo/plu/PluController.js'),
      'utf8'
    );
    assert.match(src, /garantirModoTcp/);
    assert.match(src, /uploadPlus/);
  });
});
