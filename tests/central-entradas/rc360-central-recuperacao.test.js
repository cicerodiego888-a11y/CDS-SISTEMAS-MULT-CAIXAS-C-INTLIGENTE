/**
 * RC3.6.0 — Central de Recuperação CDS.
 *
 * Executar: npm run test:central-entradas-rc3.6.0
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

function carregarUi() {
  const src = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/central-recuperacao-xml.js'),
    'utf8'
  );
  const sandbox = {
    window: {},
    document: {
      getElementById: () => null,
      createElement: () => ({
        setAttribute() {},
        classList: { toggle() {} },
        addEventListener() {},
        style: {}
      }),
      body: {
        appendChild() {},
        classList: { toggle() {} }
      }
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.CentralRecuperacaoXml || sandbox.window.CentralRecuperacaoXml;
}

async function run() {
  console.log('\nRC3.6.0 — Central de Recuperação CDS\n');

  await test('catálogo eventos RC3.6.0', () => {
    assert.strictEqual(TIPOS_EVENTO.CENTRAL_RECUPERACAO_ABERTA, 'CENTRAL_RECUPERACAO_ABERTA');
    assert.strictEqual(TIPOS_EVENTO.PORTAL_CONSULTA_INICIADA, 'PORTAL_CONSULTA_INICIADA');
    assert.strictEqual(TIPOS_EVENTO.DOWNLOAD_DETECTADO, 'DOWNLOAD_DETECTADO');
    assert.strictEqual(TIPOS_EVENTO.DOCUMENTO_RECUPERADO, 'DOCUMENTO_RECUPERADO');
  });

  await test('módulo UI carrega e formata chave readonly', () => {
    const UI = carregarUi();
    assert.ok(UI);
    assert.ok(typeof UI.abrir === 'function');
    assert.ok(typeof UI.renderBody === 'function');
    const fmt = UI.formatarChave(CHAVE);
    assert.match(fmt, /3526 0112/);
    assert.strictEqual(fmt.replace(/\D/g, '').length, 44);
  });

  await test('tela renderiza infos e chave readonly', () => {
    const UI = carregarUi();
    UI.abrir({
      id: 1,
      chave: CHAVE,
      fornecedor: 'Fornecedor Teste',
      numero: '77',
      serie: '1',
      dataEmissao: '2026-01-15',
      valor: 100,
      status: 'XML_INDISPONIVEL',
      origem: 'Central de Entradas'
    });
    const html = UI.renderBody();
    assert.match(html, /Recuperação|Fornecedor Teste|XML indisponível/);
    assert.match(html, /readonly/);
    assert.match(html, /centralRecuperacaoChave/);
    assert.match(html, /Consultar no Portal Nacional/);
    assert.doesNotMatch(html, /contenteditable="true"/);
  });

  await test('barra de progresso e etapas', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE, status: 'XML_INDISPONIVEL' });
    UI.iniciarConsulta();
    UI.definirEtapa('portal', 'Abrindo Portal…');
    const html = UI.renderEtapas();
    assert.match(html, /central-recuperacao-assistente-lista/);
    assert.match(html, /Abrindo Portal Nacional/);
  });

  await test('footer com botões Cancelar e Consultar', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE, status: 'XML_INDISPONIVEL' });
    const footer = UI.renderFooter();
    assert.match(footer, /Cancelar/);
    assert.match(footer, /Consultar no Portal Nacional/);
    assert.match(footer, /centralRecuperacaoBtnConsultar/);
  });

  await test('registrarCentralRecuperacaoAberta emite evento', async () => {
    const eventos = [];
    const historico = [];
    const svc = new PortalNfeRecoveryService({
      documentosRepository: {
        async buscarPorId(id) {
          return { id: Number(id), status: 'XML_INDISPONIVEL', chave: CHAVE };
        }
      },
      historicoRepository: { async inserir(row) { historico.push(row); } },
      emitirEvento: async (ev) => { eventos.push(ev); }
    });
    await svc.registrarCentralRecuperacaoAberta(10, { chave: CHAVE, usuarioId: 1 });
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.CENTRAL_RECUPERACAO_ABERTA));
    assert.strictEqual(historico.length, 1);
  });

  await test('registrarConsultaPortalIniciada emite antes do Portal', async () => {
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
    await svc.registrarConsultaPortalIniciada(10, { chave: CHAVE });
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.PORTAL_CONSULTA_INICIADA));
  });

  await test('registrarDownloadDetectado emite DOWNLOAD_DETECTADO', async () => {
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
    await svc.registrarDownloadDetectado(10, { nomeArquivo: 'nfe.xml' });
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.DOWNLOAD_DETECTADO));
  });

  await test('frontend integra Central antes do Portal', () => {
    const main = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    assert.match(main, /abrirCentralRecuperacaoXml/);
    assert.match(main, /consultarPortalNacionalViaCentralRecuperacao/);
    assert.match(main, /central-aberta/);
    assert.match(main, /consulta-iniciada/);
    assert.match(main, /CentralRecuperacaoXml/);
  });

  await test('rotas RC3.6.0 registradas', () => {
    const rotas = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/central-entradas.js'),
      'utf8'
    );
    assert.match(rotas, /central-aberta/);
    assert.match(rotas, /consulta-iniciada/);
    assert.match(rotas, /download-detectado/);
  });

  await test('script e CSS da Central de Recuperação presentes', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '../../frontend/css/central-entradas-ux1.css'),
      'utf8'
    );
    const app = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/app.js'), 'utf8');
    assert.match(css, /central-recuperacao-overlay/);
    assert.match(app, /central-recuperacao-xml\.js/);
    assert.ok(fs.existsSync(path.join(__dirname, '../../frontend/erp/js/central-recuperacao-xml.js')));
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
