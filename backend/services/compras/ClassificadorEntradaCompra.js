/**
 * RC9.1 — Classificação inteligente do Tipo de Entrada.
 * Sugere REVENDA | INDUSTRIALIZACAO | USO_CONSUMO | BONIFICACAO com pontuação heurística e motivo.
 * Não executa motores, não altera fiscal/XML/MIIP/estoque/financeiro.
 *
 * Motor de Natureza da Entrada — o CFOP do XML é interpretado conforme a direção:
 * - 1/2/3 (entrada): código do próprio destinatário — indica a finalidade.
 * - 5/6/7 (saída do emitente): descreve a operação do fornecedor; venda (5101, 5102, 6101…)
 *   não comprova se o destinatário comprou para revenda ou industrialização.
 * A pontuação é heurística (não é probabilidade calibrada).
 *
 * Devolução recebida: não existe tipo de entrada canônico para devolução. finNFe=4, natOp e
 * CFOP de devolução geram sinais explícitos (sem tipo); o resultado não sugere tipo operacional
 * (tipoEntrada null, naturezaDetectada DEVOLUCAO) e sempre exige escolha do operador.
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

const DIRECAO_CFOP = Object.freeze({
  ENTRADA: 'ENTRADA',
  SAIDA: 'SAIDA',
  INDETERMINADA: 'INDETERMINADA'
});

/** ESPECIFICO: operação explícita (bonificação, devolução, uso/consumo, remessa). FORTE: finalidade declarada pelo destinatário. */
const FORCA_SINAL = Object.freeze({
  ESPECIFICO: 'ESPECIFICO',
  FORTE: 'FORTE',
  FRACO: 'FRACO',
  NEUTRO: 'NEUTRO'
});

/** CFOP de entrada (1/2/3) — sufixos (últimos 3 dígitos) típicos de bonificação. */
const CFOP_BONIFICACAO = new Set(['910', '949']);
/** CFOP de entrada (1/2/3) — sufixos típicos de uso/consumo. */
const CFOP_USO_CONSUMO = new Set([
  '551', '552', '553', '556', '557'
]);
/** CFOP de entrada (1/2/3) — sufixos típicos de industrialização. */
const CFOP_INDUSTRIALIZACAO = new Set([
  '101', '111', '113', '116', '117', '118', '124', '125'
]);
/** CFOP de entrada (1/2/3) — sufixos típicos de comercialização. */
const CFOP_REVENDA = new Set([
  '102', '103', '403', '407', '408', '409'
]);
/** CFOP de entrada (1/2/3) — devolução de venda/transferência (x201–x204, x208, x209, x410, x411). */
const CFOP_ENTRADA_DEVOLUCAO = new Set([
  '201', '202', '203', '204', '208', '209', '410', '411'
]);

/**
 * Exceção do item em relação à natureza do cabeçalho:
 * ESPECIFICA (bonificação, uso/consumo) sempre se aplica ao item;
 * COMPRA (CFOP de entrada de compra) só se aplica sem cabeçalho ou com cabeçalho Bonificação.
 */
const EXCECAO_ITEM = Object.freeze({
  ESPECIFICA: 'ESPECIFICA',
  COMPRA: 'COMPRA'
});

/** CFOP de saída do emitente (5/6/7) — operações que indicam a natureza do recebimento. */
const CFOP_SAIDA_BONIFICACAO = new Set(['910']);
const CFOP_SAIDA_OUTRAS_NAO_ESPECIFICADAS = new Set(['949']);
const CFOP_SAIDA_TRANSFERENCIA_USO_CONSUMO = new Set(['552', '557']);
const CFOP_SAIDA_VENDA_ATIVO = new Set(['551']);
const CFOP_SAIDA_REMESSA_INDUSTRIALIZACAO = new Set(['901']);
/** Saída do emitente que devolve mercadoria ao destinatário (x201, x202, x208–x210, x410–x413, x553, x556). */
const CFOP_SAIDA_DEVOLUCAO = new Set([
  '201', '202', '208', '209', '210', '410', '411', '412', '413', '553', '556'
]);

