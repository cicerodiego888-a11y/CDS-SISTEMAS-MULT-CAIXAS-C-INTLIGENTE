/**
 * RC9.1 — Classificação inteligente do Tipo de Entrada.
 * Sugere REVENDA | INDUSTRIALIZACAO | USO_CONSUMO com confiança e motivo.
 * Não executa motores, não altera fiscal/XML/MIIP/estoque/financeiro.
 */

'use strict';

const db = require('../../database');
const {
  TIPO_ENTRADA,
  TIPO_ENTRADA_PADRAO,
  normalizarTipoEntrada,
  ROTULOS
} = require('./PoliticaEntradaCompra');
const { extrairSinaisFiscaisDoXml } = require('./extrairSinaisFiscaisXml');

/** Sufixos CFOP típicos de bonificação (últimos 3 dígitos). */
const CFOP_BONIFICACAO = new Set(['910', '949']);
/** Sufixos CFOP típicos de uso/consumo (últimos 3 dígitos). */
const CFOP_USO_CONSUMO = new Set([
  '551', '552', '553', '556', '557'
]);
const CFOP_INDUSTRIALIZACAO = new Set([
  '101', '111', '113', '116', '117', '118', '124', '125'
]);
const CFOP_REVENDA = new Set([
  '102', '103', '403', '407', '408', '409', '411'
]);

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function classificarPorCfop(cfop) {
  const item = classificarPorCfopItem(cfop);
  return item ? { tipo: item.tipo, confianca: item.confianca, motivo: item.motivo } : null;
}

/** Classificação fiscal por CFOP do item (RC4.31.11). */
function classificarPorCfopItem(cfop) {
  const digitos = digitsOnly(cfop);
  if (digitos.length !== 4) return null;
  const sufixo = digitos.slice(1);

  if (CFOP_BONIFICACAO.has(sufixo)) {
    return {
      tipo: TIPO_ENTRADA.BONIFICACAO,
      confianca: 94,
      motivo: `CFOP ${digitos} típico de bonificação/brinde.`
    };
  }
  if (CFOP_USO_CONSUMO.has(sufixo)) {
    return {
      tipo: TIPO_ENTRADA.USO_CONSUMO,
      confianca: 92,
      motivo: `CFOP ${digitos} típico de uso interno / consumo.`
    };
  }
  if (CFOP_INDUSTRIALIZACAO.has(sufixo)) {
    return {
      tipo: TIPO_ENTRADA.INDUSTRIALIZACAO,
      confianca: 90,
      motivo: `CFOP ${digitos} típico de industrialização.`
    };
  }
  if (CFOP_REVENDA.has(sufixo) || sufixo === '102' || sufixo === '403') {
    return {
      tipo: TIPO_ENTRADA.REVENDA,
      confianca: 88,
      motivo: `CFOP ${digitos} típico de compra para revenda.`
    };
  }
  if (digitos[0] === '1' || digitos[0] === '2') {
    return {
      tipo: TIPO_ENTRADA.REVENDA,
      confianca: 70,
      motivo: `CFOP ${digitos} de entrada — sugestão padrão Revenda.`
    };
  }
  return null;
}

function classificarPorNatureza(natureza) {
  const n = String(natureza || '').toUpperCase();
  if (!n) return null;
  if (/USO|CONSUMO|IMOBILIZ|DESPESA|MATERIAL\s+DE\s+USO/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.USO_CONSUMO,
      confianca: 85,
      motivo: 'Natureza da operação indica uso interno / consumo.'
    };
  }
  if (/INDUSTRIALIZ|INDUSTRIALIZA/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.INDUSTRIALIZACAO,
      confianca: 85,
      motivo: 'Natureza da operação indica industrialização.'
    };
  }
  if (/REVENDA|COMERCIALIZ|MERCADORIA/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.REVENDA,
      confianca: 80,
      motivo: 'Natureza da operação indica compra para revenda.'
    };
  }
  return null;
}

function classificarPorFinalidade(finNFe) {
  const f = String(finNFe || '').trim();
  // 1=Normal — sem sinal forte; 2/3/4 raros em entrada de compra
  if (f === '1' || f === '') return null;
  if (f === '4') {
    return {
      tipo: TIPO_ENTRADA.REVENDA,
      confianca: 65,
      motivo: 'Finalidade NF-e de devolução — mantém fluxo operacional padrão.'
    };
  }
  return null;
}

async function historicoFornecedor(cnpj) {
  const digitos = digitsOnly(cnpj);
  if (digitos.length < 11) return null;

  const rows = await dbAll(
    `SELECT COALESCE(tipo_entrada, 'REVENDA') AS tipo_entrada, COUNT(*) AS qtd
     FROM compras
     WHERE (status IS NULL OR status != 'cancelada')
       AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(fornecedor_cnpj,''), '.', ''), '/', ''), '-', ''), ' ', '') = ?
       AND tipo_entrada IS NOT NULL AND TRIM(tipo_entrada) != ''
     GROUP BY COALESCE(tipo_entrada, 'REVENDA')
     ORDER BY qtd DESC`,
    [digitos]
  );

  if (!rows.length) return null;

  const total = rows.reduce((s, r) => s + Number(r.qtd || 0), 0);
  const top = rows[0];
  const tipo = normalizarTipoEntrada(top.tipo_entrada);
  const pct = total > 0 ? Math.round((Number(top.qtd) / total) * 100) : 0;

  return {
    tipo,
    qtd: Number(top.qtd || 0),
    total,
    percentual: pct,
    exclusivo: rows.length === 1 && total >= 2
  };
}

