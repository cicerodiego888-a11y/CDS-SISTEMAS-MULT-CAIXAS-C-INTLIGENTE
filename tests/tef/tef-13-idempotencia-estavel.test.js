/**
 * TEF-13 — Idempotência estável e retry seguro após timeout.
 * Sem TX financeira, sem INIT, sem banco oficial.
 * Executar: node tests/tef/tef-13-idempotencia-estavel.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Idem = require('../../frontend/shared/js/tefIdempotencia.js');

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
    console.error(`         ${error && error.stack ? error.stack : error}`);
  }
}

console.log('\n=== TEF-13 idempotência estável ===\n');

test('retry da mesma operação mantém a mesma chave', () => {
  const g = Idem.criarGerenciador({ gerarId: () => 'id-fix' });
  const a = g.obterOuCriarChave({ tipo: 'credito', valor: 10, parcelas: 1, venda_id: 7 });
  g.marcarEnviado(a.chave);
  g.registrarResultado(a.chave, { status: 'pendente', codigo: 'TIMEOUT', retryAllowed: false });
  const b = g.obterOuCriarChave({ tipo: 'credito', valor: 10, parcelas: 1, venda_id: 7 });
  assert.strictEqual(a.chave, b.chave);
  assert.strictEqual(b.reutilizada, true);
  assert.strictEqual(a.chave, 'pdv-op-id-fix');
});

test('timeout seguido de retry não cria nova identidade', () => {
  let n = 0;
  const g = Idem.criarGerenciador({ gerarId: () => `x-${++n}` });
  const a = g.obterOuCriarChave({ tipo: 'debito', valor: 1.0, parcelas: 1 });
  g.marcarEnviado(a.chave);
  g.registrarResultado(a.chave, { codigo: 'TIMEOUT', status: 'pendente', retryAllowed: false });
  assert.strictEqual(g.snapshot().estado, Idem.ESTADOS.INCONCLUSIVO);
  const b = g.obterOuCriarChave({ tipo: 'debito', valor: 1, parcelas: 1 });
  assert.strictEqual(b.chave, a.chave);
  assert.strictEqual(n, 1);
});

test('nova venda (marcarNovaVenda) gera chave diferente', () => {
  let n = 0;
  const g = Idem.criarGerenciador({ gerarId: () => `v-${++n}` });
  const a = g.obterOuCriarChave({ tipo: 'credito', valor: 50, parcelas: 1 });
  g.marcarEnviado(a.chave);
  g.registrarResultado(a.chave, { aprovado: true, status: 'aprovado' });
  g.marcarNovaVenda();
  const b = g.obterOuCriarChave({ tipo: 'credito', valor: 50, parcelas: 1 });
  assert.notStrictEqual(a.chave, b.chave);
  assert.strictEqual(b.reutilizada, false);
});

test('fingerprint diferente (valor/tipo/venda) gera chave nova', () => {
  let n = 0;
  const g = Idem.criarGerenciador({ gerarId: () => `f-${++n}` });
  const a = g.obterOuCriarChave({ tipo: 'credito', valor: 10, venda_id: 1 });
  const b = g.obterOuCriarChave({ tipo: 'credito', valor: 20, venda_id: 1 });
  assert.notStrictEqual(a.chave, b.chave);
});

test('após aprovado, retry da mesma fingerprint reutiliza chave (anti 2ª cobrança)', () => {
  const g = Idem.criarGerenciador({ gerarId: () => 'apr-1' });
  const a = g.obterOuCriarChave({ tipo: 'pix_tef', valor: 5 });
  g.marcarEnviado(a.chave);
  g.registrarResultado(a.chave, { sucesso: true, status: 'aprovado' });
  const b = g.obterOuCriarChave({ tipo: 'pix_tef', valor: 5 });
  assert.strictEqual(a.chave, b.chave);
  assert.strictEqual(b.reutilizada, true);
});

test('após negado definitivo, nova tentativa legítima recebe chave nova', () => {
  let n = 0;
  const g = Idem.criarGerenciador({ gerarId: () => `neg-${++n}` });
  const a = g.obterOuCriarChave({ tipo: 'debito', valor: 9 });
  g.marcarEnviado(a.chave);
  g.registrarResultado(a.chave, { sucesso: false, status: 'negado', codigo: '05' });
  assert.strictEqual(g.snapshot().estado, Idem.ESTADOS.NEGADO);
  const b = g.obterOuCriarChave({ tipo: 'debito', valor: 9 });
  assert.notStrictEqual(a.chave, b.chave);
});

test('operação inconclusiva não é classificada como cancelada/negada', () => {
  const c = Idem.classificarResposta({
    status: 'pendente',
    codigo: 'TIMEOUT',
    retryAllowed: false,
    sucesso: false
  });
  assert.strictEqual(c.estado, Idem.ESTADOS.INCONCLUSIVO);
  assert.strictEqual(c.negado, false);
  assert.strictEqual(c.aprovado, false);
  assert.strictEqual(c.inconclusivo, true);
});

test('falha antes do envio ≠ falha após envio', () => {
  const g = Idem.criarGerenciador({ gerarId: () => 'net-1' });
  const a = g.obterOuCriarChave({ tipo: 'credito', valor: 3 });
  g.registrarResultado(a.chave, { mensagem: 'abort' }, { falhaAntesEnvio: true });
  assert.strictEqual(g.snapshot().estado, Idem.ESTADOS.ABORTADO_ANTES_ENVIO);
  const reuse = g.obterOuCriarChave({ tipo: 'credito', valor: 3 });
  assert.strictEqual(reuse.chave, a.chave);

  g.marcarEnviado(a.chave);
  g.registrarResultado(a.chave, { codigo: 'TEF_NETWORK', status: 'pendente' }, { networkError: true });
  assert.strictEqual(g.snapshot().estado, Idem.ESTADOS.INCONCLUSIVO);
});

test('requisições com a mesma chave explícita não criam outra identidade', () => {
  const g = Idem.criarGerenciador({ gerarId: () => 'should-not-run' });
  const a = g.obterOuCriarChave({
    tipo: 'credito',
    valor: 1,
    idempotency_key: 'pdv-op-fixa'
  });
  const b = g.obterOuCriarChave({
    tipo: 'credito',
    valor: 1,
    idempotency_key: 'pdv-op-fixa'
  });
  assert.strictEqual(a.chave, 'pdv-op-fixa');
  assert.strictEqual(b.chave, 'pdv-op-fixa');
});

test('pdv.js não usa mais Date.now() na chave TEF', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
  assert.ok(src.includes('TefIdempotencia'));
  assert.ok(src.includes('obterOuCriarChave'));
  assert.ok(!/pdv-\$\{tipoTef\}-\$\{Number\(valor\)\.toFixed\(2\)\}-\$\{Date\.now\(\)\}/.test(src));
  assert.ok(src.includes('inconclusivo'));
  assert.ok(src.includes('Não inicie outra cobrança') || src.includes('Não gere nova cobrança') || src.includes('não tente outro pagamento') || src.includes('Não tente outro pagamento'));
});

test('index PDV carrega tefIdempotencia.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/index.html'), 'utf8');
  assert.ok(html.includes('tefIdempotencia.js'));
});

test('backend ainda impede duplicidade por idempotency_key (evidência estática)', () => {
  const mgr = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
  assert.ok(mgr.includes('_verificarIdempotencia'));
  assert.ok(mgr.includes('TRANSACAO_DUPLICADA'));
  assert.ok(mgr.includes('retryAllowed: false'));
  const repo = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/tefRepository.js'), 'utf8');
  assert.ok(repo.includes('idempotency_key'));
});

test('limparCarrinho/finalizarPosVenda/cancelarVenda chamam marcarNovaVenda', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
  const ocorrencias = (src.match(/marcarNovaVenda/g) || []).length;
  assert.ok(ocorrencias >= 3, `esperado >=3, veio ${ocorrencias}`);
});

console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
process.exit(falhou ? 1 : 0);
