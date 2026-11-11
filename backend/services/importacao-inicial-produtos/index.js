/**
 * Importação Inicial de Produtos — API de serviço (V1.0.4).
 * Modos: CADASTRO_INICIAL | ATUALIZAR_QUANTIDADES
 */
'use strict';

const {
  extrairDadosImportacao,
  extrairDadosQuantidades,
  gerarXlsxFixture,
  gerarXlsxQuantidadesFixture
} = require('./xlsxReader');
const { validarImportacao } = require('./validator');
const { executarImportacao } = require('./importer');
const {
  validarAtualizacaoQuantidades,
  executarAtualizacaoQuantidades
} = require('./quantidadeUpdater');
const { criarSessao, obterSessao, atualizarSessao } = require('./sessionStore');
const {
  MARKUP_PADRAO,
  MODOS,
  MODOS_FISCAIS_IMPORTACAO,
  STATUS,
  POLITICA_PENDENTES,
  calcularCustoUnitarioDeEmbalagem,
  calcularPrecoPorMarkup,
  validarModoFiscalImportacao
} = require('./helpers');
const validator = require('./validator');
const {
  classificarProduto,
  resolverClassificacaoExistente,
  STATUS_CLASSIFICACAO,
  CONFIANCA,
  ORIGEM
} = require('./classificadorCategoria');

function normalizarModo(modo) {
  const m = String(modo || MODOS.CADASTRO_INICIAL).toUpperCase();
  if (m === MODOS.ATUALIZAR_QUANTIDADES || m === 'ATUALIZAR_QUANTIDADES' || m === 'QUANTIDADES') {
    return MODOS.ATUALIZAR_QUANTIDADES;
  }
  return MODOS.CADASTRO_INICIAL;
}

