/**
 * enriquecerParseComMiip — Enriquecimento MIIP + MIP do parse NF-e (Sprint 07).
 *
 * Pipeline:
 * 1) MIIP (aprendizado / fornecedor / similaridade) — inalterado
 * 2) MIP (produto_identificadores) para itens ainda sem produto_id
 *
 * Usado por Compras e Central de Entradas.
 *
 * @module shared/nfe/enriquecerParseComMiip
 */

const { getMiipService } = require('../../motores/miip/getMiipService');
const { extrairPendencias } = require('../../motores/miip/utils/miipCentralRevisaoUtils');
const EntradasProdutoIdentificacaoService = require('../../motores/produto-identidade/services/EntradasProdutoIdentificacaoService');
const { isProdutoIdentidadeEnabled } = require('../../motores/produto-identidade/config/produtoIdentidadeFlags');
const mipLogger = require('../../motores/produto-identidade/observability/mipLogger');

let _entradasIdentificacao = null;

function obterEntradasIdentificacao(deps = {}) {
  if (deps.entradasIdentificacao) return deps.entradasIdentificacao;
  if (!_entradasIdentificacao) {
    _entradasIdentificacao = new EntradasProdutoIdentificacaoService({ db: deps.db || null });
  }
  return _entradasIdentificacao;
}

/**
 * Passo MIP: preenche produto_id em itens ainda sem associação.
 * @param {Object} parsed
 * @param {Object} [deps]
 */
async function enriquecerItensComMip(parsed, deps = {}) {
  if (!isProdutoIdentidadeEnabled() && !deps.forcarMip) {
    return { aplicados: 0, tentados: 0 };
  }

  const svc = obterEntradasIdentificacao(deps);
  let aplicados = 0;
  let tentados = 0;

  for (const item of parsed.itens || []) {
    if (!item || item.produto_id) continue;
    tentados += 1;

    try {
      const r = await svc.identificarItem(item, {
        origem: deps.origem || 'xml_central'
      });
      if (r.encontrado && r.produtoId) {
        item.produto_id = Number(r.produtoId);
        item.mip_resultado = {
          encontrado: true,
          produtoId: r.produtoId,
          metodo: r.metodo,
          strategy: r.strategy,
          codigoUsado: r.codigoUsado || null
        };
        aplicados += 1;
      }
    } catch (err) {
      mipLogger.warn('xml item mip falhou', { erro: err.message });
    }
  }

  return { aplicados, tentados };
}

/**
 * @param {Object} parsed — saída de NFeParserService.parse()
 * @param {Object} [deps] — testes / override
 * @returns {Promise<{ parsed: Object, miipImportacao: Object|null, possuiPendencias: boolean, erroMiip?: string, mip?: Object }>}
 */
async function enriquecerParseComMiip(parsed, deps = {}) {
  const resultado = {
    parsed,
    miipImportacao: null,
    possuiPendencias: false,
    mip: null
  };

  try {
    const MiipService = deps.miipService || getMiipService();
    const MiipImportacaoXmlService = deps.miipImportacaoXmlService
      || require('../../motores/miip/services/MiipImportacaoXmlService');
    const miipImportacao = await MiipService.processarImportacaoXml(parsed);
    if (miipImportacao) {
      parsed.miip_importacao = miipImportacao;
      resultado.miipImportacao = miipImportacao;

      (miipImportacao.resultados || []).forEach((itemResultado, indice) => {
        const item = parsed.itens[indice];
        if (!item) return;

        item.miip_resultado = itemResultado;

        if (itemResultado.associadoAutomaticamente && itemResultado.produtoEncontrado?.id) {
          item.produto_id = itemResultado.produtoEncontrado.id;
        }

        const sugestao = MiipImportacaoXmlService.paraSugestaoUi(itemResultado);
        if (sugestao) {
          item.miip_sugestao = sugestao;
        }
      });

      resultado.possuiPendencias = extrairPendencias(miipImportacao.resultados || []).length > 0;
    }
  } catch (error) {
    mipLogger.error('Falha MIIP — parse segue sem bloqueio', { erro: error?.message });
    resultado.erroMiip = error.message;
  }

  // Sprint 07 — MIP para itens sem produto_id (Central / XML / Compras)
  try {
    resultado.mip = await enriquecerItensComMip(parsed, deps);
  } catch (mipErr) {
    mipLogger.warn('Falha MIP complementar no parse', { erro: mipErr.message });
    resultado.erroMip = mipErr.message;
  }

  return resultado;
}

module.exports = {
  enriquecerParseComMiip,
  enriquecerItensComMip,
  obterEntradasIdentificacao
};
