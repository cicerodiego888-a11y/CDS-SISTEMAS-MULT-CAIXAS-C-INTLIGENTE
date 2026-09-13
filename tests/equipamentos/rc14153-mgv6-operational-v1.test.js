/**
 * RC14.15.3 — Integração operacional MGV6 V1.0
 * npm run test:mgv6-operational-v1
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modoEnvio = require('../../backend/motores/equipamentos/mgv6/MGV6ModoEnvio');
const syncService = require('../../backend/motores/equipamentos/mgv6/MGV6SyncService');
const exporter = require('../../backend/motores/equipamentos/mgv6/MGV6Exporter');
const launcher = require('../../backend/motores/equipamentos/mgv6/MGV6Launcher');
const repo = require('../../backend/motores/equipamentos/mgv6/MGV6Repository');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');
const { MGV6Error } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');

const ROOT = path.join(__dirname, '../..');
let tmpRoot;
let txtPathGerado = null;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-op-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

function cfgBase(folder, extra = {}) {
  return {
    enabled: true,
    exportFolder: folder,
    fileName: 'TXITENS.TXT',
    encoding: 'WINDOWS-1252',
    lineEnding: 'CRLF',
    autoLaunch: false,
    modoVariavel: 'VALOR',
    digitosPlu: 6,
    prefixoEtiqueta: '2',
    diferenciarPesoUnidade: false,
    tipoRegistro: '01',
    codigoDigitos: 9,
    precoCentavosMax: 99999,
    ...extra
  };
}

describe('RC14.15.3 — modo_envio', () => {
  it('default / vazio = TCP', () => {
    assert.equal(modoEnvio.normalizarModoEnvio(undefined), 'TCP');
    assert.equal(modoEnvio.normalizarModoEnvio(''), 'TCP');
    assert.equal(modoEnvio.normalizarModoEnvio('tcp'), 'TCP');
  });

  it('aceita MGV6', () => {
    assert.equal(modoEnvio.normalizarModoEnvio('MGV6'), 'MGV6');
    assert.equal(modoEnvio.normalizarModoEnvio('mgv6'), 'MGV6');
  });

  it('bloqueia upload TCP quando MGV6', () => {
    assert.throws(
      () => modoEnvio.assertPermitidoUploadTcp('MGV6'),
      (e) => e.code === modoEnvio.CODIGO_MODO_MGV6 || e.codigo === modoEnvio.CODIGO_MODO_MGV6
    );
  });

  it('bloqueia export MGV6 quando TCP', () => {
    assert.throws(
      () => modoEnvio.assertPermitidoExportMgv6('TCP'),
      (e) => e instanceof MGV6Error && e.code === CODES.MODO_ENVIO_TCP
    );
  });

  it('permite TCP upload e MGV6 export nos modos corretos', () => {
    assert.doesNotThrow(() => modoEnvio.assertPermitidoUploadTcp('TCP'));
    assert.doesNotThrow(() => modoEnvio.assertPermitidoExportMgv6('MGV6'));
  });
});

describe('RC14.15.3 — sync MGV6 operacional', () => {
  it('modo TCP bloqueia syncProdutos (sem export)', async () => {
    const folder = path.join(tmpRoot, 'block-tcp');
    fs.mkdirSync(folder, { recursive: true });
    await assert.rejects(
      () => syncService.syncProdutos(14153, [{ plu: '1', nome: 'A', preco: 1 }], {
        obterModoEnvio: async () => 'TCP',
        obterConfig: async () => cfgBase(folder),
        pularChecagemEquipamento: true
      }),
      (e) => e.code === CODES.MODO_ENVIO_TCP
    );
    assert.equal(fs.existsSync(path.join(folder, 'TXITENS.TXT')), false);
  });

  it('envio individual MGV6 gera TXT (sem TCP)', async () => {
    const folder = path.join(tmpRoot, 'one');
    fs.mkdirSync(folder, { recursive: true });
    let launchCalled = false;
    const result = await syncService.syncProdutos(14153, [
      { plu: '39', nome: 'Milho em Grao KG', preco: 2.7 }
    ], {
      obterModoEnvio: async () => 'MGV6',
      obterConfig: async () => cfgBase(folder, { autoLaunch: false }),
      pularChecagemEquipamento: true,
      launch: async () => {
        launchCalled = true;
        return { iniciado: false, motivo: 'autoLaunch=false', pid: null };
      }
    });
    assert.equal(result.sucesso, true);
    assert.equal(result.quantidade, 1);
    assert.ok(fs.existsSync(result.caminho));
    txtPathGerado = result.caminho;
    // RC14.15.12 — autoLaunch=false não chama spawn (aguarda usuário)
    assert.equal(launchCalled, false);
    assert.equal(result.mgv6.iniciado, false);
    assert.equal(result.mgv6.aguardandoUsuario, false); // EXE ausente no cfgBase
  });

  it('envio em lote: 1 TXT com 3 registros + histórico', async () => {
    const folder = path.join(tmpRoot, 'lote');
    fs.mkdirSync(folder, { recursive: true });
    const produtos = [
      { plu: '1', nome: 'Frango Do Dia Kg', preco: 10.5 },
      { plu: '2', nome: 'Picadinho Kg', preco: 28.99 },
      { plu: '3', nome: 'Costela Bovina Kg', preco: 19.99 }
    ];
    const result = await syncService.syncProdutos(14153, produtos, {
      obterModoEnvio: async () => 'MGV6',
      obterConfig: async () => cfgBase(folder),
      pularChecagemEquipamento: true,
      launch: async () => ({ iniciado: false, motivo: 'autoLaunch=false', pid: null })
    });
    assert.equal(result.quantidade, 3);
    const content = fs.readFileSync(result.caminho, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 3);
    assert.ok(result.historicoId > 0);
    const hist = await repo.listarHistorico({ equipamentoId: 14153, limite: 10 });
    assert.ok(hist.some((h) => h.id === result.historicoId && h.quantidade_produtos === 3));
  });

  it('autoLaunch=false não inicia EXE', async () => {
    const r = await launcher.launch({ autoLaunch: false, mgv6Executable: 'C:\\MGV6\\MGV6.exe' });
    assert.equal(r.iniciado, false);
  });

  it('autoLaunch=true abre via shell.openPath injetado', async () => {
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
    assert.equal(path.resolve(opened), path.resolve(fakeExe));
  });

  it('erro de pasta inexistente', async () => {
    await assert.rejects(
      () => exporter.exportarProdutos([{ plu: '1', nome: 'A', preco: 1 }], {
        exportFolder: path.join(tmpRoot, 'nao-existe-xyz'),
        fileName: 'TXITENS.TXT'
      }),
      (e) => e.code === CODES.FOLDER_INVALID
    );
  });

  it('erro de configuração incompleta (pasta vazia) no sync MGV6', async () => {
    await assert.rejects(
      () => syncService.syncProdutos(14153, [{ plu: '1', nome: 'A', preco: 1 }], {
        obterModoEnvio: async () => 'MGV6',
        obterConfig: async () => cfgBase(''),
        pularChecagemEquipamento: true
      }),
      (e) => e.code === CODES.FOLDER_INVALID || e.code === CODES.CONFIG_INVALID
    );
  });

  it('erro de EXE inválido com autoLaunch=true (arquivo já exportado)', async () => {
    const folder = path.join(tmpRoot, 'exe-bad');
    fs.mkdirSync(folder, { recursive: true });
    const result = await syncService.syncProdutos(14153, [
      { plu: '1', nome: 'A', preco: 1 }
    ], {
      obterModoEnvio: async () => 'MGV6',
      obterConfig: async () => cfgBase(folder, {
        autoLaunch: true,
        mgv6Executable: path.join(tmpRoot, 'nao-existe.exe')
      }),
      pularChecagemEquipamento: true
    });
    assert.equal(result.sucesso, true);
    // RC14.15.12 — TXITENS permanece válido; EXE ausente não inventa envio
    assert.equal(result.status, 'EXPORTADO');
    assert.equal(result.mgv6.encontrado, false);
    assert.equal(result.mgv6.iniciado, false);
    assert.ok(fs.existsSync(result.caminho));
  });
});

describe('RC14.15.3 — barreiras de código (fonte)', () => {
  it('PluController bloqueia MGV6 antes de ConnectionManager', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/drivers/toledo/plu/PluController.js'),
      'utf8'
    );
    assert.match(src, /garantirModoTcp/);
    assert.match(src, /MODO_ENVIO_MGV6|CODIGO_MODO_MGV6|modoEnvio/);
    const idxGuard = src.indexOf('garantirModoTcp');
    const idxConnect = src.indexOf('connectionManager.connect');
    assert.ok(idxGuard > 0 && idxConnect > idxGuard, 'guard deve vir antes do connect');
  });

  it('enviar-produtos-balanca.js separa TCP e MGV6', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/enviar-produtos-balanca.js'),
      'utf8'
    );
    assert.match(src, /epbEnviarSelecionadosMGV6/);
    assert.match(src, /epbEnviarSelecionadosTCP/);
    assert.match(src, /\/equipamentos\/mgv6\/export/);
    const mgv6Fn = src.slice(src.indexOf('async function epbEnviarSelecionadosMGV6'));
    const mgv6Body = mgv6Fn.slice(0, mgv6Fn.indexOf('async function epbEnviarSelecionados'));
    assert.doesNotMatch(mgv6Body, /upload-plus/);
    assert.doesNotMatch(mgv6Body, /\/connect/);
  });

  it('produtos.js respeita modo_envio', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/produtos.js'), 'utf8');
    assert.match(src, /obterModoEnvioEquipamentoProduto/);
    assert.match(src, /mgv6\/export/);
    assert.match(src, /upload-produto/);
  });

  it('UI cadastro expõe Método de Envio TCP|MGV6', () => {
    const src = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/equipamentos.js'), 'utf8');
    assert.match(src, /Método de Envio/);
    assert.match(src, /modoEnvioTcp/);
    assert.match(src, /modoEnvioMgv6/);
    assert.match(src, /modo_envio/);
  });

  it('MGV6 não é Driver (sem DriverRegistry)', () => {
    const idx = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/index.js'),
      'utf8'
    );
    assert.doesNotMatch(idx, /DriverRegistry/);
    assert.doesNotMatch(idx, /MGV6Driver/);
  });
});

describe('RC14.15.3 — evidência TXT', () => {
  it('registra caminho real do TXT gerado no teste', () => {
    assert.ok(txtPathGerado, 'TXT deveria ter sido gerado no teste individual');
    assert.ok(fs.existsSync(txtPathGerado));
    // eslint-disable-next-line no-console
    console.log('[RC14.15.3] TXT gerado:', txtPathGerado);
  });
});