const PESO_FORCA = Object.freeze({ ESPECIFICO: 3, FORTE: 2, FRACO: 1, NEUTRO: 0 });
const PENALIDADE_CONFLITO = Object.freeze({ ESPECIFICO: 20, FORTE: 15, FRACO: 8 });
const CONFIANCA_TETO_COM_CONFLITO = 80;
const CONFIANCA_MINIMA = 40;
const CONFIANCA_SEM_SINAIS = 55;
const LIMITE_CONFIRMACAO = 70;

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}

function normalizarTexto(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function sinal(base) {
  return {
    categoria: null,
    excecaoItem: null,
    ...base
  };
}

function interpretarCfopEntrada(digitos, sufixo) {
  const direcao = DIRECAO_CFOP.ENTRADA;
  if (CFOP_BONIFICACAO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.BONIFICACAO, confianca: 94,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'BONIFICACAO', excecaoItem: EXCECAO_ITEM.ESPECIFICA,
      motivo: `CFOP de entrada ${digitos} típico de bonificação/brinde.`
    });
  }
  if (CFOP_USO_CONSUMO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.USO_CONSUMO, confianca: 92,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'USO_CONSUMO', excecaoItem: EXCECAO_ITEM.ESPECIFICA,
      motivo: `CFOP de entrada ${digitos} típico de uso interno / consumo.`
    });
  }
  if (CFOP_ENTRADA_DEVOLUCAO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: null, confianca: 0,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'DEVOLUCAO',
      motivo: `CFOP de entrada ${digitos} indica devolução recebida.`
    });
  }
  if (CFOP_INDUSTRIALIZACAO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.INDUSTRIALIZACAO, confianca: 90,
      forca: FORCA_SINAL.FORTE, categoria: 'COMPRA', excecaoItem: EXCECAO_ITEM.COMPRA,
      motivo: `CFOP de entrada ${digitos} típico de compra para industrialização.`
    });
  }
  if (CFOP_REVENDA.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.REVENDA, confianca: 88,
      forca: FORCA_SINAL.FORTE, categoria: 'COMPRA', excecaoItem: EXCECAO_ITEM.COMPRA,
      motivo: `CFOP de entrada ${digitos} típico de compra para comercialização.`
    });
  }
  if (digitos[0] === '1' || digitos[0] === '2') {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.REVENDA, confianca: 70,
      forca: FORCA_SINAL.FRACO,
      motivo: `CFOP de entrada ${digitos} sem finalidade específica — sugestão padrão Revenda.`
    });
  }
  return sinal({
    cfop: digitos, direcao, tipo: null, confianca: 0, forca: FORCA_SINAL.NEUTRO,
    motivo: `CFOP de entrada ${digitos} não define a finalidade da compra.`
  });
}

function descreverVendaEmitente(sufixo) {
  if (sufixo === '101') return 'venda de produção do estabelecimento';
  if (sufixo === '102') return 'venda de mercadoria adquirida de terceiros';
  if (sufixo[0] === '1' && sufixo[1] === '5') return 'transferência entre estabelecimentos';
  if (sufixo[0] === '4') return 'venda em operação com substituição tributária';
  return 'venda/operação comercial do emitente';
}

