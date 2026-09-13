/**
 * EquipamentosRepository — Persistência do Motor de Equipamentos
 *
 * Responsabilidade:
 * - CRUD de equipamentos cadastrados
 * - Consultas por IP, driver e status
 * - Persistência de logs, eventos e fila
 */

const db = require('../../../database');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function whenReady() {
  return new Promise((resolve, reject) => {
    if (typeof db.whenReady === 'function') {
      db.whenReady((err) => (err ? reject(err) : resolve()));
      return;
    }
    resolve();
  });
}

function normalizarEquipamento(row) {
  if (!row) return null;
  return {
    ...row,
    ativo: row.ativo === 1 || row.ativo === '1',
    driver_id: row.driver_id ?? null,
    terminal_id: row.terminal_id ?? null,
    porta_tcp: row.porta_tcp ?? null,
    timeout_ms: row.timeout_ms != null ? Number(row.timeout_ms) : 5000,
    reconnect_auto: row.reconnect_auto === 1 || row.reconnect_auto === '1' || row.reconnect_auto === true,
    ultima_comunicacao: row.ultima_comunicacao ?? null,
    ultimo_erro: row.ultimo_erro ?? null,
    firmware: row.firmware ?? null,
    protocolo_versao: row.protocolo_versao ?? null,
    ultimo_handshake: row.ultimo_handshake ?? null,
    ultimo_sync: row.ultimo_sync ?? null,
    ultimo_ping: row.ultimo_ping ?? null
  };
}

class EquipamentosRepository {
  async listar(filtros = {}) {
    await whenReady();
    let sql = `
      SELECT e.*, d.nome_exibicao AS driver_nome, d.codigo AS driver_codigo_catalogo, d.versao AS driver_versao
      FROM equipamentos e
      LEFT JOIN equipamentos_drivers d ON d.id = e.driver_id
      WHERE 1=1
    `;
    const params = [];

    if (filtros.apenasAtivos) {
      sql += ' AND e.ativo = 1';
    }

    if (filtros.tipo) {
      sql += ' AND e.tipo = ?';
      params.push(String(filtros.tipo));
    }

    if (filtros.status) {
      sql += ' AND e.status = ?';
      params.push(String(filtros.status));
    }

    if (filtros.transporte) {
      sql += ' AND e.transporte = ?';
      params.push(String(filtros.transporte));
    }

    if (filtros.ativo !== undefined && filtros.ativo !== null && filtros.ativo !== '') {
      sql += ' AND e.ativo = ?';
      params.push(filtros.ativo === true || filtros.ativo === '1' || filtros.ativo === 1 ? 1 : 0);
    }

    if (filtros.busca) {
      const termo = `%${String(filtros.busca).trim()}%`;
      sql += ` AND (
        e.nome LIKE ? OR e.fabricante LIKE ? OR e.modelo LIKE ?
        OR e.ip LIKE ? OR e.driver_codigo LIKE ? OR d.nome_exibicao LIKE ?
      )`;
      params.push(termo, termo, termo, termo, termo, termo);
    }

    sql += ' ORDER BY e.nome ASC';

    const rows = await all(sql, params);
    return rows.map(normalizarEquipamento);
  }

  async listarAtivos() {
    return this.listar({ apenasAtivos: true });
  }

  async buscarPorId(id) {
    await whenReady();
    const row = await get(`
      SELECT e.*, d.nome_exibicao AS driver_nome, d.codigo AS driver_codigo_catalogo, d.versao AS driver_versao
      FROM equipamentos e
      LEFT JOIN equipamentos_drivers d ON d.id = e.driver_id
      WHERE e.id = ?
    `, [id]);
    return normalizarEquipamento(row);
  }

  async buscarPorIP(ip) {
    await whenReady();
    if (!ip) return null;
    const row = await get(`
      SELECT e.*, d.nome_exibicao AS driver_nome
      FROM equipamentos e
      LEFT JOIN equipamentos_drivers d ON d.id = e.driver_id
      WHERE e.ip = ? AND e.ativo = 1
      LIMIT 1
    `, [String(ip).trim()]);
    return normalizarEquipamento(row);
  }

  async buscarPorPortaCom(portaCom) {
    await whenReady();
    if (!portaCom) return null;
    const row = await get(`
      SELECT e.*, d.nome_exibicao AS driver_nome
      FROM equipamentos e
      LEFT JOIN equipamentos_drivers d ON d.id = e.driver_id
      WHERE e.porta_com = ? AND e.ativo = 1
      LIMIT 1
    `, [String(portaCom).trim()]);
    return normalizarEquipamento(row);
  }

