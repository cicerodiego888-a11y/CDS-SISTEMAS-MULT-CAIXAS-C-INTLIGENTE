/**
 * Modo ATUALIZAR QUANTIDADES — V1.0.7
 * Localiza produtos existentes e registra quantidades.
 * Fator: arquivo → senão produto_embalagens (Est. / Principal / tipo).
 * NÃO cria produto nem apresentação.
 */
'use strict';

const path = require('path');
const dbModule = require('../../database');
const { fazerBackupManual, obterPastaBackupPadrao } = require('../backupManual');
const { aplicarAjusteEstoqueProduto } = require('../ajusteEstoqueService');
const {
  STATUS,
  MODOS,
  chaveNomeCadastroSimples,
  texto,
  calcularEstoqueInicial,
  montarMotivoAtualizacaoQuantidades,
  arredondarCasas,
  mapearTipoApresentacao,
  campoNumericoInformado,
  LABEL_NAO_ALTERAR
} = require('./helpers');

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

async function carregarIndicesProdutos(db) {
  const produtos = await dbAll(db, `
    SELECT p.id, p.codigo, p.nome, p.codigo_barras, p.unidade,
           p.preco_compra, p.preco_venda, p.lucro_percentual, p.item_fiscal,
           p.estoque_atual, p.saldo_fiscal, p.saldo_nao_fiscal,
           p.categoria_id, p.subcategoria_id,
           m.nome AS marca_nome
    FROM produtos p
    LEFT JOIN marcas m ON m.id = p.marca_id
  `);
  const porCodigo = new Map();
  const porBarras = new Map();

  produtos.forEach((p) => {
    const codigo = texto(p.codigo);
    const barras = texto(p.codigo_barras);
    if (codigo) porCodigo.set(chaveNomeCadastroSimples(codigo), p);
    if (barras) porBarras.set(barras, p);
  });

  return { produtos, porCodigo, porBarras };
}

async function carregarEmbalagensProduto(db, produtoId) {
  return dbAll(
    db,
    `SELECT * FROM produto_embalagens
     WHERE produto_id = ? AND COALESCE(ativa, 1) = 1
     ORDER BY principal DESC, id ASC`,
    [produtoId]
  );
}

function localizarProdutoExistente(linha, indices) {
  const codigo = chaveNomeCadastroSimples(linha.codigo_origem);
  if (codigo && indices.porCodigo.has(codigo)) {
    return { produto: indices.porCodigo.get(codigo), motivo: 'codigo_origem' };
  }
  const barras = texto(linha.codigo_barras);
  if (barras && indices.porBarras.has(barras)) {
    return { produto: indices.porBarras.get(barras), motivo: 'codigo_barras' };
  }
  return null;
}

/**
 * Prioridade: fator do arquivo → Est.=1 compatível → Principal → tipo compatível.
 * Se origem for embalagem e não houver fator nem apresentação: erro.
 */
function resolverFatorAtualizacao(linha, apresentacoesDb) {
  const fatorArquivo = Number(linha.fator_conversao);
  if (Number.isFinite(fatorArquivo) && fatorArquivo > 0) {
    return {
      ok: true,
      fator: fatorArquivo,
      fonte: 'arquivo',
      apresentacao: null
    };
  }

  const lista = Array.isArray(apresentacoesDb) ? apresentacoesDb : [];
  const tipoOrigem = mapearTipoApresentacao(linha.unidade_origem);
  const unOrigem = String(linha.unidade_origem || '').trim().toUpperCase();
  const unBase = String(linha.unidade_base || '').trim().toUpperCase();
  const origemEhEmbalagem = Boolean(
    unOrigem
    && unOrigem !== 'UN'
    && unOrigem !== unBase
    && tipoOrigem !== 'UN'
  );

  const matchTipo = (a) => {
    const t = String(a.tipo || '').toUpperCase();
    return t === tipoOrigem || t === unOrigem || mapearTipoApresentacao(a.tipo) === tipoOrigem;
  };

  let apr = lista.find((a) => Number(a.estoque) === 1 && matchTipo(a) && Number(a.quantidade) > 0);
  if (!apr) {
    apr = lista.find((a) => Number(a.principal) === 1 && Number(a.quantidade) > 0);
  }
  if (!apr) {
    apr = lista.find((a) => matchTipo(a) && Number(a.quantidade) > 0);
  }

  if (apr && Number(apr.quantidade) > 0) {
    return {
      ok: true,
      fator: Number(apr.quantidade),
      fonte: 'produto_embalagens',
      apresentacao: apr
    };
  }

  if (origemEhEmbalagem) {
    return {
      ok: false,
      fator: null,
      fonte: null,
      apresentacao: null,
      erro: 'APRESENTACAO_NAO_ENCONTRADA'
    };
  }

  return {
    ok: true,
    fator: 1,
    fonte: 'padrao',
    apresentacao: null
  };
}

