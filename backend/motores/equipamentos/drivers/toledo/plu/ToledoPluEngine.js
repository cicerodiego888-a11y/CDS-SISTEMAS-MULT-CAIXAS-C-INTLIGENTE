/**
 * Sprint 14.7 — ToledoPluEngine
 * Upload de PLUs via Operation Engine → Driver → ConnectionManager.
 */

'use strict';

const mapper = require('./ToledoPluMapper');
const validator = require('./ToledoPluValidator');
const builder = require('./ToledoPluBuilder');
const ToledoPluRepository = require('./ToledoPluRepository');
const UploadPluOperation = require('./UploadPluOperation');
const { PluError, CODES } = require('./ToledoPluErrors');
const { ToledoOperationEngine } = require('../operations/ToledoOperationEngine');
const OperationContext = require('../operations/OperationContext');
const SessionOriginAudit = require('../../../connection/SessionOriginAudit');
const UploadPipelineAudit = require('./UploadPipelineAudit');

let logger = null;
function getLogger() {
  if (logger) return logger;
  try {
    logger = require('../../../services/LoggerService');
  } catch (_) {
    logger = {
      info: async (msg, ctx) => console.log('[plu-v1]', msg, ctx || ''),
      error: async (msg, ctx) => console.error('[plu-v1]', msg, ctx || '')
    };
  }
  return logger;
}

class ToledoPluEngine {
  constructor(deps = {}) {
    this.operationEngine = deps.operationEngine || null;
    this.repository = deps.repository || new ToledoPluRepository();
    this._cancelled = false;
    this._status = {
      running: false,
      total: 0,
      done: 0,
      ok: 0,
      erro: 0,
      current: null
    };
    this._driverFactory = deps.driverFactory || null;
    this._engineFactory = deps.engineFactory || (() => new ToledoOperationEngine({
      persistir: deps.persistir !== false,
      driverFactory: this._driverFactory,
      drivers: deps.drivers
    }));
  }

  _engine() {
    if (!this.operationEngine) {
      this.operationEngine = this._engineFactory();
      // registra UPLOAD_PLU
      const Eng = this.operationEngine.constructor;
      if (Eng.OPERACOES && !Eng.OPERACOES.UPLOAD_PLU) {
        Eng.OPERACOES.UPLOAD_PLU = UploadPluOperation;
      }
      if (this.operationEngine.criarOperacao) {
        const original = this.operationEngine.criarOperacao.bind(this.operationEngine);
        this.operationEngine.criarOperacao = (nome, opcoes) => {
          if (String(nome).toUpperCase() === 'UPLOAD_PLU') {
            return new UploadPluOperation(opcoes);
          }
          return original(nome, opcoes);
        };
      }
    }
    return this.operationEngine;
  }

  status() {
    return { ...this._status, cancelled: this._cancelled };
  }

  cancel() {
    this._cancelled = true;
    return { cancelled: true };
  }

  /**
   * RC15.3 — alias oficial de upload de um produto (sem lógica extra).
   */
  async uploadOne(produtoOuPlu, opcoes = {}) {
    return this.upload(produtoOuPlu, opcoes);
  }

