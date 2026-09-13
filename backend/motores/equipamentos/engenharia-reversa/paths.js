/**
 * Caminhos de persistência — Engenharia Reversa (Sprint 13).
 */

const fs = require('fs');
const path = require('path');

function diretorioBase() {
  return process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'CDS Sistemas', 'engenharia-reversa')
    : path.join(process.cwd(), 'dados-app', 'engenharia-reversa');
}

function diretorioCapturas() {
  const dir = path.join(diretorioBase(), 'capturas');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function caminhoProtocoloMd() {
  return path.join(process.cwd(), 'PROTOCOLO_TOLEDO.md');
}

module.exports = {
  diretorioBase,
  diretorioCapturas,
  caminhoProtocoloMd
};
