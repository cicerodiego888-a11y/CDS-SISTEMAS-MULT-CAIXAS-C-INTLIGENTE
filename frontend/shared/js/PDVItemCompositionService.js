/**
 * Motor de composição de linhas do carrinho do PDV (espelho browser).
 * Fonte de verdade lógica: backend/services/pdv/PDVItemCompositionService.js
 */
(function (global) {
  'use strict';

  const MODOS = Object.freeze({
    UNIFICAR: 'UNIFICAR',
    SEPARAR: 'SEPARAR',
    AUTOMATICO: 'AUTOMATICO'
  });

  const ACAO = Object.freeze({
    UNIFICAR: 'UNIFICAR',
    CRIAR: 'CRIAR'
  });

  let _seqLinha = 0;

  function normalizarModo(modo) {
    const v = String(modo == null ? '' : modo).trim().toUpperCase();
    if (v === MODOS.SEPARAR) return MODOS.SEPARAR;
    if (v === MODOS.AUTOMATICO) return MODOS.AUTOMATICO;
    return MODOS.UNIFICAR;
  }

  function gerarLinhaId(prefixo) {
    _seqLinha += 1;
    const base = prefixo != null ? String(prefixo) : 'L';
    return `${base}${Date.now().toString(36)}_${_seqLinha}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  function num(valor, casas) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return 0;
    if (casas == null) return n;
    const f = 10 ** casas;
    return Math.round(n * f) / f;
  }

  function texto(valor) {
    return valor == null ? '' : String(valor);
  }

  function mesmoProduto(a, b) {
    return Number(a) === Number(b);
  }

  function mesmoTipoVenda(a, b) {
    return texto(a || 'PESO').toUpperCase() === texto(b || 'PESO').toUpperCase();
  }

  function linhasCompativeisUnificar(linha, candidato) {
    if (!linha || !candidato) return false;
    return mesmoProduto(linha.produto_id != null ? linha.produto_id : linha.id, candidato.produto_id != null ? candidato.produto_id : candidato.id)
      && mesmoTipoVenda(linha.tipo_venda, candidato.tipo_venda);
  }

  function chaveComercialLinha(linha) {
    const etiqueta = linha && linha.etiqueta_balanca && typeof linha.etiqueta_balanca === 'object'
      ? linha.etiqueta_balanca
      : null;
    return {
      produto_id: Number(linha.produto_id != null ? linha.produto_id : linha.id),
      tipo_venda: texto(linha.tipo_venda || 'PESO').toUpperCase(),
      preco_unitario: num(linha.preco_unitario, 6),
      tipo_preco: texto(linha.tipo_preco || 'varejo').toLowerCase(),
      desconto_percentual: num(linha.desconto_percentual, 4),
      desconto_valor: num(linha.desconto_valor, 4),
      desconto_manual: Number(linha.desconto_manual || 0) === 1 ? 1 : 0,
      promocao_id: linha.promocao_id == null ? null : Number(linha.promocao_id),
      desconto_atacado: num(linha.desconto_atacado, 4),
      preco_manual: Number(linha.preco_manual || 0) === 1 ? 1 : 0,
      condicao_especial: texto(linha.condicao_especial || ''),
      etiqueta_tipo: etiqueta ? texto(etiqueta.tipoPayload || etiqueta.tipo || '') : '',
      subtotal_fixo: etiqueta && etiqueta.subtotalFixo != null
        ? num(etiqueta.subtotalFixo, 2)
        : (linha.subtotal_fixo != null ? num(linha.subtotal_fixo, 2) : null)
    };
  }

  function linhasCompativeisAutomatico(linha, candidato) {
    if (!linhasCompativeisUnificar(linha, candidato)) return false;
    const a = chaveComercialLinha(linha);
    const b = chaveComercialLinha(candidato);
    return a.produto_id === b.produto_id
      && a.tipo_venda === b.tipo_venda
      && a.preco_unitario === b.preco_unitario
      && a.tipo_preco === b.tipo_preco
      && a.desconto_percentual === b.desconto_percentual
      && a.desconto_valor === b.desconto_valor
      && a.desconto_manual === b.desconto_manual
      && a.promocao_id === b.promocao_id
      && a.desconto_atacado === b.desconto_atacado
      && a.preco_manual === b.preco_manual
      && a.condicao_especial === b.condicao_especial
      && a.etiqueta_tipo === b.etiqueta_tipo
      && a.subtotal_fixo === b.subtotal_fixo;
  }

  function localizarLinhaCompativel(carrinho, candidato, modoEntrada) {
    const modo = normalizarModo(modoEntrada);
    const lista = Array.isArray(carrinho) ? carrinho : [];
    if (modo === MODOS.SEPARAR) return null;

    const pred = modo === MODOS.AUTOMATICO
      ? linhasCompativeisAutomatico
      : linhasCompativeisUnificar;

    for (let i = 0; i < lista.length; i += 1) {
      if (pred(lista[i], candidato)) {
        return { linha: lista[i], index: i };
      }
    }
    return null;
  }

  function decidirComposicao(carrinho, candidato, modoEntrada) {
    const modo = normalizarModo(modoEntrada);
    const encontrado = localizarLinhaCompativel(carrinho, candidato, modo);
    if (encontrado) {
      return Object.freeze({
        acao: ACAO.UNIFICAR,
        modo,
        index: encontrado.index,
        linhaExistente: encontrado.linha,
        linha_id: encontrado.linha.linha_id || gerarLinhaId()
      });
    }
    return Object.freeze({
      acao: ACAO.CRIAR,
      modo,
      index: -1,
      linhaExistente: null,
      linha_id: gerarLinhaId()
    });
  }

  function somarQuantidadeProduto(carrinho, produtoId, tipoVenda) {
    const lista = Array.isArray(carrinho) ? carrinho : [];
    let total = 0;
    for (let i = 0; i < lista.length; i += 1) {
      const item = lista[i];
      if (!mesmoProduto(item.produto_id != null ? item.produto_id : item.id, produtoId)) continue;
      if (!mesmoTipoVenda(item.tipo_venda, tipoVenda)) continue;
      total += num(item.quantidade);
    }
    return total;
  }

  function garantirLinhaId(linha) {
    if (!linha || typeof linha !== 'object') return linha;
    if (!linha.linha_id) {
      linha.linha_id = gerarLinhaId();
    }
    return linha;
  }

  global.PDVItemCompositionService = Object.freeze({
    MODOS,
    ACAO,
    normalizarModo,
    gerarLinhaId,
    linhasCompativeisUnificar,
    linhasCompativeisAutomatico,
    chaveComercialLinha,
    localizarLinhaCompativel,
    decidirComposicao,
    somarQuantidadeProduto,
    garantirLinhaId
  });
}(typeof window !== 'undefined' ? window : global));
