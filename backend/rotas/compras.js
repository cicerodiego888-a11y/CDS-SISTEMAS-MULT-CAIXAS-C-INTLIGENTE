const express = require('express');
const router = express.Router();
const db = require('../database');
const moment = require('moment');
const { gravarAuditoria } = require('../services/auditoria');
const { validarCaixaAberto } = require('../middleware/validarCaixaAberto');
const { exigirAdmin } = require('../middleware/auth');
const lotesService = require('../services/lotesService');
const {
  resolverQuantidadesCompraItemPersistido,
  calcularDevolucaoCompraFiscalPrimeiro,
  resolverJaDevolvidoCompraFiscalPrimeiro
} = require('../services/estoqueFiscalService');
const {
  moeda,
  custoUnitarioVenda,
  itemCompraUsaConversaoUnidades,
  resolverCustoUnitarioCadastro,
  resolverPrecosCadastroAposCompra,
  obterTotalConvertidoItemCompra,
  obterQuantidadeComercial,
  obterQuantidadeConvertida,
  validarConsistenciaQuantidadesItemCompra,
  validarDistribuicaoConversaoUnidadesItem,
  resolverQuantidadesEstoqueCompraItem,
  calcularSubtotalFinanceiroItemCompra,
  resolverQuantidadesCompraItem
} = require('../lib/motorConversaoUnidades');
const { obterMuc, resultadoParaJson } = require('../motores/muc');
const ConfirmacaoConversaoEntradaNfe = require('../services/unidades/ConfirmacaoConversaoEntradaNfe');
const {
  apenasDigitos,
  sqlColunaSomenteDigitos
} = require('../services/cadastro/documentoCpfCnpj');
const {
  emitirNFeDevolucaoCompra,
  previaNfeDevolucaoCompra,
  prepararNfeDevolucaoCompra,
  listarOrigensNfeDevolucaoCompra,
  obterNfeDevolucaoPorId,
  listarHistoricoDevolucaoCompra,
  cancelarNfeDevolucaoOficial,
  consultarSituacaoDevolucao,
  reenviarNfeDevolucao,
  iniciarNovaTentativaDevolucao,
  listarEventosDevolucao,
  obterPainelStatus,
  obterXmlVersionado
} = require('../services/fiscal/nfeDevolucaoCompra');
const {
  obterRascunhoDevolucaoCompra,
  salvarRascunhoDevolucaoCompra,
  excluirRascunhoDevolucaoCompra
} = require('../services/fiscal/rascunhoDevolucaoCompra');
const {
  previewDuplicarDevolucaoCompra,
  duplicarDevolucaoCompra
} = require('../services/fiscal/duplicarDevolucaoCompra');
const {
  registrarManifestacaoDevolucao,
  obterManifestacao210240,
  resolverContextoSubstituicao210240,
  trace210240
} = require('../services/fiscal/nfeDevolucaoSubstituicaoService');
const {
  classificarResultadoEmissaoNfe
} = require('../services/fiscal/classificarResultadoEmissaoNfe');
const { getMiipService } = require('../motores/miip/getMiipService');
const centralOrchestrator = require('../motores/central-entradas/CentralEntradasOrchestrator');
const { logCentralErro } = require('../motores/central-entradas/utils/centralLog');
const {
  CODIGO_DIVERGENCIA: CODIGO_DIVERGENCIA_PRODUTO_CENTRAL,
  carregarDecisoesProduto,
  validarProdutosContraDecisao
} = require('../motores/central-entradas/services/CentralDecisaoProdutoLinha');
const CODIGO_ORIGEM_CENTRAL_OBRIGATORIA = 'ORIGEM_CENTRAL_OBRIGATORIA';
const EntradasProdutoIdentificacaoService = require('../motores/produto-identidade/services/EntradasProdutoIdentificacaoService');
const { espelharIdentificadoresSafe } = require('../motores/produto-identidade');
const { normalizarNomeBusca } = require('../motores/mib');
const { isProdutoIdentidadeEnabled } = require('../motores/produto-identidade/config/produtoIdentidadeFlags');
const {
  normalizarTipoEntrada,
  TIPO_ENTRADA_PADRAO
} = require('../services/compras/PoliticaEntradaCompra');
const {
  classificarFluxoCompra
} = require('../services/compras/MotorPoliticaEntradaCompra');
const {
  enriquecerItemFiscalCompra,
  resolverTratamentoFiscalItem
} = require('../services/compras/TratamentoFiscalItemCompra');
const configService = require('../services/configuracaoService');
const { classificarEntrada } = require('../services/compras/ClassificadorEntradaCompra');
const {
  resolverFlagsObrigatoriosCategoria,
  normalizarNomeCategoria
} = require('../services/categorias/categoriaPadroes');
const {
  montarResumoFiscalEntrada,
  normalizarEscrituracaoParaPersistencia
} = require('../services/compras/EscrituracaoEntradaCompra');
const {
  gerarGradeParcelas,
  validarSomaParcelas,
  normalizarParcelasDetalhe,
  moeda: moedaParcela
} = require('../services/compras/MotorParcelamentoCompra');

const itemCompraEhFracionado = itemCompraUsaConversaoUnidades;
const obterTotalConvertidoItemCompraBackend = obterTotalConvertidoItemCompra;
const validarDistribuicaoFracionadoItem = validarDistribuicaoConversaoUnidadesItem;

let _comprasMipService = null;

function obterComprasMipService() {
  if (!_comprasMipService) {
    _comprasMipService = new EntradasProdutoIdentificacaoService({ db });
  }
  return _comprasMipService;
}

/** @internal testes */
function _setComprasMipServiceForTests(svc) {
  _comprasMipService = svc;
}


/**
 * Vínculo oficial via Orchestrator (RC3) — mesmo pipeline da Central.
 * Retry controlado; nunca engole erro silenciosamente.
 * A compra já foi COMMIT — falha de vínculo retorna estado reconciliável.
 *
 * @param {number|string|null} centralDocumentoId
 * @param {number} compraId
 * @param {number|null} usuarioId
 * @returns {Promise<{ok: boolean, ignorado?: boolean, reconciliacaoPendente?: boolean, erro?: string, compraId?: number, documento?: Object}>}
 */
async function vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, usuarioId) {
  if (!centralDocumentoId) {
    return { ok: true, ignorado: true };
  }

  const maxTentativas = 3;
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    try {
      const resultado = await centralOrchestrator.vincularCompra(centralDocumentoId, compraId, { usuarioId });
      return {
        ok: true,
        compraId: Number(compraId),
        documentoId: Number(centralDocumentoId),
        documento: resultado?.documento || null,
        idempotente: resultado?.idempotente === true,
        tentativa
      };
    } catch (err) {
      ultimoErro = err;
      logCentralErro('COMPRAS', err, {
        documentoId: centralDocumentoId,
        compraId,
        tentativa,
        codigo: err?.codigo || null
      });
      if (tentativa < maxTentativas) {
        await new Promise((resolve) => setTimeout(resolve, 80 * tentativa));
      }
    }
  }

  console.error('[COMPRAS][vinculo-central] reconciliacao_pendente', {
    documentoId: centralDocumentoId,
    compraId,
    erro: ultimoErro?.message
  });

  return {
    ok: false,
    reconciliacaoPendente: true,
    documentoId: Number(centralDocumentoId),
    compraId: Number(compraId),
    erro: ultimoErro?.message || 'Falha ao vincular documento Central à compra',
    codigo: ultimoErro?.codigo || 'VINCULO_CENTRAL_FALHOU'
  };
}

function agoraLocalBrasil() {
  const agora = new Date();

  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );

  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');

  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

function toDate(value, fallback = agoraLocalBrasil().slice(0, 10)) {
  return value ? moment(value).format('YYYY-MM-DD') : fallback;
}

function addMonths(date, months) {
  return moment(date).add(months, 'months').format('YYYY-MM-DD');
}

function addDays(date, days) {
  return moment(date).add(Number(days) || 0, 'days').format('YYYY-MM-DD');
}

function digitsOnly(value) {
  return apenasDigitos(value);
}

function createSlugCodigo(nome = '') {
  return String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toUpperCase();
}

function calcularRateioItens(itens, totais = {}) {
  const valorProdutos = moeda(
    itens.reduce((sum, item) => sum + moeda(item.subtotal), 0)
  );

  const frete = moeda(totais.valor_frete);
  const desconto = moeda(totais.valor_desconto);
  const outras = moeda(totais.valor_outras_despesas);

  return itens.map((item) => {
    const subtotalItem = calcularSubtotalFinanceiroItemCompra(item);
    const subtotal = moeda(item.subtotal !== undefined ? item.subtotal : subtotalItem);
    const proporcao = valorProdutos > 0 ? subtotal / valorProdutos : 0;

    const freteRateado = moeda(frete * proporcao);
    const descontoRateado = moeda(desconto * proporcao);
    const outrasRateado = moeda(outras * proporcao);

    const quantidade = itemCompraEhFracionado(item)
      ? resolverQuantidadesEstoqueCompraItem(item).quantidade
      : Number(item.quantidade || 0);
    const custoTotalFinal = moeda(subtotal + freteRateado + outrasRateado - descontoRateado);
    const fracionado = Number(item.produto_fracionado ?? item.vendido_por_peso ?? 0) === 1;
    const custoUnitarioFinal = quantidade > 0
      ? (fracionado ? custoUnitarioVenda(custoTotalFinal / quantidade) : moeda(custoTotalFinal / quantidade))
      : (fracionado ? custoUnitarioVenda(item.preco_unitario) : moeda(item.preco_unitario));

    return {
      ...item,
      frete_rateado: freteRateado,
      desconto_rateado: descontoRateado,
      outras_despesas_rateado: outrasRateado,
      custo_unitario_final: custoUnitarioFinal
    };
  });
}

function garantirFornecedorCompra(dados, callback) {
  const nome = String(dados.fornecedor || '').trim();
  const cnpj = digitsOnly(dados.fornecedor_cnpj || '');

  if (!nome) return callback(null);

  if (!cnpj) return callback(null);

  db.get(`
    SELECT id FROM fornecedores 
    WHERE ${sqlColunaSomenteDigitos('cpf_cnpj')} = ?
    LIMIT 1
  `, [cnpj], (err, existente) => {
    if (err) return callback(err);
    if (existente) return callback(null);

    db.run(`
      INSERT INTO fornecedores (
        nome, razao_social, cpf_cnpj, rua, numero, bairro, cidade, uf, cep, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      nome,
      nome,
      cnpj,
      dados.fornecedor_rua || null,
      dados.fornecedor_numero || null,
      dados.fornecedor_bairro || null,
      dados.fornecedor_cidade || null,
      dados.fornecedor_uf || null,
      dados.fornecedor_cep || null,
      'Fornecedor cadastrado automaticamente pela importação de XML de compra.'
    ], callback);
  });
}

function criarFinanceiroCompra(compra, callback) {
  const {
    id,
    data_compra,
    fornecedor,
    total,
    condicao_pagamento,
    forma_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    observacao,
    numero_nf,
    dias_entre_parcelas,
    parcelas_detalhe,
    parcelas_importadas_xml
  } = compra;

  const qtdParcelas = Math.max(1, Number(parcelas) || 1);
  const valorTotal = Number(total) || 0;
  const descricaoBase = `Compra ${id}${fornecedor ? ` - ${fornecedor}` : ''}`;
  const vencimentoBase = toDate(data_vencimento, data_compra);
  const documentoNf = numero_nf ? String(numero_nf) : null;
  const gradeCliente = normalizarParcelasDetalhe(parcelas_detalhe);
  const parcelasImportadasXml = parcelas_importadas_xml === true
    || parcelas_importadas_xml === 1
    || String(parcelas_importadas_xml) === '1';

  db.run('DELETE FROM financeiro WHERE compra_id = ?', [id], (deleteErr) => {
    if (deleteErr) return callback(deleteErr);

    const inserir = (payload, done) => {
      db.run(`
        INSERT INTO financeiro (
          tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
          referencia_id, referencia_tipo, status, origem, documento, vencimento,
          numero_parcela, total_parcelas, compra_id, pessoa_nome, observacao, baixado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'despesa',
        payload.descricao,
        payload.valor,
        data_compra,
        'compras',
        forma_pagamento || null,
        id,
        'compra',
        payload.status,
        'compra',
        payload.documento || documentoNf,
        payload.vencimento,
        payload.numero_parcela,
        payload.total_parcelas,
        id,
        fornecedor || null,
        observacao || null,
        payload.status === 'pago' ? data_compra : null
      ], done);
    };

    const inserirGrade = (grade, statusResolver) => {
      if (!grade.length) {
        return callback(new Error('Grade de parcelas vazia.'));
      }
      const validacao = validarSomaParcelas(grade, valorTotal);
      if (!validacao.ok) {
        return callback(new Error(validacao.mensagem || 'Total das parcelas diverge do valor da nota.'));
      }
      let pendentes = grade.length;
      grade.forEach((p) => {
        const status = typeof statusResolver === 'function'
          ? statusResolver(p)
          : 'pendente';
        const rotulo = p.tipo === 'entrada'
          ? `${descricaoBase} - Entrada`
          : `${descricaoBase} - Parcela ${p.numero}/${grade.length}`;
        inserir({
          descricao: rotulo,
          valor: moedaParcela(p.valor),
          vencimento: toDate(p.vencimento, vencimentoBase),
          documento: p.documento || documentoNf,
          numero_parcela: p.numero,
          total_parcelas: grade.length,
          status
        }, (err) => {
          if (err) return callback(err);
          pendentes -= 1;
          if (pendentes === 0) callback(null);
        });
      });
    };

    // RC4.31.14 / RC8.5.0 — grade explícita (XML ou cliente) tem prioridade absoluta
    if (gradeCliente.length > 0) {
      return inserirGrade(gradeCliente, (p) => (
        p.tipo === 'entrada' || condicao_pagamento === 'avista' ? 'pago' : 'pendente'
      ));
    }

    if (parcelasImportadasXml) {
      return callback(new Error('Grade de parcelas importada do XML ausente ou inválida.'));
    }

    if (condicao_pagamento === 'parcelado' || condicao_pagamento === 'prazo') {
      if (qtdParcelas > 1 || condicao_pagamento === 'prazo') {
        const dias = Math.max(0, Number(dias_entre_parcelas) || 30);
        const gerada = gerarGradeParcelas({
          valorTotal,
          quantidadeParcelas: qtdParcelas,
          diasEntreParcelas: dias,
          primeiroVencimento: vencimentoBase
        });
        return inserirGrade(gerada.parcelas);
      }
    }

    if (condicao_pagamento === 'entrada_parcelado' && qtdParcelas > 0 && valor_entrada > 0) {
      const dias = Math.max(0, Number(dias_entre_parcelas) || 30);
      const gerada = gerarGradeParcelas({
        valorTotal,
        quantidadeParcelas: qtdParcelas,
        diasEntreParcelas: dias,
        primeiroVencimento: vencimentoBase,
        valorEntrada: Number(valor_entrada) || 0
      });
      return inserirGrade(gerada.parcelas, (p) => (p.tipo === 'entrada' ? 'pago' : 'pendente'));
    }

    // legado parcelado sem dias (mensal)
    if (condicao_pagamento === 'parcelado' && qtdParcelas > 1) {
      const valorBase = Math.floor((valorTotal / qtdParcelas) * 100) / 100;
      const resto = Math.round((valorTotal - (valorBase * qtdParcelas)) * 100) / 100;
      let pendentes = qtdParcelas;
      for (let i = 1; i <= qtdParcelas; i++) {
        const valorParcela = Number((valorBase + (i === qtdParcelas ? resto : 0)).toFixed(2));
        inserir({
          descricao: `${descricaoBase} - Parcela ${i}/${qtdParcelas}`,
          valor: valorParcela,
          vencimento: addMonths(vencimentoBase, i - 1),
          numero_parcela: i,
          total_parcelas: qtdParcelas,
          status: 'pendente'
        }, (err) => {
          if (err) return callback(err);
          pendentes -= 1;
          if (pendentes === 0) callback(null);
        });
      }
      return;
    }

    const pagoNaHora = condicao_pagamento === 'avista';
    inserir({
      descricao: descricaoBase,
      valor: valorTotal,
      vencimento: pagoNaHora ? data_compra : vencimentoBase,
      numero_parcela: 1,
      total_parcelas: 1,
      status: pagoNaHora ? 'pago' : 'pendente'
    }, callback);
  });
}

