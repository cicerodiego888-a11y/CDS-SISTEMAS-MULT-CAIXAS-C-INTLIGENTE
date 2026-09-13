/**
 * RC3.6.H — Ocultação temporária da Recuperação pelo Portal Nacional.
 *
 * Executar: npm run test:central-entradas-rc3.6.h
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');
const {
  recuperacaoPortalNacionalHabilitada,
  obterFeatureFlagsPublicas
} = require('../../backend/motores/central-entradas/config/centralFeatureFlags');

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

function carregarUx() {
  const src = fs.readFileSync(
    path.join(__dirname, '../../frontend/erp/js/central-entradas-ux.js'),
    'utf8'
  );
  const sandbox = { window: {}, module: {}, console };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.runInNewContext(src, sandbox);
  return sandbox.CentralEntradasUX || sandbox.window.CentralEntradasUX;
}

async function run() {
  console.log('\nRC3.6.H — Ocultação Portal Nacional + Copiar Chave\n');

  const envAnterior = process.env.RECUPERACAO_PORTAL_NACIONAL;

  await test('feature flag default desativada', () => {
    delete process.env.RECUPERACAO_PORTAL_NACIONAL;
    assert.strictEqual(recuperacaoPortalNacionalHabilitada(), false);
    assert.deepStrictEqual(obterFeatureFlagsPublicas(), { recuperacaoPortalNacional: false });
  });

  await test('feature flag ativa com RECUPERACAO_PORTAL_NACIONAL=true', () => {
    process.env.RECUPERACAO_PORTAL_NACIONAL = 'true';
    assert.strictEqual(recuperacaoPortalNacionalHabilitada(), true);
    assert.strictEqual(obterFeatureFlagsPublicas().recuperacaoPortalNacional, true);
  });

  if (envAnterior == null) {
    delete process.env.RECUPERACAO_PORTAL_NACIONAL;
  } else {
    process.env.RECUPERACAO_PORTAL_NACIONAL = envAnterior;
  }

  await test('evento CHAVE_COPIADA no catálogo', () => {
    assert.strictEqual(TIPOS_EVENTO.CHAVE_COPIADA, 'CHAVE_COPIADA');
  });

  await test('rotas: middleware 403 e chave-copiada', () => {
    const rotas = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/central-entradas.js'),
      'utf8'
    );
    assert.match(rotas, /Funcionalidade temporariamente indisponível/);
    assert.match(rotas, /recuperar-portal-nacional/);
    assert.match(rotas, /chave-copiada/);
    assert.match(rotas, /feature-flags/);
  });

  await test('frontend: guard Portal + botão Copiar Chave', () => {
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/central-entradas.js'),
      'utf8'
    );
    assert.match(mainSrc, /recuperacaoPortalNacionalHabilitadaCentral/);
    assert.match(mainSrc, /Copiar Chave de Acesso/);
    assert.match(mainSrc, /chave-copiada/);
    assert.match(mainSrc, /Chave copiada para a área de transferência/);
  });

  await test('UX: XML_INDISPONIVEL sem Portal mostra Copiar Chave', () => {
    const UX = carregarUx();
    UX.setFeatureFlagsCentral({ recuperacaoPortalNacional: false });
    const acao = UX.resolverProximaAcaoOperacional({
      status: 'XML_INDISPONIVEL',
      chave: CHAVE
    });
    assert.strictEqual(acao.acao, 'copiar-chave');
    assert.strictEqual(acao.label, 'Copiar Chave');
    assert.ok(!acao.label.includes('Portal'));
  });

  await test('UX: flag ativa restaura Portal Nacional', () => {
    const UX = carregarUx();
    UX.setFeatureFlagsCentral({ recuperacaoPortalNacional: true });
    const acao = UX.resolverProximaAcaoOperacional({
      status: 'XML_INDISPONIVEL',
      chave: CHAVE
    });
    assert.strictEqual(acao.acao, 'portal-nfe');
    assert.strictEqual(acao.label, 'Portal Nacional');
  });

  await test('extrair 44 dígitos da chave', () => {
    const digitos = String(` ${CHAVE.slice(0, 22)} ${CHAVE.slice(22)} `).replace(/\D/g, '');
    assert.strictEqual(digitos.length, 44);
    assert.strictEqual(digitos, CHAVE);
  });

  await test('registrarChaveCopiada persiste evento', async () => {
    const eventos = [];
    const historico = [];
    const CentralHistoricoRepository = require('../../backend/motores/central-entradas/repositories/CentralHistoricoRepository');
    const originalInserir = CentralHistoricoRepository.prototype.inserir;
    CentralHistoricoRepository.prototype.inserir = async (ev) => {
      historico.push(ev);
      return { id: historico.length };
    };

    const CentralEventosService = require('../../backend/motores/central-entradas/services/CentralEventosService');
    const originalRegistrar = CentralEventosService.prototype.registrar;
    CentralEventosService.prototype.registrar = async (ev) => {
      eventos.push(ev);
      return { id: eventos.length };
    };

    try {
      const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
      const svc = new CentralEntradasService();
      const r = await svc.registrarChaveCopiada(42, { usuarioId: 7, usuarioNome: 'Teste' });
      assert.strictEqual(r.sucesso, true);
      assert.strictEqual(eventos.length, 1);
      assert.strictEqual(eventos[0].tipo, TIPOS_EVENTO.CHAVE_COPIADA);
      assert.strictEqual(eventos[0].documentoId, 42);
      assert.strictEqual(historico.length, 1);
      assert.match(historico[0].detalhe, /CHAVE_COPIADA/);
    } finally {
      CentralHistoricoRepository.prototype.inserir = originalInserir;
      CentralEventosService.prototype.registrar = originalRegistrar;
    }
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
