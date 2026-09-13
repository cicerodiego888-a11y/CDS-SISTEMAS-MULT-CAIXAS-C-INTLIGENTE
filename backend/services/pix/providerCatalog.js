module.exports = {
  mercadopago: {
    nome: 'Mercado Pago',
    campos: [
      { name: 'accessToken', label: 'Access Token', type: 'password', required: true },
      { name: 'emailPagadorTeste', label: 'E-mail do pagador teste', type: 'email', required: false },
      { name: 'tempoExpiracaoMinutos', label: 'Expiração em minutos', type: 'number', required: true, default: 10 }
    ]
  },
  stone: {
    nome: 'Stone',
    campos: [
      { name: 'baseUrl', label: 'Base URL da API Stone', type: 'text', required: true },
      { name: 'token', label: 'Bearer Token', type: 'password', required: true },
      { name: 'stoneAccountId', label: 'Stone Account ID', type: 'text', required: true },
      { name: 'chavePix', label: 'Chave Pix', type: 'text', required: true },
      { name: 'tempoExpiracaoMinutos', label: 'Expiração em minutos', type: 'number', required: true, default: 10 }
    ]
  },
  efi: { nome: 'Efí/Gerencianet', campos: [] },
  asaas: { nome: 'Asaas', campos: [] },
  pagbank: { nome: 'PagBank', campos: [] },
  inter: { nome: 'Banco Inter', campos: [] },
  sicoob: { nome: 'Sicoob', campos: [] },
  sicredi: { nome: 'Sicredi', campos: [] },
  infinitypay: { nome: 'Infinity Pay', campos: [] }
};