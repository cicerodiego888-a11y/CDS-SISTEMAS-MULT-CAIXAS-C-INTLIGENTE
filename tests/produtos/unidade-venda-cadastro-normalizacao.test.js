'use strict';

/**
 * Unidade de venda no cadastro de produtos: o <select id="unidade"> comparava só minúsculas.
 * Produto gravado como "KG" abria em "Unidade"; "CX"/"PCT" viravam "un" ao salvar outro campo;
 * a Central de Compras deixava o select sem seleção ("KG") e o payload saía com unidade vazia.
 * Template e funções reais de produtos.js + rotas reais de produtos sobre banco SQLite temporário.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const ROOT = path.join(__dirname, '../..');
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const srcProdutos = ler('frontend/erp/js/produtos.js');
const srcCompras = ler('frontend/erp/js/compras.js');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-unidade-venda-'));
process.env.DB_DIR = dbDir;
delete require.cache[require.resolve('../../backend/database')];
const db = require('../../backend/database');

function extrair(src, inicio, fim) {
  const a = src.indexOf(inicio);
  const b = src.indexOf(fim, a);
  if (a < 0 || b < 0) throw new Error(`Trecho não encontrado: ${inicio}`);
  return src.slice(a, b);
}

/** <select> mínimo com a semântica do HTML: sem option marcada, exibe/envia a 1ª; value inexistente deixa sem seleção. */
class SelectHtml {
  constructor(opcoes) { this.options = opcoes; }
  add(opt) { this.options.push(opt); }
  get value() {
    const marcadas = this.options.filter((o) => o.selected);
    if (marcadas.length) return marcadas[marcadas.length - 1].value;
    return this.semSelecao ? '' : (this.options[0]?.value ?? '');
  }
  set value(v) {
    this.options.forEach((o) => { o.selected = o.value === v; });
    this.semSelecao = !this.options.some((o) => o.selected);
  }
  get rotulo() { return this.options.find((o) => o.value === this.value)?.text; }
}

function OptionHtml(text, value) {
  return { text, value, selected: false };
}

function carregarCadastro() {
  const sandbox = {
    console,
    Option: OptionHtml,
    escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    extrair(srcProdutos, 'const UNIDADES_VENDA_CONVERSAO', 'function produtoCadastroUsaConversaoUnidades'),
    sandbox
  );
  const template = srcProdutos.match(/<select class="form-control" id="unidade">[\s\S]*?<\/select>/)[0];
  vm.runInContext(`this.renderSelectUnidade = (isEdit, produto) => \`${template}\`;`, sandbox);
  return sandbox;
}

const cadastro = carregarCadastro();

/** Abre o formulário: renderiza o template real e devolve o <select> como o navegador o interpreta. */
function abrirFormulario(produto, isEdit = true) {
  const html = cadastro.renderSelectUnidade(isEdit, produto);
  const opcoes = [...html.matchAll(/<option value="([^"]*)"\s*(selected)?\s*>([^<]*)</g)]
    .map((m) => ({ value: m[1], selected: Boolean(m[2]), text: m[3] }));
  return new SelectHtml(opcoes);
}

/** Mesmo trecho do payload de saveProduto: `unidade: ($('#unidade').val() || '').trim()`. */
const unidadeDoPayload = (select) => String(select.value || '').trim();

let app;
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function cb(e) { return e ? rej(e) : res(this); }));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));

async function inserirProduto(nome, unidade, { pesavel = 0 } = {}) {
  const r = await run(
    `INSERT INTO produtos (codigo, nome, nome_busca, ativo, unidade, preco_compra, preco_venda, estoque_atual,
       saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque, produto_fracionado, vendido_por_peso)
     VALUES (?, ?, ?, 1, ?, 10, 20, 0, 0, 0, 1, 0, ?, ?)`,
    [`UV-${nome}`, nome, nome.toLowerCase(), unidade, pesavel, pesavel]
  );
  return r.lastID;
}

