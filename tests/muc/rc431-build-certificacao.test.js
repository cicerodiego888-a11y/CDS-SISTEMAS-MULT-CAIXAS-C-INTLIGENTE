/**
 * RC4.31.1 — Certificação final de contratos públicos MUC + bootstrap ERP
 * Executar: node tests/muc/rc431-build-certificacao.test.js
 * Pipeline: npm run test:muc-certificacao
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

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

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function requireRel(rel) {
  return require(path.join(ROOT, rel));
}

const CONTRATOS = Object.freeze({
  'backend/motores/muc/public.js': {
    exports: [
      'obterMuc', 'VERSAO', 'EVENTOS_PUBLICOS',
      'criarConversaoDTO', 'criarResultadoConversaoDTO',
      'criarProdutoApresentacaoDTO', 'criarProdutoApresentacaoLegadoDTO',
      'criarListaProdutoApresentacaoDTO', 'criarRegraConversaoDTO',
      'resultadoParaJson', 'resultadoFromJson'
    ],
    funcoes: [
      'obterMuc', 'criarConversaoDTO', 'criarResultadoConversaoDTO',
      'criarProdutoApresentacaoDTO', 'criarProdutoApresentacaoLegadoDTO',
      'criarListaProdutoApresentacaoDTO', 'criarRegraConversaoDTO',
      'resultadoParaJson', 'resultadoFromJson'
    ]
  },
  'backend/motores/muc/constants/tiposApresentacao.js': {
    exports: [
      'TIPOS_APRESENTACAO', 'LABELS_APRESENTACAO',
      'MAPA_TIPO_PARA_UNIDADE_COMERCIAL', 'MAPA_UNIDADE_COMERCIAL_PARA_TIPO',
      'normalizarTipoApresentacao', 'tipoParaUnidadeComercial',
      'unidadeComercialParaTipo', 'labelApresentacao'
    ],
    funcoes: [
      'normalizarTipoApresentacao', 'tipoParaUnidadeComercial',
      'unidadeComercialParaTipo', 'labelApresentacao'
    ]
  },
  'backend/services/produto-embalagem/tiposApresentacao.js': {
    reexportDe: 'backend/motores/muc/constants/tiposApresentacao.js',
    funcoes: ['unidadeComercialParaTipo', 'normalizarTipoApresentacao', 'tipoParaUnidadeComercial']
  },
  'backend/motores/muc/index.js': {
    exports: ['obterMuc', 'resultadoParaJson', 'criarProdutoApresentacaoDTO', 'VERSAO'],
    funcoes: ['obterMuc', 'resultadoParaJson', 'criarProdutoApresentacaoDTO']
  }
});

const CONSUMIDORES_ERP = Object.freeze([
  {
    arquivo: 'backend/services/produto-embalagem/produtoEmbalagensSchema.js',
    importDe: 'backend/services/produto-embalagem/tiposApresentacao.js',
    simbolos: ['unidadeComercialParaTipo']
  },
  {
    arquivo: 'backend/services/produto-embalagem/ProdutoEmbalagemService.js',
    importDe: 'backend/services/produto-embalagem/tiposApresentacao.js',
    simbolos: ['normalizarTipoApresentacao', 'tipoParaUnidadeComercial']
  },
  {
    arquivo: 'backend/services/produto-embalagem/ProdutoEmbalagemService.js',
    importDe: 'backend/motores/muc/index.js',
    simbolos: ['criarProdutoApresentacaoDTO']
  },
  {
    arquivo: 'backend/services/produto-embalagem/ProdutoEmbalagemService.js',
    importDe: 'backend/motores/muc/constants/tiposConversao.js',
    simbolos: ['inferirTipoConversao', 'normalizarTipoConversao']
  },
  {
    arquivo: 'backend/rotas/compras.js',
    importDe: 'backend/motores/muc/index.js',
    simbolos: ['obterMuc', 'resultadoParaJson']
  }
]);

const FACADE_METODOS = [
  'converter', 'processarItemCompra', 'simular',
  'buscarApresentacao', 'aprender', 'exportarMetricas', 'obterVersao'
];

console.log('\n=== RC4.31.1 — Certificação Build Electron (MUC) ===\n');

Object.entries(CONTRATOS).forEach(([relMod, cfg]) => {
  test(`Exports — ${relMod}`, () => {
    const mod = requireRel(relMod);
    (cfg.exports || []).forEach((nome) => {
      assert.ok(nome in mod, `export ausente: ${nome}`);
    });
    (cfg.funcoes || []).forEach((nome) => {
      assert.strictEqual(typeof mod[nome], 'function', `${nome} deve ser function`);
    });
    if (cfg.reexportDe) {
      const canon = requireRel(cfg.reexportDe);
      (cfg.funcoes || []).forEach((nome) => {
        assert.strictEqual(mod[nome], canon[nome], `re-export divergente: ${nome}`);
      });
    }
  });
});

CONSUMIDORES_ERP.forEach((c) => {
  test(`Consumidor — ${path.basename(c.arquivo)} ← ${c.simbolos.join(', ')}`, () => {
    const mod = requireRel(c.importDe);
    c.simbolos.forEach((s) => {
      assert.strictEqual(typeof mod[s], 'function', `${s} não exportado em ${c.importDe}`);
    });
  });
});

test('Facade — 7 métodos públicos RC2.1', () => {
  const { obterMuc } = requireRel('backend/motores/muc/public.js');
  const mockDb = {
    run(s, p, cb) { if (typeof p === 'function') p(null); else if (cb) cb(null); },
    get(s, p, cb) { if (typeof p === 'function') p(null, null); else if (cb) cb(null, null); },
    all(s, p, cb) { if (typeof p === 'function') p(null, []); else if (cb) cb(null, []); }
  };
  const muc = obterMuc(mockDb);
  FACADE_METODOS.forEach((m) => {
    assert.strictEqual(typeof muc[m], 'function', `facade.${m} ausente`);
  });
});

[
  'backend/services/produto-embalagem/produtoEmbalagensSchema.js',
  'backend/services/produto-embalagem/tiposApresentacao.js',
  'backend/services/produto-embalagem/ProdutoEmbalagemService.js',
  'backend/motores/muc/public.js',
  'backend/motores/muc/index.js',
  'backend/motores/muc/schema/mucSchema.js',
  'backend/rotas/compras.js',
  'backend/rotas/produtos.js',
  'backend/lib/sqlCertification/index.js',
  'backend/lib/validateInsertAlignment.js',
  'backend/lib/scanSqlCertificationInSource.js'
].forEach((rel) => {
  test(`Smoke require — ${rel}`, () => {
    requireRel(rel);
  });
});

test('RC4.31.6 — database.js aplica certificação universal SQL', () => {
  const src = ler('backend/database.js');
  assert.match(src, /aplicarCertificacaoSql\s*\(\s*db\s*\)/);
  assert.doesNotMatch(src, /runComValidacaoInsert/);
});

test('RC4.31.6 — módulo sqlCertification exporta API universal', () => {
  const mod = requireRel('backend/lib/sqlCertification/index.js');
  [
    'validateSql', 'validateUpdate', 'validateDelete', 'validateSelect',
    'aplicarCertificacaoSql', 'gerarRelatorioCertificacao'
  ].forEach((nome) => {
    assert.strictEqual(typeof mod[nome], 'function', `${nome} ausente`);
  });
});

[
  'backend/services/produto-embalagem/ProdutoEmbalagemService.js',
  'backend/services/produto-embalagem/produtoEmbalagensSchema.js',
  'backend/rotas/compras.js',
  'backend/rotas/produtos.js'
].forEach((rel) => {
  test(`Política import — ${rel} sem core/pipeline MUC`, () => {
    const src = ler(rel);
    assert.doesNotMatch(src, /motores\/muc\/core\//);
    assert.doesNotMatch(src, /motores\/muc\/pipeline\//);
  });
});

test('Integridade app.asar (opcional pós-build)', () => {
  const requireAsar = process.argv.includes('--require-asar');
  const asarCandidates = [
    process.env.CDS_ASAR_PATH,
    path.join(ROOT, 'dist', 'erp', 'win-unpacked', 'resources', 'app.asar')
  ].filter(Boolean);

  const asarPath = asarCandidates.find((p) => fs.existsSync(p));
  if (!asarPath) {
    if (requireAsar) assert.fail('app.asar não encontrado — executar npm run build:erp');
    console.log('       (skip — app.asar não encontrado; validar após npm run build:erp)');
    return;
  }

  const { compararRepoComAsar, lerManifesto, gerarManifesto } = requireRel('electron-integrity.js');
  let manifesto;
  try {
    manifesto = lerManifesto(ROOT);
  } catch {
    manifesto = gerarManifesto(ROOT, { modulo: 'erp' });
  }

  const cmp = compararRepoComAsar(ROOT, asarPath, { manifesto, modulo: 'erp' });
  if (!cmp.ok) {
    if (requireAsar) {
      assert.fail(`asar divergente:\n${(cmp.erros || []).slice(0, 5).join('\n')}`);
    }
    console.log(`       (skip — asar desatualizado: ${(cmp.erros || [])[0] || 'divergência'}; rebuild necessário)`);
    return;
  }

  const tiposRel = 'backend/motores/muc/constants/tiposApresentacao.js';
  assert.ok(manifesto.arquivos[tiposRel], `${tiposRel} ausente no manifesto`);
});

function executarBootstrapSchemas(callback) {
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(':memory:');
  const { garantirSchemaProdutoEmbalagens } = requireRel('backend/services/produto-embalagem/produtoEmbalagensSchema.js');
  const { garantirSchemaMuc } = requireRel('backend/motores/muc/schema/mucSchema.js');
  const { unidadeComercialParaTipo } = requireRel('backend/services/produto-embalagem/tiposApresentacao.js');

  db.serialize(() => {
    db.run(`CREATE TABLE produtos (
      id INTEGER PRIMARY KEY,
      unidade TEXT, unidade_comercial TEXT, quantidade_por_embalagem REAL,
      compra_por_embalagem INTEGER, valor_compra_embalagem REAL, preco_venda REAL,
      codigo_barras TEXT, fornecedor TEXT
    )`);

    db.run(`CREATE TABLE compras_itens (id INTEGER PRIMARY KEY)`);

    db.run(
      `INSERT INTO produtos (id, unidade, unidade_comercial, quantidade_por_embalagem, compra_por_embalagem)
       VALUES (1, 'un', 'CAIXA', 12, 1)`,
      (insErr) => {
        if (insErr) return callback(insErr);

        try {
          assert.strictEqual(unidadeComercialParaTipo('CAIXA'), 'CX');
        } catch (e) {
          db.close();
          return callback(e);
        }

        garantirSchemaProdutoEmbalagens(db, (embErr) => {
          if (embErr) {
            db.close();
            return callback(embErr);
          }

          garantirSchemaMuc(db, (mucErr) => {
            if (mucErr) {
              db.close();
              return callback(mucErr);
            }

            db.get(
              'SELECT tipo, quantidade FROM produto_embalagens WHERE produto_id = 1',
              [],
              (qErr, row) => {
                db.close();
                if (qErr) return callback(qErr);
                try {
                  assert.ok(row, 'migração legado deve criar embalagem');
                  assert.strictEqual(row.tipo, 'CX');
                  assert.strictEqual(row.quantidade, 12);
                  callback(null);
                } catch (assertErr) {
                  callback(assertErr);
                }
              }
            );
          });
        });
      }
    );
  });
}

executarBootstrapSchemas((bootstrapErr) => {
  if (bootstrapErr) {
    falhas += 1;
    console.error('  FAIL  Bootstrap — schemas produto_embalagens + MUC');
    console.error(`       ${bootstrapErr.message}`);
  } else {
    ok += 1;
    console.log('  OK  Bootstrap — schemas produto_embalagens + MUC');
  }

  console.log(`\nResultado: ${ok} OK, ${falhas} falha(s)\n`);
  process.exit(falhas > 0 ? 1 : 0);
});