function ensureProductForItemLegado(item, callback, opcoes = {}) {
  const codigo = item.codigo_barras || createSlugCodigo(item.produto_nome || 'PRODUTO-IMPORTADO');
  const nome = item.produto_nome || `Produto ${codigo}`;
  const qtds = resolverQuantidadesCompraItem(item);
  const itemFiscal = qtds.quantidade_fiscal > 0 ? 1 : 0;
  const dbOperacional = opcoes.db || db;
  // Quando MIP já tentou codigo/barras, legado só casa por nome (evita SQL duplicado)
  const apenasNome = opcoes.apenasNome === true;

  const sql = apenasNome
    ? 'SELECT id FROM produtos WHERE nome = ? LIMIT 1'
    : 'SELECT id FROM produtos WHERE codigo = ? OR codigo_barras = ? OR nome = ? LIMIT 1';
  const params = apenasNome ? [nome] : [codigo, codigo, nome];

  dbOperacional.get(sql, params, (findErr, existente) => {
    if (findErr) return callback(findErr);
    if (existente) return callback(null, existente.id);

    const origemCentralNfe = String(item.origem_compra || '').toUpperCase() === 'CENTRAL_NFE';
    const precosCadastro = origemCentralNfe
      ? {
        precoCompra: resolverCustoUnitarioCadastro(item),
        precoVenda: null,
        lucroPercentual: null,
        atualizarVenda: false
      }
      : resolverPrecosCadastroAposCompra(item);
    const unidadeProduto = origemCentralNfe
      ? (item.unidade_tributavel || item.uTrib || item.unidade || 'UN')
      : (item.unidade || 'UN');
    const precoVendaProduto = origemCentralNfe
      ? 0
      : (precosCadastro.precoVenda ?? precosCadastro.precoCompra);
    const lucroProduto = origemCentralNfe ? null : precosCadastro.lucroPercentual;
    const criarProduto = (categoria) => {
      const flagsObrigatorios = resolverFlagsObrigatoriosCategoria(
        categoria?.nome || item.categoria_nome || item.categoria
      );
      const especial = Boolean(flagsObrigatorios);
      const categoriaId = especial ? (categoria?.id || null) : null;
      const controlaEstoque = especial ? flagsObrigatorios.controlaEstoque : 1;
      const itemFiscalCadastro = especial ? flagsObrigatorios.itemFiscal : itemFiscal;

      dbOperacional.run(`
        INSERT INTO produtos (
          codigo, codigo_barras, nome, nome_busca, ativo, categoria_id, unidade, preco_compra, preco_venda,
          lucro_percentual, estoque_atual, estoque_minimo, fornecedor, ncm,
          saldo_fiscal, saldo_nao_fiscal, item_fiscal, controla_estoque, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, ?, ?, CURRENT_TIMESTAMP)
      `, [
        codigo,
        item.codigo_barras || codigo,
        nome,
        normalizarNomeBusca(nome),
        categoriaId,
          unidadeProduto,
        precosCadastro.precoCompra,
          precoVendaProduto,
        lucroProduto,
        item.fornecedor || null,
        item.ncm || null,
        itemFiscalCadastro,
        controlaEstoque
      ], function(insertErr) {
        if (insertErr) return callback(insertErr);
        const novoId = this.lastID;
        if (Array.isArray(opcoes.produtosCriados)) opcoes.produtosCriados.push(novoId);
        try {
          const mipCompras = obterComprasMipService();
          if (typeof mipCompras.limparCacheCatalogo === 'function') mipCompras.limparCacheCatalogo();
        } catch (cacheErr) {
          console.warn('[MIP] compras limpar cache após criar produto:', cacheErr.message);
        }
        // Espelho dentro da transação da compra: PLU/EAN pesquisáveis assim que o COMMIT ocorrer.
        let seguiu = false;
        espelharIdentificadoresSafe(novoId, {
          codigo,
          codigo_barras: item.codigo_barras || codigo,
          plu: item.plu !== undefined ? item.plu : undefined
        }, { db: dbOperacional }, () => {
          if (seguiu) return;
          seguiu = true;
          callback(null, novoId);
        });
      });
    };

    const categoriaId = Number(item.categoria_id);
    if (Number.isInteger(categoriaId) && categoriaId > 0) {
      return dbOperacional.get(
        'SELECT id, nome FROM categorias WHERE id = ?',
        [categoriaId],
        (categoriaErr, categoria) => {
          if (categoriaErr) return callback(categoriaErr);
          criarProduto(categoria || null);
        }
      );
    }

    const nomeCategoria = item.categoria_nome || item.categoria;
    if (!nomeCategoria) return criarProduto(null);
    dbOperacional.all(
      `SELECT id, nome FROM categorias WHERE tipo = 'produto' AND COALESCE(ativo, 1) = 1`,
      [],
      (categoriasErr, categorias) => {
        if (categoriasErr) return callback(categoriasErr);
        const chaveInformada = normalizarNomeCategoria(nomeCategoria);
        const categoria = (categorias || []).find(
          (row) => normalizarNomeCategoria(row.nome) === chaveInformada
        );
        criarProduto(categoria || { id: null, nome: nomeCategoria });
      }
    );
  });
}

/**
 * Resolve produto do item: produto_id → MIP → MIIP → legado.
 * Sprint 07: MIP elimina busca duplicada codigo/barras quando flag ON.
 */
function validarItensCentralNfeSemAssociacao(itens, origemCompra) {
  if (String(origemCompra || '').toUpperCase() !== 'CENTRAL_NFE') return null;
  const linhas = [];
  (Array.isArray(itens) ? itens : []).forEach((item, indice) => {
    const pid = Number(item?.produto_id || item?.produtoId);
    if (!Number.isFinite(pid) || pid <= 0) {
      linhas.push({
        indice,
        item_key: item?.item_key ?? item?.nItem ?? item?.nitem ?? indice,
        descricao: item?.produto_nome || item?.descricao || null,
        codigo_barras: item?.codigo_barras || item?.gtin || null,
        cProd: item?.codigo_fornecedor || item?.cProd || item?.codigo || null
      });
    }
  });
  if (!linhas.length) return null;
  const err = new Error('Há itens da NF-e sem produto associado. Conclua a revisão na Central antes de efetivar.');
  err.status = 422;
  err.code = 'ITENS_SEM_ASSOCIACAO';
  err.linhas = linhas;
  return err;
}

function ensureProductForItem(item, callback, opcoesCriacao = {}) {
  const produtosCriados = opcoesCriacao.produtosCriados;
  if (item.produto_id) {
    return callback(null, Number(item.produto_id));
  }

  if (String(item.origem_compra || '').toUpperCase() === 'CENTRAL_NFE') {
    const err = new Error('Item da NF-e sem produto associado. Conclua a associação na Central antes de efetivar.');
    err.status = 422;
    err.code = 'ITEM_SEM_ASSOCIACAO';
    err.item_key = item.item_key ?? item.nItem ?? item.nitem ?? null;
    return callback(err);
  }

  const seguirComMiipOuLegado = (mipJaTentou) => {
    const MiipService = getMiipService();
    if (!MiipService.estaHabilitado()) {
      MiipService.registrarIntegracao({
        evento: 'legado_feature_flag',
        item,
        motivo: 'usarMiip=false — fluxo legado'
      });
      return ensureProductForItemLegado(item, callback, { apenasNome: mipJaTentou === true, produtosCriados });
    }

    MiipService.identificar(item, { origem: 'compra', ponto: 'ensureProductForItem' })
      .then((miip) => {
        if (miip?.desabilitado) {
          return ensureProductForItemLegado(item, callback, { apenasNome: mipJaTentou === true, produtosCriados });
        }

        if (miip?.produtoId) {
          return callback(null, Number(miip.produtoId));
        }

        MiipService.registrarIntegracao({
          evento: 'miip_fallback_legado',
          item,
          resultado: miip?.resultado ?? null,
          motivo: 'MIIP não encontrou produto — executando ensureProductForItemLegado'
        });

        return ensureProductForItemLegado(item, callback, { apenasNome: mipJaTentou === true, produtosCriados });
      })
      .catch((miipErr) => {
        MiipService.registrarIntegracao({
          evento: 'miip_erro_fallback_legado',
          item,
          erro: miipErr?.message || String(miipErr),
          motivo: 'erro MIIP — executando ensureProductForItemLegado'
        });
        ensureProductForItemLegado(item, callback, { apenasNome: mipJaTentou === true, produtosCriados });
      });
  };

  // Sprint 07 — MIP antes de MIIP/legado (quando habilitado)
  if (isProdutoIdentidadeEnabled()) {
    obterComprasMipService()
      .identificarItem(item, { origem: 'compras' })
      .then((r) => {
        if (r.encontrado && r.produtoId) {
          return callback(null, Number(r.produtoId));
        }
        return seguirComMiipOuLegado(true);
      })
      .catch((err) => {
        console.warn('[MIP] compras identificarItem falhou, seguindo MIIP/legado:', err.message);
        return seguirComMiipOuLegado(false);
      });
    return;
  }

  seguirComMiipOuLegado(false);
}

function normalizarPrecoCentralParaCentavos(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round((numero + Number.EPSILON) * 100);
}

const {
  extrairChaveConversaoItem,
  normalizarDecisaoConversaoEntrada,
  normalizarDecisoesConversaoEntrada,
  itemRequerConfirmacaoConversao,
  validarPendenciasConversaoEntrada,
  aplicarDecisoesNosItens,
  montarErroPendencias,
  reconciliarItensComDocumentoCentral,
  filtrarConfirmacoesDocumento
} = ConfirmacaoConversaoEntradaNfe;

/** Documento persistido da Central (fonte oficial das linhas do XML) e compra já vinculada, se houver. */
function carregarDocumentoCentralCompra(documentoId, callback) {
  db.get(
    `SELECT d.id, d.chave, d.parse_json, d.compra_id, c.id AS compra_existente_id
     FROM central_entradas_documentos d
     LEFT JOIN compras c ON c.id = d.compra_id
     WHERE d.id = ?`,
    [Number(documentoId)],
    (err, row) => {
      if (err) return callback(err);
      if (!row) return callback(null, null);
      let parse = {};
      try {
        parse = row.parse_json ? JSON.parse(row.parse_json) : {};
      } catch (_) {
        parse = {};
      }
      callback(null, {
        id: Number(row.id),
        chave: row.chave ? String(row.chave).replace(/\D/g, '') : '',
        compraExistenteId: row.compra_existente_id ? Number(row.compra_existente_id) : null,
        itens: Array.isArray(parse.itens) ? parse.itens : []
      });
    }
  );
}