function interpretarCfopSaida(digitos, sufixo) {
  const direcao = DIRECAO_CFOP.SAIDA;
  if (CFOP_SAIDA_BONIFICACAO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.BONIFICACAO, confianca: 94,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'BONIFICACAO', excecaoItem: EXCECAO_ITEM.ESPECIFICA,
      motivo: `CFOP ${digitos} do emitente: remessa em bonificação, doação ou brinde.`
    });
  }
  if (CFOP_SAIDA_DEVOLUCAO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: null, confianca: 0,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'DEVOLUCAO',
      motivo: `CFOP ${digitos} do emitente indica devolução de mercadoria ao destinatário.`
    });
  }
  if (CFOP_SAIDA_TRANSFERENCIA_USO_CONSUMO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.USO_CONSUMO, confianca: 85,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'USO_CONSUMO', excecaoItem: EXCECAO_ITEM.ESPECIFICA,
      motivo: `CFOP ${digitos} do emitente: transferência de bem do ativo ou material de uso e consumo.`
    });
  }
  if (CFOP_SAIDA_REMESSA_INDUSTRIALIZACAO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.INDUSTRIALIZACAO, confianca: 85,
      forca: FORCA_SINAL.ESPECIFICO, categoria: 'REMESSA_INDUSTRIALIZACAO',
      motivo: `CFOP ${digitos} do emitente: remessa para industrialização por encomenda.`
    });
  }
  if (CFOP_SAIDA_OUTRAS_NAO_ESPECIFICADAS.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.BONIFICACAO, confianca: 65,
      forca: FORCA_SINAL.FRACO, categoria: 'BONIFICACAO',
      motivo: `CFOP ${digitos} do emitente (outra saída não especificada) pode indicar bonificação — confirme.`
    });
  }
  if (CFOP_SAIDA_VENDA_ATIVO.has(sufixo)) {
    return sinal({
      cfop: digitos, direcao, tipo: TIPO_ENTRADA.USO_CONSUMO, confianca: 60,
      forca: FORCA_SINAL.FRACO,
      motivo: `CFOP ${digitos} do emitente (venda de bem do ativo imobilizado) sugere uso próprio, sem comprovar a finalidade.`
    });
  }
  if (sufixo[0] === '1' || sufixo[0] === '4') {
    return sinal({
      cfop: digitos, direcao, tipo: null, confianca: 0, forca: FORCA_SINAL.NEUTRO, categoria: 'VENDA',
      motivo: `CFOP ${digitos} do emitente (${descreverVendaEmitente(sufixo)}) descreve a operação do fornecedor e não define a finalidade da entrada.`
    });
  }
  return sinal({
    cfop: digitos, direcao, tipo: null, confianca: 0, forca: FORCA_SINAL.NEUTRO,
    motivo: `CFOP ${digitos} do emitente não define a finalidade da entrada.`
  });
}

/**
 * Interpreta o CFOP conforme a direção (entrada do destinatário × saída do emitente).
 * @param {string} cfop
 * @returns {{ cfop: string|null, direcao: string, tipo: string|null, confianca: number, forca: string, categoria: string|null, excecaoItem: string|null, motivo: string|null }}
 */
function interpretarCfop(cfop) {
  const digitos = digitsOnly(cfop);
  if (digitos.length !== 4) {
    return sinal({
      cfop: digitos || null,
      direcao: DIRECAO_CFOP.INDETERMINADA,
      tipo: null,
      confianca: 0,
      forca: FORCA_SINAL.NEUTRO,
      motivo: digitos ? `CFOP ${digitos} inválido — não utilizado na classificação.` : null
    });
  }
  const sufixo = digitos.slice(1);
  if ('123'.includes(digitos[0])) return interpretarCfopEntrada(digitos, sufixo);
  if ('567'.includes(digitos[0])) return interpretarCfopSaida(digitos, sufixo);
  return sinal({
    cfop: digitos,
    direcao: DIRECAO_CFOP.INDETERMINADA,
    tipo: null,
    confianca: 0,
    forca: FORCA_SINAL.NEUTRO,
    motivo: `CFOP ${digitos} inválido — não utilizado na classificação.`
  });
}

function classificarPorCfop(cfop) {
  const item = classificarPorCfopItem(cfop);
  return item ? { tipo: item.tipo, confianca: item.confianca, motivo: item.motivo, forca: item.forca } : null;
}

/**
 * Classificação fiscal por CFOP do item (RC4.31.11).
 * Retorna null quando o CFOP não indica finalidade (ex.: venda 5101/6101 do emitente, devolução).
 * `excecaoItem` indica se o CFOP pode divergir do tipo do cabeçalho no item (ver EXCECAO_ITEM).
 */
