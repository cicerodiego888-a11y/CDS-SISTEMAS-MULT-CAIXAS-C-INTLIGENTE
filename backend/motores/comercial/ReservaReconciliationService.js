/**
 * RC5.2.1 / RC5.2.2 / RC5.2.3 — Reconciliação de Reservas Fiscais (READ-ONLY).
 *
 * Detecta divergências entre Pedido, Reserva Fiscal e Estoque Fiscal.
 * RC5.2.2 — evidências de diagnóstico.
 * RC5.2.3 — plano de correção em modo simulação (nunca executa).
 * NÃO corrige: nenhum UPDATE / INSERT / DELETE.
 *
 * @module motores/comercial/ReservaReconciliationService
 */
'use strict';

const { PedidoStatus } = require('../../services/pedido/enums');

/** Status em que o Pedido comercialmente espera reserva fiscal ativa. */
const STATUS_COM_RESERVA_ESPERADA = Object.freeze([
  PedidoStatus.AGUARDANDO_FATURAMENTO
]);

const TipoInconsistencia = Object.freeze({
  RESERVA_QUANTIDADE_INVALIDA: 'RESERVA_QUANTIDADE_INVALIDA',
  RESERVA_MAIOR_QUE_PEDIDO: 'RESERVA_MAIOR_QUE_PEDIDO',
  SALDO_FISCAL_NEGATIVO: 'SALDO_FISCAL_NEGATIVO',
  PEDIDO_CANCELADO_COM_RESERVA_ATIVA: 'PEDIDO_CANCELADO_COM_RESERVA_ATIVA',
  RESERVA_ORFA: 'RESERVA_ORFA',
  PEDIDO_SEM_RESERVA: 'PEDIDO_SEM_RESERVA',
  RESERVA_INEXISTENTE: 'RESERVA_INEXISTENTE',
  PRODUTO_INEXISTENTE: 'PRODUTO_INEXISTENTE'
});

/** Origem da evidência / onde a divergência foi encontrada. */
const EncontradoEm = Object.freeze({
  PEDIDO: 'PEDIDO',
  RESERVA: 'RESERVA',
  ESTOQUE: 'ESTOQUE',
  MTS: 'MTS'
});

/** RC5.2.3 — ações sugeridas (simulation mode; nunca executadas aqui). */
const AcaoCorrecao = Object.freeze({
  CRIAR_RESERVA: 'CRIAR_RESERVA',
  REMOVER_RESERVA: 'REMOVER_RESERVA',
  AJUSTAR_RESERVA: 'AJUSTAR_RESERVA',
  LIBERAR_RESERVA: 'LIBERAR_RESERVA',
  ANALISE_MANUAL: 'ANALISE_MANUAL'
});

const RiscoCorrecao = Object.freeze({
  BAIXO: 'BAIXO',
  MEDIO: 'MEDIO',
  ALTO: 'ALTO'
});

/**
 * RC5.2.3 — plano de correção simulado por tipo de inconsistência.
 * Somente sugestão; executavel=false impede auto-aplicação nesta sprint.
 * @param {string} tipo
 * @returns {{ acao: string, descricao: string, risco: string, executavel: boolean }}
 */
