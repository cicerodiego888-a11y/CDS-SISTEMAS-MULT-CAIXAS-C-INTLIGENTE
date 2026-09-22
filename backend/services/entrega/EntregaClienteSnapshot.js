/**
 * Snapshot imutável dos dados de cliente/endereço da entrega.
 * Comprovantes e histórico usam estes campos — não o cadastro atual do cliente.
 */
'use strict';

function texto(valor) {
  const s = String(valor == null ? '' : valor).trim();
  return s || null;
}

function normalizarUf(valor) {
  const uf = String(valor == null ? '' : valor).trim().toUpperCase();
  return uf || null;
}

function normalizarCep(valor) {
  const digits = String(valor == null ? '' : valor).replace(/\D/g, '').slice(0, 8);
  return digits || null;
}

function formatarEnderecoLinha(parts = {}) {
  const trechos = [];
  const rua = texto(parts.endereco || parts.rua);
  const numero = texto(parts.numero);
  const complemento = texto(parts.complemento);
  const bairro = texto(parts.bairro);
  const cidade = texto(parts.cidade);
  const uf = normalizarUf(parts.uf);
  const cep = normalizarCep(parts.cep);

  if (rua) {
    trechos.push(numero ? `${rua}, ${numero}` : rua);
  } else if (numero) {
    trechos.push(`Nº ${numero}`);
  }
  if (complemento) trechos.push(complemento);
  if (bairro) trechos.push(bairro);
  if (cidade || uf) {
    trechos.push([cidade, uf].filter(Boolean).join(' - '));
  }
  if (cep) {
    const cepFmt = cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
    trechos.push(`CEP ${cepFmt}`);
  }
  return trechos.join(', ') || null;
}

/**
 * Monta snapshot a partir do body da criação + opcionalmente o cadastro (só como fallback).
 * Campos do body (dados da entrega) têm prioridade sobre o cadastro.
 */
function montarSnapshotEntrega(body = {}, cliente = null) {
  const clienteIdRaw = body.cliente_id;
  const clienteId = clienteIdRaw != null && String(clienteIdRaw).trim() !== ''
    ? Number(clienteIdRaw)
    : null;

  const nome = texto(
    body.nome_cliente_entrega
      || body.cliente_nome
      || (cliente && cliente.nome)
  );
  const cpfCnpj = texto(
    body.cpf_cnpj_cliente_entrega
      || body.cpf_cnpj
      || (cliente && cliente.cpf_cnpj)
  );
  const telefone = texto(
    body.telefone_entrega
      || body.telefone
      || (cliente && cliente.telefone)
  );
  const email = texto(
    body.email_cliente_entrega
      || body.email
      || (cliente && cliente.email)
  );
  const cep = normalizarCep(
    body.cep_entrega != null ? body.cep_entrega : (cliente && cliente.cep)
  );
  const endereco = texto(
    body.endereco_entrega
      || body.rua
      || (cliente && (cliente.rua || cliente.endereco))
  );
  const numero = texto(
    body.numero_entrega != null ? body.numero_entrega : (cliente && cliente.numero)
  );
  const complemento = texto(
    body.complemento_entrega != null ? body.complemento_entrega : (cliente && cliente.complemento)
  );
  const bairro = texto(
    body.bairro_entrega != null ? body.bairro_entrega : (cliente && cliente.bairro)
  );
  const cidade = texto(
    body.cidade_entrega != null ? body.cidade_entrega : (cliente && cliente.cidade)
  );
  const uf = normalizarUf(
    body.uf_entrega != null ? body.uf_entrega : (cliente && cliente.uf)
  );
  const referencia = texto(body.referencia_entrega);

  const enderecoCompleto = texto(body.endereco_entrega_completo)
    || formatarEnderecoLinha({
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      uf,
      cep
    });

  return Object.freeze({
    cliente_id: Number.isFinite(clienteId) && clienteId > 0 ? clienteId : null,
    nome_cliente_entrega: nome,
    cpf_cnpj_cliente_entrega: cpfCnpj,
    telefone_entrega: telefone,
    email_cliente_entrega: email,
    cep_entrega: cep,
    endereco_entrega: endereco,
    numero_entrega: numero,
    complemento_entrega: complemento,
    bairro_entrega: bairro,
    cidade_entrega: cidade,
    uf_entrega: uf,
    referencia_entrega: referencia,
    endereco_entrega_formatado: enderecoCompleto
  });
}

/**
 * Resolve dados para comprovantes: snapshot primeiro; legado via JOIN/campos antigos.
 */
function resolverDadosClienteEntrega(venda = {}) {
  const nome = texto(venda.nome_cliente_entrega)
    || texto(venda.cliente_nome)
    || 'Consumidor';
  const cpfCnpj = texto(venda.cpf_cnpj_cliente_entrega)
    || texto(venda.cliente_cpf);
  const telefone = texto(venda.telefone_entrega);
  const email = texto(venda.email_cliente_entrega);
  const cep = normalizarCep(venda.cep_entrega);
  const endereco = texto(venda.endereco_entrega);
  const numero = texto(venda.numero_entrega);
  const complemento = texto(venda.complemento_entrega);
  const bairro = texto(venda.bairro_entrega);
  const cidade = texto(venda.cidade_entrega);
  const uf = normalizarUf(venda.uf_entrega);
  const referencia = texto(venda.referencia_entrega);
  const temComponentes = !!(numero || complemento || bairro || cidade || uf || cep);
  const enderecoLinha = temComponentes
    ? (formatarEnderecoLinha({
      endereco,
      numero,
      complemento,
      bairro,
      cidade,
      uf,
      cep
    }) || '—')
    : (endereco || '—');

  return {
    nome,
    cpf_cnpj: cpfCnpj,
    telefone,
    email,
    cep,
    endereco,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    referencia,
    endereco_linha: enderecoLinha
  };
}

function linhaOpcional(label, valor) {
  const v = texto(valor);
  if (!v) return '';
  return `<div><strong>${label}:</strong> ${v}</div>`;
}

module.exports = {
  texto,
  normalizarUf,
  normalizarCep,
  formatarEnderecoLinha,
  montarSnapshotEntrega,
  resolverDadosClienteEntrega,
  linhaOpcional
};