function classificarPorCfopItem(cfop) {
  const i = interpretarCfop(cfop);
  if (!i.tipo) return null;
  return {
    tipo: i.tipo,
    confianca: i.confianca,
    motivo: i.motivo,
    forca: i.forca,
    direcao: i.direcao,
    categoria: i.categoria,
    excecaoItem: i.excecaoItem
  };
}

/**
 * natOp é declarada pelo emitente: "venda de mercadoria/produção" descreve a operação dele,
 * não a finalidade do destinatário. Só expressões explícitas geram sinal específico.
 */
function classificarPorNatureza(natureza) {
  const n = normalizarTexto(natureza);
  if (!n) return null;
  if (/DEVOLU/.test(n)) {
    return {
      tipo: null,
      confianca: 0,
      forca: FORCA_SINAL.ESPECIFICO,
      categoria: 'DEVOLUCAO',
      motivo: 'Natureza da operação declara devolução.'
    };
  }
  if (/BONIFIC|BRINDE|DOACAO/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.BONIFICACAO,
      confianca: 85,
      forca: FORCA_SINAL.ESPECIFICO,
      categoria: 'BONIFICACAO',
      motivo: 'Natureza da operação indica bonificação, brinde ou doação.'
    };
  }
  if (/INDUSTRIALIZ(?!AD)/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.INDUSTRIALIZACAO,
      confianca: 85,
      forca: FORCA_SINAL.ESPECIFICO,
      motivo: 'Natureza da operação indica industrialização.'
    };
  }
  if (/\bUSO\b|CONSUMO\b|IMOBILIZ|DESPESA/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.USO_CONSUMO,
      confianca: 85,
      forca: FORCA_SINAL.ESPECIFICO,
      categoria: 'USO_CONSUMO',
      motivo: 'Natureza da operação indica uso interno / consumo.'
    };
  }
  if (/REVENDA|COMERCIALIZ/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.REVENDA,
      confianca: 80,
      forca: FORCA_SINAL.FORTE,
      motivo: 'Natureza da operação declara revenda/comercialização.'
    };
  }
  if (/MERCADORIA/.test(n)) {
    return {
      tipo: TIPO_ENTRADA.REVENDA,
      confianca: 60,
      forca: FORCA_SINAL.FRACO,
      motivo: 'Natureza "venda de mercadoria" descreve a operação do fornecedor — indício fraco de revenda.'
    };
  }
  return null;
}

function classificarPorFinalidade(finNFe) {
  const f = String(finNFe || '').trim();
  // 1=Normal — sem sinal; 2/3 (complementar/ajuste) não indicam finalidade
  if (f === '1' || f === '') return null;
  if (f === '4') {
    return {
      tipo: null,
      confianca: 0,
      forca: FORCA_SINAL.ESPECIFICO,
      categoria: 'DEVOLUCAO',
      motivo: 'Finalidade da NF-e declarada como devolução (finNFe = 4).'
    };
  }
  return null;
}

const CONFIANCA_DEVOLUCAO_POR_FONTES = Object.freeze({ 1: 65, 2: 80, 3: 90 });
const BONUS_DEVOLUCAO_REFERENCIA = 5;
const PENALIDADE_DEVOLUCAO_CONFLITO = 15;

/**
 * Avalia se o documento é uma devolução recebida. Fontes independentes: finalidade (finNFe),
 * natureza (natOp) e CFOP. Referência a documento anterior reforça, mas não decide sozinha;
 * a ausência é registrada e nada é deduzido. Não indica quem devolveu (cliente ou outro).
 * @returns {Object|null} null quando nenhuma fonte indica devolução.
 */
