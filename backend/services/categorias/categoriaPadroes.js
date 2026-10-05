'use strict';

const { normalizarFlagControlaEstoque } = require('../estoque/produtoControlaEstoque');

const CONTROLE_COMERCIAL_PADRAO = 'PADRAO';
const CONTROLE_COMERCIAL_ALTERNATIVO = 'ALTERNATIVO';

function normalizarNomeCategoria(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function categoriaEhAcougueOuHortifruti(nome) {
  const n = normalizarNomeCategoria(nome);
  if (!n) return false;
  return n === 'hortifruti'
    || n === 'horti fruti'
    || n === 'acougue'
    || n.startsWith('hortifruti ')
    || n.startsWith('acougue ');
}

function categoriaSugerePadraoHortifrutiAcougue(nome) {
  return categoriaEhAcougueOuHortifruti(nome);
}

function resolverFlagsObrigatoriosCategoria(nome) {
  return categoriaEhAcougueOuHortifruti(nome)
    ? { controlaEstoque: 0, itemFiscal: 0 }
    : null;
}

function normalizarPadraoControlaEstoque(valor, fallback = 1) {
  if (valor === undefined || valor === null || valor === '') {
    return Number(fallback) === 0 ? 0 : 1;
  }
  const s = String(valor).trim().toUpperCase();
  if (s === 'NAO_CONTROLADO' || s === 'NAO CONTROLADO' || s === 'NÃO CONTROLADO' || s === 'NAO') {
    return 0;
  }
  if (s === 'CONTROLADO' || s === 'SIM' || s === 'TRUE') {
    return 1;
  }
  return Number(valor) === 0 ? 0 : 1;
}

function normalizarPadraoControleComercial(valor, fallback = CONTROLE_COMERCIAL_PADRAO) {
  if (valor === undefined || valor === null || valor === '') {
    return fallback === CONTROLE_COMERCIAL_ALTERNATIVO
      ? CONTROLE_COMERCIAL_ALTERNATIVO
      : CONTROLE_COMERCIAL_PADRAO;
  }
  const s = String(valor).trim().toUpperCase();
  if (
    s === CONTROLE_COMERCIAL_ALTERNATIVO
    || s === '0'
    || s === 'ALTERNATE'
  ) {
    return CONTROLE_COMERCIAL_ALTERNATIVO;
  }
  return CONTROLE_COMERCIAL_PADRAO;
}

function itemFiscalDeControleComercial(valor) {
  return normalizarPadraoControleComercial(valor) === CONTROLE_COMERCIAL_ALTERNATIVO ? 0 : 1;
}

function controleComercialDeItemFiscal(itemFiscal) {
  return Number(itemFiscal) === 0
    ? CONTROLE_COMERCIAL_ALTERNATIVO
    : CONTROLE_COMERCIAL_PADRAO;
}

function padroesSugeridosPorNome(nome) {
  if (categoriaSugerePadraoHortifrutiAcougue(nome)) {
    return {
      padrao_controla_estoque: 0,
      padrao_controle_comercial: CONTROLE_COMERCIAL_ALTERNATIVO
    };
  }
  return {
    padrao_controla_estoque: 1,
    padrao_controle_comercial: CONTROLE_COMERCIAL_PADRAO
  };
}

function campoInformado(body, chave) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, chave)) return false;
  const v = body[chave];
  return v !== undefined && v !== null && v !== '';
}

function resolverPadroesCategoriaParaSalvar(nome, body = {}, opcoes = {}) {
  const sugerido = padroesSugeridosPorNome(nome);
  const criar = opcoes.criar === true;
  const atual = opcoes.atual || {};

  let estoque;
  if (campoInformado(body, 'padrao_controla_estoque')) {
    estoque = normalizarPadraoControlaEstoque(body.padrao_controla_estoque);
  } else if (criar) {
    estoque = sugerido.padrao_controla_estoque;
  } else if (atual.padrao_controla_estoque !== undefined && atual.padrao_controla_estoque !== null) {
    estoque = normalizarPadraoControlaEstoque(atual.padrao_controla_estoque);
  } else {
    estoque = 1;
  }

  let comercial;
  if (campoInformado(body, 'padrao_controle_comercial')) {
    comercial = normalizarPadraoControleComercial(body.padrao_controle_comercial);
  } else if (criar) {
    comercial = sugerido.padrao_controle_comercial;
  } else if (atual.padrao_controle_comercial) {
    comercial = normalizarPadraoControleComercial(atual.padrao_controle_comercial);
  } else {
    comercial = CONTROLE_COMERCIAL_PADRAO;
  }

  return {
    padrao_controla_estoque: estoque,
    padrao_controle_comercial: comercial
  };
}

