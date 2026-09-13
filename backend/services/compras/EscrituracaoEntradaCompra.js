/**
 * Escrituração fiscal interna da entrada (compra).
 * XML SEFAZ é imutável — ajustes afetam apenas a escrituração da empresa.
 */

'use strict';

const { normalizarTipoEntrada, TIPO_ENTRADA, ROTULOS } = require('./PoliticaEntradaCompra');
const { extrairDadosFiscaisXml } = require('./extrairSinaisFiscaisXml');

function limparCodigo(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Sugere CFOP de entrada conforme política (escrituração interna).
 */
function sugerirCfopEscrituracao(tipoEntrada, cfopXml) {
  const tipo = normalizarTipoEntrada(tipoEntrada);
  const original = limparCodigo(cfopXml);
  if (tipo === TIPO_ENTRADA.USO_CONSUMO) {
    const sugerido = '1556';
    if (original && original !== sugerido) {
      return {
        utilizado: sugerido,
        alterado: true,
        motivo: 'Fornecedor/entrada classificada como Uso e Consumo.'
      };
    }
    return { utilizado: original || sugerido, alterado: false, motivo: null };
  }
  if (tipo === TIPO_ENTRADA.INDUSTRIALIZACAO) {
    const sugerido = original?.startsWith('2') ? '2101' : '1101';
    if (original && !/^[12]101$/.test(original) && !/^[12]11[13678]$/.test(original)) {
      return {
        utilizado: sugerido,
        alterado: true,
        motivo: 'Entrada classificada como Industrialização.'
      };
    }
    return { utilizado: original || sugerido, alterado: false, motivo: null };
  }
  return { utilizado: original || '', alterado: false, motivo: null };
}

/**
 * Monta resumo fiscal obrigatório + sugestões de escrituração.
 * @param {Object} input
 */
function montarResumoFiscalEntrada(input = {}) {
  const tipoEntrada = normalizarTipoEntrada(input.tipo_entrada || input.tipoEntrada);
  const xml = input.xml || '';
  const dados = input.dadosCompra || {};
  const sinais = xml ? extrairDadosFiscaisXml(xml) : {
    cfopPredominante: input.cfop_xml || dados.cfop || null,
    natureza: input.natureza_xml || dados.natureza_operacao || '',
    csosnOuCst: input.csosn_cst_xml || '',
    csosn: input.csosn_xml || '',
    cstIcms: input.cst_icms_xml || '',
    cstPis: input.cst_pis_xml || '',
    cstCofins: input.cst_cofins_xml || '',
    cstIpi: input.cst_ipi_xml || '',
    csosnOuCstTipo: null
  };

  const cfopXml = limparCodigo(sinais.cfopPredominante || input.cfop_xml || '');
  const csosnCstXml = limparCodigo(sinais.csosnOuCst || input.csosn_cst_xml || '');
  const cstPisXml = limparCodigo(sinais.cstPis || input.cst_pis_xml || '');
  const cstCofinsXml = limparCodigo(sinais.cstCofins || input.cst_cofins_xml || '');
  const cstIpiXml = limparCodigo(sinais.cstIpi || input.cst_ipi_xml || '');
  const naturezaXml = String(sinais.natureza || input.natureza_xml || dados.natureza_operacao || '').trim();

  const sugCfop = sugerirCfopEscrituracao(tipoEntrada, cfopXml);

  // Overrides explícitos do operador (se já enviados)
  const cfopUtilizado = limparCodigo(input.cfop || input.cfop_utilizado || sugCfop.utilizado) || sugCfop.utilizado;
  const csosnCstUtilizado = limparCodigo(input.csosn_cst || input.csosn_cst_utilizado || csosnCstXml) || csosnCstXml;
  const cstPisUtilizado = limparCodigo(input.cst_pis || input.cst_pis_utilizado || cstPisXml) || cstPisXml;
  const cstCofinsUtilizado = limparCodigo(input.cst_cofins || input.cst_cofins_utilizado || cstCofinsXml) || cstCofinsXml;
  const cstIpiUtilizado = limparCodigo(input.cst_ipi || input.cst_ipi_utilizado || cstIpiXml) || cstIpiXml;
  const naturezaUtilizada = String(input.natureza_operacao || input.natureza || naturezaXml || '').trim();

  const motivoBase = sugCfop.alterado ? sugCfop.motivo : null;
  const motivo = input.escrituracao_motivo || motivoBase || null;

  const campos = [
    { campo: 'cfop', label: 'CFOP', xml: cfopXml, utilizado: cfopUtilizado },
    { campo: 'csosn_cst', label: 'CSOSN/CST', xml: csosnCstXml, utilizado: csosnCstUtilizado },
    { campo: 'cst_pis', label: 'CST PIS', xml: cstPisXml, utilizado: cstPisUtilizado },
    { campo: 'cst_cofins', label: 'CST COFINS', xml: cstCofinsXml, utilizado: cstCofinsUtilizado },
    { campo: 'cst_ipi', label: 'CST IPI', xml: cstIpiXml, utilizado: cstIpiUtilizado },
    { campo: 'natureza', label: 'Natureza da Operação', xml: naturezaXml, utilizado: naturezaUtilizada }
  ].map((c) => ({
    ...c,
    divergente: Boolean(c.xml && c.utilizado && String(c.xml) !== String(c.utilizado))
  }));

  const alterada = campos.some((c) => c.divergente) || Boolean(sugCfop.alterado);

  return {
    fornecedor: dados.fornecedor || input.fornecedor || '',
    tipoEntrada,
    tipoEntradaLabel: ROTULOS[tipoEntrada],
    valorTotal: Number(dados.valor_total_nota || input.valor_total_nota || 0),
    original: {
      cfop: cfopXml || null,
      csosn_cst: csosnCstXml || null,
      cst_pis: cstPisXml || null,
      cst_cofins: cstCofinsXml || null,
      cst_ipi: cstIpiXml || null,
      natureza_operacao: naturezaXml || null
    },
    utilizado: {
      cfop: cfopUtilizado || null,
      csosn_cst: csosnCstUtilizado || null,
      cst_pis: cstPisUtilizado || null,
      cst_cofins: cstCofinsUtilizado || null,
      cst_ipi: cstIpiUtilizado || null,
      natureza_operacao: naturezaUtilizada || null
    },
    campos,
    alterada,
    motivo,
    xmlImutavel: true,
    aviso: 'O XML recebido da SEFAZ é imutável. Alterações afetam apenas a escrituração fiscal interna.'
  };
}

/**
 * Normaliza payload de escrituração para persistência em compras.
 */
function normalizarEscrituracaoParaPersistencia(body = {}, resumo = null) {
  const r = resumo || montarResumoFiscalEntrada(body);
  return {
    cfop_xml: r.original.cfop,
    cfop: r.utilizado.cfop,
    csosn_cst_xml: r.original.csosn_cst,
    csosn_cst: r.utilizado.csosn_cst,
    cst_pis_xml: r.original.cst_pis,
    cst_pis: r.utilizado.cst_pis,
    cst_cofins_xml: r.original.cst_cofins,
    cst_cofins: r.utilizado.cst_cofins,
    cst_ipi_xml: r.original.cst_ipi,
    cst_ipi: r.utilizado.cst_ipi,
    natureza_operacao_xml: r.original.natureza_operacao,
    natureza_operacao: r.utilizado.natureza_operacao,
    escrituracao_alterada: r.alterada ? 1 : 0,
    escrituracao_motivo: r.motivo || body.escrituracao_motivo || null
  };
}

module.exports = {
  sugerirCfopEscrituracao,
  montarResumoFiscalEntrada,
  normalizarEscrituracaoParaPersistencia
};