  async buscarPorDriver(driverRef) {
    await whenReady();
    if (!driverRef) return [];

    const porId = Number(driverRef);
    if (Number.isFinite(porId) && porId > 0) {
      const rows = await all(`
        SELECT e.*, d.nome_exibicao AS driver_nome
        FROM equipamentos e
        LEFT JOIN equipamentos_drivers d ON d.id = e.driver_id
        WHERE e.driver_id = ?
        ORDER BY e.nome ASC
      `, [porId]);
      return rows.map(normalizarEquipamento);
    }

    const rows = await all(`
      SELECT e.*, d.nome_exibicao AS driver_nome
      FROM equipamentos e
      LEFT JOIN equipamentos_drivers d ON d.id = e.driver_id
      WHERE e.driver_codigo = ? OR d.codigo = ?
      ORDER BY e.nome ASC
    `, [String(driverRef), String(driverRef)]);
    return rows.map(normalizarEquipamento);
  }

  async salvar(dados) {
    await whenReady();

    const nome = String(dados.nome || '').trim();
    if (!nome) {
      throw new Error('Nome do equipamento é obrigatório');
    }

    const result = await run(`
      INSERT INTO equipamentos (
        nome, tipo, fabricante, modelo, driver_id, driver_codigo,
        transporte, porta_com, ip, porta_tcp, status, ativo,
        terminal_id, observacao, timeout_ms, reconnect_auto,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      nome,
      dados.tipo || 'balanca',
      dados.fabricante || null,
      dados.modelo || null,
      dados.driver_id || null,
      dados.driver_codigo || null,
      dados.transporte || 'ethernet',
      dados.porta_com || null,
      dados.ip || null,
      dados.porta_tcp ?? require('../drivers/toledo/ToledoProtocol').PORTA_PADRAO,
      dados.status || 'desconhecido',
      dados.ativo === false || dados.ativo === 0 ? 0 : 1,
      dados.terminal_id || null,
      dados.observacao || null,
      dados.timeout_ms != null ? Number(dados.timeout_ms) : 5000,
      dados.reconnect_auto === false || dados.reconnect_auto === 0 ? 0 : 1
    ]);

    return this.buscarPorId(result.lastID);
  }

  async editar(id, dados) {
    await whenReady();

    const existente = await this.buscarPorId(id);
    if (!existente) {
      throw new Error('Equipamento não encontrado');
    }

    await run(`
      UPDATE equipamentos SET
        nome = ?,
        tipo = ?,
        fabricante = ?,
        modelo = ?,
        driver_id = ?,
        driver_codigo = ?,
        transporte = ?,
        porta_com = ?,
        ip = ?,
        porta_tcp = ?,
        status = ?,
        ativo = ?,
        terminal_id = ?,
        observacao = ?,
        timeout_ms = ?,
        reconnect_auto = ?,
        ultima_comunicacao = ?,
        ultimo_erro = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      dados.nome !== undefined ? String(dados.nome).trim() : existente.nome,
      dados.tipo !== undefined ? dados.tipo : existente.tipo,
      dados.fabricante !== undefined ? dados.fabricante : existente.fabricante,
      dados.modelo !== undefined ? dados.modelo : existente.modelo,
      dados.driver_id !== undefined ? dados.driver_id : existente.driver_id,
      dados.driver_codigo !== undefined ? dados.driver_codigo : existente.driver_codigo,
      dados.transporte !== undefined ? dados.transporte : existente.transporte,
      dados.porta_com !== undefined ? dados.porta_com : existente.porta_com,
      dados.ip !== undefined ? dados.ip : existente.ip,
      dados.porta_tcp !== undefined ? dados.porta_tcp : existente.porta_tcp,
      dados.status !== undefined ? dados.status : existente.status,
      dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : (existente.ativo ? 1 : 0),
      dados.terminal_id !== undefined ? dados.terminal_id : existente.terminal_id,
      dados.observacao !== undefined ? dados.observacao : existente.observacao,
      dados.timeout_ms !== undefined ? Number(dados.timeout_ms) : existente.timeout_ms,
      dados.reconnect_auto !== undefined ? (dados.reconnect_auto ? 1 : 0) : (existente.reconnect_auto ? 1 : 0),
      dados.ultima_comunicacao !== undefined ? dados.ultima_comunicacao : existente.ultima_comunicacao,
      dados.ultimo_erro !== undefined ? dados.ultimo_erro : existente.ultimo_erro,
      id
    ]);

