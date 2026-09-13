/**
 * RC8.3.1 — Helpers de CNPJ do fornecedor na Entrada de Compras.
 * Funções puras reutilizáveis em compras.js e testes.
 */
(function initComprasFornecedorCnpjRc831(global) {
    const MSG_DIVERGENCIA_XML = 'Atenção: o CNPJ informado é diferente do emitente da NF-e importada.';

    function digitsOnly(valor) {
        return String(valor || '').replace(/\D/g, '');
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
     * Valida CNPJ (14 dígitos + dígitos verificadores).
     * Vazio é válido (compra sem CNPJ informado).
     */
    function validarCnpjCompra(valor) {
        const cnpj = digitsOnly(valor);
        if (!cnpj) return true;
        if (cnpj.length !== 14) return false;
        if (/^(\d)\1{13}$/.test(cnpj)) return false;

        const base = cnpj.slice(0, 12);
        const digito1 = calcularDigitoCnpj(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
        const digito2 = calcularDigitoCnpj(base + digito1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
        return cnpj === base + String(digito1) + String(digito2);
    }

    function cnpjsEquivalentes(a, b) {
        const da = digitsOnly(a);
        const db = digitsOnly(b);
        if (!da || !db) return false;
        return da === db;
    }

    function divergeCnpjXml(cnpjInformado, cnpjXmlOriginal) {
        const informado = digitsOnly(cnpjInformado);
        const original = digitsOnly(cnpjXmlOriginal);
        if (!informado || !original) return false;
        return informado !== original;
    }

    function mapFornecedorParaCompraImportada(fornecedor) {
        const f = fornecedor || {};
        return {
            fornecedor: String(f.nome || f.razao_social || '').trim(),
            fornecedor_cnpj: digitsOnly(f.cpf_cnpj),
            fornecedor_rua: f.rua || '',
            fornecedor_numero: f.numero || '',
            fornecedor_bairro: f.bairro || '',
            fornecedor_cidade: f.cidade || '',
            fornecedor_uf: f.uf || '',
            fornecedor_cep: f.cep || ''
        };
    }

    function montarCamposFornecedorSave(compraImportadaXml, cnpjDigitos, fornecedorNome) {
        const base = compraImportadaXml || {};
        return {
            fornecedor: String(fornecedorNome || base.fornecedor || '').trim(),
            fornecedor_cnpj: digitsOnly(cnpjDigitos) || digitsOnly(base.fornecedor_cnpj) || '',
            fornecedor_rua: base.fornecedor_rua || '',
            fornecedor_numero: base.fornecedor_numero || '',
            fornecedor_bairro: base.fornecedor_bairro || '',
            fornecedor_cidade: base.fornecedor_cidade || '',
            fornecedor_uf: base.fornecedor_uf || '',
            fornecedor_cep: base.fornecedor_cep || ''
        };
    }

    const api = {
        MSG_DIVERGENCIA_XML,
        digitsOnly,
        validarCnpjCompra,
        cnpjsEquivalentes,
        divergeCnpjXml,
        mapFornecedorParaCompraImportada,
        montarCamposFornecedorSave
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.ComprasFornecedorCnpjRc831 = api;
    }
})(typeof window !== 'undefined' ? window : global);