function avaliarDevolucao({ cfops = [], natureza = null, finalidade = null, naturezaTexto = '', referencias = null } = {}) {
  const cfopsDevolucao = cfops.filter((i) => i?.categoria === 'DEVOLUCAO');
  const fontes = [
    finalidade?.categoria === 'DEVOLUCAO' ? finalidade : null,
    natureza?.categoria === 'DEVOLUCAO' ? natureza : null,
    cfopsDevolucao[0] || null
  ].filter(Boolean);
  if (!fontes.length) return null;

  const conflitos = [];
  cfops
    .filter((i) => i && i.categoria !== 'DEVOLUCAO' && (i.tipo || i.categoria === 'VENDA'))
    .forEach((i) => conflitos.push(i.motivo));
  if (natureza && natureza.categoria !== 'DEVOLUCAO' && natureza.tipo) {
    conflitos.push(natureza.motivo);
  } else if (!natureza && /\bVENDA\b|\bCOMPRA\b/.test(normalizarTexto(naturezaTexto))) {
    conflitos.push(`Natureza da operação "${String(naturezaTexto).trim()}" declara venda/compra, não devolução.`);
  }

  const chaves = referencias?.chavesNFe || [];
  const outrasReferencias = Number(referencias?.outras || 0);
  const temReferencia = chaves.length > 0 || outrasReferencias > 0;
  const razoes = fontes.map((s) => s.motivo);
  if (cfopsDevolucao.length > 1) razoes.push(...cfopsDevolucao.slice(1).map((s) => s.motivo));
  razoes.push(temReferencia
    ? `Documento fiscal referenciado no XML (${chaves.length} NF-e${outrasReferencias ? `, ${outrasReferencias} outro(s)` : ''}).`
    : 'O XML não referencia o documento fiscal original; a operação anterior não pode ser confirmada.');

  let confianca = CONFIANCA_DEVOLUCAO_POR_FONTES[Math.min(3, fontes.length)];
  if (temReferencia) confianca += BONUS_DEVOLUCAO_REFERENCIA;
  confianca -= conflitos.length * PENALIDADE_DEVOLUCAO_CONFLITO;
  confianca = Math.max(CONFIANCA_MINIMA, Math.min(95, confianca));

  const partes = [
    `Devolução identificada: ${fontes.map((s) => s.motivo).join(' ')}`,
    razoes[razoes.length - 1]
  ];
  if (conflitos.length) {
    partes.push(`Sinais divergentes — ${conflitos.join(' ')}`);
  }
  partes.push('Não há natureza operacional própria para devolução recebida: escolha o tratamento da entrada e confirme.');

  return {
    tipoEntrada: null,
    naturezaDetectada: 'DEVOLUCAO',
    confianca,
    motivo: partes.join(' '),
    label: 'Devolução recebida',
    forca: FORCA_SINAL.ESPECIFICO,
    razoes,
    conflitos,
    requerConfirmacao: true,
    referencias: { nfe: chaves.length, outras: outrasReferencias }
  };
}

/**
 * Histórico de entradas confirmadas pelo operador (passaram pela sugestão e foram gravadas,
 * ou tiveram o tipo alterado manualmente). Compras canceladas não contam.
 */
async function historicoFornecedor(cnpj) {
  const digitos = digitsOnly(cnpj);
  if (digitos.length < 11) return null;

  const rows = await dbAll(
    `SELECT COALESCE(tipo_entrada, 'REVENDA') AS tipo_entrada, COUNT(*) AS qtd,
            SUM(CASE WHEN COALESCE(tipo_entrada_alterado, 0) = 1 THEN 1 ELSE 0 END) AS corrigidas
     FROM compras
     WHERE (status IS NULL OR status != 'cancelada')
       AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(fornecedor_cnpj,''), '.', ''), '/', ''), '-', ''), ' ', '') = ?
       AND tipo_entrada IS NOT NULL AND TRIM(tipo_entrada) != ''
       AND (tipo_entrada_sugerido IS NOT NULL OR COALESCE(tipo_entrada_alterado, 0) = 1)
     GROUP BY COALESCE(tipo_entrada, 'REVENDA')
     ORDER BY qtd DESC`,
    [digitos]
  );

  if (!rows.length) return null;

  const total = rows.reduce((s, r) => s + Number(r.qtd || 0), 0);
  const top = rows[0];
  const tipo = normalizarTipoEntrada(top.tipo_entrada);
  const qtd = Number(top.qtd || 0);
  const pct = total > 0 ? Math.round((qtd / total) * 100) : 0;

  return {
    tipo,
    qtd,
    total,
    percentual: pct,
    corrigidas: Number(top.corrigidas || 0),
    exclusivo: rows.length === 1 && total >= 2,
    confiavel: qtd >= 2 && pct >= 70
  };
}

