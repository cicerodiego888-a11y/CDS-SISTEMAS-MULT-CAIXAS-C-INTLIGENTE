/**
 * Comprovante de Prestação de Contas (Sprint 3 + Sprint Entrega snapshot)
 */

const { agoraLocalBrasil } = require('../vendas/VendaFinanceiroService');
const { resolverDadosClienteEntrega } = require('./EntregaClienteSnapshot');
const {
  linha,
  centro,
  sep,
  documento,
  papelMmDe
} = require('../termico/geometriaCupom80');

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
  const papelMm = papelMmDe(dados.papel_mm);
  const campo = (rotulo, valor) => {
    const v = String(valor ?? '').trim();
    return v ? linha(`${rotulo}:`, v) : '';
  };
  const endereco = temEnderecoEstruturado
    ? [
      campo('CEP', cepFmt),
      campo('Endereço', snap.endereco),
      campo('Número', snap.numero),
      campo('Complemento', snap.complemento),
      campo('Bairro', snap.bairro),
      campo('Cidade', snap.cidade),
      campo('UF', snap.uf),
      campo('Referência', snap.referencia)
    ].join('')
    : `${linha('Endereço:', snap.endereco_linha || '—')}${campo('Referência', snap.referencia)}`;
  const linhasFormas = formas.length
    ? formas.map((p) => linha(String(p.forma_pagamento || '').toUpperCase(), `R$ ${fmt(p.valor)}`)).join('')
    : linha(String(dados.pagamento_recebido || '—'), `R$ ${fmt(dados.valor)}`);

  const corpo = [
    centro('COMPROVANTE DE PRESTAÇÃO', 'titulo'),
    centro(dados.empresa || dados.nome_empresa || 'CDS Sistemas', 'empresa'),
    dados.cnpj ? centro(`CNPJ ${dados.cnpj}`, 'meta') : '',
    sep(),
    centro('CLIENTE / CONSUMIDOR'),
    linha('Nome:', snap.nome || '—'),
    campo('CPF/CNPJ', snap.cpf_cnpj),
    campo('Telefone', snap.telefone),
    campo('E-mail', snap.email),
    centro('ENDEREÇO DA ENTREGA'),
    endereco,
    centro('PRESTAÇÃO'),
    linha('Pedido:', String(dados.pedido || dados.codigo || '—')),
    linha('Venda:', String(dados.codigo || dados.pedido || '—')),
    linha('Valor:', `R$ ${fmt(dados.valor)}`),
    linha('Pagamento previsto:', dados.pagamento_previsto || '—'),
    linha('Pagamento recebido:', dados.pagamento_recebido || '—'),
    centro('FORMAS DE PAGAMENTO'),
    linhasFormas,
    linha('Documento:', dados.documento || 'NAO_FISCAL'),
    linha('Troco levado:', `R$ ${fmt(dados.troco_levado)}`),
    linha('Troco devolvido:', `R$ ${fmt(dados.troco_devolvido)}`),
    linha('Maquineta:', dados.maquineta || 'NÃO'),
    linha('Entregador:', dados.entregador || '—'),
    linha('Operador:', dados.operador || '—'),
    linha('Data:', data),
    linha('Hora:', hora),
    campo('Observações', dados.observacao_entrega || dados.observacoes),
    sep(),
    centro('PRESTAÇÃO DE CONTAS FINALIZADA', 'aviso')
  ].join('');

  return documento({
    titulo: 'Comprovante de Prestação',
    classe: `comprovante-prestacao-${papelMm}`,
    corpo,
    papelMm
  });
}

module.exports = {
  montarHtmlComprovantePrestacao,
  ComprovantePrestacao: { montarHtml: montarHtmlComprovantePrestacao }
};
