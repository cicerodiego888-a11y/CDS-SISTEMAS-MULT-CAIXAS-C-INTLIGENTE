/**
 * Sprint 14.15.1 — Bridge MGV6 V1.0 (compatibilidade / exportação)
 * npm run test:mgv6-v1
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cfgMod = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');
const validator = require('../../backend/motores/equipamentos/mgv6/MGV6Validator');
const builder = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const encoding = require('../../backend/motores/equipamentos/mgv6/MGV6Encoding');
const exporter = require('../../backend/motores/equipamentos/mgv6/MGV6Exporter');
const launcher = require('../../backend/motores/equipamentos/mgv6/MGV6Launcher');
const repo = require('../../backend/motores/equipamentos/mgv6/MGV6Repository');
const { MGV6Error, CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');

const FIXTURE_DIR = path.join(__dirname, '../fixtures/mgv6');
const GOLDEN_JSON = path.join(FIXTURE_DIR, 'produto-golden.json');
const GOLDEN_TXT = path.join(FIXTURE_DIR, 'expected.TXITENS.TXT');

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

describe('MGV6 V1 — Configuration', () => {
  it('aplica defaults de compatibilidade', () => {
    const c = cfgMod.normalizar({});
    assert.equal(c.enabled, false);
    assert.equal(c.autoLaunch, false);
    assert.equal(c.encoding, 'WINDOWS-1252');
    assert.equal(c.lineEnding, 'CRLF');
    assert.equal(c.modoVariavel, 'VALOR');
    assert.equal(c.digitosPlu, 6);
    assert.equal(c.prefixoEtiqueta, '2');
    assert.equal(c.diferenciarPesoUnidade, false);
    assert.equal(c.fileName, 'TXITENS.TXT');
    assert.equal(c.tipoRegistro, '01');
    assert.equal(c.registroLength, 320);
  });

  it('normaliza CDS.TXT legado para TXITENS.TXT', () => {
    assert.equal(cfgMod.normalizar({ fileName: 'CDS.TXT' }).fileName, 'TXITENS.TXT');
    assert.equal(cfgMod.resolverFileNameOperacional('cds.txt'), 'TXITENS.TXT');
  });

  it('normaliza encoding e modo', () => {
    const c = cfgMod.normalizar({ encoding: 'utf8', modoVariavel: 'peso', autoLaunch: 'true' });
    assert.equal(c.encoding, 'UTF-8');
    assert.equal(c.modoVariavel, 'PESO');
    assert.equal(c.autoLaunch, true);
  });
});

describe('MGV6 V1 — Validator', () => {
  it('valida código 9 dígitos e rejeita overflow sem truncar', () => {
    assert.equal(validator.validarCodigo('1').ok, true);
    assert.equal(validator.validarCodigo('123456789').ok, true);
    assert.equal(validator.validarCodigo('1234567890').ok, false);
    assert.equal(validator.validarCodigo('AB12').ok, false);
    assert.equal(validator.validarCodigo('').ok, false);
  });

  it('valida preço em centavos exatos', () => {
    assert.deepEqual(validator.validarPreco(10.5), { ok: true, centavos: 1050 });
    assert.equal(validator.validarPreco(28.99).centavos, 2899);
    assert.equal(validator.validarPreco(-1).ok, false);
    assert.equal(validator.validarPreco(10000).ok, false); // > 999.99
  });

  it('valida descrição e remove controles', () => {
    const r = validator.validarDescricao('Frango\r\nDo Dia');
    assert.equal(r.ok, true);
    assert.equal(r.descricao, 'Frango Do Dia');
    assert.equal(validator.validarDescricao('').ok, false);
    // Truncamento legado ocorre no builder (não rejeita na validação)
    assert.equal(validator.validarDescricao('X'.repeat(10), { descricaoMaxLength: 5 }).ok, true);
    assert.equal(validator.truncarDescricaoLegado('X'.repeat(10), { descricaoMaxLength: 5 }), 'XXXXX');
  });

  it('bloqueia path traversal e nomes inválidos', () => {
    assert.throws(() => validator.validarNomeArquivo('../x.TXT'), (e) => e.code === CODES.PATH_TRAVERSAL);
    assert.throws(() => validator.validarNomeArquivo('a/b.TXT'), (e) => e.code === CODES.PATH_TRAVERSAL);
    assert.equal(validator.validarNomeArquivo('CDS.TXT'), 'CDS.TXT');
  });

  it('produto inválido / preço inválido / código inválido', () => {
    assert.equal(validator.validarProduto({ nome: 'X', preco: 1 }, {}).ok, false);
    assert.equal(validator.validarProduto({ plu: '1', nome: 'X', preco: -5 }, {}).ok, false);
    assert.equal(validator.validarProduto({ plu: '1', nome: 'X', preco: 10.5 }, {}).ok, true);
  });
});

describe('MGV6 V1 — Builder', () => {
  it('monta código 9 dígitos, preço e descrição na posição correta', () => {
    const reg = builder.buildProduto({
      plu: '1',
      nome: 'Frango Do Dia Kg',
      preco_venda: 10.5
    }, {});
    assert.equal(reg.length, 320);
    assert.equal(reg.slice(0, 2), '01');
    assert.equal(reg.slice(2, 11), '000000001');
    assert.equal(reg.slice(11, 20), '001050000');
    assert.equal(reg.trimEnd(), '01000000001001050000Frango Do Dia Kg');
  });

  it('reproduz amostras conhecidas (conteúdo lógico + pad 320)', () => {
    const amostras = [
      [{ plu: '1', nome: 'Frango Do Dia Kg', preco: 10.5 }, '01000000001001050000Frango Do Dia Kg'],
      [{ plu: '2', nome: 'Picadinho Kg', preco: 28.99 }, '01000000002002899000Picadinho Kg'],
      [{ plu: '3', nome: 'Costela Bovina Kg', preco: 19.99 }, '01000000003001999000Costela Bovina Kg']
    ];
    for (const [p, expectedLogico] of amostras) {
      const reg = builder.buildProduto(p, {});
      assert.equal(reg.length, 320);
      assert.equal(reg.trimEnd(), expectedLogico);
      assert.ok(/ +$/.test(reg));
    }
  });

  it('rejeita lista vazia', () => {
    assert.throws(() => builder.buildProdutos([], {}), (e) => e.code === CODES.EMPTY_LIST);
  });

  it('RC14.15.9 — PLU é a identidade (vence codigo_balanca e legado)', () => {
    const reg = builder.buildProduto({
      plu: '39',
      codigo_balanca: '99',
      codigo: '100',
      codigo_mgv6: '7',
      nome: 'Teste',
      preco: 1
    }, {});
    assert.equal(reg.slice(2, 11), '000000039');
    assert.equal(reg.length, 320);
  });

  it('RC14.15.9 — sem PLU + so codigo_mgv6 → PLU_REQUIRED', () => {
    assert.throws(
      () => builder.buildProduto({
        codigo_mgv6: '7',
        codigo: '100',
        nome: 'Teste',
        preco: 1,
        integrar_balanca: 1
      }, {}),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });
});

describe('MGV6 V1 — Encoding / CRLF', () => {
  it('WINDOWS-1252 e UTF-8 produzem Buffer', () => {
    const a = encoding.encodeText('Café', 'WINDOWS-1252');
    const b = encoding.encodeText('Café', 'UTF-8');
    assert.ok(Buffer.isBuffer(a));
    assert.ok(Buffer.isBuffer(b));
    assert.equal(a.length, 4);
    assert.ok(b.length >= 4);
  });

  it('CRLF no arquivo gerado', () => {
    const { buffer } = builder.buildProdutos([
      { plu: '1', nome: 'A', preco: 1 }
    ], { encoding: 'WINDOWS-1252', lineEnding: 'CRLF' });
    assert.ok(buffer.includes(Buffer.from('\r\n')));
  });
});

describe('MGV6 V1 — Golden byte-a-byte', () => {
  it('compara fixture expected.TXITENS.TXT', () => {
    const goldenMeta = JSON.parse(fs.readFileSync(GOLDEN_JSON, 'utf8'));
    const expected = fs.readFileSync(GOLDEN_TXT);
    const { buffer, registros } = builder.buildProdutos(goldenMeta.produtos, goldenMeta.config);
    assert.equal(buffer.equals(expected), true, 'golden diverge');
    assert.ok(registros.every((r) => r.length === 320));
  });
});

describe('MGV6 V1 — Exporter', () => {
  it('exporta com arquivo temporário e rename atômico', async () => {
    const folder = path.join(tmpRoot, 'out1');
    fs.mkdirSync(folder, { recursive: true });
    const result = await exporter.exportarProdutos([
      { plu: '1', nome: 'Frango Do Dia Kg', preco: 10.5 },
      { plu: '2', nome: 'Picadinho Kg', preco: 28.99 },
      { plu: '3', nome: 'Costela Bovina Kg', preco: 19.99 }
    ], {
      exportFolder: folder,
      fileName: 'TXITENS.TXT',
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF'
    });
    assert.equal(result.sucesso, true);
    assert.equal(result.status, 'EXPORTADO');
    assert.equal(result.quantidade, 3);
    assert.equal(result.arquivo, 'TXITENS.TXT');
    assert.equal(result.registroLength, 320);
    assert.ok(fs.existsSync(result.caminho));
    assert.equal(fs.existsSync(`${result.caminho}.tmp`), false);
    const expected = fs.readFileSync(GOLDEN_TXT);
    assert.ok(fs.readFileSync(result.caminho).equals(expected));
  });

  it('pasta inexistente / path inválido', async () => {
    await assert.rejects(
      () => exporter.exportarProdutos([{ plu: '1', nome: 'A', preco: 1 }], {
        exportFolder: path.join(tmpRoot, 'nao-existe'),
        fileName: 'TXITENS.TXT'
      }),
      (e) => e.code === CODES.FOLDER_INVALID
    );
  });
});

describe('MGV6 V1 — Launcher', () => {
  it('permanece desligado por padrão (autoLaunch=false)', async () => {
    const r = await launcher.launch({ autoLaunch: false, mgv6Executable: 'C:\\MGV6\\MGV6.exe' });
    assert.equal(r.iniciado, false);
    assert.match(r.motivo, /autoLaunch=false/);
  });

  it('habilitado com executável válido (shell.openPath injetado)', async () => {
    const fakeExe = path.join(tmpRoot, 'MGV6.exe');
    fs.writeFileSync(fakeExe, Buffer.from('MZ'));
    let opened = null;
    const r = await launcher.launch({
      autoLaunch: true,
      mgv6Executable: fakeExe
    }, {
      openPath: async (p) => {
        opened = p;
        return '';
      }
    });
    assert.equal(r.iniciado, true);
    assert.equal(r.metodo, 'shell-execute');
    assert.equal(r.pid, null);
    assert.ok(path.resolve(opened).toLowerCase().endsWith('mgv6.exe'));
  });
});

describe('MGV6 V1 — Repository histórico', () => {
  it('registra e lista histórico sem conteúdo do arquivo', async () => {
    await repo.garantirSchema();
    const id = await repo.registrarExport({
      equipamento_id: 999001,
      arquivo: 'TXITENS.TXT',
      pasta: tmpRoot,
      quantidade_produtos: 3,
      status: 'EXPORTADO',
      tamanho_bytes: 111,
      hash_arquivo: 'abc',
      mgv6_iniciado: false
    });
    assert.ok(id > 0);
    const hist = await repo.listarHistorico({ equipamentoId: 999001, limite: 5 });
    assert.ok(hist.some((h) => h.id === id && h.arquivo === 'TXITENS.TXT'));
    assert.ok(!('conteudo' in (hist[0] || {})));
  });
});
