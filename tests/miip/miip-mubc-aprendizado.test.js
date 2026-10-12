/**
 * Testes RC9.3 — Auto-aprendizado + regressão limiares
 * Executar: npm run test:miip-mubc-aprendizado
 */

const assert = require('assert');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const MiipLearningService = require('../../backend/motores/miip/services/MiipLearningService');

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
    });
}

async function main() {
  console.log('\n=== Testes RC9.3 aprendizado auto ===\n');

  await test('Sprint 2.4 — _aprenderAutoVinculo em AUTO_VINCULAR não grava, só sugere', async () => {
    const calls = [];
    const learning = {
      async registrarConfirmacao(dados) {
        calls.push(dados);
        return { sucesso: true, gravado: true, associacaoId: 99, motivo: null };
      }
    };
    const svc = new MiipService({
      learningService: learning,
      inicializar: () => {},
      featureFlags: {
        estaHabilitado: () => true,
        estaImportacaoXmlHabilitada: () => true,
        sincronizarDoBanco: async () => {},
        obterEstado: () => ({ usarMiip: true }),
        obterUsarMiipImportacaoXML: () => true
      }
    });

    const result = await svc._aprenderAutoVinculo(
      {
        fornecedorCnpj: '12345678000199',
        codigoFornecedor: 'ABC',
        codigoBarras: '7891111111111',
        produtoNome: 'Teste',
        ncm: '1234',
        unidade: 'UN'
      },
      {
        requestId: 'op-1',
        decisao: {
          acao: MiipAction.AUTO_VINCULAR,
          melhorCandidato: {
            produtoId: 10,
            motoresQueVotaram: ['motor_gtin']
          }
        },
        candidatos: [{ produtoId: 10, scoreTotal: 100, motoresQueVotaram: ['motor_gtin'] }]
      },
      { origem: 'compra' }
    );

    assert.strictEqual(result.gravado, false);
    assert.strictEqual(calls.length, 0, 'identificação automática não chama o aprendizado');
    assert.strictEqual(result.requerConfirmacaoManual, true);
    assert.strictEqual(result.motivo, 'aprendizado_requer_confirmacao_manual');
    assert.deepStrictEqual(result.sugestaoMapeamento, {
      produtoId: 10,
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'ABC',
      criterio: null
    });
  });

  await test('_aprenderAutoVinculo ignora não-auto', async () => {
    const learning = {
      async registrarConfirmacao() {
        throw new Error('não deveria chamar');
      }
    };
    const svc = new MiipService({
      learningService: learning,
      inicializar: () => {},
      featureFlags: {
        estaHabilitado: () => true,
        sincronizarDoBanco: async () => {},
        obterEstado: () => ({ usarMiip: true }),
        obterUsarMiipImportacaoXML: () => true,
        estaImportacaoXmlHabilitada: () => true
      }
    });
    const r = await svc._aprenderAutoVinculo(
      { fornecedorCnpj: '1', codigoFornecedor: '2' },
      { decisao: { acao: MiipAction.CRIAR_NOVO }, candidatos: [] },
      {}
    );
    assert.strictEqual(r.gravado, false);
  });

  await test('Sprint 2.4 — Learning auto_* é rejeitado e não substitui associação conflitante', async () => {
    const escritas = [];
    const repo = {
      async buscarAssociacao() {
        return { id: 1, produtoId: 5, status: 'ativa' };
      },
      async desativarAssociacao(id) { escritas.push(['desativar', id]); return true; },
      async salvarAssociacao(dados) {
        escritas.push(['salvar', dados]);
        return { id: 2, ...dados };
      }
    };
    const svc = new MiipLearningService({
      associacoesRepository: repo,
      produtoRepository: { async buscarPorId(id) { return { id, ativo: 1 }; } }
    });
    const r = await svc.registrarConfirmacao({
      confirmado: true,
      produtoId: 10,
      fornecedorCnpj: '12345678000199',
      codigoFornecedor: 'X1',
      origem: 'auto_motor_gtin'
    });
    assert.strictEqual(r.gravado, false);
    assert.strictEqual(r.rejeitado, true);
    assert.strictEqual(r.motivo, 'aprendizado_automatico_nao_permitido');
    assert.strictEqual(escritas.length, 0);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
