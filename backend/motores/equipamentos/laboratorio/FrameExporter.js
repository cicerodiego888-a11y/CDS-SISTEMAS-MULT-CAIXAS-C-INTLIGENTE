/**
 * Sprint 14.5 — FrameExporter
 * JSON / TXT / HEX — PCAP preparado para sprint futura.
 */

'use strict';

const FORMATOS = Object.freeze(['JSON', 'TXT', 'HEX', 'PCAP']);

function exportJson(session, frames) {
  return JSON.stringify({
    session: session && typeof session.paraApi === 'function' ? session.paraApi() : session,
    frames: (frames || []).map((f) => ({
      timestamp: f.timestamp,
      direction: f.direction,
      host: f.host,
      porta: f.porta,
      size: f.size != null ? f.size : f.tamanho,
      checksum: f.checksum,
      frame_hex: f.frame_hex,
      frame_ascii: f.frame_ascii
    })),
    exportedAt: new Date().toISOString(),
    format: 'JSON'
  }, null, 2);
}

function exportTxt(session, frames) {
  const s = session && typeof session.paraApi === 'function' ? session.paraApi() : (session || {});
  const linhas = [
    `# CDS Engineering Lab — Sessão ${s.id || ''}`,
    `# Driver: ${s.driver || ''}`,
    `# Equipamento: ${s.equipamento || ''}`,
    `# Início: ${s.iniciadoEm || ''}`,
    `# Fim: ${s.finalizadoEm || ''}`,
    `# Frames: ${s.totalFrames != null ? s.totalFrames : (frames || []).length}`,
    ''
  ];
  for (const f of frames || []) {
    linhas.push(
      `[${f.timestamp}] ${f.direction} size=${f.size != null ? f.size : f.tamanho} chk=${f.checksum}`
    );
    linhas.push(`HEX ${f.frame_hex}`);
    linhas.push(`ASC ${f.frame_ascii}`);
    linhas.push('');
  }
  return linhas.join('\n');
}

function exportHex(session, frames) {
  return (frames || []).map((f) => `${f.direction} ${f.frame_hex}`).join('\n');
}

/**
 * Stub PCAP — estrutura preparada (Sprint futura).
 */
function exportPcapStub(session, frames) {
  return {
    format: 'PCAP',
    supported: false,
    message: 'Exportação PCAP será implementada em sprint futura.',
    sessionId: session && (session.id || session.session_id) || null,
    frameCount: (frames || []).length
  };
}

/**
 * @param {string} formato JSON|TXT|HEX|PCAP
 * @param {object} session
 * @param {Array} frames
 */
function exportar(formato, session, frames) {
  const fmt = String(formato || 'JSON').toUpperCase();
  if (fmt === 'JSON') {
    return { contentType: 'application/json', body: exportJson(session, frames), format: 'JSON' };
  }
  if (fmt === 'TXT') {
    return { contentType: 'text/plain; charset=utf-8', body: exportTxt(session, frames), format: 'TXT' };
  }
  if (fmt === 'HEX') {
    return { contentType: 'text/plain; charset=utf-8', body: exportHex(session, frames), format: 'HEX' };
  }
  if (fmt === 'PCAP') {
    return {
      contentType: 'application/json',
      body: JSON.stringify(exportPcapStub(session, frames), null, 2),
      format: 'PCAP',
      supported: false
    };
  }
  const err = new Error(`Formato não suportado: ${formato}`);
  err.statusCode = 400;
  err.code = 'EXPORT_FORMAT_INVALIDO';
  throw err;
}

module.exports = {
  exportar,
  exportJson,
  exportTxt,
  exportHex,
  exportPcapStub,
  FORMATOS
};