function carregarMapaProdutosItens(itens, callback) {
  const ids = [...new Set((Array.isArray(itens) ? itens : [])
    .map((item) => Number(item?.produto_id || item?.produtoId || 0))
    .filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return callback(null, new Map());
  const placeholders = ids.map(() => '?').join(',');
  db.all(`SELECT * FROM produtos WHERE id IN (${placeholders})`, ids, (err, rows) => {
    if (err) return callback(err);
    const mapa = new Map();
    (rows || []).forEach((row) => mapa.set(Number(row.id), row));
    callback(null, mapa);
  });
}

/**
 * COMMIT conferido. No SQLite um COMMIT recusado (FK adiada, banco ocupado) deixa a transação aberta:
 * desfaz e confere no banco se a compra ficou ou não gravada antes de responder.
 */
function confirmarTransacaoCompra(compraId, chaveAcesso, callback) {
  db.run('COMMIT', (commitErr) => {
    if (!commitErr) return callback(null);
    db.run('ROLLBACK', (rollbackErr) => {
      db.get(
        'SELECT id FROM compras WHERE id = ? AND chave_acesso IS ?',
        [compraId, chaveAcesso || null],
        (consultaErr, gravada) => {
          const indeterminado = Boolean(consultaErr || gravada);
          const erro = new Error(indeterminado
            ? `Não foi possível confirmar a gravação da compra #${compraId}. Confira a compra antes de repetir.`
            : 'A compra não foi gravada: o banco recusou a confirmação e nada foi alterado. Tente novamente.');
          erro.code = indeterminado ? 'COMPRA_ESTADO_INDETERMINADO' : 'COMPRA_NAO_GRAVADA';
          erro.compraId = indeterminado ? compraId : null;
          console.error('[COMPRAS] COMMIT recusado', {
            compraId,
            commit: commitErr.message,
            rollback: rollbackErr?.message || 'ok',
            resultado: erro.code
          });
          callback(erro);
        }
      );
    });
  });
}

/**
 * Publica no catálogo operacional (cache MIP do PDV + MIB) os produtos criados pela compra,
 * pelo mesmo mecanismo do cadastro de Produtos. Chamar só após o COMMIT (em ROLLBACK eles não existem).
 * Nunca falha a compra: devolve o resumo para a resposta avisar quando a publicação não ocorreu.
 */
function publicarProdutosCriadosNaCompra(produtoIds, callback) {
  const ids = [...new Set((produtoIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const resumo = { produtos_criados: ids, publicados: 0, falhas: [] };
  if (!ids.length) return callback(resumo);

  db.all(
    `SELECT p.id, p.nome, p.nome_busca, p.codigo, p.codigo_barras, p.preco_venda, p.item_fiscal, p.ativo,
            (SELECT pi.codigo FROM produto_identificadores pi
              WHERE pi.produto_id = p.id AND UPPER(pi.tipo) = 'PLU' AND COALESCE(pi.ativo, 1) = 1
              LIMIT 1) AS plu
       FROM produtos p
      WHERE p.id IN (${ids.map(() => '?').join(', ')})`,
    ids,
    (err, rows) => {
      if (err) {
        resumo.falhas.push({ produto_id: null, erros: [err.message] });
        return callback(resumo);
      }
      let publicar;
      try {
        ({ publicarProdutoNoCatalogoOperacional: publicar } = require('./produtos'));
      } catch (reqErr) {
        resumo.falhas.push({ produto_id: null, erros: [reqErr.message] });
        return callback(resumo);
      }
      const porId = new Map((rows || []).map((row) => [Number(row.id), row]));
      ids.forEach((id) => {
        const row = porId.get(id);
        if (!row) {
          resumo.falhas.push({ produto_id: id, erros: ['produto não encontrado após o COMMIT'] });
          return;
        }
        const resultado = publicar(row) || { erros: ['publicador sem retorno'] };
        if (resultado.erros && resultado.erros.length) {
          resumo.falhas.push({ produto_id: id, erros: resultado.erros });
        } else {
          resumo.publicados += 1;
        }
      });
      if (resumo.falhas.length) {
        console.warn('[COMPRAS] publicação no catálogo operacional incompleta', resumo);
      }
      callback(resumo);
    }
  );
}

function responderFalhaCommitCompra(res, erro) {
  return res.status(500).json({ error: erro.message, code: erro.code, compra_id: erro.compraId, sucesso: false });
}

/**
 * NF-e da Central: apresentação cadastrada do próprio produto, resolvida pelo repositório do MUC com os
 * mesmos critérios de processarItemCompra. Fixa produto_apresentacao_id no item para a gravação usar a mesma.
 * @returns Map<central_item_indice, apresentação|null>
 */
function resolverApresentacoesAutorizadas(itens, fornecedorCnpj, callback) {
  const repositorio = obterMuc(db).apresentacoes;
  const mapa = new Map();
  const lista = Array.isArray(itens) ? itens : [];
  let posicao = 0;
  const proximo = () => {
    if (posicao >= lista.length) return callback(null, mapa);
    const atual = posicao;
    const item = lista[posicao++];
    const indice = Number.isInteger(item.central_item_indice) ? item.central_item_indice : atual;
    const produtoId = Number(item.produto_id || item.produtoId || 0);
    if (!(produtoId > 0)) {
      mapa.set(indice, null);
      return proximo();
    }
    repositorio.resolverPorIdentificador(produtoId, {
      gtin: item.codigo_barras,
      codigo_fornecedor: item.codigo_fornecedor,
      fornecedor_cnpj: fornecedorCnpj || item.fornecedor_cnpj,
      unidade_comercial: item.unidade_comercial
    }, (err, apresentacao) => {
      if (err) return callback(err);
      const propria = apresentacao && Number(apresentacao.produtoId) === produtoId ? apresentacao : null;
      item.produto_apresentacao_id = propria?.id ?? null;
      mapa.set(indice, propria);
      return proximo();
    });
  };
  proximo();
}

function processarItensCompra(compraId, itens, fornecedor, opcoes, done) {
  if (typeof opcoes === 'function') {
    done = opcoes;
    opcoes = {};
  }

  const fornecedorCnpj = opcoes?.fornecedor_cnpj || null;
  const origemCentralNfe = String(opcoes?.origem_compra || '').toUpperCase() === 'CENTRAL_NFE';
  let index = 0;
  let quantidadesAutorizadas = [];

  if (origemCentralNfe && Array.isArray(itens) && itens.length > 0) {
    carregarMapaProdutosItens(itens, (errMapa, produtoMap) => {
      if (errMapa) return done(errMapa);
      const apresentacoes = opcoes?.apresentacoes_autorizadas || new Map();
      const documentoId = opcoes?.central_documento_id || opcoes?.documento_id || null;
      const chaveAcesso = opcoes?.chave_acesso || null;
      const pendencias = validarPendenciasConversaoEntrada(itens, {
        produtoMap,
        confirmacoes: opcoes?.confirmacoes_conversao || opcoes?.confirmacoes || opcoes?.decisoes_conversao || [],
        documentoId,
        chaveAcesso,
        origemCompra: 'CENTRAL_NFE',
        apresentacoes
      });
      if (pendencias.length > 0) {
        return done(montarErroPendencias(pendencias));
      }
      quantidadesAutorizadas = itens.map((item, posicao) => {
        const indice = Number.isInteger(item.central_item_indice) ? item.central_item_indice : posicao;
        return ConfirmacaoConversaoEntradaNfe.quantidadeAutorizadaEntradaNfe(
          item,
          produtoMap.get(Number(item.produto_id || item.produtoId || 0)) || {},
          indice,
          { documentoId, chaveAcesso, apresentacao: apresentacoes.get(indice) || null }
        );
      });
      next();
    });
    return;
  }

  function next() {
    if (index >= itens.length) {
      done(null);
      return;
    }

    const posicaoItem = index;
    const item = itens[index++];

    if (!Number(item.quantidade_embalagens) && Number(item.quantidade_comercial) > 0) {
      item.quantidade_embalagens = Number(item.quantidade_comercial);
    }
    if (!Number(item.quantidade_convertida)) {
      item.quantidade_convertida = obterQuantidadeConvertida(item);
    }
    item.peso_total_compra = obterQuantidadeConvertida(item);
    if (origemCentralNfe) {
      item.quantidade_fiscal = Number(item.quantidade_convertida || item.quantidade || 0);
      item.quantidade_nao_fiscal = 0;
      item.item_fiscal = 1;
    }

    const itemComContexto = {
      ...item,
      origem_compra: origemCentralNfe ? 'CENTRAL_NFE' : (item.origem_compra || opcoes?.origem_compra || null),
      fornecedor: item.fornecedor || fornecedor || null,
      fornecedor_cnpj: item.fornecedor_cnpj || fornecedorCnpj || null
    };

    const seguirComProduto = (prodErr, produtoId) => {
      if (prodErr) return done(prodErr);

      db.get('SELECT * FROM produtos WHERE id = ?', [produtoId], (getProdErr, produtoRow) => {
        if (getProdErr) return done(getProdErr);

        const itemComProduto = { ...itemComContexto, produto_id: produtoId };
        const muc = obterMuc(db);

        try {
          muc.processarItemCompra(
            itemComProduto,
            produtoRow,
            {
              fornecedorCnpj: fornecedorCnpj,
              origem: origemCentralNfe ? 'CENTRAL_NFE' : (item.origem_conversao || opcoes.origem || 'MANUAL'),
              registrarAprendizado: origemCentralNfe ? false : true
            },
            (mucErr, resultadoMuc) => {
            if (mucErr) {
              if (!mucErr.status && !String(mucErr.code || '').startsWith('SQLITE')) mucErr.status = 400;
              return done(mucErr);
            }

            if (origemCentralNfe) {
              const autorizada = quantidadesAutorizadas[posicaoItem];
              const efetiva = Number(resultadoMuc?.quantidadeEstoque);
              if (autorizada == null || !Number.isFinite(efetiva) || Math.abs(efetiva - autorizada) > 0.001) {
                const err = new Error('A conversão calculada para gravação difere da conversão validada para esta linha da NF-e. Nada foi gravado.');
                err.status = 422;
                err.code = 'CONVERSAO_EFETIVA_DIVERGENTE';
                err.linhas = [{
                  indice: itemComProduto.central_item_indice ?? posicaoItem,
                  nItem: itemComProduto.nItem ?? null,
                  produto_id: produtoId,
                  quantidade_autorizada: autorizada,
                  quantidade_calculada: Number.isFinite(efetiva) ? efetiva : null
                }];
                console.warn('[COMPRAS][CENTRAL_NFE] conversão efetiva diferente da validada', err.linhas[0]);
                return done(err);
              }
            }

            const qtdsEstoque = {
              quantidade_comercial: obterQuantidadeComercial(itemComProduto),
              quantidade: resultadoMuc.quantidadeEstoque,
              quantidade_fiscal: resultadoMuc.quantidadeFiscal,
              quantidade_nao_fiscal: resultadoMuc.quantidadeNaoFiscal,
              quantidade_convertida: resultadoMuc.quantidadeEstoque
            };
            const itemProcessado = {
              ...itemComProduto,
              quantidade_comercial: qtdsEstoque.quantidade_comercial,
              quantidade_fiscal: qtdsEstoque.quantidade_fiscal,
              quantidade_nao_fiscal: qtdsEstoque.quantidade_nao_fiscal,
              quantidade: qtdsEstoque.quantidade,
              quantidade_convertida: qtdsEstoque.quantidade_convertida,
              peso_total_compra: qtdsEstoque.quantidade_convertida,
              quantidade_embalagens: Number(itemComProduto.quantidade_embalagens || itemComProduto.quantidade_comercial || 0),
              _muc_resultado: resultadoMuc
            };

            if (origemCentralNfe) {
              itemProcessado.unidade = resultadoMuc.unidadeEstoque || produtoRow?.unidade || itemProcessado.unidade;
              itemProcessado.unidade_comercial = itemComProduto.unidade_comercial || itemComProduto.uCom || itemComProduto.unidade;
              itemProcessado.quantidade_por_embalagem = resultadoMuc.fatorConversao || itemComProduto.quantidade_por_embalagem || 1;
              itemProcessado.fator_conversao = resultadoMuc.fatorConversao || itemComProduto.fator_conversao || 1;
              itemProcessado.produto_apresentacao_id = resultadoMuc.apresentacaoId || itemComProduto.produto_apresentacao_id || null;
              itemProcessado.preco_unitario = resultadoMuc.custoUnitario;
              itemProcessado.custo_unitario_final = resultadoMuc.custoUnitario;
              itemProcessado.custo_por_kg = resultadoMuc.custoUnitario;
              itemProcessado.subtotal = resultadoMuc.subtotal;
            }

            continuarItem(itemProcessado, qtdsEstoque, produtoId);
            }
          );
        } catch (mucErr) {
          mucErr.status = mucErr.status || 400;
          return done(mucErr);
        }
      });
    };

    if (origemCentralNfe) {
      const pid = Number(item.produto_id || item.produtoId);
      if (!Number.isFinite(pid) || pid <= 0) {
        const err = new Error('Item da NF-e sem produto associado. Conclua a associação na Central antes de efetivar.');
        err.status = 422;
        err.code = 'ITEM_SEM_ASSOCIACAO';
        err.indice = index - 1;
        err.item_key = item.item_key ?? item.nItem ?? item.nitem ?? (index - 1);
        return done(err);
      }
      return seguirComProduto(null, pid);
    }

    ensureProductForItem(itemComContexto, seguirComProduto, { produtosCriados: opcoes?.produtosCriados });
  }

  function continuarItem(itemProcessado, qtdsEstoque, produtoId) {
    const fornecedorCnpjLocal = opcoes?.fornecedor_cnpj || null;
    const resultadoMuc = itemProcessado._muc_resultado || null;

    const itemComContexto = {
      ...itemProcessado,
      fornecedor: itemProcessado.fornecedor || fornecedor || null,
      fornecedor_cnpj: itemProcessado.fornecedor_cnpj || fornecedorCnpjLocal || null
    };

    db.get('SELECT preco_compra, preco_venda, controlar_validade FROM produtos WHERE id = ?', [produtoId], (getErr, produto) => {
        if (getErr) return done(getErr);

        const antigo = { preco_compra: produto?.preco_compra, preco_venda: produto?.preco_venda };
        const controlarValidade = produto?.controlar_validade === 1;
        const qtdTotal = qtdsEstoque.quantidade;
        let qtdFiscal = qtdsEstoque.quantidade_fiscal;
        let qtdNaoFiscal = qtdsEstoque.quantidade_nao_fiscal;
        const fracionado = itemCompraEhFracionado(itemProcessado);
        const padraoFiscal = configService.getPadraoFiscal();
        const itemFiscal = enriquecerItemFiscalCompra(itemProcessado, {
          tipoEntradaCompra: opcoes?.tipo_entrada,
          configBonificacao: padraoFiscal
        });
        const tratamento = resolverTratamentoFiscalItem(itemFiscal, padraoFiscal);
        if (!tratamento.gerarEstoque) {
          qtdFiscal = 0;
          qtdNaoFiscal = 0;
        }
        const precoVendaOriginalCentavos = origemCentralNfe
          ? normalizarPrecoCentralParaCentavos(itemProcessado.precoVendaOriginal)
          : null;
        const precoVendaAtualCentavos = origemCentralNfe
          ? normalizarPrecoCentralParaCentavos(itemProcessado.precoVendaAtual)
          : null;
        const camposPrecoCentralInformados = itemProcessado.precoVendaOriginal !== undefined
          && itemProcessado.precoVendaAtual !== undefined;
        const precoVendaAtualEmBranco = itemProcessado.precoVendaAtual === null
          || String(itemProcessado.precoVendaAtual).trim() === '';
        if (origemCentralNfe && camposPrecoCentralInformados
          && (precoVendaOriginalCentavos === null
            || (!precoVendaAtualEmBranco && precoVendaAtualCentavos === null))) {
          return done(new Error('Preço de venda informado na Central NF-e é inválido.'));
        }
        const precoVendaManualCentral = origemCentralNfe
          && camposPrecoCentralInformados
          && !precoVendaAtualEmBranco
          && precoVendaOriginalCentavos !== precoVendaAtualCentavos;
        const precoVendaAtualCentral = precoVendaAtualCentavos === null
          ? null
          : precoVendaAtualCentavos / 100;
        const precosCadastro = origemCentralNfe
          ? {
            precoCompra: resolverCustoUnitarioCadastro(itemProcessado),
            precoVenda: precoVendaManualCentral ? precoVendaAtualCentral : null,
            lucroPercentual: precoVendaManualCentral && precoVendaAtualCentral > 0
              ? Number((((precoVendaAtualCentral - resolverCustoUnitarioCadastro(itemProcessado))
                / precoVendaAtualCentral) * 100).toFixed(2))
              : null,
            atualizarVenda: precoVendaManualCentral
          }
          : resolverPrecosCadastroAposCompra(itemProcessado);
        if (!tratamento.atualizarCusto) {
          precosCadastro.precoCompra = Number(produto?.preco_compra || precosCadastro.precoCompra || 0);
          precosCadastro.atualizarVenda = false;
        }
        const precoUnitarioGravar = fracionado || origemCentralNfe
          ? precosCadastro.precoCompra
          : moeda(itemProcessado.preco_unitario || precosCadastro.precoCompra || 0);
        const custoFinalGravar = precosCadastro.precoCompra;
        const precoVendaGravar = origemCentralNfe
          ? (precosCadastro.atualizarVenda
            ? Number(precosCadastro.precoVenda)
            : Number(produto?.preco_venda || 0))
          : (precosCadastro.atualizarVenda
            ? (precosCadastro.precoVenda ?? Number(itemProcessado.preco_venda_sugerido || 0))
            : Number(itemProcessado.preco_venda_sugerido || 0));
        const margemBrutaGravar = origemCentralNfe && precoVendaGravar > 0
          ? Number((((precoVendaGravar - custoFinalGravar) / precoVendaGravar) * 100).toFixed(2))
          : null;
        const margemCompraItemGravar = origemCentralNfe
          ? margemBrutaGravar
          : Number(itemProcessado.margem_lucro || 30);
        const precoVendaItemGravar = origemCentralNfe
          ? precoVendaGravar
          : Number(precoVendaGravar || 0);
        const atualizarPrecoVendaGravar = origemCentralNfe
          ? (precosCadastro.atualizarVenda ? 1 : 0)
          : Number(itemProcessado.atualizar_preco_venda ?? 1) === 1 ? 1 : 0;
        const subtotalGravar = resultadoMuc
          ? resultadoMuc.subtotal
          : calcularSubtotalFinanceiroItemCompra(itemProcessado);
        const apresentacaoId = resultadoMuc?.apresentacaoId
          || itemProcessado.produto_apresentacao_id
          || itemProcessado.embalagem_id
          || null;

        db.run(`
          INSERT INTO compras_itens (
            compra_id, produto_id, quantidade, preco_unitario, subtotal,
            descricao_produto, codigo_barras, margem_lucro, preco_venda_sugerido, unidade, ncm,
            frete_rateado, desconto_rateado, outras_despesas_rateado, custo_unitario_final,
            vendido_por_peso, peso_total_compra, custo_por_kg, atualizar_preco_venda, item_fiscal,
            quantidade_fiscal, quantidade_nao_fiscal,
            compra_em, quantidade_embalagens, quantidade_por_embalagem, valor_total_embalagem,
            embalagem_id, produto_apresentacao_id, resultado_conversao_json,
            fator_conversao, tipo_conversao, origem_conversao, confianca_conversao, tipo_origem_compra,
            cfop, tipo_fiscal_item, bonificacao
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          compraId,
          produtoId,
          qtdTotal,
          precoUnitarioGravar,
          subtotalGravar,
          itemProcessado.produto_nome || null,
          itemProcessado.codigo_barras || null,
          margemCompraItemGravar,
          Number(precoVendaItemGravar || 0),
          itemProcessado.unidade || 'UN',
          itemProcessado.ncm || null,
          Number(itemProcessado.frete_rateado || 0),
          Number(itemProcessado.desconto_rateado || 0),
          Number(itemProcessado.outras_despesas_rateado || 0),
          custoFinalGravar,
          Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),
          qtdsEstoque.quantidade_convertida,
          custoFinalGravar,
          atualizarPrecoVendaGravar,
          qtdFiscal > 0 ? 1 : 0,
          qtdFiscal,
          qtdNaoFiscal,
          itemProcessado.compra_em || null,
          Number(itemProcessado.quantidade_embalagens || 0),
          Number(itemProcessado.quantidade_por_embalagem || 0),
          Number(itemProcessado.valor_total_embalagem || itemProcessado.subtotal || 0),
          apresentacaoId,
          apresentacaoId,
          resultadoMuc ? resultadoParaJson(resultadoMuc) : null,
          resultadoMuc?.fatorConversao || Number(itemProcessado.quantidade_por_embalagem || 0),
          resultadoMuc?.tipoConversao || null,
          resultadoMuc?.origem || itemProcessado.origem_conversao || 'COMPRA',
          resultadoMuc?.confianca || 0,
          itemProcessado.tipo_origem_compra || resultadoMuc?.tipoOrigemCompra || null,
          itemFiscal.cfop || null,
          itemFiscal.tipo_fiscal_item || null,
          Number(itemFiscal.bonificacao || 0)
        ], (insertErr) => {
          if (insertErr) return done(insertErr);

          db.run(`
            UPDATE produtos
            SET
              saldo_fiscal = COALESCE(saldo_fiscal, 0) + ?,
              saldo_nao_fiscal = COALESCE(saldo_nao_fiscal, 0) + ?,
              estoque_atual = (COALESCE(saldo_fiscal, 0) + ?) + (COALESCE(saldo_nao_fiscal, 0) + ?),
              preco_compra = ?,
              preco_venda = CASE WHEN ? = 1 THEN ? ELSE preco_venda END${origemCentralNfe ? '' : `,
              lucro_percentual = CASE WHEN ? = 1 THEN ? ELSE lucro_percentual END`},
              fornecedor = COALESCE(?, fornecedor),
              ncm = COALESCE(?, ncm),
              codigo_barras = COALESCE(?, codigo_barras),
              unidade = ${origemCentralNfe ? 'unidade' : 'COALESCE(?, unidade)'},
              produto_fracionado = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(produto_fracionado, 0) END,
              vendido_por_peso = CASE WHEN ? = 1 THEN 1 ELSE COALESCE(vendido_por_peso, 0) END,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [
            qtdFiscal,
            qtdNaoFiscal,
            qtdFiscal,
            qtdNaoFiscal,
            precosCadastro.precoCompra,

            precosCadastro.atualizarVenda ? 1 : 0,
            precosCadastro.precoVenda ?? Number(itemProcessado.preco_venda_sugerido || 0),
            ...(origemCentralNfe ? [] : [
              precosCadastro.atualizarVenda ? 1 : 0,
              precosCadastro.lucroPercentual
            ]),

            fornecedor || null,
            itemProcessado.ncm || null,
            itemProcessado.codigo_barras || null,
            ...(origemCentralNfe ? [] : [itemProcessado.unidade || 'UN']),

            Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),

            Number(itemProcessado.produto_fracionado ?? itemProcessado.vendido_por_peso ?? 0),

            produtoId
          ], (upErr) => {
            if (upErr) return done(upErr);

            if (controlarValidade) {
              if (!itemProcessado.data_validade) {
                return done(new Error(`Produto "${itemProcessado.produto_nome || produtoId}" controla validade. Informe a data de validade.`));
              }

              const hoje = new Date().toISOString().split('T')[0];

              lotesService.criarLote({
                produto_id: produtoId,
                quantidade_inicial: qtdTotal,
                data_validade: itemProcessado.data_validade,
                data_entrada: hoje,
                origem: 'COMPRA',
                compra_id: compraId
              }, (loteErr) => {
                if (loteErr) {
                  console.error('Erro ao criar lote para compra:', loteErr.message);
                }

                continuarProcessamento();
              });
            } else {
              continuarProcessamento();
            }
          });
        });

          function continuarProcessamento() {
            const precoCompraNovo = precosCadastro.precoCompra;
            const precoVendaNovo = precosCadastro.atualizarVenda
              ? (precosCadastro.precoVenda ?? Number(itemProcessado.preco_venda_sugerido || 0))
              : Number(antigo.preco_venda || 0);

            if (antigo && (Number(antigo.preco_compra) !== Number(precoCompraNovo) || Number(antigo.preco_venda) !== Number(precoVendaNovo))) {
              db.run(`
                INSERT INTO produtos_preco_historico (
                  produto_id, preco_compra_anterior, preco_compra_novo, preco_venda_anterior, preco_venda_novo
                ) VALUES (?, ?, ?, ?, ?)
              `, [produtoId, antigo.preco_compra, precoCompraNovo, antigo.preco_venda, precoVendaNovo], () => next());
            } else {
              next();
            }
          }
    });
  }

  next();
}

function garantirTabelaDevolucoesCompra(callback) {
  db.run(`
    CREATE TABLE IF NOT EXISTS compras_devolucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id INTEGER NOT NULL,
      compra_item_id INTEGER NOT NULL,
      produto_id INTEGER NOT NULL,
      quantidade DECIMAL(10,3) NOT NULL,
      valor_unitario DECIMAL(10,2) NOT NULL,
      valor_total DECIMAL(10,2) NOT NULL,
      motivo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, callback);
}

router.post('/:id/devolver', validarCaixaAberto, (req, res) => {
  const compraId = Number(req.params.id);
  const motivo = String(req.body?.motivo || '').trim();
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

  if (!motivo || motivo.length < 10) {
    return res.status(400).json({ error: 'Informe um motivo com no mínimo 10 caracteres.' });
  }

  const itensValidos = itens
    .map(i => ({
      compra_item_id: Number(i.compra_item_id),
      quantidade: Number(i.quantidade)
    }))
    .filter(i => i.compra_item_id > 0 && i.quantidade > 0);

  if (!itensValidos.length) {
    return res.status(400).json({ error: 'Informe ao menos um item para devolução.' });
  }

  garantirTabelaDevolucoesCompra((tableErr) => {
    if (tableErr) return res.status(500).json({ error: tableErr.message });

    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.get('SELECT * FROM compras WHERE id = ?', [compraId], (compraErr, compra) => {
        if (compraErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: compraErr.message });
        }

        if (!compra) {
          db.run('ROLLBACK');
          return res.status(404).json({ error: 'Compra não encontrada.' });
        }

        if (String(compra.status || '').toLowerCase() === 'cancelada') {
          db.run('ROLLBACK');
          return res.status(400).json({ error: 'Compra cancelada não pode receber devolução.' });
        }

        let index = 0;
        let valorTotalDevolvido = 0;

        function processarProximo() {
          if (index >= itensValidos.length) return finalizar();

          const itemReq = itensValidos[index++];

          db.get(`
            SELECT
              ci.*,
              COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
              COALESCE(p.estoque_atual, 0) AS estoque_atual,
              COALESCE((
                SELECT SUM(cd.quantidade)
                FROM compras_devolucoes cd
                WHERE cd.compra_item_id = ci.id
              ), 0) AS quantidade_ja_devolvida
            FROM compras_itens ci
            LEFT JOIN produtos p ON p.id = ci.produto_id
            WHERE ci.id = ? AND ci.compra_id = ?
          `, [itemReq.compra_item_id, compraId], (itemErr, item) => {
            if (itemErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: itemErr.message });
            }

            if (!item) {
              db.run('ROLLBACK');
              return res.status(404).json({ error: 'Item da compra não encontrado.' });
            }

            const qtdComprada = Number(item.quantidade || 0);
            const qtdJaDevolvida = Number(item.quantidade_ja_devolvida || 0);
            const qtdDisponivel = qtdComprada - qtdJaDevolvida;
            const qtdDevolver = Number(itemReq.quantidade || 0);
            const estoqueAtual = Number(item.estoque_atual || 0);

            if (qtdDevolver > qtdDisponivel) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Produto "${item.produto_nome}" permite devolver no máximo ${qtdDisponivel}.`
              });
            }

            if (estoqueAtual < qtdDevolver) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Estoque insuficiente para devolver "${item.produto_nome}". Estoque atual: ${estoqueAtual}.`
              });
            }

            const valorUnitario = Number(item.custo_unitario_final || item.preco_unitario || 0);
            const valorTotal = Number((qtdDevolver * valorUnitario).toFixed(2));
            valorTotalDevolvido += valorTotal;

            db.run(`
              INSERT INTO compras_devolucoes (
                compra_id, compra_item_id, produto_id, quantidade,
                valor_unitario, valor_total, motivo
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
              compraId,
              item.id,
              item.produto_id,
              qtdDevolver,
              valorUnitario,
              valorTotal,
              motivo
            ], (insertErr) => {
              if (insertErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: insertErr.message });
              }

              const jaDevolvido = resolverJaDevolvidoCompraFiscalPrimeiro(item, qtdJaDevolvida);
              const splitDevolucao = calcularDevolucaoCompraFiscalPrimeiro(item, qtdDevolver, jaDevolvido);

              db.run(`
                UPDATE produtos
                SET
                  saldo_fiscal = saldo_fiscal - ?,
                  saldo_nao_fiscal = saldo_nao_fiscal - ?,
                  estoque_atual = (saldo_fiscal - ?) + (saldo_nao_fiscal - ?),
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
              `, [
                splitDevolucao.qtdFiscal,
                splitDevolucao.qtdNaoFiscal,
                splitDevolucao.qtdFiscal,
                splitDevolucao.qtdNaoFiscal,
                item.produto_id
              ], (estoqueErr) => {
                if (estoqueErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: estoqueErr.message });
                }

                processarProximo();
              });
            });
          });
        }

        function finalizar() {
          db.get(`
            SELECT COUNT(*) AS itens_pendentes
            FROM compras_itens ci
            WHERE ci.compra_id = ?
              AND ci.quantidade > COALESCE((
                SELECT SUM(cd.quantidade)
                FROM compras_devolucoes cd
                WHERE cd.compra_item_id = ci.id
              ), 0)
          `, [compraId], (sumErr, sum) => {
            if (sumErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: sumErr.message });
            }

            const statusNovo = Number(sum.itens_pendentes || 0) === 0
              ? 'devolvida'
              : 'devolvida_parcial';

            db.run(`
              INSERT INTO financeiro (
                tipo, descricao, valor, data_movimento, categoria, forma_pagamento,
                referencia_id, referencia_tipo, status, origem, documento,
                vencimento, compra_id, pessoa_nome, observacao
              ) VALUES (?, ?, ?, DATE('now','localtime'), ?, ?, ?, ?, ?, ?, ?, DATE('now','localtime'), ?, ?, ?)
            `, [
              'receita',
              `Crédito de devolução da compra ${compraId}`,
              Number(valorTotalDevolvido.toFixed(2)),
              'devolucao_compra',
              null,
              compraId,
              'devolucao_compra',
              'pendente',
              'devolucao_compra',
              null,
              compraId,
              compra.fornecedor || null,
              motivo
            ], (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: finErr.message });
              }

              db.run(`
                UPDATE compras
                SET status = ?,
                    observacao = COALESCE(observacao, '') || ?
                WHERE id = ?
              `, [
                statusNovo,
                ` | Devolução: ${motivo}`,
                compraId
              ], (upErr) => {
                if (upErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: upErr.message });
                }

                db.run('COMMIT');
                // auditoria de devolução (associando sessao de caixa quando aplicável)
                gravarAuditoria({
                  usuario_id: req.operadorId || req.user?.id || null,
                  usuario_nome: req.user?.nome || req.user?.username || null,
                  modulo: 'compras',
                  acao: 'devolucao_compra',
                  referencia_tipo: 'compra',
                  referencia_id: compraId,
                  detalhes: { status_compra: statusNovo, valor_devolvido: Number(valorTotalDevolvido.toFixed(2)), motivo, sessao_id: req.caixaSessaoId || null },
                  ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de devolução de compra:', auditErr));

                res.json({
                  success: true,
                  message: statusNovo === 'devolvida'
                    ? 'Compra devolvida totalmente.'
                    : 'Devolução parcial registrada com sucesso.',
                  status_compra: statusNovo,
                  valor_devolvido: Number(valorTotalDevolvido.toFixed(2))
                });
              });
            });
          });
        }

        processarProximo();
      });
    });
  });
});