function mesclarSinais(sinais) {
  // Prioridade: CFOP > Natureza > Finalidade > Histórico (aplicado depois)
  const ordenados = sinais.filter(Boolean).sort((a, b) => b.confianca - a.confianca);
  if (!ordenados.length) {
    return {
      tipoEntrada: TIPO_ENTRADA_PADRAO,
      confianca: 55,
      motivo: 'Sem sinais fiscais suficientes — sugestão padrão Revenda.',
      label: ROTULOS[TIPO_ENTRADA_PADRAO]
    };
  }

  const top = ordenados[0];
  // Se dois sinais fortes concordam, sobe confiança
  const concordantes = ordenados.filter((s) => s.tipo === top.tipo);
  let confianca = top.confianca;
  if (concordantes.length >= 2) {
    confianca = Math.min(98, confianca + 6);
  }

  return {
    tipoEntrada: top.tipo,
    confianca,
    motivo: top.motivo,
    label: ROTULOS[top.tipo]
  };
}

/**
 * Classifica tipo de entrada a partir de XML e/ou dados já parseados.
 * @param {Object|string} input — xml string OU { xml, dadosCompra, fornecedor_cnpj, cfop, natureza, finalidade }
 * @returns {Promise<{ tipoEntrada, confianca, motivo, label, sinais }>}
 */
async function classificarEntrada(input = {}) {
  const payload = typeof input === 'string' ? { xml: input } : (input || {});
  const dados = payload.dadosCompra || payload.dados || {};
  const xml = payload.xml || dados.xml || '';

  const sinaisXml = xml ? extrairSinaisFiscaisDoXml(xml) : {
    cfops: [],
    cfopPredominante: null,
    natureza: '',
    finalidade: null
  };

  const cfop = payload.cfop
    || dados.cfop
    || sinaisXml.cfopPredominante
    || (Array.isArray(dados.itens) && dados.itens[0]?.cfop)
    || null;

  const natureza = payload.natureza
    || payload.natureza_operacao
    || dados.natureza
    || dados.natureza_operacao
    || sinaisXml.natureza
    || '';

  const finalidade = payload.finalidade
    || payload.finNFe
    || dados.finalidade
    || dados.finNFe
    || sinaisXml.finalidade
    || null;

  const cnpj = payload.fornecedor_cnpj
    || dados.fornecedor_cnpj
    || dados.fornecedorCnpj
    || '';

  const sinaisFiscais = [
    classificarPorCfop(cfop),
    classificarPorNatureza(natureza),
    classificarPorFinalidade(finalidade)
  ];

  let resultado = mesclarSinais(sinaisFiscais);
  let historico = null;

  try {
    historico = await historicoFornecedor(cnpj);
  } catch {
    historico = null;
  }

  if (historico) {
    if (historico.tipo === resultado.tipoEntrada) {
      const boost = historico.exclusivo ? 8 : (historico.percentual >= 70 ? 5 : 3);
      resultado = {
        ...resultado,
        confianca: Math.min(99, resultado.confianca + boost),
        motivo: historico.exclusivo
          ? `${resultado.motivo} Fornecedor normalmente utilizado para ${ROTULOS[historico.tipo].toLowerCase()}.`
          : `${resultado.motivo} Histórico do fornecedor reforça ${ROTULOS[historico.tipo]} (${historico.percentual}%).`
      };
    } else if (historico.exclusivo && historico.total >= 3 && resultado.confianca < 90) {
      // Histórico exclusivo forte pode prevalecer sobre sinal fiscal fraco
      resultado = {
        tipoEntrada: historico.tipo,
        confianca: Math.min(96, 78 + Math.min(15, historico.total)),
        motivo: `Fornecedor utilizado predominantemente para ${ROTULOS[historico.tipo].toLowerCase()} (${historico.qtd}/${historico.total}).`,
        label: ROTULOS[historico.tipo]
      };
    } else if (!sinaisFiscais.some(Boolean) && historico.qtd >= 1) {
      resultado = {
        tipoEntrada: historico.tipo,
        confianca: Math.min(90, 70 + Math.min(20, historico.percentual / 5)),
        motivo: `Classificação pelo histórico do fornecedor (${historico.percentual}% das compras).`,
        label: ROTULOS[historico.tipo]
      };
    }
  }

  return {
    tipoEntrada: resultado.tipoEntrada,
    confianca: Math.round(resultado.confianca),
    motivo: resultado.motivo,
    label: resultado.label || ROTULOS[resultado.tipoEntrada],
    sinais: {
      cfop: cfop || null,
      natureza: natureza || null,
      finalidade: finalidade || null,
      historico
    }
  };
}

module.exports = {
  classificarEntrada,
  classificarPorCfop,
  classificarPorCfopItem,
  classificarPorNatureza,
  classificarPorFinalidade,
  historicoFornecedor,
  mesclarSinais,
  CFOP_BONIFICACAO
};