function maiorForca(sinais) {
  return sinais.reduce(
    (acc, s) => (PESO_FORCA[s.forca] > PESO_FORCA[acc] ? s.forca : acc),
    FORCA_SINAL.NEUTRO
  );
}

function rotuloMinusculo(tipo) {
  return (ROTULOS[tipo] || ROTULOS[TIPO_ENTRADA_PADRAO]).toLowerCase();
}

/**
 * Consolida sinais: concordância reforça; divergência reduz e exige confirmação.
 * Sinais sem tipo (ex.: CFOP de venda do emitente) entram apenas como observação.
 */
function mesclarSinais(sinais) {
  const lista = (sinais || []).filter(Boolean);
  const observacoes = lista.filter((s) => !s.tipo && s.motivo).map((s) => s.motivo);
  const validos = lista
    .filter((s) => s.tipo)
    .map((s) => ({ ...s, forca: s.forca || FORCA_SINAL.FORTE }));

  if (!validos.length) {
    return {
      tipoEntrada: TIPO_ENTRADA_PADRAO,
      confianca: CONFIANCA_SEM_SINAIS,
      motivo: [
        ...observacoes,
        'Sem sinais suficientes para identificar a finalidade — sugestão padrão Revenda; confirme a natureza da entrada.'
      ].join(' '),
      label: ROTULOS[TIPO_ENTRADA_PADRAO],
      forca: FORCA_SINAL.NEUTRO,
      razoes: observacoes,
      conflitos: [],
      requerConfirmacao: true
    };
  }

  const ordenados = [...validos].sort(
    (a, b) => (b.confianca - a.confianca) || (PESO_FORCA[b.forca] - PESO_FORCA[a.forca])
  );
  const top = ordenados[0];
  const concordantes = ordenados.filter((s) => s.tipo === top.tipo);
  const conflitantes = ordenados.filter((s) => s.tipo !== top.tipo);

  let confianca = top.confianca;
  if (concordantes.length >= 2) {
    confianca = Math.min(98, confianca + 6);
  }
  if (conflitantes.length) {
    const penalidade = Math.max(...conflitantes.map((s) => PENALIDADE_CONFLITO[s.forca] || PENALIDADE_CONFLITO.FRACO));
    confianca = Math.min(CONFIANCA_TETO_COM_CONFLITO, confianca - penalidade);
  }
  confianca = Math.max(CONFIANCA_MINIMA, confianca);

  const forca = maiorForca(concordantes);
  const conflitos = conflitantes.map((s) => `${ROTULOS[s.tipo]}: ${s.motivo}`);
  const partes = [top.motivo, ...concordantes.slice(1).map((s) => s.motivo), ...observacoes];
  if (conflitos.length) {
    partes.push(`Sinais divergentes — ${conflitos.join(' ')} Confirme a natureza da entrada.`);
  }

  return {
    tipoEntrada: top.tipo,
    confianca,
    motivo: partes.join(' '),
    label: ROTULOS[top.tipo],
    forca,
    razoes: [...ordenados.map((s) => s.motivo), ...observacoes],
    conflitos,
    requerConfirmacao: conflitos.length > 0 || confianca < LIMITE_CONFIRMACAO || forca === FORCA_SINAL.FRACO
  };
}