router.get('/relatorio/uso-consumo', (req, res) => {
  const { inicio, fim } = req.query;
  let where = `WHERE COALESCE(c.tipo_entrada, '${TIPO_ENTRADA_PADRAO}') = 'USO_CONSUMO'`;
  const params = [];

  if (inicio) {
    where += ' AND date(COALESCE(c.data_emissao, c.data_entrada, c.data_compra)) >= date(?)';
    params.push(inicio);
  }
  if (fim) {
    where += ' AND date(COALESCE(c.data_emissao, c.data_entrada, c.data_compra)) <= date(?)';
    params.push(fim);
  }

  db.all(`
    SELECT
      c.*,
      (SELECT COUNT(*) FROM financeiro f WHERE f.compra_id = c.id) AS total_financeiro,
      (SELECT COUNT(*) FROM financeiro f WHERE f.compra_id = c.id AND f.status = 'pendente') AS parcelas_pendentes,
      (SELECT GROUP_CONCAT(f.status || ':' || COALESCE(f.vencimento, ''), '|')
         FROM financeiro f WHERE f.compra_id = c.id) AS financeiro_resumo,
      d.id AS central_documento_id,
      d.chave AS central_chave,
      (SELECT usuario_nome FROM auditoria a
         WHERE a.modulo = 'compras' AND a.referencia_tipo = 'compra' AND a.referencia_id = c.id
         AND a.acao IN ('criar_compra', 'criar_uso_consumo', 'criar_nota_fiscal_avulsa')
         ORDER BY a.id DESC LIMIT 1) AS usuario_nome
    FROM compras c
    LEFT JOIN central_entradas_documentos d ON d.compra_id = c.id
    ${where}
    ORDER BY COALESCE(c.data_emissao, c.data_entrada, c.data_compra) DESC, c.id DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      success: true,
      total: (rows || []).length,
      itens: (rows || []).map((r) => ({
        id: r.id,
        data: r.data_emissao || r.data_entrada || r.data_compra,
        fornecedor: r.fornecedor,
        fornecedor_cnpj: r.fornecedor_cnpj,
        numero_nf: r.numero_nf,
        serie_nf: r.serie_nf,
        valor: Number(r.valor_total_nota || r.total || 0),
        situacao: r.status,
        chave_acesso: r.chave_acesso,
        central_documento_id: r.central_documento_id,
        central_chave: r.central_chave,
        xml_disponivel: Boolean(r.central_documento_id || r.chave_acesso),
        financeiro: {
          total: Number(r.total_financeiro || 0),
          pendentes: Number(r.parcelas_pendentes || 0),
          resumo: r.financeiro_resumo || null
        },
        usuario: r.usuario_nome || null,
        tipo_entrada: r.tipo_entrada || TIPO_ENTRADA_PADRAO,
        observacao: r.observacao || null
      }))
    });
  });
});

router.get('/politicas-entrada', (_req, res) => {
  const { listarTiposEntrada } = require('../services/compras/PoliticaEntradaCompra');
  res.json({ success: true, tipos: listarTiposEntrada() });
});

router.post('/classificar-entrada', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado = await classificarEntrada({
      xml: body.xml,
      dadosCompra: body.dadosCompra || body.dados_compra || body,
      fornecedor_cnpj: body.fornecedor_cnpj,
      cfop: body.cfop,
      natureza: body.natureza || body.natureza_operacao,
      finalidade: body.finalidade || body.finNFe
    });
    return res.json({
      success: true,
      tipoEntrada: resultado.tipoEntrada,
      naturezaDetectada: resultado.naturezaDetectada,
      confianca: resultado.confianca,
      motivo: resultado.motivo,
      label: resultado.label,
      forca: resultado.forca,
      requerConfirmacao: resultado.requerConfirmacao,
      razoes: resultado.razoes,
      conflitos: resultado.conflitos,
      sinais: resultado.sinais
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err)
    });
  }
});

/** RC4.31.12 — Simulação MUC para compra manual (sem persistência). */
router.post('/simular-conversao-muc', (req, res) => {
  try {
    const body = req.body || {};
    const muc = obterMuc(db);
    const resultado = muc.simular({
      quantidadeCompra: Number(body.quantidadeCompra ?? body.quantidade_embalagens ?? 0),
      quantidadePorApresentacao: Number(body.quantidadePorApresentacao ?? body.quantidade_por_embalagem ?? 0),
      valorTotal: Number(body.valorTotal ?? body.valor_total_embalagem ?? 0)
    });
    return res.json({ success: true, resultado: { ...resultado } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message || String(err) });
  }
});

router.post('/resumo-fiscal-entrada', (req, res) => {
  try {
    const body = req.body || {};
    const resumo = montarResumoFiscalEntrada({
      xml: body.xml,
      tipo_entrada: body.tipo_entrada || body.tipoEntrada,
      dadosCompra: body.dadosCompra || body.dados_compra || body,
      fornecedor: body.fornecedor,
      valor_total_nota: body.valor_total_nota,
      cfop: body.cfop,
      csosn_cst: body.csosn_cst,
      cst_pis: body.cst_pis,
      cst_cofins: body.cst_cofins,
      cst_ipi: body.cst_ipi,
      natureza_operacao: body.natureza_operacao,
      escrituracao_motivo: body.escrituracao_motivo
    });
    return res.json({ success: true, ...resumo });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

router.get('/', (req, res) => {
  const { garantirTabelas } = require('../services/fiscal/nfeDevolucaoCompra');
  const { garantirTabelasSaldoDevolucao } = require('../services/fiscal/controleSaldoDevolucaoCompra');
  Promise.resolve(garantirTabelas())
    .then(() => garantirTabelasSaldoDevolucao())
    .then(() => {
    db.all(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM compras_itens WHERE compra_id = c.id) as total_itens,
        (SELECT COUNT(*) FROM financeiro f WHERE f.compra_id = c.id AND f.status = 'pendente') as parcelas_pendentes,
        (SELECT d.id FROM nfe_devolucoes_compra d
          WHERE d.compra_id = c.id AND d.status = 'autorizada'
          ORDER BY d.id DESC LIMIT 1) as nfe_devolucao_autorizada_id,
        (SELECT COALESCE(SUM(i.quantidade), 0)
          FROM nfe_devolucao_compra_itens i
          INNER JOIN nfe_devolucoes_compra n ON n.id = i.nfe_devolucao_id
          WHERE i.compra_id = c.id AND n.status = 'autorizada') as qtd_devolvida_fiscal,
        (SELECT COALESCE(SUM(ci.quantidade), 0) FROM compras_itens ci WHERE ci.compra_id = c.id) as qtd_comprada_total
      FROM compras c 
      ORDER BY c.data_compra DESC, c.id DESC
    `, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  }).catch((err) => res.status(500).json({ error: err.message }));
});

