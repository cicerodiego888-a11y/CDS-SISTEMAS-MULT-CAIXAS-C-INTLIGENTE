/**
 * RC4.1 — Refinamento UX Endpoints SEFAZ (apresentação).
 * Valida resolução de Manifestação via UrlResolver no painel (sem alterar Plataforma Fiscal).
 *
 * Executar: npm run test:central-entradas-rc4.1
 */

const assert = require('assert');
const CentralConfiguracaoService = require('../../backend/motores/central-entradas/services/CentralConfiguracaoService');
const CentralConfiguracaoRepository = require('../../backend/motores/central-entradas/repositories/CentralConfiguracaoRepository');

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

function criarRepoMemoria(seed = {}) {
  const store = new Map();
  for (const [chave, valor, tipo] of CentralConfiguracaoRepository.DEFAULTS) {
    store.set(chave, {
      chave,
      valor: seed[chave] != null ? String(seed[chave]) : valor,
      tipo,
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  }
  for (const [chave, valor] of Object.entries(seed)) {
    store.set(chave, {
      chave,
      valor: String(valor),
      tipo: 'string',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
  }
  return {
    ensureDefaults: async () => {},
    listarTodas: async () => [...store.values()],
    salvar: async () => {},
    parseValor: (reg) => {
      if (!reg) return null;
      if (reg.tipo === 'boolean') return reg.valor === 'true' || reg.valor === true;
      if (reg.tipo === 'number') return Number(reg.valor);
      return reg.valor;
    }
  };
}

function criarSyncConfigFake() {
  return {
    obterResumo: async () => ({
      syncAutomaticaHabilitada: true,
      syncIntervaloMinutos: 30,
      syncAoAbrir: true,
      syncMaxDocumentos: 50
    })
  };
}

async function main() {
  console.log('\n=== RC4.1 Endpoints UX ===\n');

  await test('Manifestação Produção/Homologação resolvidas (nunca vazias)', async () => {
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: criarRepoMemoria({
        manifestacao_destinatario_politica: 'MANUAL'
      }),
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: async () => ({
        ambiente: 2,
        uf: 'CE',
        codigoUf: '23'
      })
    });
    const painel = await svc.obterPainelCompleto();
    assert.ok(painel.sefaz.urlManifestacaoProducao.includes('www.nfe.fazenda.gov.br'));
    assert.ok(painel.sefaz.urlManifestacaoProducao.includes('NFeRecepcaoEvento4'));
    assert.ok(painel.sefaz.urlManifestacaoHomologacao.includes('hom1.nfe.fazenda.gov.br'));
    assert.ok(painel.sefaz.urlManifestacaoHomologacao.includes('NFeRecepcaoEvento4'));
    assert.ok(!painel.sefaz.urlManifestacaoProducao.includes('svrs'));
    assert.strictEqual(painel.sefaz.origemEndpointManifestacao, 'UrlResolver');
    assert.strictEqual(painel.sefaz.endpointManifestacaoResolvido, true);
  });

  await test('política Manual → um único estado coerente no painel', async () => {
    const svc = new CentralConfiguracaoService({
      configuracaoRepository: criarRepoMemoria({
        manifestacao_destinatario_politica: 'MANUAL'
      }),
      syncConfigService: criarSyncConfigFake(),
      getFiscalConfig: async () => ({ ambiente: 2, uf: 'CE', codigoUf: '23' })
    });
    const painel = await svc.obterPainelCompleto();
    assert.strictEqual(painel.sefaz.politicaManifestacao, 'MANUAL');
    assert.strictEqual(painel.sefaz.politicaManifestacaoLabel, 'Manual');
    assert.strictEqual(painel.plataformaFiscal.modo, 'Manual');
    assert.strictEqual(painel.sefaz.manifestacaoPreparada, true);
  });

  await test('políticas Automática e Confirmar com labels distintos', async () => {
    for (const [politica, label] of [
      ['AUTOMATICA_CIENCIA', 'Automática'],
      ['CONFIRMAR_OPERADOR', 'Solicitar Confirmação']
    ]) {
      const svc = new CentralConfiguracaoService({
        configuracaoRepository: criarRepoMemoria({
          manifestacao_destinatario_politica: politica
        }),
        syncConfigService: criarSyncConfigFake(),
        getFiscalConfig: async () => ({ ambiente: 1, uf: 'CE', codigoUf: '23' })
      });
      const painel = await svc.obterPainelCompleto();
      assert.strictEqual(painel.sefaz.politicaManifestacao, politica);
      assert.strictEqual(painel.sefaz.politicaManifestacaoLabel, label);
      assert.strictEqual(painel.plataformaFiscal.modo, label);
    }
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
