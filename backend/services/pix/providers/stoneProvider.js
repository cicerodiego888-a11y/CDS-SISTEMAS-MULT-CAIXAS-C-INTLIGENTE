const axios = require('axios');

async function criarCobranca({ valor, descricao, config }) {
  if (!config.baseUrl || !config.token || !config.stoneAccountId) {
    throw new Error('Configuração Stone incompleta.');
  }

  const txid = `PDV${Date.now()}`;
  const baseUrl = String(config.baseUrl).replace(/\/$/, '');

  const body = {
    txid,
    amount: Math.round(Number(valor) * 100),
    description: descricao || 'Venda PDV',
    pix_key: config.chavePix
  };

  const resp = await axios.post(`${baseUrl}/api/v1/pix_payment_invoices`, body, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      'x-stone-account-id': config.stoneAccountId,
      'x-stone-idempotency-key': txid,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  const data = resp.data;

  return {
    provedor: 'stone',
    txid: data.txid || data.id || txid,
    status: 'PENDENTE',
    statusOriginal: data.status || 'created',
    qrCodeBase64: data.qr_code_base64 || data.qrcode_base64 || null,
    copiaCola: data.br_code || data.qr_code || data.emv || data.copia_cola || null,
    raw: data
  };
}

async function consultarStatus({ txid, config }) {
  const baseUrl = String(config.baseUrl).replace(/\/$/, '');

  const resp = await axios.get(`${baseUrl}/api/v1/pix_payment_invoices/${txid}`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      'x-stone-account-id': config.stoneAccountId
    },
    timeout: 30000
  });

  const data = resp.data;

  return {
    txid,
    status: normalizarStatus(data.status),
    statusOriginal: data.status,
    raw: data
  };
}

function normalizarStatus(status) {
  const s = String(status || '').toLowerCase();

  if (['paid', 'settled', 'completed', 'approved'].includes(s)) return 'PAGO';
  if (['cancelled', 'canceled'].includes(s)) return 'CANCELADO';
  if (['expired'].includes(s)) return 'EXPIRADO';
  if (['failed', 'rejected', 'error'].includes(s)) return 'ERRO';

  return 'PENDENTE';
}

module.exports = {
  criarCobranca,
  consultarStatus
};