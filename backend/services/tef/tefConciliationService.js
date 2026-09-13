const db = require('../../database');

async function criarConciliacao(transacaoId, dadosAdquirente = {}) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT *
      FROM tef_transacoes
      WHERE id = ?
    `, [transacaoId], (err, transacao) => {
      if (err) return reject(err);
      if (!transacao) return reject(new Error('Transação não encontrada'));

      const diferenca = dadosAdquirente.valor 
        ? Number(transacao.valor) - Number(dadosAdquirente.valor)
        : 0;

      db.run(`
        INSERT INTO tef_conciliacoes (
          transacao_id,
          nsu,
          autorizacao,
          adquirente,
          bandeira,
          valor,
          status,
          data_transacao,
          data_conciliacao,
          diferenca,
          observacao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transacaoId,
        transacao.nsu,
        transacao.autorizacao,
        dadosAdquirente.adquirente || transacao.adquirente,
        dadosAdquirente.bandeira || transacao.bandeira,
        dadosAdquirente.valor || transacao.valor,
        dadosAdquirente.status || 'conferido',
        transacao.criado_em,
        new Date().toISOString(),
        diferenca,
        dadosAdquirente.observacao || ''
      ], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, diferenca });
      });
    });
  });
}

async function listarConciliacoes(filtros = {}) {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT c.*, t.venda_id
      FROM tef_conciliacoes c
      LEFT JOIN tef_transacoes t ON c.transacao_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.data_inicio) {
      sql += ` AND c.data_transacao >= ?`;
      params.push(filtros.data_inicio);
    }

    if (filtros.data_fim) {
      sql += ` AND c.data_transacao <= ?`;
      params.push(filtros.data_fim);
    }

    if (filtros.status) {
      sql += ` AND c.status = ?`;
      params.push(filtros.status);
    }

    if (filtros.adquirente) {
      sql += ` AND c.adquirente = ?`;
      params.push(filtros.adquirente);
    }

    sql += ` ORDER BY c.data_transacao DESC`;

    if (filtros.limit) {
      sql += ` LIMIT ?`;
      params.push(filtros.limit);
    }

    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function criarFechamento(dataFechamento) {
  return new Promise((resolve, reject) => {
    const dataInicio = `${dataFechamento} 00:00:00`;
    const dataFim = `${dataFechamento} 23:59:59`;

    db.get(`
      SELECT
        COUNT(*) as total_transacoes,
        SUM(CASE WHEN status = 'aprovado' THEN valor ELSE 0 END) as total_aprovado,
        SUM(CASE WHEN status = 'negado' THEN valor ELSE 0 END) as total_negado,
        SUM(CASE WHEN status = 'cancelado' THEN valor ELSE 0 END) as total_cancelado,
        SUM(valor) as total_valor
      FROM tef_transacoes
      WHERE criado_em >= ? AND criado_em <= ?
    `, [dataInicio, dataFim], (err, resultado) => {
      if (err) return reject(err);

      db.run(`
        INSERT INTO tef_fechamentos (
          data_fechamento,
          total_transacoes,
          total_valor,
          total_aprovado,
          total_negado,
          total_cancelado,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        dataFechamento,
        resultado.total_transacoes || 0,
        resultado.total_valor || 0,
        resultado.total_aprovado || 0,
        resultado.total_negado || 0,
        resultado.total_cancelado || 0,
        'concluido'
      ], function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, ...resultado });
      });
    });
  });
}

async function listarFechamentos(filtros = {}) {
  return new Promise((resolve, reject) => {
    let sql = `SELECT * FROM tef_fechamentos WHERE 1=1`;
    const params = [];

    if (filtros.data_inicio) {
      sql += ` AND data_fechamento >= ?`;
      params.push(filtros.data_inicio);
    }

    if (filtros.data_fim) {
      sql += ` AND data_fechamento <= ?`;
      params.push(filtros.data_fim);
    }

    sql += ` ORDER BY data_fechamento DESC`;

    if (filtros.limit) {
      sql += ` LIMIT ?`;
      params.push(filtros.limit);
    }

    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function obterResumoConciliacao(dataInicio, dataFim) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        COUNT(*) as total_conciliacoes,
        SUM(CASE WHEN diferenca = 0 THEN 1 ELSE 0 END) as conciliadas,
        SUM(CASE WHEN diferenca != 0 THEN 1 ELSE 0 END) as divergentes,
        SUM(ABS(diferca)) as total_divergencia
      FROM tef_conciliacoes
      WHERE data_conciliacao >= ? AND data_conciliacao <= ?
    `, [dataInicio, dataFim], (err, row) => {
      if (err) return reject(err);
      resolve(row || {});
    });
  });
}

module.exports = {
  criarConciliacao,
  listarConciliacoes,
  criarFechamento,
  listarFechamentos,
  obterResumoConciliacao
};
