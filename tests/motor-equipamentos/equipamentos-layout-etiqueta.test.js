/**
 * Sprint EQUIPAMENTOS 02 — Configuração oficial de balanças / layout etiqueta
 * Aceite: 2000067010019 → PLU 67 (Toledo 6+5 Valor)
 * Executar: node tests/motor-equipamentos/equipamentos-layout-etiqueta.test.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

const {
  parseEtiquetaComLayout,
  obterPreset,
  listarPresets,
  normalizarLayoutEtiqueta
} = (() => {
  const presets = require('../../backend/motores/equipamentos/layouts/presetsEtiqueta');
  const norm = require('../../backend/motores/equipamentos/layouts/LayoutEtiquetaNormalizer');
  const parser = require('../../backend/motores/equipamentos/layouts/ConfiguravelEtiquetaParser');
  return {
    parseEtiquetaComLayout: parser.parseEtiquetaComLayout,
    obterPreset: presets.obterPreset,
    listarPresets: presets.listarPresets,
    normalizarLayoutEtiqueta: norm.normalizarLayoutEtiqueta
  };
})();

const {
  ProdutoIdentidadeService,
  ProdutoIdentificadoresService,
  garantirSchemaProdutoIdentificadores,
  TIPOS_IDENTIFICADOR,
  setProdutoIdentidadeEnabled
} = require('../../backend/motores/produto-identidade');

const CODIGO_ACEITE = '2000067010019';

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

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function cb(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function closeDb(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function main() {
  console.log('\n=== Sprint EQUIPAMENTOS 02 — Layout etiqueta ===\n');

  await test('presets oficiais disponíveis', () => {
    const presets = listarPresets();
    assert.ok(presets.length >= 6);
    assert.ok(presets.some((p) => p.id === 'toledo_prix4_uno_valor'));
    assert.ok(presets.some((p) => p.nome === 'Filizola'));
  });

  await test('parser configurável: 2000067010019 → PLU 67 (Toledo Valor)', () => {
    const layout = obterPreset('toledo_prix4_uno_valor');
    const parsed = parseEtiquetaComLayout(CODIGO_ACEITE, layout);
    assert.ok(parsed);
    assert.strictEqual(parsed.plu, '67');
    assert.strictEqual(parsed.pluRaw, '000067');
    assert.strictEqual(parsed.tipoPayload, 'VALOR');
    assert.strictEqual(Number(parsed.valorTotal.toFixed(2)), 10.01);
  });

  await test('parser não usa hardcode — layout legado diverge no mesmo código', () => {
    const legado = parseEtiquetaComLayout(CODIGO_ACEITE, obterPreset('legado_cds_valor_56'));
    const toledo = parseEtiquetaComLayout(CODIGO_ACEITE, obterPreset('toledo_prix4_uno_valor'));
    assert.ok(legado);
    assert.ok(toledo);
    assert.notStrictEqual(legado.plu, toledo.plu);
    assert.strictEqual(toledo.plu, '67');
  });

  await test('normalização rejeita layout inconsistente', () => {
    const bad = normalizarLayoutEtiqueta({
      prefixo: '2',
      digitos_plu: 6,
      digitos_variavel: 5,
      posicao_inicial: 8,
      posicao_final: 12,
      tamanho_total: 12,
      digito_verificador: true,
      tipo_variavel: 'VALOR'
    });
    assert.strictEqual(bad.ok, false);
  });

  // Integração MIP com layout injetado (sem depender do DB global)
  const file = path.join(os.tmpdir(), `eq02-layout-${Date.now()}.db`);
  const db = await openDb(file);
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, `
    CREATE TABLE produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo VARCHAR(50) UNIQUE,
      nome VARCHAR(200) NOT NULL,
      codigo_barras TEXT,
      unidade TEXT,
      preco_venda DECIMAL(10,2) DEFAULT 0,
      ativo INTEGER DEFAULT 1
    )
  `);
  await run(db, `
    CREATE TABLE equipamentos_configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipamento_id INTEGER NOT NULL,
      chave TEXT NOT NULL,
      valor TEXT,
      UNIQUE(equipamento_id, chave)
    )
  `);
  await run(db, `
    CREATE TABLE configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave VARCHAR(100) UNIQUE NOT NULL,
      valor TEXT,
      tipo VARCHAR(50),
      descricao TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await new Promise((resolve, reject) => {
    garantirSchemaProdutoIdentificadores(db, (err) => (err ? reject(err) : resolve()));
  });

  const prod = await run(db, `
    INSERT INTO produtos (codigo, nome, unidade, preco_venda, ativo)
    VALUES ('67', 'Produto PLU 67', 'KG', 10.01, 1)
  `);
  const idService = new ProdutoIdentificadoresService({ db });
  await idService.upsertPrincipal(prod.lastID, TIPOS_IDENTIFICADOR.PLU, '67', { origem: 'teste_eq02' });

  setProdutoIdentidadeEnabled(true);
  const mip = new ProdutoIdentidadeService({ db });

  await test('MIP resolve 2000067010019 → produto PLU 67 com layout Toledo', async () => {
    const resultado = await mip.resolve(CODIGO_ACEITE, {
      layoutConfig: obterPreset('toledo_prix4_uno_valor')
    });
    assert.ok(resultado?.encontrado);
    assert.strictEqual(String(resultado.produto?.id || resultado.produtoId), String(prod.lastID));
    assert.strictEqual(resultado.meta?.plu, '67');
  });

  await closeDb(db);

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
