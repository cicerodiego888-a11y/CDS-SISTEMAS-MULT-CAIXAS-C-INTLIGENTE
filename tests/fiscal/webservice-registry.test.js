/**
 * Testes — WebServiceRegistry oficial (Sprint F2)
 * Sem chamadas HTTP / SEFAZ.
 *
 * Executar: npm run test:webservice-registry
 *           node tests/fiscal/webservice-registry.test.js
 */

const assert = require('assert');
const {
  WebServiceRegistry,
  WebServiceDefinition,
  createWebServiceDefinition,
  buildDefinitionId,
  RegistryBuilder,
  OFFICIAL_SERVICE_COUNT,
  OperationType,
  isOperationType,
  listOperationTypes,
  getManifestacaoEventoCode,
  ModelType,
  EnvironmentType,
  FiscalWebServices,
  UF_SVRS,
  UF_AN
} = require('../../backend/services/fiscal/core');

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

async function main() {
  console.log('\n=== Testes WebServiceRegistry — Sprint F2 ===\n');

  await test('OFFICIAL_SERVICE_COUNT é 24', async () => {
    assert.strictEqual(OFFICIAL_SERVICE_COUNT, 24);
    assert.strictEqual(RegistryBuilder.getOfficialCount(), 24);
  });

  await test('RegistryBuilder popula quantidade oficial', async () => {
    const registry = RegistryBuilder.buildOfficial();
    assert.strictEqual(registry.size(), OFFICIAL_SERVICE_COUNT);
    assert.strictEqual(registry.isEmpty(), false);
    assert.strictEqual(registry.listActive().length, OFFICIAL_SERVICE_COUNT);
  });

  await test('contratos NFC-e Autorização prod/hom', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const prod = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS
    });
    const hom = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS
    });
    assert.ok(prod);
    assert.ok(hom);
    assert.ok(prod.endpoint.includes('nfce.svrs.rs.gov.br'));
    assert.ok(hom.endpoint.includes('nfce-homologacao.svrs.rs.gov.br'));
    assert.ok(prod.soapAction.includes('nfeAutorizacaoLote'));
    assert.strictEqual(prod.versao, '4.00');
    assert.strictEqual(prod.timeout, 90000);
    assert.strictEqual(prod.tls.minVersion, 'TLSv1.2');
    assert.strictEqual(prod.ativo, true);
  });

  await test('contratos NFC-e Cancelamento', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const def = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.CANCELAMENTO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS
    });
    assert.ok(def);
    assert.ok(def.endpoint.includes('recepcaoevento'));
    assert.ok(def.soapAction.includes('nfeRecepcaoEvento'));
    assert.strictEqual(def.versao, '1.00');
  });

  await test('contratos NF-e Autorização e DF-e', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const nfe = registry.get({
      modelo: ModelType.NFE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS
    });
    const dfe = registry.get({
      modelo: ModelType.NFE,
      operacao: OperationType.DISTRIBUICAO_DFE,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_AN
    });
    assert.ok(nfe.endpoint.includes('nfe.svrs.rs.gov.br'));
    assert.ok(dfe.endpoint.includes('hom1.nfe.fazenda.gov.br'));
    assert.strictEqual(dfe.versao, '1.01');
    assert.ok(dfe.soapAction.includes('nfeDistDFeInteresse'));
  });

  await test('Status e Retorno cadastrados', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const status = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.STATUS_SERVICO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS
    });
    const retorno = registry.get({
      modelo: ModelType.NFCE,
      operacao: OperationType.RETORNO_AUTORIZACAO,
      ambiente: EnvironmentType.HOMOLOGACAO,
      uf: UF_SVRS
    });
    assert.ok(status);
    assert.ok(retorno);
    assert.ok(status.endpoint.includes('NfeStatusServico'));
    assert.ok(retorno.endpoint.includes('NFeRetAutorizacao'));
  });

  await test('Manifestação — 4 tipos × 2 ambientes (AN)', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const ops = [
      OperationType.MANIFESTACAO_CIENCIA,
      OperationType.MANIFESTACAO_CONFIRMACAO,
      OperationType.MANIFESTACAO_DESCONHECIMENTO,
      OperationType.MANIFESTACAO_NAO_REALIZADA
    ];
    for (const operacao of ops) {
      for (const ambiente of [EnvironmentType.PRODUCAO, EnvironmentType.HOMOLOGACAO]) {
        const def = registry.get({
          modelo: ModelType.NFE,
          operacao,
          ambiente,
          uf: UF_AN
        });
        assert.ok(def, `faltou ${operacao}/${ambiente}`);
        assert.ok(def.endpoint.includes('NFeRecepcaoEvento4'));
        assert.ok(def.endpoint.includes('nfe.fazenda.gov.br'));
        assert.strictEqual(def.uf, UF_AN);
        assert.ok(def.observacoes.includes('AN') || def.descricao.includes('Ambiente Nacional'));
      }
    }
    assert.strictEqual(getManifestacaoEventoCode(OperationType.MANIFESTACAO_CONFIRMACAO), '210200');
    assert.strictEqual(getManifestacaoEventoCode(OperationType.MANIFESTACAO_CIENCIA), '210210');
    assert.strictEqual(getManifestacaoEventoCode(OperationType.MANIFESTACAO_DESCONHECIMENTO), '210220');
    assert.strictEqual(getManifestacaoEventoCode(OperationType.MANIFESTACAO_NAO_REALIZADA), '210240');
  });

  await test('WebServiceDefinition valida campos obrigatórios', async () => {
    assert.throws(() => createWebServiceDefinition(null), /inválido/);
    assert.throws(
      () => createWebServiceDefinition({
        modelo: 'XYZ',
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.PRODUCAO,
        uf: 'SVRS',
        endpoint: 'https://x'
      }),
      /modelo inválido/
    );
    assert.throws(
      () => WebServiceDefinition.create({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.PRODUCAO,
        uf: 'SVRS'
      }),
      /endpoint/
    );
  });

  await test('WebServiceDefinition gera id canônico', async () => {
    const def = WebServiceDefinition.create({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: 'svrs',
      endpoint: 'https://exemplo.local/ws',
      soapAction: 'action',
      namespace: 'ns',
      versao: '4.00'
    });
    assert.strictEqual(def.id, 'NFCE-AUTORIZACAO-PRODUCAO-SVRS');
    assert.strictEqual(
      buildDefinitionId({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.PRODUCAO,
        uf: 'SVRS'
      }),
      def.id
    );
    assert.ok(Object.isFrozen(def));
  });

  await test('duplicidade lança erro sem overwrite', async () => {
    const registry = new WebServiceRegistry();
    const payload = {
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente: EnvironmentType.PRODUCAO,
      uf: UF_SVRS,
      endpoint: 'https://exemplo.local/a',
      soapAction: 'a',
      namespace: 'n',
      versao: '4.00'
    };
    registry.register(payload);
    assert.throws(() => registry.register(payload), /duplicidade/);
    registry.register({ ...payload, endpoint: 'https://exemplo.local/b' }, { overwrite: true });
    assert.strictEqual(
      registry.get({
        modelo: ModelType.NFCE,
        operacao: OperationType.AUTORIZACAO,
        ambiente: EnvironmentType.PRODUCAO,
        uf: UF_SVRS
      }).endpoint,
      'https://exemplo.local/b'
    );
  });

  await test('busca getById e find', async () => {
    const registry = RegistryBuilder.buildOfficial();
    const byId = registry.getById('NFCE-AUTORIZACAO-PRODUCAO-SVRS');
    assert.ok(byId);
    assert.strictEqual(byId.operacao, OperationType.AUTORIZACAO);

    const nfceHom = registry.find({
      modelo: ModelType.NFCE,
      ambiente: EnvironmentType.HOMOLOGACAO
    });
    assert.strictEqual(nfceHom.length, 5);

    const dfe = registry.find({ operacao: OperationType.DISTRIBUICAO_DFE, uf: UF_AN });
    assert.strictEqual(dfe.length, 2);
  });

  await test('integridade dos enums OperationType F2', async () => {
    const obrigatorios = [
      'AUTORIZACAO',
      'RETORNO',
      'RETORNO_AUTORIZACAO',
      'STATUS',
      'STATUS_SERVICO',
      'CANCELAMENTO',
      'DISTRIBUICAO_DFE',
      'MANIFESTACAO',
      'MANIFESTACAO_CIENCIA',
      'MANIFESTACAO_CONFIRMACAO',
      'MANIFESTACAO_DESCONHECIMENTO',
      'MANIFESTACAO_NAO_REALIZADA',
      'CONSULTA_PROTOCOLO',
      'INUTILIZACAO'
    ];
    const listados = listOperationTypes().sort();
    assert.deepStrictEqual(listados, [...obrigatorios].sort());
    for (const op of obrigatorios) {
      assert.strictEqual(isOperationType(op), true);
    }
  });

  await test('todas as definições oficiais têm contrato completo', async () => {
    const defs = RegistryBuilder.listOfficialDefinitions();
    assert.strictEqual(defs.length, OFFICIAL_SERVICE_COUNT);
    for (const def of defs) {
      assert.ok(def.id);
      assert.ok(def.endpoint.startsWith('https://'));
      assert.ok(def.soapAction);
      assert.ok(def.namespace);
      assert.ok(def.versao);
      assert.ok(def.timeout > 0);
      assert.ok(def.tls.minVersion);
      assert.ok(Number.isInteger(def.retry));
      assert.ok(def.headers['Content-Type']);
      assert.ok(def.descricao);
      assert.strictEqual(def.ativo, true);
    }
  });

  await test('FiscalWebServices carrega catálogo oficial — F5 parcialmente ativa', async () => {
    const platform = new FiscalWebServices();
    assert.strictEqual(platform.getVersion(), 'F10-autorizacao');
    assert.strictEqual(platform.isActive(), true);
    assert.strictEqual(platform.getRegistry().size(), OFFICIAL_SERVICE_COUNT);
    const status = platform.getStatus();
    assert.strictEqual(status.registryEmpty, false);
    assert.strictEqual(status.officialCount, 24);
    assert.strictEqual(status.transportEnabled, true);
    assert.strictEqual(status.active, true);
  });

  await test('FiscalWebServices pode iniciar sem catálogo', async () => {
    const platform = new FiscalWebServices({ loadOfficialCatalog: false });
    assert.strictEqual(platform.getRegistry().isEmpty(), true);
  });

  await test('populateOfficial em registry vazio', async () => {
    const registry = RegistryBuilder.createEmpty();
    RegistryBuilder.populateOfficial(registry);
    assert.strictEqual(registry.size(), OFFICIAL_SERVICE_COUNT);
    assert.throws(() => RegistryBuilder.populateOfficial(registry), /duplicidade/);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
