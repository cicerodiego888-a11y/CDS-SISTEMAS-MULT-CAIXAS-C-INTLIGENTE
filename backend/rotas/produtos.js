
const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const { verificarPermissaoEspecifica, exigirPerfilAjusteEstoque } = require('../middleware/auth');
const lotesService = require('../services/lotesService');
const { recalcularEstoqueConsolidado, recalcularSaldosProduto } = require('../services/estoqueFiscalService');
const {
  produtoTemMovimentacoes,
  produtoTemVendas,
  aplicarAjusteEstoqueProduto,
  definirSaldosIniciaisProduto
} = require('../services/ajusteEstoqueService');
const { excluirProdutoCadastro } = require('../services/excluirProdutoService');
const cfgValidadeEmpresa = require('../services/estoque/empresaControlaValidadeConfig');
const { sqlRankingProdutos, isModoFiscalRelatorio } = require('../services/reportFiscalHelpers');
const { espelharIdentificadoresSafe } = require('../motores/produto-identidade');
const PdvProdutoIdentificacaoService = require('../motores/produto-identidade/services/PdvProdutoIdentificacaoService');
const {
  isProdutoIdentidadeEnabled,
  FLAG_CHAVE: MIP_FLAG_CHAVE
} = require('../motores/produto-identidade/config/produtoIdentidadeFlags');
const {
  validarPluOpcional,
  resolverFlagProdutoPesavel
} = require('../motores/produto-identidade/validators/validarPlu');
const {
  produtoImagemUpload,
  caminhoPublicoImagemProduto,
  removerArquivoImagemProduto,
  handleMulterProdutoImagemError
} = require('../services/produtoImagemUpload');
const { obterProdutoImagemService } = require('../services/ProdutoImagemService');
const { obterProdutoEmbalagemService } = require('../services/produto-embalagem/ProdutoEmbalagemService');
const { obterMib, obterSearchService, normalizarNomeBusca } = require('../motores/mib');
const { criarBuscaOperacionalProdutosService } = require('../services/busca-operacional-produtos');

let _pdvIdentificacaoService = null;

function obterMibService() {
  return obterMib(db);
}

function obterPdvIdentificacaoService() {
  if (!_pdvIdentificacaoService) {
    _pdvIdentificacaoService = new PdvProdutoIdentificacaoService({ db });
  }
  return _pdvIdentificacaoService;
}

/**
 * Após gravar produto: limpa cache MIP e publica no MIB imediatamente
 * (PDV com venda em aberto precisa achar o SKU sem esperar rebuild).
 */
function publicarProdutoNoCatalogoOperacional(produto) {
  if (!produto || produto.id == null) return;
  try {
    obterPdvIdentificacaoService().limparCacheCatalogo();
  } catch (err) {
    console.warn('[MIP] limpar cache após gravar produto:', err.message);
  }
  try {
    obterMibService().notificarProdutoCriado({
      id: produto.id,
      nome: produto.nome,
      nome_busca: produto.nome_busca || normalizarNomeBusca(produto.nome),
      codigo: produto.codigo,
      codigo_barras: produto.codigo_barras,
      plu: produto.plu,
      preco_venda: produto.preco_venda,
      preco: produto.preco_venda,
      item_fiscal: produto.item_fiscal,
      status: produto.ativo
    });
  } catch (err) {
    console.warn('[MIB] notificar produto após gravar:', err.message);
  }
}

/**
 * Próximo código interno numérico (maior código só-dígitos + 1).
 * Fallback: MAX(id)+1.
 */
function obterProximoCodigoInternoProduto(callback) {
  db.get(
    `
      SELECT MAX(CAST(codigo AS INTEGER)) AS max_num
      FROM produtos
      WHERE codigo IS NOT NULL
        AND TRIM(codigo) != ''
        AND codigo GLOB '[0-9]*'
    `,
    (err, row) => {
      if (!err && row && row.max_num != null) {
        return callback(null, String(Number(row.max_num) + 1));
      }
      db.get('SELECT COALESCE(MAX(id), 0) + 1 AS proximo FROM produtos', (err2, row2) => {
        if (err2) return callback(err2);
        callback(null, String(row2?.proximo || 1));
      });
    }
  );
}

/**
 * Se o usuário informou código, usa o informado.
 * Se vazio, gera o próximo disponível (único).
 */
function resolverCodigoInternoCriacao(codigoInformado, callback) {
  const informado = String(codigoInformado == null ? '' : codigoInformado).trim();
  if (informado) {
    return callback(null, { codigo: informado, gerado: false });
  }

  const tentar = (candidato, tentativas) => {
    if (tentativas > 50) {
      return callback(new Error('Não foi possível gerar um código interno único.'));
    }
    db.get('SELECT id FROM produtos WHERE codigo = ? LIMIT 1', [candidato], (err, row) => {
      if (err) return callback(err);
      if (!row) return callback(null, { codigo: candidato, gerado: true });
      const n = Number(candidato);
      const proximo = Number.isFinite(n) ? String(n + 1) : `${candidato}-${tentativas + 1}`;
      tentar(proximo, tentativas + 1);
    });
  };

  obterProximoCodigoInternoProduto((err, base) => {
    if (err) return callback(err);
    tentar(base, 0);
  });
}


/** @internal testes */
function _setPdvIdentificacaoServiceForTests(svc) {
  _pdvIdentificacaoService = svc;
}

function resolverItemFiscalCadastro(body, saldoFiscal, saldoNaoFiscal) {
  if (body.item_fiscal !== undefined && body.item_fiscal !== null) {
    return Number(body.item_fiscal) === 1 ? 1 : 0;
  }
  if (Number(saldoNaoFiscal) > 0 && Number(saldoFiscal) === 0) {
    return 0;
  }
  return 1;
}

function isModoFiscalQuery(valor) {
  return valor === '1' || valor === true || valor === 'true';
}

function filtroSqlModoFiscalProduto(modoFiscal, alias = 'p') {
  if (!modoFiscal) {
    return '';
  }
  return ` AND COALESCE(${alias}.item_fiscal, 1) = 1`;
}

function exprEstoqueAlerta(modoFiscal, alias = '') {
  const prefixo = alias ? `${alias}.` : '';
  return modoFiscal
    ? `COALESCE(${prefixo}saldo_fiscal, 0)`
    : `COALESCE(${prefixo}estoque_atual, 0)`;
}

const { resolverCustoUnitarioProdutoCadastro } = require('../lib/motorConversaoUnidades');
const { normalizarFlagControlaEstoque } = require('../services/estoque/produtoControlaEstoque');

function normalizarProdutoResposta(produto, modoFiscal) {
  const saldoFiscal = Number(produto.saldo_fiscal ?? 0);
  const saldoNaoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
  const estoqueAtual = saldoFiscal + saldoNaoFiscal;
  const flagFracionado = Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? 0) ? 1 : 0;
  const precoCompra = flagFracionado
    ? resolverCustoUnitarioProdutoCadastro(produto)
    : Number(produto.preco_compra || 0);

  const pluValor = produto.plu != null && String(produto.plu).trim() !== ''
    ? String(produto.plu).trim()
    : null;

  const codigoMgv6Valor = produto.codigo_mgv6 != null && String(produto.codigo_mgv6).trim() !== ''
    ? String(produto.codigo_mgv6).trim()
    : null;

  const base = {
    ...produto,
    ...aplicarCamposVendaUnidadeResposta(produto),
    produto_fracionado: flagFracionado,
    vendido_por_peso: flagFracionado,
    /** Alias oficial Sprint 06 — mesmo valor de produto_fracionado */
    produto_pesavel: flagFracionado,
    plu: pluValor,
    codigo_mgv6: codigoMgv6Valor,
    codigoMgv6: codigoMgv6Valor,
    controla_estoque: normalizarFlagControlaEstoque(produto.controla_estoque),
    preco_compra: precoCompra,
    saldo_fiscal: saldoFiscal,
    saldo_nao_fiscal: saldoNaoFiscal,
    estoque_atual: estoqueAtual,
    valor_estoque: Number((estoqueAtual * precoCompra).toFixed(2))
  };

    if (modoFiscal) {
        return {
            ...base,
            estoque_exibido: saldoFiscal,
            valor_estoque: Number((saldoFiscal * precoCompra).toFixed(2))
        };
    }

  return {
    ...base,
    estoque_exibido: estoqueAtual
  };
}

function produtosTemColuna(nomeColuna, callback) {
  db.all(`PRAGMA table_info(produtos)`, [], (err, cols) => {
    if (err) return callback(err, false);
    callback(null, (cols || []).some((col) => col.name === nomeColuna));
  });
}

function resolverFlagProdutoFracionado(body = {}) {
  return resolverFlagProdutoPesavel(body);
}

function normalizarCamposVendaUnidade(valores = {}) {
  const result = {};

  if (valores.permite_venda_unidade !== undefined && valores.permite_venda_unidade !== null) {
    result.permite_venda_unidade = Number(valores.permite_venda_unidade) === 1 ? 1 : 0;
  }

  if (valores.peso_medio_unidade !== undefined && valores.peso_medio_unidade !== null && valores.peso_medio_unidade !== '') {
    result.peso_medio_unidade = Number(valores.peso_medio_unidade) || 0;
  }

  if (valores.preco_unidade !== undefined && valores.preco_unidade !== null && valores.preco_unidade !== '') {
    result.preco_unidade = Number(valores.preco_unidade) || 0;
  }

  return result;
}

function aplicarCamposVendaUnidadeResposta(produto = {}) {
  return {
    permite_venda_unidade: Number(produto.permite_venda_unidade ?? 0) === 1 ? 1 : 0,
    peso_medio_unidade: Number(produto.peso_medio_unidade ?? 0),
    preco_unidade: Number(produto.preco_unidade ?? 0)
  };
}

const CAMPOS_PRODUTO_IGNORADOS = new Set([
  'id',
  'created_at',
  'updated_at',
  'lote_inicial',
  'data_fabricacao_inicial',
  'data_validade_inicial',
  'atacado_faixas',
  'embalagens',
  'categoria',
  'subcategoria',
  'categoria_nome',
  'subcategoria_nome',
  'marca',
  'marca_nome',
  'preco_atacado',
  'quantidade_minima_atacado',
  'dias_para_vencer',
  'status_validade',
  'message',
  'data_validade',
  'lote',
  'dias_alerta_validade',
  'estoque_atual',
  'saldo_fiscal',
  'saldo_nao_fiscal',
  'estoque_exibido',
  'saldo_fiscal_inicial',
  'saldo_nao_fiscal_inicial',
  // Sprint 06 — não são colunas de produtos; tratados via MIP / alias
  'plu',
  'codigo_mgv6',
  'codigoMgv6',
  'produto_pesavel',
  'identificadores'
]);

function normalizarMarcaIdOpcional(valor) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '' || valor === 'null' || valor === 'undefined') return null;
  const n = parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizarTextoOpcional(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return String(valor);
}

function normalizarImagemPrincipalOpcional(valor) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '' || valor === 'null') return null;
  const texto = String(valor).trim();
  if (!texto || texto.startsWith('data:')) return null;
  return texto;
}

const SQL_PLU_SUBQUERY = `(
  SELECT pi.codigo FROM produto_identificadores pi
  WHERE pi.produto_id = p.id
    AND pi.tipo = 'PLU'
    AND COALESCE(pi.ativo, 1) = 1
    AND COALESCE(pi.principal, 0) = 1
  ORDER BY pi.id DESC
  LIMIT 1
) AS plu`;

/** @deprecated RC14.15.9 — dados históricos tipo=MGV6; não usados na UI nem no export */
const SQL_MGV6_SUBQUERY = `(
  SELECT pi.codigo FROM produto_identificadores pi
  WHERE pi.produto_id = p.id
    AND UPPER(pi.tipo) = 'MGV6'
    AND COALESCE(pi.ativo, 1) = 1
  ORDER BY COALESCE(pi.principal, 0) DESC, pi.id DESC
  LIMIT 1
) AS codigo_mgv6`;

function obterEstoqueTotalProduto(produto = {}) {
  const fiscal = Number(produto.saldo_fiscal ?? 0);
  const naoFiscal = Number(produto.saldo_nao_fiscal ?? 0);
  const estoqueAtual = Number(produto.estoque_atual ?? 0);
  if (estoqueAtual > 0) return estoqueAtual;
  return fiscal + naoFiscal;
}

function sincronizarValidadeELoteProduto(produtoId, opcoes, callback) {
  const controlarValidade = Number(opcoes.controlarValidade) === 1;
  const dataValidade = opcoes.dataValidade ? String(opcoes.dataValidade).trim() : null;
  const diasAlerta = opcoes.diasAlerta !== undefined && opcoes.diasAlerta !== null
    ? Number(opcoes.diasAlerta) || 30
    : 30;
  const estoqueTotal = Number(opcoes.estoqueTotal) || 0;

  if (!controlarValidade) {
    return db.run(
      `UPDATE produtos SET data_validade = NULL WHERE id = ?`,
      [produtoId],
      callback
    );
  }

  const atualizarProduto = (cb) => {
    if (!dataValidade) {
      if (opcoes.diasAlerta !== undefined && opcoes.diasAlerta !== null) {
        return db.run(
          `UPDATE produtos SET dias_alerta_validade = ? WHERE id = ?`,
          [diasAlerta, produtoId],
          cb
        );
      }
      return cb(null);
    }

    db.run(
      `UPDATE produtos SET data_validade = ?, dias_alerta_validade = ? WHERE id = ?`,
      [dataValidade, diasAlerta, produtoId],
      cb
    );
  };

  atualizarProduto((err) => {
    if (err) return callback(err);
    if (!dataValidade) return callback(null);

    lotesService.buscarLotesProduto(produtoId, (loteErr, lotes) => {
      if (loteErr) return callback(loteErr);

      if (lotes && lotes.length > 0) {
        return db.run(
          `UPDATE produtos_lotes SET data_validade = ? WHERE id = ?`,
          [dataValidade, lotes[0].id],
          callback
        );
      }

      if (estoqueTotal <= 0) {
        return callback(null);
      }

      lotesService.criarLote({
        produto_id: produtoId,
        quantidade_inicial: estoqueTotal,
        data_validade: dataValidade,
        data_entrada: new Date().toISOString().split('T')[0],
        origem: 'ESTOQUE_INICIAL',
        compra_id: null
      }, callback);
    });
  });
}

