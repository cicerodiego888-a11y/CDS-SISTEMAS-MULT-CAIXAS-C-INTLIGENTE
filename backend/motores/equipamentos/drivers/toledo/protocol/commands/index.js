/**
 * Sprint 15.2 / RC14.14.2 — commands (registro alinhado à tabela oficial)
 * DP = downloadPlu apenas. Departamento = UD.
 */

'use strict';

const ToledoResponseMatcher = require('../ToledoResponseMatcher');
const { OFFICIAL, TIMEOUT_PADRAO } = require('../ToledoOfficialCommands');

function def(nome, wire, opcoes = {}) {
  return {
    name: nome,
    wireCommand: wire,
    timeoutMs: opcoes.timeoutMs != null ? opcoes.timeoutMs : 1500,
    retries: opcoes.retries != null ? opcoes.retries : 1,
    buildPayload: typeof opcoes.buildPayload === 'function'
      ? opcoes.buildPayload
      : ((payload) => payload || null),
    matcher: opcoes.matcher || new ToledoResponseMatcher({
      accept: opcoes.accept || ['AK'],
      reject: opcoes.reject || ['NK'],
      requestCommand: wire
    }),
    describe: opcoes.describe || nome,
    oficial: opcoes.oficial !== false
  };
}

const identify = def(OFFICIAL.IDENTIFY.name, OFFICIAL.IDENTIFY.wire, {
  timeoutMs: TIMEOUT_PADRAO.identify,
  retries: 2,
  accept: ['AK', 'RS', 'ST'],
  buildPayload: (p) => ({
    driver: 'TOLEDO_PRIX4_UNO',
    versao: '14.14.3',
    firmware_alvo: '90AX',
    ...(p || {})
  }),
  describe: OFFICIAL.IDENTIFY.describe
});

const handshake = def(OFFICIAL.HANDSHAKE.name, OFFICIAL.HANDSHAKE.wire, {
  timeoutMs: TIMEOUT_PADRAO.handshake,
  retries: 2,
  accept: ['AK', 'RS'],
  buildPayload: (p) => ({
    driver: 'TOLEDO_PRIX4_UNO',
    versao: '14.14.3',
    firmware_alvo: '90AX',
    ...(p || {})
  }),
  describe: OFFICIAL.HANDSHAKE.describe
});

const ping = def(OFFICIAL.PING.name, OFFICIAL.PING.wire, {
  timeoutMs: TIMEOUT_PADRAO.ping,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => ({ ts: Date.now(), ...(p || {}) }),
  describe: OFFICIAL.PING.describe
});

const status = def(OFFICIAL.STATUS.name, OFFICIAL.STATUS.wire, {
  timeoutMs: TIMEOUT_PADRAO.status,
  retries: 1,
  accept: ['AK', 'RS'],
  buildPayload: (p) => p || { ts: Date.now() },
  describe: OFFICIAL.STATUS.describe
});

const keepAlive = def(OFFICIAL.KEEP_ALIVE.name, OFFICIAL.KEEP_ALIVE.wire, {
  timeoutMs: TIMEOUT_PADRAO.keepAlive,
  retries: 0,
  accept: ['AK'],
  buildPayload: () => ({ keepalive: true, ts: Date.now() }),
  describe: OFFICIAL.KEEP_ALIVE.describe
});

const uploadPlu = def(OFFICIAL.UPLOAD_PLU.name, OFFICIAL.UPLOAD_PLU.wire, {
  timeoutMs: TIMEOUT_PADRAO.uploadPlu,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => p || {},
  describe: OFFICIAL.UPLOAD_PLU.describe
});

const downloadPlu = def(OFFICIAL.DOWNLOAD_PLU.name, OFFICIAL.DOWNLOAD_PLU.wire, {
  timeoutMs: TIMEOUT_PADRAO.downloadPlu,
  retries: 1,
  accept: ['AK', 'PD'],
  buildPayload: (p) => p || {},
  describe: OFFICIAL.DOWNLOAD_PLU.describe
});

/** RC14.14.2 — UD (não DP) */
const uploadDepartment = def(OFFICIAL.UPLOAD_DEPARTMENT.name, OFFICIAL.UPLOAD_DEPARTMENT.wire, {
  timeoutMs: TIMEOUT_PADRAO.uploadDepartment,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => p || {},
  describe: OFFICIAL.UPLOAD_DEPARTMENT.describe
});

const uploadPrice = def(OFFICIAL.UPLOAD_PRICE.name, OFFICIAL.UPLOAD_PRICE.wire, {
  timeoutMs: TIMEOUT_PADRAO.uploadPrice,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => ({ tipo: 'preco', ...(p || {}) }),
  describe: OFFICIAL.UPLOAD_PRICE.describe
});

const uploadLabel = def(OFFICIAL.UPLOAD_LABEL.name, OFFICIAL.UPLOAD_LABEL.wire, {
  timeoutMs: TIMEOUT_PADRAO.uploadLabel,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => ({ tipo: 'etiqueta', ...(p || {}) }),
  describe: OFFICIAL.UPLOAD_LABEL.describe
});

const readWeight = def(OFFICIAL.READ_WEIGHT.name, OFFICIAL.READ_WEIGHT.wire, {
  timeoutMs: TIMEOUT_PADRAO.readWeight,
  retries: 1,
  accept: ['AK', 'PW'],
  buildPayload: (p) => p || { ts: Date.now() },
  describe: OFFICIAL.READ_WEIGHT.describe
});

const configRead = def(OFFICIAL.CONFIG_READ.name, OFFICIAL.CONFIG_READ.wire, {
  timeoutMs: TIMEOUT_PADRAO.configRead,
  retries: 1,
  accept: ['AK', 'CF'],
  buildPayload: (p) => p || {},
  describe: OFFICIAL.CONFIG_READ.describe
});

const configWrite = def(OFFICIAL.CONFIG_WRITE.name, OFFICIAL.CONFIG_WRITE.wire, {
  timeoutMs: TIMEOUT_PADRAO.configWrite,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => p || {},
  describe: OFFICIAL.CONFIG_WRITE.describe
});

module.exports = {
  identify,
  handshake,
  ping,
  status,
  keepAlive,
  uploadPlu,
  downloadPlu,
  uploadDepartment,
  uploadPrice,
  uploadLabel,
  readWeight,
  configRead,
  configWrite
};
