/**
 * Testes — Central de Revisão MIIP (Sprint 6B)
 * Executar: npm run test:miip-central-revisao
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const utils = require('../../backend/motores/miip/utils/miipCentralRevisaoUtils');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  try {
    fn();
    passou += 1;
    console.log(`  OK  ${nome}`);
  } catch (error) {
    falhou += 1;
    console.error(`  FALHOU  ${nome}`);
    console.error(`         ${error.message}`);
  }
}

function criarResultado(opcoes = {}) {
  return {
    indice: opcoes.indice ?? 0,
    produtoXML: { produto_nome: opcoes.nome || `Item ${opcoes.indice ?? 0}` },
    produtoEncontrado: opcoes.produtoEncontrado ?? null,
    score: opcoes.score ?? 0,
    precisaConfirmacao: Boolean(opcoes.precisaConfirmacao),
    precisaCadastro: Boolean(opcoes.precisaCadastro),
    motor: opcoes.motor ?? null,
    candidatoSelecionado: opcoes.candidatoSelecionado ?? null
  };
}

function criarImportacao(opcoes = {}) {
  const resultados = opcoes.resultados || [];
  return {
    chave_acesso: 'CHAVE123',
    fornecedor: 'Fornecedor X',
    fornecedor_cnpj: '12345678000199',
    itens: resultados.map((r, i) => ({
      produto_nome: r.produtoXML?.produto_nome || `Item ${i}`,
      codigo_fornecedor: `C${i}`,
      quantidade: 1,
      preco_unitario: 10
    })),
    miip_importacao: {
      usarMiipImportacaoXML: true,
      resultados,
      resumo: {
        totalItens: resultados.length,
        identificadosAutomaticamente: opcoes.automaticos ?? 0,
        precisamConfirmacao: resultados.filter((r) => r.precisaConfirmacao).length,
        precisamCadastro: resultados.filter((r) => r.precisaCadastro).length,
        tempoProcessamento: opcoes.tempo ?? 105000
      }
    }
  };
}

async function main() {
  console.log('\n=== Testes Central de Revisão MIIP — Sprint 6B ===\n');

  await test('importação sem pendências', () => {
    const dados = criarImportacao({
      automaticos: 3,
      resultados: [
        criarResultado({ indice: 0, score: 100, associado: true }),
        criarResultado({ indice: 1, score: 100 }),
        criarResultado({ indice: 2, score: 100 })
      ].map((r) => ({ ...r, precisaConfirmacao: false, precisaCadastro: false }))
    });

    const sessao = utils.montarSessaoRevisao(dados);
    assert.strictEqual(sessao.pendencias.length, 0);
    assert.strictEqual(sessao.resumo.identificadosAutomaticamente, 3);
  });

  await test('importação somente confirmação', () => {
    const resultados = [
      criarResultado({ indice: 0, score: 96, precisaConfirmacao: true, produtoEncontrado: { id: 1, nome: 'A' } }),
      criarResultado({ indice: 1, score: 88, precisaConfirmacao: true, produtoEncontrado: { id: 2, nome: 'B' } })
    ];
    const pendencias = utils.extrairPendencias(resultados);
    assert.strictEqual(pendencias.length, 2);
    assert.strictEqual(pendencias.every((p) => p.precisaConfirmacao), true);
  });

  await test('importação somente cadastro', () => {
    const resultados = [
      criarResultado({ indice: 0, precisaCadastro: true }),
      criarResultado({ indice: 1, precisaCadastro: true })
    ];
    const ordenadas = utils.ordenarPendencias(utils.extrairPendencias(resultados));
    assert.strictEqual(ordenadas.length, 2);
    assert.strictEqual(ordenadas.every((p) => p.precisaCadastro), true);
  });

  await test('importação mista com ordenação por certeza', () => {
    const resultados = [
      criarResultado({ indice: 0, score: 70, precisaConfirmacao: true, produtoEncontrado: { id: 1 } }),
      criarResultado({ indice: 1, precisaCadastro: true }),
      criarResultado({ indice: 2, score: 96, precisaConfirmacao: true, produtoEncontrado: { id: 3 } })
    ];

    const ordenadas = utils.ordenarPendencias(utils.extrairPendencias(resultados));
    assert.strictEqual(ordenadas[0].score, 96);
    assert.strictEqual(ordenadas[1].score, 70);
    assert.strictEqual(ordenadas[2].precisaCadastro, true);
    assert.strictEqual(ordenadas[2].produtoEncontrado, null);
  });

  await test('confirmação registra aprendizado e avança sessão', () => {
    const dados = criarImportacao({
      resultados: [
        criarResultado({ indice: 0, score: 90, precisaConfirmacao: true, produtoEncontrado: { id: 10, nome: 'P10' } })
      ]
    });
    let sessao = utils.montarSessaoRevisao(dados);
    const pendencia = utils.obterPendenciaAtual(sessao);

    sessao = utils.registrarResolucaoPendencia(sessao, pendencia, 'confirmado', {
      produtoId: 10,
      aprendeu: true
    });

    assert.strictEqual(sessao.aprendizados, 1);
    assert.strictEqual(sessao.confirmadosManualmente, 1);
    assert.strictEqual(sessao.itens[0].produto_id, 10);
    assert.strictEqual(utils.todasPendenciasResolvidas(sessao), true);
  });

  await test('cancelar revisão — pendências ignoradas', () => {
    const dados = criarImportacao({
      resultados: [
        criarResultado({ indice: 0, score: 85, precisaConfirmacao: true, produtoEncontrado: { id: 5 } })
      ]
    });
    let sessao = utils.montarSessaoRevisao(dados);
    const pendencia = utils.obterPendenciaAtual(sessao);

    sessao = utils.registrarResolucaoPendencia(sessao, pendencia, 'ignorado');
    assert.strictEqual(sessao.ignoradas.length, 1);
    assert.strictEqual(utils.todasPendenciasResolvidas(sessao), true);
  });

  await test('navegação por teclado — próxima pendência aberta', () => {
    const dados = criarImportacao({
      resultados: [
        criarResultado({ indice: 0, score: 96, precisaConfirmacao: true, produtoEncontrado: { id: 1 } }),
        criarResultado({ indice: 1, score: 82, precisaConfirmacao: true, produtoEncontrado: { id: 2 } })
      ]
    });

    let sessao = utils.montarSessaoRevisao(dados);
    sessao = utils.proximaPendenciaNaoResolvida(sessao, 1);
    assert.strictEqual(sessao.indiceAtual, 1);

    sessao = utils.proximaPendenciaNaoResolvida(sessao, -1);
    assert.strictEqual(sessao.indiceAtual, 0);
  });

  await test('estatísticas finais e precisão', () => {
    const dados = criarImportacao({
      automaticos: 5,
      tempo: 65000,
      resultados: [
        criarResultado({ indice: 0, score: 90, precisaConfirmacao: true, produtoEncontrado: { id: 1 } })
      ]
    });
    dados.miip_importacao.resumo.totalItens = 6;

    let sessao = utils.montarSessaoRevisao(dados);
    sessao = utils.registrarResolucaoPendencia(sessao, sessao.pendencias[0], 'confirmado', {
      produtoId: 1,
      aprendeu: true
    });

    const finais = utils.montarEstatisticasFinais(sessao);
    assert.strictEqual(finais.identificadosAutomaticamente, 5);
    assert.strictEqual(finais.aprendeu, 1);
    assert.strictEqual(finais.precisao, 100);
    assert.strictEqual(finais.tempoFormatado, '00:01:05');
  });

  await test('formatar tempo de processamento', () => {
    assert.strictEqual(utils.formatarTempoProcessamento(105000), '00:01:45');
    assert.strictEqual(utils.formatarTempoProcessamento(0), '00:00:00');
  });

  await test('cadastro pela nota fecha e vincula (origem MIIP, sem Add Novo)', () => {
    const revisao = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/miip-central-revisao.js'), 'utf8');
    const produtos = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
    assert.match(revisao, /showProdutoModal\(null,\s*\{\s*origem:\s*['"]MIIP['"]\s*\}\)/);
    assert.match(revisao, /incluirProdutoNoCatalogoRevisao/);
    assert.match(produtos, /origemCadastro !== 'COMPRA' && origemCadastro !== 'MIIP'/);
    assert.match(produtos, /origemCadastro === 'COMPRA' \|\| origemCadastro === 'MIIP'/);
  });

  await test('extrair evidências do candidato', () => {
    const evidencias = utils.extrairEvidencias({
      evidencias: [{ tipo: 'gtin_exato' }],
      produto: { marca: 'Philips' }
    }, 'motor_gtin');

    assert.ok(evidencias.includes('Código de barras'));
    assert.ok(evidencias.includes('Marca'));
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