/** RC6 — pesquisa de NF-e de origem (reutiliza compras persistidas; sem motor fiscal novo). */
router.get('/nfe-devolucao/origens', async (req, res) => {
  try {
    const origens = await listarOrigensNfeDevolucaoCompra({
      chave: req.query.chave,
      numero: req.query.numero,
      serie: req.query.serie,
      fornecedor: req.query.fornecedor,
      data: req.query.data,
      compraId: req.query.compra || req.query.compraId
    });
    res.json({ success: true, origens });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', (req, res) => {
  const { id } = req.params;

  garantirTabelaDevolucoesCompra((tableErr) => {
    if (tableErr) return res.status(500).json({ error: tableErr.message });

    db.get('SELECT * FROM compras WHERE id = ?', [id], (err, compra) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!compra) return res.status(404).json({ error: 'Compra não encontrada.' });

      db.all(`
        SELECT
          ci.*,
          COALESCE(p.nome, ci.descricao_produto) AS produto_nome,
          p.codigo AS produto_codigo,
          COALESCE((
            SELECT SUM(cd.quantidade)
            FROM compras_devolucoes cd
            WHERE cd.compra_item_id = ci.id
          ), 0) AS quantidade_devolvida
        FROM compras_itens ci
        LEFT JOIN produtos p ON ci.produto_id = p.id
        WHERE ci.compra_id = ?
        ORDER BY ci.id
      `, [id], (itErr, itens) => {
        if (itErr) return res.status(500).json({ error: itErr.message });
        db.all('SELECT * FROM financeiro WHERE compra_id = ? ORDER BY numero_parcela, vencimento', [id], (finErr, financeiro) => {
          if (finErr) return res.status(500).json({ error: finErr.message });
          res.json({ ...compra, itens, financeiro });
        });
      });
    });
  });
});

