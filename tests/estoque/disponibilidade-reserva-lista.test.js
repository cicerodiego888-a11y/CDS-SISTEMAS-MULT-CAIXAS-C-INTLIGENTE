const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extrairFuncaoPorNome(source, nome) {
  const inicio = source.indexOf(`function ${nome}`);
  assert.notEqual(inicio, -1, `Função ${nome} não encontrada.`);
  let cursor = inicio;
  let chaves = 0;
  let iniciou = false;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '{') {
      chaves += 1;
      iniciou = true;
    } else if (char === '}') {
      chaves -= 1;
      if (iniciou && chaves === 0) {
        return source.slice(inicio, cursor + 1);
      }
    }
    cursor += 1;
  }
  throw new Error(`Não foi possível extrair a função ${nome}.`);
}

test('formatarColunaEstoqueLista não mostra reserva ativa como disponível', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/produtos.js'), 'utf8');
  const funcao = extrairFuncaoPorNome(source, 'formatarColunaEstoqueLista');
  const contexto = {
    console,
    formatarEstoqueProduto: (valor, unidade = 'un', _opcoes = {}) => `${Number(valor || 0).toFixed(0)} ${unidade}`,
    produtoUsaConversaoUnidades: () => false,
    estoqueCadastroSomenteFiscal: () => false
  };

  vm.runInNewContext(`${funcao};`, contexto);
  const html = contexto.formatarColunaEstoqueLista({
    id: 611,
    unidade: 'un',
    saldo_fiscal: 0,
    saldo_nao_fiscal: 1,
    reservado_nao_fiscal: 1,
    estoque_atual: 1
  });

  assert.match(html, /B:\s*0\s*un/i, 'A disponibilidade não deve considerar reserva ativa como disponível.');
});
