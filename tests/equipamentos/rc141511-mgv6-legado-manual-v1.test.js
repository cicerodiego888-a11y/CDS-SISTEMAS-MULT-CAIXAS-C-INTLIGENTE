/**
 * RC14.15.11 — Fluxo MGV6 legado manual
 * npm run test:mgv6-legado-manual-v1
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
const audit = require('../../backend/motores/equipamentos/mgv6/MGV6FileAudit');
const syncService = require('../../backend/motores/equipamentos/mgv6/MGV6SyncService');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');
const { REGISTRO_LENGTH } = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');

const ROOT = path.join(__dirname, '../..');

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-141511-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

describe('RC14.15.11 — testes funcionais PLU', () => {
  it('A. Milho PLU 39 → 000000039', () => {
    const reg = builder.buildRecord({
      codigo: '012841',
      nome: 'Milho Grão Kg',
      plu: '39',
      integrar_balanca: 1,
      preco: 2.79
    }, {});
    assert.equal(reg.substring(2, 11), '000000039');
    assert.equal(reg.length, REGISTRO_LENGTH);
  });

  it('B. TESTE CDS SISTEMAS PLU 99 → 000000099', () => {
    const reg = builder.buildRecord({
      codigo: '99',
      nome: 'TESTE CDS SISTEMAS',
      plu: '99',
      integrar_balanca: 1,
      preco: 2.99
    }, {});
    assert.equal(reg.substring(2, 11), '000000099');
    assert.equal(identity.resolverIdentidade({
      nome: 'TESTE CDS SISTEMAS',
      plu: '99',
      integrar_balanca: 1
    }).cccccc, '000099');
  });

  it('C. Milho Grao PLU 12746 → 000012746', () => {
    const reg = builder.buildRecord({
      nome: 'Milho Grao',
      plu: '12746',
      integrar_balanca: 1,
      preco: 2.5
    }, {});
    assert.equal(reg.substring(2, 11), '000012746');
  });

  it('D. Sem PLU → PLU_REQUIRED', () => {
    assert.throws(
      () => identity.resolverIdentidade({
        nome: 'X',
        integrar_balanca: 1,
        codigo: '99',
        codigo_barras: '789'
      }),
      (e) => e.code === CODES.PRODUCT_PLU_REQUIRED
    );
  });

  it('E. Integrar = NÃO → não exporta', () => {
    const { resolvidos, excluidos } = identity.resolverLista([{
      nome: 'X',
      plu: '99',
      integrar_balanca: 0
    }]);
    assert.equal(resolvidos.length, 0);
    assert.equal(excluidos.length, 1);
  });
});

describe('RC14.15.11 — validação pré-launch + sync', () => {
  it('valida TXITENS 320+CRLF e PLU antes de launch', async () => {
    const folder = path.join(tmpRoot, 'v1');
    fs.mkdirSync(folder, { recursive: true });
    const produto = {
      codigo: '99',
      nome: 'TESTE CDS SISTEMAS',
      plu: '99',
      integrar_balanca: 1,
      preco: 2.99
    };
    const exp = await exporter.exportarProdutos([produto], {
      exportFolder: folder,
      fileName: 'TXITENS.TXT',
      encoding: 'WINDOWS-1252',
      lineEnding: 'CRLF',
      autoLaunch: false
    });
    const v = audit.validarArquivoTxitensGerado(exp.caminho, {
      quantidadeEsperada: 1,
      plusEsperados: ['99']
    });
    assert.equal(v.ok, true);
    assert.equal(v.registros, 1);
    assert.equal(v.plusExportados[0], '000099');
    assert.equal(v.blocos9[0], '000000099');
  });

  it('arquivo inválido falha na auditoria (pré-requisito do launch)', () => {
    const folder = path.join(tmpRoot, 'bad');
    fs.mkdirSync(folder, { recursive: true });
    const caminho = path.join(folder, 'TXITENS.TXT');
    fs.writeFileSync(caminho, Buffer.from('INVALID'));
    assert.throws(
      () => audit.validarArquivoTxitensGerado(caminho, { quantidadeEsperada: 1 }),
      (e) => e.code === CODES.FILE_INVALID || e.code === CODES.RECORD_SIZE_INVALID
    );
    const syncSrc = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6SyncService.js'),
      'utf8'
    );
    const idxAudit = syncSrc.indexOf('validarArquivoTxitensGerado');
    const idxLaunch = syncSrc.indexOf('launchFn(');
    assert.ok(idxAudit > 0 && idxLaunch > idxAudit, 'validação deve ocorrer antes do launch');
  });

  it('sync com autoLaunch=false orienta carga manual e não declara transmissão', async () => {
    const folder = path.join(tmpRoot, 'ok');
    fs.mkdirSync(folder, { recursive: true });
    const fakeExe = path.join(folder, 'MGV6.exe');
    fs.writeFileSync(fakeExe, Buffer.from('MZ'));
    const result = await syncService.syncProdutos(141511, [{
      codigo: '99',
      nome: 'TESTE CDS SISTEMAS',
      plu: '99',
      integrar_balanca: 1,
      preco: 2.99
    }], {
      obterModoEnvio: async () => 'MGV6',
      pularChecagemEquipamento: true,
      obterConfig: async () => ({
        enabled: true,
        exportFolder: folder,
        fileName: 'TXITENS.TXT',
        encoding: 'WINDOWS-1252',
        lineEnding: 'CRLF',
        autoLaunch: false,
        mgv6Executable: fakeExe
      })
    });
    assert.equal(result.sucesso, true);
    assert.equal(result.transmitidoBalanca, false);
    assert.match(result.aviso || result.orientacaoOperador, /manualmente no MGV6/i);
    assert.doesNotMatch(result.aviso || '', /enviado para a balança/i);
    assert.equal(result.plusExportados[0], '000099');
    assert.ok(result.validacao?.ok);
    assert.equal(result.mgv6.encontrado, true);
    assert.equal(result.mgv6.aguardandoUsuario, true);
  });
});

describe('RC14.15.11 — UI / erro modo', () => {
  it('enviar-produtos usa __epbModoEnvio (não ReferenceError modo)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/enviar-produtos-balanca.js'),
      'utf8'
    );
    assert.match(src, /__epbModoEnvio === 'MGV6'/);
    assert.doesNotMatch(src, /const okMsg = modo ===/);
    assert.doesNotMatch(src, /Aguardando importação\/carga pelo MGV6/);
    assert.match(src, /Deseja iniciar o software da balança/);
    assert.match(src, /A carga da balança é realizada manualmente no MGV6/);
    assert.doesNotMatch(src, /Produto enviado para a balança/);
  });

  it('Launcher sem argumentos fictícios / Sync sem SQL MGV6', () => {
    const launcher = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Launcher.js'),
      'utf8'
    );
    assert.match(launcher, /shell\.openPath|openPathFn|shell-execute/);
    const sync = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6SyncService.js'),
      'utf8'
    );
    assert.doesNotMatch(sync, /spAssociaitem|tbItemBalanca|INSERT INTO tbItens/);
    assert.doesNotMatch(sync, /require\(['"].*ConnectionManager/);
  });
});
