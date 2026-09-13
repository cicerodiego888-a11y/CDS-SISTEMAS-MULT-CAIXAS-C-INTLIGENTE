/**
 * RC3.5.1 — Correção integração Electron + abertura inteligente Portal Nacional.
 *
 * Executar: npm run test:central-entradas-rc3.5.1
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PortalNfeRecoveryService = require('../../backend/motores/central-entradas/services/PortalNfeRecoveryService');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

const CHAVE = '35260112345678000199550010000000771000000077';

async function run() {
  console.log('\nRC3.5.1 — Integração Electron Portal Nacional\n');

  await test('catálogo eventos CHAVE_ENVIADA e CHAVE_COPIADA_AUTOMATICAMENTE', () => {
    assert.strictEqual(TIPOS_EVENTO.CHAVE_ENVIADA, 'CHAVE_ENVIADA');
    assert.strictEqual(TIPOS_EVENTO.CHAVE_COPIADA_AUTOMATICAMENTE, 'CHAVE_COPIADA_AUTOMATICAMENTE');
  });

  await test('electron.js registra handlers Portal Nacional', () => {
    const electronJs = fs.readFileSync(path.join(__dirname, '../../electron.js'), 'utf8');
    assert.match(electronJs, /electron-registrar-portal-nfe/);
    assert.match(electronJs, /registrarPortalNfeHandlers/);
  });

  await test('electron-common usa registrador centralizado', () => {
    const common = fs.readFileSync(path.join(__dirname, '../../electron-common.js'), 'utf8');
    assert.match(common, /electron-registrar-portal-nfe/);
    assert.match(common, /registrarPortalNfeHandlers/);
  });

  await test('preload expõe portal-nfe-status e portal-nfe-download', () => {
    const preload = fs.readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');
    assert.match(preload, /portal-nfe-status/);
    assert.match(preload, /portal-nfe-download/);
    assert.match(preload, /portal-nfe-abrir/);
  });

  await test('electron-portal-nfe: handlers IPC oficiais', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../electron-portal-nfe.js'), 'utf8');
    assert.match(src, /portal-nfe-abrir/);
    assert.match(src, /portal-nfe-fechar/);
    assert.match(src, /portal-nfe-status/);
    assert.match(src, /portal-nfe-download/);
    assert.match(src, /preencherChaveNoPortal/);
    assert.match(src, /setWindowOpenHandler/);
  });

  await test('script preencher chave contém seletores do Portal', () => {
    const mod = require('../../electron-portal-nfe');
    const script = mod.montarScriptPreencherChave(CHAVE);
    assert.match(script, /txtChaveAcesso/);
    assert.ok(script.includes(CHAVE), 'script deve incluir a chave');
  });

  await test('obterStatusPortal retorna estrutura esperada', () => {
    const mod = require('../../electron-portal-nfe');
    const status = mod.obterStatusPortal();
    assert.strictEqual(typeof status.aberto, 'boolean');
    assert.ok(status.downloadDir);
    assert.ok(status.url);
  });

  await test('registrarPortalAberto emite CHAVE_ENVIADA quando preenchida', async () => {
    const eventos = [];
    const historico = [];
    const svc = new PortalNfeRecoveryService({
      documentosRepository: {
        async buscarPorId(id) {
          return { id: Number(id), status: 'XML_INDISPONIVEL', chave: CHAVE };
        }
      },
      historicoRepository: {
        async inserir(row) { historico.push(row); }
      },
      emitirEvento: async (ev) => { eventos.push(ev); }
    });

    await svc.registrarPortalAberto(1, {
      chave: CHAVE,
      metodoChave: 'preenchida',
      usuarioId: 9
    });

    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.PORTAL_ABERTO));
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.CHAVE_ENVIADA));
    assert.strictEqual(historico.length, 1);
  });

  await test('registrarPortalAberto emite CHAVE_COPIADA quando clipboard', async () => {
    const eventos = [];
    const svc = new PortalNfeRecoveryService({
      documentosRepository: {
        async buscarPorId(id) {
          return { id: Number(id), status: 'XML_INDISPONIVEL', chave: CHAVE };
        }
      },
      historicoRepository: { async inserir() {} },
      emitirEvento: async (ev) => { eventos.push(ev); }
    });

    await svc.registrarPortalAberto(2, {
      chave: CHAVE,
      metodoChave: 'clipboard'
    });

    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.CHAVE_COPIADA_AUTOMATICAMENTE));
  });

  await test('frontend notifica CTRL+V quando chave copiada', () => {
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    assert.match(mainSrc, /CTRL\+V/);
    assert.match(mainSrc, /chavePreenchida/);
    assert.match(mainSrc, /metodoChave/);
  });

  await test('ipcMain mock: handler portal-nfe-abrir registrado', () => {
    const handlers = new Map();
    const ipcMainMock = {
      removeHandler: (ch) => handlers.delete(ch),
      handle: (ch, fn) => handlers.set(ch, fn)
    };
    const mod = require('../../electron-portal-nfe');
    mod.registrarHandlersIpc(ipcMainMock, () => null);
    assert.ok(handlers.has('portal-nfe-abrir'));
    assert.ok(handlers.has('portal-nfe-fechar'));
    assert.ok(handlers.has('portal-nfe-status'));
    assert.ok(handlers.has('portal-nfe-download'));
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