    return this.buscarPorId(id);
  }

  async remover(id) {
    await whenReady();
    const existente = await this.buscarPorId(id);
    if (!existente) {
      throw new Error('Equipamento não encontrado');
    }
    await run('DELETE FROM equipamentos WHERE id = ?', [id]);
    return { removido: true, id: Number(id) };
  }

  async listarDriversCatalogo() {
    await whenReady();
    return all(`
      SELECT * FROM equipamentos_drivers
      WHERE ativo = 1
      ORDER BY fabricante ASC, modelo ASC
    `);
  }

  async buscarDriverCatalogoPorCodigo(codigo) {
    await whenReady();
    const raw = String(codigo || '').trim();
    if (!raw) return null;
    let codigoLookup = raw;
    try {
      const identity = require('../sdk/DriverIdentityResolver');
      codigoLookup = identity.canonical(raw) || raw;
    } catch (_) { /* ignore */ }
    let row = await get('SELECT * FROM equipamentos_drivers WHERE codigo = ?', [codigoLookup]);
    if (row) return row;
    if (codigoLookup !== raw) {
      row = await get('SELECT * FROM equipamentos_drivers WHERE codigo = ?', [raw]);
    }
    return row;
  }

  async buscarDriverCatalogoPorId(id) {
    await whenReady();
    return get('SELECT * FROM equipamentos_drivers WHERE id = ?', [id]);
  }

  async gravarLog(registro) {
    await whenReady();
    const result = await run(`
      INSERT INTO equipamentos_logs (equipamento_id, nivel, operacao, mensagem, contexto, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      registro.equipamento_id || null,
      registro.nivel || 'info',
      registro.operacao || null,
      registro.mensagem || '',
      registro.contexto ? JSON.stringify(registro.contexto) : null
    ]);
    return { id: result.lastID };
  }

  async gravarEvento(registro) {
    await whenReady();
    const result = await run(`
      INSERT INTO equipamentos_eventos (equipamento_id, evento, payload, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      registro.equipamento_id || null,
      registro.evento,
      registro.payload ? JSON.stringify(registro.payload) : null
    ]);
    return { id: result.lastID };
  }

  async contarFilaPendente() {
    await whenReady();
    const row = await get(`
      SELECT COUNT(*) AS total FROM equipamentos_fila
      WHERE status IN ('pendente', 'processando')
    `);
    return Number(row?.total || 0);
  }

  // ─── Fila de sincronização ──────────────────────────────────────

  async inserirItemFila(item) {
    await whenReady();
    const result = await run(`
      INSERT INTO equipamentos_fila (
        equipamento_id, comando, payload, status, prioridade, tentativas, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      item.equipamento_id ?? null,
      item.comando,
      item.payload ? JSON.stringify(item.payload) : null,
      item.status || 'pendente',
      item.prioridade ?? 5,
      item.tentativas ?? 0
    ]);
    return { id: result.lastID };
  }

  async listarFila(filtros = {}) {
    await whenReady();
    let sql = 'SELECT * FROM equipamentos_fila WHERE 1=1';
    const params = [];

    if (filtros.status) {
      sql += ' AND status = ?';
      params.push(filtros.status);
    }
    if (filtros.equipamento_id) {
      sql += ' AND equipamento_id = ?';
      params.push(filtros.equipamento_id);
    }

    sql += ' ORDER BY prioridade ASC, created_at ASC';
    if (filtros.limite) {
      sql += ' LIMIT ?';
      params.push(Number(filtros.limite));
    }

    return all(sql, params);
  }

  async obterProximoItemFila() {
    await whenReady();
    return get(`
      SELECT * FROM equipamentos_fila
      WHERE status = 'pendente'
      ORDER BY prioridade ASC, created_at ASC
      LIMIT 1
    `);
  }

  async atualizarStatusFila(id, status, meta = {}) {
    await whenReady();
    await run(`
      UPDATE equipamentos_fila SET
        status = ?,
        tentativas = COALESCE(?, tentativas),
        erro_mensagem = ?,
        processado_em = CASE WHEN ? IN ('concluido', 'erro', 'cancelado') THEN CURRENT_TIMESTAMP ELSE processado_em END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      status,
      meta.tentativas ?? null,
      meta.erro_mensagem ?? null,
      status,
      id
    ]);
  }

  async existeFilaDuplicada(equipamentoId, comando, plu) {
    await whenReady();
    const rows = await all(`
      SELECT id, payload FROM equipamentos_fila
      WHERE equipamento_id = ? AND comando = ? AND status IN ('pendente', 'processando')
    `, [equipamentoId, comando]);

    if (plu === undefined || plu === null) {
      return rows.length > 0;
    }

    return rows.some((row) => {
      try {
        const payload = row.payload ? JSON.parse(row.payload) : {};
        const alvo = payload?.dto?.plu ?? payload?.plu ?? null;
        return String(alvo) === String(plu);
      } catch (_) {
        return false;
      }
    });
  }

  async obterResumoSincronizacoes() {
    await whenReady();
    const [pendentes, concluidas, erros, ultima] = await Promise.all([
      get("SELECT COUNT(*) AS total FROM equipamentos_fila WHERE status IN ('pendente','processando')"),
      get("SELECT COUNT(*) AS total FROM equipamentos_fila WHERE status = 'concluido'"),
      get("SELECT COUNT(*) AS total FROM equipamentos_fila WHERE status = 'erro'"),
      get("SELECT processado_em FROM equipamentos_fila WHERE processado_em IS NOT NULL ORDER BY processado_em DESC LIMIT 1")
    ]);

    return {
      pendentes: Number(pendentes?.total || 0),
      concluidas: Number(concluidas?.total || 0),
      erros: Number(erros?.total || 0),
      ultima_sincronizacao: ultima?.processado_em || null
    };
  }

  async obterResumoDashboard() {
    await whenReady();
    const [totalRow, onlineRow, offlineRow, filaRow] = await Promise.all([
      get('SELECT COUNT(*) AS total FROM equipamentos WHERE ativo = 1'),
      get("SELECT COUNT(*) AS total FROM equipamentos WHERE ativo = 1 AND status = 'online'"),
      get("SELECT COUNT(*) AS total FROM equipamentos WHERE ativo = 1 AND status != 'online'"),
      get("SELECT COUNT(*) AS total FROM equipamentos_fila WHERE status IN ('pendente', 'processando')")
    ]);

    return {
      quantidade: Number(totalRow?.total || 0),
      online: Number(onlineRow?.total || 0),
      offline: Number(offlineRow?.total || 0),
      fila: Number(filaRow?.total || 0),
      pendentes: Number(filaRow?.total || 0)
    };
  }

  async atualizarUltimoTeste(id) {
    await whenReady();
    await run(`
      UPDATE equipamentos SET ultimo_teste = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
  }

  async atualizarUltimoDiagnostico(id) {
    await whenReady();
    await run(`
      UPDATE equipamentos SET ultimo_diagnostico = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
  }

  async atualizarComunicacao(id, { status, ultimoErro = null } = {}) {
    await whenReady();
    await run(`
      UPDATE equipamentos SET
        status = COALESCE(?, status),
        ultima_comunicacao = CURRENT_TIMESTAMP,
        ultimo_erro = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status || null, ultimoErro, id]);
  }

  async duplicar(id) {
    const original = await this.buscarPorId(id);
    if (!original) throw new Error('Equipamento não encontrado');

    return this.salvar({
      nome: `${original.nome} (cópia)`,
      tipo: original.tipo,
      fabricante: original.fabricante,
      modelo: original.modelo,
      driver_id: original.driver_id,
      driver_codigo: original.driver_codigo,
      transporte: original.transporte,
      porta_com: original.porta_com,
      ip: original.ip,
      porta_tcp: original.porta_tcp,
      status: 'desconhecido',
      ativo: original.ativo,
      observacao: original.observacao,
      timeout_ms: original.timeout_ms,
      reconnect_auto: original.reconnect_auto
    });
  }

  async listarLogs(equipamentoId, limite = 50) {
    await whenReady();
    const rows = await all(`
      SELECT * FROM equipamentos_logs
      WHERE equipamento_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [equipamentoId, limite]);
    return rows.map((row) => ({
      ...row,
      contexto: row.contexto ? JSON.parse(row.contexto) : null
    }));
  }

  // Compatibilidade sprint 1
  async criarEquipamento(dados) { return this.salvar(dados); }
  async buscarEquipamentoPorId(id) { return this.buscarPorId(id); }
  async listarEquipamentos() { return this.listarAtivos(); }
  async atualizarEquipamento(id, dados) { return this.editar(id, dados); }
  async removerEquipamento(id) { return this.remover(id); }
}

const equipamentosRepository = new EquipamentosRepository();

module.exports = equipamentosRepository;
