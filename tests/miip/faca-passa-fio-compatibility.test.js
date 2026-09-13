/**
 * Simulação integrada — FACA × PASSA FIO (Compatibility Guard no Pipeline)
 * Executar: node tests/miip/faca-passa-fio-compatibility.test.js
 */

'use strict';

const assert = require('assert');

const AttributeParser = require('../../backend/motores/miip/utils/AttributeParser');
const CanonicalNormalizer = require('../../backend/motores/miip/utils/CanonicalNormalizer');
const ProductCompatibilityGuard = require('../../backend/motores/miip/utils/ProductCompatibilityGuard');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const { criarEngineExecutor } = require('../../backend/motores/miip/core/MiipPipelineEngineRunner');
const MotorCanonical = require('../../backend/motores/miip/engines/canonical/MotorCanonical');
const MotorAttributeExtractor = require('../../backend/motores/miip/engines/attributes/MotorAttributeExtractor');
const MotorSynonyms = require('../../backend/motores/miip/engines/synonyms/MotorSynonyms');
const MotorSimilarity = require('../../backend/motores/miip/engines/similarity/MotorSimilarity');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
      if (error.stack) console.error(error.stack.split('\n').slice(0, 4).join('\n'));
    });
}

async function main() {
  console.log('\n=== Simulação FACA × PASSA FIO ===\n');
  AttributeParser.reiniciarCacheConfig();
  ProductCompatibilityGuard.reiniciarMetricas();

  const NOME_XML = 'FACA DE ACO INOXIDAVEL COM CABO DE PLASTICO 16" (36 PCS P/ CX)';
  const NOME_CDS = 'Passa Fio com Alma de Aço 20m Cortag';
  const NCM_XML = '82014000';
  const NCM_CDS = '39173900';

  await test('parser extrai tipos corretos', () => {
    const aXml = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(NOME_XML));
    const aCds = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(NOME_CDS));
    assert.strictEqual(String(aXml.tipo?.valor).toUpperCase(), 'FACA');
    assert.strictEqual(String(aCds.tipo?.valor).toUpperCase(), 'PASSA FIO');
  });

  await test('guard bloqueia candidato Passa Fio', () => {
    const aXml = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(NOME_XML));
    const aCds = AttributeParser.extrairAtributos(CanonicalNormalizer.normalizar(NOME_CDS));
    const r = ProductCompatibilityGuard.avaliar({
      itemXml: { produto_nome: NOME_XML, ncm: NCM_XML },
      produtoCds: { nome: NOME_CDS, ncm: NCM_CDS },
      semanticXml: { tipo: aXml.tipo?.valor, material: aXml.material?.valor },
      semanticCds: { tipo: aCds.tipo?.valor, material: aCds.material?.valor, comprimento: aCds.comprimento?.valor }
    });
    assert.strictEqual(r.bloqueado, true);
    assert.ok(r.divergencias.some((d) => d.tipo === 'incompatibilidade_tipo'));
    assert.ok(r.divergencias.some((d) => d.tipo === 'ncm_incompativel'));
  });

  await test('pipeline runner descarta Passa Fio antes da similaridade', async () => {
    const fakeMubc = {
      codigo: 'motor_mubc',
      identificar: async () => [
        MiipCandidate.create({
          produtoId: 999001,
          snapshot: {
            id: 999001,
            nome: NOME_CDS,
            ncm: NCM_CDS,
            toResumo() {
              return { id: 999001, nome: NOME_CDS, ncm: NCM_CDS };
            }
          },
          produto: { id: 999001, nome: NOME_CDS, ncm: NCM_CDS },
          scoreTotal: 70,
          motoresQueVotaram: ['motor_mubc'],
          atributosExtraidos: {
            matchMotivos: ['descricao'],
            motivosRelevancia: ['descricao', 'material']
          },
          evidencias: []
        })
      ],
      obterUltimoDiagnostico: () => ({ mubcExecutado: true, quantidadeCandidatos: 1 })
    };

    const engines = [
      { codigo: 'motor_canonical', prioridade: 10, instancia: new MotorCanonical() },
      { codigo: 'motor_attribute_extractor', prioridade: 20, instancia: new MotorAttributeExtractor() },
      { codigo: 'motor_synonyms', prioridade: 30, instancia: new MotorSynonyms() },
      { codigo: 'motor_mubc', prioridade: 55, instancia: fakeMubc },
      { codigo: 'motor_similarity', prioridade: 60, instancia: new MotorSimilarity() }
    ];

    const executor = criarEngineExecutor();
    const item = {
      produtoNome: NOME_XML,
      produto_nome: NOME_XML,
      ncm: NCM_XML
    };

    const candidatos = await executor(engines, item, { origem: 'teste-compat' });
    const ids = candidatos.map((c) => Number(c.produtoId || c.produto?.id));
    assert.ok(!ids.includes(999001), `Passa Fio ainda presente: ${JSON.stringify(ids)}`);

    const diag = candidatos._meta?.compatibilityDiagnostico;
    assert.ok(diag, 'diagnóstico de compatibilidade ausente');
    assert.ok(Number(diag.quantidadeCandidatosBloqueados) >= 1);
    assert.ok((diag.candidatosBloqueados || []).some((b) => /PASSA FIO|Passa Fio/i.test(b.nome)));
    assert.strictEqual(candidatos.length, 0, 'coleção final deve ficar vazia após hard block');
  });

  console.log(`\nResultado: ${passou} OK, ${falhou} FALHOU\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
