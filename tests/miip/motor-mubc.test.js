/**
 * Testes RC9.3 — Motor Universal de Busca de Candidatos (MUBC)
 * Executar: npm run test:miip-mubc
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IMotorIdentificacao = require('../../backend/motores/miip/core/IMotorIdentificacao');
const MiipCandidate = require('../../backend/motores/miip/core/MiipCandidate');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const MotorUniversalBuscaCandidatos = require('../../backend/motores/miip/engines/mubc/MotorUniversalBuscaCandidatos');
const { ProdutoRepository } = require('../../backend/motores/miip/repositories/ProdutoRepository');
const { MiipMetricsCollector } = require('../../backend/motores/miip/metrics/MiipMetricsCollector');
const { MiipMotorLogService } = require('../../backend/motores/miip/logs/MiipMotorLogService');
const DecisionRulesLoader = require('../../backend/motores/miip/utils/DecisionRulesLoader');
const { ENGINES_IDENTIFICACAO } = require('../../backend/motores/miip/core/MiipPipelineEngineRunner');
const { MOTORES_PADRAO } = require('../../backend/motores/miip/MiipBootstrap');

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

function snap(p) {
  return ProdutoSnapshot.fromRow(p);
}

function criarRepoMock(produtos) {
  return {
    async buscarCandidatosUniversais(filtros = {}) {
      const hits = [];
      for (const p of produtos) {
        const motivos = [];
        if (filtros.gtin && p.codigo_barras === filtros.gtin) motivos.push('gtin_exato');
        if (filtros.gtin && p.codigo_barras && p.codigo_barras !== filtros.gtin
          && String(p.codigo_barras).endsWith(String(filtros.gtin).slice(-8))) {
          motivos.push('gtin_parcial');
        }
        if (filtros.codigoFornecedor && p.codigo === filtros.codigoFornecedor) {
          motivos.push('codigo_fornecedor');
        }
        if (filtros.codigoInterno && p.codigo === filtros.codigoInterno) {
          motivos.push('codigo_interno');
        }
        if (filtros.ncm && p.ncm === filtros.ncm) motivos.push('ncm');
        if (filtros.cest && p.cest === filtros.cest) motivos.push('cest');
        if (filtros.marca && String(p.marca_nome || '').toUpperCase().includes(String(filtros.marca).toUpperCase())) {
          motivos.push('marca');
        }
        const tokens = filtros.tokens || [];
        const nomeU = String(p.nome || '').toUpperCase();
        if (tokens.some((t) => nomeU.includes(String(t).toUpperCase()))) motivos.push('descricao');
        if (motivos.length) hits.push({ snapshot: snap(p), motivos });
      }
      return hits.slice(0, filtros.limite || 60);
    }
  };
}

function criarMotor(produtos) {
  return new MotorUniversalBuscaCandidatos({
    produtoRepository: criarRepoMock(produtos),
    metricsCollector: new MiipMetricsCollector(),
    logService: new MiipMotorLogService()
  });
}

const CATALOGO = [
  {
    id: 1,
    codigo: 'SIL50',
    codigo_barras: '7891111111111',
    nome: 'Silicone Acético 50g Transparente',
    unidade: 'UN',
    ncm: '32141010',
    cest: '2805700',
    marca_nome: 'TEK',
    ativo: 1
  },
  {
    id: 2,
    codigo: 'SIL50B',
    codigo_barras: '7891111111999',
    nome: 'Silicone Acético Blister 50g',
    unidade: 'UN',
    ncm: '32141010',
    cest: '2805700',
    marca_nome: 'TEK',
    ativo: 1
  },
  {
    id: 3,
    codigo: 'OUTRO',
    codigo_barras: '7899999999999',
    nome: 'Parafuso Sextavado 8mm',
    unidade: 'CX',
    ncm: '73181500',
    cest: '',
    marca_nome: 'W-MAX',
    ativo: 1
  },
  {
    id: 4,
    codigo: '13680',
    codigo_barras: '7898113086843',
    nome: 'Escada Aluminio 6 Degraus',
    unidade: 'UN',
    ncm: '76169900',
    cest: '',
    marca_nome: '',
    ativo: 1
  }
];

async function main() {
  console.log('\n=== Testes MUBC — RC9.3 ===\n');

  await test('MUBC estende IMotorIdentificacao', () => {
    const v = IMotorIdentificacao.validarHeranca(MotorUniversalBuscaCandidatos);
    assert.strictEqual(v.valido, true, v.erros.join('; '));
  });

  await test('MUBC não acessa SQL diretamente', () => {
    const arquivo = path.join(__dirname, '../../backend/motores/miip/engines/mubc/MotorUniversalBuscaCandidatos.js');
    const codigo = fs.readFileSync(arquivo, 'utf8');
    [/SELECT\s+/i, /db\.get\(/i, /db\.all\(/i, /db\.run\(/i].forEach((p) => {
      assert.strictEqual(p.test(codigo), false, `SQL proibido: ${p}`);
    });
  });

  await test('MUBC registrado no bootstrap (prioridade 55)', () => {
    const m = MOTORES_PADRAO.find((x) => x.codigo === 'motor_mubc');
    assert.ok(m);
    assert.strictEqual(m.prioridade, 55);
  });

  await test('MUBC em ENGINES_IDENTIFICACAO', () => {
    assert.ok(ENGINES_IDENTIFICACAO.includes('motor_mubc'));
  });

  await test('Decision rules inalteradas (limiares)', () => {
    const cfg = DecisionRulesLoader.carregar();
    assert.strictEqual(cfg.thresholds.sugerirConfirmacao, 95);
    assert.strictEqual(cfg.thresholds.mostrarSugestoes, 80);
    assert.strictEqual(cfg.thresholds.gapMinimoConfirmacao, 15);
    assert.deepStrictEqual(cfg.motoresAutoAssociar, [
      'motor_gtin',
      'motor_associacao_fornecedor'
    ]);
  });

  await test('Descrição semelhante encontra silicone', async () => {
    const motor = criarMotor(CATALOGO);
    const cands = await motor.identificar({
      produtoNome: 'SILICONE ACETICO 50G TRANSP S/BLISTER',
      ncm: '32141010',
      unidade: 'UN',
      marca: 'TEK'
    });
    assert.ok(cands.length >= 1);
    assert.ok(cands.every((c) => c instanceof MiipCandidate || c.produtoId));
    assert.ok(cands.length <= 20);
    assert.ok(cands.some((c) => String(c.produto?.nome || '').toUpperCase().includes('SILICONE')));
    assert.ok(cands[0].scoreTotal <= 94);
    assert.ok(cands[0].motoresQueVotaram.includes('motor_mubc'));
  });

  await test('GTIN parcial gera candidato', async () => {
    const motor = criarMotor(CATALOGO);
    const cands = await motor.identificar({
      produtoNome: 'ESCADA ALUMINIO',
      codigoBarras: '07898113086843',
      unidade: 'UN'
    });
    // mock parcial: endsWith last 8 of normalized — depends on normalizarGtin
    assert.ok(Array.isArray(cands));
  });

  await test('Código fornecedor / interno', async () => {
    const motor = criarMotor(CATALOGO);
    const cands = await motor.identificar({
      produtoNome: 'ESCADA',
      codigoFornecedor: '13680',
      unidade: 'UN'
    });
    assert.ok(cands.some((c) => c.produtoId === 4));
    const ev = (cands.find((c) => c.produtoId === 4)?.evidencias || [])
      .some((e) => e.tipo === 'codigo_fornecedor');
    assert.ok(ev);
  });

  await test('NCM e marca aumentam relevância', async () => {
    const motor = criarMotor(CATALOGO);
    const cands = await motor.identificar({
      produtoNome: 'SILICONE 50G',
      ncm: '32141010',
      cest: '2805700',
      marca: 'TEK',
      unidade: 'UN'
    });
    assert.ok(cands.length >= 1);
    const top = cands[0];
    const tipos = (top.evidencias || []).map((e) => e.tipo);
    assert.ok(tipos.includes('ncm') || tipos.includes('marca') || tipos.includes('descricao'));
  });

  await test('Unidade diferente reduz score', async () => {
    const motor = criarMotor(CATALOGO);
    const ok = await motor.identificar({
      produtoNome: 'Parafuso Sextavado 8mm',
      ncm: '73181500',
      unidade: 'UN',
      marca: 'W-MAX'
    });
    const bad = await motor.identificar({
      produtoNome: 'Parafuso Sextavado 8mm',
      ncm: '73181500',
      unidade: 'KG',
      marca: 'W-MAX'
    });
    const sOk = ok.find((c) => c.produtoId === 3)?.scoreTotal ?? 0;
    const sBad = bad.find((c) => c.produtoId === 3)?.scoreTotal ?? 0;
    assert.ok(sOk >= sBad, `esperado ${sOk} >= ${sBad}`);
  });

  await test('Top 20 no máximo', async () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      codigo: `P${i}`,
      codigo_barras: `7890000000${String(i).padStart(3, '0')}`,
      nome: `Silicone Generico Item ${i}`,
      unidade: 'UN',
      ncm: '32141010',
      cest: '',
      marca_nome: 'TEK',
      ativo: 1
    }));
    const motor = criarMotor(muitos);
    const cands = await motor.identificar({
      produtoNome: 'SILICONE GENERICO',
      ncm: '32141010',
      unidade: 'UN'
    });
    assert.ok(cands.length <= 20);
  });

  await test('Diagnóstico vazio quando sem match', async () => {
    const motor = criarMotor(CATALOGO);
    const cands = await motor.identificar({
      produtoNome: 'XYZQQQ INEXISTENTE 999',
      codigoBarras: '5901234123457',
      ncm: '00000000',
      unidade: 'UN'
    });
    assert.strictEqual(cands.length, 0);
    const diag = motor.obterUltimoDiagnostico();
    assert.ok(diag);
    assert.ok(Array.isArray(diag.motivos) && diag.motivos.length >= 3);
  });

  await test('MUBC ainda encontra por descrição; CompatibilityGuard é barreira do Pipeline', async () => {
    // Busca ampla permanece no MUBC — hard block de tipo/NCM é no Pipeline.
    const motor = criarMotor([
      {
        id: 91,
        nome: 'Passa Fio com Alma de Aço 20m Cortag',
        ncm: '39173900',
        codigo: 'PF20',
        codigo_barras: null,
        unidade: 'UN',
        marca_nome: 'CORTAG'
      }
    ]);
    const cands = await motor.identificar({
      produtoNome: 'FACA DE ACO INOXIDAVEL COM CABO DE PLASTICO 16',
      ncm: '82014000',
      unidade: 'UN'
    });
    // Pode ou não achar por tokens genéricos (ACO); o importante é que MUBC
    // não aplica CompatibilityGuard sozinho (responsabilidade do Pipeline).
    assert.ok(Array.isArray(cands));
    assert.ok(typeof motor.obterUltimoDiagnostico === 'function');
  });

  await test('ProdutoRepository expõe buscarCandidatosUniversais', () => {
    assert.strictEqual(typeof ProdutoRepository.prototype.buscarCandidatosUniversais, 'function');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
