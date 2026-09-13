/**
 * Sprint 14.7 — UploadPluOperation (Operation Engine)
 * RC15.5 — registra ValidationReport antes de falhar (nunca só VALIDATION_ERROR).
 */

'use strict';

const ToledoOperation = require('../operations/ToledoOperation');
const { OperationError, CODES } = require('../operations/OperationErrors');
const pluBuilder = require('./ToledoPluBuilder');
const pluParser = require('./ToledoPluParser');
const validator = require('./ToledoPluValidator');
const { PluError, CODES: PLU_CODES } = require('./ToledoPluErrors');
const UploadPipelineAudit = require('./UploadPipelineAudit');

class UploadPluOperation extends ToledoOperation {
  static get OPERATION() { return 'UPLOAD_PLU'; }

  constructor(opcoes = {}) {
    super({
      ...opcoes,
      operation: 'UPLOAD_PLU',
      timeout: opcoes.timeout != null ? opcoes.timeout : 5000
    });
    this.plu = opcoes.plu || null;
    this.frame = opcoes.frame || null;
    this.produto = opcoes.produto || null;
  }

  /**
   * RC15.5 — auditoria da validação (checklist ✔/✖) antes do envio.
   */
  _auditoriaValidacao() {
    if (!this.plu) return null;
    const report = validator.buildReport(this.plu, this.produto || this.plu);
    // eslint-disable-next-line no-console
    console.log([
      '',
      '[UploadPluOperation] Validação pré-envio',
      `Produto ID: ${report.produto?.id != null ? report.produto.id : '—'}`,
      `Descrição: ${report.produto?.descricao || '—'}`,
      `PLU: ${report.produto?.plu || '—'}`,
      validator.formatChecklist(report),
      ''
    ].join('\n'));
    if (!report.success) {
      validator.logReport(report);
      const motivos = report.errors.map((e) => e.motivo).join(' ');
      const err = PluError.fromCode(PLU_CODES.VALIDATION_ERROR, motivos || 'PLU inválido.', {
        statusCode: 400,
        validationReport: report,
        errors: report.errors,
        checklist: validator.formatChecklist(report)
      });
      err.validationReport = report;
      throw err;
    }
    return report;
  }

  async run(ctx) {
    if (!ctx.driver) {
      throw OperationError.fromCode(CODES.CONNECTION_LOST, 'Driver ausente');
    }
    this._auditoriaValidacao();
    // RC15.7 — UploadPluOperation NÃO solicita handshake; apenas envia PLU
    UploadPipelineAudit.marcar('UPLOAD', 'EXECUTANDO', {
      solicitante: UploadPipelineAudit.SOLICITANTES.UPLOAD_PLU_OPERATION
    });
    const frame = this.frame || pluBuilder.build(this.plu);
    this.bytesSent = frame.length;
    try {
      await ctx.driver.sendFrame(frame);
      const raw = await ctx.driver.receiveFrame({ timeoutMs: this.timeout });
      this.bytesReceived = raw && raw.length ? raw.length : 0;
      const ack = pluParser.assertAck(raw);
      UploadPipelineAudit.marcar('UPLOAD', 'OK');
      UploadPipelineAudit.marcar('ACK', 'OK');
      return {
        ok: true,
        ack: true,
        plu: this.plu ? this.plu.plu : null,
        payload: ack.payload
      };
    } catch (err) {
      UploadPipelineAudit.marcar('UPLOAD', 'FALHOU', { motivo: err.message || err.code });
      if (/ack|nack/i.test(String(err.message || err.code || ''))) {
        UploadPipelineAudit.marcar('ACK', 'FALHOU', { motivo: err.message || err.code });
      }
      throw err;
    }
  }
}

module.exports = UploadPluOperation;
module.exports.UploadPluOperation = UploadPluOperation;