router.post('/', (req, res) => {
  const {
    data_compra,
    data_emissao,
    data_entrada,
    fornecedor,
    fornecedor_cnpj,
    fornecedor_rua,
    fornecedor_numero,
    fornecedor_bairro,
    fornecedor_cidade,
    fornecedor_uf,
    fornecedor_cep,
    numero_nf,
    serie_nf,
    modelo_nf,
    chave_acesso,
    valor_produtos,
    valor_desconto,
    valor_frete,
    valor_outras_despesas,
    valor_ipi,
    valor_seguro,
    valor_total_nota,
    total,
    itens,
    condicao_pagamento,
    forma_pagamento,
    data_vencimento,
    parcelas,
    valor_entrada,
    observacao,
    dias_entre_parcelas,
    parcelas_detalhe,
    parcelas_importadas_xml,
    nota_fiscal_avulsa,
    tipo_entrada,
    tipo_entrada_sugerido,
    tipo_entrada_confianca,
    tipo_entrada_motivo,
    cfop,
    cfop_xml,
    csosn_cst,
    csosn_cst_xml,
    cst_pis,
    cst_pis_xml,
    cst_cofins,
    cst_cofins_xml,
    cst_ipi,
    cst_ipi_xml,
    natureza_operacao,
    natureza_operacao_xml,
    escrituracao_motivo,
    confirmacoes_conversao,
    confirmacoes,
    decisoes_conversao,
    xml: xmlBody,
    origem_compra,
    central_documento_id: centralDocumentoId
  } = req.body;

  const confirmacoesConversao = Array.isArray(confirmacoes_conversao)
    || Array.isArray(confirmacoes)
    || Array.isArray(decisoes_conversao)
    || typeof confirmacoes_conversao === 'object'
    || typeof confirmacoes === 'object'
    || typeof decisoes_conversao === 'object'
    ? (confirmacoes_conversao ?? confirmacoes ?? decisoes_conversao ?? [])
    : [];

  const tipoEntrada = normalizarTipoEntrada(tipo_entrada);
  const tipoSugerido = tipo_entrada_sugerido
    ? normalizarTipoEntrada(tipo_entrada_sugerido)
    : null;
  const confiancaSugestao = tipo_entrada_confianca != null
    ? Math.max(0, Math.min(100, Number(tipo_entrada_confianca) || 0))
    : null;
  const motivoSugestao = tipo_entrada_motivo
    ? String(tipo_entrada_motivo).slice(0, 500)
    : null;
  const tipoAlterado = tipoSugerido && tipoSugerido !== tipoEntrada ? 1 : 0;

  const resumoEscrituracao = montarResumoFiscalEntrada({
    xml: xmlBody || null,
    tipo_entrada: tipoEntrada,
    dadosCompra: { fornecedor, valor_total_nota, natureza_operacao },
    fornecedor,
    valor_total_nota,
    cfop,
    csosn_cst,
    cst_pis,
    cst_cofins,
    cst_ipi,
    natureza_operacao,
    cfop_xml,
    csosn_cst_xml,
    cst_pis_xml,
    cst_cofins_xml,
    cst_ipi_xml,
    natureza_xml: natureza_operacao_xml,
    escrituracao_motivo
  });
  const escrituracao = normalizarEscrituracaoParaPersistencia(req.body, resumoEscrituracao);
  const fluxo = classificarFluxoCompra({ tipo_entrada: tipoEntrada, nota_fiscal_avulsa, itens });
  const isNotaAvulsa = fluxo.isNotaAvulsa;
  const isUsoConsumo = fluxo.tipoEntrada === 'USO_CONSUMO';
  const entradaSimplificada = fluxo.entradaSimplificada;

  if (!entradaSimplificada) {
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'Informe ao menos um item para a compra.' });
    }

    for (const item of itens) {
      const erroDistribuicao = validarDistribuicaoFracionadoItem(item);
      if (erroDistribuicao) {
        return res.status(400).json({ error: erroDistribuicao });
      }
    }
  }

  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ error: 'Total da compra inválido.' });
  }

  const chaveLimpa = digitsOnly(chave_acesso || '');
  if (chaveLimpa && chaveLimpa.length !== 44) {
    return res.status(400).json({ error: 'A chave de acesso da NF deve ter 44 dígitos.' });
  }

  let totalItensCalculado;
  let totalCalculadoComAjustes;
  let diferencaTotal;
  let itensComRateio;

  const { calcularTotalComponentes } = require('../services/compras/ImportacaoFinanceiraNfe');

  if (entradaSimplificada) {
    totalItensCalculado = moeda(valor_total_nota || totalNum);
    totalCalculadoComAjustes = moeda(valor_total_nota || totalNum);
    diferencaTotal = 0;
    itensComRateio = [];
  } else {
    const padraoFiscalBonif = configService.getPadraoFiscal();
    const itensFiscais = (itens || []).map((item) => enriquecerItemFiscalCompra(item, {
      tipoEntradaCompra: tipoEntrada,
      configBonificacao: padraoFiscalBonif
    }));

    totalItensCalculado = moeda(
      itensFiscais.reduce((sum, item) => sum + moeda(item.subtotal), 0)
    );

    // RC 5.4.1 — componentes incluem IPI e seguro; total oficial = XML (valor_total_nota)
    totalCalculadoComAjustes = calcularTotalComponentes({
      valor_produtos: totalItensCalculado,
      valor_desconto,
      valor_frete,
      valor_seguro,
      valor_outras_despesas,
      valor_ipi
    });

    const totalXml = moeda(valor_total_nota || totalNum);
    diferencaTotal = moeda(totalXml - totalCalculadoComAjustes);

    itensComRateio = calcularRateioItens(itensFiscais, {
      valor_frete,
      valor_desconto,
      valor_outras_despesas
    });
  }

  // Total persistido = valor informado (XML), nunca um recálculo divergente
  const totalOficial = moeda(valor_total_nota || totalNum || totalCalculadoComAjustes);

  const condicao = condicao_pagamento || 'avista';
  const gradeParcelasReq = normalizarParcelasDetalhe(parcelas_detalhe);
  const parcelasImportadasXmlReq = parcelas_importadas_xml === true
    || parcelas_importadas_xml === 1
    || String(parcelas_importadas_xml) === '1';
  const qtdParcelas = gradeParcelasReq.length > 0
    ? gradeParcelasReq.length
    : Math.max(1, Number(parcelas) || 1);
  const diasEntre = Math.max(0, Number(dias_entre_parcelas) || 30);

  if (condicao !== 'avista' && gradeParcelasReq.length > 0) {
    const validacaoGrade = validarSomaParcelas(gradeParcelasReq, totalOficial);
    if (!validacaoGrade.ok) {
      return res.status(400).json({ error: validacaoGrade.mensagem || 'Total das parcelas diverge do valor da nota.' });
    }
  }

  let confirmacoesValidas = confirmacoesConversao;
  let apresentacoesAutorizadas = new Map();

  const continuarGravacao = () => {
    const bloqueioAssociacao = validarItensCentralNfeSemAssociacao(itens, origem_compra);
    if (bloqueioAssociacao) {
      return res.status(422).json({
        error: bloqueioAssociacao.message,
        code: bloqueioAssociacao.code,
        linhas: bloqueioAssociacao.linhas
      });
    }

    const iniciarTransacaoCompra = () => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE');

      db.run(`
        INSERT INTO compras (
          data_compra, data_emissao, data_entrada, fornecedor, fornecedor_cnpj,
          numero_nf, serie_nf, modelo_nf, chave_acesso,
          valor_produtos, valor_desconto, valor_frete, valor_seguro, valor_outras_despesas, valor_ipi,
          valor_total_nota, total, total_xml, total_itens_calculado, diferenca_total,
          status, condicao_pagamento, forma_pagamento, data_vencimento,
          parcelas, valor_entrada, dias_entre_parcelas, observacao, nota_fiscal_avulsa, tipo_entrada,
          tipo_entrada_sugerido, tipo_entrada_confianca, tipo_entrada_motivo, tipo_entrada_alterado,
          natureza_operacao, natureza_operacao_xml, cfop, cfop_xml,
          csosn_cst, csosn_cst_xml, cst_pis, cst_pis_xml,
          cst_cofins, cst_cofins_xml, cst_ipi, cst_ipi_xml,
          escrituracao_alterada, escrituracao_motivo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data_compra,
        data_emissao || null,
        data_entrada || null,
        fornecedor || null,
        fornecedor_cnpj || null,
        numero_nf || null,
        serie_nf || null,
        modelo_nf || null,
        chaveLimpa || null,
        Number(valor_produtos) || 0,
        Number(valor_desconto) || 0,
        Number(valor_frete) || 0,
        Number(valor_seguro) || 0,
        Number(valor_outras_despesas) || 0,
        Number(valor_ipi) || 0,
        totalOficial,
        totalOficial,
        totalOficial,
        totalItensCalculado,
        diferencaTotal,
        condicao,
        forma_pagamento || null,
        data_vencimento || (condicao === 'avista' ? data_compra : null),
        condicao === 'avista' ? 1 : qtdParcelas,
        Number(valor_entrada) || 0,
        diasEntre,
        observacao || null,
        isNotaAvulsa ? 1 : 0,
        tipoEntrada,
        tipoSugerido,
        confiancaSugestao,
        motivoSugestao,
        tipoAlterado,
        escrituracao.natureza_operacao,
        escrituracao.natureza_operacao_xml,
        escrituracao.cfop,
        escrituracao.cfop_xml,
        escrituracao.csosn_cst,
        escrituracao.csosn_cst_xml,
        escrituracao.cst_pis,
        escrituracao.cst_pis_xml,
        escrituracao.cst_cofins,
        escrituracao.cst_cofins_xml,
        escrituracao.cst_ipi,
        escrituracao.cst_ipi_xml,
        escrituracao.escrituracao_alterada,
        escrituracao.escrituracao_motivo
      ], function(err) {
        if (err) {
          db.run('ROLLBACK');

          if (String(err.message || '').includes('UNIQUE') || String(err.message || '').includes('compras.chave_acesso')) {
            return res.status(400).json({ error: 'Esta nota já foi lançada. A chave de acesso já existe no sistema.' });
          }

          return res.status(500).json({ error: err.message });
        }

        const compraId = this.lastID;

        if (entradaSimplificada) {
          criarFinanceiroCompra({
            id: compraId,
            data_compra,
            fornecedor,
            total: totalOficial,
            condicao_pagamento: condicao,
            forma_pagamento,
            data_vencimento: data_vencimento || (condicao === 'avista' ? data_compra : null),
            parcelas: condicao === 'avista' ? 1 : qtdParcelas,
            valor_entrada: Number(valor_entrada) || 0,
            dias_entre_parcelas: diasEntre,
            parcelas_detalhe: gradeParcelasReq,
            parcelas_importadas_xml: parcelasImportadasXmlReq,
            numero_nf,
            observacao
          }, (finErr) => {
            if (finErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: finErr.message });
            }

            confirmarTransacaoCompra(compraId, chaveLimpa, (commitErr) => {
              if (commitErr) return responderFalhaCommitCompra(res, commitErr);

              const acaoAuditoria = isUsoConsumo ? 'criar_uso_consumo' : 'criar_nota_fiscal_avulsa';
              const mensagem = isUsoConsumo
                ? 'Compra de Uso e Consumo registrada com sucesso.'
                : 'Nota Fiscal Avulsa registrada com sucesso.';

              gravarAuditoria({
                usuario_id: req.user?.id || null,
                usuario_nome: req.user?.nome || req.user?.username || null,
                modulo: 'compras',
                acao: acaoAuditoria,
                referencia_tipo: 'compra',
                referencia_id: compraId,
                detalhes: {
                  total: totalOficial,
                  fornecedor,
                  tipo_entrada: tipoEntrada,
                  tipo_entrada_sugerido: tipoSugerido,
                  tipo_entrada_confianca: confiancaSugestao,
                  tipo_entrada_motivo: motivoSugestao,
                  tipo_entrada_alterado: Boolean(tipoAlterado),
                  nota_fiscal_avulsa: isNotaAvulsa,
                  escrituracao: {
                    original: resumoEscrituracao.original,
                    utilizado: resumoEscrituracao.utilizado,
                    alterada: Boolean(escrituracao.escrituracao_alterada),
                    motivo: escrituracao.escrituracao_motivo,
                    xml_imutavel: true
                  }
                },
                ip_requisicao: req.ip || null
              }).catch((auditErr) => console.error('Erro ao gravar auditoria de entrada simplificada:', auditErr));

              const payloadResposta = {
                id: compraId,
                message: mensagem,
                tipo_entrada: tipoEntrada,
                nota_fiscal_avulsa: isNotaAvulsa,
                uso_consumo: isUsoConsumo
              };

              vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
                .then((vinculoCentral) => {
                  payloadResposta.vinculoCentral = vinculoCentral;
                  if (vinculoCentral && vinculoCentral.ok === false) {
                    payloadResposta.aviso = 'Compra gravada, mas o vínculo com a Central ficou pendente de reconciliação.';
                  }
                  return res.json(payloadResposta);
                })
                .catch((vinculoErr) => {
                  console.error('[COMPRAS][vinculo-central] erro inesperado', vinculoErr);
                  payloadResposta.vinculoCentral = {
                    ok: false,
                    reconciliacaoPendente: true,
                    documentoId: Number(centralDocumentoId),
                    compraId: Number(compraId),
                    erro: vinculoErr?.message || 'Erro inesperado no vínculo'
                  };
                  payloadResposta.aviso = 'Compra gravada, mas o vínculo com a Central ficou pendente de reconciliação.';
                  return res.json(payloadResposta);
                });
            });
          });
        } else {
          // Compra Normal: process items and create financial records
          console.log('Processando itens da compra:', compraId, itensComRateio);
          const produtosCriadosCompra = [];
          processarItensCompra(compraId, itensComRateio, fornecedor, {
            fornecedor_cnpj,
            tipo_entrada: tipoEntrada,
            origem_compra,
            confirmacoes_conversao: confirmacoesValidas,
            central_documento_id: centralDocumentoId,
            chave_acesso: chaveLimpa,
            apresentacoes_autorizadas: apresentacoesAutorizadas,
            produtosCriados: produtosCriadosCompra
          }, (itensErr) => {
            if (itensErr) {
              console.error('Erro ao processar itens da compra:', itensErr);
              db.run('ROLLBACK');
              return res.status(itensErr.status || 500).json({
                error: itensErr.message,
                code: itensErr.code || null,
                linhas: itensErr.linhas || null,
                pendencias: itensErr.pendencias || null,
                item_key: itensErr.item_key || null
              });
            }

            criarFinanceiroCompra({
              id: compraId,
              data_compra,
              fornecedor,
              total: totalOficial,
              condicao_pagamento: condicao,
              forma_pagamento,
              data_vencimento: data_vencimento || (condicao === 'avista' ? data_compra : null),
              parcelas: condicao === 'avista' ? 1 : qtdParcelas,
              valor_entrada: Number(valor_entrada) || 0,
              dias_entre_parcelas: diasEntre,
              parcelas_detalhe: gradeParcelasReq,
              parcelas_importadas_xml: parcelasImportadasXmlReq,
              numero_nf,
              observacao
            }, (finErr) => {
              if (finErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: finErr.message });
              }

              confirmarTransacaoCompra(compraId, chaveLimpa, (commitErr) => {
                if (commitErr) return responderFalhaCommitCompra(res, commitErr);

                gravarAuditoria({
                  usuario_id: req.user?.id || null,
                  usuario_nome: req.user?.nome || req.user?.username || null,
                  modulo: 'compras',
                  acao: 'criar_compra',
                  referencia_tipo: 'compra',
                  referencia_id: compraId,
                  detalhes: {
                    total: totalOficial,
                    fornecedor,
                    tipo_entrada: tipoEntrada,
                    tipo_entrada_sugerido: tipoSugerido,
                    tipo_entrada_confianca: confiancaSugestao,
                    tipo_entrada_motivo: motivoSugestao,
                    tipo_entrada_alterado: Boolean(tipoAlterado),
                    escrituracao: {
                      original: resumoEscrituracao.original,
                      utilizado: resumoEscrituracao.utilizado,
                      alterada: Boolean(escrituracao.escrituracao_alterada),
                      motivo: escrituracao.escrituracao_motivo,
                      xml_imutavel: true
                    }
                  },
                  ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de criação de compra:', auditErr));

                const payloadResposta = {
                  id: compraId,
                  message: 'Compra registrada com sucesso e integrada ao estoque/financeiro.',
                  tipo_entrada: tipoEntrada,
                  conferencia: {
                    total_xml: totalCalculadoComAjustes,
                    total_itens_calculado: totalItensCalculado,
                    diferenca_total: diferencaTotal
                  }
                };
                const adicionarAviso = (texto) => {
                  payloadResposta.aviso = payloadResposta.aviso ? `${payloadResposta.aviso} ${texto}` : texto;
                };

                publicarProdutosCriadosNaCompra(produtosCriadosCompra, (catalogoOperacional) => {
                  if (catalogoOperacional.produtos_criados.length) {
                    payloadResposta.catalogoOperacional = catalogoOperacional;
                  }
                  if (catalogoOperacional.falhas.length) {
                    adicionarAviso('Compra gravada, mas o produto novo não foi publicado no catálogo de pesquisa '
                      + '(MIB/PDV). Se não aparecer na pesquisa, reabra a tela.');
                  }

                  vincularDocumentoCentralAposCompra(centralDocumentoId, compraId, req.user?.id)
                    .then((vinculoCentral) => {
                      payloadResposta.vinculoCentral = vinculoCentral;
                      if (vinculoCentral && vinculoCentral.ok === false) {
                        adicionarAviso('Compra gravada, mas o vínculo com a Central ficou pendente de reconciliação.');
                      }
                      return res.json(payloadResposta);
                    })
                    .catch((vinculoErr) => {
                      console.error('[COMPRAS][vinculo-central] erro inesperado', vinculoErr);
                      payloadResposta.vinculoCentral = {
                        ok: false,
                        reconciliacaoPendente: true,
                        documentoId: Number(centralDocumentoId),
                        compraId: Number(compraId),
                        erro: vinculoErr?.message || 'Erro inesperado no vínculo'
                      };
                      adicionarAviso('Compra gravada, mas o vínculo com a Central ficou pendente de reconciliação.');
                      return res.json(payloadResposta);
                    });
                });
              });
            });
          });
        }
      });
    });
    };

    const bloquearLinhasCentral = (code, error, linhas = []) => res.status(422).json({ error, code, linhas });

    if (entradaSimplificada) {
      return iniciarTransacaoCompra();
    }

    if (String(origem_compra || '').toUpperCase() !== 'CENTRAL_NFE') {
      const erroOrigem = 'Esta NF-e está na Central de Entradas. Lance a compra pela Central para manter '
        + 'os produtos e as conversões decididos lá.';
      if (centralDocumentoId) return bloquearLinhasCentral(CODIGO_ORIGEM_CENTRAL_OBRIGATORIA, erroOrigem);
      if (!chaveLimpa) return iniciarTransacaoCompra();
      return db.get(
        'SELECT id FROM central_entradas_documentos WHERE chave = ? LIMIT 1',
        [chaveLimpa],
        (errOrigem, docCentral) => {
          if (errOrigem) return res.status(500).json({ error: errOrigem.message });
          if (docCentral) return bloquearLinhasCentral(CODIGO_ORIGEM_CENTRAL_OBRIGATORIA, erroOrigem);
          return iniciarTransacaoCompra();
        }
      );
    }

    if (!centralDocumentoId) {
      return bloquearLinhasCentral(
        'LINHA_CENTRAL_NAO_IDENTIFICADA',
        'Compra da Central sem documento de origem: não é possível validar as linhas da NF-e.'
      );
    }

    return carregarDocumentoCentralCompra(centralDocumentoId, (errDoc, documentoCentral) => {
      if (errDoc) return res.status(500).json({ error: errDoc.message });
      if (!documentoCentral) {
        return bloquearLinhasCentral('DOCUMENTO_CENTRAL_NAO_ENCONTRADO', 'Documento da Central não encontrado.');
      }
      if (documentoCentral.chave && chaveLimpa && documentoCentral.chave !== chaveLimpa) {
        return bloquearLinhasCentral(
          'DOCUMENTO_CENTRAL_DIVERGENTE',
          'A chave de acesso enviada não corresponde ao documento da Central.'
        );
      }
      if (documentoCentral.compraExistenteId) {
        return bloquearLinhasCentral(
          'DOCUMENTO_CENTRAL_JA_EFETIVADO',
          `Esta NF-e da Central já foi efetivada na compra #${documentoCentral.compraExistenteId}.`
        );
      }

      const reconciliacao = reconciliarItensComDocumentoCentral(itensComRateio, documentoCentral);
      if (!reconciliacao.ok) {
        return bloquearLinhasCentral(
          'LINHA_CENTRAL_NAO_IDENTIFICADA',
          'Não foi possível identificar a linha original da NF-e na Central.',
          reconciliacao.erros
        );
      }
      const restaurados = reconciliacao.itens.filter((item) => item.campos_xml_restaurados.length > 0);
      if (restaurados.length > 0) {
        console.warn('[COMPRAS][CENTRAL_NFE] campos do XML restaurados a partir da Central', {
          documentoId: documentoCentral.id,
          linhas: restaurados.map((item) => ({ nItem: item.nItem, campos: item.campos_xml_restaurados }))
        });
      }
      itensComRateio = reconciliacao.itens;
      confirmacoesValidas = filtrarConfirmacoesDocumento(confirmacoesConversao, documentoCentral.id);

      return carregarDecisoesProduto(db, documentoCentral, (errDecisoes, decisoesProduto) => {
        if (errDecisoes) return res.status(500).json({ error: errDecisoes.message });
        const produtosDivergentes = validarProdutosContraDecisao(itensComRateio, decisoesProduto);
        if (produtosDivergentes.length > 0) {
          console.warn('[COMPRAS][CENTRAL_NFE] produto diferente da decisão da Central', {
            documentoId: documentoCentral.id,
            linhas: produtosDivergentes.map((l) => ({
              indice: l.central_item_indice,
              enviado: l.produto_id_enviado,
              decidido: l.produto_id_decidido
            }))
          });
          return bloquearLinhasCentral(
            CODIGO_DIVERGENCIA_PRODUTO_CENTRAL,
            'O produto de uma ou mais linhas é diferente do decidido na Central de Entradas. '
              + 'Para trocar, faça a correção do produto na Central.',
            produtosDivergentes
          );
        }

        const conversaoDescartada = itensComRateio.filter((item) => item.campos_conversao_descartados.length > 0);
        if (conversaoDescartada.length > 0) {
          console.warn('[COMPRAS][CENTRAL_NFE] fator/quantidade convertida da tela ignorados; vale o cadastro do produto', {
            documentoId: documentoCentral.id,
            linhas: conversaoDescartada.map((item) => ({ nItem: item.nItem, campos: item.campos_conversao_descartados }))
          });
        }

        return carregarMapaProdutosItens(itensComRateio, (errMapa, produtoMap) => {
          if (errMapa) return res.status(500).json({ error: errMapa.message });
          return resolverApresentacoesAutorizadas(itensComRateio, fornecedor_cnpj, (errAp, apresentacoes) => {
            if (errAp) return res.status(500).json({ error: errAp.message });
            apresentacoesAutorizadas = apresentacoes;
            const pendenciasConversao = validarPendenciasConversaoEntrada(itensComRateio, {
              produtoMap,
              confirmacoes: confirmacoesValidas,
              documentoId: documentoCentral.id,
              chaveAcesso: documentoCentral.chave || chaveLimpa,
              origemCompra: 'CENTRAL_NFE',
              apresentacoes
            });
            if (pendenciasConversao.length > 0) {
              const erroConv = montarErroPendencias(pendenciasConversao);
              return res.status(422).json({
                error: erroConv.message,
                code: erroConv.code,
                pendencias: pendenciasConversao,
                linhas: pendenciasConversao
              });
            }
            itensComRateio = aplicarDecisoesNosItens(itensComRateio, {
              produtoMap,
              confirmacoes: confirmacoesValidas,
              documentoId: documentoCentral.id,
              chaveAcesso: documentoCentral.chave || chaveLimpa,
              apresentacoes
            });
            return iniciarTransacaoCompra();
          });
        });
      });
    });
  };

  if (chaveLimpa) {
    db.get('SELECT id, status FROM compras WHERE chave_acesso = ? LIMIT 1', [chaveLimpa], (dupErr, existente) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });

      if (existente) {
        return res.status(400).json({
          error: `Esta nota já foi lançada na compra #${existente.id}. Não é permitido lançar a mesma chave de acesso duas vezes.` 
        });
      }

      garantirFornecedorCompra({
        fornecedor,
        fornecedor_cnpj,
        fornecedor_rua,
        fornecedor_numero,
        fornecedor_bairro,
        fornecedor_cidade,
        fornecedor_uf,
        fornecedor_cep
      }, (fornErr) => {
        if (fornErr) return res.status(500).json({ error: fornErr.message });
        continuarGravacao();
      });
    });
  } else {
    garantirFornecedorCompra({
      fornecedor,
      fornecedor_cnpj,
      fornecedor_rua,
      fornecedor_numero,
      fornecedor_bairro,
      fornecedor_cidade,
      fornecedor_uf,
      fornecedor_cep
    }, (fornErr) => {
      if (fornErr) return res.status(500).json({ error: fornErr.message });
      continuarGravacao();
    });
  }
});

