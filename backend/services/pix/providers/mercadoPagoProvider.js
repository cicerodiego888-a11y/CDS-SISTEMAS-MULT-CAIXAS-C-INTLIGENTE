const axios = require('axios');

async function criarCobranca({ valor, descricao, config }) {
  const accessToken = config.accessToken;

  if (!accessToken) {
    throw new Error('Access Token do Mercado Pago não configurado.');
  }

  const idempotencyKey = `pdv-pix-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const body = {
    transaction_amount: Number(valor),
    description: descricao || 'Venda PDV',
    payment_method_id: 'pix',
    payer: {
      email: config.emailPagadorTeste || 'cliente@email.com'
    }
  };

  const resp = await axios.post('https://api.mercadopago.com/v1/payments', body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey
    },
    timeout: 30000
  });

  const data = resp.data;
  const tx = data.point_of_interaction?.transaction_data || {};

  return {
    provedor: 'mercadopago',
    txid: String(data.id),
    status: normalizarStatus(data.status),
    statusOriginal: data.status,
    qrCodeBase64: tx.qr_code_base64 || null,
    copiaCola: tx.qr_code || null,
    raw: data
  };
}

async function consultarStatus({ txid, config }) {
  const resp = await axios.get(`https://api.mercadopago.com/v1/payments/${txid}`, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`
    },
    timeout: 30000
  });

  return {
    txid: String(resp.data.id),
    status: normalizarStatus(resp.data.status),
    statusOriginal: resp.data.status,
    raw: resp.data
  };
}

function normalizarStatus(status) {
  if (status === 'approved') return 'PAGO';
  if (status === 'cancelled') return 'CANCELADO';
  if (status === 'rejected') return 'ERRO';
  if (status === 'expired') return 'EXPIRADO';
  return 'PENDENTE';
}

module.exports = {
  criarCobranca,
  consultarStatus
};