/** IMP-PROD-02: carimba linha original da planilha (estável após exclusões). */
function carimbarLinhasPlanilha(dados) {
  const produtos = (dados.produtos || []).map((p, i) => ({
    ...p,
    _linha_planilha: Number.isFinite(Number(p._linha_planilha)) && Number(p._linha_planilha) > 0
      ? Number(p._linha_planilha)
      : (i + 1),
    _uid: p._uid || `imp-l${i + 1}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }));
  return { ...dados, produtos };
}

function enriquecerValidacaoInterativa(validacao, sessao) {
  const excluidos = Number(sessao.produtos_excluidos_count || 0);
  const planilha = Number(
    sessao.produtos_planilha_inicial != null
      ? sessao.produtos_planilha_inicial
      : ((validacao.resumo?.produtos_encontrados || 0) + excluidos)
  );
  const resumo = {
    ...(validacao.resumo || {}),
    produtos_da_planilha: planilha,
    produtos_excluidos: excluidos,
    produtos_com_erro: Number(validacao.resumo?.com_erro || 0),
    produtos_validos: Number(validacao.resumo?.produtos_validos || 0)
  };
  return {
    ...validacao,
    resumo,
    linhas_com_erro: validacao.linhas_com_erro
      || (validacao.linhas || []).filter((l) => validator.statusBloqueiaImportacao(l.status)),
    produtos_excluidos: sessao.produtos_excluidos || []
  };
}

async function revalidarSessaoCadastro(db, sessao) {
  const validacaoBruta = await validarImportacao(db, sessao.dados, {
    nomeArquivo: sessao.arquivo,
    modo_fiscal_importacao: null
  });
  const validacao = enriquecerValidacaoInterativa(
    { ...validacaoBruta, modo: MODOS.CADASTRO_INICIAL },
    sessao
  );
  atualizarSessao(sessao.id, {
    validacao,
    status: 'validado'
  });
  return validacao;
}

function obterSessaoCadastroOuErro(sessaoId) {
  const sessao = obterSessao(sessaoId);
  if (!sessao || !sessao.validacao) {
    const err = new Error('Sessão de importação não encontrada ou expirada. Valide o arquivo novamente.');
    err.status = 404;
    throw err;
  }
  if (sessao.status === 'importado') {
    const err = new Error('Esta sessão já foi importada. Valide o arquivo novamente.');
    err.status = 400;
    throw err;
  }
  const modo = normalizarModo(sessao.modo || sessao.validacao.modo);
  if (modo !== MODOS.CADASTRO_INICIAL) {
    const err = new Error('Edição/exclusão de linhas com erro está disponível apenas no Cadastro Inicial.');
    err.status = 400;
    throw err;
  }
  return sessao;
}

function localizarIndiceProdutoSessao(sessao, linhaPlanilha) {
  const linha = Number(linhaPlanilha);
  if (!Number.isFinite(linha) || linha <= 0) {
    const err = new Error('Linha da planilha inválida.');
    err.status = 400;
    throw err;
  }
  const produtos = sessao.dados?.produtos || [];
  const idx = produtos.findIndex((p) => Number(p._linha_planilha) === linha);
  if (idx < 0) {
    const err = new Error(`Linha ${linha} não encontrada na importação atual (pode ter sido excluída).`);
    err.status = 404;
    throw err;
  }
  return idx;
}

function normalizarNumeroEditavel(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const s = String(valor).trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function aplicarCamposEdicaoProduto(produtoAtual, campos = {}) {
  const next = { ...produtoAtual };
  const c = campos || {};

  if (Object.prototype.hasOwnProperty.call(c, 'nome')) {
    const nome = c.nome == null ? '' : String(c.nome).trim();
    next.nome = nome || null;
  }
  if (Object.prototype.hasOwnProperty.call(c, 'codigo_origem')
    || Object.prototype.hasOwnProperty.call(c, 'codigo')) {
    const cod = c.codigo_origem != null ? c.codigo_origem : c.codigo;
    next.codigo_origem = cod == null || String(cod).trim() === '' ? null : String(cod).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'codigo_barras')) {
    const b = c.codigo_barras;
    next.codigo_barras = b == null || String(b).trim() === '' ? null : String(b).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'preco_venda')
    || Object.prototype.hasOwnProperty.call(c, 'preco_informado')) {
    const preco = normalizarNumeroEditavel(
      Object.prototype.hasOwnProperty.call(c, 'preco_venda') ? c.preco_venda : c.preco_informado
    );
    next.preco_informado = preco;
  }
  if (Object.prototype.hasOwnProperty.call(c, 'custo_unitario')
    || Object.prototype.hasOwnProperty.call(c, 'custo_informado')) {
    const custo = normalizarNumeroEditavel(
      Object.prototype.hasOwnProperty.call(c, 'custo_unitario') ? c.custo_unitario : c.custo_informado
    );
    next.custo_informado = custo;
  }
  if (Object.prototype.hasOwnProperty.call(c, 'estoque_fiscal')) {
    next.estoque_fiscal = normalizarNumeroEditavel(c.estoque_fiscal);
  }
  if (Object.prototype.hasOwnProperty.call(c, 'estoque_nao_fiscal')) {
    next.estoque_nao_fiscal = normalizarNumeroEditavel(c.estoque_nao_fiscal);
  }
  if (Object.prototype.hasOwnProperty.call(c, 'ncm')) {
    next.ncm = c.ncm == null || String(c.ncm).trim() === '' ? null : String(c.ncm).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'cfop')) {
    next.cfop = c.cfop == null || String(c.cfop).trim() === '' ? null : String(c.cfop).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'csosn')) {
    next.csosn = c.csosn == null || String(c.csosn).trim() === '' ? null : String(c.csosn).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'cest')) {
    next.cest = c.cest == null || String(c.cest).trim() === '' ? null : String(c.cest).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'marca')) {
    next.marca = c.marca == null || String(c.marca).trim() === '' ? null : String(c.marca).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'categoria')) {
    next.categoria = c.categoria == null || String(c.categoria).trim() === ''
      ? null
      : String(c.categoria).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'subcategoria')) {
    next.subcategoria = c.subcategoria == null || String(c.subcategoria).trim() === ''
      ? null
      : String(c.subcategoria).trim();
  }
  if (Object.prototype.hasOwnProperty.call(c, 'controla_estoque')
    || Object.prototype.hasOwnProperty.call(c, 'controla_estoque_bruto')) {
    next.controla_estoque_bruto = Object.prototype.hasOwnProperty.call(c, 'controla_estoque')
      ? c.controla_estoque
      : c.controla_estoque_bruto;
  }
  return next;
}

async function editarLinhaSessao(db, sessaoId, { linha, campos } = {}) {
  const sessao = obterSessaoCadastroOuErro(sessaoId);
  const idx = localizarIndiceProdutoSessao(sessao, linha);
  const atual = sessao.dados.produtos[idx];
  const editado = aplicarCamposEdicaoProduto(atual, campos);
  const produtos = sessao.dados.produtos.slice();
  produtos[idx] = editado;
  const dados = { ...sessao.dados, produtos };
  atualizarSessao(sessaoId, { dados });
  const sessaoAtual = obterSessao(sessaoId);
  const validacao = await revalidarSessaoCadastro(db, sessaoAtual);
  const linhaEditada = (validacao.linhas || []).find(
    (l) => Number(l.linha) === Number(editado._linha_planilha)
  ) || null;
  return {
    sessao_id: sessaoId,
    modo: MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao: null,
    linha_editada: linhaEditada,
    ...validacao
  };
}

async function excluirLinhaSessao(db, sessaoId, { linha } = {}) {
  const sessao = obterSessaoCadastroOuErro(sessaoId);
  const idx = localizarIndiceProdutoSessao(sessao, linha);
  const removido = sessao.dados.produtos[idx];
  const produtos = sessao.dados.produtos.slice();
  produtos.splice(idx, 1);
  const registroExclusao = {
    linha: Number(removido._linha_planilha),
    codigo_origem: removido.codigo_origem || null,
    nome: removido.nome || null,
    excluido_em: Date.now()
  };
  const produtosExcluidos = [...(sessao.produtos_excluidos || []), registroExclusao];
  const dados = { ...sessao.dados, produtos };
  atualizarSessao(sessaoId, {
    dados,
    produtos_excluidos: produtosExcluidos,
    produtos_excluidos_count: produtosExcluidos.length
  });
  const sessaoAtual = obterSessao(sessaoId);
  const validacao = await revalidarSessaoCadastro(db, sessaoAtual);
  return {
    sessao_id: sessaoId,
    modo: MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao: null,
    linha_excluida: registroExclusao,
    ...validacao
  };
}

async function validarArquivoBuffer(db, buffer, {
  nomeArquivo,
  modo,
  modo_fiscal_importacao
} = {}) {
  const modoNorm = normalizarModo(modo);

  if (modoNorm === MODOS.ATUALIZAR_QUANTIDADES) {
    const dados = extrairDadosQuantidades(buffer);
    const validacao = await validarAtualizacaoQuantidades(db, dados, { nomeArquivo });
    const sessaoId = criarSessao({
      arquivo: nomeArquivo || null,
      modo: modoNorm,
      dados,
      validacao,
      resultado: null
    });
    return {
      sessao_id: sessaoId,
      modo: modoNorm,
      ...validacao
    };
  }

  // IMP-PROD-01: Importador Inicial V2 NÃO usa modo_fiscal_importacao.
  // Estoque vem exclusivamente das colunas Estoque Fiscal / Estoque Não Fiscal.
  // O parâmetro legado é ignorado (estrutura permanece no sistema, desacoplada do V2).
  if (modo_fiscal_importacao != null && modo_fiscal_importacao !== '') {
    // aceito na assinatura por compatibilidade de API; sem efeito no V2
  }

  const dados = carimbarLinhasPlanilha(extrairDadosImportacao(buffer));
  const validacaoBruta = await validarImportacao(db, dados, {
    nomeArquivo,
    modo_fiscal_importacao: null
  });
  const meta = {
    produtos_planilha_inicial: (dados.produtos || []).length,
    produtos_excluidos_count: 0,
    produtos_excluidos: []
  };
  const validacao = enriquecerValidacaoInterativa(
    { ...validacaoBruta, modo: MODOS.CADASTRO_INICIAL },
    meta
  );
  const sessaoId = criarSessao({
    arquivo: nomeArquivo || null,
    modo: MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao: null,
    dados,
    validacao,
    resultado: null,
    ...meta
  });
  return {
    sessao_id: sessaoId,
    modo: MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao: null,
    ...validacao
  };
}

async function importarSessao(db, sessaoId, {
  usuarioId,
  usuarioNome,
  dbPath,
  pastaBackup,
  politica_pendentes,
  publicarCatalogo
} = {}) {
  const sessao = obterSessao(sessaoId);
  if (!sessao || !sessao.validacao) {
    const err = new Error('Sessão de importação não encontrada ou expirada. Valide o arquivo novamente.');
    err.status = 404;
    throw err;
  }
  if (sessao.status === 'importado') {
    return {
      sucesso: true,
      ja_importado: true,
      ...sessao.resultado
    };
  }

  const modo = normalizarModo(sessao.modo || sessao.validacao.modo);
  // Identificador estável: arquivo + sessão (arquivo impede duplicar mesma planilha)
  const importIdEstavel = sessao.arquivo
    ? `${modo}|${sessao.arquivo}`
    : sessaoId;

  let resultado;
  if (modo === MODOS.ATUALIZAR_QUANTIDADES) {
    resultado = await executarAtualizacaoQuantidades(db, sessao.validacao, {
      usuarioId,
      usuarioNome,
      dbPath,
      pastaBackup,
      importId: importIdEstavel
    });
  } else {
    resultado = await executarImportacao(db, sessao.validacao, {
      usuarioId,
      usuarioNome,
      dbPath,
      pastaBackup,
      importId: sessaoId,
      politica_pendentes,
      publicarCatalogo
    });
  }

  atualizarSessao(sessaoId, {
    status: 'importado',
    resultado,
    importado_em: Date.now()
  });
  return resultado;
}

function statusSessao(sessaoId) {
  const sessao = obterSessao(sessaoId);
  if (!sessao) {
    return { encontrada: false };
  }
  return {
    encontrada: true,
    sessao_id: sessao.id,
    status: sessao.status,
    modo: sessao.modo || sessao.validacao?.modo || MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao:
      sessao.modo_fiscal_importacao
      || sessao.validacao?.modo_fiscal_importacao
      || null,
    tratamento_fiscal: sessao.validacao?.tratamento_fiscal || null,
    arquivo: sessao.arquivo,
    resumo: sessao.validacao?.resumo || null,
    resultado: sessao.resultado || null,
    criado_em: sessao.criado_em,
    importado_em: sessao.importado_em || null
  };
}

module.exports = {
  validarArquivoBuffer,
  editarLinhaSessao,
  excluirLinhaSessao,
  importarSessao,
  statusSessao,
  extrairDadosImportacao,
  extrairDadosQuantidades,
  gerarXlsxFixture,
  gerarXlsxQuantidadesFixture,
  validarImportacao,
  executarImportacao,
  validarAtualizacaoQuantidades,
  executarAtualizacaoQuantidades,
  MARKUP_PADRAO,
  MODOS,
  MODOS_FISCAIS_IMPORTACAO,
  validarModoFiscalImportacao,
  STATUS,
  POLITICA_PENDENTES,
  classificarProduto,
  resolverClassificacaoExistente,
  STATUS_CLASSIFICACAO,
  CONFIANCA,
  ORIGEM,
  calcularCustoUnitarioDeEmbalagem,
  calcularPrecoPorMarkup,
  calcularEstoqueInicial: require('./helpers').calcularEstoqueInicial,
  resolverFatorConversao: require('./helpers').resolverFatorConversao,
  resolverCustosEPrecos: validator.resolverCustosEPrecos,
  montarEstoquePreview: validator.montarEstoquePreview,
  calcularQuantidadeALancar: require('./quantidadeUpdater').calcularQuantidadeALancar,
  resolverFatorAtualizacao: require('./quantidadeUpdater').resolverFatorAtualizacao,
  montarEmbalagensParaServico: require('./helpers').montarEmbalagensParaServico,
  calcularFormacaoPrecoOficial: require('./helpers').calcularFormacaoPrecoOficial,
  normalizarUnidadeBaseCadastro: require('./helpers').normalizarUnidadeBaseCadastro
};