router.post('/:id/cancelar', (req, res) => {
  const { id } = req.params;
  const motivo = String(req.body?.motivo || 'Cancelamento manual da compra').trim();

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE');

    db.get('SELECT * FROM compras WHERE id = ?', [id], (compraErr, compra) => {
      if (compraErr) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: compraErr.message });
      }

      if (!compra) {
        db.run('ROLLBACK');
        return res.status(404).json({ error: 'Compra não encontrada.' });
      }

      if (compra.status === 'cancelada') {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Esta compra já está cancelada.' });
      }

      db.all('SELECT * FROM compras_itens WHERE compra_id = ?', [id], (itensErr, itens) => {
        if (itensErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: itensErr.message });
        }

        const tipoEntrada = normalizarTipoEntrada(compra.tipo_entrada);
        const pularEstoque = !itens.length
          || Number(compra.nota_fiscal_avulsa) === 1
          || tipoEntrada === 'USO_CONSUMO';

        const validarEstoque = (index = 0) => {
          if (pularEstoque || index >= itens.length) return baixarEstoque();

          const item = itens[index];

          db.get('SELECT nome, estoque_atual FROM produtos WHERE id = ?', [item.produto_id], (prodErr, produto) => {
            if (prodErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: prodErr.message });
            }

            const estoqueAtual = Number(produto?.estoque_atual || 0);
            const quantidadeBaixar = Number(item.quantidade || 0);

            if (estoqueAtual < quantidadeBaixar) {
              db.run('ROLLBACK');
              return res.status(400).json({
                error: `Não é possível cancelar. O produto "${produto?.nome || item.descricao_produto}" tem estoque atual ${estoqueAtual}, mas a compra adicionou ${quantidadeBaixar}.` 
              });
            }

            validarEstoque(index + 1);
          });
        };

        const baixarEstoque = (index = 0) => {
          if (pularEstoque || index >= itens.length) return finalizarCancelamento();

          const item = itens[index];
          const qtds = resolverQuantidadesCompraItemPersistido(item);

          db.run(`
            UPDATE produtos
            SET
              saldo_fiscal = saldo_fiscal - ?,
              saldo_nao_fiscal = saldo_nao_fiscal - ?,
              estoque_atual = (saldo_fiscal - ?) + (saldo_nao_fiscal - ?),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [
            qtds.quantidade_fiscal,
            qtds.quantidade_nao_fiscal,
            qtds.quantidade_fiscal,
            qtds.quantidade_nao_fiscal,
            item.produto_id
          ], (upErr) => {
            if (upErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: upErr.message });
            }

            baixarEstoque(index + 1);
          });
        };

        const finalizarCancelamento = () => {
          db.run(`
            UPDATE financeiro
            SET status = 'cancelado',
                observacao = COALESCE(observacao, '') || ' | Cancelado junto com a compra.'
            WHERE compra_id = ?
          `, [id], (finErr) => {
            if (finErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: finErr.message });
            }

            db.run(`
              UPDATE compras
              SET status = 'cancelada',
                  cancelada_em = CURRENT_TIMESTAMP,
                  motivo_cancelamento = ?
              WHERE id = ?
            `, [motivo, id], (compraUpErr) => {
              if (compraUpErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: compraUpErr.message });
              }

              db.run('COMMIT');
              // gravar auditoria do cancelamento
              gravarAuditoria({
                usuario_id: req.user?.id || null,
                usuario_nome: req.user?.nome || req.user?.username || null,
                modulo: 'compras',
                acao: 'cancelar_compra',
                referencia_tipo: 'compra',
                referencia_id: id,
                detalhes: { motivo },
                ip_requisicao: req.ip || null
              }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento de compra:', auditErr));

              res.json({ message: 'Compra cancelada com segurança. Estoque e financeiro foram ajustados.' });
            });
          });
        };

        validarEstoque();
      });
    });
  });
});

/** @deprecated RC1 — Upload descontinuado; documentos entram pela Central Inteligente. */
router.post('/parse-xml', async (req, res) => {
  return res.status(410).json({
    error: 'Upload de XML em Compras foi descontinuado.',
    deprecated: true,
    mensagem: 'Documentos fiscais devem entrar pela Central Inteligente de Entradas.',
    substituicao: 'POST /api/central-entradas/sincronizar (DF-e) ou aguarde upload enterprise na Central.',
    documentacao: 'backend/motores/central-entradas/README.md'
  });
});

/** RC1 — pré-preenchimento Central NF-e modo DEVOLUÇÃO */
router.get('/:id/nfe-devolucao/preparar', async (req, res) => {
  try {
    const prep = await prepararNfeDevolucaoCompra(Number(req.params.id));
    res.json({ success: true, ...prep });
  } catch (error) {
    console.error('Erro ao preparar NF-e de devolução:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

/** Rascunho de devolução — não emite NF-e nem altera saldo */
router.get('/:id/nfe-devolucao/rascunho', async (req, res) => {
  try {
    const rascunho = await obterRascunhoDevolucaoCompra(Number(req.params.id));
    res.json({ success: true, rascunho });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/nfe-devolucao/rascunho', async (req, res) => {
  try {
    const body = req.body || {};
    const rascunho = await salvarRascunhoDevolucaoCompra(Number(req.params.id), body, {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null
    });
    res.json({
      success: true,
      message: 'Rascunho da devolução salvo. Você pode continuar depois.',
      rascunho
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

router.delete('/:id/nfe-devolucao/rascunho', async (req, res) => {
  try {
    const out = await excluirRascunhoDevolucaoCompra(Number(req.params.id));
    res.json({ success: true, ...out });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/** Prévia da NF-e de devolução — não emite, não transmite, não altera saldo */
router.post('/:id/nfe-devolucao/previa', async (req, res) => {
  try {
    const body = req.body || {};
    const previa = await previaNfeDevolucaoCompra(Number(req.params.id), {
      itens: body.itens,
      observacoes: body.observacoes,
      cfop: body.cfop,
      refNFe: body.refNFe || body.chave_referenciada || body.chaveReferenciada,
      origemNfeDevolucaoId: body.origemNfeDevolucaoId || body.origem_nfe_devolucao_id,
      chaveAnterior: body.chaveAnterior || body.chave_nfe_anterior
    });
    res.json(previa);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      emitido: false,
      error: error.message,
      code: error.code || null,
      erros: error.erros || null
    });
  }
});

router.get('/:id/nfe-devolucao/historico', async (req, res) => {
  try {
    const historico = await listarHistoricoDevolucaoCompra(Number(req.params.id));
    res.json({ success: true, ...historico });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/manifestacao-210240', async (req, res) => {
  try {
    const manif = await obterManifestacao210240(Number(req.params.notaId));
    res.json({ success: true, manifestacao: manif });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/nfe-devolucao/:notaId/manifestacao-210240', async (req, res) => {
  try {
    const out = await registrarManifestacaoDevolucao(Number(req.params.notaId), req.body || {}, {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

router.get('/nfe-devolucao/:notaId/duplicar-preview', async (req, res) => {
  try {
    const preview = await previewDuplicarDevolucaoCompra(Number(req.params.notaId));
    res.json(preview);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null,
      erros: error.erros || null
    });
  }
});

router.post('/nfe-devolucao/:notaId/duplicar', async (req, res) => {
  try {
    const out = await duplicarDevolucaoCompra(Number(req.params.notaId), {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null,
      erros: error.erros || null
    });
  }
});

router.get('/nfe-devolucao/:notaId/xml', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || 'assinado').toLowerCase();
    const xml = await obterXmlVersionado(Number(req.params.notaId), tipo);
    const nota = await obterNfeDevolucaoPorId(Number(req.params.notaId));
    if (!nota) return res.status(404).json({ error: 'NF-e de devolução não encontrada.' });
    if (!xml) return res.status(404).json({ error: `XML (${tipo}) não disponível.` });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nfe-devolucao-${tipo}-${nota.chave_acesso || nota.id}.xml"`
    );
    res.send(xml);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/danfe', async (req, res) => {
  try {
    const nota = await obterNfeDevolucaoPorId(Number(req.params.notaId));
    if (!nota) return res.status(404).json({ error: 'NF-e de devolução não encontrada.' });
    const cancelado = String(req.query.tipo || '').toLowerCase() === 'cancelado';
    const html = cancelado ? nota.danfe_html_cancelado : nota.danfe_html;
    if (!html) {
      return res.status(404).json({
        error: cancelado ? 'DANFE cancelado não disponível.' : 'DANFE não disponível.'
      });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/status', async (req, res) => {
  try {
    const painel = await obterPainelStatus(Number(req.params.notaId));
    if (!painel) return res.status(404).json({ success: false, error: 'NF-e de devolução não encontrada.' });
    res.json({ success: true, ...painel });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/nfe-devolucao/:notaId/eventos', async (req, res) => {
  try {
    const eventos = await listarEventosDevolucao(Number(req.params.notaId));
    res.json({ success: true, eventos });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/nfe-devolucao/:notaId/consultar', async (req, res) => {
  try {
    const out = await consultarSituacaoDevolucao(Number(req.params.notaId), {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      computador: req.headers['x-computer-name'] || req.headers['x-client-host'] || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

router.post('/nfe-devolucao/:notaId/reenviar', async (req, res) => {
  try {
    const out = await reenviarNfeDevolucao(Number(req.params.notaId), {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      computador: req.headers['x-computer-name'] || req.headers['x-client-host'] || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

router.post('/nfe-devolucao/:notaId/nova-tentativa', async (req, res) => {
  try {
    const out = await iniciarNovaTentativaDevolucao(Number(req.params.notaId), {
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      computador: req.headers['x-computer-name'] || req.headers['x-client-host'] || null
    });
    res.json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || null
    });
  }
});

router.post('/nfe-devolucao/:notaId/cancelar', async (req, res) => {
  try {
    const out = await cancelarNfeDevolucaoOficial(Number(req.params.notaId), {
      motivo: req.body?.motivo || req.body?.justificativa,
      usuarioId: req.usuario?.id || req.user?.id || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      computador: req.headers['x-computer-name'] || req.headers['x-client-host'] || null,
      forcarPrazo: Boolean(req.body?.forcarPrazo)
    });
    res.status(out.success ? 200 : 422).json(out);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || error.codigo || null
    });
  }
});

router.post('/:id/emitir-nfe-devolucao', async (req, res) => {
  try {
    const compraId = Number(req.params.id);
    const body = req.body || {};

    const rascunhoRota = await obterRascunhoDevolucaoCompra(compraId).catch(() => null);
    const ctxRota = await resolverContextoSubstituicao210240({
      compraId,
      rascunho: rascunhoRota,
      origemDevolucaoId: body.origemNfeDevolucaoId
        || body.origem_nfe_devolucao_id
        || (rascunhoRota && (rascunhoRota.origem_nfe_devolucao_id || rascunhoRota.documento_original_id))
        || null,
      chaveAnterior: body.chaveAnterior || body.chave_nfe_anterior
    }).catch(() => ({ ativo: false }));
    trace210240('http_emitir', {
      compraId,
      rascunhoId: rascunhoRota && rascunhoRota.id,
      origemNfeDevolucaoId: ctxRota.origemDevolucaoId,
      documento_original_id: rascunhoRota && rascunhoRota.documento_original_id,
      substituicaoId: ctxRota.substituicaoId,
      chaveNFAnterior: ctxRota.chaveAnterior,
      evento210240: ctxRota.ativo,
      origemResolvida: ctxRota.fonte
    });
    const resultado = await emitirNFeDevolucaoCompra(compraId, {
      itens: body.itens,
      observacoes: body.observacoes,
      cfop: body.cfop,
      refNFe: body.refNFe || body.chave_referenciada || body.chaveReferenciada,
      origemNfeDevolucaoId: ctxRota.origemDevolucaoId || body.origemNfeDevolucaoId || body.origem_nfe_devolucao_id,
      chaveAnterior: ctxRota.chaveAnterior || body.chaveAnterior,
      novaIdentidade: body.novaIdentidade === true,
      origemTentativaId: body.origemTentativaId || body.origem_tentativa_id || null,
      usuarioId: req.usuario?.id || req.user?.id || body.usuarioId || null,
      usuarioNome: req.usuario?.nome || req.user?.nome || req.usuario?.username || body.usuarioNome || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      computador: req.headers['x-computer-name'] || req.headers['x-client-host'] || null
    });
    const cls = classificarResultadoEmissaoNfe(resultado);
    resultado.classeResultado = cls.classe;

    if (!resultado.success && resultado.code === 'TRANSMISSAO_ANTERIOR') {
      return res.status(409).json({
        sucesso: false,
        error: resultado.message,
        message: resultado.message,
        code: resultado.code,
        status: resultado.status,
        classeResultado: cls.classe,
        cStat: resultado.cStat || null,
        xMotivo: resultado.xMotivo || null,
        protocolo: resultado.protocolo || null,
        recibo: resultado.recibo || null,
        notaId: resultado.notaId,
        resultado
      });
    }

    if (!resultado.success && resultado.status === 'rejeitada') {
      return res.status(400).json({
        sucesso: false,
        autorizado: false,
        mensagem: resultado.message || 'NF-e de devolução rejeitada pela SEFAZ.',
        message: resultado.message,
        status: resultado.status,
        classeResultado: cls.classe,
        cStat: resultado.cStat || null,
        xMotivo: resultado.xMotivo || null,
        retornoSefaz: resultado.retorno,
        resultado
      });
    }

    if (!resultado.success && ['erro_assinatura', 'erro_comunicacao', 'erro_validacao', 'modulo_desabilitado'].includes(resultado.status)) {
      return res.status(400).json({
        sucesso: false,
        error: resultado.message,
        message: resultado.message,
        code: resultado.code || resultado.status,
        status: resultado.status,
        classeResultado: cls.classe,
        cStat: resultado.cStat || null,
        xMotivo: resultado.xMotivo || null,
        resultado
      });
    }

    res.json({
      message: resultado.message
        || (resultado.success
          ? 'NF-e de devolução autorizada com sucesso.'
          : 'NF-e de devolução enviada/processada.'),
      resultado,
      notaId: resultado.notaId || resultado.idNota,
      status: resultado.status,
      classeResultado: cls.classe,
      chaveAcesso: resultado.chaveAcesso || resultado.chave,
      protocolo: resultado.protocolo,
      recibo: resultado.recibo || null,
      numero: resultado.numero,
      serie: resultado.serie,
      cStat: resultado.cStat || null,
      xMotivo: resultado.xMotivo || null
    });
  } catch (error) {
    console.error('Erro ao emitir NF-e de devolução:', error);
    const status = String(error.code || '').toLowerCase() === 'saldo_zerado'
      || String(error.code || '').toLowerCase() === 'saldo_insuficiente'
      || String(error.code || '').toLowerCase() === 'qtd_invalida'
      || String(error.code || '').toLowerCase() === 'auditoria_fiscal_reprovada'
      ? 'erro_validacao'
      : (error.status || 'erro');
    const payload = {
      success: false,
      error: error.message,
      message: error.message,
      code: error.code || null,
      status,
      cStat: error.cStat || null,
      xMotivo: error.xMotivo || null,
      erros: error.erros || null
    };
    payload.classeResultado = classificarResultadoEmissaoNfe(payload).classe;
    res.status(error.statusCode || 500).json(payload);
  }
});

router.put('/:id/chave-nfe-fornecedor', (req, res) => {
  const id = Number(req.params.id);
  const chave = String(req.body?.chave || '').replace(/\D/g, '');

  if (chave.length !== 44) {
    return res.status(400).json({ error: 'A chave da NF-e deve ter 44 dígitos.' });
  }

  db.run(`
    UPDATE compras
    SET chave_acesso = ?
    WHERE id = ?
  `, [chave, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    res.json({
      success: true,
      message: 'Chave da NF-e original salva com sucesso.'
    });
  });
});

/**
 * Admin+ — altera venda sugerida do item na visualização da compra.
 * Atualiza o item e, quando houver produto vinculado, o cadastro (preço/margem).
 */
router.patch('/:id/itens/:itemId/preco-venda', exigirAdmin, (req, res) => {
  const compraId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const precoVenda = Number(req.body?.preco_venda_sugerido ?? req.body?.preco_venda);
  const atualizarCadastro = !(req.body?.atualizar_cadastro === false || req.body?.atualizar_cadastro === 0);

  if (!Number.isFinite(compraId) || compraId <= 0 || !Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ error: 'Compra ou item inválido.' });
  }
  if (!Number.isFinite(precoVenda) || precoVenda < 0) {
    return res.status(400).json({ error: 'Preço de venda inválido.' });
  }

  const precoVendaFinal = Number(precoVenda.toFixed(2));

  db.get(`
    SELECT ci.*, p.preco_compra AS produto_preco_compra, p.preco_venda AS produto_preco_venda
    FROM compras_itens ci
    LEFT JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.id = ? AND ci.compra_id = ?
  `, [itemId, compraId], (err, item) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!item) return res.status(404).json({ error: 'Item da compra não encontrado.' });

    const custo = Number(item.preco_unitario || 0);
    const margem = custo > 0
      ? Number((((precoVendaFinal - custo) / custo) * 100).toFixed(2))
      : Number(item.margem_lucro || 0);

    db.run(`
      UPDATE compras_itens
      SET preco_venda_sugerido = ?, margem_lucro = ?
      WHERE id = ? AND compra_id = ?
    `, [precoVendaFinal, margem, itemId, compraId], function (updErr) {
      if (updErr) return res.status(500).json({ error: updErr.message });

      const responder = () => {
        try {
          gravarAuditoria({
            usuario_id: req.user?.id || null,
            usuario_nome: req.user?.username || req.user?.nome || null,
            modulo: 'compras',
            acao: 'COMPRA_ITEM_PRECO_VENDA',
            referencia_tipo: 'compras_itens',
            referencia_id: itemId,
            detalhes: {
              compra_id: compraId,
              produto_id: item.produto_id || null,
              preco_anterior: Number(item.preco_venda_sugerido || 0),
              preco_novo: precoVendaFinal,
              margem_nova: margem,
              atualizar_cadastro: atualizarCadastro
            },
            ip_requisicao: req.ip || null
          });
        } catch (_e) { /* auditoria best-effort */ }

        res.json({
          success: true,
          item_id: itemId,
          compra_id: compraId,
          preco_venda_sugerido: precoVendaFinal,
          margem_lucro: margem,
          cadastro_atualizado: Boolean(atualizarCadastro && item.produto_id)
        });
      };

      if (!atualizarCadastro || !item.produto_id) {
        return responder();
      }

      const precoCompraCadastro = Number(item.produto_preco_compra ?? item.preco_unitario ?? 0);
      const precoVendaAnterior = Number(item.produto_preco_venda || 0);

      db.run(`
        UPDATE produtos
        SET preco_venda = ?,
            lucro_percentual = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [precoVendaFinal, margem, item.produto_id], (prodErr) => {
        if (prodErr) return res.status(500).json({ error: prodErr.message });

        if (Number(precoVendaAnterior) !== precoVendaFinal) {
          db.run(`
            INSERT INTO produtos_preco_historico (
              produto_id, preco_compra_anterior, preco_compra_novo, preco_venda_anterior, preco_venda_novo
            ) VALUES (?, ?, ?, ?, ?)
          `, [
            item.produto_id,
            precoCompraCadastro,
            precoCompraCadastro,
            precoVendaAnterior,
            precoVendaFinal
          ], () => responder());
        } else {
          responder();
        }
      });
    });
  });
});

module.exports = router;
module.exports._setComprasMipServiceForTests = _setComprasMipServiceForTests;
module.exports._obterComprasMipService = obterComprasMipService;
module.exports.ensureProductForItem = ensureProductForItem;
module.exports.ensureProductForItemLegado = ensureProductForItemLegado;
module.exports.validarItensCentralNfeSemAssociacao = validarItensCentralNfeSemAssociacao;
module.exports.normalizarDecisaoConversaoEntrada = normalizarDecisaoConversaoEntrada;
module.exports.normalizarDecisoesConversaoEntrada = normalizarDecisoesConversaoEntrada;
module.exports.validarPendenciasConversaoEntrada = validarPendenciasConversaoEntrada;
module.exports.extrairChaveConversaoItem = extrairChaveConversaoItem;
module.exports.aplicarDecisoesNosItens = aplicarDecisoesNosItens;