function calcularQuantidadeALancar(linha, fatorResolvido) {
  const fatorRaw = Number(
    fatorResolvido && fatorResolvido.fator !== undefined && fatorResolvido.fator !== null
      ? fatorResolvido.fator
      : linha.fator_conversao
  );
  const fator = Number.isFinite(fatorRaw) && fatorRaw > 0 ? fatorRaw : 1;
  const calc = calcularEstoqueInicial({
    quantidadeDocumento: linha.quantidade_documento,
    fatorConversao: fator
  });
  const unidadeOrigem = String(linha.unidade_origem || linha.unidade_base || 'UN').toUpperCase();
  const unidadeBase = String(linha.unidade_base || 'UN').toUpperCase();
  return {
    quantidade_origem: calc.quantidade_origem,
    fator_conversao: calc.fator_conversao,
    quantidade_a_lancar: calc.estoque_inicial,
    unidade_origem: unidadeOrigem,
    unidade_base: unidadeBase,
    qtd_origem_label: `${calc.quantidade_origem} ${unidadeOrigem}`,
    conversao_label: String(calc.fator_conversao),
    quantidade_label: `+${calc.estoque_inicial} ${unidadeBase}`,
    fator_fonte: fatorResolvido?.fonte || null
  };
}

async function validarAtualizacaoQuantidades(db, dadosExtraidos, { nomeArquivo } = {}) {
  const indices = await carregarIndicesProdutos(db);
  const linhas = [];
  let encontrados = 0;
  let naoEncontrados = 0;
  let apresNaoEncontradas = 0;
  let quantidadeTotal = 0;
  let erros = 0;

  for (let idx = 0; idx < (dadosExtraidos.quantidades || []).length; idx += 1) {
    const raw = dadosExtraidos.quantidades[idx];
    const mensagens = [];
    let status = STATUS.OK;
    const match = localizarProdutoExistente(raw, indices);
    let qtdCalc = null;
    let fatorInfo = null;

    if (!raw.codigo_origem && !raw.nome) {
      status = STATUS.ERRO;
      mensagens.push('Código origem ou nome obrigatório');
      erros += 1;
    } else if (!match) {
      status = STATUS.NAO_ENCONTRADO;
      mensagens.push('PRODUTO NÃO ENCONTRADO');
      naoEncontrados += 1;
    } else {
      const embDb = await carregarEmbalagensProduto(db, match.produto.id);
      const linhaFator = {
        ...raw,
        unidade_base: match.produto.unidade || raw.unidade_base
      };
      fatorInfo = resolverFatorAtualizacao(linhaFator, embDb);

      if (!fatorInfo.ok) {
        status = STATUS.APRESENTACAO_NAO_ENCONTRADA;
        mensagens.push('APRESENTAÇÃO NÃO ENCONTRADA');
        apresNaoEncontradas += 1;
      } else {
        qtdCalc = calcularQuantidadeALancar(linhaFator, fatorInfo);
        const unBase = String(match.produto.unidade || raw.unidade_base || 'UN').toUpperCase();
        qtdCalc.unidade_base = unBase;
        qtdCalc.quantidade_label = `+${qtdCalc.quantidade_a_lancar} ${unBase}`;

        if (!Number.isFinite(qtdCalc.quantidade_a_lancar) || qtdCalc.quantidade_a_lancar < 0) {
          status = STATUS.ERRO;
          mensagens.push('Quantidade inválida');
          erros += 1;
        } else if (campoNumericoInformado(raw.custo_informado) && Number(raw.custo_informado) < 0) {
          status = STATUS.ERRO;
          mensagens.push('Custo unitário inválido');
          erros += 1;
        } else if (campoNumericoInformado(raw.preco_informado) && Number(raw.preco_informado) < 0) {
          status = STATUS.ERRO;
          mensagens.push('Preço de venda inválido');
          erros += 1;
        } else {
          encontrados += 1;
          quantidadeTotal = arredondarCasas(quantidadeTotal + qtdCalc.quantidade_a_lancar, 3);
        }
      }
    }

    if (!qtdCalc) {
      qtdCalc = calcularQuantidadeALancar(raw, { fator: 1, fonte: 'padrao' });
    }

    const alteraCusto = campoNumericoInformado(raw.custo_informado);
    const alteraPreco = campoNumericoInformado(raw.preco_informado);
    const custoAplicar = alteraCusto ? Number(raw.custo_informado) : null;
    const precoAplicar = alteraPreco ? Number(raw.preco_informado) : null;

    linhas.push({
      linha: idx + 1,
      status,
      mensagens,
      produto: {
        codigo_origem: raw.codigo_origem,
        nome: match?.produto?.nome || raw.nome,
        nome_arquivo: raw.nome,
        unidade_base: match?.produto?.unidade || raw.unidade_base || 'UN',
        referencia_fabricante: raw.referencia_fabricante,
        origem: raw.origem,
        codigo_barras: raw.codigo_barras,
        custo_informado: raw.custo_informado,
        preco_informado: raw.preco_informado,
        custo_unitario: custoAplicar,
        preco_venda: precoAplicar
      },
      quantidade: qtdCalc,
      fator_fonte: fatorInfo?.fonte || null,
      existente_id: match?.produto?.id || null,
      match_motivo: match?.motivo || null,
      preview_atualizacao: match ? {
        estoque_atual: Number(match.produto.estoque_atual || 0),
        quantidade_importada: Number(qtdCalc.quantidade_a_lancar || 0),
        estoque_final: arredondarCasas(
          Number(match.produto.estoque_atual || 0) + Number(qtdCalc.quantidade_a_lancar || 0),
          3
        ),
        custo_atual: match.produto.preco_compra,
        novo_custo: alteraCusto ? custoAplicar : null,
        novo_custo_label: alteraCusto ? custoAplicar : LABEL_NAO_ALTERAR,
        preco_atual: match.produto.preco_venda,
        novo_preco: alteraPreco ? precoAplicar : null,
        novo_preco_label: alteraPreco ? precoAplicar : LABEL_NAO_ALTERAR,
        item_fiscal_preservado: Number(match.produto.item_fiscal) === 0 ? 0 : 1,
        alterar_custo: alteraCusto,
        alterar_preco: alteraPreco
      } : null,
      snapshot_cadastro: match ? {
        preco_compra: match.produto.preco_compra,
        preco_venda: match.produto.preco_venda,
        lucro_percentual: match.produto.lucro_percentual,
        item_fiscal: match.produto.item_fiscal,
        nome: match.produto.nome,
        categoria_id: match.produto.categoria_id,
        subcategoria_id: match.produto.subcategoria_id
      } : null
    });
  }

  const comBloqueio = naoEncontrados > 0 || apresNaoEncontradas > 0 || erros > 0;

  return {
    modo: MODOS.ATUALIZAR_QUANTIDADES,
    arquivo: nomeArquivo || null,
    resumo: {
      produtos_no_arquivo: linhas.length,
      produtos_encontrados: encontrados,
      produtos_nao_encontrados: naoEncontrados,
      apresentacoes_nao_encontradas: apresNaoEncontradas,
      quantidade_total_a_lancar: quantidadeTotal,
      quantidade_unidade: 'UN',
      com_erro: erros + naoEncontrados + apresNaoEncontradas,
      prontos: encontrados,
      erros,
      nao_encontrados: naoEncontrados
    },
    linhas,
    pode_importar: !comBloqueio && encontrados > 0
  };
}