/**
 * Histórico confirmado do fornecedor: reforça quando concorda; decide quando os sinais
 * da nota são fracos ou ausentes; nunca substitui evidência específica (bonificação,
 * devolução, uso/consumo, remessa) e, contra sinal forte, apenas reduz a confiança.
 */
function aplicarHistorico(resultado, historico) {
  if (!historico || !historico.qtd) return resultado;
  const descricao = `${historico.qtd}/${historico.total} entradas confirmadas`;
  const rotuloHist = rotuloMinusculo(historico.tipo);
  const semSinais = resultado.forca === FORCA_SINAL.NEUTRO;
  const observacoes = semSinais ? resultado.razoes.join(' ') : resultado.motivo;

  if (historico.tipo === resultado.tipoEntrada) {
    if (semSinais) {
      const confianca = Math.min(85, 60 + Math.min(15, historico.qtd * 3) + (historico.exclusivo ? 10 : 0));
      return {
        ...resultado,
        confianca,
        motivo: `Histórico confirmado do fornecedor indica ${rotuloHist} (${descricao}).${observacoes ? ` ${observacoes}` : ''}`,
        razoes: [...resultado.razoes, `Histórico do fornecedor: ${rotuloHist} (${descricao}).`],
        origemDecisao: 'HISTORICO',
        requerConfirmacao: !historico.confiavel || confianca < LIMITE_CONFIRMACAO
      };
    }
    const boost = historico.exclusivo ? 8 : (historico.percentual >= 70 ? 5 : 3);
    const confianca = Math.min(98, resultado.confianca + boost);
    return {
      ...resultado,
      confianca,
      motivo: `${resultado.motivo} Histórico confirmado do fornecedor reforça ${rotuloHist} (${descricao}).`,
      razoes: [...resultado.razoes, `Histórico do fornecedor: ${rotuloHist} (${descricao}).`],
      requerConfirmacao: resultado.conflitos.length > 0 || confianca < LIMITE_CONFIRMACAO
    };
  }

  if (resultado.forca === FORCA_SINAL.ESPECIFICO) {
    return {
      ...resultado,
      razoes: [...resultado.razoes, `Histórico do fornecedor (${rotuloHist}, ${descricao}) não se aplica: a nota traz evidência específica.`]
    };
  }

  if (resultado.forca === FORCA_SINAL.FORTE) {
    const conflito = `Histórico do fornecedor: ${rotuloHist} (${descricao}).`;
    return {
      ...resultado,
      confianca: Math.max(CONFIANCA_MINIMA, Math.min(CONFIANCA_TETO_COM_CONFLITO, resultado.confianca - 10)),
      motivo: `${resultado.motivo} Divergente do histórico confirmado do fornecedor (${rotuloHist}, ${descricao}). Confirme a natureza da entrada.`,
      conflitos: [...resultado.conflitos, conflito],
      razoes: [...resultado.razoes, conflito],
      requerConfirmacao: true
    };
  }

  // Sinais fracos ou ausentes: histórico confirmado pode decidir.
  if (historico.confiavel || semSinais) {
    const conflitoFraco = semSinais ? null : `${ROTULOS[resultado.tipoEntrada]}: ${resultado.motivo}`;
    let confianca = Math.min(85, 62 + Math.min(15, historico.qtd * 3) + (historico.exclusivo ? 8 : 0));
    if (conflitoFraco) confianca = Math.min(75, confianca);
    if (!historico.confiavel) confianca = Math.min(69, confianca);
    return {
      ...resultado,
      tipoEntrada: historico.tipo,
      confianca,
      label: ROTULOS[historico.tipo],
      forca: FORCA_SINAL.FRACO,
      motivo: `Fornecedor confirmado anteriormente para ${rotuloHist} (${descricao}).`
        + (conflitoFraco ? ` Sinal fraco divergente — ${conflitoFraco}` : (observacoes ? ` ${observacoes}` : '')),
      razoes: [...resultado.razoes, `Histórico do fornecedor: ${rotuloHist} (${descricao}).`],
      conflitos: conflitoFraco ? [...resultado.conflitos, conflitoFraco] : resultado.conflitos,
      origemDecisao: 'HISTORICO',
      requerConfirmacao: Boolean(conflitoFraco) || !historico.confiavel || confianca < LIMITE_CONFIRMACAO
    };
  }

  const conflito = `Histórico do fornecedor: ${rotuloHist} (${descricao}).`;
  return {
    ...resultado,
    motivo: `${resultado.motivo} Histórico do fornecedor diverge (${rotuloHist}, ${descricao}).`,
    conflitos: [...resultado.conflitos, conflito],
    razoes: [...resultado.razoes, conflito],
    requerConfirmacao: true
  };
}

