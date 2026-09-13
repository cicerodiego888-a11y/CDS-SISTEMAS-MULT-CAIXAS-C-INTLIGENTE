/**
 * RC3.6.1 — Assistente de Recuperação CDS.
 *
 * Executar: npm run test:central-entradas-rc3.6.1
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
      body: { appendChild() {}, classList: { toggle() {} } }
    },
    console
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.CentralRecuperacaoXml || sandbox.window.CentralRecuperacaoXml;
}

async function run() {
  console.log('\nRC3.6.1 — Assistente de Recuperação CDS\n');

  await test('catálogo eventos RC3.6.1', () => {
    assert.strictEqual(TIPOS_EVENTO.RECUPERACAO_INICIADA, 'RECUPERACAO_INICIADA');
    assert.strictEqual(TIPOS_EVENTO.IMPORTACAO_INICIADA, 'IMPORTACAO_INICIADA');
    assert.strictEqual(TIPOS_EVENTO.RECUPERACAO_FINALIZADA, 'RECUPERACAO_FINALIZADA');
  });

  await test('10 etapas do assistente com percentuais', () => {
    const UI = carregarUi();
    assert.strictEqual(UI.ETAPAS.length, 10);
    assert.strictEqual(UI.ETAPAS[0].id, 'portal');
    assert.strictEqual(UI.ETAPAS[9].percentual, 100);
  });

  await test('etapas atualizam e percentual acompanha', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE, status: 'XML_INDISPONIVEL' });
    UI.iniciarConsulta();
    UI.definirEtapa('portal', 'Abrindo Portal…');
    UI.concluirEtapa('portal', 'Portal aberto.');
    UI.definirEtapa('download', 'Aguardando download…');
    const st = UI.obterEstado();
    assert.strictEqual(st.etapasStatus.portal, 'concluido');
    assert.strictEqual(st.etapasStatus.download, 'executando');
    assert.strictEqual(st.percentual, 20);
  });

  await test('log técnico registra eventos', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE });
    UI.registrarLog('Portal aberto', 'OK');
    UI.registrarLog('Download detectado', 'nfe.xml');
    const st = UI.obterEstado();
    assert.strictEqual(st.logTecnico.length, 3);
    assert.match(st.logTecnico[1].evento, /Portal aberto/);
  });

  await test('histórico de tentativas preservado no retry', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE });
    UI.registrarTentativaFalha('Download cancelado');
    UI.reiniciarFluxo();
    const st = UI.obterEstado();
    assert.strictEqual(st.tentativas.length, 1);
    assert.strictEqual(st.tentativaAtual, 2);
    assert.strictEqual(st.aberto, true);
  });

  await test('falha marca etapa vermelha', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE });
    UI.iniciarConsulta();
    UI.definirEtapa('download', 'Download cancelado.', { erro: true });
    const html = UI.renderBody();
    assert.match(html, /is-erro/);
    assert.match(html, /Download cancelado/);
  });

  await test('footer exibe Tentar Novamente e Abrir Pasta', () => {
    const UI = carregarUi();
    UI.abrir({ id: 1, chave: CHAVE });
    UI.iniciarConsulta();
    UI.setXmlDownload('C:\\tmp\\nfe.xml', 'nfe.xml');
    UI.definirEtapa('download', 'Erro', { erro: true });
    const footer = UI.renderFooter();
    assert.match(footer, /Tentar Novamente/);
    assert.match(footer, /Abrir Pasta do XML/);
  });

  await test('registrarConsultaPortalIniciada emite RECUPERACAO_INICIADA', async () => {
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
    await svc.registrarConsultaPortalIniciada(1, { chave: CHAVE });
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.RECUPERACAO_INICIADA));
  });

  await test('frontend integra assistente e retry', () => {
    const main = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    assert.match(main, /registrarLog/);
    assert.match(main, /registrarTentativaFalha/);
    assert.match(main, /PORTAL_FECHADO/);
    assert.match(main, /centralRecuperacaoBtnRetry/);
    assert.match(main, /iniciarConsulta/);
  });

  await test('preload expõe abrirPasta', () => {
    const preload = fs.readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');
    assert.match(preload, /portal-nfe-abrir-pasta/);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