async function jaProcessouAtualizacao(db, { produtoId, importId, codigoOrigem, origemArquivo }) {
  const motivoLike = montarMotivoAtualizacaoQuantidades({
    importId,
    codigoOrigem,
    origemArquivo
  });
  const row = await dbGet(
    db,
    `SELECT id FROM produtos_ajustes_estoque
     WHERE produto_id = ?
       AND motivo = ?
     LIMIT 1`,
    [produtoId, motivoLike]
  );
  if (row) return true;

  const rowParcial = await dbGet(
    db,
    `SELECT id FROM produtos_ajustes_estoque
     WHERE produto_id = ?
       AND motivo LIKE ?
       AND motivo LIKE ?
     LIMIT 1`,
    [
      produtoId,
      'ATUALIZAÇÃO DE QUANTIDADES — IMPORTAÇÃO%',
      `%import=${importId || 'n/a'}%`
    ]
  );
  return Boolean(rowParcial);
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
  console.error('[BACKUP] Erro na atualização de quantidades:', err.message, err.detalhes);
  return err;
}

async function executarAtualizacaoQuantidades(db, validacao, {
  usuarioId,
  usuarioNome,
  dbPath,
  pastaBackup,
  importId,
  forcarFalhaEstoque,
  forcarFalhaCustoPreco
} = {}) {
  if (validacao.modo && validacao.modo !== MODOS.ATUALIZAR_QUANTIDADES) {
    const err = new Error('Sessão inválida para atualização de quantidades.');
    err.status = 400;
    throw err;
  }

  const linhasOk = (validacao.linhas || []).filter((l) => l.status === STATUS.OK);
  const bloqueados = (validacao.linhas || []).filter((l) =>
    l.status === STATUS.NAO_ENCONTRADO
    || l.status === STATUS.APRESENTACAO_NAO_ENCONTRADA
    || l.status === STATUS.ERRO
  );

  if (bloqueados.length) {
    const err = new Error(
      `Existem ${bloqueados.length} produto(s) não encontrados, sem apresentação ou com erro. Corrija antes de registrar.`
    );
    err.status = 400;
    throw err;
  }

  if (!linhasOk.length) {
    return {
      sucesso: true,
      modo: MODOS.ATUALIZAR_QUANTIDADES,
      backup: null,
      relatorio: {
        produtos_processados: 0,
        encontrados: 0,
        nao_encontrados: 0,
        criados: 0,
        cadastro_alterado: 0,
        estoque_lancado: 0,
        movimentacoes_estoque: 0,
        ignorados_ja_processados: 0
      }
    };
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

  const refImportacao = importId || validacao.arquivo || `qtd-${Date.now()}`;
  let estoqueLancado = 0;
  let movimentacoes = 0;
  let ignorados = 0;
  let cadastroAlterado = 0;

  await dbRun(db, 'BEGIN IMMEDIATE');
  try {
    for (const linha of linhasOk) {
      const produtoId = linha.existente_id;
      if (!produtoId) {
        throw new Error('Produto sem ID interno — operação cancelada.');
      }

      const atual = await dbGet(db, `
        SELECT id, nome, preco_compra, preco_venda, lucro_percentual, item_fiscal,
               estoque_atual, saldo_fiscal, saldo_nao_fiscal, categoria_id, subcategoria_id
        FROM produtos WHERE id = ?
      `, [produtoId]);
      if (!atual) {
        throw new Error(`Produto #${produtoId} não encontrado no banco.`);
      }

      const qtd = Number(linha.quantidade?.quantidade_a_lancar || 0);
      const lancaEstoque = Number.isFinite(qtd) && qtd > 0;
      const alteraCusto = campoNumericoInformado(linha.produto?.custo_informado)
        && Number(linha.produto.custo_informado) >= 0;
      const alteraPreco = campoNumericoInformado(linha.produto?.preco_informado)
        && Number(linha.produto.preco_informado) >= 0;

      if (!lancaEstoque && !alteraCusto && !alteraPreco) {
        continue;
      }

      const codigo = linha.produto?.codigo_origem;
      const origemArquivo = linha.produto?.origem || null;

      if (lancaEstoque && await jaProcessouAtualizacao(db, {
        produtoId,
        importId: refImportacao,
        codigoOrigem: codigo,
        origemArquivo
      })) {
        ignorados += 1;
        continue;
      }

      if (lancaEstoque) {
        if (forcarFalhaEstoque) {
          throw new Error('Falha forçada no registro de quantidades (teste de rollback).');
        }

        const motivo = montarMotivoAtualizacaoQuantidades({
          importId: refImportacao,
          codigoOrigem: codigo,
          origemArquivo
        });

        const itemFiscal = Number(atual.item_fiscal) === 0 ? 0 : 1;
        await aplicarAjusteAsync(db, {
          produtoId,
          ajusteFiscal: itemFiscal === 1 ? qtd : 0,
          ajusteNaoFiscal: itemFiscal === 0 ? qtd : 0,
          motivo,
          usuarioId: usuarioId || null,
          usuarioNome: usuarioNome || 'Atualização de Quantidades'
        });
        estoqueLancado = arredondarCasas(estoqueLancado + qtd, 3);
        movimentacoes += 1;
      }

      if (alteraCusto || alteraPreco) {
        if (forcarFalhaCustoPreco === true || linha._forcarFalhaCustoPreco === true) {
          throw new Error('Falha forçada na atualização de custo/preço (teste de rollback).');
        }
        const sets = [];
        const params = [];
        if (alteraCusto) {
          sets.push('preco_compra = ?');
          params.push(Number(linha.produto.custo_informado));
        }
        if (alteraPreco) {
          sets.push('preco_venda = ?');
          params.push(Number(linha.produto.preco_informado));
        }
        params.push(produtoId);
        await dbRun(db, `UPDATE produtos SET ${sets.join(', ')} WHERE id = ?`, params);
        cadastroAlterado += 1;
      }

      const depois = await dbGet(db, `
        SELECT nome, preco_compra, preco_venda, lucro_percentual, item_fiscal,
               categoria_id, subcategoria_id
        FROM produtos WHERE id = ?
      `, [produtoId]);
      if (depois.nome !== atual.nome
        || Number(depois.item_fiscal) !== Number(atual.item_fiscal)
        || Number(depois.categoria_id || 0) !== Number(atual.categoria_id || 0)
        || Number(depois.subcategoria_id || 0) !== Number(atual.subcategoria_id || 0)
        || Number(depois.lucro_percentual) !== Number(atual.lucro_percentual)
        || (!alteraCusto && Number(depois.preco_compra) !== Number(atual.preco_compra))
        || (!alteraPreco && Number(depois.preco_venda) !== Number(atual.preco_venda))) {
        throw new Error('Integridade: dados cadastrais foram alterados indevidamente.');
      }
    }
    await dbRun(db, 'COMMIT');
  } catch (e) {
    try { await dbRun(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }

  return {
    sucesso: true,
    modo: MODOS.ATUALIZAR_QUANTIDADES,
    backup: {
      arquivo: backup.arquivo,
      caminho: backup.caminho
    },
    relatorio: {
      produtos_processados: linhasOk.length,
      encontrados: linhasOk.length,
      nao_encontrados: 0,
      criados: 0,
      cadastro_alterado: cadastroAlterado,
      estoque_lancado: estoqueLancado,
      movimentacoes_estoque: movimentacoes,
      ignorados_ja_processados: ignorados,
      import_id: refImportacao
    }
  };
}

module.exports = {
  validarAtualizacaoQuantidades,
  executarAtualizacaoQuantidades,
  calcularQuantidadeALancar,
  resolverFatorAtualizacao,
  localizarProdutoExistente,
  jaProcessouAtualizacao,
  carregarIndicesProdutos,
  carregarEmbalagensProduto
};
