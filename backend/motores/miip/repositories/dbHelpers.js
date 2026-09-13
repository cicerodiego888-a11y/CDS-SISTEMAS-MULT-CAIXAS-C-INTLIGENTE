/**
 * dbHelpers — Utilitários de persistência SQLite para repositories MIIP.
 *
 * Sprint 2.1: helpers de baixo nível — sem regra de negócio.
 *
 * @module motores/miip/repositories/dbHelpers
 */

/**
 * Resolve instância do banco (injeção ou default do CDS).
 *
 * @param {Object|null} db
 * @returns {Object}
 */
function resolverDb(db) {
  return db ?? require('../../../database');
}

/**
 * Cria helpers promisificados para operações SQLite.
 *
 * @param {Object} db
 * @returns {{ whenReady: Function, get: Function, all: Function, run: Function }}
 */
function criarDbHelpers(db) {
  function whenReady() {
    return new Promise((resolve, reject) => {
      if (typeof db.whenReady === 'function') {
        db.whenReady((err) => (err ? reject(err) : resolve()));
        return;
      }
      resolve();
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

  function run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function runCallback(err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  return { whenReady, get, all, run };
}

/**
 * Serializa valor para coluna TEXT/JSON.
 *
 * @param {*} valor
 * @returns {string|null}
 */
function serializarJson(valor) {
  if (valor == null) return null;
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor);
}

/**
 * Desserializa coluna TEXT/JSON.
 *
 * @param {*} valor
 * @returns {*|null}
 */
function deserializarJson(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'object') return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

/**
 * Monta cláusulas SET para UPDATE parcial.
 *
 * @param {Object} dados
 * @param {Record<string, string>} mapa - camelCase → snake_case
 * @param {(key: string, value: *) => *} [transformar]
 * @returns {{ sets: string[], params: *[] }}
 */
function montarCamposUpdate(dados, mapa, transformar) {
  const sets = [];
  const params = [];

  Object.entries(mapa).forEach(([camel, snake]) => {
    if (dados[camel] === undefined) return;
    const valor = transformar ? transformar(camel, dados[camel]) : dados[camel];
    sets.push(`${snake} = ?`);
    params.push(valor);
  });

  return { sets, params };
}

/**
 * Aplica LIMIT/OFFSET em query de listagem.
 *
 * @param {Object} [filtros]
 * @param {number} [filtros.limite]
 * @param {number} [filtros.offset]
 * @returns {{ sql: string, params: number[] }}
 */
function paginacao(filtros = {}) {
  const params = [];
  let sql = '';

  if (Number.isFinite(Number(filtros.limite)) && Number(filtros.limite) > 0) {
    sql += ' LIMIT ?';
    params.push(Number(filtros.limite));
  }

  if (Number.isFinite(Number(filtros.offset)) && Number(filtros.offset) > 0) {
    sql += ' OFFSET ?';
    params.push(Number(filtros.offset));
  }

  return { sql, params };
}

module.exports = {
  resolverDb,
  criarDbHelpers,
  serializarJson,
  deserializarJson,
  montarCamposUpdate,
  paginacao
};
