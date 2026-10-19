'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const tls = require('tls');

// Raiz V10 publicada no portal SVRS; SHA-256 6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6.
const RAIZ_ICP_BRASIL_V10 = fs.readFileSync(
  path.join(__dirname, 'certificates', 'ac-raiz-brasileira-v10.pem'),
  'utf8'
);
const CA_EXTRA_CONFIGURADA = process.env.NODE_EXTRA_CA_CERTS
  ? fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8')
  : null;

function obterCAsCancelamento(hostname) {
  const ca = [
    ...tls.rootCertificates,
    ...(CA_EXTRA_CONFIGURADA ? [CA_EXTRA_CONFIGURADA] : [])
  ];

  if (/^[^.]+\.svrs\.rs\.gov\.br$/i.test(String(hostname || ''))) {
    ca.push(RAIZ_ICP_BRASIL_V10);
  }

  return ca;
}

function criarAgenteHttpsCancelamento({
  key,
  cert,
  servername,
  minVersion = 'TLSv1.2',
  keepAlive = false
} = {}) {
  return new https.Agent({
    key,
    cert,
    ca: obterCAsCancelamento(servername),
    rejectUnauthorized: true,
    minVersion,
    keepAlive,
    servername
  });
}

module.exports = {
  obterCAsCancelamento,
  criarAgenteHttpsCancelamento,
  RAIZ_ICP_BRASIL_V10
};
