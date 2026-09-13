const db = require('../database');

function obterIpRequisicao(req) {
  if (!req) return null;
  const encaminhado = req.headers?.['x-forwarded-for'];
  if (encaminhado) {
    return String(encaminhado).split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || null;
}

function contextoAuditoriaRequisicao(req) {
  const usuario = req?.user || {};
  return {
    usuario_id: req?.operadorId || usuario.id || usuario.usuario_id || null,
    usuario_nome: usuario.username || usuario.nome || null,
    ip_requisicao: obterIpRequisicao(req)
  };
}

function gravarAuditoria({
  usuario_id = null,
  usuario_nome = null,
  modulo = null,
  acao,
  referencia_tipo = null,
  referencia_id = null,
  detalhes = null,
  ip_requisicao = null
}) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO auditoria (
        usuario_id,
        usuario_nome,
        modulo,
        acao,
        referencia_tipo,
        referencia_id,
        detalhes,
        ip_requisicao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usuario_id,
        usuario_nome,
        modulo,
        acao,
        referencia_tipo,
        referencia_id,
        typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes || {}),
        ip_requisicao || null
      ],
      function (err) {
        if (err) {
          return reject(err);
        }
        resolve({ id: this.lastID });
      }
    );
  });
}

function obterAuditoria({ modulo, acao, usuario_nome, inicio, fim, limite = 100 }) {
  const filtros = [];
  const params = [];

  if (modulo) {
    filtros.push('modulo = ?');
    params.push(modulo);
  }
  if (acao) {
    filtros.push('acao = ?');
    params.push(acao);
  }
  if (usuario_nome) {
    filtros.push('usuario_nome LIKE ?');
    params.push(`%${usuario_nome}%`);
  }
  if (inicio) {
    filtros.push("date(criado_em) >= date(?)");
    params.push(inicio);
  }
  if (fim) {
    filtros.push("date(criado_em) <= date(?)");
    params.push(fim);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const sql = `SELECT * FROM auditoria ${where} ORDER BY criado_em DESC LIMIT ?`;

  return new Promise((resolve, reject) => {
    db.all(sql, [...params, limite], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

module.exports = {
  gravarAuditoria,
  obterAuditoria,
  obterAuditoriaPaginada,
  obterIpRequisicao,
  contextoAuditoriaRequisicao
};

function obterAuditoriaPaginada({ modulo, acao, usuario_nome, inicio, fim, page = 1, pageSize = 50 }) {
  const filtros = [];
  const params = [];

  if (modulo) {
    filtros.push('modulo = ?');
    params.push(modulo);
  }
  if (acao) {
    filtros.push('acao = ?');
    params.push(acao);
  }
  if (usuario_nome) {
    filtros.push('usuario_nome LIKE ?');
    params.push(`%${usuario_nome}%`);
  }
  if (inicio) {
    filtros.push("date(criado_em) >= date(?)");
    params.push(inicio);
  }
  if (fim) {
    filtros.push("date(criado_em) <= date(?)");
    params.push(fim);
  }

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const offset = Math.max(0, (Number(page) - 1)) * Number(pageSize);

  const sqlCount = `SELECT COUNT(*) AS total FROM auditoria ${where}`;
  const sqlRows = `SELECT * FROM auditoria ${where} ORDER BY criado_em DESC LIMIT ? OFFSET ?`;

  return new Promise((resolve, reject) => {
    db.get(sqlCount, params, (errCount, row) => {
      if (errCount) return reject(errCount);
      const total = row?.total || 0;
      db.all(sqlRows, [...params, Number(pageSize), offset], (errRows, rows) => {
        if (errRows) return reject(errRows);
        resolve({ total, page: Number(page), pageSize: Number(pageSize), rows: rows || [] });
      });
    });
  });
}