function montarPlanoCorrecao(tipo) {
  switch (String(tipo)) {
    case TipoInconsistencia.PEDIDO_SEM_RESERVA:
    case TipoInconsistencia.RESERVA_INEXISTENTE:
      return Object.freeze({
        acao: AcaoCorrecao.CRIAR_RESERVA,
        descricao: 'Criar reserva fiscal compatível com a quantidade do pedido.',
        risco: RiscoCorrecao.MEDIO,
        executavel: true
      });
    case TipoInconsistencia.RESERVA_ORFA:
      return Object.freeze({
        acao: AcaoCorrecao.REMOVER_RESERVA,
        descricao: 'Remover reserva ativa sem pedido correspondente e estornar reservado_fiscal.',
        risco: RiscoCorrecao.BAIXO,
        executavel: true
      });
    case TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO:
    case TipoInconsistencia.RESERVA_QUANTIDADE_INVALIDA:
      return Object.freeze({
        acao: AcaoCorrecao.AJUSTAR_RESERVA,
        descricao: 'Ajustar quantidade da reserva para coincidir com o pedido (ou zerar se inválida).',
        risco: RiscoCorrecao.MEDIO,
        executavel: true
      });
    case TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA:
      return Object.freeze({
        acao: AcaoCorrecao.LIBERAR_RESERVA,
        descricao: 'Liberar reserva ativa de pedido cancelado.',
        risco: RiscoCorrecao.BAIXO,
        executavel: true
      });
    case TipoInconsistencia.SALDO_FISCAL_NEGATIVO:
    case TipoInconsistencia.PRODUTO_INEXISTENTE:
      return Object.freeze({
        acao: AcaoCorrecao.ANALISE_MANUAL,
        descricao: 'Requer análise manual — não há correção automática segura.',
        risco: RiscoCorrecao.ALTO,
        executavel: false
      });
    default:
      return Object.freeze({
        acao: AcaoCorrecao.ANALISE_MANUAL,
        descricao: 'Tipo de inconsistência sem mapeamento automático; analisar manualmente.',
        risco: RiscoCorrecao.ALTO,
        executavel: false
      });
  }
}

function round3(n) {
  return Math.round(Number(n || 0) * 1000) / 1000;
}