  /**
   * Upload de um produto/PLU.
   */
  async upload(produtoOuPlu, opcoes = {}) {
    if (!opcoes._batch) this._cancelled = false;
    const log = getLogger();
    const host = opcoes.host || opcoes.ip;
    const porta = opcoes.porta != null ? opcoes.porta : opcoes.porta_tcp;

    if (!host || !porta) {
      throw PluError.fromCode(CODES.UPLOAD_ERROR, 'host e porta obrigatórios', { statusCode: 400 });
    }

    const plu = mapper.map(produtoOuPlu);
    const equipamentoId = opcoes.equipamentoId ?? opcoes.equipamento_id ?? opcoes.id ?? null;
    const alvoSessao = {
      host,
      porta,
      equipamentoId: equipamentoId != null ? Number(equipamentoId) : undefined
    };

    await log.info('Produto iniciado', {
      operacao: 'plu_upload_v1',
      contexto: { plu: plu.plu, host, porta, equipamentoId }
    });

    // RC15.7 — audita CONNECT → HANDSHAKE → UPLOAD → ACK (sem alterar fluxo)
    const requireHandshakeBeforeUpload = UploadPipelineAudit.resolverRequireHandshake(opcoes);
    return UploadPipelineAudit.run({
      plu: plu.plu,
      host,
      porta,
      equipamentoId: alvoSessao.equipamentoId,
      requireHandshakeBeforeUpload
    }, async () => {
      // RC15.6 — mesma EquipmentSession do Diagnóstico
      let sessionAudit;
      try {
        sessionAudit = SessionOriginAudit.assertMesmaSessaoQueDiagnostico(alvoSessao);
      } catch (sessErr) {
        if (sessErr.code === 'UPLOAD_USANDO_SESSAO_DIFERENTE') {
          throw PluError.fromCode(
            'UPLOAD_USANDO_SESSAO_DIFERENTE',
            sessErr.message,
            {
              statusCode: 409,
              diagnostico: sessErr.diagnostico,
              upload: sessErr.upload,
              divergencias: sessErr.divergencias
            }
          );
        }
        throw sessErr;
      }

      // RC15.5 — ValidationReport (campo/valor/motivo); log no terminal
      const validationReport = validator.assertValid(plu, produtoOuPlu);
      await log.info('Validação PLU', {
        operacao: 'plu_upload_v1',
        contexto: {
          plu: plu.plu,
          produto_id: plu.produto_id,
          checklist: validator.formatChecklist(validationReport),
          success: true
        }
      });

      const frame = builder.build(plu);
      await log.info('Frame criado', {
        operacao: 'plu_upload_v1',
        contexto: { plu: plu.plu, bytes: frame.length }
      });

      let syncId = null;
      if (opcoes.persistir !== false) {
        syncId = await this.repository.registrarInicio({
          produto_id: plu.produto_id,
          plu: plu.plu,
          host,
          porta
        });
      }

      if (!opcoes._batch) {
        this._status = {
          running: true,
          total: 1,
          done: 0,
          ok: 0,
          erro: 0,
          current: plu.plu
        };
      } else {
        this._status.current = plu.plu;
      }

      try {
        if (this._cancelled) {
          throw PluError.fromCode(CODES.UPLOAD_CANCELLED, 'Upload cancelado');
        }

        const engine = this._engine();
        await log.info('Operação enviada', {
          operacao: 'plu_upload_v1',
          contexto: { plu: plu.plu }
        });

        const chave = `${host}:${porta}`;
        const { withBusy, OP_BUSY } = require('../../../connection/SessionBusy');
        const result = await withBusy(alvoSessao, OP_BUSY.UPLOAD, () => engine.queue.enqueue(chave, async () => {
          const driver = await engine._ensureDriver(host, porta, {
            ...opcoes,
            equipamentoId: alvoSessao.equipamentoId
          });
          const op = new UploadPluOperation({
            plu,
            frame,
            produto: produtoOuPlu,
            timeout: opcoes.timeout
          });
          const ctx = new OperationContext({
            host,
            porta,
            equipamentoId: alvoSessao.equipamentoId,
            driver,
            connection: {
              host,
              porta,
              equipamentoId: alvoSessao.equipamentoId,
              via: 'ConnectionManager',
              sessionKey: sessionAudit?.upload?.sessionKey || null
            }
          });
          return op.execute(ctx);
        }));

        if (!result.success) {
          UploadPipelineAudit.marcar('ACK', 'FALHOU', { motivo: result.error || 'Falha no upload' });
          throw PluError.fromCode(
            result.error === 'NACK' || String(result.error).includes('NACK')
              ? CODES.NACK
              : CODES.UPLOAD_ERROR,
            result.error || 'Falha no upload',
            { statusCode: 502 }
          );
        }

        UploadPipelineAudit.marcar('ACK', 'OK');
        await log.info('ACK', {
          operacao: 'plu_upload_v1',
          contexto: { plu: plu.plu }
        });

        if (syncId != null) await this.repository.confirmar(syncId);

        await log.info('Produto sincronizado', {
          operacao: 'plu_upload_v1',
          contexto: { plu: plu.plu, syncId }
        });

        if (!opcoes._batch) {
          this._status.done = 1;
          this._status.ok = 1;
          this._status.running = false;
        }

        return {
          success: true,
          plu: plu.plu,
          syncId,
          duration: result.duration,
          bytesSent: result.bytesSent,
          bytesReceived: result.bytesReceived,
          sessionOrigin: sessionAudit?.upload || null,
          pipelineAudit: UploadPipelineAudit.snapshot()
        };
      } catch (err) {
        if (!opcoes._batch) {
          this._status.done = 1;
          this._status.erro = 1;
          this._status.running = false;
        }
        if (syncId != null) {
          try { await this.repository.falhar(syncId, err.message || err.code); } catch (_) { /* ignore */ }
        }
        throw err;
      }
    });
  }

