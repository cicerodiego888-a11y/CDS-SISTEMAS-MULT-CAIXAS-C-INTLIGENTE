/**
 * Alertas operacionais — Vendas para Entrega (Sprint 3.1)
 */

'use strict';

const db = require('../../database');
const configService = require('../configuracaoService');
const { TipoVenda, StatusEntrega } = require('./enums');

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function obterLimites() {
  const cfg = configService.readConfig();
  return {
    horasAguardando: Math.max(1, Number(cfg.entrega_alerta_horas_aguardando || 2)),
    horasReserva: Math.max(1, Number(cfg.entrega_alerta_horas_reserva || 4)),
    horasParado: Math.max(1, Number(cfg.entrega_alerta_horas_parado || 3))
  };
}

/**
 * Gera alertas operacionais com base em tempo configurável.
 */
async function listarAlertas() {
  const limites = obterLimites();

  const rows = await all(
    `
      SELECT
        v.id,
        v.codigo,
        v.entregador,
        v.status_entrega,
        v.total,
        v.created_at,
        v.data_venda,
        c.nome AS cliente_nome,
        (julianday('now', 'localtime') - julianday(COALESCE(v.created_at, v.data_venda))) * 24 AS horas
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.tipo_venda = ?
        AND COALESCE(v.cancelada, 0) = 0
        AND COALESCE(v.prestacao_realizada, 0) = 0
        AND COALESCE(v.status_venda, 'ABERTA') = 'ABERTA'
        AND UPPER(COALESCE(v.status_entrega, '')) IN (?, ?, ?)
    `,
    [
      TipoVenda.ENTREGA,
      StatusEntrega.AGUARDANDO_ENTREGA,
      StatusEntrega.EM_ENTREGA,
      StatusEntrega.AGUARDANDO_PRESTACAO
    ]
  );

  const alertas = [];

  for (const row of rows) {
    const horas = Number(row.horas || 0);

    if (row.status_entrega === StatusEntrega.AGUARDANDO_ENTREGA && horas >= limites.horasAguardando) {
      alertas.push({
        tipo: 'AGUARDANDO_LONGO',
        severidade: 'warning',
        mensagem: `Entrega #${row.id} aguardando há mais de ${limites.horasAguardando}h`,
        venda_id: row.id,
        horas: Number(horas.toFixed(1)),
        entregador: row.entregador,
        cliente_nome: row.cliente_nome
      });
    }

    if (
      (row.status_entrega === StatusEntrega.EM_ENTREGA
        || row.status_entrega === StatusEntrega.AGUARDANDO_PRESTACAO)
      && horas >= 0
    ) {
      alertas.push({
        tipo: 'PRESTACAO_PENDENTE',
        severidade: 'info',
        mensagem: `Prestação pendente — pedido #${row.id}`,
        venda_id: row.id,
        horas: Number(horas.toFixed(1)),
        entregador: row.entregador,
        cliente_nome: row.cliente_nome
      });
    }

    if (horas >= limites.horasReserva) {
      alertas.push({
        tipo: 'RESERVA_ANTIGA',
        severidade: 'warning',
        mensagem: `Reserva antiga no pedido #${row.id} (${horas.toFixed(0)}h)`,
        venda_id: row.id,
        horas: Number(horas.toFixed(1)),
        entregador: row.entregador
      });
    }

    if (row.status_entrega === StatusEntrega.EM_ENTREGA && horas >= limites.horasParado) {
      alertas.push({
        tipo: 'PEDIDO_PARADO',
        severidade: 'danger',
        mensagem: `Pedido #${row.id} parado em entrega há ${limites.horasParado}h+`,
        venda_id: row.id,
        horas: Number(horas.toFixed(1)),
        entregador: row.entregador
      });
    }
  }

  // Deduplicar por venda+tipo
  const seen = new Set();
  const unicos = [];
  for (const a of alertas) {
    const key = `${a.tipo}:${a.venda_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unicos.push(a);
  }

  unicos.sort((a, b) => (b.horas || 0) - (a.horas || 0));

  return {
    sprint: '3.1',
    limites,
    total: unicos.length,
    items: unicos
  };
}

module.exports = {
  listarAlertas,
  obterLimites
};