function getDb(dbInjected) {
  if (dbInjected) return dbInjected;
  return require('../../database');
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

/**
 * RC5.2.2 / RC5.2.3 — inconsistência com evidências + plano de correção (simulação).
 * @param {object} ev
 */
function inconsistencia(ev = {}) {
  const tipo = String(ev.tipo);
  return Object.freeze({
    pedido_id: ev.pedido_id != null ? Number(ev.pedido_id) : null,
    produto_id: ev.produto_id != null ? Number(ev.produto_id) : null,
    tipo,
    descricao: String(ev.descricao),
    pedido_quantidade: ev.pedido_quantidade != null ? round3(ev.pedido_quantidade) : null,
    reserva_quantidade: ev.reserva_quantidade != null ? round3(ev.reserva_quantidade) : null,
    saldo_fiscal: ev.saldo_fiscal != null ? round3(ev.saldo_fiscal) : null,
    status_pedido: ev.status_pedido != null ? String(ev.status_pedido) : null,
    reserva_id: ev.reserva_id != null ? Number(ev.reserva_id) : null,
    encontrado_em: ev.encontrado_em != null ? String(ev.encontrado_em) : null,
    data_criacao: ev.data_criacao != null ? ev.data_criacao : null,
    data_reserva: ev.data_reserva != null ? ev.data_reserva : null,
    usuario: ev.usuario != null ? ev.usuario : null,
    plano_correcao: montarPlanoCorrecao(tipo)
  });
}

/**
 * Agrega quantidades de itens do pedido por produto.
 * @param {Array<{produto_id:number, quantidade:number}>} itens
 * @returns {Map<number, number>}
 */
function agregarQuantidadesPedido(itens) {
  const map = new Map();
  for (const item of itens || []) {
    const pid = Number(item.produto_id);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    map.set(pid, round3((map.get(pid) || 0) + Number(item.quantidade || 0)));
  }
  return map;
}

/**
 * Agrega quantidades de reservas ativas por produto.
 * @param {Array<{produto_id:number, quantidade_fiscal:number}>} reservas
 * @returns {Map<number, number>}
 */
function agregarQuantidadesReserva(reservas) {
  const map = new Map();
  for (const r of reservas || []) {
    const pid = Number(r.produto_id);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    map.set(pid, round3((map.get(pid) || 0) + Number(r.quantidade_fiscal || 0)));
  }
  return map;
}

function evidenciasBase({
  pedido = null,
  reserva = null,
  produto = null,
  pedidoQuantidade = null,
  reservaQuantidade = null
} = {}) {
  return {
    pedido_id: pedido?.id ?? reserva?.pedido_id ?? null,
    produto_id: reserva?.produto_id ?? produto?.id ?? null,
    pedido_quantidade: pedidoQuantidade,
    reserva_quantidade: reservaQuantidade != null
      ? reservaQuantidade
      : (reserva != null ? round3(reserva.quantidade_fiscal) : null),
    saldo_fiscal: produto != null ? round3(produto.saldo_fiscal) : null,
    status_pedido: pedido?.status ?? null,
    reserva_id: reserva?.id ?? null,
    data_criacao: pedido?.created_at ?? pedido?.data_pedido ?? null,
    data_reserva: reserva?.criado_em ?? null,
    usuario: pedido?.usuario ?? pedido?.operador_id ?? null
  };
}

/**
 * Executa reconciliação READ-ONLY.
 *
 * @param {{ db?: object, pedidoIds?: number[] }} [opts]
 * @returns {Promise<{ analisados: number, consistentes: number, inconsistencias: object[] }>}
 */
async function reconciliarReservas(opts = {}) {
  const db = getDb(opts.db);
  const inconsistencias = [];
  const pedidosAnalisados = new Set();

  let sqlReservas = `
    SELECT r.id, r.pedido_id, r.produto_id, r.quantidade_fiscal, r.status,
           r.pedido_item_id, r.criado_em
    FROM pedido_estoque_reservas r
    WHERE r.status = 'ATIVA'
  `;
  const paramsReservas = [];
  if (Array.isArray(opts.pedidoIds) && opts.pedidoIds.length) {
    const ids = opts.pedidoIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) {
      sqlReservas += ` AND r.pedido_id IN (${ids.map(() => '?').join(',')})`;
      paramsReservas.push(...ids);
    }
  }
  sqlReservas += ' ORDER BY r.pedido_id, r.produto_id, r.id';

  const reservasAtivas = await dbAll(db, sqlReservas, paramsReservas);

  const pedidosCache = new Map();
  const itensCache = new Map();
  const produtosCache = new Map();

  async function carregarPedido(pedidoId) {
    if (pedidosCache.has(pedidoId)) return pedidosCache.get(pedidoId);
    const row = await dbGet(
      db,
      `SELECT id, status, created_at, data_pedido, operador_id,
              operador_id AS usuario
       FROM pedidos WHERE id = ?`,
      [pedidoId]
    );
    pedidosCache.set(pedidoId, row);
    return row;
  }

  async function carregarItensPedido(pedidoId) {
    if (itensCache.has(pedidoId)) return itensCache.get(pedidoId);
    const rows = await dbAll(
      db,
      `SELECT produto_id, quantidade FROM pedidos_itens WHERE pedido_id = ?`,
      [pedidoId]
    );
    itensCache.set(pedidoId, rows);
    return rows;
  }

  async function carregarProduto(produtoId) {
    if (produtosCache.has(produtoId)) return produtosCache.get(produtoId);
    const row = await dbGet(
      db,
      `SELECT id,
              COALESCE(saldo_fiscal, 0) AS saldo_fiscal,
              COALESCE(reservado_fiscal, 0) AS reservado_fiscal
       FROM produtos WHERE id = ?`,
      [produtoId]
    );
    produtosCache.set(produtoId, row);
    return row;
  }

  const reservasPorPedido = new Map();
  for (const r of reservasAtivas) {
    const pid = Number(r.pedido_id);
    if (!reservasPorPedido.has(pid)) reservasPorPedido.set(pid, []);
    reservasPorPedido.get(pid).push(r);
  }

  for (const [pedidoId, reservas] of reservasPorPedido) {
    pedidosAnalisados.add(pedidoId);

    const pedido = await carregarPedido(pedidoId);

    if (!pedido) {
      for (const r of reservas) {
        const produto = await carregarProduto(Number(r.produto_id));
        inconsistencias.push(inconsistencia({
          ...evidenciasBase({
            reserva: r,
            produto,
            pedidoQuantidade: null,
            reservaQuantidade: round3(r.quantidade_fiscal)
          }),
          pedido_id: pedidoId,
          produto_id: r.produto_id,
          tipo: TipoInconsistencia.RESERVA_ORFA,
          descricao: `Reserva ativa #${r.id} sem pedido correspondente.`,
          encontrado_em: EncontradoEm.RESERVA
        }));
      }
      continue;
    }

    if (String(pedido.status).toUpperCase() === PedidoStatus.CANCELADO) {
      for (const r of reservas) {
        const produto = await carregarProduto(Number(r.produto_id));
        const itensCancel = await carregarItensPedido(pedidoId);
        const qtdPedido = agregarQuantidadesPedido(itensCancel).get(Number(r.produto_id)) ?? null;
        inconsistencias.push(inconsistencia({
          ...evidenciasBase({
            pedido,
            reserva: r,
            produto,
            pedidoQuantidade: qtdPedido,
            reservaQuantidade: round3(r.quantidade_fiscal)
          }),
          tipo: TipoInconsistencia.PEDIDO_CANCELADO_COM_RESERVA_ATIVA,
          descricao: `Pedido cancelado possui reserva ativa #${r.id} (qtd=${round3(r.quantidade_fiscal)}).`,
          encontrado_em: EncontradoEm.PEDIDO
        }));
      }
    }

    const itens = await carregarItensPedido(pedidoId);
    const qtdPedidoPorProduto = agregarQuantidadesPedido(itens);
    const qtdReservaPorProduto = agregarQuantidadesReserva(reservas);
    const reservaPorProduto = new Map();
    for (const r of reservas) {
      const pid = Number(r.produto_id);
      if (!reservaPorProduto.has(pid)) reservaPorProduto.set(pid, []);
      reservaPorProduto.get(pid).push(r);
    }

    for (const r of reservas) {
      const qtd = round3(r.quantidade_fiscal);
      const produto = await carregarProduto(Number(r.produto_id));
      const qtdPedido = qtdPedidoPorProduto.get(Number(r.produto_id)) ?? null;
      const base = evidenciasBase({
        pedido,
        reserva: r,
        produto,
        pedidoQuantidade: qtdPedido,
        reservaQuantidade: qtd
      });

      if (!(qtd > 0)) {
        inconsistencias.push(inconsistencia({
          ...base,
          tipo: TipoInconsistencia.RESERVA_QUANTIDADE_INVALIDA,
          descricao: `Reserva #${r.id} com quantidade inválida (${qtd}).`,
          encontrado_em: EncontradoEm.RESERVA
        }));
      }

      if (!produto) {
        inconsistencias.push(inconsistencia({
          ...base,
          saldo_fiscal: null,
          tipo: TipoInconsistencia.PRODUTO_INEXISTENTE,
          descricao: `Reserva #${r.id} referencia produto inexistente.`,
          encontrado_em: EncontradoEm.ESTOQUE
        }));
      } else if (round3(produto.saldo_fiscal) < 0) {
        inconsistencias.push(inconsistencia({
          ...base,
          tipo: TipoInconsistencia.SALDO_FISCAL_NEGATIVO,
          descricao: `Saldo fiscal negativo (${round3(produto.saldo_fiscal)}) para o produto.`,
          encontrado_em: EncontradoEm.ESTOQUE
        }));
      }
    }

    for (const [produtoId, qtdReservada] of qtdReservaPorProduto) {
      const qtdPedido = qtdPedidoPorProduto.get(produtoId);
      const listaRes = reservaPorProduto.get(produtoId) || [];
      const reservaRef = listaRes[0] || null;
      const produto = await carregarProduto(produtoId);
      const base = evidenciasBase({
        pedido,
        reserva: reservaRef,
        produto,
        pedidoQuantidade: qtdPedido ?? null,
        reservaQuantidade: qtdReservada
      });

      if (qtdPedido == null) {
        inconsistencias.push(inconsistencia({
          ...base,
          produto_id: produtoId,
          tipo: TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO,
          descricao: `Reserva ativa (${qtdReservada}) sem item correspondente no pedido.`,
          encontrado_em: EncontradoEm.RESERVA
        }));
      } else if (qtdReservada > qtdPedido + 1e-9) {
        inconsistencias.push(inconsistencia({
          ...base,
          produto_id: produtoId,
          tipo: TipoInconsistencia.RESERVA_MAIOR_QUE_PEDIDO,
          descricao: `Quantidade reservada (${qtdReservada}) maior que a do pedido (${qtdPedido}).`,
          encontrado_em: EncontradoEm.RESERVA
        }));
      }
    }
  }

  let sqlPedidos = `
    SELECT p.id, p.status, p.created_at, p.data_pedido, p.operador_id,
           p.operador_id AS usuario
    FROM pedidos p
    WHERE UPPER(p.status) IN (${STATUS_COM_RESERVA_ESPERADA.map(() => '?').join(',')})
  `;
  const paramsPedidos = STATUS_COM_RESERVA_ESPERADA.map((s) => String(s));
  if (Array.isArray(opts.pedidoIds) && opts.pedidoIds.length) {
    const ids = opts.pedidoIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length) {
      sqlPedidos += ` AND p.id IN (${ids.map(() => '?').join(',')})`;
      paramsPedidos.push(...ids);
    }
  }

  const pedidosEsperados = await dbAll(db, sqlPedidos, paramsPedidos);

  for (const p of pedidosEsperados) {
    const pedidoId = Number(p.id);
    pedidosAnalisados.add(pedidoId);
    pedidosCache.set(pedidoId, p);

    const reservas = reservasPorPedido.get(pedidoId) || [];
    if (reservas.length === 0) {
      const itens = await carregarItensPedido(pedidoId);
      if (!itens.length) {
        const base = evidenciasBase({ pedido: p, pedidoQuantidade: null });
        inconsistencias.push(inconsistencia({
          ...base,
          pedido_id: pedidoId,
          tipo: TipoInconsistencia.PEDIDO_SEM_RESERVA,
          descricao: `Pedido em status ${p.status} sem reserva fiscal ativa.`,
          encontrado_em: EncontradoEm.PEDIDO
        }));
        inconsistencias.push(inconsistencia({
          ...base,
          pedido_id: pedidoId,
          tipo: TipoInconsistencia.RESERVA_INEXISTENTE,
          descricao: `Reserva fiscal inexistente para pedido #${pedidoId}.`,
          encontrado_em: EncontradoEm.RESERVA
        }));
      } else {
        for (const item of itens) {
          const produto = await carregarProduto(Number(item.produto_id));
          const base = evidenciasBase({
            pedido: p,
            produto,
            pedidoQuantidade: round3(item.quantidade),
            reservaQuantidade: null
          });
          inconsistencias.push(inconsistencia({
            ...base,
            produto_id: item.produto_id,
            tipo: TipoInconsistencia.PEDIDO_SEM_RESERVA,
            descricao: `Pedido em status ${p.status} sem reserva fiscal ativa para o produto.`,
            encontrado_em: EncontradoEm.PEDIDO
          }));
          inconsistencias.push(inconsistencia({
            ...base,
            produto_id: item.produto_id,
            tipo: TipoInconsistencia.RESERVA_INEXISTENTE,
            descricao: `Reserva fiscal inexistente para pedido #${pedidoId} / produto #${item.produto_id}.`,
            encontrado_em: EncontradoEm.RESERVA
          }));
        }
      }
    }
  }

  const pedidosComInconsistencia = new Set(
    inconsistencias
      .map((i) => i.pedido_id)
      .filter((id) => id != null)
  );
  const analisados = pedidosAnalisados.size;
  const consistentes = [...pedidosAnalisados].filter((id) => !pedidosComInconsistencia.has(id)).length;

  return Object.freeze({
    analisados,
    consistentes,
    inconsistencias: Object.freeze(inconsistencias.slice())
  });
}

module.exports = {
  reconciliarReservas,
  TipoInconsistencia,
  EncontradoEm,
  AcaoCorrecao,
  RiscoCorrecao,
  montarPlanoCorrecao,
  STATUS_COM_RESERVA_ESPERADA,
  agregarQuantidadesPedido,
  agregarQuantidadesReserva
};
