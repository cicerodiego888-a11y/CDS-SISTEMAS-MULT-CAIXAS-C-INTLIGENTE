/**
 * EntregaRepository — Sprint 2.1
 * Listagem, agrupamento, dashboard, reservas e timeline (via auditoria).
 */

'use strict';

const db = require('../../database');
const { StatusEntrega, StatusVenda, TipoVenda, normalizarStatusEntrega } = require('./enums');

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

const SELECT_BASE = `
  SELECT
    v.id,
    v.codigo,
    v.data_venda,
    v.created_at,
    v.total,
    v.desconto,
    v.cliente_id,
    c.nome AS cliente_nome,
    v.entregador,
    v.pagamento_previsto,
    v.status_entrega,
    COALESCE(v.status_venda, CASE
      WHEN COALESCE(v.cancelada, 0) = 1 THEN 'CANCELADA'
      WHEN v.status = 'concluida' THEN 'FINALIZADA'
      ELSE 'ABERTA'
    END) AS status_venda,
    v.tipo_venda,
    v.status,
    v.endereco_entrega,
    v.referencia_entrega,
    v.observacao_entrega,
    v.telefone_entrega,
    v.taxa_entrega,
    COALESCE(v.leva_maquineta, 0) AS leva_maquineta,
    COALESCE(v.troco_para, 0) AS troco_para,
    v.prestacao_realizada,
    v.prestado_em,
    v.prestado_por,
    COALESCE(res.reservado_fiscal, 0) AS reservado_fiscal,
    COALESCE(res.reservado_nao_fiscal, 0) AS reservado_nao_fiscal,
    COALESCE(res.reservado_fiscal, 0) + COALESCE(res.reservado_nao_fiscal, 0) AS total_reservado
  FROM vendas v
  LEFT JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN (
    SELECT
      venda_id,
      SUM(CASE WHEN status = 'ATIVA' THEN COALESCE(quantidade_fiscal, 0) ELSE 0 END) AS reservado_fiscal,
      SUM(CASE WHEN status = 'ATIVA' THEN COALESCE(quantidade_nao_fiscal, 0) ELSE 0 END) AS reservado_nao_fiscal
    FROM venda_estoque_reservas
    GROUP BY venda_id
  ) res ON res.venda_id = v.id
  WHERE v.tipo_venda = '${TipoVenda.ENTREGA}'
`;

function enriquecerItem(row) {
  if (!row) return null;
  const statusEntrega = normalizarStatusEntrega(row.status_entrega) || row.status_entrega;
  const total = Number(row.total || 0);
  const trocoPara = Number(row.troco_para || 0);
  const levaTroco = trocoPara > 0;
  const trocoNecessario = levaTroco ? Math.max(0, Number((trocoPara - total).toFixed(2))) : 0;

  return {
    ...row,
    status_entrega: statusEntrega,
    status_venda: row.status_venda || StatusVenda.ABERTA,
    leva_maquineta: Number(row.leva_maquineta || 0) === 1,
    leva_troco: levaTroco,
    troco_para: trocoPara,
    troco_necessario: trocoNecessario,
    reservado_fiscal: Number(row.reservado_fiscal || 0),
    reservado_nao_fiscal: Number(row.reservado_nao_fiscal || 0),
    total_reservado: Number(row.total_reservado || 0)
  };
}

class EntregaRepository {
  async listar({ status, status_venda: statusVenda } = {}) {
    let sql = SELECT_BASE;
    const params = [];

    if (status) {
      const st = normalizarStatusEntrega(status) || String(status).toUpperCase();
      if (st === StatusEntrega.CONCLUIDA) {
        sql += ` AND UPPER(COALESCE(v.status_entrega, '')) IN (?, ?)`;
        params.push(StatusEntrega.CONCLUIDA, 'FINALIZADA');
      } else {
        sql += ' AND UPPER(COALESCE(v.status_entrega, \'\')) = ?';
        params.push(st);
      }
    }

    if (statusVenda) {
      sql += ` AND UPPER(COALESCE(v.status_venda, 'ABERTA')) = ?`;
      params.push(String(statusVenda).toUpperCase());
    }

    sql += ' ORDER BY v.created_at DESC, v.id DESC LIMIT 500';
    const rows = await all(sql, params);
    return rows.map(enriquecerItem);
  }

