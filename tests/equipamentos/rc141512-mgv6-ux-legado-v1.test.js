/**
 * RC14.15.12 — UX de inicialização MGV6 alinhado ao legado
 * npm run test:mgv6-ux-legado-v1
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const builder = require('../../backend/motores/equipamentos/mgv6/MGV6FileBuilder');
const identity = require('../../backend/motores/equipamentos/mgv6/MGV6IdentityResolver');
const audit = require('../../backend/motores/equipamentos/mgv6/MGV6FileAudit');
const syncService = require('../../backend/motores/equipamentos/mgv6/MGV6SyncService');
const { REGISTRO_LENGTH } = require('../../backend/motores/equipamentos/mgv6/MGV6Configuration');
const { CODES } = require('../../backend/motores/equipamentos/mgv6/MGV6Errors');

const ROOT = path.join(__dirname, '../..');

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-mgv6-141512-'));
});

after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
});

function cfg(folder, extra = {}) {
  return {
    enabled: true,
    exportFolder: folder,
    fileName: 'TXITENS.TXT',
    encoding: 'WINDOWS-1252',
    lineEnding: 'CRLF',
    autoLaunch: false,
    mgv6Executable: '',
    ...extra
  };
}

describe('RC14.15.12 — PLUs e Integrar com balança', () => {
  it('PLU 99 → bloco 000000099', () => {
    const reg = builder.buildRecord({
      nome: 'TESTE CDS SISTEMAS',
      plu: '99',
      integrar_balanca: 1,
      preco: 2.99
    }, {});
    assert.equal(reg.length, REGISTRO_LENGTH);
    assert.equal(reg.substring(2, 11), '000000099');
  });

  it('PLU 39 → bloco 000000039', () => {
    const reg = builder.buildRecord({
      nome: 'Milho Grão Kg',
      plu: '39',
      integrar_balanca: 1,
      preco: 2.79
    }, {});
    assert.equal(reg.substring(2, 11), '000000039');
  });

  it('PLU 12746 → bloco 000012746', () => {
    const reg = builder.buildRecord({
      nome: 'Milho Grao',
      plu: '12746',
      integrar_balanca: 1,
      preco: 2.5
    }, {});
    assert.equal(reg.substring(2, 11), '000012746');
  });

  it('Integrar = SIM exporta', async () => {
    const folder = path.join(tmpRoot, 'int-sim');
    fs.mkdirSync(folder, { recursive: true });
    const r = await syncService.syncProdutos(141512, [{
      nome: 'TESTE',
      plu: '99',
      integrar_balanca: 1,
      preco: 1
    }], {
      obterModoEnvio: async () => 'MGV6',
      pularChecagemEquipamento: true,
      obterConfig: async () => cfg(folder),
      autoLaunch: false
    });
    assert.equal(r.quantidade, 1);
    assert.equal(r.transmitidoBalanca, false);
  });

  it('Integrar = NÃO não exporta', () => {
    const { resolvidos, excluidos } = identity.resolverLista([{
      nome: 'X',
      plu: '99',
      integrar_balanca: 0
    }]);
    assert.equal(resolvidos.length, 0);
    assert.equal(excluidos.length, 1);
  });
});

describe('RC14.15.12 — decisão do usuário e EXE', () => {
  it('usuário SIM → iniciarMgv6 abre via shell-execute', async () => {
    const folder = path.join(tmpRoot, 'sim');
    fs.mkdirSync(folder, { recursive: true });
    const fakeExe = path.join(folder, 'MGV6.exe');
    fs.writeFileSync(fakeExe, Buffer.from('MZ'));
    let launched = null;
    const r = await syncService.iniciarMgv6(141512, {
      obterConfig: async () => cfg(folder, { mgv6Executable: fakeExe }),
      launch: async (c) => {
        launched = { path: c.mgv6Executable, autoLaunch: c.autoLaunch };
        return {
          iniciado: true,
          sucesso: true,
          metodo: 'shell-execute',
          pid: null,
          path: c.mgv6Executable,
          motivo: null
        };
      }
    });
    assert.equal(r.iniciado, true);
    assert.equal(r.sucesso, true);
    assert.equal(r.metodo, 'shell-execute');
    assert.equal(r.pid, null);
    assert.equal(r.transmitidoBalanca, false);
    assert.equal(launched.autoLaunch, true);
    assert.match(r.aviso, /manualmente no MGV6/i);
    assert.doesNotMatch(r.aviso, /enviado para a balança/i);
  });

  it('usuário NÃO → sync com autoLaunch=false não inicia', async () => {
    const folder = path.join(tmpRoot, 'nao');
    fs.mkdirSync(folder, { recursive: true });
    const fakeExe = path.join(folder, 'MGV6.exe');
    fs.writeFileSync(fakeExe, Buffer.from('MZ'));
    let launchCalled = false;
    const r = await syncService.syncProdutos(141512, [{
      nome: 'TESTE',
      plu: '99',
      integrar_balanca: 1,
      preco: 1
    }], {
      obterModoEnvio: async () => 'MGV6',
      pularChecagemEquipamento: true,
      obterConfig: async () => cfg(folder, { mgv6Executable: fakeExe }),
      autoLaunch: false,
      launch: async () => {
        launchCalled = true;
        return { iniciado: true, pid: 1, path: fakeExe };
      }
    });
    assert.equal(launchCalled, false);
    assert.equal(r.mgv6.iniciado, false);
    assert.equal(r.mgv6.encontrado, true);
    assert.equal(r.mgv6.aguardandoUsuario, true);
  });

  it('MGV6.exe encontrado → encontrado=true', async () => {
    const folder = path.join(tmpRoot, 'found');
    fs.mkdirSync(folder, { recursive: true });
    const fakeExe = path.join(folder, 'MGV6.exe');
    fs.writeFileSync(fakeExe, Buffer.from('MZ'));
    const r = await syncService.syncProdutos(141512, [{
      nome: 'TESTE',
      plu: '39',
      integrar_balanca: 1,
      preco: 2.79
    }], {
      obterModoEnvio: async () => 'MGV6',
      pularChecagemEquipamento: true,
      obterConfig: async () => cfg(folder, { mgv6Executable: fakeExe }),
      autoLaunch: false
    });
    assert.equal(r.mgv6.encontrado, true);
    assert.equal(r.mgv6.path, path.resolve(fakeExe));
  });

  it('MGV6.exe inexistente → não inicia; TXITENS ok', async () => {
    const folder = path.join(tmpRoot, 'missing');
    fs.mkdirSync(folder, { recursive: true });
    const r = await syncService.syncProdutos(141512, [{
      nome: 'TESTE',
      plu: '12746',
      integrar_balanca: 1,
      preco: 2.5
    }], {
      obterModoEnvio: async () => 'MGV6',
      pularChecagemEquipamento: true,
      obterConfig: async () => cfg(folder, {
        mgv6Executable: path.join(folder, 'nao-existe.exe')
      }),
      autoLaunch: false
    });
    assert.equal(r.sucesso, true);
    assert.equal(r.mgv6.encontrado, false);
    assert.equal(r.mgv6.iniciado, false);
    assert.equal(r.mgv6.aguardandoUsuario, false);
    assert.match(r.aviso, /não encontrado/i);
    assert.ok(fs.existsSync(r.caminho));
    assert.ok(r.validacao?.ok);
  });
});

describe('RC14.15.12 — TXITENS válido / inválido', () => {
  it('TXITENS válido passa na auditoria', async () => {
    const folder = path.join(tmpRoot, 'ok-txt');
    fs.mkdirSync(folder, { recursive: true });
    const r = await syncService.syncProdutos(141512, [{
      nome: 'TESTE CDS SISTEMAS',
      plu: '99',
      integrar_balanca: 1,
      preco: 2.99
    }], {
      obterModoEnvio: async () => 'MGV6',
      pularChecagemEquipamento: true,
      obterConfig: async () => cfg(folder),
      autoLaunch: false
    });
    const v = audit.validarArquivoTxitensGerado(r.caminho, {
      quantidadeEsperada: 1,
      plusEsperados: ['99']
    });
    assert.equal(v.ok, true);
    assert.equal(v.plusExportados[0], '000099');
  });

  it('TXITENS inválido falha antes do launch', () => {
    const folder = path.join(tmpRoot, 'bad-txt');
    fs.mkdirSync(folder, { recursive: true });
    const caminho = path.join(folder, 'TXITENS.TXT');
    fs.writeFileSync(caminho, Buffer.from('BAD'));
    assert.throws(
      () => audit.validarArquivoTxitensGerado(caminho, { quantidadeEsperada: 1 }),
      (e) => e.code === CODES.FILE_INVALID || e.code === CODES.RECORD_SIZE_INVALID
    );
  });
});

describe('RC14.15.12 — UI legado e barreiras', () => {
  it('UI pergunta "Deseja iniciar o software da balança?" sem detalhes técnicos no diálogo', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'frontend/erp/js/enviar-produtos-balanca.js'),
      'utf8'
    );
    assert.match(src, /Deseja iniciar o software da balança\?/);
    assert.match(src, />Aviso</);
    assert.match(src, /epbBtnMgv6Sim/);
    assert.match(src, /epbBtnMgv6Nao/);
    assert.match(src, /\/equipamentos\/mgv6\/launch/);
    assert.match(src, /autoLaunch:\s*false/);
    assert.match(src, /MGV6 não iniciado pelo usuário/);
    assert.match(src, /A carga da balança é realizada manualmente no MGV6/);
    assert.doesNotMatch(src, /Solicitar Carga das Balanças → Enviar/);
    assert.doesNotMatch(src, /Produto enviado para a balança/);
    assert.doesNotMatch(src, /Carga enviada/);
    // diálogo (título + corpo) sem path/PID/SQL/instruções técnicas
    assert.match(src, /modal-body">Deseja iniciar o software da balança\?<\/div>/);
    assert.doesNotMatch(src, /modal-body">[^<]*(PID|Program Files|TXITENS|SQL|TCP|Solicitar Carga)/i);
  });

  it('Controller export default sem auto-launch + rota /launch', () => {
    const ctrl = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Controller.js'),
      'utf8'
    );
    const routes = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Routes.js'),
      'utf8'
    );
    assert.match(ctrl, /resolverAutoLaunchDoBody/);
    assert.match(ctrl, /return false/);
    assert.match(ctrl, /iniciarMgv6/);
    assert.match(routes, /\/launch/);
  });

  it('nenhuma alteração TCP (arquivos-chave intactos por hash relativo de presença)', () => {
    const tcpFiles = [
      'backend/motores/equipamentos/drivers/toledo/ToledoPrixIVDriver.js',
      'backend/motores/equipamentos/connection/ConnectionManager.js',
      'backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine.js',
      'backend/motores/equipamentos/drivers/toledo/plu/PluController.js'
    ];
    for (const rel of tcpFiles) {
      const abs = path.join(ROOT, rel);
      assert.ok(fs.existsSync(abs), rel);
      const src = fs.readFileSync(abs, 'utf8');
      assert.doesNotMatch(src, /Deseja iniciar o software da balança/);
      assert.doesNotMatch(src, /RC14\.15\.12/);
    }
  });

  it('layout TXITENS permanece 320 (builder inalterado em tamanho)', () => {
    const reg = builder.buildRecord({
      nome: 'LAYOUT',
      plu: '99',
      integrar_balanca: 1,
      preco: 1
    }, {});
    assert.equal(reg.length, 320);
    assert.equal(REGISTRO_LENGTH, 320);
    const builderSrc = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6FileBuilder.js'),
      'utf8'
    );
    assert.doesNotMatch(builderSrc, /RC14\.15\.12/);
  });

  it('Sync/Launcher sem SQL MGV6 e sem afirmação de envio', () => {
    const sync = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6SyncService.js'),
      'utf8'
    );
    const launcher = fs.readFileSync(
      path.join(ROOT, 'backend/motores/equipamentos/mgv6/MGV6Launcher.js'),
      'utf8'
    );
    assert.doesNotMatch(sync, /spAssociaitem|tbItemBalanca|INSERT INTO tbItens/);
    assert.doesNotMatch(sync, /enviado para a balança|Carga enviada|ACK recebido/i);
    assert.doesNotMatch(launcher, /PID: \$\{child\?\.pid \|\| '\?'\}/);
    assert.match(launcher, /shell-execute|shell\.openPath|openPathFn/);
    assert.match(launcher, /A carga da balança é realizada manualmente no MGV6/);
  });
});