function enriquecerProdutoComValidade(produtoId, produto, callback) {
  if (Number(produto.controlar_validade) !== 1) {
    return callback(null, produto);
  }

  lotesService.buscarLotesProduto(produtoId, (err, lotes) => {
    if (err) return callback(err);

    const dataValidadeLote = lotes && lotes[0] ? lotes[0].data_validade : null;
    const dataValidade = produto.data_validade || dataValidadeLote || null;

    callback(null, {
      ...produto,
      data_validade: dataValidade,
      data_validade_inicial: dataValidade
    });
  });
}

function inserirFaixasAtacadoProduto(produtoId, faixas, callback) {
  const lista = Array.isArray(faixas) ? faixas : [];
  if (!lista.length) {
    return callback(null);
  }

  let indice = 0;

  function inserirProxima() {
    if (indice >= lista.length) {
      return callback(null);
    }

    const faixa = lista[indice];
    indice += 1;

    const quantidadeMinima = parseInt(faixa?.quantidade_minima, 10);
    const precoAtacado = parseFloat(faixa?.preco_atacado);

    if (!Number.isInteger(quantidadeMinima) || quantidadeMinima <= 0) {
      return inserirProxima();
    }

    if (Number.isNaN(precoAtacado) || precoAtacado <= 0) {
      return inserirProxima();
    }

    db.run(
      `INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)`,
      [produtoId, quantidadeMinima, precoAtacado],
      (err) => {
        if (err) {
          return callback(err);
        }
        inserirProxima();
      }
    );
  }

  inserirProxima();
}

function salvarEmbalagensProduto(produtoId, embalagens, unidadeProduto, usuario, callback) {
  if (!Array.isArray(embalagens)) {
    return callback(null, []);
  }
  obterProdutoEmbalagemService(db).sincronizarEmbalagensProduto(
    produtoId,
    embalagens,
    unidadeProduto,
    usuario,
    callback
  );
}

function buscarProdutoCompleto(produtoId, callback) {
  db.get(`
    SELECT 
      p.*, 
      ${SQL_PLU_SUBQUERY},
      ${SQL_MGV6_SUBQUERY},
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome,
      m.nome AS marca_nome
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.id = ?
  `, [produtoId], (err, row) => {
    if (err) {
      return callback(err);
    }

    if (!row) {
      return callback(null, null);
    }

    db.all(
      `SELECT * FROM produto_atacado WHERE produto_id = ? ORDER BY quantidade_minima ASC`,
      [produtoId],
      (faixaErr, faixas) => {
        if (faixaErr) {
          return callback(faixaErr);
        }

        obterProdutoEmbalagemService(db).listarPorProduto(produtoId, (embErr, embalagens) => {
          if (embErr) {
            return callback(embErr);
          }

          callback(null, normalizarProdutoResposta({
            ...row,
            categoria: row.categoria_nome || '',
            subcategoria: row.subcategoria_nome || '',
            marca: row.marca_nome || '',
            atacado_faixas: faixas || [],
            embalagens: embalagens || []
          }, false));
        });
      }
    );
  });
}


/**
 * MIP Sprint 05 — identificação exclusiva para o PDV.
 * Flag OFF → { habilitado: false } (cliente usa legado local).
 * Flag ON  → resolve via ProdutoIdentidadeService.
 */
router.post('/identificar', async (req, res) => {
  try {
    const codigo = req.body?.codigo ?? req.query?.codigo ?? '';
    const contexto = (req.body && typeof req.body.contexto === 'object' && req.body.contexto)
      ? req.body.contexto
      : {};

    // DEBUG 01 — rastreamento PLU (temporário)
    console.log('[MIP DEBUG] POST /produtos/identificar Request:', {
      codigo,
      contexto,
      body: req.body
    });

    const service = obterPdvIdentificacaoService();
    const payload = await service.identificar(codigo, contexto);

    console.log('[MIP DEBUG] POST /produtos/identificar Response:', {
      statusHttp: 200,
      encontrado: payload?.encontrado,
      produtoId: payload?.produtoId,
      strategy: payload?.strategy,
      nome: payload?.produto?.nome,
      fallbackLegado: payload?.fallbackLegado
    });

    return res.json(payload);
  } catch (err) {
    console.error('[MIP] identificar falhou:', err.message);
    console.log('[MIP DEBUG] POST /produtos/identificar Response ERRO:', {
      statusHttp: 500,
      error: err.message
    });
    return res.status(500).json({
      error: err.message || 'Falha ao identificar produto',
      habilitado: isProdutoIdentidadeEnabled(),
      encontrado: false,
      flag: MIP_FLAG_CHAVE
    });
  }
});

router.get('/identificar', async (req, res) => {
  try {
    const codigo = req.query?.codigo ?? '';
    const contexto = {};
    if (req.query.layoutStrategy) contexto.layoutStrategy = String(req.query.layoutStrategy);
    if (req.query.equipamentoId) contexto.equipamentoId = Number(req.query.equipamentoId);

    const service = obterPdvIdentificacaoService();
    const payload = await service.identificar(codigo, contexto);
    return res.json(payload);
  } catch (err) {
    console.error('[MIP] identificar GET falhou:', err.message);
    return res.status(500).json({
      error: err.message || 'Falha ao identificar produto',
      habilitado: isProdutoIdentidadeEnabled(),
      encontrado: false,
      flag: MIP_FLAG_CHAVE
    });
  }
});

// LISTAR PRODUTOS
router.get('/', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const filtroFiscal = filtroSqlModoFiscalProduto(modoFiscal, 'p');
  const params = [];
  const filtros = [];

  const categoriaId = req.query.categoria_id != null && String(req.query.categoria_id).trim() !== ''
    ? Number(req.query.categoria_id)
    : null;
  if (Number.isFinite(categoriaId) && categoriaId > 0) {
    filtros.push('p.categoria_id = ?');
    params.push(categoriaId);
  }

  const subcategoriaId = req.query.subcategoria_id != null && String(req.query.subcategoria_id).trim() !== ''
    ? Number(req.query.subcategoria_id)
    : null;
  if (Number.isFinite(subcategoriaId) && subcategoriaId > 0) {
    filtros.push('p.subcategoria_id = ?');
    params.push(subcategoriaId);
  }

  const filtroExtra = filtros.length ? ` AND ${filtros.join(' AND ')}` : '';

  db.all(`
    SELECT 
      p.*, 
      ${SQL_PLU_SUBQUERY},
      ${SQL_MGV6_SUBQUERY},
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome,
      m.nome AS marca_nome,
      CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN COALESCE(p.controlar_validade, 0) != 1 OR p.data_validade IS NULL OR p.data_validade = '' THEN NULL
        WHEN date(p.data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(p.data_validade) <= date('now', 'localtime', '+' || COALESCE(p.dias_alerta_validade, 30) || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE 1=1
      ${filtroFiscal}
      ${filtroExtra}
    ORDER BY p.nome COLLATE NOCASE ASC, p.id ASC
  `, params, (err, rows) => {
    if (err) {
      console.error('Erro ao listar produtos:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const produtos = (rows || []).map((p) => normalizarProdutoResposta({
      ...p,
      categoria: p.categoria_nome || p.categoria || '',
      subcategoria: p.subcategoria_nome || '',
      marca: p.marca_nome || p.marca || ''
    }, modoFiscal));

    res.json(produtos);
  });
});

/**
 * Versão barata do catálogo — PDV com venda em aberto detecta SKU novo
 * sem recarregar a lista inteira a cada poll.
 */
router.get('/catalogo-versao', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const filtroFiscal = filtroSqlModoFiscalProduto(modoFiscal, 'p');
  db.get(
    `SELECT COUNT(*) AS total, COALESCE(MAX(p.id), 0) AS max_id FROM produtos p WHERE 1=1 ${filtroFiscal}`,
    [],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const total = Number(row?.total || 0);
      const maxId = Number(row?.max_id || 0);
      res.json({
        total,
        max_id: maxId,
        versao: `${total}:${maxId}`
      });
    }
  );
});

// Próximo código interno sugerido (cadastro de produto)
router.get('/proximo-codigo', (req, res) => {
  obterProximoCodigoInternoProduto((err, codigo) => {
    if (err) {
      return res.status(500).json({ error: err.message || 'Falha ao gerar código.' });
    }
    res.json({ success: true, codigo, gerado: true });
  });
});