async function abrirEdicao(id) {
  const r = await request(app).get(`/api/produtos/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { produto: r.body, select: abrirFormulario(r.body) };
}

before(async () => {
  await new Promise((resolve, reject) => db.whenReady((err) => (err ? reject(err) : resolve())));
  app = express();
  app.use(express.json());
  app.use('/api/produtos', require('../../backend/rotas/produtos'));
});

describe('Teste A — normalização na edição', () => {
  it('KG, Kg, kg e " KG " selecionam Quilograma', () => {
    for (const unidade of ['KG', 'Kg', 'kg', ' KG ']) {
      const select = abrirFormulario({ unidade });
      assert.equal(select.value, 'kg', unidade);
      assert.equal(select.rotulo, 'Quilograma', unidade);
      assert.equal(select.options.filter((o) => o.selected).length, 1, unidade);
    }
  });

  it('UN/un/und → Unidade; LT/lt → Litro; M/m → Metro (aliases do projeto)', () => {
    const casos = { UN: 'un', un: 'un', und: 'un', UND: 'un', LT: 'l', lt: 'l', l: 'l', M: 'mt', m: 'mt', MT: 'mt', M2: 'm2', ML: 'ml', G: 'g' };
    for (const [gravado, esperado] of Object.entries(casos)) {
      assert.equal(abrirFormulario({ unidade: gravado }).value, esperado, gravado);
    }
  });

  it('produto novo continua abrindo em Unidade, sem opção extra', () => {
    const select = abrirFormulario(null, false);
    assert.equal(select.value, 'un');
    assert.equal(select.options.length, 8);
    assert.ok(select.options.every((o) => !o.selected));
  });
});

describe('Teste B — preservação de unidades não padronizadas', () => {
  it('CX, PCT, Pct e PC1 ficam selecionadas como gravadas, sem virar "un"', () => {
    for (const unidade of ['CX', 'PCT', 'Pct', 'PC1']) {
      const select = abrirFormulario({ unidade });
      assert.equal(select.value, unidade, unidade);
      assert.equal(select.rotulo, unidade, unidade);
      assert.equal(select.options.length, 9, unidade);
    }
  });

  it('valor gravado é escapado na opção preservada', () => {
    const select = abrirFormulario({ unidade: 'C"X' });
    assert.equal(select.value, 'C&quot;X');
    assert.equal(cadastro.normalizarUnidadeCadastroProduto('C"X'), 'C"X');
  });
});

describe('Teste C — salvar outro campo não altera a unidade (rota real)', () => {
  it('produto CX: altera só o nome, salva e reabre com CX', async () => {
    const id = await inserirProduto('Caixa Fosforo', 'CX');
    const { select } = await abrirEdicao(id);
    assert.equal(select.value, 'CX');

    const put = await request(app).put(`/api/produtos/${id}`)
      .send({ nome: 'Caixa Fosforo Grande', unidade: unidadeDoPayload(select), produto_fracionado: 0 });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const gravado = await get('SELECT nome, unidade FROM produtos WHERE id = ?', [id]);
    assert.deepEqual(gravado, { nome: 'Caixa Fosforo Grande', unidade: 'CX' });
    assert.equal((await abrirEdicao(id)).select.value, 'CX');
  });

  it('produto Kg (comum): salvar outro campo grava "kg", não "un"', async () => {
    const id = await inserirProduto('Granel Kg', 'Kg');
    const { select } = await abrirEdicao(id);
    await request(app).put(`/api/produtos/${id}`).send({ nome: 'Granel Kg 2', unidade: unidadeDoPayload(select) });
    assert.equal((await get('SELECT unidade FROM produtos WHERE id = ?', [id])).unidade, 'kg');
  });
});

describe('Teste D — produto pesável gravado como KG', () => {
  it('abre em Quilograma, passa na validação de pesável e continua kg após salvar e reabrir', async () => {
    const id = await inserirProduto('Picadinho', 'KG', { pesavel: 1 });
    await request(app).put(`/api/produtos/${id}`).send({ plu: '2' });

    const { produto, select } = await abrirEdicao(id);
    assert.equal(produto.unidade, 'KG');
    assert.equal(produto.produto_fracionado, 1);
    assert.equal(select.rotulo, 'Quilograma');
    assert.equal(cadastro.unidadeVendaSuportaConversao(select.value), true);

    const put = await request(app).put(`/api/produtos/${id}`).send({
      nome: 'Picadinho',
      unidade: unidadeDoPayload(select),
      produto_fracionado: 1,
      vendido_por_peso: 1,
      produto_pesavel: 1,
      plu: '2',
      preco_venda: 28.99
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.unidade, 'kg');
    const reaberto = await abrirEdicao(id);
    assert.equal(reaberto.produto.plu, '2');
    assert.equal(reaberto.select.rotulo, 'Quilograma');
  });

  it('validação de unidade fracionável continua barrando unidade comum ou não padronizada', () => {
    assert.equal(cadastro.unidadeVendaSuportaConversao(abrirFormulario({ unidade: 'UN' }).value), false);
    assert.equal(cadastro.unidadeVendaSuportaConversao(abrirFormulario({ unidade: 'CX' }).value), false);
    assert.equal(cadastro.unidadeVendaSuportaConversao(abrirFormulario({ unidade: 'Kg' }).value), true);
  });
});

describe('Teste E — Central de Compras', () => {
  it('antes da correção: atribuir "KG" ao select deixava sem seleção e o payload vazio', () => {
    const select = abrirFormulario(null, false);
    select.value = 'KG';
    assert.equal(unidadeDoPayload(select), '');
  });

  it('KG da nota seleciona Quilograma e o cadastro grava "kg" (POST real)', async () => {
    const select = abrirFormulario(null, false);
    assert.equal(cadastro.selecionarUnidadeCadastroProduto({ jquery: '3', 0: select }, 'KG'), 'kg');
    assert.equal(select.rotulo, 'Quilograma');
    assert.equal(unidadeDoPayload(select), 'kg');

    const post = await request(app).post('/api/produtos').send({
      nome: 'Frango Compra Teste', unidade: unidadeDoPayload(select), preco_venda: 12.49, preco_compra: 8,
      produto_fracionado: 1, vendido_por_peso: 1, controla_estoque: 0
    });
    assert.ok([200, 201].includes(post.status), JSON.stringify(post.body));
    const id = post.body.id || post.body.produto?.id;
    assert.ok(id, JSON.stringify(post.body));
    assert.equal((await get('SELECT unidade FROM produtos WHERE id = ?', [id])).unidade, 'kg');
  });

  it('CX da nota é preservada (opção adicionada), nunca vazia', () => {
    const select = abrirFormulario(null, false);
    assert.equal(cadastro.selecionarUnidadeCadastroProduto(select, 'CX'), 'CX');
    assert.equal(unidadeDoPayload(select), 'CX');
    assert.equal(select.rotulo, 'CX');
  });

  it('os dois pré-preenchimentos de compras.js usam a seleção normalizada', () => {
    assert.doesNotMatch(srcCompras, /\$\('#unidade'\)\.val\((item|prefill)\.unidade/);
    const usos = srcCompras.match(/selecionarUnidadeCadastroProduto\(\$\('#unidade'\), (item\.unidade \|\| 'UN'|prefill\.unidade)\)/g) || [];
    assert.equal(usos.length, 2);
  });
});

describe('Teste F — adaptadores de balança com "KG" salvo como "kg"', () => {
  const ToledoPluMapper = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluMapper');
  const ToledoPluValidator = require('../../backend/motores/equipamentos/drivers/toledo/plu/ToledoPluValidator');
  const ProdutoMapper = require('../../backend/motores/equipamentos/services/ProdutoMapper');
  const base = { id: 740, codigo: '740', nome: 'Picadinho', plu: '2', preco_venda: 28.99, produto_fracionado: 1, ativo: 1, departamento: 1 };
  const semUnidade = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.unidade; return c; };

  it('Toledo PLU: mesmo PLU e mesma validação, só o texto da unidade muda', () => {
    const maiusc = ToledoPluMapper.map({ ...base, unidade: 'KG' });
    const minusc = ToledoPluMapper.map({ ...base, unidade: 'kg' });
    assert.deepEqual(semUnidade(minusc), semUnidade(maiusc));
    assert.equal(minusc.unidade, 'kg');
    const vMaiusc = ToledoPluValidator.validate(maiusc, { ...base, unidade: 'KG' });
    const vMinusc = ToledoPluValidator.validate(minusc, { ...base, unidade: 'kg' });
    assert.equal(vMinusc.ok, vMaiusc.ok);
    assert.deepEqual(vMinusc.errors, vMaiusc.errors);
  });

  it('ProdutoMapper: pesável e demais campos iguais para KG, kg e Kg', () => {
    const dtos = ['KG', 'kg', 'Kg'].map((unidade) => ProdutoMapper.toDTO({ ...base, unidade }));
    for (const dto of dtos) {
      assert.equal(dto.pesavel, true);
      assert.deepEqual(semUnidade(dto), semUnidade(dtos[0]));
    }
  });
});
