/**
 * Persistência transacional — Importação Inicial de Produtos V1.0.8.
 * Apresentações via ProdutoEmbalagemService (mesmo do cadastro manual).
 * Produto EXISTENTE pode ser enriquecido com apresentação comercial nova.
 * Estoque via ajusteEstoqueService.
 */
'use strict';

const path = require('path');
const dbModule = require('../../database');
const { fazerBackupManual, obterPastaBackupPadrao } = require('../backupManual');
const { findOrCreateMarca } = require('../MarcaService');
const { aplicarAjusteEstoqueProduto } = require('../ajusteEstoqueService');
const { obterProdutoEmbalagemService } = require('../produto-embalagem/ProdutoEmbalagemService');
const {
  chaveNomeCadastroSimples,
  normalizarNomeCadastroSimples,
  STATUS,
  linhaBloqueiaPorClassificacao,
  linhaAtencaoPermiteImportar,
  POLITICA_PENDENTES,
  validarPoliticaPendentes,
  montarMotivoEstoqueInicial,
  calcularCustoTotalEstoqueInicial,
  montarEmbalagensParaServico,
  mesclarApresentacoesParaSync,
  normalizarUnidadeBaseCadastro,
  texto,
  campoNumericoInformado,
  valoresNumericosDivergem,
  resolverLucroPercentualPersistido,
  arredondarCasas,
  campoTextoFiscalPreenchido
} = require('./helpers');
const { chaveCategoriaEquivalente } = require('./classificadorCategoria');

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function aplicarAjusteAsync(db, opcoes) {
  return new Promise((resolve, reject) => {
    aplicarAjusteEstoqueProduto(db, opcoes, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function encontrarCategoriaProduto(db, nomeBruto, cache) {
  const nome = normalizarNomeCadastroSimples(nomeBruto);
  if (!nome) return null;
  const chave = chaveCategoriaEquivalente(nome);
  if (cache.categorias.has(chave)) return cache.categorias.get(chave);

  const todas = await dbAll(
    db,
    `SELECT id, nome FROM categorias
     WHERE tipo = 'produto' AND COALESCE(ativo, 1) = 1`
  );
  const existente = todas.find((c) => chaveCategoriaEquivalente(c.nome) === chave);
  if (existente) {
    cache.categorias.set(chave, existente.id);
    return existente.id;
  }
  return null;
}

async function encontrarSubcategoriaProduto(db, nomeBruto, categoriaId, cache) {
  const nome = normalizarNomeCadastroSimples(nomeBruto);
  if (!nome || !categoriaId) return null;
  const chave = `${categoriaId}|${chaveCategoriaEquivalente(nome)}`;
  if (cache.subcategorias.has(chave)) return cache.subcategorias.get(chave);

  const todas = await dbAll(
    db,
    `SELECT id, nome, categoria_id FROM subcategorias
     WHERE categoria_id = ? AND COALESCE(ativo, 1) = 1`,
    [categoriaId]
  );
  const existente = todas.find((s) => chaveCategoriaEquivalente(s.nome) === chaveCategoriaEquivalente(nome));
  if (existente) {
    cache.subcategorias.set(chave, existente.id);
    return existente.id;
  }
  return null;
}

/** V1.1.4 — reutiliza equivalente (produto ativo) ou cria tipo=produto ativo=1. Nunca cria despesa. */
async function findOrCreateCategoria(db, nomeBruto, cache) {
  const nome = normalizarNomeCadastroSimples(nomeBruto);
  if (!nome) return null;
  const chave = chaveCategoriaEquivalente(nome);
  if (cache.categorias.has(chave)) return cache.categorias.get(chave);

  const todas = await dbAll(db, `SELECT id, nome, tipo, COALESCE(ativo, 1) AS ativo FROM categorias`);
  const equivalente = todas.find((c) => chaveCategoriaEquivalente(c.nome) === chave);
  if (equivalente) {
    if (String(equivalente.tipo || 'produto') !== 'produto' || Number(equivalente.ativo) === 0) {
      return null;
    }
    cache.categorias.set(chave, equivalente.id);
    return equivalente.id;
  }
  const ins = await dbRun(
    db,
    `INSERT INTO categorias (nome, tipo, ativo) VALUES (?, 'produto', 1)`,
    [nome]
  );
  cache.categorias.set(chave, ins.lastID);
  return ins.lastID;
}

/** V1.1.4 — reutiliza sub equivalente na categoria ou cria vinculada a ela. */
async function findOrCreateSubcategoria(db, nomeBruto, categoriaId, cache) {
  const nome = normalizarNomeCadastroSimples(nomeBruto);
  if (!nome || !categoriaId) return null;
  const chave = `${categoriaId}|${chaveCategoriaEquivalente(nome)}`;
  if (cache.subcategorias.has(chave)) return cache.subcategorias.get(chave);

  const todas = await dbAll(
    db,
    `SELECT id, nome, categoria_id FROM subcategorias
     WHERE categoria_id = ? AND COALESCE(ativo, 1) = 1`,
    [categoriaId]
  );
  const existente = todas.find((s) => chaveCategoriaEquivalente(s.nome) === chaveCategoriaEquivalente(nome));
  if (existente) {
    cache.subcategorias.set(chave, existente.id);
    return existente.id;
  }
  const ins = await dbRun(
    db,
    `INSERT INTO subcategorias (nome, categoria_id, ativo) VALUES (?, ?, 1)`,
    [nome, categoriaId]
  );
  cache.subcategorias.set(chave, ins.lastID);
  return ins.lastID;
}

async function garantirEstruturaClassificacao(db, linha, cache) {
  const cl = linha.classificacao;
  if (!cl) return cl;
  const nomeCat = cl.categoria_nome || linha.produto?.categoria;
  const nomeSub = cl.subcategoria_nome || linha.produto?.subcategoria;
  const novo = linha.status === STATUS.PRONTO;
  const precisaCat = Boolean(
    cl.criar_categoria || ((cl.alterar_categoria || novo) && nomeCat && !cl.categoria_id)
  );
  const precisaSub = Boolean(
    cl.criar_subcategoria || ((cl.alterar_subcategoria || novo) && nomeSub && !cl.subcategoria_id)
  );

  if (precisaCat && nomeCat) {
    const id = await findOrCreateCategoria(db, nomeCat, cache);
    if (id) cl.categoria_id = id;
    else if (cl.criar_categoria) {
      throw new Error(`Não foi possível criar a categoria "${nomeCat}".`);
    }
  }
  if (precisaSub && nomeSub) {
    if (!cl.categoria_id && nomeCat) {
      const idCat = await findOrCreateCategoria(db, nomeCat, cache);
      if (idCat) cl.categoria_id = idCat;
    }
    if (!cl.categoria_id) {
      throw new Error('Não é possível criar subcategoria sem categoria.');
    }
    const id = await findOrCreateSubcategoria(db, nomeSub, cl.categoria_id, cache);
    if (id) cl.subcategoria_id = id;
    else if (cl.criar_subcategoria) {
      throw new Error(`Não foi possível criar a subcategoria "${nomeSub}".`);
    }
  }
  return cl;
}

/**
 * Persiste apresentações pelo serviço oficial do cadastro manual.
 * usarTransacao:false — a TX externa da importação já está aberta.
 */
function sincronizarEmbalagensOficial(db, produtoId, apresentacoes, unidadeBase, usuario, { forcarFalha } = {}) {
  return new Promise((resolve, reject) => {
    if (forcarFalha) {
      return reject(new Error('Falha forçada na criação da apresentação (teste de rollback).'));
    }
    const lista = montarEmbalagensParaServico(apresentacoes, unidadeBase, {
      origem: 'IMPORTACAO_INICIAL'
    });
    if (!lista.length) return resolve([]);

    const svc = obterProdutoEmbalagemService(db);
    svc.sincronizarEmbalagensProduto(
      produtoId,
      lista,
      unidadeBase,
      usuario || null,
      (err, inseridas) => (err ? reject(err) : resolve(inseridas || [])),
      { usarTransacao: false }
    );
  });
}

async function jaTemEstoqueInicialImportacao(db, produtoId) {
  const row = await dbGet(
    db,
    `SELECT id FROM produtos_ajustes_estoque
     WHERE produto_id = ?
       AND motivo LIKE 'ESTOQUE INICIAL — IMPORTAÇÃO DE PRODUTOS%'
     LIMIT 1`,
    [produtoId]
  );
  return Boolean(row);
}

async function registrarEstoqueInicial(db, {
  produtoId,
  linha,
  importId,
  usuarioId,
  usuarioNome,
  forcarFalhaEstoque
}) {
  const estoque = linha.estoque || {};
  const controla = Number(linha.produto?.controla_estoque) !== 0
    && linha.produto?.controla_estoque !== false;
  if (!controla) {
    return { lancado: 0, movimentado: false };
  }

  const ajusteFiscal = Math.max(0, Number(estoque.estoque_fiscal) || 0);
  const ajusteNaoFiscal = Math.max(0, Number(estoque.estoque_nao_fiscal) || 0);
  const qtd = arredondarCasas(ajusteFiscal + ajusteNaoFiscal, 3);
  if (!Number.isFinite(qtd) || qtd <= 0) {
    return { lancado: 0, movimentado: false };
  }

  if (await jaTemEstoqueInicialImportacao(db, produtoId)) {
    return { lancado: 0, movimentado: false, ja_existia: true };
  }

  if (forcarFalhaEstoque) {
    throw new Error('Falha forçada no registro de estoque inicial (teste de rollback).');
  }

  const p = linha.produto || {};
  const custoTotal = Number.isFinite(Number(estoque.custo_total_estoque))
    ? Number(estoque.custo_total_estoque)
    : calcularCustoTotalEstoqueInicial({
      quantidadeOrigem: estoque.quantidade_origem || qtd,
      custoUnitario: p.custo_unitario,
      apresentacao: linha.apresentacoes?.find((a) => a.tipo !== 'UN' && Number(a.quantidade) > 1)
        || linha.apresentacoes?.[0]
        || null
    });

  const motivo = montarMotivoEstoqueInicial({
    importId,
    codigoOrigem: p.codigo_origem,
    custoUnitario: p.custo_unitario,
    custoTotal
  });

  // V2: distribuição explícita por colunas Estoque Fiscal / Não Fiscal
  await aplicarAjusteAsync(db, {
    produtoId,
    ajusteFiscal,
    ajusteNaoFiscal,
    motivo,
    usuarioId: usuarioId || null,
    usuarioNome: usuarioNome || 'Importação Inicial'
  });

  return { lancado: qtd, movimentado: true };
}

/**
 * Completa NCM/CFOP/CSOSN apenas quando o cadastro está vazio.
 * Nunca sobrescreve classificação já preenchida.
 */
async function completarClassificacaoFiscalProdutoExistente(db, produtoId, linha) {
  const p = linha.produto || {};
  const atual = await dbGet(
    db,
    `SELECT ncm, cfop, csosn FROM produtos WHERE id = ?`,
    [produtoId]
  );
  if (!atual) return { ncm: false, cfop: false, csosn: false };

  const sets = [];
  const params = [];
  const resultado = { ncm: false, cfop: false, csosn: false };

  const ncmDb = String(atual.ncm || '').trim();
  const cfopDb = String(atual.cfop || '').trim();
  const csosnDb = String(atual.csosn || '').trim();
  const ncmNovo = String(p.ncm || '').trim();
  const cfopNovo = String(p.cfop || '').trim();
  const csosnNovo = String(p.csosn || '').trim();

  if (!ncmDb && ncmNovo && (p.ncm_acao === 'completar' || !p.ncm_acao)) {
    sets.push('ncm = ?');
    params.push(ncmNovo);
    resultado.ncm = true;
  }
  if (!cfopDb && cfopNovo && (p.cfop_acao === 'completar' || !p.cfop_acao)) {
    sets.push('cfop = ?');
    params.push(cfopNovo);
    resultado.cfop = true;
  }
  if (!csosnDb && csosnNovo && (p.csosn_acao === 'completar' || !p.csosn_acao)) {
    sets.push('csosn = ?');
    params.push(csosnNovo);
    resultado.csosn = true;
  }

  if (!sets.length) return resultado;
  params.push(produtoId);
  await dbRun(db, `UPDATE produtos SET ${sets.join(', ')} WHERE id = ?`, params);
  return resultado;
}

/**
 * Atualiza somente produtos.preco_compra / produtos.preco_venda quando a planilha
 * informou o campo E o valor diverge do banco. Vazio = não alterar.
 * UPDATEs independentes: custo não toca venda e vice-versa.
 * Nunca toca categoria, subcategoria ou item_fiscal.
 */
async function aplicarCustoPrecoProdutoExistente(db, produtoId, linha, { forcarFalha } = {}) {
  if (forcarFalha) {
    throw new Error('Falha forçada na atualização de custo/preço (teste de rollback).');
  }
  const p = linha.produto || {};
  const atual = await dbGet(
    db,
    `SELECT preco_compra, preco_venda, lucro_percentual FROM produtos WHERE id = ?`,
    [produtoId]
  );
  let custoFinal = Number(atual?.preco_compra);
  let precoFinal = Number(atual?.preco_venda);
  let alterouCusto = false;
  let alterouPreco = false;

  if (campoNumericoInformado(p.custo_informado) && Number(p.custo_informado) >= 0) {
    const custo = Number(p.custo_unitario);
    if (Number.isFinite(custo) && custo >= 0
      && valoresNumericosDivergem(custo, atual?.preco_compra, 0.0001)) {
      custoFinal = custo;
      alterouCusto = true;
    }
  }
  if (campoNumericoInformado(p.preco_informado) && Number(p.preco_informado) >= 0) {
    const preco = Number(p.preco_venda);
    if (Number.isFinite(preco) && preco >= 0
      && valoresNumericosDivergem(preco, atual?.preco_venda, 0.02)) {
      precoFinal = preco;
      alterouPreco = true;
    }
  }

  if (!alterouCusto && !alterouPreco) {
    return { atualizado: false, custo: false, preco: false };
  }

  const lucro = resolverLucroPercentualPersistido({
    markupInformado: p.markup_informado,
    custo: custoFinal,
    precoVenda: precoFinal,
    usarPadraoQuandoSoCusto: false
  });

  const sets = [];
  const params = [];
  if (alterouCusto) {
    sets.push('preco_compra = ?');
    params.push(custoFinal);
  }
  if (alterouPreco) {
    sets.push('preco_venda = ?');
    params.push(precoFinal);
  }
  if (lucro !== null) {
    sets.push('lucro_percentual = ?');
    params.push(lucro);
  }
  params.push(produtoId);
  await dbRun(db, `UPDATE produtos SET ${sets.join(', ')} WHERE id = ?`, params);
  return { atualizado: true, custo: alterouCusto, preco: alterouPreco };
}

/**
 * EXISTENTE_ATUALIZAR: soma estoque (idempotente) + custo/preço informados
 * + classificação somente quando o banco estiver NULL.
 * Nunca sobrescreve categoria/subcategoria já preenchidas.
 */
async function aplicarClassificacaoProdutoExistente(db, produtoId, classificacao) {
  if (!produtoId || !classificacao) {
    return { categoria: false, subcategoria: false };
  }
  const atual = await dbGet(
    db,
    `SELECT categoria_id, subcategoria_id FROM produtos WHERE id = ?`,
    [produtoId]
  );
  if (!atual) return { categoria: false, subcategoria: false };

  let categoriaAplicada = false;
  let subcategoriaAplicada = false;

  if (classificacao.alterar_categoria === true
    && classificacao.categoria_id
    && atual.categoria_id == null) {
    const upd = await dbRun(
      db,
      `UPDATE produtos SET categoria_id = ?
       WHERE id = ? AND categoria_id IS NULL`,
      [classificacao.categoria_id, produtoId]
    );
    categoriaAplicada = Number(upd.changes || 0) > 0;
  }

  const categoriaAtual = categoriaAplicada ? classificacao.categoria_id : atual.categoria_id;
  if (classificacao.alterar_subcategoria === true
    && classificacao.subcategoria_id
    && atual.subcategoria_id == null
    && categoriaAtual) {
    const sub = await dbGet(
      db,
      `SELECT id, categoria_id FROM subcategorias
       WHERE id = ? AND COALESCE(ativo, 1) = 1`,
      [classificacao.subcategoria_id]
    );
    if (sub && Number(sub.categoria_id) === Number(categoriaAtual)) {
      const upd = await dbRun(
        db,
        `UPDATE produtos SET subcategoria_id = ?
         WHERE id = ?
           AND subcategoria_id IS NULL
           AND categoria_id = ?`,
        [classificacao.subcategoria_id, produtoId, categoriaAtual]
      );
      subcategoriaAplicada = Number(upd.changes || 0) > 0;
    }
  }

  return { categoria: categoriaAplicada, subcategoria: subcategoriaAplicada };
}

async function atualizarProdutoExistente(db, linha, {
  usuarioId,
  usuarioNome,
  importId,
  forcarFalhaEstoque,
  forcarFalhaCustoPreco,
  cache = { categorias: new Map(), subcategorias: new Map() }
} = {}) {
  const produtoId = linha.existente_id;
  if (!produtoId) {
    throw new Error('Linha de atualização sem produto existente.');
  }

  const semClassificacao = linha._importarSemClassificacao === true;
  if (!semClassificacao) {
    const classif = await garantirEstruturaClassificacao(db, linha, cache);
    await aplicarClassificacaoProdutoExistente(db, produtoId, classif || linha.classificacao);
  }
  await completarClassificacaoFiscalProdutoExistente(db, produtoId, linha);

  const mov = await registrarEstoqueInicial(db, {
    produtoId,
    linha,
    importId,
    usuarioId,
    usuarioNome,
    forcarFalhaEstoque
  });

  const precos = await aplicarCustoPrecoProdutoExistente(db, produtoId, linha, {
    forcarFalha: forcarFalhaCustoPreco === true || linha._forcarFalhaCustoPreco === true
  });

  return { produtoId, mov, precos, classificacao: semClassificacao ? null : linha.classificacao };
}

async function inserirProduto(db, linha, cache, usuarioId) {
  const p = linha.produto;
  const semClassificacao = linha._importarSemClassificacao === true;
  if (!semClassificacao) {
    await garantirEstruturaClassificacao(db, linha, cache);
  }
  let marcaId = null;
  if (p.marca) {
    const r = await findOrCreateMarca(db, p.marca);
    marcaId = r.marca?.id || null;
  }
  const categoriaId = semClassificacao
    ? null
    : (Number(linha.classificacao?.categoria_id)
      || await findOrCreateCategoria(db, p.categoria, cache));
  const subcategoriaId = semClassificacao
    ? null
    : (Number(linha.classificacao?.subcategoria_id)
      || await findOrCreateSubcategoria(db, p.subcategoria, categoriaId, cache));
  const unidade = normalizarUnidadeBaseCadastro(p.unidade_base || 'UN');
  const codigo = p.codigo_origem || null;

  const ins = await dbRun(
    db,
    `INSERT INTO produtos (
      codigo, nome, categoria_id, subcategoria_id, unidade,
      preco_compra, lucro_percentual, preco_venda,
      estoque_atual, estoque_minimo, fornecedor,
      ncm, cfop, csosn, origem, cest, codigo_barras,
      aliquota_icms, aliquota_pis, aliquota_cofins,
      controlar_validade, controla_estoque,
      vendido_por_peso, produto_fracionado, peso_total_compra, valor_total_compra, custo_por_kg,
      venda_atacado,
      saldo_fiscal, saldo_nao_fiscal, item_fiscal,
      permite_venda_unidade, peso_medio_unidade, preco_unidade,
      marca_id, observacoes, imagem_principal
    ) VALUES (${Array(37).fill('?').join(', ')})`,
    [
      codigo,
      p.nome,
      categoriaId,
      subcategoriaId,
      unidade,
      Number(p.custo_unitario) || 0,
      resolverLucroPercentualPersistido({
        markupInformado: p.markup_informado,
        custo: Number(p.custo_unitario) || 0,
        precoVenda: Number(p.preco_venda) || 0,
        usarPadraoQuandoSoCusto: true
      }),
      Number(p.preco_venda) || 0,
      0,
      0,
      p.fornecedor || null,
      p.ncm || null,
      p.cfop || null,
      p.csosn || null,
      0,
      p.cest || null,
      p.codigo_barras || null,
      0,
      0,
      0,
      0,
      (p.controla_estoque === 0 || p.controla_estoque === false) ? 0 : 1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      Number(p.item_fiscal) === 0 ? 0 : 1,
      0,
      0,
      0,
      marcaId,
      p.observacoes || (p.referencia_fabricante ? `Ref: ${p.referencia_fabricante}` : null),
      null
    ]
  );

  const produtoId = ins.lastID;
  const temApresentacaoComercial = (linha.apresentacoes || []).some(
    (a) => a.tipo !== 'UN' && Number(a.quantidade) > 1
  );
  if (temApresentacaoComercial) {
    await dbRun(db, `UPDATE produtos SET compra_por_embalagem = 1 WHERE id = ?`, [produtoId]);
  }

  await sincronizarEmbalagensOficial(
    db,
    produtoId,
    linha.apresentacoes,
    unidade,
    { id: usuarioId },
    { forcarFalha: linha._forcarFalhaApresentacao === true }
  );
  return produtoId;
}

/**
 * Enriquece produto EXISTENTE: apresentação nova/sincronizada, unidade base se
 * a apresentação exigir, custo/preço via motor (já na linha), estoque inicial,
 * e codigo_barras quando vazio no banco (V1.0.16).
 * Não sobrescreve nome, marca, categoria, fiscal, NCM, codigo_barras já preenchido, etc.
 */
async function enriquecerProdutoExistente(db, linha, {
  usuarioId,
  usuarioNome,
  importId,
  forcarFalhaEstoque,
  forcarFalhaApresentacao,
  cache = { categorias: new Map(), subcategorias: new Map() }
} = {}) {
  const produtoId = linha.existente_id;
  if (!produtoId) {
    throw new Error('Linha de enriquecimento sem produto existente.');
  }

  await garantirEstruturaClassificacao(db, linha, cache);
  await aplicarClassificacaoProdutoExistente(db, produtoId, linha.classificacao);
  await completarClassificacaoFiscalProdutoExistente(db, produtoId, linha);

  const enr = linha.enriquecimento || {};
  let codigoBarrasAtualizado = false;

  // V1.0.16 — preencher codigo_barras somente se estiver vazio no banco
  if (enr.corrigir_codigo_barras) {
    const barrasArq = texto(linha.produto?.codigo_barras);
    if (barrasArq) {
      const upd = await dbRun(
        db,
        `UPDATE produtos
         SET codigo_barras = ?
         WHERE id = ?
           AND (codigo_barras IS NULL OR TRIM(COALESCE(codigo_barras, '')) = '')`,
        [barrasArq, produtoId]
      );
      codigoBarrasAtualizado = Number(upd.changes || 0) > 0;
    }
  }

  const soCodigoBarras = Boolean(enr.corrigir_codigo_barras)
    && !enr.corrigir_unidade_base
    && !enr.corrigir_preco
    && !enr.precisa_estoque
    && !enr.alterar_custo
    && !enr.alterar_preco
    && !(Number(enr.apresentacoes_novas || 0) > 0);

  if (soCodigoBarras) {
    return {
      produtoId,
      apresentacoes_novas: 0,
      apresentacoes_sincronizadas: 0,
      codigo_barras_atualizado: codigoBarrasAtualizado,
      mov: { lancado: 0, movimentado: false }
    };
  }

  const embDb = await dbAll(
    db,
    `SELECT * FROM produto_embalagens WHERE produto_id = ? ORDER BY principal DESC, id ASC`,
    [produtoId]
  );
  const { merged, classif } = mesclarApresentacoesParaSync(linha.apresentacoes || [], embDb);
  const unidadeAlvo = normalizarUnidadeBaseCadastro(linha.produto?.unidade_base || 'UN');

  if (enr.corrigir_unidade_base) {
    // Mesmo código do select do cadastro (Metro = "mt")
    await dbRun(db, `UPDATE produtos SET unidade = ? WHERE id = ?`, [unidadeAlvo, produtoId]);
  }

  const temComercial = merged.some((a) => a.tipo !== 'UN' && Number(a.quantidade) > 1);
  if (temComercial) {
    await dbRun(db, `UPDATE produtos SET compra_por_embalagem = 1 WHERE id = ?`, [produtoId]);
  }

  // Custo/preço somente quando a importação trouxe formação válida (motor oficial na validação)
  const p = linha.produto || {};
  const custo = Number(p.custo_unitario);
  const preco = Number(p.preco_venda);
  const lucro = resolverLucroPercentualPersistido({
    markupInformado: p.markup_informado,
    custo,
    precoVenda: preco,
    usarPadraoQuandoSoCusto: false
  });
  if ((classif.novas.length > 0 || classif.existentes.length > 0)
    && Number.isFinite(custo) && custo > 0
    && Number.isFinite(preco) && preco > 0) {
    await dbRun(
      db,
      `UPDATE produtos
       SET preco_compra = ?, preco_venda = ?, lucro_percentual = COALESCE(?, lucro_percentual)
       WHERE id = ?`,
      [custo, preco, lucro, produtoId]
    );
  }

  if (merged.length > 0) {
    await sincronizarEmbalagensOficial(
      db,
      produtoId,
      merged,
      unidadeAlvo,
      { id: usuarioId },
      { forcarFalha: forcarFalhaApresentacao === true || linha._forcarFalhaApresentacao === true }
    );
  }

  const mov = await registrarEstoqueInicial(db, {
    produtoId,
    linha,
    importId,
    usuarioId,
    usuarioNome,
    forcarFalhaEstoque
  });

  return {
    produtoId,
    apresentacoes_novas: classif.novas.length,
    apresentacoes_sincronizadas: classif.existentes.length,
    codigo_barras_atualizado: codigoBarrasAtualizado,
    mov
  };
}

async function obterPastaBackupConfigurada(db) {
  const row = await dbGet(db, `SELECT valor FROM configuracoes WHERE chave = 'backup_path' LIMIT 1`);
  const valor = row?.valor && String(row.valor).trim() ? String(row.valor).trim() : null;
  return valor;
}

function montarErroFalhaBackup(e, caminhoDb, pasta) {
  const motivo = e && (e.message || String(e));
  const codigo = e && e.code ? ` [${e.code}]` : '';
  const err = new Error(
    `Não foi possível criar o backup. A importação foi cancelada.${motivo ? ` Motivo: ${motivo}${codigo}` : ''}`
  );
  err.status = 500;
  err.cause = e;
  err.detalhes = {
    codigo: e?.code || null,
    operacao: e?.operacao || null,
    pasta: e?.pasta || pasta || null,
    dbPath: e?.dbPath || caminhoDb || null,
    destino: e?.destino || null
  };
  console.error('[BACKUP] Erro na importação:', err.message, err.detalhes);
  return err;
}

/**
 * Executa backup + importação transacional (produto novo e/ou enriquecimento).
 */
async function executarImportacao(db, validacao, {
  usuarioId,
  usuarioNome,
  dbPath,
  pastaBackup,
  importId,
  forcarFalhaEstoque,
  forcarFalhaApresentacao,
  forcarFalhaCustoPreco,
  politica_pendentes
} = {}) {
  const linhasNovas = (validacao.linhas || []).filter((l) => l.status === STATUS.PRONTO);
  const linhasEnriquecer = (validacao.linhas || []).filter(
    (l) => l.status === STATUS.EXISTENTE_APRESENTACAO_NOVA
  );
  const linhasAtualizar = (validacao.linhas || []).filter(
    (l) => l.status === STATUS.EXISTENTE_ATUALIZAR
  );
  const existentes = (validacao.linhas || []).filter((l) => l.status === STATUS.EXISTENTE);
  const atencao = (validacao.linhas || []).filter((l) => l.status === STATUS.ATENCAO);
  const linhasAtencao = (validacao.linhas || []).filter(linhaAtencaoPermiteImportar);
  const linhasPendentes = (validacao.linhas || []).filter(linhaBloqueiaPorClassificacao);
  const refImportacao = importId || validacao.arquivo || `imp-${Date.now()}`;

  const politica = validarPoliticaPendentes(politica_pendentes, {
    obrigatorio: linhasPendentes.length > 0
  });
  const importarPendentes = politica === POLITICA_PENDENTES.IMPORTAR_SEM_CLASSIFICACAO;
  const linhasPendentesNovas = importarPendentes
    ? linhasPendentes.filter((l) => !l.existente_id)
    : [];
  const linhasPendentesExistentes = importarPendentes
    ? linhasPendentes.filter((l) => l.existente_id)
    : [];
  const ignorados = importarPendentes ? 0 : linhasPendentes.length;

  if ((validacao.linhas || []).some(
    (l) => l.status === STATUS.ERRO
      || l.status === STATUS.CODIGO_DUPLICADO_ARQUIVO
      || l.status === STATUS.CATEGORIA_NAO_ENCONTRADA
      || l.status === STATUS.SUBCATEGORIA_INCOMPATIVEL
  )) {
    const err = new Error('Existem produtos com erro. Corrija antes de importar.');
    err.status = 400;
    throw err;
  }

  const temAptos = linhasNovas.length
    || linhasEnriquecer.length
    || linhasAtualizar.length
    || linhasAtencao.length
    || linhasPendentesNovas.length
    || linhasPendentesExistentes.length;

  const montarRelatorioVazio = (backupInfo = null) => ({
    sucesso: true,
    backup: backupInfo,
    relatorio: {
      produtos_processados: (validacao.linhas || []).length,
      criados: 0,
      existentes: existentes.length,
      enriquecidos: 0,
      apresentacoes_novas: 0,
      atualizados: 0,
      atualizacoes: 0,
      com_atencao: atencao.length,
      erros: 0,
      estoque_lancado: 0,
      movimentacoes_estoque: 0,
      importados: 0,
      ignorados,
      sem_classificacao: importarPendentes ? linhasPendentes.length : ignorados,
      classificados: 0,
      politica_pendentes: politica,
      ids_criados: [],
      ids_enriquecidos: [],
      ids_atualizados: [],
      import_id: refImportacao
    }
  });

  if (!temAptos) {
    return montarRelatorioVazio(null);
  }

  let backup;
  try {
    const pastaCfg = pastaBackup || await obterPastaBackupConfigurada(db);
    const caminhoDb = dbPath || dbModule.dbPath || path.join(process.cwd(), 'database.db');
    const pasta = pastaCfg || obterPastaBackupPadrao(caminhoDb);
    console.log('[BACKUP] Banco utilizado:', caminhoDb);
    console.log('[BACKUP] Pasta utilizada:', pasta);
    backup = fazerBackupManual(caminhoDb, pasta);
  } catch (e) {
    const caminhoDb = dbPath || dbModule.dbPath || null;
    throw montarErroFalhaBackup(e, caminhoDb, pastaBackup);
  }

  const cache = {
    categorias: new Map(),
    subcategorias: new Map()
  };

  await dbRun(db, 'BEGIN IMMEDIATE');
  const criados = [];
  const enriquecidos = [];
  const atualizadosCadastro = [];
  let apresentacoesNovas = 0;
  let estoqueLancado = 0;
  let movimentacoes = 0;
  try {
    for (const linha of linhasNovas) {
      if (forcarFalhaApresentacao) {
        linha._forcarFalhaApresentacao = true;
      }
      const id = await inserirProduto(db, linha, cache, usuarioId);
      criados.push(id);
      const mov = await registrarEstoqueInicial(db, {
        produtoId: id,
        linha,
        importId: refImportacao,
        usuarioId,
        usuarioNome,
        forcarFalhaEstoque
      });
      estoqueLancado += Number(mov.lancado || 0);
      if (mov.movimentado) movimentacoes += 1;
    }

    for (const linha of linhasEnriquecer) {
      const r = await enriquecerProdutoExistente(db, linha, {
        usuarioId,
        usuarioNome,
        importId: refImportacao,
        forcarFalhaEstoque,
        forcarFalhaApresentacao,
        cache
      });
      enriquecidos.push(r.produtoId);
      apresentacoesNovas += Number(r.apresentacoes_novas || 0);
      estoqueLancado += Number(r.mov?.lancado || 0);
      if (r.mov?.movimentado) movimentacoes += 1;
    }

    for (const linha of linhasAtualizar) {
      if (forcarFalhaCustoPreco) {
        linha._forcarFalhaCustoPreco = true;
      }
      const r = await atualizarProdutoExistente(db, linha, {
        usuarioId,
        usuarioNome,
        importId: refImportacao,
        forcarFalhaEstoque,
        forcarFalhaCustoPreco,
        cache
      });
      atualizadosCadastro.push(r.produtoId);
      estoqueLancado += Number(r.mov?.lancado || 0);
      if (r.mov?.movimentado) movimentacoes += 1;
    }

    for (const linha of linhasAtencao) {
      if (forcarFalhaCustoPreco) {
        linha._forcarFalhaCustoPreco = true;
      }
      const r = await atualizarProdutoExistente(db, linha, {
        usuarioId,
        usuarioNome,
        importId: refImportacao,
        forcarFalhaEstoque,
        forcarFalhaCustoPreco,
        cache
      });
      atualizadosCadastro.push(r.produtoId);
      estoqueLancado += Number(r.mov?.lancado || 0);
      if (r.mov?.movimentado) movimentacoes += 1;
    }

    for (const linha of linhasPendentesNovas) {
      linha._importarSemClassificacao = true;
      if (forcarFalhaApresentacao) {
        linha._forcarFalhaApresentacao = true;
      }
      const id = await inserirProduto(db, linha, cache, usuarioId);
      criados.push(id);
      const mov = await registrarEstoqueInicial(db, {
        produtoId: id,
        linha,
        importId: refImportacao,
        usuarioId,
        usuarioNome,
        forcarFalhaEstoque
      });
      estoqueLancado += Number(mov.lancado || 0);
      if (mov.movimentado) movimentacoes += 1;
    }

    for (const linha of linhasPendentesExistentes) {
      linha._importarSemClassificacao = true;
      if (forcarFalhaCustoPreco) {
        linha._forcarFalhaCustoPreco = true;
      }
      const r = await atualizarProdutoExistente(db, linha, {
        usuarioId,
        usuarioNome,
        importId: refImportacao,
        forcarFalhaEstoque,
        forcarFalhaCustoPreco,
        cache
      });
      atualizadosCadastro.push(r.produtoId);
      estoqueLancado += Number(r.mov?.lancado || 0);
      if (r.mov?.movimentado) movimentacoes += 1;
    }

    await dbRun(db, 'COMMIT');
  } catch (e) {
    try { await dbRun(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }

  const importadosClassificados = linhasNovas.length
    + linhasEnriquecer.length
    + linhasAtualizar.length
    + linhasAtencao.length;
  const importadosSemClass = linhasPendentesNovas.length + linhasPendentesExistentes.length;

  return {
    sucesso: true,
    backup: {
      arquivo: backup.arquivo,
      caminho: backup.caminho
    },
    relatorio: {
      produtos_processados: (validacao.linhas || []).length,
      criados: criados.length,
      existentes: existentes.length,
      enriquecidos: enriquecidos.length,
      apresentacoes_novas: apresentacoesNovas,
      atualizados: enriquecidos.length + atualizadosCadastro.length,
      atualizacoes: atualizadosCadastro.length,
      com_atencao: atencao.length,
      erros: 0,
      estoque_lancado: estoqueLancado,
      movimentacoes_estoque: movimentacoes,
      importados: importadosClassificados + importadosSemClass,
      ignorados,
      sem_classificacao: importarPendentes ? importadosSemClass : ignorados,
      classificados: importadosClassificados,
      politica_pendentes: politica,
      ids_criados: criados,
      ids_enriquecidos: enriquecidos,
      ids_atualizados: atualizadosCadastro,
      import_id: refImportacao
    }
  };
}

module.exports = {
  executarImportacao,
  findOrCreateCategoria,
  findOrCreateSubcategoria,
  encontrarCategoriaProduto,
  encontrarSubcategoriaProduto,
  inserirProduto,
  enriquecerProdutoExistente,
  atualizarProdutoExistente,
  aplicarCustoPrecoProdutoExistente,
  aplicarClassificacaoProdutoExistente,
  garantirEstruturaClassificacao,
  sincronizarEmbalagensOficial,
  registrarEstoqueInicial,
  jaTemEstoqueInicialImportacao
};
