/**
 * UX-ENTRADAS-BOTOES-01 — inspeção estática dos botões visíveis na conferência.
 * Executar: node tests/miip/ux-entradas-botoes-01-static.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../frontend/erp/js/miip-central-revisao.js'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(__dirname, '../../frontend/css/miip-central-revisao.css'),
  'utf8'
);

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

console.log('\n=== UX-ENTRADAS-BOTOES-01 — botões visíveis ===\n');

test('modal renderiza botões Confirmar / Escolher / Cadastrar / Próximo / Pausar', () => {
  assert.ok(src.includes('id="miipCentralBtnConfirmar"'));
  assert.ok(src.includes('id="miipCentralBtnEscolher"'));
  assert.ok(src.includes('id="miipCentralBtnCadastrar"'));
  assert.ok(src.includes('id="miipCentralBtnProximo"'));
  assert.ok(src.includes('id="miipCentralBtnPausar"'));
  assert.ok(src.includes('id="miipCentralAcoesBarra"'));
});

test('botões reutilizam os mesmos handlers dos atalhos', () => {
  // CE-UX-02: bindings delegados namespaced; handlers oficiais preservados
  assert.ok(/click\.miipCentralConfirmar[\s\S]*?#miipCentralBtnConfirmar[\s\S]*?confirmarAtual\(\)/.test(src));
  assert.ok(/click\.miipCentralEscolher[\s\S]*?#miipCentralBtnEscolher[\s\S]*?abrirBuscaProduto\(\)/.test(src));
  assert.ok(/click\.miipCentralCadastro[\s\S]*?#miipCentralBtnCadastrar[\s\S]*?cadastrarNovo\(\)/.test(src));
  assert.ok(/#miipCentralBtnPausar'\)\.off\('click'\)\.on\('click', cancelarRevisao\)/.test(src));
  assert.ok(/click\.miipCentralProximo[\s\S]*?#miipCentralBtnProximo[\s\S]*?proximaAberta\(estado\.sessao, 1\)/.test(src));
});

test('atalhos Enter/F2/F3/Tab/Esc preservados', () => {
  assert.ok(/event\.key === 'Enter'[\s\S]{0,160}confirmarAtual\(\)/.test(src));
  assert.ok(/event\.key === 'F2'[\s\S]{0,80}abrirBuscaProduto\(\)/.test(src));
  assert.ok(/event\.key === 'F3'[\s\S]{0,80}cadastrarNovo\(\)/.test(src));
  assert.ok(/event\.key === 'Escape'[\s\S]{0,80}cancelarRevisao\(\)/.test(src));
  assert.ok(/event\.key === 'Tab'[\s\S]{0,160}proximaAberta\(/.test(src));
});

test('"É este" confirma associação da sugestão (não é só preview)', () => {
  assert.ok(src.includes('É este — confirmar'));
  assert.ok(/data-miip-e-este[\s\S]*escolherProdutoDaPergunta/.test(src));
  assert.ok(src.includes('function escolherProdutoDaPergunta'));
  assert.ok(/escolherProdutoDaPergunta[\s\S]*aplicarConfirmacao/.test(src));
});

test('atualizarAcoesVisiveis desabilita Confirmar sem sugestão única', () => {
  assert.ok(src.includes('function atualizarAcoesVisiveis'));
  assert.ok(src.includes('podeConfirmar = aberta && opcoes.length === 1'));
  assert.ok(src.includes('atualizarAcoesVisiveis()'));
});

test('CSS mantém barra de ações visível (sticky + painel flex)', () => {
  assert.ok(css.includes('.miip-central-acoes-barra'));
  assert.ok(/miip-central-acoes-barra[\s\S]*position:\s*sticky/.test(css));
  assert.ok(css.includes('.miip-central-painel-scroll'));
  assert.ok(css.includes('miip-central-acao-principal'));
});

console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
process.exit(falhou ? 1 : 0);
