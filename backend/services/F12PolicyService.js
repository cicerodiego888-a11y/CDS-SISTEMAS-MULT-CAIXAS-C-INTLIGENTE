/**
 * F12 POLICY SERVICE
 *
 * Modelo oficial:
 *   f12_controle = OPERADOR | ADMINISTRADOR
 *   f12_escopo_admin = TODOS | INDIVIDUAL (quando ADMINISTRADOR)
 *
 * Compatibilidade:
 *   POR_CAIXA   ↔ OPERADOR
 *   GLOBAL      ↔ ADMINISTRADOR + TODOS
 *   MODO_ADMIN  ↔ ADMINISTRADOR + INDIVIDUAL
 */

const db = require('../database');
const {
  mapearPoliticaLegadaParaModelo,
  mapearModeloParaPoliticaLegada,
  normalizarModeloControle,
  resolverEstadoEfetivoF12,
  resolverPodeAlterarF12,
  podeOperadorAlterarF12Compat,
  autorizarToggleF12,
  temPermissaoTotalF12
} = require('../lib/f12ModeloControle');

function upsertConfig(chave, valor, tipo, descricao, callback) {
  db.run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
     VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(chave) DO UPDATE SET
       valor = ?,
       updated_at = datetime('now', 'localtime')`,
    [chave, valor, tipo, descricao, valor],
    callback
  );
}

class F12PolicyService {
  static obterModeloControle(callback) {
    db.all(
      `SELECT chave, valor FROM configuracoes
       WHERE chave IN ('f12_controle', 'f12_escopo_admin', 'f12_politica', 'f12_global_ativo')`,
      [],
      (err, rows) => {
        if (err) return callback(err);

        const configs = {};
        (rows || []).forEach((row) => {
          if (row && row.chave) configs[row.chave] = row.valor;
        });

        let controle = String(configs.f12_controle || '').toUpperCase();
        let escopo = String(configs.f12_escopo_admin || '').toUpperCase();

        if (controle !== 'OPERADOR' && controle !== 'ADMINISTRADOR') {
          const mapped = mapearPoliticaLegadaParaModelo(configs.f12_politica);
          controle = mapped.controle;
          escopo = mapped.escopo;
        } else if (controle === 'OPERADOR') {
          escopo = null;
        } else if (escopo !== 'TODOS' && escopo !== 'INDIVIDUAL') {
          escopo = 'TODOS';
        }

        const globalAtivo = configs.f12_global_ativo === '1' || configs.f12_global_ativo === true;
        callback(null, { controle, escopo, globalAtivo });
      }
    );
  }

  static definirModeloControle(controle, escopo, callback) {
    const normalizado = normalizarModeloControle(controle, escopo);
    if (!normalizado.ok) {
      return callback(new Error(normalizado.erro));
    }

    const politicaLegada = mapearModeloParaPoliticaLegada(normalizado.controle, normalizado.escopo);
    const escopoValor = normalizado.escopo || '';

    upsertConfig(
      'f12_controle',
      normalizado.controle,
      'string',
      'Controle F12: OPERADOR | ADMINISTRADOR',
      (cErr) => {
        if (cErr) return callback(cErr);
        upsertConfig(
          'f12_escopo_admin',
          escopoValor,
          'string',
          'Escopo admin F12: TODOS | INDIVIDUAL',
          (eErr) => {
            if (eErr) return callback(eErr);
            upsertConfig(
              'f12_politica',
              politicaLegada,
              'string',
              'Política F12 (compatibilidade legada)',
              (pErr) => callback(pErr || null)
            );
          }
        );
      }
    );
  }

  /**
   * Contexto completo para o PDV / admin.
   * @param {number} caixaId
   * @param {object} user
   * @param {Function} callback
   */
  static resolverContextoF12(caixaId, user, callback) {
    const id = Number(caixaId) || null;

    this.obterModeloControle((modeloErr, modelo) => {
      if (modeloErr) return callback(modeloErr);

      const { controle, escopo, globalAtivo } = modelo;
      const podeAlterar = resolverPodeAlterarF12({
        controle,
        user,
        caixaId: id
      });
      const politicaLegada = mapearModeloParaPoliticaLegada(controle, escopo);
      const base = {
        caixaId: id,
        controle,
        escopo,
        podeAlterar,
        politicaLegada
      };

      if (controle === 'ADMINISTRADOR' && escopo === 'TODOS') {
        return callback(null, {
          ...base,
          ativo: resolverEstadoEfetivoF12({
            controle,
            escopo,
            globalAtivo,
            caixaAtivo: false
          })
        });
      }

      if (!id) {
        return callback(null, { ...base, ativo: false });
      }

      db.get(
        `SELECT f12_ativo FROM caixas WHERE id = ?`,
        [id],
        (caixaErr, caixaRow) => {
          if (caixaErr) return callback(caixaErr);
          const caixaAtivo = !!(caixaRow && (
            caixaRow.f12_ativo === 1 || caixaRow.f12_ativo === '1' || caixaRow.f12_ativo === true
          ));
          callback(null, {
            ...base,
            ativo: resolverEstadoEfetivoF12({
              controle,
              escopo,
              globalAtivo,
              caixaAtivo
            })
          });
        }
      );
    });
  }

  static resolveF12Estado(caixaId, callback) {
    this.resolverContextoF12(caixaId, null, (err, contexto) => {
      if (err) return callback(err);
      callback(null, !!(contexto && contexto.ativo));
    });
  }

  static obterPolitica(callback) {
    this.obterModeloControle((err, modelo) => {
      if (err) return callback(err);
      callback(null, mapearModeloParaPoliticaLegada(modelo.controle, modelo.escopo));
    });
  }

  static definirPolitica(politica, callback) {
    const valor = String(politica || '').toUpperCase().trim();
    if (!['POR_CAIXA', 'GLOBAL', 'MODO_ADMIN'].includes(valor)) {
      return callback(new Error(`Política inválida: ${valor}`));
    }
    const modelo = mapearPoliticaLegadaParaModelo(valor);
    this.definirModeloControle(modelo.controle, modelo.escopo, callback);
  }

  static obterEstadoGlobal(callback) {
    db.get(
      `SELECT valor FROM configuracoes WHERE chave = 'f12_global_ativo'`,
      [],
      (err, row) => {
        if (err) return callback(err);
        const ativo = row?.valor === '1' || row?.valor === true;
        callback(null, ativo);
      }
    );
  }

  static definirEstadoGlobal(ativo, callback) {
    const valor = ativo ? '1' : '0';
    db.run(
      `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
       VALUES ('f12_global_ativo', ?, 'boolean', 'Estado global F12 (ADMINISTRADOR + TODOS)', datetime('now', 'localtime'))
       ON CONFLICT(chave) DO UPDATE SET
         valor = ?,
         updated_at = datetime('now', 'localtime')`,
      [valor, valor],
      callback
    );
  }

  static obterEstadoCaixa(caixaId, callback) {
    db.get(
      `SELECT f12_ativo FROM caixas WHERE id = ?`,
      [caixaId],
      (err, row) => {
        if (err) return callback(err);
        if (!row) return callback(new Error('Caixa não encontrado'));
        const ativo = row.f12_ativo === 1 || row.f12_ativo === '1' || row.f12_ativo === true;
        callback(null, ativo);
      }
    );
  }

  static definirEstadoCaixa(caixaId, ativo, callback) {
    const valor = ativo ? 1 : 0;
    db.run(
      `UPDATE caixas SET f12_ativo = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [valor, caixaId],
      function (err) {
        if (err) return callback(err);
        if (this.changes === 0) return callback(new Error('Caixa não encontrado'));
        callback(null);
      }
    );
  }

  static alternarEstadoCaixa(caixaId, callback) {
    db.get(
      `SELECT f12_ativo FROM caixas WHERE id = ?`,
      [caixaId],
      (getErr, row) => {
        if (getErr) return callback(getErr);
        if (!row) return callback(new Error('Caixa não encontrado'));

        const estadoAtual = row.f12_ativo === 1 || row.f12_ativo === '1' || row.f12_ativo === true;
        const novoEstado = !estadoAtual;

        this.definirEstadoCaixa(caixaId, novoEstado, (defErr) => {
          if (defErr) return callback(defErr);
          callback(null, novoEstado);
        });
      }
    );
  }

  static listarCaixasComEstado(callback) {
    db.all(
      `SELECT id, nome, descricao, f12_ativo, ativo FROM caixas ORDER BY id ASC`,
      [],
      callback
    );
  }

  static podeOperadorAlterarF12(politica, user) {
    return podeOperadorAlterarF12Compat(politica, user);
  }

  static podeAlterarViaTeclaF12(controle, user, caixaId) {
    return resolverPodeAlterarF12({ controle, user, caixaId });
  }

  static temPermissaoTotalF12(user) {
    return temPermissaoTotalF12(user);
  }

  /**
   * Fluxo oficial da tecla F12.
   * SUPER_ADMIN: sempre. ADMIN: nunca por esta rota. OPERADOR: só o próprio caixa.
   */
  static executarToggleF12(caixaId, user, callback) {
    this.resolverContextoF12(caixaId, user, (ctxErr, contexto) => {
      if (ctxErr) return callback(ctxErr);

      const auth = autorizarToggleF12(user, contexto);
      if (!auth.ok) return callback(auth.erro);

      if (auth.acao === 'GLOBAL') {
        const novoEstado = !contexto.ativo;
        return this.definirEstadoGlobal(novoEstado, (defErr) => {
          if (defErr) return callback(defErr);
          callback(null, { novoEstado, origem: 'GLOBAL', caixaId: contexto.caixaId });
        });
      }

      this.alternarEstadoCaixa(caixaId, (altErr, novoEstado) => {
        if (altErr) return callback(altErr);
        callback(null, { novoEstado, origem: 'CAIXA', caixaId });
      });
    });
  }
}

module.exports = F12PolicyService;
