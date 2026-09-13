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

  // V2 — modo fiscal global opcional (legado); estoque vem das colunas F/NF
  const modoFiscal = validarModoFiscalImportacao(modo_fiscal_importacao);

  const dados = extrairDadosImportacao(buffer);
  const validacao = await validarImportacao(db, dados, {
    nomeArquivo,
    modo_fiscal_importacao: modoFiscal
  });
  const sessaoId = criarSessao({
    arquivo: nomeArquivo || null,
    modo: MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao: modoFiscal,
    dados,
    validacao: { ...validacao, modo: MODOS.CADASTRO_INICIAL },
    resultado: null
  });
  return {
    sessao_id: sessaoId,
    modo: MODOS.CADASTRO_INICIAL,
    modo_fiscal_importacao: modoFiscal,
    ...validacao
  };
}

async function importarSessao(db, sessaoId, {
  usuarioId,
  usuarioNome,
  dbPath,
  pastaBackup,
  politica_pendentes
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
      politica_pendentes
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
