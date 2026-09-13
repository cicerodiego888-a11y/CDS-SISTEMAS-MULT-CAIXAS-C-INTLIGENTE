/**
 * CanonicalNormalizer — Transformações de padronização canônica de texto.
 *
 * Sprint 7.1: DecimalNormalizer, MeasurementTokenizer, tokens tipados e config modular.
 * Trabalha exclusivamente com string. Sem banco, produtos ou ERP.
 *
 * @module motores/miip/utils/CanonicalNormalizer
 */

const path = require('path');
const fs = require('fs');
const CanonicalProduct = require('../core/CanonicalProduct');
const CanonicalToken = require('../core/CanonicalToken');
const CanonicalStatistics = require('../core/CanonicalStatistics');
const TokenType = require('../core/TokenType');
const DecimalNormalizer = require('./DecimalNormalizer');
const { normalizarDecimais, ehTokenDecimalUnidade } = DecimalNormalizer;
const MeasurementTokenizer = require('./MeasurementTokenizer');

const DEFAULT_CONFIG_DIR = path.join(__dirname, '../config/canonical');
const DEFAULT_DICTIONARY_PATH = DEFAULT_CONFIG_DIR;

/** @type {Object|null} */
let _configCache = null;

/**
 * @param {string} arquivo
 * @returns {Object}
 */