  async listarPendentes() {
    const rows = await all(
      `${SELECT_BASE}
        AND UPPER(COALESCE(v.status_entrega, '')) IN (?, ?, ?)
        AND COALESCE(v.prestacao_realizada, 0) = 0
        AND COALESCE(v.cancelada, 0) = 0
        AND UPPER(COALESCE(v.status_venda, 'ABERTA')) = ?
        ORDER BY v.created_at DESC
        LIMIT 500`,
      [
        StatusEntrega.AGUARDANDO_ENTREGA,
        StatusEntrega.EM_ENTREGA,
        StatusEntrega.AGUARDANDO_PRESTACAO,
        StatusVenda.ABERTA
      ]
    );
    return rows.map(enriquecerItem);
  }

  async buscarPorVendaId(vendaId) {
    const row = await get(`${SELECT_BASE} AND v.id = ?`, [vendaId]);
    return enriquecerItem(row);
  }

  async atualizarStatusEntrega(vendaId, novoStatus) {
    const st = normalizarStatusEntrega(novoStatus) || novoStatus;
    return run(
      `
        UPDATE vendas
        SET status_entrega = ?
        WHERE id = ?
          AND tipo_venda = ?
          AND COALESCE(cancelada, 0) = 0
      `,
      [st, vendaId, TipoVenda.ENTREGA]
    );
  }