// Buscar produto por código
router.get('/codigo/:codigo', (req, res) => {
  const { codigo } = req.params;
  db.get('SELECT * FROM produtos WHERE codigo = ?', [codigo], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});


// Histórico de preços do produto
router.get('/:id/historico-precos', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT * FROM produtos_preco_historico
    WHERE produto_id = ?
    ORDER BY created_at DESC
  `, [id], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// RC3.7.6.4 — Últimas compras do produto (READ-ONLY; não altera payload/MIIP/compras)
router.get('/:id/ultimas-compras', (req, res) => {
  const produtoId = Number(req.params.id);
  if (!Number.isFinite(produtoId) || produtoId <= 0) {
    return res.status(400).json({ error: 'produto_id inválido' });
  }
  const limiteRaw = Number(req.query.limite);
  const limite = Number.isFinite(limiteRaw) && limiteRaw > 0
    ? Math.min(Math.floor(limiteRaw), 20)
    : 5;

  db.all(`
    SELECT
      c.id AS compra_id,
      COALESCE(c.data_compra, c.data_entrada, c.data_emissao, c.created_at) AS data,
      c.fornecedor AS fornecedor,
      COALESCE(
        NULLIF(ci.custo_unitario_final, 0),
        NULLIF(ci.preco_unitario, 0),
        ci.preco_unitario
      ) AS custo,
      ci.preco_unitario AS preco_unitario,
      ci.custo_unitario_final AS custo_unitario_final,
      ci.margem_lucro AS margem_lucro,
      ci.preco_venda_sugerido AS preco_venda_sugerido,
      ci.atualizar_preco_venda AS atualizar_preco_venda,
      ci.quantidade AS quantidade,
      COALESCE(c.numero_nf, '') AS nfe
    FROM compras_itens ci
    INNER JOIN compras c ON c.id = ci.compra_id
    WHERE ci.produto_id = ?
      AND (c.cancelada_em IS NULL OR TRIM(COALESCE(c.cancelada_em, '')) = '')
    ORDER BY
      COALESCE(c.data_compra, c.data_entrada, c.data_emissao, c.created_at) DESC,
      c.id DESC,
      ci.id DESC
    LIMIT ?
  `, [produtoId, limite], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.json(rows || []);
  });
});

// Histórico de ajustes de estoque do produto
router.get('/:id/historico-estoque', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT *
    FROM produtos_ajustes_estoque
    WHERE produto_id = ?
    ORDER BY criado_em DESC, id DESC
  `, [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Relatório de estoque de produtos com data de compra
router.get('/relatorio-estoque', (req, res) => {
  const { inicio, fim } = req.query;
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);

  const filtrosUltima = [];
  const paramsUltima = [];
  if (inicio) {
    filtrosUltima.push('c.data_compra >= ?');
    paramsUltima.push(inicio);
  }
  if (fim) {
    filtrosUltima.push('c.data_compra <= ?');
    paramsUltima.push(fim);
  }
  const whereUltima = filtrosUltima.length ? `WHERE ${filtrosUltima.join(' AND ')}` : '';
  const exigirCompraNoPeriodo = filtrosUltima.length
    ? 'AND uc.ultima_compra_data IS NOT NULL'
    : '';

  const sql = `
    SELECT
      p.id,
      p.nome,
      p.codigo,
      p.unidade,
      p.categoria_id,
      p.saldo_fiscal,
      p.saldo_nao_fiscal,
      p.estoque_atual,
      p.estoque_minimo,
      p.preco_compra,
      p.lote,
      p.data_validade,
      p.controlar_validade,
      p.dias_alerta_validade,
      p.reservado_fiscal,
      p.reservado_nao_fiscal,
      p.produto_fracionado,
      p.vendido_por_peso,
      p.item_fiscal,
      c.nome AS categoria_nome,
      uc.ultima_compra_data,
      CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN COALESCE(p.controlar_validade, 0) != 1 OR p.data_validade IS NULL OR p.data_validade = '' THEN NULL
        WHEN date(p.data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(p.data_validade) <= date('now', 'localtime', '+' || COALESCE(p.dias_alerta_validade, 30) || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN (
      SELECT ci.produto_id, MAX(c.data_compra) AS ultima_compra_data
      FROM compras_itens ci
      INNER JOIN compras c ON c.id = ci.compra_id
      ${whereUltima}
      GROUP BY ci.produto_id
    ) uc ON uc.produto_id = p.id
    WHERE 1=1
      ${exigirCompraNoPeriodo}
    ORDER BY p.nome COLLATE NOCASE ASC, p.id ASC
  `;

  db.all(sql, paramsUltima, (err, rows) => {
    if (err) {
      console.error('Erro ao gerar relatório de estoque:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const produtos = (rows || []).map((p) => {
      const saldoFiscal = Number(p.saldo_fiscal ?? 0);
      const saldoNaoFiscal = Number(p.saldo_nao_fiscal ?? 0);
      const estoqueAtual = saldoFiscal + saldoNaoFiscal;
      const precoCompra = Number(p.preco_compra || 0);
      const qtdExibida = modoFiscal ? saldoFiscal : estoqueAtual;
      return {
        id: p.id,
        nome: p.nome,
        codigo: p.codigo,
        unidade: p.unidade || 'UN',
        categoria_id: p.categoria_id,
        categoria: p.categoria_nome || '',
        saldo_fiscal: saldoFiscal,
        saldo_nao_fiscal: saldoNaoFiscal,
        estoque_atual: estoqueAtual,
        estoque_exibido: qtdExibida,
        estoque_minimo: Number(p.estoque_minimo || 0),
        preco_compra: precoCompra,
        lote: p.lote || '',
        data_validade: p.data_validade,
        controlar_validade: p.controlar_validade,
        reservado_fiscal: Number(p.reservado_fiscal || 0),
        reservado_nao_fiscal: Number(p.reservado_nao_fiscal || 0),
        produto_fracionado: Number(p.produto_fracionado || p.vendido_por_peso || 0) ? 1 : 0,
        item_fiscal: p.item_fiscal,
        ultima_compra_data: p.ultima_compra_data || null,
        dias_para_vencer: p.dias_para_vencer,
        status_validade: p.status_validade,
        valor_estoque: Number((qtdExibida * precoCompra).toFixed(2))
      };
    });

    res.json(produtos);
  });
});

// MIB-RC1.1 — health / diagnóstico / benchmark / catálogo
router.get('/mib/health', (req, res) => {
  try {
    return res.json(obterMibService().health());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha no health MIB' });
  }
});

router.get('/mib/diagnostico', (req, res) => {
  try {
    return res.json(obterMibService().diagnostico());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha no diagnóstico MIB' });
  }
});

router.get('/mib/statistics', async (req, res) => {
  try {
    return res.json(await obterMibService().statistics());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha nas estatísticas MIB' });
  }
});

router.get('/mib/catalog', (req, res) => {
  try {
    return res.json(obterMibService().catalogInfo());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha ao ler catálogo MIB' });
  }
});

router.get('/mib/config', async (req, res) => {
  try {
    return res.json(await obterMibService().getConfig());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha ao ler config MIB' });
  }
});

router.put('/mib/config', async (req, res) => {
  try {
    return res.json(await obterMibService().setConfig(req.body || {}));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha ao salvar config MIB' });
  }
});

router.post('/mib/refresh', async (req, res) => {
  try {
    const info = await obterMibService().refresh(req.body || {});
    return res.json({ ok: true, ...info });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha no refresh MIB' });
  }
});

router.post('/mib/rebuild', async (req, res) => {
  try {
    const info = await obterMibService().rebuild();
    return res.json({ ok: true, ...info });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha no rebuild MIB' });
  }
});

router.post('/mib/hotcache/rebuild', async (req, res) => {
  try {
    const info = await obterMibService().rebuildHotCache();
    return res.json({ ok: true, ...info });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha no HotCache MIB' });
  }
});

router.post('/mib/benchmark', async (req, res) => {
  try {
    const resultado = await obterMibService().executarBenchmark(req.body || {});
    return res.json(resultado);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha no benchmark MIB' });
  }
});

router.post('/mib/recarregar-catalogo', async (req, res) => {
  try {
    const info = await obterMibService().recarregarCatalogo();
    return res.json({ ok: true, ...info });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha ao recarregar catálogo MIB' });
  }
});

router.post('/mib/backfill-nome-busca', (req, res) => {
  const limite = Number(req.body?.limite) || 5000;
  obterMibService().backfill({ limite, apenasVazios: req.body?.apenasVazios !== false }, (err, resultado) => {
    if (err) return res.status(500).json({ error: err.message });
    obterMibService().refresh({ motivo: 'backfill' }).catch(() => {});
    return res.json({ ok: true, ...resultado });
  });
});

router.post('/mib/selecao', async (req, res) => {
  const produtoId = Number(req.body?.produto_id || req.body?.id);
  if (!produtoId) return res.status(400).json({ error: 'produto_id obrigatório' });
  try {
    obterMibService().registrarSelecao(produtoId);
    const aprendizado = await obterMibService().registrarAprendizado({
      produto_id: produtoId,
      texto: req.body?.texto || req.body?.termo || '',
      posicao: req.body?.posicao,
      tempo_ms: req.body?.tempo_ms,
      operador_id: req.user?.id || req.body?.operador_id || null,
      filial_id: req.user?.filial_id || req.body?.filial_id || null,
      caixa_id: req.body?.caixa_id || null
    });
    return res.json({ ok: true, aprendizado });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// MIB-RC2.0 — analytics / learning / sinônimos
router.get('/mib/analytics', async (req, res) => {
  try {
    return res.json(await obterMibService().analytics());
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Falha analytics MIB' });
  }
});

router.get('/mib/top-searches', async (req, res) => {
  try {
    return res.json(await obterMibService().topSearches(Number(req.query.limite) || 20));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/mib/not-found', async (req, res) => {
  try {
    return res.json(await obterMibService().notFound(Number(req.query.limite) || 20));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/mib/learning', async (req, res) => {
  try {
    return res.json(await obterMibService().learningList(Number(req.query.limite) || 50));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/mib/synonym', async (req, res) => {
  try {
    return res.json(await obterMibService().listarSinonimos());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/mib/synonym', async (req, res) => {
  try {
    const { termo, sinonimo, origem } = req.body || {};
    const row = await obterMibService().cadastrarSinonimo(termo, sinonimo, origem);
    return res.json({ ok: true, ...row });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/mib/retrain', async (req, res) => {
  try {
    return res.json(await obterMibService().retrain());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/mib/reset-learning', async (req, res) => {
  try {
    return res.json(await obterMibService().resetLearning());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Sprint 04 — busca operacional determinística (Cadastro + PDV Express).
// MIB só entra como sugestão quando a busca operacional retorna zero.
router.get('/busca-operacional', async (req, res) => {
  const termo = String(req.query.q || '').trim();
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 20, 1), 20);
  const incluirSugestoes = String(req.query.sugestoes || '1') !== '0';

  try {
    const user = req.user || {};
    const svc = criarBuscaOperacionalProdutosService(db, {
      buscarSugestoesMib: async (query, opts) => {
        const resultado = await obterSearchService(db).search({
          entity: 'produto',
          query,
          limite: opts.limite || limite,
          modoFiscal: opts.modoFiscal === true,
          operador_id: user.id || req.operadorId || null,
          filial_id: user.filial_id || null,
          caixa_id: req.caixaId || null,
          permissoes: user.permissoes || ['produtos', 'pdv'],
          perfil: user.perfil,
          role: user.role || 'admin',
          origem: 'busca-operacional-sugestao',
          user,
          skipAuth: true
        });
        return resultado.itens || [];
      }
    });

    const resultado = await svc.buscar({
      q: termo,
      limite,
      modoFiscal,
      incluirSugestoes
    });

    const mapear = (row, fonte) => ({
      ...normalizarProdutoResposta(row, modoFiscal),
      busca_match_tipo: row.busca_match_tipo || null,
      busca_prioridade: row.busca_prioridade || null,
      match_exato: row.match_exato === 1 || row.match_exato === true ? 1 : 0,
      _fonteBusca: fonte
    });

    return res.json({
      itens: (resultado.itens || []).map((row) => mapear(row, row._fonteBusca || 'operacional')),
      sugestoes: (resultado.sugestoes || []).map((row) => mapear(row, 'mib-sugestao')),
      meta: resultado.meta
    });
  } catch (err) {
    console.error('Erro na busca operacional de produtos:', err && err.message ? err.message : err);
    return res.status(500).json({ error: err.message || 'Falha na busca operacional' });
  }
});

// CONSULTA DE PRODUTOS NO PDV — via SearchService (MIB-RC3.0)
router.get('/consulta-pdv/buscar', async (req, res) => {
  const termo = String(req.query.q || '').trim();
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 20, 1), 20);

  if (!termo) {
    return res.json([]);
  }

  try {
    const { obterSearchService } = require('../motores/mib');
    const user = req.user || {};
    const resultado = await obterSearchService(db).search({
      entity: 'produto',
      query: termo,
      limite,
      modoFiscal,
      operador_id: user.id || req.operadorId || null,
      filial_id: user.filial_id || null,
      caixa_id: req.caixaId || null,
      permissoes: user.permissoes || ['produtos', 'pdv'],
      perfil: user.perfil,
      role: user.role || 'admin',
      origem: 'pdv',
      user,
      skipAuth: true
    });
    const itens = (resultado.itens || []).map((row) => normalizarProdutoResposta(row, modoFiscal));
    if (req.query.debug === '1') {
      return res.json({ itens, meta: resultado.meta });
    }
    if (resultado.meta?.sugestao?.mensagem && itens.length === 0) {
      res.setHeader('X-MIB-Sugestao', encodeURIComponent(JSON.stringify(resultado.meta.sugestao)));
    }
    return res.json(itens);
  } catch (err) {
    if (err && err.code === 'MIB_CANCELLED') {
      return res.status(499).json({ error: 'Busca cancelada', code: 'MIB_CANCELLED' });
    }
    console.error('Erro na consulta SearchService PDV:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/ranking-vendas', (req, res) => {
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);

  const dataInicio = req.query.inicio || seteDiasAtras.toISOString().slice(0, 10);
  const dataFim = req.query.fim || hoje.toISOString().slice(0, 10);
  const modoFiscal = isModoFiscalRelatorio(req.query.modo_fiscal);

  const sqlBase = sqlRankingProdutos(modoFiscal);

  db.all(`
    ${sqlBase}
    HAVING quantidade_vendida > 0
    ORDER BY quantidade_vendida DESC
    LIMIT 3
  `, [dataInicio, dataFim], (errMais, maisVendidos) => {
    if (errMais) {
      return res.status(500).json({ error: errMais.message });
    }

    db.all(`
      ${sqlBase}
      HAVING quantidade_vendida > 0
      ORDER BY quantidade_vendida ASC
      LIMIT 3
    `, [dataInicio, dataFim], (errMenos, menosVendidos) => {
      if (errMenos) {
        return res.status(500).json({ error: errMenos.message });
      }

      res.json({
        periodo: {
          inicio: dataInicio,
          fim: dataFim
        },
        mais_vendidos: maisVendidos || [],
        menos_vendidos: menosVendidos || []
      });
    });
  });
});

// Acompanhamento de vencimentos de produtos
router.get('/vencimentos/alertas', (req, res) => {
  const diasPadrao = Math.max(parseInt(req.query.dias || '30', 10) || 30, 0);
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const exprEstoque = exprEstoqueAlerta(modoFiscal);
  const filtroFiscal = modoFiscal ? ' AND COALESCE(item_fiscal, 1) = 1' : '';

  db.all(`
    SELECT
      id,
      codigo,
      codigo_barras,
      nome,
      unidade,
      estoque_atual,
      COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
      COALESCE(saldo_nao_fiscal, 0) AS saldo_nao_fiscal,
      fornecedor,
      lote,
      data_validade,
      controlar_validade,
      COALESCE(dias_alerta_validade, ?) AS dias_alerta_validade,
      CAST(julianday(date(data_validade)) - julianday(date('now', 'localtime')) AS INTEGER) AS dias_para_vencer,
      CASE
        WHEN date(data_validade) < date('now', 'localtime') THEN 'vencido'
        WHEN date(data_validade) <= date('now', 'localtime', '+' || COALESCE(dias_alerta_validade, ?) || ' days') THEN 'proximo'
        ELSE 'ok'
      END AS status_validade
    FROM produtos
    WHERE COALESCE(controlar_validade, 0) = 1
      AND data_validade IS NOT NULL
      AND data_validade != ''
      AND ${exprEstoque} > 0
      ${filtroFiscal}
      AND date(data_validade) <= date('now', 'localtime', '+' || COALESCE(dias_alerta_validade, ?) || ' days')
    ORDER BY date(data_validade) ASC, nome ASC
  `, [diasPadrao, diasPadrao, diasPadrao], (err, rows) => {
    if (err) {
      console.error('Erro ao buscar vencimentos de produtos:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const lista = (rows || []).map((row) => normalizarProdutoResposta(row, modoFiscal));

    res.json({
      dias_padrao: diasPadrao,
      total: lista.length,
      vencidos: lista.filter(p => p.status_validade === 'vencido').length,
      proximos: lista.filter(p => p.status_validade === 'proximo').length,
      produtos: lista
    });
  });
});

// ============================================
// ENDPOINTS DE PROMOÇÕES INTELIGENTES
// ============================================

// Obter sugestões de promoções
router.get('/promocoes/sugestoes', (req, res) => {
  const descontoPercentual = Number(req.query.desconto_percentual) || 15;

  revalidarSugestoesPendentes(descontoPercentual, (revalErr) => {
    if (revalErr) {
      console.error('Erro na revalidação ao listar sugestões:', revalErr.message);
    }
    listarSugestoesPromocoes(res);
  });
});

// Obter sugestões com contagem para o card e estatísticas de promoções
router.get('/promocoes/dashboard', (req, res) => {
  db.serialize(() => {
    // Sugestões pendentes
    db.get(`
      SELECT COUNT(*) as total
      FROM promocoes_sugestoes
      WHERE ativo = 1 AND aceito_em IS NULL AND rejeitado_em IS NULL
    `, (err, sugestoes) => {
      if (err) {
        console.error('Erro ao contar sugestões:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // Promoções ativas (realmente vigentes: iniciadas e não expiradas)
      db.get(`
        SELECT COUNT(*) as total
        FROM promocoes
        WHERE status = 'ativa' AND date(data_inicio) <= date('now') AND date(data_fim) > date('now')
      `, (err2, ativas) => {
        if (err2) {
          console.error('Erro ao contar promoções ativas:', err2.message);
          return res.status(500).json({ error: err2.message });
        }

        // Promoções encerradas (manualmente OU expiradas)
        db.get(`
          SELECT COUNT(*) as total
          FROM promocoes
          WHERE status = 'encerrada' OR (status = 'ativa' AND date(data_fim) <= date('now'))
        `, (err3, encerradas) => {
          if (err3) {
            console.error('Erro ao contar promoções encerradas:', err3.message);
            return res.status(500).json({ error: err3.message });
          }

          // Total de promoções criadas
          db.get(`
            SELECT COUNT(*) as total
            FROM promocoes
          `, (err4, criadas) => {
            if (err4) {
              console.error('Erro ao contar promoções criadas:', err4.message);
              return res.status(500).json({ error: err4.message });
            }

            // Produtos salvos do vencimento
            db.get(`
              SELECT COUNT(DISTINCT produto_id) as total
              FROM promocoes_sugestoes
              WHERE aceito_em IS NOT NULL
            `, (err5, salvos) => {
              if (err5) {
                console.error('Erro ao contar produtos salvos:', err5.message);
                return res.status(500).json({ error: err5.message });
              }

              // Receita gerada por promoções
              db.get(`
                SELECT COALESCE(SUM(quantidade * preco_unitario), 0) as total
                FROM vendas_itens
                WHERE promocao_id IS NOT NULL
              `, (err6, receita) => {
                if (err6) {
                  console.error('Erro ao calcular receita de promoções:', err6.message);
                  return res.status(500).json({ error: err6.message });
                }

                // Perdas evitadas por promoções
                db.get(`
                  SELECT COALESCE(SUM(
                    MAX(0, COALESCE(p.preco_original, vi.preco_unitario) - vi.preco_unitario)
                    * vi.quantidade
                  ), 0) as total
                  FROM vendas_itens vi
                  LEFT JOIN promocoes p ON p.id = vi.promocao_id
                  WHERE vi.promocao_id IS NOT NULL
                `, (err7, perdas) => {
                  if (err7) {
                    console.error('Erro ao calcular perdas evitadas:', err7.message);
                    return res.status(500).json({ error: err7.message });
                  }

                  res.json({
                    sugestoes_pendentes: sugestoes?.total || 0,
                    promocoes_ativas: ativas?.total || 0,
                    promocoes_encerradas: encerradas?.total || 0,
                    promocoes_criadas: criadas?.total || 0,
                    produtos_salvos_vencimento: salvos?.total || 0,
                    receita_gerada: receita?.total || 0,
                    perdas_evitadas: perdas?.total || 0
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Obter promoções (ativas e encerradas)
router.get('/promocoes', (req, res) => {
  const { status } = req.query;
  
  let query = `
    SELECT 
      p.*,
      pr.nome AS nome_produto,
      pr.codigo,
      pr.preco_venda,
      CASE 
        WHEN date(p.data_fim) < date('now') THEN 'expirada'
        WHEN date(p.data_inicio) > date('now') THEN 'nao_iniciada'
        WHEN p.status = 'ativa' THEN 'vigente'
        ELSE p.status
      END AS status_real
    FROM promocoes p
    LEFT JOIN produtos pr ON pr.id = p.produto_id
  `;

  const params = [];

  if (status === 'ativas') {
    // Mostra apenas promoções que estão realmente vigentes (iniciadas e não expiradas)
    query += ` WHERE p.status = 'ativa' AND date(p.data_inicio) <= date('now') AND date(p.data_fim) > date('now')`;
  } else if (status === 'encerradas') {
    // Mostra promoções encerradas manualmente OU expiradas
    query += ` WHERE p.status = 'encerrada' OR (p.status = 'ativa' AND date(p.data_fim) <= date('now'))`;
  }

  query += ` ORDER BY p.criado_em DESC`;

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Erro ao listar promoções:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// Aceitar ou rejeitar sugestão
router.post('/promocoes/sugestoes/:id/processar', (req, res) => {
  const { id } = req.params;
  const { acao } = req.body; // 'aceitar' ou 'rejeitar'

  if (!['aceitar', 'rejeitar'].includes(acao)) {
    return res.status(400).json({ error: 'Ação inválida' });
  }

  const campoData = acao === 'aceitar' ? 'aceito_em' : 'rejeitado_em';

  db.run(`
    UPDATE promocoes_sugestoes
    SET ${campoData} = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [id], function(err) {
    if (err) {
      console.error(`Erro ao ${acao} sugestão:`, err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json({ 
      success: true, 
      message: `Sugestão ${acao === 'aceitar' ? 'aceita' : 'rejeitada'} com sucesso` 
    });
  });
});

// Criar promoção
router.post('/promocoes', (req, res) => {
  const { 
    produto_id, 
    preco_original, 
    preco_promocional, 
    data_inicio, 
    data_fim 
  } = req.body;

  if (!produto_id || !preco_promocional || !data_inicio || !data_fim) {
    return res.status(400).json({ error: 'Campos obrigatórios: produto_id, preco_promocional, data_inicio, data_fim' });
  }

  const desconto_percentual = preco_original 
    ? ((preco_original - preco_promocional) / preco_original * 100).toFixed(2)
    : 0;

  db.run(`
    INSERT INTO promocoes (
      produto_id, 
      preco_original, 
      preco_promocional, 
      desconto_percentual, 
      data_inicio, 
      data_fim, 
      status
    ) VALUES (?, ?, ?, ?, ?, ?, 'ativa')
  `, [produto_id, preco_original, preco_promocional, desconto_percentual, data_inicio, data_fim], function(err) {
    if (err) {
      console.error('Erro ao criar promoção:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({ 
      id: this.lastID, 
      message: 'Promoção criada com sucesso' 
    });
  });
});

// Encerrar promoção
router.put('/promocoes/:id/encerrar', (req, res) => {
  const { id } = req.params;
  const { motivo_encerramento } = req.body;

  db.run(`
    UPDATE promocoes
    SET status = 'encerrada', 
        encerrado_em = CURRENT_TIMESTAMP,
        motivo_encerramento = ?
    WHERE id = ?
  `, [motivo_encerramento || '', id], function(err) {
    if (err) {
      console.error('Erro ao encerrar promoção:', err.message);
      return res.status(500).json({ error: err.message });
    }

    res.json({ 
      success: true, 
      message: 'Promoção encerrada com sucesso' 
    });
  });
});

// Gerar sugestões de promoções automaticamente
function produtoControlaValidade(produto) {
  return Number(produto?.controlar_validade) === 1;
}

function ehTipoValidade(tipo) {
  return ['vencido', 'vence_hoje', 'vence_3', 'vence_7'].includes(tipo);
}

function classificarProduto(produto) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  let sugestao = null;

  if (
    produtoControlaValidade(produto) &&
    produto.data_validade &&
    produto.data_validade !== '0000-00-00'
  ) {
    const validade = new Date(produto.data_validade);
    validade.setHours(0, 0, 0, 0);

    const dias = Math.floor((validade - hoje) / 86400000);

    if (dias < 0) {
      sugestao = {
        tipo: 'vencido',
        texto: '🔴 Produto Vencido',
        prioridade: 100
      };
    } else if (dias === 0) {
      sugestao = {
        tipo: 'vence_hoje',
        texto: '🔴 Vence Hoje',
        prioridade: 90
      };
    } else if (dias <= 3) {
      sugestao = {
        tipo: 'vence_3',
        texto: '🔴 Vence em até 3 dias',
        prioridade: 80
      };
    } else if (dias <= 7) {
      sugestao = {
        tipo: 'vence_7',
        texto: '🟠 Vence em até 7 dias',
        prioridade: 70
      };
    }
  }

  if (!sugestao) {
    if (produto.ultima_venda) {
      const ultimaVenda = new Date(produto.ultima_venda);
      ultimaVenda.setHours(0, 0, 0, 0);

      const diasSemVenda = Math.floor((hoje - ultimaVenda) / 86400000);

      if (diasSemVenda >= 60) {
        sugestao = {
          tipo: 'encalhado',
          texto: '🔴 Produto Encalhado',
          prioridade: 60
        };
      } else if (diasSemVenda >= 30) {
        sugestao = {
          tipo: 'parado',
          texto: '⚫ Produto Parado',
          prioridade: 50
        };
      } else if (diasSemVenda >= 15) {
        sugestao = {
          tipo: 'giro_baixo',
          texto: '🟡 Giro Baixo',
          prioridade: 40
        };
      }
    } else {
      sugestao = {
        tipo: 'sem_vendas',
        texto: '🔴 Nunca Vendeu',
        prioridade: 65
      };
    }
  }

  return sugestao;
}

function calcularDiasParaVencer(dataValidade, controlarValidade) {
  if (!controlarValidade || !dataValidade || dataValidade === '0000-00-00') return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const validade = new Date(dataValidade);
  validade.setHours(0, 0, 0, 0);

  return Math.floor((validade - hoje) / 86400000);
}

function calcularDiasSemVenda(ultimaVenda) {
  if (!ultimaVenda) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const ultima = new Date(ultimaVenda);
  ultima.setHours(0, 0, 0, 0);

  return Math.floor((hoje - ultima) / 86400000);
}

const SQL_ULTIMA_VENDA_PRODUTO = `
  (
    SELECT MAX(v.data_venda)
    FROM vendas_itens vi
    INNER JOIN vendas v ON v.id = vi.venda_id
    WHERE vi.produto_id = p.id
      AND (v.status IS NULL OR v.status != 'cancelada')
  )
`;

function revalidarSugestoesPendentes(descontoPercentual, callback) {
  db.all(`
    SELECT
      ps.id AS sugestao_id,
      p.id,
      p.nome,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.preco_venda,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda
    FROM promocoes_sugestoes ps
    INNER JOIN produtos p ON p.id = ps.produto_id
    WHERE ps.ativo = 1
      AND ps.aceito_em IS NULL
      AND ps.rejeitado_em IS NULL
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao revalidar sugestões pendentes:', err.message);
      return callback(err);
    }

    const lista = rows || [];
    if (!lista.length) return callback(null, 0);

    let indice = 0;
    let atualizadas = 0;

    function processarProxima() {
      if (indice >= lista.length) {
        return callback(null, atualizadas);
      }

      const row = lista[indice];
      indice += 1;
      const classificacao = classificarProduto(row);

      if (!classificacao) {
        db.run('DELETE FROM promocoes_sugestoes WHERE id = ?', [row.sugestao_id], () => {
          processarProxima();
        });
        return;
      }

      const diasParaVencer = ehTipoValidade(classificacao.tipo)
        ? calcularDiasParaVencer(row.data_validade, true)
        : null;
      const precoSugerido = Number((row.preco_venda * (1 - descontoPercentual / 100)).toFixed(2));

      db.run(`
        UPDATE promocoes_sugestoes
        SET motivo = ?,
            dias_para_vencer = ?,
            estoque_atual = ?,
            preco_atual = ?,
            preco_sugerido = ?,
            desconto_percentual = ?
        WHERE id = ?
      `, [
        classificacao.texto,
        diasParaVencer,
        row.estoque_atual,
        row.preco_venda,
        precoSugerido,
        descontoPercentual,
        row.sugestao_id
      ], (updateErr) => {
        if (!updateErr) atualizadas += 1;
        processarProxima();
      });
    }

    processarProxima();
  });
}

function listarSugestoesPromocoes(res) {
  db.all(`
    SELECT 
      ps.*,
      p.nome AS nome_produto,
      p.codigo,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.dias_alerta_validade,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda,
      CASE
        WHEN COALESCE(p.controlar_validade, 0) = 1
          AND p.data_validade IS NOT NULL
          AND p.data_validade != ''
          AND p.data_validade != '0000-00-00'
        THEN CAST(julianday(date(p.data_validade)) - julianday(date('now', 'localtime')) AS INTEGER)
        ELSE NULL
      END AS dias_para_vencer
    FROM promocoes_sugestoes ps
    LEFT JOIN produtos p ON p.id = ps.produto_id
    WHERE ps.ativo = 1 AND ps.aceito_em IS NULL AND ps.rejeitado_em IS NULL
    ORDER BY
      CASE ps.motivo
        WHEN '🔴 Produto Vencido' THEN 100
        WHEN '🔴 Vence Hoje' THEN 90
        WHEN '🔴 Vence em até 3 dias' THEN 80
        WHEN '🟠 Vence em até 7 dias' THEN 70
        WHEN '🔴 Nunca Vendeu' THEN 65
        WHEN '🔴 Produto Encalhado' THEN 60
        WHEN '⚫ Produto Parado' THEN 50
        WHEN '🟡 Giro Baixo' THEN 40
        ELSE 0
      END DESC,
      ps.criado_em DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar sugestões de promoções:', err.message);
      return res.status(500).json({ error: err.message });
    }

    const sugestoes = (rows || []).map((row) => {
      const diasSemVenda = calcularDiasSemVenda(row.ultima_venda);
      return {
        ...row,
        dias_sem_venda: diasSemVenda
      };
    });

    res.json(sugestoes);
  });
}

function inserirSugestoesPromocoes(sugestoes, indice, inseridas, callback) {
  if (indice >= sugestoes.length) {
    return callback(inseridas);
  }

  const sugestao = sugestoes[indice];
  const diasParaVencer = ehTipoValidade(sugestao.tipo)
    ? calcularDiasParaVencer(sugestao.data_validade, true)
    : null;

  db.run(`
    INSERT INTO promocoes_sugestoes (
      produto_id,
      motivo,
      dias_para_vencer,
      estoque_atual,
      preco_atual,
      preco_sugerido,
      desconto_percentual,
      ativo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `, [
    sugestao.produto_id,
    sugestao.motivo,
    diasParaVencer,
    sugestao.estoque,
    sugestao.preco_atual,
    sugestao.preco_sugerido,
    sugestao.desconto_percentual
  ], (insertErr) => {
    if (insertErr) {
      console.error('Erro ao inserir sugestão de promoção:', insertErr.message);
    }

    inserirSugestoesPromocoes(
      sugestoes,
      indice + 1,
      inseridas + (insertErr ? 0 : 1),
      callback
    );
  });
}

router.post('/promocoes/gerar-sugestoes', (req, res) => {
  const { produto_ids = [], desconto_percentual = 15 } = req.body;

  // Validar desconto percentual
  if (desconto_percentual < 1 || desconto_percentual > 100) {
    return res.status(400).json({ error: 'Desconto deve estar entre 1% e 100%' });
  }

  // Limpar sugestões antigas (mais de 30 dias) e formato legado
  db.run(`
    DELETE FROM promocoes_sugestoes 
    WHERE ativo = 1 
      AND aceito_em IS NULL 
      AND rejeitado_em IS NULL 
      AND (
        julianday('now') - julianday(criado_em) > 30
        OR motivo = 'vencimento_proximo'
      )
  `, (deleteErr) => {
    if (deleteErr) {
      console.error('Erro ao limpar sugestões antigas:', deleteErr.message);
    }
  });

  revalidarSugestoesPendentes(desconto_percentual, (revalErr) => {
    if (revalErr) {
      console.error('Erro na revalidação de sugestões:', revalErr.message);
    }

  let query = `
    SELECT
      p.id,
      p.nome,
      p.codigo,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.preco_venda,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda
    FROM produtos p
    WHERE
      __FILTRO_ATIVO__
      p.estoque_atual > 0
      AND p.id NOT IN (
        SELECT produto_id FROM promocoes_sugestoes
        WHERE ativo = 1
          AND aceito_em IS NULL
          AND rejeitado_em IS NULL
      )
  `;

  const params = [];

  if (Array.isArray(produto_ids) && produto_ids.length > 0) {
    const placeholders = produto_ids.map(() => '?').join(',');
    query += ` AND p.id IN (${placeholders})`;
    params.push(...produto_ids);
  }

  produtosTemColuna('ativo', (colErr, temColunaAtivo) => {
    if (colErr) {
      console.error('Erro ao verificar coluna ativo em produtos:', colErr.message);
      return res.status(500).json({ error: colErr.message });
    }

    const filtroAtivo = temColunaAtivo ? 'COALESCE(p.ativo, 1) = 1 AND' : '';
    query = query.replace('__FILTRO_ATIVO__', filtroAtivo);

    db.all(query, params, (err, produtos) => {
      if (err) {
        console.error('Erro ao buscar produtos para sugestão:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const sugestoes = [];

      for (const produto of produtos || []) {
        const sugestao = classificarProduto(produto);

        if (sugestao) {
          sugestoes.push({
            produto_id: produto.id,
            nome: produto.nome,
            estoque: produto.estoque_atual,
            tipo: sugestao.tipo,
            motivo: sugestao.texto,
            prioridade: sugestao.prioridade,
            data_validade: produto.data_validade,
            preco_atual: produto.preco_venda,
            preco_sugerido: Number((produto.preco_venda * (1 - desconto_percentual / 100)).toFixed(2)),
            desconto_percentual
          });
        }
      }

      sugestoes.sort((a, b) => b.prioridade - a.prioridade);

      if (sugestoes.length === 0) {
        const mensagem = (produtos || []).length > 0
          ? 'Nenhuma sugestão necessária: os produtos analisados estão dentro dos critérios de validade e giro.'
          : 'Nenhuma sugestão gerada. Todos os produtos com estoque já possuem sugestão pendente ou não há produtos elegíveis.';

        return res.json({
          message: mensagem,
          total: 0,
          sugestoes: []
        });
      }

      inserirSugestoesPromocoes(sugestoes, 0, 0, (inseridas) => {
        res.json({
          message: `Sugestões geradas com sucesso. Total: ${inseridas}`,
          total: inseridas,
          sugestoes
        });
      });
    });
  });
  });
});

router.get('/promocoes/produtos-elegiveis', (req, res) => {
  let query = `
    SELECT
      p.id,
      p.nome,
      p.codigo,
      p.estoque_atual,
      p.controlar_validade,
      p.data_validade,
      p.preco_venda,
      ${SQL_ULTIMA_VENDA_PRODUTO} AS ultima_venda
    FROM produtos p
    WHERE
      __FILTRO_ATIVO__
      p.estoque_atual > 0
  `;

  produtosTemColuna('ativo', (colErr, temColunaAtivo) => {
    if (colErr) {
      console.error('Erro ao verificar coluna ativo em produtos:', colErr.message);
      return res.status(500).json({ error: colErr.message });
    }

    query = query.replace(
      '__FILTRO_ATIVO__',
      temColunaAtivo ? 'COALESCE(p.ativo, 1) = 1 AND' : ''
    );

    db.all(query, [], (err, produtos) => {
      if (err) {
        console.error('Erro ao buscar produtos elegíveis:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const elegiveis = [];

      for (const produto of produtos || []) {
        const sugestao = classificarProduto(produto);
        if (!sugestao) continue;

        elegiveis.push({
          id: produto.id,
          nome: produto.nome,
          codigo: produto.codigo,
          estoque_atual: produto.estoque_atual,
          preco_venda: produto.preco_venda,
          controlar_validade: produto.controlar_validade,
          data_validade: produto.data_validade,
          ultima_venda: produto.ultima_venda,
          dias_sem_venda: calcularDiasSemVenda(produto.ultima_venda),
          dias_para_vencer: produtoControlaValidade(produto)
            ? calcularDiasParaVencer(produto.data_validade, true)
            : null,
          tipo: sugestao.tipo,
          motivo: sugestao.texto,
          prioridade: sugestao.prioridade
        });
      }

      elegiveis.sort((a, b) => b.prioridade - a.prioridade);
      res.json(elegiveis);
    });
  });
});

// Recalcular saldos fiscal/não fiscal a partir do histórico de compras e vendas
router.post('/recalcular-saldos', verificarPermissaoEspecifica('produtos', 'editar'), (req, res) => {
  const { recalcularSaldosTodosProdutos } = require('../services/estoqueFiscalService');
  recalcularSaldosTodosProdutos(db, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      message: 'Saldos recalculados com sucesso',
      atualizados: result?.atualizados || 0,
      erros: result?.erros || []
    });
  });
});

router.post('/:id/recalcular-saldos', verificarPermissaoEspecifica('produtos', 'editar'), (req, res) => {
  recalcularSaldosProduto(db, req.params.id, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      message: 'Saldos recalculados com sucesso',
      ...result
    });
  });
});

function executarAjusteEstoque(req, res) {
  const { id } = req.params;
  const {
    ajuste_fiscal,
    ajuste_nao_fiscal,
    motivo,
    lote,
    data_fabricacao,
    data_validade,
    quantidade,
    modo_fiscal
  } = req.body;

  let ajusteFiscal = Number(ajuste_fiscal ?? 0);
  let ajusteNaoFiscal = Number(ajuste_nao_fiscal ?? 0);

  if (quantidade !== undefined && quantidade !== null && ajuste_fiscal === undefined && ajuste_nao_fiscal === undefined) {
    const qtd = Number(quantidade) || 0;
    const modoFiscalAtivo = modo_fiscal === 1 || modo_fiscal === true || modo_fiscal === '1';
    if (modoFiscalAtivo) {
      ajusteFiscal = qtd;
    } else {
      ajusteNaoFiscal = qtd;
    }
  }

  aplicarAjusteEstoqueProduto(db, {
    produtoId: id,
    ajusteFiscal,
    ajusteNaoFiscal,
    motivo,
    usuarioId: req.user?.id,
    usuarioNome: req.user?.username || req.user?.nome,
    lote,
    dataFabricacao: data_fabricacao,
    dataValidade: data_validade,
    lotesService
  }, (err, resultado) => {
    if (err) {
      const status = err.message.includes('não encontrado') ? 404 : 400;
      return res.status(status).json({ error: err.message });
    }

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'produtos',
      acao: 'ajustar_estoque',
      referencia_tipo: 'produto',
      referencia_id: id,
      detalhes: {
        ajuste_fiscal: ajusteFiscal,
        ajuste_nao_fiscal: ajusteNaoFiscal,
        motivo,
        resultado
      },
      ip_requisicao: req.ip || null
    }).catch(() => {});

    res.json({
      message: 'Estoque ajustado com sucesso',
      ...resultado
    });
  });
}

router.get('/:id/tem-movimentacoes', exigirPerfilAjusteEstoque(), (req, res) => {
  produtoTemMovimentacoes(db, req.params.id, (err, tem) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ produto_id: Number(req.params.id), tem_movimentacoes: tem });
  });
});

router.post('/:id/ajustar-estoque', exigirPerfilAjusteEstoque(), executarAjusteEstoque);

// Sprint INFRA 01 — upload de imagem principal (caminho público; nunca Base64 no banco)
router.post(
  '/upload-imagem',
  produtoImagemUpload.single('imagem'),
  handleMulterProdutoImagemError,
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de imagem não enviado.' });
    }
    const pathPublico = caminhoPublicoImagemProduto(req.file.filename);
    return res.json({ success: true, path: pathPublico, imagem_principal: pathPublico });
  }
);

router.delete('/:id/imagem', (req, res) => {
  const { id } = req.params;
  db.get('SELECT id, imagem_principal FROM produtos WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const anterior = row.imagem_principal;
    db.run(
      `UPDATE produtos SET imagem_principal = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [id],
      function (updErr) {
        if (updErr) {
          return res.status(500).json({ error: updErr.message });
        }
        removerArquivoImagemProduto(anterior);
        obterProdutoImagemService(db).sincronizarAPartirDeImagemPrincipalSafe(id, null);
        return res.json({ success: true, message: 'Imagem removida com sucesso' });
      }
    );
  });
});

// Sprint INFRA 02 — APIs futuras da galeria (UI atual NÃO consome estes endpoints)
router.get('/:id/imagens', async (req, res) => {
  try {
    const produtoId = Number(req.params.id);
    const imagens = await obterProdutoImagemService(db).listarImagens(produtoId);
    return res.json(imagens);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  '/:id/imagens',
  produtoImagemUpload.single('imagem'),
  handleMulterProdutoImagemError,
  async (req, res) => {
    try {
      const produtoId = Number(req.params.id);
      let arquivo = req.body?.arquivo || req.body?.path || null;
      if (req.file) {
        arquivo = caminhoPublicoImagemProduto(req.file.filename);
      }
      const principal = String(req.body?.principal || '') === '1' || req.body?.principal === true;
      const imagem = await obterProdutoImagemService(db).adicionarImagem(produtoId, arquivo, {
        principal,
        ordem: req.body?.ordem
      });
      return res.status(201).json(imagem);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
);

router.put('/:id/imagens/principal', async (req, res) => {
  try {
    const produtoId = Number(req.params.id);
    const imagemId = Number(req.body?.imagem_id || req.body?.id);
    if (!imagemId) {
      return res.status(400).json({ error: 'imagem_id é obrigatório.' });
    }
    const imagem = await obterProdutoImagemService(db).definirImagemPrincipal(produtoId, imagemId);
    return res.json(imagem);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.put('/:id/imagens/ordenar', async (req, res) => {
  try {
    const produtoId = Number(req.params.id);
    const ordenacao = Array.isArray(req.body?.ordenacao) ? req.body.ordenacao : [];
    const imagens = await obterProdutoImagemService(db).ordenarImagens(produtoId, ordenacao);
    return res.json(imagens);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/imagens/:imagemId', async (req, res) => {
  try {
    const produtoId = Number(req.params.id);
    const imagemId = Number(req.params.imagemId);
    const removerArquivo = String(req.query.remover_arquivo || '') === '1';
    const result = await obterProdutoImagemService(db).removerImagem(produtoId, imagemId, {
      removerArquivo
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// Buscar produto por ID trazendo o nome da categoria
router.get('/:id', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);

  db.get(`
    SELECT 
      p.*, 
      ${SQL_PLU_SUBQUERY},
      ${SQL_MGV6_SUBQUERY},
      (SELECT preco_atacado FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS preco_atacado,
      (SELECT quantidade_minima FROM produto_atacado WHERE produto_id = p.id ORDER BY quantidade_minima ASC LIMIT 1) AS quantidade_minima_atacado,
      c.nome AS categoria_nome,
      s.nome AS subcategoria_nome
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
    WHERE p.id = ?
  `, [req.params.id], (err, row) => {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    db.all(
      `SELECT * FROM produto_atacado WHERE produto_id = ? ORDER BY quantidade_minima ASC`,
      [req.params.id],
      (faixaErr, faixas) => {
        if (faixaErr) {
          return res.status(500).json({ error: faixaErr.message });
        }

        obterProdutoEmbalagemService(db).listarPorProduto(req.params.id, (embErr, embalagens) => {
          if (embErr) {
            return res.status(500).json({ error: embErr.message });
          }

          produtoTemMovimentacoes(db, req.params.id, (movErr, temMovimentacoes) => {
            if (movErr) {
              return res.status(500).json({ error: movErr.message });
            }

            produtoTemVendas(db, req.params.id, (vendErr, temVendas) => {
              if (vendErr) {
                return res.status(500).json({ error: vendErr.message });
              }

              const produtoBase = normalizarProdutoResposta({
                ...row,
                categoria: row.categoria_nome || '',
                subcategoria: row.subcategoria_nome || '',
                atacado_faixas: faixas || [],
                embalagens: embalagens || [],
                tem_movimentacoes: temMovimentacoes,
                // Estoque Inicial bloqueia só após a 1ª venda
                tem_vendas: temVendas
              }, modoFiscal);

              enriquecerProdutoComValidade(req.params.id, produtoBase, (validadeErr, produto) => {
                if (validadeErr) {
                  return res.status(500).json({ error: validadeErr.message });
                }
                res.json(produto);
              });
            });
          });
        });
      }
    );
  });
});

// Criar produto
router.post('/', (req, res) => {
  const {
    codigo, nome, categoria_id, subcategoria_id, unidade, preco_compra,
    lucro_percentual, preco_venda, estoque_atual, estoque_minimo, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins,
    controlar_validade,
    controla_estoque,
    produto_fracionado, vendido_por_peso, produto_pesavel,
    peso_total_compra, valor_total_compra, custo_por_kg,
    venda_atacado,
    atacado_faixas,
    embalagens,
    saldo_fiscal_inicial,
    saldo_nao_fiscal_inicial,
    item_fiscal,
    permite_venda_unidade,
    peso_medio_unidade,
    preco_unidade,
    plu,
    marca_id,
    observacoes,
    imagem_principal,
    // Campos adicionais para lote inicial
    lote_inicial,
    data_fabricacao_inicial,
    data_validade_inicial,
    dias_alerta_validade
  } = req.body;

  const pluValidacao = validarPluOpcional(plu);
  if (!pluValidacao.ok) {
    return res.status(400).json({ error: pluValidacao.erro });
  }

  const codigoMgv6Body = Object.prototype.hasOwnProperty.call(req.body, 'codigo_mgv6')
    ? req.body.codigo_mgv6
    : (Object.prototype.hasOwnProperty.call(req.body, 'codigoMgv6') ? req.body.codigoMgv6 : undefined);
  const codigoMgv6Informado = codigoMgv6Body !== undefined;
  let codigoMgv6Valor = null;
  if (codigoMgv6Informado) {
    const bruto = codigoMgv6Body == null ? '' : String(codigoMgv6Body).trim();
    if (bruto) {
      if (!/^\d+$/.test(bruto)) {
        return res.status(400).json({ error: 'Código MGV6 inválido: informe apenas dígitos.' });
      }
      if (bruto.length > 9) {
        return res.status(400).json({ error: 'Código MGV6 inválido: máximo 9 dígitos.', code: 'MGV6_CODE_OVERFLOW' });
      }
      codigoMgv6Valor = bruto;
    }
  }

  const marcaIdGravar = normalizarMarcaIdOpcional(
    Object.prototype.hasOwnProperty.call(req.body, 'marca_id') ? marca_id : null
  );
  const observacoesGravar = Object.prototype.hasOwnProperty.call(req.body, 'observacoes')
    ? normalizarTextoOpcional(observacoes)
    : null;
  const imagemPrincipalGravar = Object.prototype.hasOwnProperty.call(req.body, 'imagem_principal')
    ? normalizarImagemPrincipalOpcional(imagem_principal)
    : null;

  const controlaEstoque = normalizarFlagControlaEstoque(controla_estoque);
  const flagFracionado = resolverFlagProdutoFracionado({
    produto_fracionado,
    vendido_por_peso,
    produto_pesavel
  }) ?? 0;

  cfgValidadeEmpresa.resolverFlagControlarValidade(db, controlar_validade, (flagValErr, controlarValidade) => {
    if (flagValErr) {
      return res.status(500).json({ error: flagValErr.message });
    }

  let saldoFiscalInicial;
  let saldoNaoFiscalInicial;
  try {
    if (saldo_fiscal_inicial !== undefined || saldo_nao_fiscal_inicial !== undefined) {
      saldoFiscalInicial = Number(saldo_fiscal_inicial ?? 0);
      saldoNaoFiscalInicial = Number(saldo_nao_fiscal_inicial ?? 0);
    } else {
      const estoqueLegado = Number(estoque_atual || 0);
      saldoFiscalInicial = estoqueLegado;
      saldoNaoFiscalInicial = 0;
    }
    const saldos = definirSaldosIniciaisProduto(saldoFiscalInicial, saldoNaoFiscalInicial);
    saldoFiscalInicial = saldos.saldo_fiscal;
    saldoNaoFiscalInicial = saldos.saldo_nao_fiscal;
    var estoqueInicial = saldos.estoque_atual;
  } catch (saldosErr) {
    return res.status(400).json({ error: saldosErr.message });
  }

  const itemFiscalGravar = resolverItemFiscalCadastro(req.body, saldoFiscalInicial, saldoNaoFiscalInicial);
  const camposVendaUnidade = normalizarCamposVendaUnidade({
    permite_venda_unidade,
    peso_medio_unidade,
    preco_unidade
  });
  const permiteVendaUnidade = camposVendaUnidade.permite_venda_unidade ?? 0;
  const pesoMedioUnidade = camposVendaUnidade.peso_medio_unidade ?? 0;
  const precoUnidade = camposVendaUnidade.preco_unidade ?? 0;
  console.log('[AUDIT PRODUTO POST] req.body.item_fiscal:', req.body.item_fiscal);
  console.log('[AUDIT PRODUTO POST] item_fiscal gravar INSERT:', itemFiscalGravar);

  resolverCodigoInternoCriacao(codigo, (codigoErr, resolvido) => {
    if (codigoErr) {
      return res.status(500).json({ error: codigoErr.message || 'Falha ao gerar código interno.' });
    }
    const codigoFinal = resolvido.codigo;

  db.run(`
    INSERT INTO produtos (
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
    )
    VALUES (${Array(37).fill('?').join(', ')})
  `, [
    codigoFinal, nome, categoria_id, subcategoria_id, unidade,
    preco_compra, lucro_percentual, preco_venda,
    estoqueInicial, estoque_minimo || 0, fornecedor,
    ncm, cfop, csosn, origem, cest, codigo_barras,
    aliquota_icms, aliquota_pis, aliquota_cofins,
    controlarValidade,
    controlaEstoque,
    flagFracionado,
    flagFracionado,
    peso_total_compra || 0,
    valor_total_compra || 0,
    custo_por_kg || 0,
    venda_atacado ? 1 : 0,
    saldoFiscalInicial,
    saldoNaoFiscalInicial,
    itemFiscalGravar,
    permiteVendaUnidade,
    pesoMedioUnidade,
    precoUnidade,
    marcaIdGravar,
    observacoesGravar,
    imagemPrincipalGravar
  ],
    function(err) {
      if (err) {
        console.error('Erro ao criar produto:', err.message);
        const msg = String(err.message || '');
        if (/UNIQUE|unique/i.test(msg) && /codigo/i.test(msg)) {
          return res.status(400).json({ error: 'Já existe um produto com este código interno.' });
        }
        res.status(500).json({ error: err.message });
        return;
      }

      const produtoId = this.lastID;
      try {
        obterMibService().sincronizarNomeBusca(produtoId, nome);
      } catch (mibErr) {
        console.warn('[MIB] nome_busca no POST:', mibErr.message);
      }
      try {
        const MotorUM = require('../services/unidades/MotorUnidadesMedida');
        const compraPorEmb = Number(req.body.compra_por_embalagem || 0) === 1 ? 1 : 0;
        const uc = compraPorEmb
          ? MotorUM.normalizarUnidadeComercial(req.body.unidade_comercial)
          : 'UN';
        const qpe = compraPorEmb ? Number(req.body.quantidade_por_embalagem || 0) : 0;
        const valorEmb = compraPorEmb ? Number(req.body.valor_compra_embalagem || 0) : 0;
        db.run(
          `UPDATE produtos SET
             unidade_comercial = ?,
             quantidade_por_embalagem = ?,
             compra_por_embalagem = ?,
             valor_compra_embalagem = ?
           WHERE id = ?`,
          [uc, qpe > 0 ? qpe : 0, compraPorEmb, valorEmb > 0 ? valorEmb : 0, produtoId]
        );
      } catch (umErr) {
        console.warn('[RC8.4.2] unidade comercial no POST:', umErr.message);
      }
      // MIP — dual-write codigo/barras/PLU (aguardar antes da resposta para o GET/editar ver o PLU)
      const camposEspelho = { codigo: codigoFinal, codigo_barras };
      if (pluValidacao.informado) {
        camposEspelho.plu = pluValidacao.valor;
      }
      if (codigoMgv6Informado) {
        camposEspelho.codigo_mgv6 = codigoMgv6Valor;
      }

      const aposDualWrite = () => {
        // INFRA 02 — espelha imagem_principal na galeria (sem alterar o campo legado)
        if (imagemPrincipalGravar) {
          obterProdutoImagemService(db).sincronizarAPartirDeImagemPrincipalSafe(
            produtoId,
            imagemPrincipalGravar
          );
        }
        db.get(
          'SELECT id, nome, item_fiscal, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?',
          [produtoId],
          (auditErr, auditRow) => {
            if (!auditErr && auditRow) {
              console.log('[AUDIT PRODUTO POST] gravado no banco:', auditRow);
            }
          }
        );

        // Se controlar validade, persistir validade e criar lote inicial quando houver estoque
        if (controlarValidade) {
          if (estoqueInicial > 0 && !data_validade_inicial) {
            return res.status(400).json({
              error: 'Data de validade é obrigatória para o estoque inicial.'
            });
          }

          sincronizarValidadeELoteProduto(produtoId, {
            controlarValidade: true,
            dataValidade: data_validade_inicial,
            diasAlerta: dias_alerta_validade,
            estoqueTotal: estoqueInicial
          }, (syncErr) => {
            if (syncErr) {
              console.error('Erro ao sincronizar validade/lote inicial:', syncErr.message);
              return res.status(500).json({
                error: `Produto criado, mas falhou ao registrar validade/lote: ${syncErr.message}`
              });
            }
            continuarCriacaoProduto();
          });
        } else {
          continuarCriacaoProduto();
        }
      };

      espelharIdentificadoresSafe(produtoId, camposEspelho, { db }, () => aposDualWrite());

      function continuarCriacaoProduto() {
        inserirFaixasAtacadoProduto(produtoId, atacado_faixas, (faixaErr) => {
          if (faixaErr) {
            console.error('Erro ao salvar faixas de atacado do produto:', faixaErr.message);
            return res.status(500).json({ error: 'Produto criado, mas houve erro ao salvar faixas de atacado.' });
          }

          salvarEmbalagensProduto(
            produtoId,
            embalagens,
            unidade,
            req.user,
            (embErr) => {
              if (embErr) {
                console.error('Erro ao salvar apresentações do produto:', embErr.message);
                return res.status(500).json({ error: `Produto criado, mas houve erro ao salvar apresentações: ${embErr.message}` });
              }

              buscarProdutoCompleto(produtoId, (err2, row) => {
                if (err2 || !row) {
                  return res.status(500).json({ error: err2?.message || 'Erro ao buscar produto criado' });
                }

                publicarProdutoNoCatalogoOperacional(row);

                res.json({
                  ...row,
                  message: 'Produto criado com sucesso'
                });

                gravarAuditoria({
                  usuario_id: req.user?.id || null,
                  usuario_nome: req.user?.username || req.user?.nome || null,
                  modulo: 'produtos',
                  acao: 'criar_produto',
                  referencia_tipo: 'produto',
                  referencia_id: produtoId,
                  detalhes: {
                    nome,
                    codigo: codigoFinal,
                    codigo_gerado_automaticamente: Boolean(resolvido.gerado),
                    categoria_id,
                    estoque_atual,
                    preco_venda,
                    controlar_validade,
                    faixas_atacado: (atacado_faixas || []).length,
                    apresentacoes: Array.isArray(embalagens) ? embalagens.length : 0
                  },
                  ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de criação de produto:', auditErr));
              });
            }
          );
        });
      }
    });
  });
  });
});

// Obter estatísticas de vencimentos para o dashboard
router.get('/vencimentos/estatisticas', (req, res) => {
  lotesService.obterEstatisticasVencimentos((err, stats) => {
    if (err) {
      console.error('Erro ao obter estatísticas de vencimentos:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(stats);
  });
});

// Obter configurações de validade
router.get('/validade/configuracoes', (req, res) => {
  lotesService.obterConfiguracoesValidade((err, config) => {
    if (err) {
      console.error('Erro ao obter configurações de validade:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(config);
  });
});

// Atualizar configurações de validade
router.put('/validade/configuracoes', (req, res) => {
  const { dias_aviso_vencimento, bloquear_venda_vencido, alertar_venda_proximo_vencimento } = req.body;
  
  lotesService.atualizarConfiguracoesValidade({
    dias_aviso_vencimento,
    bloquear_venda_vencido,
    alertar_venda_proximo_vencimento
  }, (err) => {
    if (err) {
      console.error('Erro ao atualizar configurações de validade:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Configurações atualizadas com sucesso' });
  });
});

// Ajustar estoque — legado PUT (use POST preferencialmente)
router.put('/:id/ajustar-estoque', exigirPerfilAjusteEstoque(), executarAjusteEstoque);

// Apresentações comerciais (ProdutoEmbalagem)
router.get('/:id/embalagens', (req, res) => {
  const { id } = req.params;
  db.get('SELECT id FROM produtos WHERE id = ?', [id], (err, produto) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
    obterProdutoEmbalagemService(db).listarPorProduto(id, (listErr, rows) => {
      if (listErr) return res.status(500).json({ error: listErr.message });
      res.json(rows || []);
    });
  });
});

router.get('/:produtoId/embalagens/:embId/historico', (req, res) => {
  const { produtoId, embId } = req.params;
  db.get(
    'SELECT id FROM produto_embalagens WHERE id = ? AND produto_id = ?',
    [embId, produtoId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Apresentação não encontrada' });
      obterProdutoEmbalagemService(db).listarHistorico(embId, (histErr, historico) => {
        if (histErr) return res.status(500).json({ error: histErr.message });
        res.json(historico || []);
      });
    }
  );
});

/** RC4.31.12.9 — aprendizagem de UC durante compra (persistência + auditoria). */
router.post('/:id/embalagens/aprendizagem-compra', (req, res) => {
  const { id } = req.params;
  const {
    descricao,
    quantidade,
    unidade,
    compra,
    venda,
    tipo
  } = req.body || {};

  db.get('SELECT id, unidade, compra_por_embalagem FROM produtos WHERE id = ?', [id], (err, produto) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

    const svc = obterProdutoEmbalagemService(db);
    svc.adicionarApresentacaoAprendizagemCompra(
      id,
      {
        descricao,
        quantidade,
        unidade: unidade || produto.unidade,
        compra: compra === undefined || compra === null ? 1 : (Number(compra) === 1 ? 1 : 0),
        venda: Number(venda) === 1 ? 1 : 0,
        tipo: tipo || 'ROLO'
      },
      produto.unidade,
      req.user,
      (addErr, embalagem) => {
        if (addErr) {
          return res.status(400).json({ error: addErr.message });
        }

        gravarAuditoria({
          usuario_id: req.user?.id || null,
          usuario_nome: req.user?.username || req.user?.nome || null,
          modulo: 'compras',
          acao: 'aprendizagem_unidade_comercial',
          referencia_tipo: 'produto',
          referencia_id: id,
          detalhes: {
            produto_id: Number(id),
            embalagem_id: embalagem?.id || null,
            descricao: embalagem?.descricao || descricao,
            quantidade: embalagem?.quantidade || quantidade,
            unidade: embalagem?.unidade || unidade || produto.unidade,
            compra: embalagem?.compra,
            venda: embalagem?.venda,
            origem: 'COMPRA_APRENDIZAGEM'
          },
          ip_requisicao: req.ip || null
        }).catch((auditErr) => {
          console.error('[AUDIT] aprendizagem UC compra:', auditErr.message);
        });

        db.run(
          `UPDATE produtos SET compra_por_embalagem = 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [id],
          () => {
            buscarProdutoCompleto(id, (loadErr, completo) => {
              if (loadErr) {
                return res.status(500).json({ error: loadErr.message });
              }
              res.status(201).json({
                embalagem,
                produto: completo
              });
            });
          }
        );
      }
    );
  });
});

// Atualizar produto
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const {
    atacado_faixas,
    embalagens,
    saldo_fiscal_inicial,
    saldo_nao_fiscal_inicial,
    data_validade_inicial,
    data_validade,
    dias_alerta_validade,
    controlar_validade,
    plu,
    ...bodyUpdates
  } = req.body;

  const pluInformado = Object.prototype.hasOwnProperty.call(req.body, 'plu');
  const pluValidacao = pluInformado ? validarPluOpcional(plu) : { ok: true, valor: null, informado: false };
  if (!pluValidacao.ok) {
    return res.status(400).json({ error: pluValidacao.erro });
  }

  const codigoMgv6Informado = Object.prototype.hasOwnProperty.call(req.body, 'codigo_mgv6')
    || Object.prototype.hasOwnProperty.call(req.body, 'codigoMgv6');
  let codigoMgv6Valor = null;
  if (codigoMgv6Informado) {
    const brutoRaw = Object.prototype.hasOwnProperty.call(req.body, 'codigo_mgv6')
      ? req.body.codigo_mgv6
      : req.body.codigoMgv6;
    const bruto = brutoRaw == null ? '' : String(brutoRaw).trim();
    if (bruto) {
      if (!/^\d+$/.test(bruto)) {
        return res.status(400).json({ error: 'Código MGV6 inválido: informe apenas dígitos.' });
      }
      if (bruto.length > 9) {
        return res.status(400).json({ error: 'Código MGV6 inválido: máximo 9 dígitos.', code: 'MGV6_CODE_OVERFLOW' });
      }
      codigoMgv6Valor = bruto;
    }
  }

  const dataValidadeInformada = data_validade_inicial || data_validade || null;
  const diasAlertaInformado = dias_alerta_validade;
  const controlarValidadeInformado = controlar_validade;

  if (controlar_validade !== undefined) {
    bodyUpdates.controlar_validade = controlar_validade ? 1 : 0;
  }

  if (cfgValidadeEmpresa.cacheHidratado() && !cfgValidadeEmpresa.estaAtivadaSync()) {
    bodyUpdates.controlar_validade = 0;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'controla_estoque')) {
    bodyUpdates.controla_estoque = normalizarFlagControlaEstoque(req.body.controla_estoque);
  }

  console.log('[AUDIT PRODUTO PUT] id:', id, 'req.body.item_fiscal:', req.body.item_fiscal);

  db.get('SELECT * FROM produtos WHERE id = ?', [id], (err, old) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!old) {
      res.status(404).json({ error: 'Produto não encontrado' });
      return;
    }

    const aplicarSaldosIniciaisSePermitido = (callback) => {
      if (saldo_fiscal_inicial === undefined && saldo_nao_fiscal_inicial === undefined) {
        return callback(null);
      }

      produtoTemVendas(db, id, (movErr, temVendas) => {
        if (movErr) return callback(movErr);
        if (temVendas) {
          return callback(new Error('Produto já vendido não permite alterar saldos iniciais. Use Ajustar Estoque.'));
        }

        try {
          const saldos = definirSaldosIniciaisProduto(
            saldo_fiscal_inicial ?? old.saldo_fiscal,
            saldo_nao_fiscal_inicial ?? old.saldo_nao_fiscal
          );
          db.run(`
            UPDATE produtos
            SET saldo_fiscal = ?,
                saldo_nao_fiscal = ?,
                estoque_atual = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [saldos.saldo_fiscal, saldos.saldo_nao_fiscal, saldos.estoque_atual, id], callback);
        } catch (saldosErr) {
          callback(saldosErr);
        }
      });
    };

    const fields = [];
    const values = [];

    const flagFracionado = resolverFlagProdutoFracionado(bodyUpdates);
    if (flagFracionado !== undefined) {
      bodyUpdates.produto_fracionado = flagFracionado;
      bodyUpdates.vendido_por_peso = flagFracionado;
    }

    Object.assign(bodyUpdates, normalizarCamposVendaUnidade(bodyUpdates));

    if (Object.prototype.hasOwnProperty.call(bodyUpdates, 'marca_id')) {
      bodyUpdates.marca_id = normalizarMarcaIdOpcional(bodyUpdates.marca_id);
    }
    if (Object.prototype.hasOwnProperty.call(bodyUpdates, 'observacoes')) {
      bodyUpdates.observacoes = normalizarTextoOpcional(bodyUpdates.observacoes);
    }
    if (Object.prototype.hasOwnProperty.call(bodyUpdates, 'imagem_principal')) {
      bodyUpdates.imagem_principal = normalizarImagemPrincipalOpcional(bodyUpdates.imagem_principal);
    }

    // MIB — nome_busca gerado na gravação (nunca na consulta)
    if (Object.prototype.hasOwnProperty.call(bodyUpdates, 'nome')) {
      bodyUpdates.nome_busca = normalizarNomeBusca(bodyUpdates.nome);
    }

    // RC8.4.2 — normalizar modo compra por embalagem (opt-in)
    if (
      Object.prototype.hasOwnProperty.call(bodyUpdates, 'compra_por_embalagem')
      || Object.prototype.hasOwnProperty.call(bodyUpdates, 'unidade_comercial')
      || Object.prototype.hasOwnProperty.call(bodyUpdates, 'quantidade_por_embalagem')
      || Object.prototype.hasOwnProperty.call(bodyUpdates, 'valor_compra_embalagem')
    ) {
      try {
        const MotorUM = require('../services/unidades/MotorUnidadesMedida');
        const compraPorEmb = Number(
          bodyUpdates.compra_por_embalagem !== undefined
            ? bodyUpdates.compra_por_embalagem
            : old.compra_por_embalagem
        ) === 1 ? 1 : 0;
        bodyUpdates.compra_por_embalagem = compraPorEmb;
        if (!compraPorEmb) {
          bodyUpdates.unidade_comercial = 'UN';
          bodyUpdates.quantidade_por_embalagem = 0;
          bodyUpdates.valor_compra_embalagem = 0;
        } else {
          bodyUpdates.unidade_comercial = MotorUM.normalizarUnidadeComercial(
            bodyUpdates.unidade_comercial !== undefined
              ? bodyUpdates.unidade_comercial
              : old.unidade_comercial
          );
          bodyUpdates.quantidade_por_embalagem = Number(
            bodyUpdates.quantidade_por_embalagem !== undefined
              ? bodyUpdates.quantidade_por_embalagem
              : old.quantidade_por_embalagem
          ) || 0;
          bodyUpdates.valor_compra_embalagem = Number(
            bodyUpdates.valor_compra_embalagem !== undefined
              ? bodyUpdates.valor_compra_embalagem
              : old.valor_compra_embalagem
          ) || 0;
        }
      } catch (umErr) {
        console.warn('[RC8.4.2] normalização embalagem no PUT:', umErr.message);
      }
    }

    const imagemAnterior = old.imagem_principal;
    const imagemNovaInformada = Object.prototype.hasOwnProperty.call(bodyUpdates, 'imagem_principal');

    Object.keys(bodyUpdates).forEach(key => {
      if (!CAMPOS_PRODUTO_IGNORADOS.has(key)) {
        fields.push(`${key} = ?`);
        values.push(bodyUpdates[key]);
      }
    });

    const temSaldosIniciais = saldo_fiscal_inicial !== undefined || saldo_nao_fiscal_inicial !== undefined;
    const temEmbalagens = Array.isArray(embalagens);
    if (fields.length === 0 && !Array.isArray(atacado_faixas) && !temSaldosIniciais && !pluInformado && !codigoMgv6Informado && !temEmbalagens) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
    }

    if (bodyUpdates.item_fiscal !== undefined) {
      console.log('[AUDIT PRODUTO PUT] item_fiscal no UPDATE:', bodyUpdates.item_fiscal);
    }

    values.push(id);

    const espelharIdentificadoresAposSave = (done) => {
      const cb = typeof done === 'function' ? done : () => {};
      const deveEspelhar = bodyUpdates.codigo !== undefined
        || bodyUpdates.codigo_barras !== undefined
        || pluInformado
        || codigoMgv6Informado;
      if (!deveEspelhar) {
        return cb();
      }

      const camposEspelho = {
        codigo: bodyUpdates.codigo !== undefined ? bodyUpdates.codigo : old.codigo,
        codigo_barras: bodyUpdates.codigo_barras !== undefined
          ? bodyUpdates.codigo_barras
          : old.codigo_barras
      };
      if (pluInformado) {
        camposEspelho.plu = pluValidacao.valor;
      }
      if (codigoMgv6Informado) {
        camposEspelho.codigo_mgv6 = codigoMgv6Valor;
      }
      espelharIdentificadoresSafe(id, camposEspelho, { db }, () => cb());
    };

    const finalizarAtualizacao = () => {
      if (imagemNovaInformada) {
        const nova = bodyUpdates.imagem_principal;
        if (String(imagemAnterior || '') !== String(nova || '')) {
          removerArquivoImagemProduto(imagemAnterior);
        }
        obterProdutoImagemService(db).sincronizarAPartirDeImagemPrincipalSafe(id, nova);
      }

      const novoPc = bodyUpdates.preco_compra !== undefined ? bodyUpdates.preco_compra : old.preco_compra;
      const novoPv = bodyUpdates.preco_venda !== undefined ? bodyUpdates.preco_venda : old.preco_venda;
      const mudouCompra = Number(novoPc) !== Number(old.preco_compra);
      const mudouVenda = Number(novoPv) !== Number(old.preco_venda);

      function responderComProdutoAtualizado() {
        buscarProdutoCompleto(id, (err2, row) => {
          if (err2 || !row) {
            return res.status(500).json({ error: err2?.message || 'Erro ao buscar produto atualizado' });
          }
          publicarProdutoNoCatalogoOperacional(row);
          res.json(row);
        });
      }

      if (mudouCompra || mudouVenda) {
        db.run(`
          INSERT INTO produtos_preco_historico (
            produto_id, preco_compra_anterior, preco_compra_novo, preco_venda_anterior, preco_venda_novo
          ) VALUES (?, ?, ?, ?, ?)
        `, [id, old.preco_compra, novoPc, old.preco_venda, novoPv], (histErr) => {
          if (histErr) {
            console.error('Erro ao registrar histórico de preços:', histErr);
          }
          responderComProdutoAtualizado();
        });
      } else {
        responderComProdutoAtualizado();
      }

      gravarAuditoria({
        usuario_id: req.user?.id || null,
        usuario_nome: req.user?.username || req.user?.nome || null,
        modulo: 'produtos',
        acao: 'atualizar_produto',
        referencia_tipo: 'produto',
        referencia_id: id,
        detalhes: { antes: old, depois: bodyUpdates },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de produto:', auditErr));
    };

    const salvarFaixasTemporarias = (callback) => {
      if (!Array.isArray(atacado_faixas) || atacado_faixas.length === 0) {
        return callback(null);
      }

      db.run(`DELETE FROM produto_atacado WHERE produto_id = ?`, [id], (deleteErr) => {
        if (deleteErr) {
          return callback(deleteErr);
        }
        inserirFaixasAtacadoProduto(id, atacado_faixas, callback);
      });
    };

    const concluirAtualizacao = (done) => {
      salvarFaixasTemporarias((faixaErr) => {
        if (faixaErr) return done(faixaErr);

        const unidadeAtual = bodyUpdates.unidade !== undefined ? bodyUpdates.unidade : old.unidade;
        salvarEmbalagensProduto(
          id,
          temEmbalagens ? embalagens : undefined,
          unidadeAtual,
          req.user,
          (embErr) => {
            if (embErr) return done(embErr);

            aplicarSaldosIniciaisSePermitido((saldosErr) => {
              if (saldosErr) return done(saldosErr);

              const deveSincronizarValidade =
                controlarValidadeInformado !== undefined ||
                dataValidadeInformada ||
                diasAlertaInformado !== undefined;

              if (!deveSincronizarValidade) {
                return done(null);
              }

              db.get('SELECT * FROM produtos WHERE id = ?', [id], (getErr, atual) => {
                if (getErr) return done(getErr);
                if (!atual) return done(new Error('Produto não encontrado após atualização.'));

                sincronizarValidadeELoteProduto(id, {
                  controlarValidade: controlarValidadeInformado !== undefined
                    ? (controlarValidadeInformado ? 1 : 0)
                    : atual.controlar_validade,
                  dataValidade: dataValidadeInformada,
                  diasAlerta: diasAlertaInformado !== undefined
                    ? diasAlertaInformado
                    : atual.dias_alerta_validade,
                  estoqueTotal: obterEstoqueTotalProduto(atual)
                }, done);
              });
            });
          }
        );
      });
    };

    if (fields.length === 0) {
      return concluirAtualizacao((errFinal) => {
        if (errFinal) {
          return res.status(400).json({ error: errFinal.message });
        }
        espelharIdentificadoresAposSave(() => finalizarAtualizacao());
      });
    }

    db.run(`
      UPDATE produtos
      SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, values, function(updateErr) {
      if (updateErr) {
        res.status(500).json({ error: updateErr.message });
        return;
      }

      try {
        const nomeSync = bodyUpdates.nome !== undefined ? bodyUpdates.nome : old.nome;
        obterMibService().sincronizarNomeBusca(id, nomeSync);
      } catch (mibErr) {
        console.warn('[MIB] nome_busca no PUT:', mibErr.message);
      }

      db.get(
        'SELECT id, nome, item_fiscal, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE id = ?',
        [id],
        (auditErr, auditRow) => {
          if (!auditErr && auditRow) {
            console.log('[AUDIT PRODUTO PUT] gravado no banco:', auditRow);
          }
        }
      );

      concluirAtualizacao((errFinal) => {
        if (errFinal) {
          return res.status(400).json({ error: errFinal.message });
        }
        espelharIdentificadoresAposSave(() => finalizarAtualizacao());
      });
    });
  });
});

// Deletar produto — com movimentação, somente SUPER_ADMIN pode forçar.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await excluirProdutoCadastro(db, {
      produtoId: id,
      usuario: req.user
    });
    try {
      obterMibService().notificarProdutoRemovido(id);
    } catch (_) { /* ignore */ }
    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'produtos',
      acao: resultado.forcado ? 'deletar_produto_com_movimentacao' : 'deletar_produto',
      referencia_tipo: 'produto',
      referencia_id: id,
      detalhes: {
        id,
        nome: resultado.nome,
        forcado: resultado.forcado,
        tem_movimentacao: resultado.tem_movimentacao
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de produto:', auditErr));
    return res.json({
      message: 'Produto deletado com sucesso',
      forcado: resultado.forcado
    });
  } catch (err) {
    const status = Number(err.statusCode) || 500;
    return res.status(status).json({ error: err.message || 'Erro ao excluir produto' });
  }
});

// Buscar produtos com estoque baixo
router.get('/estoque/baixo', (req, res) => {
  const modoFiscal = isModoFiscalQuery(req.query.modo_fiscal);
  const exprEstoque = exprEstoqueAlerta(modoFiscal);
  const filtroFiscal = modoFiscal ? ' AND COALESCE(item_fiscal, 1) = 1' : '';

  db.all(`
    SELECT * FROM produtos 
    WHERE ${exprEstoque} <= estoque_minimo 
      ${filtroFiscal}
    ORDER BY (${exprEstoque} / NULLIF(estoque_minimo, 0)) ASC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json((rows || []).map((row) => normalizarProdutoResposta(row, modoFiscal)));
  });
});

// Buscar promoção ativa de um produto específico
router.get('/:id/promocao-ativa', (req, res) => {
  const { id } = req.params;
  
  db.get(`
    SELECT 
      p.id,
      p.produto_id,
      p.preco_original,
      p.preco_promocional,
      p.desconto_percentual,
      p.data_inicio,
      p.data_fim,
      p.status
    FROM promocoes p
    WHERE p.produto_id = ?
      AND p.status = 'ativa'
      AND date(p.data_inicio) <= date('now')
      AND date(p.data_fim) > date('now')
    LIMIT 1
  `, [id], (err, row) => {
    if (err) {
      console.error('Erro ao buscar promoção ativa:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (row) {
      res.json(row);
    } else {
      res.json(null);
    }
  });
});

// ==========================
// ENDPOINTS VENDA ATACADO
// ==========================

// Listar faixas de atacado de um produto
router.get('/:id/atacado', (req, res) => {
  const { id } = req.params;
  db.all(`
    SELECT * FROM produto_atacado
    WHERE produto_id = ?
    ORDER BY quantidade_minima ASC
  `, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Criar faixa de atacado para um produto
router.post('/:id/atacado', verificarPermissaoEspecifica('gerenciar_faixa_atacado'), (req, res) => {
  const { id } = req.params;
  const quantidade_minima = parseInt(req.body.quantidade_minima, 10);
  const preco_atacado = parseFloat(req.body.preco_atacado);

  if (!quantidade_minima || quantidade_minima <= 0) {
    return res.status(400).json({ error: 'Quantidade mínima deve ser maior que zero' });
  }
  if (isNaN(preco_atacado) || preco_atacado <= 0) {
    return res.status(400).json({ error: 'Preço atacado inválido' });
  }

  // Verificar duplicata
  db.get('SELECT COUNT(*) AS total FROM produto_atacado WHERE produto_id = ? AND quantidade_minima = ?', [id, quantidade_minima], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row && row.total > 0) return res.status(400).json({ error: 'Já existe uma faixa com essa quantidade' });

    // Buscar faixa inferior e superior para validar preços
    db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima < ? ORDER BY quantidade_minima DESC LIMIT 1', [id, quantidade_minima], (err2, lower) => {
      if (err2) return res.status(500).json({ error: err2.message });
      db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima > ? ORDER BY quantidade_minima ASC LIMIT 1', [id, quantidade_minima], (err3, higher) => {
        if (err3) return res.status(500).json({ error: err3.message });

        if (lower && preco_atacado > lower.preco_atacado) {
          return res.status(400).json({ error: 'Preço da faixa não pode ser maior que a faixa inferior' });
        }
        if (higher && preco_atacado < higher.preco_atacado) {
          return res.status(400).json({ error: 'Preço da faixa não pode ser menor que a faixa superior' });
        }

        db.run('INSERT INTO produto_atacado (produto_id, quantidade_minima, preco_atacado) VALUES (?, ?, ?)', [id, quantidade_minima, preco_atacado], function(insertErr) {
          if (insertErr) return res.status(500).json({ error: insertErr.message });
          db.get('SELECT * FROM produto_atacado WHERE id = ?', [this.lastID], (e, created) => {
            if (e) return res.status(500).json({ error: e.message });
            res.json(created);
          });
        });
      });
    });
  });
});

// Atualizar faixa de atacado
router.put('/atacado/:faixaId', verificarPermissaoEspecifica('gerenciar_faixa_atacado'), (req, res) => {
  const { faixaId } = req.params;
  const quantidade_minima = parseInt(req.body.quantidade_minima, 10);
  const preco_atacado = parseFloat(req.body.preco_atacado);

  if (!quantidade_minima || quantidade_minima <= 0) {
    return res.status(400).json({ error: 'Quantidade mínima deve ser maior que zero' });
  }
  if (isNaN(preco_atacado) || preco_atacado <= 0) {
    return res.status(400).json({ error: 'Preço atacado inválido' });
  }

  db.get('SELECT * FROM produto_atacado WHERE id = ?', [faixaId], (err, faixa) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!faixa) return res.status(404).json({ error: 'Faixa não encontrada' });

    const produtoId = faixa.produto_id;

    // Verificar duplicata em outra faixa
    db.get('SELECT COUNT(*) AS total FROM produto_atacado WHERE produto_id = ? AND quantidade_minima = ? AND id != ?', [produtoId, quantidade_minima, faixaId], (err2, row) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (row && row.total > 0) return res.status(400).json({ error: 'Já existe outra faixa com essa quantidade' });

      // Buscar faixa inferior e superior para validar preços
      db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima < ? ORDER BY quantidade_minima DESC LIMIT 1', [produtoId, quantidade_minima], (err3, lower) => {
        if (err3) return res.status(500).json({ error: err3.message });
        db.get('SELECT * FROM produto_atacado WHERE produto_id = ? AND quantidade_minima > ? ORDER BY quantidade_minima ASC LIMIT 1', [produtoId, quantidade_minima], (err4, higher) => {
          if (err4) return res.status(500).json({ error: err4.message });

          if (lower && preco_atacado > lower.preco_atacado) {
            return res.status(400).json({ error: 'Preço da faixa não pode ser maior que a faixa inferior' });
          }
          if (higher && preco_atacado < higher.preco_atacado) {
            return res.status(400).json({ error: 'Preço da faixa não pode ser menor que a faixa superior' });
          }

          db.run('UPDATE produto_atacado SET quantidade_minima = ?, preco_atacado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [quantidade_minima, preco_atacado, faixaId], function(updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            db.get('SELECT * FROM produto_atacado WHERE id = ?', [faixaId], (e, updated) => {
              if (e) return res.status(500).json({ error: e.message });
              res.json(updated);
            });
          });
        });
      });
    });
  });
});

// Buscar faixa por id
router.get('/atacado/:faixaId', (req, res) => {
  const { faixaId } = req.params;
  db.get('SELECT * FROM produto_atacado WHERE id = ?', [faixaId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || null);
  });
});

// Excluir faixa de atacado
router.delete('/atacado/:faixaId', verificarPermissaoEspecifica('gerenciar_faixa_atacado'), (req, res) => {
  const { faixaId } = req.params;
  db.run('DELETE FROM produto_atacado WHERE id = ?', [faixaId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Faixa excluída com sucesso' });
  });
});

// Listar todas as promoções com informações de status
router.get('/listar-todas-promocoes', (req, res) => {
  db.all(`
    SELECT 
      p.id,
      p.produto_id,
      pr.codigo,
      pr.nome,
      p.preco_original,
      p.preco_promocional,
      p.desconto_percentual,
      p.data_inicio,
      p.data_fim,
      p.status,
      p.criado_em,
      p.encerrado_em,
      p.motivo_encerramento,
      CASE 
        WHEN p.status = 'ativa' AND date(p.data_fim) <= date('now') THEN 'expirada'
        WHEN p.status = 'ativa' AND date(p.data_inicio) > date('now') THEN 'nao_iniciada'
        WHEN p.status = 'ativa' THEN 'vigente'
        ELSE p.status
      END AS status_real,
      CAST(julianday(date(p.data_fim)) - julianday(date('now')) AS INTEGER) AS dias_restantes
    FROM promocoes p
    LEFT JOIN produtos pr ON pr.id = p.produto_id
    ORDER BY p.data_fim DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Erro ao listar promoções:', err.message);
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Endpoint para verificar e encerrar promoções expiradas (chamável da interface)
router.post('/verificar-expiradas-agora', (req, res) => {
  const hoje = new Date().toISOString().split('T')[0];
  
  db.run(`
    UPDATE promocoes
    SET status = 'encerrada', 
        encerrado_em = CURRENT_TIMESTAMP,
        motivo_encerramento = 'Encerrada automaticamente - data de vigência expirada'
    WHERE status = 'ativa' AND date(data_fim) < date(?)
  `, [hoje], function(err) {
    if (err) {
      console.error('Erro ao encerrar promoções expiradas:', err.message);
      return res.status(500).json({ error: err.message });
    }
    
    res.json({
      success: true,
      message: `${this.changes} promoção(ões) expirada(s) encerrada(s)`,
      quantidade_encerrada: this.changes
    });
  });
});

module.exports = router;
module.exports._setPdvIdentificacaoServiceForTests = _setPdvIdentificacaoServiceForTests;
module.exports._obterPdvIdentificacaoService = obterPdvIdentificacaoService;