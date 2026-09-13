const db = require('../../database');
const tefEvents = require('./tefEvents');

async function obterStatusMonitor() {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT COUNT(*) as total
      FROM tef_transacoes
      WHERE criado_em >= datetime('now', '-1 hour')
    `, [], (err, row) => {
      if (err) return reject(err);

      db.get(`
        SELECT COUNT(*) as erros
        FROM tef_transacoes
        WHERE status = 'negado'
          AND criado_em >= datetime('now', '-1 hour')
      `, [], (err2, row2) => {
        if (err2) return reject(err2);

        db.get(`
          SELECT nsu
          FROM tef_transacoes
          WHERE status = 'aprovado'
          ORDER BY criado_em DESC
          LIMIT 1
        `, [], (err3, row3) => {
          if (err3) return reject(err3);

          db.get(`
            SELECT COUNT(*) as pendencias
            FROM tef_transacoes
            WHERE status = 'pendente'
              AND criado_em >= datetime('now', '-5 minutes')
          `, [], (err4, row4) => {
            if (err4) return reject(err4);

            db.get(`
              SELECT COUNT(*) as reversoes
              FROM tef_transacoes
              WHERE status = 'cancelado'
                AND atualizado_em >= datetime('now', '-1 hour')
            `, [], (err5, row5) => {
              if (err5) return reject(err5);

              resolve({
                transacoes_ultima_hora: row?.total || 0,
                erros_ultima_hora: row2?.erros || 0,
                ultimo_nsu: row3?.nsu || null,
                pendencias: row4?.pendencias || 0,
                reversoes_ultima_hora: row5?.reversoes || 0,
                timestamp: new Date().toISOString()
              });
            });
          });
        });
      });
    });
  });
}

async function obterErrosRecentes(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, nsu, status, criado_em
      FROM tef_transacoes
      WHERE status = 'negado' OR status = 'erro'
      ORDER BY criado_em DESC
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function verificarStatusPinpad() {
  try {
    const config = await new Promise((resolve, reject) => {
      db.get(`
        SELECT p.*
        FROM tef_pinpads p
        INNER JOIN tef_configuracao c ON p.tef_configuracao_id = c.id
        WHERE c.habilitado = 1
        LIMIT 1
      `, [], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!config) {
      return { habilitado: false, status: 'não configurado' };
    }

    const habilitado = Boolean(config.habilitado);
    const configurado = Boolean(config.porta_com || config.ip || config.serial);

    tefEvents.emitirPinpadStatus(configurado ? 'online' : 'offline', {
      fabricante: config.fabricante,
      modelo: config.modelo
    });

    return {
      habilitado,
      configurado,
      status: config.status || 'desconhecido',
      fabricante: config.fabricante,
      modelo: config.modelo,
      ultima_conexao: config.ultima_conexao
    };
  } catch (error) {
    console.error('Erro ao verificar status PinPad:', error);
    return { habilitado: false, status: 'erro', erro: error.message };
  }
}

async function verificarStatusServidor() {
  try {
    const config = await new Promise((resolve, reject) => {
      db.get(`
        SELECT s.*
        FROM tef_servidores s
        INNER JOIN tef_configuracao c ON s.tef_configuracao_id = c.id
        WHERE c.habilitado = 1
        LIMIT 1
      `, [], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    if (!config) {
      return { configurado: false, status: 'não configurado' };
    }

    const configurado = Boolean(config.base_url || config.ip || config.client_id);

    tefEvents.emitirServidorStatus(configurado ? 'online' : 'offline', {
      base_url: config.base_url,
      ip: config.ip
    });

    return {
      configurado,
      base_url: config.base_url,
      ip: config.ip,
      porta: config.porta
    };
  } catch (error) {
    console.error('Erro ao verificar status Servidor:', error);
    return { configurado: false, status: 'erro', erro: error.message };
  }
}

async function iniciarMonitoramento() {
  const INTERVALO_VERIFICACAO = 30 * 1000; // 30 segundos

  setInterval(async () => {
    try {
      await verificarStatusPinpad();
      await verificarStatusServidor();
    } catch (error) {
      console.error('Erro no monitoramento TEF:', error);
    }
  }, INTERVALO_VERIFICACAO);
}

module.exports = {
  obterStatusMonitor,
  obterErrosRecentes,
  verificarStatusPinpad,
  verificarStatusServidor,
  iniciarMonitoramento
};
