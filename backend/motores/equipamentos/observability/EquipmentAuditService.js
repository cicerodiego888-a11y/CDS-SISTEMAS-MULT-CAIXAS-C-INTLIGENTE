/**
 * Sprint 15.8 — EquipmentAuditService
 */

'use strict';

const repo = require('./ObservabilityRepository');
const eventStream = require('./EventStream');
const { buildReport } = require('./CertificationReport');
const suite = require('./DriverCertificationSuite');

class EquipmentAuditService {
  /**
   * Executa certificação, persiste e audita.
   */
  async certificar(opcoes = {}) {
    const resultado = await suite.executar(opcoes);
    const relatorio = buildReport(resultado);

    let id = null;
    try {
      id = await repo.salvarCertificacao({
        driverId: resultado.driverId,
        driverVersao: resultado.driverVersao,
        firmware: resultado.firmware,
        resultado: resultado.resultado,
        nota: resultado.nota,
        checklist: resultado.checklist,
        falhas: resultado.falhas,
        relatorioJson: relatorio.json,
        relatorioMd: relatorio.markdown,
        tempoMs: resultado.tempoMs,
        executadoPor: resultado.executadoPor,
        observacoes: opcoes.observacoes || null,
        executadoEm: resultado.executadoEm
      });
    } catch {
      /* best-effort */
    }

    await eventStream.push({
      tipo: 'certification',
      severidade: resultado.resultado === 'APROVADO' ? 'info' : 'warning',
      driverId: resultado.driverId,
      mensagem: `Certificação ${resultado.resultado} (nota ${resultado.nota})`,
      payload: {
        id,
        quem: resultado.executadoPor,
        quando: resultado.executadoEm,
        driver: resultado.driverId,
        versao: resultado.driverVersao,
        firmware: resultado.firmware,
        resultado: resultado.resultado,
        nota: resultado.nota,
        tempoMs: resultado.tempoMs,
        observacoes: opcoes.observacoes || null
      }
    });

    return {
      id,
      resultado,
      relatorio
    };
  }

  async obterRelatorio(driverId = null) {
    const row = await repo.ultimaCertificacao(driverId);
    if (!row) return null;
    return {
      id: row.id,
      driverId: row.driver_id,
      driverVersao: row.driver_versao,
      firmware: row.firmware,
      resultado: row.resultado,
      nota: row.nota,
      checklist: row.checklist ? JSON.parse(row.checklist) : [],
      falhas: row.falhas ? JSON.parse(row.falhas) : [],
      relatorioJson: row.relatorio_json ? JSON.parse(row.relatorio_json) : null,
      relatorioMd: row.relatorio_md,
      tempoMs: row.tempo_ms,
      executadoPor: row.executado_por,
      observacoes: row.observacoes,
      executadoEm: row.executado_em
    };
  }

  async historico(opcoes = {}) {
    const rows = await repo.listarCertificacoes(opcoes);
    return rows.map((row) => ({
      id: row.id,
      driverId: row.driver_id,
      driverVersao: row.driver_versao,
      firmware: row.firmware,
      resultado: row.resultado,
      nota: row.nota,
      tempoMs: row.tempo_ms,
      executadoPor: row.executado_por,
      executadoEm: row.executado_em
    }));
  }
}

const auditService = new EquipmentAuditService();

module.exports = auditService;
module.exports.EquipmentAuditService = EquipmentAuditService;
