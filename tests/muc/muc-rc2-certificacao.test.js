/**
 * MUC RC2 — Suíte de certificação arquitetural
 * Executar: node tests/muc/muc-rc2-certificacao.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const MUC = require('../../backend/motores/muc');
const PipelineMuc = require('../../backend/motores/muc/pipeline/PipelineMuc');
const MotorParser = require('../../backend/motores/muc/core/MotorParser');
const MotorValidacao = require('../../backend/motores/muc/core/MotorValidacao');
const MotorNormalizacao = require('../../backend/motores/muc/core/MotorNormalizacao');
const MotorInferenciaEtapa = require('../../backend/motores/muc/core/MotorInferenciaEtapa');
const MotorConversaoCalculo = require('../../backend/motores/muc/core/MotorConversaoCalculo');
const MotorAuditoriaEtapa = require('../../backend/motores/muc/core/MotorAuditoriaEtapa');
const { criarResultadoConversaoDTO } = require('../../backend/motores/muc/dto/ResultadoConversaoDTO');
const { MotorCacheConversao } = require('../../backend/motores/muc/cache/MotorCacheConversao');
const { resolverRegra, CATALOGO_REGRAS } = require('../../backend/motores/muc/constants/catalogoRegras');

let ok = 0;
let falhas = 0;

function test(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  OK  ${nome}`);
  } catch (err) {
    falhas += 1;
    console.error(`  FAIL  ${nome}`);
    console.error(`       ${err.message}`);
  }
}

function inputCaixa12() {
  return {
    produtoId: 1,
    item: {
      quantidade_embalagens: 10,
      quantidade_por_embalagem: 12,
      valor_total_embalagem: 400,
      unidade_comercial: 'CAIXA',
      compra_em: 'CX'
    },
    origem: 'MANUAL'
  };
}

console.log('\n=== MUC RC2 — Certificação Arquitetural ===\n');

MUC.BarramentoEventos.limparHistorico();
MUC.MucMetricas.reset();

test('Versão RC2.1 oficial congelada', () => {
  assert.strictEqual(MUC.VERSAO.VERSAO, 'RC2.1');
  assert.strictEqual(MUC.VERSAO.STATUS, 'ARQUITETURA_CONGELADA');
  assert.strictEqual(MUC.VERSAO.TAG, 'MUC_RC2.1_ENTERPRISE');
});

test('Estrutura RC2 — pipeline + etapas desacopladas', () => {
  [
    'backend/motores/muc/pipeline/PipelineMuc.js',
    'backend/motores/muc/core/MotorParser.js',
    'backend/motores/muc/core/MotorValidacao.js',
    'backend/motores/muc/core/MotorNormalizacao.js',
    'backend/motores/muc/core/MotorInferenciaEtapa.js',
    'backend/motores/muc/core/MotorConversaoCalculo.js',
    'backend/motores/muc/core/MotorAuditoriaEtapa.js',
    'backend/motores/muc/eventos/BarramentoEventos.js',
    'backend/motores/muc/observabilidade/MucMetricas.js',
    'backend/motores/muc/cache/MotorCacheConversao.js',
    'backend/motores/muc/constants/catalogoRegras.js'
  ].forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), `falta ${f}`));
});

test('ResultadoConversaoDTO RC2 — campos obrigatórios e imutabilidade', () => {
  const r = PipelineMuc.executar(inputCaixa12(), { correlationId: 'test-corr-001' });
  [
    'versaoMotor', 'versaoRegra', 'origemDados', 'tempoProcessamentoMs',
    'warnings', 'metadata', 'hashConversao', 'correlationId', 'regraAplicada'
  ].forEach((campo) => assert.ok(campo in r, `campo ausente: ${campo}`));
  assert.strictEqual(r.correlationId, 'test-corr-001');
  assert.strictEqual(r.versaoMotor, 'RC2.1');
  assert.strictEqual(r.hash, r.hashConversao);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.warnings));
  assert.ok(Object.isFrozen(r.metadata));
  assert.throws(() => { r.quantidadeEstoque = 999; });
});

test('Pipeline completo — Caixa 12 × 10 = 120 UN (zero regressão RC1)', () => {
  const r = PipelineMuc.executar(inputCaixa12());
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.strictEqual(r.fatorConversao, 12);
  assert.strictEqual(r.tipoConversao, 'MULTIPLICADOR');
  assert.strictEqual(r.regraAplicada, 'EMBALAGEM_MULTIPLICADOR');
});

test('Etapas SRP — Parser isolado', () => {
  const ctx = MotorParser.executar(inputCaixa12());
  assert.ok(ctx.dto);
  assert.strictEqual(ctx.origemDados, 'API');
  assert.ok(Object.isFrozen(ctx));
});

test('Etapas SRP — Validação rejeita quantidade negativa', () => {
  const ctx = MotorParser.executar({ item: { quantidade_embalagens: -1 } });
  const v = MotorValidacao.executar(ctx);
  assert.strictEqual(v.ok, false);
});

test('Etapas SRP — Normalização → Inferência → Conversão', () => {
  let ctx = MotorParser.executar(inputCaixa12());
  const v = MotorValidacao.executar(ctx);
  assert.strictEqual(v.ok, true);
  ctx = MotorNormalizacao.executar(ctx);
  ctx = MotorInferenciaEtapa.executar(ctx);
  ctx = MotorConversaoCalculo.executar(ctx);
  assert.strictEqual(ctx.calculado.quantidadeEstoque, 120);
});

test('Etapa Auditoria — contexto enriquecido RC2', () => {
  const r = PipelineMuc.executar(inputCaixa12());
  const ctx = MotorAuditoriaEtapa.executar(
    { resultado: r, dto: {} },
    { gtin: '789123', fornecedorCnpj: '12345678000199', usuarioId: 1 }
  );
  assert.strictEqual(ctx.auditavel.contexto.gtin, '789123');
  assert.strictEqual(ctx.auditavel.contexto.correlationId, r.correlationId);
});

test('Catálogo de regras — versionamento histórico', () => {
  const regra = resolverRegra('MULTIPLICADOR');
  assert.strictEqual(regra.regraAplicada, 'EMBALAGEM_MULTIPLICADOR');
  assert.strictEqual(regra.versaoRegra, '1.0.0');
  assert.ok(regra.dataRegra);
  assert.ok(regra.motivo);
  assert.ok(CATALOGO_REGRAS.PESO);
  assert.ok(CATALOGO_REGRAS.VOLUME);
});

test('Eventos padronizados — MUC_CONVERSAO_MANUAL', () => {
  MUC.BarramentoEventos.limparHistorico();
  PipelineMuc.executar(inputCaixa12());
  const eventos = MUC.BarramentoEventos.listar({ tipo: 'MUC_CONVERSAO_MANUAL' });
  assert.ok(eventos.length >= 1);
  const ev = eventos[0];
  assert.ok(ev.timestamp);
  assert.ok(ev.correlationId);
  assert.ok(ev.payload);
  assert.ok(Object.isFrozen(ev));
});

test('Eventos — MUC_ERRO em falha de validação', () => {
  MUC.BarramentoEventos.limparHistorico();
  assert.throws(() => PipelineMuc.executar({ item: { quantidade_embalagens: -5, valor_total_embalagem: 10 } }));
  const erros = MUC.BarramentoEventos.listar({ tipo: 'MUC_ERRO' });
  assert.ok(erros.length >= 1);
});

test('Observabilidade — métricas registradas', () => {
  MUC.MucMetricas.reset();
  PipelineMuc.executar(inputCaixa12(), { fornecedorCnpj: '12345678000199', gtin: '789000' });
  PipelineMuc.executar({ ...inputCaixa12(), origem: 'NFE' }, { gtin: '789001' });
  const snap = MUC.MucMetricas.snapshot();
  assert.ok(snap.total >= 2);
  assert.ok(snap.tempoMedioMs >= 0);
  assert.ok(snap.confiancaMedia >= 0);
  assert.ok(snap.porFornecedor['12345678000199'] >= 1);
  const json = MUC.MucMetricas.exportarJson();
  assert.ok(json.includes('"total"'));
  const md = MUC.MucMetricas.exportarMarkdown();
  assert.ok(md.includes('Dashboard de Métricas'));
});

test('Cache desacoplado — MotorCacheConversao', () => {
  const cache = new MotorCacheConversao();
  let execCount = 0;
  const inp = inputCaixa12();
  const fn = () => {
    execCount += 1;
    return criarResultadoConversaoDTO({ quantidadeEstoque: 120, fatorConversao: 12 });
  };
  const r1 = cache.executar(inp, fn);
  const r2 = cache.executar(inp, fn);
  assert.strictEqual(execCount, 1);
  assert.strictEqual(r1.quantidadeEstoque, r2.quantidadeEstoque);
  assert.strictEqual(cache.tamanho(), 1);
});

test('Facade obterMuc — converter via pipeline + exportarMetricas', () => {
  const muc = MUC.obterMuc({ run: () => {}, all: () => {} });
  const r = muc.converter(inputCaixa12());
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.ok(muc.exportarMetricas('json').includes('"total"'));
  assert.ok(muc.exportarMetricas('markdown').includes('MUC'));
});

test('MotorConversao delega ao pipeline (API RC1 preservada)', () => {
  const r = MUC.MotorConversao.converter(inputCaixa12());
  assert.strictEqual(r.quantidadeEstoque, 120);
  assert.strictEqual(r.versaoMotor, 'RC2.1');
});

test('Simulação RC1 compatível com campos RC2', () => {
  const r = MUC.MotorConversao.simularConversao({
    quantidadeCompra: 4,
    quantidadePorApresentacao: 15,
    valorTotal: 120
  });
  assert.strictEqual(r.quantidadeEstoque, 60);
  assert.strictEqual(r.custoUnitario, 2);
  assert.ok(r.hashConversao);
});

test('Schema RC2 — colunas auditoria avançada', () => {
  const src = fs.readFileSync(path.join(ROOT, 'backend/motores/muc/schema/mucSchema.js'), 'utf8');
  assert.match(src, /correlation_id/);
  assert.match(src, /tempo_processamento_ms/);
  assert.match(src, /regra_aplicada/);
  assert.match(src, /versao_regra/);
});

test('Barramento — todos eventos mínimos definidos', () => {
  const tipos = MUC.BarramentoEventos.EVENTOS;
  [
    'MUC_CONVERSAO_EXECUTADA',
    'MUC_CONVERSAO_CONFIRMADA',
    'MUC_CONVERSAO_MANUAL',
    'MUC_APRESENTACAO_APRENDIDA',
    'MUC_ERRO',
    'MUC_INFERENCIA_FALHOU'
  ].forEach((t) => assert.ok(tipos.includes(t), `evento ausente: ${t}`));
});

console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
process.exit(falhas > 0 ? 1 : 0);