  async atualizarEntrega(vendaId, dados = {}) {
    const campos = [];
    const params = [];
    const map = {
      entregador: 'entregador',
      endereco_entrega: 'endereco_entrega',
      referencia_entrega: 'referencia_entrega',
      observacao_entrega: 'observacao_entrega',
      telefone_entrega: 'telefone_entrega',
      pagamento_previsto: 'pagamento_previsto',
      taxa_entrega: 'taxa_entrega',
      leva_maquineta: 'leva_maquineta',
      troco_para: 'troco_para',
      status_entrega: 'status_entrega',
      status_venda: 'status_venda'
    };

    Object.keys(map).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(dados, key)) {
        let val = dados[key];
        if (key === 'status_entrega') {
          val = normalizarStatusEntrega(val) || val;
        }
        if (key === 'leva_maquineta') {
          val = val === true || val === 1 || val === '1' ? 1 : 0;
        }
        campos.push(`${map[key]} = ?`);
        params.push(val);
      }
    });

    if (!campos.length) {
      return { changes: 0 };
    }

    params.push(vendaId, TipoVenda.ENTREGA);
    return run(
      `UPDATE vendas SET ${campos.join(', ')} WHERE id = ? AND tipo_venda = ?`,
      params
    );
  }

  /**
   * Resumo operacional por status_entrega (dashboard).
   */
  async resumoDashboard() {
    const hoje = new Date();
    const yyyy = hoje.getFullYear();
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    const dd = String(hoje.getDate()).padStart(2, '0');
    const dataHoje = `${yyyy}-${mm}-${dd}`;

    const rows = await all(
      `
        SELECT
          UPPER(COALESCE(status_entrega, '')) AS status_entrega,
          COUNT(*) AS quantidade,
          SUM(CASE
            WHEN date(COALESCE(created_at, data_venda)) = date(?) THEN 1
            ELSE 0
          END) AS quantidade_hoje,
          SUM(CASE
            WHEN date(COALESCE(created_at, data_venda)) = date(?) THEN COALESCE(total, 0)
            ELSE 0
          END) AS valor_hoje,
          SUM(CASE
            WHEN date(COALESCE(created_at, data_venda)) = date(?)
              AND UPPER(COALESCE(status_entrega, '')) IN ('CONCLUIDA', 'FINALIZADA')
              AND prestado_em IS NOT NULL
            THEN (julianday(prestado_em) - julianday(COALESCE(created_at, data_venda))) * 24
            ELSE 0
          END) AS soma_horas_concluidas,
          SUM(CASE
            WHEN date(COALESCE(created_at, data_venda)) = date(?)
              AND UPPER(COALESCE(status_entrega, '')) IN ('CONCLUIDA', 'FINALIZADA')
              AND prestado_em IS NOT NULL
            THEN 1
            ELSE 0
          END) AS qtd_com_tempo
        FROM vendas
        WHERE tipo_venda = ?
        GROUP BY UPPER(COALESCE(status_entrega, ''))
      `,
      [dataHoje, dataHoje, dataHoje, dataHoje, TipoVenda.ENTREGA]
    );

    const mapa = {};
    let entregasHoje = 0;
    let valorTotalHoje = 0;
    let somaHoras = 0;
    let qtdTempo = 0;

    rows.forEach((r) => {
      const st = normalizarStatusEntrega(r.status_entrega) || r.status_entrega || 'DESCONHECIDO';
      mapa[st] = {
        quantidade: Number(r.quantidade || 0),
        quantidade_hoje: Number(r.quantidade_hoje || 0)
      };
      entregasHoje += Number(r.quantidade_hoje || 0);
      valorTotalHoje += Number(r.valor_hoje || 0);
      somaHoras += Number(r.soma_horas_concluidas || 0);
      qtdTempo += Number(r.qtd_com_tempo || 0);
    });

    const getQtd = (st) => Number((mapa[st] && mapa[st].quantidade) || 0);
    const concluidasHoje =
      Number((mapa[StatusEntrega.CONCLUIDA] && mapa[StatusEntrega.CONCLUIDA].quantidade_hoje) || 0) +
      Number((mapa.FINALIZADA && mapa.FINALIZADA.quantidade_hoje) || 0);

    const canceladasHoje = Number((mapa[StatusEntrega.CANCELADA] && mapa[StatusEntrega.CANCELADA].quantidade_hoje) || 0);
    const prestacaoPendente =
      getQtd(StatusEntrega.EM_ENTREGA) + getQtd(StatusEntrega.AGUARDANDO_PRESTACAO);

    return {
      aguardando_entrega: getQtd(StatusEntrega.AGUARDANDO_ENTREGA),
      em_entrega: getQtd(StatusEntrega.EM_ENTREGA),
      aguardando_prestacao: getQtd(StatusEntrega.AGUARDANDO_PRESTACAO),
      concluidas_hoje: concluidasHoje,
      canceladas: getQtd(StatusEntrega.CANCELADA),
      canceladas_hoje: canceladasHoje,
      entregas_hoje: entregasHoje,
      valor_total_hoje: Number(valorTotalHoje.toFixed(2)),
      ticket_medio: entregasHoje > 0 ? Number((valorTotalHoje / entregasHoje).toFixed(2)) : 0,
      tempo_medio_horas: qtdTempo > 0 ? Number((somaHoras / qtdTempo).toFixed(2)) : null,
      prestacao_pendente: prestacaoPendente,
      por_status: mapa
    };
  }

  async listarReservasPorProduto(produtoId) {
    return all(
      `
        SELECT
          r.id,
          r.venda_id,
          r.produto_id,
          r.quantidade_fiscal,
          r.quantidade_nao_fiscal,
          r.status,
          r.criado_em,
          v.codigo,
          v.entregador,
          v.status_entrega,
          v.status_venda,
          c.nome AS cliente_nome
        FROM venda_estoque_reservas r
        INNER JOIN vendas v ON v.id = r.venda_id
        LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE r.produto_id = ?
          AND r.status = 'ATIVA'
        ORDER BY r.criado_em DESC
      `,
      [produtoId]
    );
  }

  async totaisReservados() {
    const row = await get(
      `
        SELECT
          COALESCE(SUM(CASE WHEN r.status = 'ATIVA' THEN r.quantidade_fiscal ELSE 0 END), 0) AS reservado_fiscal,
          COALESCE(SUM(CASE WHEN r.status = 'ATIVA' THEN r.quantidade_nao_fiscal ELSE 0 END), 0) AS reservado_nao_fiscal
        FROM venda_estoque_reservas r
        INNER JOIN vendas v ON v.id = r.venda_id
        WHERE v.tipo_venda = ?
          AND COALESCE(v.cancelada, 0) = 0
      `,
      [TipoVenda.ENTREGA]
    );
    const rf = Number(row?.reservado_fiscal || 0);
    const rnf = Number(row?.reservado_nao_fiscal || 0);
    return {
      reservado_fiscal: rf,
      reservado_nao_fiscal: rnf,
      total_reservado: rf + rnf
    };
  }

  async resumoPorStatus() {
    const rows = await all(
      `
        SELECT
          UPPER(COALESCE(status_entrega, '')) AS status_entrega,
          COUNT(*) AS quantidade,
          COALESCE(SUM(total), 0) AS valor_total
        FROM vendas
        WHERE tipo_venda = ?
        GROUP BY UPPER(COALESCE(status_entrega, ''))
      `,
      [TipoVenda.ENTREGA]
    );
    return rows.map((r) => ({
      status_entrega: normalizarStatusEntrega(r.status_entrega) || r.status_entrega,
      quantidade: Number(r.quantidade || 0),
      valor_total: Number(r.valor_total || 0)
    }));
  }

  async listarAguardandoPrestacao() {
    return this.listar({ status: StatusEntrega.AGUARDANDO_PRESTACAO });
  }

  /**
   * Agrupa pedidos pelo nome do entregador (texto livre).
   * Ordena: quem tem prestação pendente primeiro.
   */
  async agruparPorEntregador({ status } = {}) {
    const items = await this.listar({ status });
    const gruposMap = new Map();

    for (const item of items) {
      const nomeRaw = String(item.entregador || '').trim();
      const chave = nomeRaw ? nomeRaw.toLowerCase() : '__sem_entregador__';
      const label = nomeRaw || 'Sem Entregador';

      if (!gruposMap.has(chave)) {
        gruposMap.set(chave, {
          entregador: label,
          chave,
          quantidade: 0,
          valor_total: 0,
          total_reservado: 0,
          reservado_fiscal: 0,
          reservado_nao_fiscal: 0,
          pendente_prestacao: 0,
          pedidos: []
        });
      }

      const g = gruposMap.get(chave);
      g.quantidade += 1;
      g.valor_total += Number(item.total || 0);
      g.total_reservado += Number(item.total_reservado || 0);
      g.reservado_fiscal += Number(item.reservado_fiscal || 0);
      g.reservado_nao_fiscal += Number(item.reservado_nao_fiscal || 0);
      if (
        item.status_entrega === StatusEntrega.AGUARDANDO_PRESTACAO ||
        (item.status_entrega === StatusEntrega.EM_ENTREGA && !item.prestacao_realizada)
      ) {
        g.pendente_prestacao += 1;
      }
      g.pedidos.push(item);
    }

    const grupos = Array.from(gruposMap.values());
    grupos.sort((a, b) => {
      if (b.pendente_prestacao !== a.pendente_prestacao) {
        return b.pendente_prestacao - a.pendente_prestacao;
      }
      return b.quantidade - a.quantidade;
    });

    grupos.forEach((g) => {
      g.valor_total = Number(g.valor_total.toFixed(2));
      g.total_reservado = Number(g.total_reservado.toFixed(3));
      g.reservado_fiscal = Number(g.reservado_fiscal.toFixed(3));
      g.reservado_nao_fiscal = Number(g.reservado_nao_fiscal.toFixed(3));
    });

    return grupos;
  }

  async listarTimeline(vendaId) {
    try {
      return await all(
        `
          SELECT id, acao, detalhes, usuario_nome, criado_em
          FROM auditoria
          WHERE modulo = 'vendas_entrega'
            AND (
              (referencia_tipo = 'venda' AND CAST(referencia_id AS TEXT) = ?)
              OR (referencia_id IS NOT NULL AND CAST(referencia_id AS TEXT) = ?)
            )
          ORDER BY criado_em ASC, id ASC
        `,
        [String(vendaId), String(vendaId)]
      );
    } catch (_) {
      return [];
    }
  }
}

module.exports = {
  EntregaRepository,
  entregaRepository: new EntregaRepository(),
  enriquecerItem
};