function lerJsonSeguro(arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {string} [caminhoDir]
 * @returns {Object}
 */
function carregarConfig(caminhoDir = DEFAULT_CONFIG_DIR) {
  if (_configCache && caminhoDir === DEFAULT_CONFIG_DIR) {
    return _configCache;
  }

  const abbreviations = lerJsonSeguro(path.join(caminhoDir, 'abbreviations.json'));
  const units = lerJsonSeguro(path.join(caminhoDir, 'units.json'));
  const measurements = lerJsonSeguro(path.join(caminhoDir, 'measurements.json'));
  const stopwords = lerJsonSeguro(path.join(caminhoDir, 'stopwords.json'));
  const brands = lerJsonSeguro(path.join(caminhoDir, 'brands.json'));

  const config = {
    versao: abbreviations.versao ?? '1.1.0',
    abreviacoes: abbreviations.abreviacoes ?? {},
    embalagens: abbreviations.embalagens ?? [],
    unidades: Array.isArray(units.unidades) ? units.unidades : [],
    aliases: units.aliases ?? {},
    measurements: {
      sufixos: measurements.sufixos ?? [],
      fracoes: measurements.fracoes !== false,
      dimensoes: measurements.dimensoes !== false
    },
    stopwords: stopwords.palavras ?? [],
    marcas: brands.marcas ?? []
  };

  if (caminhoDir === DEFAULT_CONFIG_DIR) {
    _configCache = config;
  }

  return config;
}

/**
 * Compatibilidade Sprint 7 — retorna estrutura equivalente ao dicionário antigo.
 *
 * @param {string} [caminho]
 * @returns {Object}
 */
function carregarDicionario(caminho = DEFAULT_CONFIG_DIR) {
  const config = carregarConfig(caminho);
  return {
    abreviacoes: config.abreviacoes,
    unidades: config.unidades,
    aliases: config.aliases,
    embalagens: config.embalagens,
    marcas: config.marcas,
    stopwords: config.stopwords,
    measurements: config.measurements
  };
}

/**
 * @returns {void}
 */
function reiniciarCacheDicionario() {
  _configCache = null;
}

/**
 * @param {string} texto
 * @returns {string}
 */
function paraMaiusculas(texto) {
  return String(texto ?? '').toUpperCase();
}

/**
 * @param {string} texto
 * @returns {string}
 */
function removerAcentos(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Preserva decimais (1.5) e frações (3/8); demais pontuação vira espaço.
 *
 * @param {string} texto
 * @returns {string}
 */
function padronizarSeparadores(texto) {
  return String(texto ?? '')
    .replace(/(?<!\d)\.(?!\d)/g, ' ')
    .replace(/(?<!\d),(?!\d)/g, ' ')
    .replace(/(?<!\d)\/(?!\d)/g, ' ')
    .replace(/[;\\|_+\-]+/g, ' ');
}

/**
 * @param {string} texto
 * @returns {string}
 */
function removerCaracteresEspeciais(texto) {
  return String(texto ?? '').replace(/[^A-Z0-9\s./]/gi, ' ');
}

/**
 * @param {string} texto
 * @returns {string}
 */
function removerEspacosDuplicados(texto) {
  return String(texto ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Aplica aliases de unidade em tokens já colados (ex.: 1LT → 1L).
 *
 * @param {string} texto
 * @param {string[]} unidades
 * @param {Object<string, string>} [aliases]
 * @returns {string}
 */
function aplicarAliasesUnidade(texto, unidades = [], aliases = {}) {
  let resultado = String(texto ?? '');
  const lista = [...unidades].sort((a, b) => b.length - a.length);

  lista.forEach((unidade) => {
    const unidadeUpper = String(unidade).toUpperCase();
    const alias = DecimalNormalizer.resolverAliasUnidade(unidadeUpper, aliases);
    if (alias === unidadeUpper) return;

    const padrao = new RegExp(`(\\d+(?:\\.\\d+)?)${unidadeUpper}\\b`, 'gi');
    resultado = resultado.replace(padrao, `$1${alias}`);
  });

  return resultado;
}

/**
 * @param {string} texto
 * @param {string[]} unidades
 * @returns {string}
 */
function padronizarUnidades(texto, unidades = []) {
  let resultado = String(texto ?? '');
  const lista = [...unidades].sort((a, b) => b.length - a.length);

  lista.forEach((unidade) => {
    const padrao = new RegExp(`(\\d+)\\s+${unidade}\\b`, 'gi');
    resultado = resultado.replace(padrao, `$1${unidade.toUpperCase()}`);
  });

  return resultado;
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function ehTokenQuantidadeUnidade(token) {
  return /^\d+(?:\.\d+)?[A-Z]{1,4}$/i.test(token) || ehTokenDecimalUnidade(token);
}

/**
 * @param {string} token
 * @param {Object} abreviacoes
 * @returns {string}
 */
function expandirAbreviacao(token, abreviacoes) {
  const chave = String(token ?? '').toUpperCase();
  if (!chave) return '';
  if (ehTokenQuantidadeUnidade(chave)) return chave;
  if (MeasurementTokenizer.ehTokenMedida(chave)) return chave;
  return abreviacoes[chave] ?? chave;
}

/**
 * @param {string} textoCanonico
 * @returns {string}
 */
function normalizarFormaToken(textoCanonico) {
  const valor = String(textoCanonico ?? '').toUpperCase();
  if (!valor) return '';

  if (/^\d+(?:\.\d+)?(?:\/\d+)?(?:X\d+(?:\.\d+)?)?[A-Z]{0,4}$/.test(valor)) {
    return valor;
  }

  if (valor.length > 4 && valor.endsWith('S')) {
    return valor.slice(0, -1);
  }

  return valor;
}

/**
 * @param {string} textoOriginal
 * @param {string} textoCanonico
 * @param {string|null} tipoSugerido
 * @param {Object} config
 * @returns {string}
 */
function classificarTipo(textoOriginal, textoCanonico, tipoSugerido, config) {
  const original = String(textoOriginal ?? '').toUpperCase();
  const canonico = String(textoCanonico ?? '').toUpperCase();

  if (/^\d+UN$/.test(canonico)) return TokenType.QUANTIDADE;

  if (tipoSugerido) return tipoSugerido;

  if (config.marcas.includes(canonico)) return TokenType.MARCA;
  if (MeasurementTokenizer.ehTokenMedida(canonico, config.measurements)) return TokenType.MEDIDA;
  if (config.embalagens.includes(original) || config.embalagens.includes(canonico)) {
    return TokenType.EMBALAGEM;
  }
  if (/^\d+(?:\.\d+)?$/.test(canonico)) return TokenType.NUMERO;
  if (config.unidades.map((u) => u.toUpperCase()).includes(canonico)) return TokenType.UNIDADE;
  if (config.stopwords.includes(canonico)) return TokenType.PALAVRA;

  return TokenType.PALAVRA;
}

/**
 * @param {Array<{ texto: string, tipo: string|null, posicao: number }>} tokensBrutos
 * @param {Object} config
 * @returns {CanonicalToken[]}
 */
function construirTokensCanonicos(tokensBrutos, config) {
  const abreviacoes = config.abreviacoes ?? {};

  return tokensBrutos.map((bruto) => {
    const textoOriginal = bruto.texto;
    const textoCanonico = expandirAbreviacao(textoOriginal, abreviacoes);
    const tipo = classificarTipo(textoOriginal, textoCanonico, bruto.tipo, config);

    return CanonicalToken.create({
      textoOriginal,
      textoCanonico,
      tipo,
      posicao: bruto.posicao,
      normalizado: normalizarFormaToken(textoCanonico)
    });
  });
}

/**
 * @param {CanonicalToken[]} normalizedTokens
 * @returns {Object}
 */
function extrairAtributos(normalizedTokens) {
  const unidades = [];
  const quantidades = [];

  normalizedTokens.forEach((token) => {
    const match = token.textoCanonico.match(/^(\d+(?:\.\d+)?)([A-Z]{1,4})$/);
    if (match) {
      quantidades.push(Number(match[1]));
      unidades.push(match[2]);
    }
  });

  return {
    unidades,
    quantidades,
    totalTokens: normalizedTokens.length
  };
}

/**
 * @param {CanonicalToken[]} normalizedTokens
 * @param {number} tempoProcessamento
 * @returns {CanonicalStatistics}
 */
function calcularEstatisticas(normalizedTokens, tempoProcessamento) {
  const quantidadePalavras = normalizedTokens.filter((t) => t.tipo === TokenType.PALAVRA).length;
  const quantidadeMedidas = normalizedTokens.filter((t) => t.tipo === TokenType.MEDIDA).length;
  const quantidadeMarcas = normalizedTokens.filter((t) => t.tipo === TokenType.MARCA).length;

  return CanonicalStatistics.create({
    quantidadeTokens: normalizedTokens.length,
    quantidadePalavras,
    quantidadeMedidas,
    quantidadeMarcas,
    tempoProcessamento
  });
}

/**
 * Normaliza texto em representação canônica.
 *
 * @param {string} textoOriginal
 * @param {Object} [opcoes]
 * @param {Object} [opcoes.dicionario]
 * @param {string} [opcoes.configDir]
 * @returns {CanonicalProduct}
 */
function normalizar(textoOriginal, opcoes = {}) {
  const inicio = Date.now();
  const original = String(textoOriginal ?? '');
  const config = opcoes.dicionario ?? carregarConfig(opcoes.configDir ?? DEFAULT_CONFIG_DIR);

  let etapa = paraMaiusculas(original);
  etapa = removerAcentos(etapa);
  etapa = normalizarDecimais(etapa, {
    unidades: config.unidades,
    aliases: config.aliases
  });
  etapa = padronizarSeparadores(etapa);
  etapa = removerCaracteresEspeciais(etapa);
  etapa = removerEspacosDuplicados(etapa);
  etapa = padronizarUnidades(etapa, config.unidades);
  etapa = aplicarAliasesUnidade(etapa, config.unidades, config.aliases);

  const normalizado = etapa;
  const tokensBrutos = MeasurementTokenizer.tokenizar(normalizado, config.measurements);
  const normalizedTokens = construirTokensCanonicos(tokensBrutos, config);
  const tokens = normalizedTokens.map((token) => token.textoCanonico);
  const canonico = tokens.join(' ');
  const tempoProcessamento = Date.now() - inicio;

  return CanonicalProduct.create({
    original,
    normalizado,
    canonico,
    tokens,
    normalizedTokens,
    atributos: extrairAtributos(normalizedTokens),
    estatisticas: calcularEstatisticas(normalizedTokens, tempoProcessamento),
    metadata: {
      versao: CanonicalProduct.VERSAO_PADRAO,
      etapasAplicadas: [
        'maiusculas',
        'acentos',
        'decimais',
        'separadores',
        'caracteres_especiais',
        'espacos',
        'unidades',
        'medidas',
        'abreviacoes',
        'tokenizacao',
        'classificacao'
      ]
    }
  });
}

module.exports = {
  normalizar,
  carregarConfig,
  carregarDicionario,
  reiniciarCacheDicionario,
  paraMaiusculas,
  removerAcentos,
  padronizarSeparadores,
  removerCaracteresEspeciais,
  removerEspacosDuplicados,
  padronizarUnidades,
  aplicarAliasesUnidade,
  expandirAbreviacao,
  construirTokensCanonicos,
  extrairAtributos,
  ehTokenQuantidadeUnidade,
  classificarTipo,
  normalizarFormaToken,
  DEFAULT_CONFIG_DIR,
  DEFAULT_DICTIONARY_PATH
};