function padroesEfetivosCategoria(categoria) {
  if (!categoria) {
    return {
      padrao_controla_estoque: 1,
      padrao_controle_comercial: CONTROLE_COMERCIAL_PADRAO
    };
  }
  return {
    padrao_controla_estoque: normalizarPadraoControlaEstoque(
      categoria.padrao_controla_estoque,
      1
    ),
    padrao_controle_comercial: normalizarPadraoControleComercial(
      categoria.padrao_controle_comercial,
      CONTROLE_COMERCIAL_PADRAO
    )
  };
}

function resolverItemFiscalCadastro(body, saldoFiscal, saldoNaoFiscal) {
  if (campoInformado(body, 'item_fiscal')) {
    return Number(body.item_fiscal) === 1 ? 1 : 0;
  }
  if (campoInformado(body, 'controle_comercial')) {
    return itemFiscalDeControleComercial(body.controle_comercial);
  }
  if (Number(saldoNaoFiscal) > 0 && Number(saldoFiscal) === 0) {
    return 0;
  }
  return 1;
}

function resolverFlagsNovoProduto(body, categoria, saldoFiscal, saldoNaoFiscal) {
  const padroes = padroesEfetivosCategoria(categoria);
  const payload = body && typeof body === 'object' ? body : {};

  const flagsObrigatorios = resolverFlagsObrigatoriosCategoria(categoria?.nome);
  if (flagsObrigatorios) {
    return {
      ...flagsObrigatorios,
      padroes: {
        padrao_controla_estoque: 0,
        padrao_controle_comercial: CONTROLE_COMERCIAL_ALTERNATIVO
      }
    };
  }

  let controlaEstoque;
  if (campoInformado(payload, 'controla_estoque')) {
    controlaEstoque = normalizarFlagControlaEstoque(payload.controla_estoque);
  } else {
    controlaEstoque = padroes.padrao_controla_estoque;
  }

  let itemFiscal;
  if (campoInformado(payload, 'item_fiscal') || campoInformado(payload, 'controle_comercial')) {
    itemFiscal = resolverItemFiscalCadastro(payload, saldoFiscal, saldoNaoFiscal);
  } else if (categoria) {
    itemFiscal = itemFiscalDeControleComercial(padroes.padrao_controle_comercial);
  } else {
    itemFiscal = resolverItemFiscalCadastro(payload, saldoFiscal, saldoNaoFiscal);
  }

  return {
    controlaEstoque,
    itemFiscal,
    padroes
  };
}

function serializarCategoria(row) {
  if (!row) return row;
  const padroes = padroesEfetivosCategoria(row);
  return {
    ...row,
    padrao_controla_estoque: padroes.padrao_controla_estoque,
    padrao_controle_comercial: padroes.padrao_controle_comercial
  };
}

module.exports = {
  CONTROLE_COMERCIAL_PADRAO,
  CONTROLE_COMERCIAL_ALTERNATIVO,
  normalizarNomeCategoria,
  categoriaEhAcougueOuHortifruti,
  categoriaSugerePadraoHortifrutiAcougue,
  resolverFlagsObrigatoriosCategoria,
  normalizarPadraoControlaEstoque,
  normalizarPadraoControleComercial,
  itemFiscalDeControleComercial,
  controleComercialDeItemFiscal,
  padroesSugeridosPorNome,
  resolverPadroesCategoriaParaSalvar,
  padroesEfetivosCategoria,
  resolverItemFiscalCadastro,
  resolverFlagsNovoProduto,
  serializarCategoria,
  campoInformado
};
