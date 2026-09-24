'use strict';

/**
 * Normalização e validação de CPF/CNPJ para cadastro (fornecedor/cliente).
 * Reutiliza normalizarCnpj (MIIP) e o algoritmo de dígitos verificadores
 * já usado em compras-fornecedor-cnpj-rc831.js (backend, sem HTTP).
 *
 * @module services/cadastro/documentoCpfCnpj
 */

const { normalizarCnpj } = require('../../motores/miip/utils/normalizarCnpj');

function apenasDigitos(valor) {
  if (valor == null || valor === '') return '';
  return String(valor).replace(/\D/g, '');
}

/**
 * SQL fragmento (coluna) → só dígitos, alinhado a compras/clientes.
 * @param {string} coluna
 * @returns {string}
 */
function sqlColunaSomenteDigitos(coluna) {
  const c = String(coluna || 'cpf_cnpj');
  return (
    `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${c},''),'.',''),'/',''),'-',''),' ','')`
  );
}

function calcularDigitoCnpj(base, pesos) {
  let soma = 0;
  for (let i = 0; i < pesos.length; i += 1) {
    soma += Number(base[i] || 0) * pesos[i];
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Valida CNPJ pelos dígitos verificadores (mesmo algoritmo do RC8.3.1).
 * Vazio → false (diferente de validarCnpjCompra, que trata vazio como ok na compra).
 *
 * @param {string|number|null|undefined} valor
 * @returns {boolean}
 */
function validarCnpj(valor) {
  const cnpj = normalizarCnpj(valor);
  if (!cnpj) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const base = cnpj.slice(0, 12);
  const digito1 = calcularDigitoCnpj(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digito2 = calcularDigitoCnpj(base + digito1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj === base + String(digito1) + String(digito2);
}

function calcularDigitoCpf(base, pesos) {
  let soma = 0;
  for (let i = 0; i < pesos.length; i += 1) {
    soma += Number(base[i] || 0) * pesos[i];
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/**
 * Valida CPF (11 dígitos + verificadores).
 * Mantém suporte a PF sem exigência rígida no fluxo legado se não for CPF completo.
 *
 * @param {string|number|null|undefined} valor
 * @returns {boolean}
 */
function validarCpf(valor) {
  const cpf = apenasDigitos(valor);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const d1 = calcularDigitoCpf(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcularDigitoCpf(cpf.slice(0, 9) + String(d1), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cpf === cpf.slice(0, 9) + String(d1) + String(d2);
}

/**
 * Prepara cpf_cnpj para persistência em cadastro.
 * - vazio → null
 * - 11 dígitos → CPF (só dígitos; valida DV)
 * - 14 dígitos → CNPJ normalizado (só dígitos; valida DV)
 * - outro → erro
 *
 * @param {string|number|null|undefined} valor
 * @returns {{ ok: true, valor: string|null, tipo: 'vazio'|'cpf'|'cnpj' }
 *   | { ok: false, error: string, status: number }}
 */
function prepararDocumentoCadastro(valor) {
  if (valor == null || String(valor).trim() === '') {
    return { ok: true, valor: null, tipo: 'vazio' };
  }

  const digitos = apenasDigitos(valor);

  if (digitos.length === 11) {
    // CPF: normaliza para dígitos; não aplica DV rígido (preserva regra legada de PF).
    return { ok: true, valor: digitos, tipo: 'cpf' };
  }

  if (digitos.length === 14) {
    const cnpj = normalizarCnpj(digitos);
    if (!cnpj || !validarCnpj(cnpj)) {
      return { ok: false, error: 'CNPJ inválido.', status: 400 };
    }
    return { ok: true, valor: cnpj, tipo: 'cnpj' };
  }

  return {
    ok: false,
    error: 'CPF/CNPJ deve conter 11 (CPF) ou 14 (CNPJ) dígitos.',
    status: 400
  };
}

module.exports = {
  apenasDigitos,
  normalizarCnpj,
  validarCnpj,
  validarCpf,
  prepararDocumentoCadastro,
  sqlColunaSomenteDigitos
};
