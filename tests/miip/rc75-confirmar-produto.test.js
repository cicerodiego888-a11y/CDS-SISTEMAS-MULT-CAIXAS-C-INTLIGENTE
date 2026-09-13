/**
 * RC7.5 — Fluxo "Confirmar Produto" (Central MIIP)
 * Executar: node tests/miip/rc75-confirmar-produto.test.js
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
    precisaCadastro: Boolean(opcoes.precisaCadastro)
  };
}

function criarImportacao(resultados, automaticos = 0) {
  return {
    chave_acesso: 'CHAVE-RC75',
    fornecedor: 'Fornecedor RC75',
    fornecedor_cnpj: '12345678000199',
    itens: resultados.map((r, i) => ({
      produto_nome: r.produtoXML?.produto_nome || `Item ${i}`,
      codigo_fornecedor: `C${i}`,
      codigo_barras: `789${i}`,
      quantidade: 1,
      preco_unitario: 10
    })),
    miip_importacao: {
      usarMiipImportacaoXML: true,
      resultados,
      resumo: {
        totalItens: resultados.length + automaticos,
        identificadosAutomaticamente: automaticos,
        precisamConfirmacao: resultados.filter((r) => r.precisaConfirmacao).length,
        precisamCadastro: resultados.filter((r) => r.precisaCadastro).length,
        tempoProcessamento: 12000
      }
    }
  };
}

function main() {
  console.log('\n=== RC7.5 — Confirmar Produto (Central MIIP) ===\n');

  const srcPath = path.join(__dirname, '../../frontend/erp/js/miip-central-revisao.js');
  const src = fs.readFileSync(srcPath, 'utf8');

  test('ponto de remoção: Confirmar NÃO chama cadastrarNovo', () => {
    const bloco = src.slice(src.indexOf('function confirmarAtual'), src.indexOf('function atualizarIndicadoresAposResolucao'));
    assert.ok(bloco.includes("Selecione um produto para continuar."));
    assert.ok(!bloco.includes('cadastrarNovo('));
    assert.ok(!bloco.includes('loadPage'));
    assert.ok(!bloco.includes('compras'));
    assert.ok(!bloco.includes('pedido'));
  });

  test('fonte: CTA Finalizar Entrada (não abre Compras dentro do MIIP)', () => {
    assert.ok(!src.includes('Abrir tela de Compras'));
    assert.ok(src.includes('encerrarRevisaoAutomaticamente'));
    assert.ok(src.includes('Finalizar Entrada'));
    assert.ok(src.includes('miipCentralBtnFinalizarEntrada'));
    assert.ok(src.includes("origem: 'Confirmacao Manual'"));
  });

  test('fonte: ENTER chama confirmarAtual', () => {
    assert.ok(/event\.key === 'Enter'[\s\S]*confirmarAtual\(\)/.test(src));
  });

  test('sem produto → mensagem de seleção', () => {
    const r = utils.validarConfirmacaoProduto({ precisaConfirmacao: true, produtoEncontrado: null });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.mensagem, 'Selecione um produto para continuar.');
  });

  test('com produto → confirmação válida', () => {
    const r = utils.validarConfirmacaoProduto({
      precisaConfirmacao: true,
      produtoEncontrado: { id: 42, nome: 'Produto CDS' }
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.produtoId, 42);
  });

  test('confirmar um item → resolvido + aprendizado', () => {
    const dados = criarImportacao([
      criarResultado({ indice: 0, score: 90, precisaConfirmacao: true, produtoEncontrado: { id: 10, nome: 'P10' } }),
      criarResultado({ indice: 1, score: 85, precisaConfirmacao: true, produtoEncontrado: { id: 11, nome: 'P11' } })
    ]);
    let sessao = utils.montarSessaoRevisao(dados);
    const pend = utils.obterPendenciaAtual(sessao);
    sessao = utils.registrarResolucaoPendencia(sessao, pend, 'confirmado', { produtoId: 10, aprendeu: true });
    assert.strictEqual(sessao.resolvidas.length, 1);
    assert.strictEqual(sessao.itens[0].produto_id, 10);
    assert.strictEqual(utils.contarPendenciasAbertas(sessao), 1);
  });

  test('confirmar vários itens consecutivos', () => {
    const dados = criarImportacao([
      criarResultado({ indice: 0, score: 96, precisaConfirmacao: true, produtoEncontrado: { id: 1 } }),
      criarResultado({ indice: 1, score: 88, precisaConfirmacao: true, produtoEncontrado: { id: 2 } }),
      criarResultado({ indice: 2, score: 80, precisaConfirmacao: true, produtoEncontrado: { id: 3 } })
    ]);
    let sessao = utils.montarSessaoRevisao(dados);
    for (let i = 0; i < 3; i += 1) {
      const pend = sessao.pendencias.find((p) => !sessao.resolvidas.includes(p.indice));
      sessao = utils.registrarResolucaoPendencia(sessao, pend, 'confirmado', {
        produtoId: pend.produtoEncontrado.id,
        aprendeu: true
      });
      if (!utils.todasPendenciasResolvidas(sessao)) {
        sessao = utils.proximaPendenciaNaoResolvida(sessao, 1);
      }
    }
    assert.strictEqual(utils.todasPendenciasResolvidas(sessao), true);
    assert.strictEqual(sessao.confirmadosManualmente, 3);
  });

  test('confirmar o último item → conclusão sinaliza abrir compra via Central', () => {
    const dados = criarImportacao([
      criarResultado({ indice: 0, score: 90, precisaConfirmacao: true, produtoEncontrado: { id: 7 } })
    ]);
    let sessao = utils.montarSessaoRevisao(dados);
    sessao = utils.registrarResolucaoPendencia(sessao, sessao.pendencias[0], 'confirmado', {
      produtoId: 7,
      aprendeu: true
    });
    assert.strictEqual(utils.todasPendenciasResolvidas(sessao), true);
    const resultado = utils.montarResultadoConclusaoRevisao(sessao, { motivoEncerramento: 'ultimo_item_resolvido' });
    assert.strictEqual(resultado.navegacao.abrirCompra, true);
    assert.strictEqual(resultado.navegacao.abrirPedido, false);
    assert.strictEqual(resultado.navegacao.permanecerNaCentral, false);
    assert.strictEqual(resultado.navegacao.proximaAcao, 'ABRIR_COMPRA');
  });

  test('XML sem pendências → conclusão direta sinaliza abrir compra', () => {
    const dados = criarImportacao([], 5);
    dados.miip_importacao.resumo.totalItens = 5;
    const sessao = utils.montarSessaoRevisao(dados);
    assert.strictEqual(sessao.pendencias.length, 0);
    const resultado = utils.montarResultadoConclusaoRevisao(sessao, { motivoEncerramento: 'xml_sem_pendencias' });
    assert.strictEqual(resultado.navegacao.abrirCompra, true);
  });

  test('produto já aprendido (candidato) confirma sem cadastro', () => {
    const pend = criarResultado({
      indice: 0,
      score: 100,
      precisaConfirmacao: true,
      produtoEncontrado: { id: 99, nome: 'Aprendido' }
    });
    const v = utils.validarConfirmacaoProduto(pend);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.produtoId, 99);
  });

  test('produto cadastrado manualmente (sem candidato) exige seleção', () => {
    const pend = criarResultado({ indice: 0, precisaCadastro: true, produtoEncontrado: null });
    const v = utils.validarConfirmacaoProduto(pend);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.mensagem, 'Selecione um produto para continuar.');
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main();
