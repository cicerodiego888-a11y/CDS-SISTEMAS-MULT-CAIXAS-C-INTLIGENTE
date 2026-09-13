'use strict';

/**
 * RC8.3.1 — CNPJ do fornecedor na Entrada de Compras.
 * Executar: npm run test:rc831-compras-cnpj
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const helpers = require(path.join(root, 'frontend/erp/js/compras-fornecedor-cnpj-rc831.js'));
const comprasSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/compras.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/app.js'), 'utf8');

const CNPJ_VALIDO = '11222333000181';
const CNPJ_XML = '98765432000111';
const CNPJ_OUTRO = '11444777000161';

describe('RC8.3.1 — helpers CNPJ fornecedor', () => {
    it('valida CNPJ vazio como permitido', () => {
        assert.equal(helpers.validarCnpjCompra(''), true);
        assert.equal(helpers.validarCnpjCompra(null), true);
    });

    it('valida CNPJ com 14 dígitos e dígitos verificadores', () => {
        assert.equal(helpers.validarCnpjCompra(CNPJ_VALIDO), true);
        assert.equal(helpers.validarCnpjCompra('11.222.333/0001-81'), true);
        assert.equal(helpers.validarCnpjCompra('123'), false);
        assert.equal(helpers.validarCnpjCompra('11111111111111'), false);
    });

    it('detecta divergência entre CNPJ informado e emitente do XML', () => {
        assert.equal(helpers.divergeCnpjXml(CNPJ_OUTRO, CNPJ_XML), true);
        assert.equal(helpers.divergeCnpjXml(CNPJ_XML, CNPJ_XML), false);
        assert.equal(helpers.divergeCnpjXml('', CNPJ_XML), false);
    });

    it('mapeia fornecedor cadastrado para compraImportadaXml', () => {
        const mapped = helpers.mapFornecedorParaCompraImportada({
            nome: 'Fornecedor Teste',
            cpf_cnpj: '11.222.333/0001-81',
            rua: 'Rua A',
            numero: '100',
            bairro: 'Centro',
            cidade: 'Fortaleza',
            uf: 'CE',
            cep: '60000-000'
        });

        assert.equal(mapped.fornecedor, 'Fornecedor Teste');
        assert.equal(mapped.fornecedor_cnpj, CNPJ_VALIDO);
        assert.equal(mapped.fornecedor_cidade, 'Fortaleza');
        assert.equal(mapped.fornecedor_uf, 'CE');
    });

    it('monta campos de save priorizando CNPJ do formulário', () => {
        const base = {
            fornecedor: 'Antigo',
            fornecedor_cnpj: CNPJ_XML,
            fornecedor_rua: 'Rua XML',
            fornecedor_cidade: 'Cidade XML'
        };

        const campos = helpers.montarCamposFornecedorSave(base, CNPJ_OUTRO, 'Novo Nome');
        assert.equal(campos.fornecedor, 'Novo Nome');
        assert.equal(campos.fornecedor_cnpj, CNPJ_OUTRO);
        assert.equal(campos.fornecedor_rua, 'Rua XML');
        assert.equal(campos.fornecedor_cidade, 'Cidade XML');
    });

    it('alterar somente o nome mantém CNPJ do payload de save', () => {
        const campos = helpers.montarCamposFornecedorSave(
            { fornecedor_cnpj: CNPJ_XML, fornecedor_rua: 'Rua' },
            CNPJ_XML,
            'Nome Alterado'
        );
        assert.equal(campos.fornecedor, 'Nome Alterado');
        assert.equal(campos.fornecedor_cnpj, CNPJ_XML);
    });

    it('fornecedor inexistente envia CNPJ informado para auto-cadastro', () => {
        const campos = helpers.montarCamposFornecedorSave({}, CNPJ_OUTRO, 'Fornecedor Novo');
        assert.equal(campos.fornecedor_cnpj, CNPJ_OUTRO);
        assert.equal(campos.fornecedor, 'Fornecedor Novo');
    });
});

describe('RC8.3.1 — contrato UI compras.js', () => {
    it('modal possui campo CNPJ com máscara e handlers', () => {
        assert.match(comprasSrc, /id="fornecedor_cnpj"/);
        assert.match(comprasSrc, /onFornecedorCnpjInput/);
        assert.match(comprasSrc, /onFornecedorCnpjBlur/);
        assert.match(comprasSrc, /Fornecedor \(Nome\)/);
    });

    it('exibe alerta de divergência XML × CNPJ sem bloquear', () => {
        assert.match(comprasSrc, /alertaCnpjXmlDivergente/);
        assert.match(comprasSrc, /diferente do emitente da NF-e importada/);
        assert.match(comprasSrc, /atualizarAlertaCnpjXmlDivergente/);
    });

    it('consulta fornecedor por CNPJ na API', () => {
        assert.match(comprasSrc, /buscarFornecedorPorCnpj/);
        assert.match(comprasSrc, /\/fornecedores\?busca=/);
    });

    it('reexecuta MIIP ao alterar CNPJ', () => {
        assert.match(comprasSrc, /carregarSugestoesMiipXml\(\)/);
        assert.match(comprasSrc, /obterCnpjCompraDigitos/);
    });

    it('saveCompra lê CNPJ do campo do formulário', () => {
        assert.match(comprasSrc, /montarCamposFornecedorSave/);
        assert.match(comprasSrc, /obterCnpjCompraDigitos\(\)/);
        assert.doesNotMatch(comprasSrc, /fornecedor_cnpj: compraImportadaXml\?\.fornecedor_cnpj \|\| ''/);
    });

    it('helper RC8.3.1 carregado antes de compras.js', () => {
        assert.match(appSrc, /compras-fornecedor-cnpj-rc831\.js/);
        const idxHelper = appSrc.indexOf('compras-fornecedor-cnpj-rc831.js');
        const idxCompras = appSrc.indexOf("'/erp/js/compras.js'");
        assert.ok(idxHelper > 0 && idxCompras > idxHelper);
    });
});

console.log('RC8.3.1 — testes concluídos');
