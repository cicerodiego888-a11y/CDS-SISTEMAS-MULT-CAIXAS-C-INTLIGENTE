/**
 * Sprint 14.11 — ToledoConfigurationEngine
 * Configuração via Operation Engine → Driver → ConnectionManager.
 */

'use strict';

const mapper = require('./ToledoConfigurationMapper');
const validator = require('./ToledoConfigurationValidator');
const profileMod = require('./ToledoConfigurationProfile');
const ToledoConfigurationRepository = require('./ToledoConfigurationRepository');
const ToledoConfigurationOperation = require('./ToledoConfigurationOperation');
const { ConfigurationError, CODES } = require('./ToledoConfigurationErrors');
const { ToledoOperationEngine } = require('../operations/ToledoOperationEngine');
const OperationContext = require('../operations/OperationContext');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[config-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[config-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoConfigurationEngine {
  constructor(deps = {}) {
    this.repository = deps.repository || new ToledoConfigurationRepository();
    this.operationEngine = deps.operationEngine || null;
    this._driverFactory = deps.driverFactory || null;
    this._engineFactory = deps.engineFactory || (() => new ToledoOperationEngine({
      persistir: deps.persistir !== false,
      driverFactory: this._driverFactory,
      drivers: deps.drivers
    }));
    this._lastRead = null;
    this._status = { running: false, phase: 'idle', last: null };
  }

  _engine() {
    if (!this.operationEngine) {
      this.operationEngine = this._engineFactory();
    }
    return this.operationEngine;
  }

  status() {
    return { ...this._status, lastRead: this._lastRead };
  }

  listParams(opcoes = {}) {
    return profileMod.listSupportedParams(opcoes);
  }

  async _enqueue(mode, { host, porta, parametros, timeout, persistir }) {
    const engine = this._engine();
    const chave = `${host}:${porta}`;
    const { withBusy, OP_BUSY } = require('../../../connection/SessionBusy');
    return withBusy({ host, porta }, OP_BUSY.CONFIG, () => engine.queue.enqueue(chave, async () => {
      const driver = await engine._ensureDriver(host, porta, { persistir });
      const op = new ToledoConfigurationOperation({
        mode,
        parametros,
        timeout
      });
      const ctx = new OperationContext({
        host,
        porta,
        driver,
        connection: { host, porta, via: 'ConnectionManager' }
      });
      return op.execute(ctx);
    }));
  }

  /**
   * Lê configuração da balança.
   */
  async read(opcoes = {}) {
    const log = getLogger();
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    if (!host || !porta) {
      throw ConfigurationError.fromCode(CODES.INVALID_INPUT, 'host e porta obrigatórios', {
        statusCode: 400
      });
    }

    this._status = { running: true, phase: 'read', last: this._status.last };
    await log.info('Leitura iniciada', {
      operacao: 'config_v1',
      contexto: { host, porta }
    });

    try {
      const result = await this._enqueue('read', {
        host,
        porta,
        timeout: opcoes.timeout,
        persistir: opcoes.persistir
      });

      if (!result.success) {
        throw ConfigurationError.fromCode(
          CODES.READ_FAILED,
          result.error || 'Falha na leitura de configuração',
          { statusCode: 502 }
        );
      }

      const data = result.data || {};
      const cfg = mapper.toCds({
        modelo: data.modelo,
        firmware: data.firmware,
        parametros: data.parametros
      });

      await log.info('Parâmetros recebidos', {
        operacao: 'config_v1',
        contexto: { keys: Object.keys(cfg.parametros) }
      });

      this._lastRead = cfg;
      this._status = { running: false, phase: 'read_ok', last: cfg };

      let profileId = null;
      if (opcoes.persistir !== false && opcoes.salvarPerfil !== false) {
        profileId = await this.repository.salvarPerfil({
          equipamento_id: opcoes.equipamento_id,
          nome: opcoes.nomePerfil || `Leitura ${new Date().toISOString()}`,
          firmware: cfg.firmware,
          modelo: cfg.modelo,
          parametros: cfg.parametros,
          usuario: opcoes.usuario,
          host,
          porta
        });
      }

      return {
        success: true,
        ...cfg,
        meta: profileMod.listSupportedParams({ firmware: cfg.firmware, modelo: cfg.modelo }),
        profileId,
        duration: result.duration
      };
    } catch (err) {
      this._status = { running: false, phase: 'error', last: this._status.last };
      throw err;
    }
  }

  /**
   * Escreve parâmetros editáveis na balança.
   */
  async write(opcoes = {}) {
    const log = getLogger();
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;
    if (!host || !porta) {
      throw ConfigurationError.fromCode(CODES.INVALID_INPUT, 'host e porta obrigatórios', {
        statusCode: 400
      });
    }

    const mapped = mapper.toToledo(opcoes.config || opcoes.parametros || opcoes);
    const writable = validator.filterWritable(mapped.parametros);
    validator.assertValid(writable, { writing: true, onlyEditable: true });

    if (!Object.keys(writable).length) {
      throw ConfigurationError.fromCode(CODES.INVALID_INPUT, 'Nenhum parâmetro editável informado', {
        statusCode: 400
      });
    }

    this._status = { running: true, phase: 'write', last: this._status.last };

    const anterior = this._lastRead ? { ...this._lastRead.parametros } : {};

    try {
      const result = await this._enqueue('write', {
        host,
        porta,
        parametros: writable,
        timeout: opcoes.timeout,
        persistir: opcoes.persistir
      });

      if (!result.success) {
        throw ConfigurationError.fromCode(
          CODES.WRITE_FAILED,
          result.error || 'Falha na escrita de configuração',
          { statusCode: 502 }
        );
      }

      const data = result.data || {};
      const atualizado = mapper.toCds({
        modelo: data.modelo || mapped.modelo,
        firmware: data.firmware || mapped.firmware,
        parametros: { ...(this._lastRead && this._lastRead.parametros), ...writable, ...(data.parametros || {}) }
      });

      await log.info('Alteração aplicada', {
        operacao: 'config_v1',
        contexto: { keys: Object.keys(writable) }
      });

      let profileId = null;
      if (opcoes.persistir !== false) {
        profileId = await this.repository.salvarPerfil({
          equipamento_id: opcoes.equipamento_id,
          nome: opcoes.nomePerfil || `Aplicado ${new Date().toISOString()}`,
          firmware: atualizado.firmware,
          modelo: atualizado.modelo,
          parametros: atualizado.parametros,
          usuario: opcoes.usuario,
          host,
          porta
        });

        for (const [parametro, valorNovo] of Object.entries(writable)) {
          await this.repository.registrarHistorico({
            profile_id: profileId,
            parametro,
            valor_anterior: anterior[parametro] != null ? anterior[parametro] : null,
            valor_novo: valorNovo,
            host,
            porta,
            usuario: opcoes.usuario
          });
        }

        await log.info('Histórico salvo', {
          operacao: 'config_v1',
          contexto: { profileId, count: Object.keys(writable).length }
        });
      }

      this._lastRead = atualizado;
      this._status = { running: false, phase: 'write_ok', last: atualizado };

      return {
        success: true,
        parametros: atualizado.parametros,
        escritos: writable,
        profileId,
        duration: result.duration
      };
    } catch (err) {
      this._status = { running: false, phase: 'error', last: this._status.last };
      throw err;
    }
  }

  /**
   * Compara CDS × Balança (ou dois objetos).
   */
  async compare(opcoes = {}) {
    const log = getLogger();
    let balanca = opcoes.balanca || opcoes.atual;

    if (!balanca && (opcoes.host || opcoes.ip)) {
      const lido = await this.read({
        ...opcoes,
        persistir: false,
        salvarPerfil: false
      });
      balanca = lido;
    }

    if (!balanca && this._lastRead) balanca = this._lastRead;

    const cds = mapper.toToledo(opcoes.cds || opcoes.proposto || opcoes.config || {});
    if (!balanca) {
      throw ConfigurationError.fromCode(
        CODES.INVALID_INPUT,
        'Informe configuração da balança ou execute read antes',
        { statusCode: 400 }
      );
    }

    const comparacao = mapper.diff(balanca, cds);
    await log.info('Comparação', {
      operacao: 'config_v1',
      contexto: { alterados: comparacao.alterados.length, iguais: comparacao.iguais }
    });

    return {
      success: true,
      comparacao,
      cds,
      balanca: mapper.toCds(balanca)
    };
  }

  /**
   * Restaura perfil salvo.
   */
  async restore(opcoes = {}) {
    const profileId = opcoes.profileId || opcoes.profile_id || opcoes.id;
    if (!profileId) {
      throw ConfigurationError.fromCode(CODES.INVALID_INPUT, 'profileId obrigatório', {
        statusCode: 400
      });
    }
    const perfil = await this.repository.buscarPerfil(profileId);
    if (!perfil) {
      throw ConfigurationError.fromCode(CODES.PROFILE_NOT_FOUND, 'Perfil não encontrado', {
        statusCode: 404
      });
    }

    return this.write({
      host: opcoes.host || perfil.host,
      porta: opcoes.porta != null ? opcoes.porta : perfil.porta,
      equipamento_id: opcoes.equipamento_id || perfil.equipamento_id,
      parametros: perfil.parametros,
      usuario: opcoes.usuario,
      nomePerfil: `Restore: ${perfil.nome}`,
      persistir: opcoes.persistir !== false,
      timeout: opcoes.timeout
    });
  }

  /**
   * Exporta perfil (JSON).
   */
  async export(opcoes = {}) {
    if (opcoes.profileId || opcoes.profile_id) {
      const perfil = await this.repository.buscarPerfil(opcoes.profileId || opcoes.profile_id);
      if (!perfil) {
        throw ConfigurationError.fromCode(CODES.PROFILE_NOT_FOUND, 'Perfil não encontrado', {
          statusCode: 404
        });
      }
      return {
        success: true,
        perfil: profileMod.createProfile({
          nome: perfil.nome,
          firmware: perfil.firmware,
          modelo: perfil.modelo,
          parametros: perfil.parametros
        })
      };
    }

    const base = opcoes.config || this._lastRead;
    if (!base) {
      throw ConfigurationError.fromCode(CODES.INVALID_INPUT, 'Nada para exportar', {
        statusCode: 400
      });
    }
    return {
      success: true,
      perfil: profileMod.createProfile({
        nome: opcoes.nome || base.nome || 'Export',
        firmware: base.firmware,
        modelo: base.modelo,
        parametros: base.parametros || base
      })
    };
  }

  /**
   * Importa perfil (objeto) — não aplica automaticamente.
   */
  async import(payload = {}) {
    const perfil = profileMod.createProfile({
      nome: payload.nome || (payload.perfil && payload.perfil.nome) || 'Importado',
      firmware: payload.firmware || (payload.perfil && payload.perfil.firmware),
      modelo: payload.modelo || (payload.perfil && payload.perfil.modelo),
      parametros: payload.parametros
        || (payload.perfil && payload.perfil.parametros)
        || payload
    });
    validator.assertValid(perfil.parametros, { writing: false });

    let profileId = null;
    if (payload.persistir !== false) {
      profileId = await this.repository.salvarPerfil({
        equipamento_id: payload.equipamento_id,
        nome: perfil.nome,
        firmware: perfil.firmware,
        modelo: perfil.modelo,
        parametros: perfil.parametros,
        usuario: payload.usuario,
        host: payload.host,
        porta: payload.porta
      });
    }

    return { success: true, perfil, profileId };
  }

  async history(filtros) {
    return this.repository.historico(filtros);
  }

  async listProfiles(filtros) {
    return this.repository.listarPerfis(filtros);
  }
}

const toledoConfigurationEngine = new ToledoConfigurationEngine();

module.exports = toledoConfigurationEngine;
module.exports.ToledoConfigurationEngine = ToledoConfigurationEngine;
module.exports.toledoConfigurationEngine = toledoConfigurationEngine;