/**
 * Classifica tipo de entrada a partir de XML e/ou dados já parseados.
 * @param {Object|string} input — xml string OU { xml, dadosCompra, fornecedor_cnpj, cfop, natureza, finalidade }
 * @returns {Promise<{ tipoEntrada, confianca, motivo, label, forca, requerConfirmacao, razoes, conflitos, sinais }>}
 */
async function classificarEntrada(input = {}) {
  const payload = typeof input === 'string' ? { xml: input } : (input || {});
  const dados = payload.dadosCompra || payload.dados || {};
  const xml = payload.xml || dados.xml || '';

  const sinaisXml = xml ? extrairSinaisFiscaisDoXml(xml) : {
    cfops: [],
    cfopPredominante: null,
    natureza: '',
    finalidade: null,
    referencias: null
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

  const cfopInterpretado = interpretarCfop(cfop);
  const cfopsDistintos = [...new Set((sinaisXml.cfops || []).map(digitsOnly).filter((c) => c.length === 4))];
  const observacaoMista = cfopsDistintos.length > 1
    ? { tipo: null, motivo: `NF-e com CFOPs distintos (${cfopsDistintos.join(', ')}); considerado o predominante.` }
    : null;

  const sinalNatureza = classificarPorNatureza(natureza);
  const sinalFinalidade = classificarPorFinalidade(finalidade);
  const interpretacoesCfops = cfopsDistintos.length
    ? cfopsDistintos.map((c) => (c === cfopInterpretado.cfop ? cfopInterpretado : interpretarCfop(c)))
    : [cfopInterpretado];

  let historico = null;
  let resultado = avaliarDevolucao({
    cfops: interpretacoesCfops,
    natureza: sinalNatureza,
    finalidade: sinalFinalidade,
    naturezaTexto: natureza,
    referencias: sinaisXml.referencias
  });

  if (!resultado) {
    resultado = mesclarSinais([cfopInterpretado, sinalNatureza, sinalFinalidade, observacaoMista]);
    try {
      historico = await historicoFornecedor(cnpj);
    } catch {
      historico = null;
    }
    resultado = aplicarHistorico(resultado, historico);
  }

  return {
    tipoEntrada: resultado.tipoEntrada,
    naturezaDetectada: resultado.naturezaDetectada || null,
    confianca: Math.round(resultado.confianca),
    motivo: resultado.motivo,
    label: resultado.label || ROTULOS[resultado.tipoEntrada],
    forca: resultado.forca,
    requerConfirmacao: Boolean(resultado.requerConfirmacao),
    razoes: resultado.razoes || [],
    conflitos: resultado.conflitos || [],
    sinais: {
      cfop: cfopInterpretado.cfop || null,
      cfopDirecao: cfopInterpretado.direcao,
      cfops: cfopsDistintos,
      natureza: natureza || null,
      finalidade: finalidade || null,
      referencias: resultado.referencias || null,
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
  interpretarCfop,
  historicoFornecedor,
  mesclarSinais,
  aplicarHistorico,
  avaliarDevolucao,
  DIRECAO_CFOP,
  FORCA_SINAL,
  EXCECAO_ITEM,
  CFOP_BONIFICACAO
};
