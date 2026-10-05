/**
 * Comprovante de Prestação de Contas (Sprint 3 + Sprint Entrega snapshot)
 */

const { agoraLocalBrasil } = require('../vendas/VendaFinanceiroService');
const { resolverDadosClienteEntrega } = require('./EntregaClienteSnapshot');
const {
  colunas,
  centro,
  blocoCentro,
  comporLinha,
  linhaSe,
  documento
} = require('./comprovanteTermicoLayout');

function fmt(n) {
  return Number(n || 0).toFixed(2).replace('.', ',');
}

function montarHtmlComprovantePrestacao(dados = {}) {
  const agora = agoraLocalBrasil();
  const data = agora.slice(0, 10);
  const hora = agora.includes('T') ? agora.slice(11, 19) : (agora.slice(11, 19) || '');

  const snap = resolverDadosClienteEntrega({
    nome_cliente_entrega: dados.nome_cliente_entrega || dados.cliente,
    cpf_cnpj_cliente_entrega: dados.cpf_cnpj_cliente_entrega || dados.cpf_cnpj,
    telefone_entrega: dados.telefone_entrega || dados.telefone,
    email_cliente_entrega: dados.email_cliente_entrega || dados.email,
    cep_entrega: dados.cep_entrega || dados.cep,
    endereco_entrega: dados.endereco_entrega || dados.endereco,
    numero_entrega: dados.numero_entrega || dados.numero,
    complemento_entrega: dados.complemento_entrega || dados.complemento,
    bairro_entrega: dados.bairro_entrega || dados.bairro,
    cidade_entrega: dados.cidade_entrega || dados.cidade,
    uf_entrega: dados.uf_entrega || dados.uf,
    referencia_entrega: dados.referencia_entrega || dados.referencia,
    cliente_nome: dados.cliente
  });

  const cepFmt = snap.cep && String(snap.cep).length === 8
    ? `${String(snap.cep).slice(0, 5)}-${String(snap.cep).slice(5)}`
    : (snap.cep || '');
  const temEnderecoEstruturado = !!(snap.numero || snap.complemento || snap.bairro || snap.cidade || snap.uf || snap.cep);
  const formas = Array.isArray(dados.formas_pagamento) ? dados.formas_pagamento : [];
  const papelMm = Number(dados.papel_mm) === 58 ? 58 : 80;
  const cols = colunas(papelMm);
  const sep = '-'.repeat(cols);
  const L = (label, valor) => comporLinha(label, valor, cols);
  const endereco = temEnderecoEstruturado
    ? [
      ...linhaSe('CEP', cepFmt, cols),
      ...linhaSe('Endereço', snap.endereco, cols),
      ...linhaSe('Número', snap.numero, cols),
      ...linhaSe('Complemento', snap.complemento, cols),
      ...linhaSe('Bairro', snap.bairro, cols),
      ...linhaSe('Cidade', snap.cidade, cols),
      ...linhaSe('UF', snap.uf, cols),
      ...linhaSe('Referência', snap.referencia, cols)
    ]
    : [
      ...L('Endereço:', snap.endereco_linha || '—'),
      ...linhaSe('Referência', snap.referencia, cols)
    ];
  const linhasFormas = formas.length
    ? formas.flatMap((p) => L(String(p.forma_pagamento || '').toUpperCase(), `R$ ${fmt(p.valor)}`))
    : L(String(dados.pagamento_recebido || '—'), `R$ ${fmt(dados.valor)}`);

  const linhas = [
    ...blocoCentro('COMPROVANTE DE PRESTAÇÃO', cols),
    ...blocoCentro(dados.empresa || dados.nome_empresa || 'CDS Sistemas', cols),
    ...(dados.cnpj ? blocoCentro(`CNPJ ${dados.cnpj}`, cols) : []),
    sep,
    centro('CLIENTE / CONSUMIDOR', cols),
    ...L('Nome:', snap.nome || '—'),
    ...linhaSe('CPF/CNPJ', snap.cpf_cnpj, cols),
    ...linhaSe('Telefone', snap.telefone, cols),
    ...linhaSe('E-mail', snap.email, cols),
    '',
    centro('ENDEREÇO DA ENTREGA', cols),
    ...endereco,
    '',
    centro('PRESTAÇÃO', cols),
    ...L('Pedido:', String(dados.pedido || dados.codigo || '—')),
    ...L('Venda:', String(dados.codigo || dados.pedido || '—')),
    ...L('Valor:', `R$ ${fmt(dados.valor)}`),
    ...L('Pagamento previsto:', dados.pagamento_previsto || '—'),
    ...L('Pagamento recebido:', dados.pagamento_recebido || '—'),
    ...linhasFormas,
    ...L('Documento:', dados.documento || 'NAO_FISCAL'),
    ...L('Troco levado:', `R$ ${fmt(dados.troco_levado)}`),
    ...L('Troco devolvido:', `R$ ${fmt(dados.troco_devolvido)}`),
    ...L('Maquineta:', dados.maquineta || 'NÃO'),
    ...L('Entregador:', dados.entregador || '—'),
    ...L('Operador:', dados.operador || '—'),
    ...L('Data:', data),
    ...L('Hora:', hora),
    ...linhaSe('Observações', dados.observacao_entrega || dados.observacoes, cols),
    sep,
    ...blocoCentro('PRESTAÇÃO DE CONTAS FINALIZADA', cols)
  ];

  return documento({
    titulo: 'Comprovante de Prestação',
    classe: `comprovante-prestacao-${papelMm}`,
    linhas,
    papelMm
  });
}

module.exports = {
  montarHtmlComprovantePrestacao,
  ComprovantePrestacao: { montarHtml: montarHtmlComprovantePrestacao }
};