  /**
   * Upload em lote com progresso.
   */
  async uploadMany(lista, opcoes = {}) {
    this._cancelled = false;
    const itens = Array.isArray(lista) ? lista : [];
    const resultados = [];
    this._status = {
      running: true,
      total: itens.length,
      done: 0,
      ok: 0,
      erro: 0,
      current: null
    };

    for (const item of itens) {
      if (this._cancelled) {
        resultados.push({ success: false, error: CODES.UPLOAD_CANCELLED, cancelled: true });
        break;
      }
      try {
        const r = await this.upload(item, { ...opcoes, _batch: true });
        resultados.push(r);
        this._status.ok += 1;
      } catch (err) {
        const report = err.validationReport || err.meta?.validationReport || null;
        const motivos = report?.errors?.map((e) => e.motivo) || [];
        resultados.push({
          success: false,
          plu: item.plu || item.codigo || null,
          error: motivos.length ? motivos.join(' ') : (err.message || err.code),
          code: err.code || null,
          mensagem: 'Produto não enviado',
          motivos,
          validationReport: report,
          errors: report?.errors || null
        });
        this._status.erro += 1;
      }
      this._status.done += 1;
      this._status.current = item.plu || item.codigo || null;
      if (typeof opcoes.onProgress === 'function') {
        try {
          opcoes.onProgress({ ...this._status });
        } catch (_) { /* ignore */ }
      }
    }

    this._status.running = false;
    return {
      success: this._status.erro === 0 && !this._cancelled,
      total: itens.length,
      ok: this._status.ok,
      erro: this._status.erro,
      cancelled: this._cancelled,
      resultados
    };
  }

  /**
   * Retry com produto informado.
   */
  async retry(syncId, opcoes = {}) {
    const row = await this.repository.buscarPorId(syncId);
    if (!row) {
      throw PluError.fromCode(CODES.UPLOAD_ERROR, 'Registro de sync não encontrado', { statusCode: 404 });
    }
    if (!opcoes.produto) {
      throw PluError.fromCode(CODES.UPLOAD_ERROR, 'Informe produto completo para retry', { statusCode: 400 });
    }
    await this.repository.incrementarTentativa(syncId);
    return this.upload(opcoes.produto, {
      host: opcoes.host || row.host,
      porta: opcoes.porta != null ? opcoes.porta : row.porta,
      persistir: true
    });
  }

  async history(filtros) {
    return this.repository.historico(filtros);
  }
}

const toledoPluEngine = new ToledoPluEngine();

module.exports = toledoPluEngine;
module.exports.ToledoPluEngine = ToledoPluEngine;
module.exports.toledoPluEngine = toledoPluEngine;
