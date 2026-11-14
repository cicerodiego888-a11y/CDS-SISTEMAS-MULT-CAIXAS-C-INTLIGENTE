'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sqlite3 = require('sqlite3');
const {
  prepararAtualizacoesPrecoCatalogo,
  gravarPrecoCadastroImediato,
  finalizarTransacaoVendaPdv
} = require('../../backend/services/vendas/PdvPrecoCadastroService');

function executar(db, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, parametros, function (erro) {
      if (erro) return reject(erro);
      resolve(this);
    });
  });
}

function consultar(db, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, parametros, (erro, linha) => {
      if (erro) return reject(erro);
      resolve(linha);
    });
  });
}

function preparar(db, req) {
  return new Promise((resolve, reject) => {
    prepararAtualizacoesPrecoCatalogo(db, req, (erro, atualizacoes) => {
      if (erro) return reject(erro);
      resolve(atualizacoes);
    });
  });
}

function finalizar(db, atualizacoes, vendaId = 50) {
  return new Promise((resolve, reject) => {
    finalizarTransacaoVendaPdv(
      db,
      atualizacoes,
      vendaId,
      7,
      'Operador de teste',
      (erro) => erro ? reject(erro) : resolve()
    );
  });
}

async function criarDb() {
  const db = new sqlite3.Database(':memory:');
  await executar(db, 'CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT)');
  await executar(db, 'INSERT INTO configuracoes (chave, valor) VALUES (?, ?)', [
    'pdv_permitir_editar_preco_unitario',
    'ATIVADO'
  ]);
  await executar(db, `CREATE TABLE usuario_permissoes (
    usuario_id INTEGER, permissao TEXT, permitido INTEGER
  )`);
  await executar(db, `CREATE TABLE produtos (
    id INTEGER PRIMARY KEY, preco_venda REAL, preco_unidade REAL, updated_at TEXT
  )`);
  await executar(db, 'CREATE TABLE vendas (id INTEGER PRIMARY KEY, total REAL)');
  await executar(db, `CREATE TABLE produto_atacado (
    id INTEGER PRIMARY KEY, produto_id INTEGER, quantidade_minima INTEGER,
    preco_atacado REAL, updated_at TEXT
  )`);
  await executar(db, `CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY, usuario_id INTEGER, usuario_nome TEXT, modulo TEXT,
    acao TEXT, referencia_tipo TEXT, referencia_id INTEGER, detalhes TEXT,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await executar(db, 'INSERT INTO produtos (id, preco_venda, preco_unidade) VALUES (1, 10, 4)');
  await executar(db, 'INSERT INTO produto_atacado (id, produto_id, quantidade_minima, preco_atacado) VALUES (21, 1, 2, 8)');
  await executar(db, 'INSERT INTO produto_atacado (id, produto_id, quantidade_minima, preco_atacado) VALUES (22, 1, 5, 7)');
  return db;
}

function solicitacao(overrides = {}) {
  return {
    produto_id: 1,
    preco_unitario: 9.25,
    quantidade: 1,
    tipo_preco: 'varejo',
    tipo_venda: 'PESO',
    atualizar_preco_cadastro: true,
    ...overrides
  };
}

describe('PDV — alteração opcional e transacional do preço cadastrado', () => {
  it('não gera intenção cadastral quando o checkbox está desmarcado', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());

    const atualizacoes = await preparar(db, {
      body: { itens: [solicitacao({ atualizar_preco_cadastro: false })] },
      user: { id: 7, role: 'admin' }
    });

    assert.deepEqual(atualizacoes, []);
    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 10);
  });

  it('exige permissão de edição de produtos para atualizar o cadastro', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());

    await assert.rejects(
      preparar(db, {
        body: { itens: [solicitacao()] },
        user: { id: 7, role: 'operador', perfil: 'USUARIO' }
      }),
      (erro) => erro.status === 403
    );
    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 10);
  });

  it('atualiza somente o preço varejista correspondente e audita dentro da transação', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());
    const atualizacoes = await preparar(db, {
      body: { itens: [solicitacao()] },
      user: { id: 7, role: 'admin' }
    });

    await executar(db, 'BEGIN IMMEDIATE');
    await finalizar(db, atualizacoes);
    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 9.25);
    assert.equal((await consultar(db, 'SELECT preco_unidade FROM produtos WHERE id = 1')).preco_unidade, 4);

    const auditoria = await consultar(db, 'SELECT * FROM auditoria WHERE referencia_id = 1');
    const detalhes = JSON.parse(auditoria.detalhes);
    assert.equal(auditoria.acao, 'ALTERACAO_PRECO_CADASTRO');
    assert.equal(detalhes.venda_id, 50);
    assert.equal(detalhes.tabela_comercial, 'VAREJO');
    assert.equal(detalhes.preco_anterior, 10);
    assert.equal(detalhes.preco_novo, 9.25);
    assert.equal(detalhes.operador_nome, 'Operador de teste');
  });

  it('atualiza o campo de preço por unidade sem alterar o preço varejista padrão', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());
    const atualizacoes = await preparar(db, {
      body: { itens: [solicitacao({ tipo_venda: 'UNIDADE', preco_unitario: 3.75 })] },
      user: { id: 7, role: 'admin' }
    });

    await executar(db, 'BEGIN IMMEDIATE');
    await finalizar(db, atualizacoes);

    assert.equal((await consultar(db, 'SELECT preco_unidade FROM produtos WHERE id = 1')).preco_unidade, 3.75);
    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 10);
  });

  it('atualiza somente a faixa de atacado selecionada para a quantidade vendida', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());
    const atualizacoes = await preparar(db, {
      body: {
        itens: [solicitacao({
          preco_unitario: 6.75,
          quantidade: 6,
          tipo_preco: 'atacado',
          faixa_atacado_id: 22
        })]
      },
      user: { id: 7, role: 'admin' }
    });

    await executar(db, 'BEGIN IMMEDIATE');
    await finalizar(db, atualizacoes);

    assert.equal((await consultar(db, 'SELECT preco_atacado FROM produto_atacado WHERE id = 22')).preco_atacado, 6.75);
    assert.equal((await consultar(db, 'SELECT preco_atacado FROM produto_atacado WHERE id = 21')).preco_atacado, 8);
  });

  it('rejeita uma faixa atacadista que não corresponde à quantidade aplicada', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());
    const atualizacoes = await preparar(db, {
      body: {
        itens: [solicitacao({
          quantidade: 6,
          tipo_preco: 'atacado',
          faixa_atacado_id: 21
        })]
      },
      user: { id: 7, role: 'admin' }
    });
    await executar(db, 'BEGIN IMMEDIATE');
    await assert.rejects(finalizar(db, atualizacoes), /faixa de atacado informada/);
    assert.equal((await consultar(db, 'SELECT preco_atacado FROM produto_atacado WHERE id = 21')).preco_atacado, 8);
  });

  it('reverte preço e auditoria quando a persistência da auditoria falha', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());
    const atualizacoes = await preparar(db, {
      body: { itens: [solicitacao()] },
      user: { id: 7, role: 'admin' }
    });
    await executar(db, 'DROP TABLE auditoria');
    await executar(db, 'BEGIN IMMEDIATE');
    await executar(db, 'INSERT INTO vendas (id, total) VALUES (50, 9.25)');
    await assert.rejects(finalizar(db, atualizacoes), /no such table: auditoria/i);

    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 10);
    assert.equal(await consultar(db, 'SELECT id FROM vendas WHERE id = 50'), undefined);
  });

  it('não duplica a auditoria quando a mesma atualização já foi concluída', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());
    const atualizacoes = await preparar(db, {
      body: { itens: [solicitacao()] },
      user: { id: 7, role: 'admin' }
    });

    await executar(db, 'BEGIN IMMEDIATE');
    await finalizar(db, atualizacoes, 50);
    await executar(db, 'BEGIN IMMEDIATE');
    await finalizar(db, atualizacoes, 51);

    assert.equal((await consultar(db, 'SELECT COUNT(*) AS total FROM auditoria')).total, 1);
    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 9.25);
  });

  it('não presume nem atualiza uma tabela EVENTO sem contexto cadastral existente', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());

    await assert.rejects(
      preparar(db, {
        body: { itens: [solicitacao({ tipo_preco: 'evento' })] },
        user: { id: 7, role: 'admin' }
      }),
      /Não existe tabela de preço cadastrada compatível/
    );
  });

  it('grava o preço no cadastro assim que a opção é confirmada', async (t) => {
    const db = await criarDb();
    t.after(() => db.close());

    const atualizacao = await new Promise((resolve, reject) => {
      gravarPrecoCadastroImediato(db, {
        body: { itens: [solicitacao({ preco_unitario: 12 })] },
        user: { id: 7, role: 'admin', nome: 'Operador' }
      }, (erro, resultado) => (erro ? reject(erro) : resolve(resultado)));
    });

    assert.equal(atualizacao.preco, 12);
    assert.equal(atualizacao.campo, 'preco_venda');
    assert.equal((await consultar(db, 'SELECT preco_venda FROM produtos WHERE id = 1')).preco_venda, 12);
    assert.equal((await consultar(db, 'SELECT COUNT(*) AS total FROM auditoria')).total, 1);
  });

  it('mantém a confirmação no modal desmarcada e grava o cadastro na confirmação', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/pdv/index.html'), 'utf8');
    const js = fs.readFileSync(path.resolve(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    const inputCheckbox = html.match(/<input[^>]+id="modalPrecoUnitarioPdvCheckbox"[^>]*>/);

    assert.ok(inputCheckbox);
    assert.doesNotMatch(inputCheckbox[0], /\bchecked\b/i);
    assert.match(js, /atualizar_preco_cadastro:\s*item\.atualizar_preco_cadastro === true/);
    assert.match(js, /\/vendas\/preco-cadastro/);
    assert.match(js, /Com a opção marcada, o preço é gravado agora no cadastro do produto\./);
    assert.doesNotMatch(js, /sincronizarPrecoCadastroProdutoPdv|method:\s*'PUT'[\s\S]{0,100}produtos/);
    assert.match(js, /^function refletirPrecosAtualizadosNoCatalogoPdv/m);
  });

  it('exibe o preço atual, fecha o modal e prioriza Escape sobre cancelar a venda', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/pdv/index.html'), 'utf8');
    const js = fs.readFileSync(path.resolve(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    const inicioModal = js.indexOf('function abrirModalPrecoUnitarioPdv(');
    const fimModal = js.indexOf('\nfunction atualizarPrecoUnitario(', inicioModal);
    const inicioAtalhos = js.indexOf('function bindEventosPDV()');
    const fimAtalhos = js.indexOf('\nfunction ', inicioAtalhos + 1);
    assert.ok(inicioModal >= 0 && fimModal > inicioModal);
    assert.ok(inicioAtalhos >= 0 && fimAtalhos > inicioAtalhos);

    assert.match(html, /id="modalPrecoUnitarioPdvCancelar"[^>]*data-dismiss="modal"/);
    assert.match(js.slice(inicioModal, fimModal), /#modalPrecoUnitarioPdvAtual'\)\.val\(/);
    assert.match(js, /#modalPrecoUnitarioPdvCancelar'\)\.off\('click\.pdvPreco'\)\.on\('click\.pdvPreco'[\s\S]*?modal\('hide'\)/);
    assert.match(js, /function confirmarModalPrecoUnitarioPdv\([\s\S]*?modalPrecoUnitarioPdvCheckbox[\s\S]*?\/vendas\/preco-cadastro[\s\S]*?atualizarPrecoUnitario\(index, valor, false\)/);
    assert.match(js, /keydown\.pdvPreco[\s\S]*?evento\.key !== 'Enter'[\s\S]*?confirmarModalPrecoUnitarioPdv\(\)/);

    const atalhos = js.slice(inicioAtalhos, fimAtalhos);
    assert.match(atalhos, /const modalAberto = \$\('\.modal\.show'\)\.last\(\);[\s\S]*?modalAberto\.modal\('hide'\);[\s\S]*?cancelarVendaAtual\(\);/);
    assert.doesNotMatch(js, /document\.getElementById\("btnCancelarVendaPdv"\)\?\.click\(\)/);

    const inicioConsulta = js.indexOf('function adicionarProdutoConsultaPDV(');
    const fimConsulta = js.indexOf('\nfunction buscarProdutosConsultaPDV(', inicioConsulta);
    assert.ok(inicioConsulta >= 0 && fimConsulta > inicioConsulta);
    assert.doesNotMatch(js.slice(inicioConsulta, fimConsulta), /forcarAtualizacao:\s*true/);
  });

  it('confirma o novo valor só na linha da venda e recalcula a quantidade do item', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    const inicio = js.indexOf('function atualizarPrecoUnitario(');
    const fim = js.indexOf('\nfunction removerItemCarrinho(', inicio);
    assert.ok(inicio >= 0 && fim > inicio);

    const atualizacoes = [];
    const sandbox = {
      carrinho: [{
        id: 1,
        tipo_preco: 'varejo',
        tipo_venda: 'PESO',
        quantidade: 2,
        preco_unitario: 10,
        preco_base: 10,
        desconto_percentual: 10,
        desconto_valor: 2,
        subtotal: 18
      }],
      produtosDisponiveis: [{ id: 1, preco_venda: 10 }],
      pdvPermitirEditarPrecoUnitario: () => true,
      parseValorMonetarioPdv: Number,
      obterPrecoBaseItemPdv: (item) => item.preco_base,
      animarTotalLinhaCarrinho: () => {},
      atualizarCarrinho: () => atualizacoes.push('total'),
      focarCampoCodigo: () => {}
    };
    vm.runInNewContext(`${js.slice(inicio, fim)}\nthis.executarEdicao = atualizarPrecoUnitario;`, sandbox);

    sandbox.executarEdicao(0, 7.5, false);

    assert.equal(sandbox.carrinho[0].preco_unitario, 7.5);
    assert.equal(sandbox.carrinho[0].subtotal, 15);
    assert.equal(sandbox.carrinho[0].desconto_percentual, 0);
    assert.equal(sandbox.carrinho[0].desconto_valor, 0);
    assert.equal(sandbox.carrinho[0].atualizar_preco_cadastro, false);
    assert.equal(sandbox.produtosDisponiveis[0].preco_venda, 10);
    assert.deepEqual(atualizacoes, ['total']);
  });

  it('reflete o preço no catálogo local somente após receber a intenção confirmada', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../../frontend/pdv/js/pdv.js'), 'utf8');
    const inicio = js.indexOf('function refletirPrecosAtualizadosNoCatalogoPdv(');
    const fim = js.indexOf('\nlet recarregarCatalogoPdvInflight', inicio);
    assert.ok(inicio >= 0 && fim > inicio);

    const publicados = [];
    const sandbox = {
      produtosDisponiveis: [{ id: 1, preco_venda: 10, preco_unidade: 4 }],
      TIPO_VENDA_UNIDADE: 'UNIDADE',
      window: {
        CdsCatalogoProdutoSync: {
          publicarProdutoSalvo(produto) {
            publicados.push(produto);
          }
        }
      }
    };
    sandbox.upsertProdutoNoCatalogoPdv = (produto) => {
      Object.assign(sandbox.produtosDisponiveis.find((p) => p.id === produto.id), produto);
    };
    vm.runInNewContext(
      `${js.slice(inicio, fim)}\nthis.refletir = refletirPrecosAtualizadosNoCatalogoPdv;`,
      sandbox
    );

    sandbox.refletir([
      {
        atualizar_preco_cadastro: true,
        produto_id: 1,
        tipo_preco: 'varejo',
        tipo_venda: 'UNIDADE',
        preco_unitario: 3.5
      },
      {
        atualizar_preco_cadastro: false,
        produto_id: 1,
        tipo_preco: 'varejo',
        tipo_venda: 'PESO',
        preco_unitario: 8
      }
    ]);

    assert.equal(sandbox.produtosDisponiveis[0].preco_unidade, 3.5);
    assert.equal(sandbox.produtosDisponiveis[0].preco_venda, 10);
    assert.equal(publicados.length, 1);
  });
});
