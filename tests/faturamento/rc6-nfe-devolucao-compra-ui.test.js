/**
 * RC6 — Tela dedicada de Devolução de Compra (UI + integração com RC1–RC4).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC6 — superfície da tela dedicada', () => {
  it('página, rota de navegação e permissão fiscal existem', () => {
    const index = read('frontend/erp/index.html');
    const app = read('frontend/erp/js/app.js');
    const core = read('frontend/shared/js/core.js');
    const shell = read('frontend/shared/js/cds-page-shell.js');
    assert.match(index, /nfe-devolucao-compra\.js/);
    assert.match(app, /nfe-devolucao-compra/);
    assert.match(app, /loadNfeDevolucaoCompra/);
    assert.match(core, /nfe-devolucao-compra/);
    assert.match(core, /Devolução de Compra/);
    assert.match(shell, /nfe-devolucao-compra/);
  });

  it('Central NF-e e Nova NF-e oferecem Devolução de Compra', () => {
    const central = read('frontend/erp/js/nfe-central.js');
    const avulsa = read('frontend/erp/js/nfe-avulsa.js');
    assert.match(central, /Nova NF-e/);
    assert.match(central, /Devolução de Compra/);
    assert.match(central, /nfe-devolucao-compra/);
    assert.match(avulsa, /Devolução de Compra/);
    assert.match(avulsa, /NF_AVULSA/);
    assert.match(avulsa, /loadPage\('nfe-devolucao-compra'\)/);
  });

  it('Compras abre a tela dedicada com a compra carregada', () => {
    const compras = read('frontend/erp/js/compras.js');
    assert.match(compras, /function abrirTelaNfeDevolucaoCompra/);
    assert.match(compras, /__CDS_NFE_DEVOLUCAO_COMPRA_ID/);
    assert.match(compras, /abrirTelaNfeDevolucaoCompra\(\$\{c\.id\}\)/);
  });

  it('mockup: stepper, origem, itens, totais, finNFe e NFref', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /Devolução de Compra/);
    assert.match(ui, /Devolver mercadoria ao fornecedor/);
    assert.match(ui, /Selecionar NF-e/);
    assert.match(ui, /Itens e Quantidades/);
    assert.match(ui, /Revisão Fiscal/);
    assert.match(ui, /NF-e de Origem \(Fornecedor\)/);
    assert.match(ui, /Digite ou cole a chave de acesso/);
    assert.match(ui, /Ou selecionar uma compra/);
    assert.match(ui, /Qtd\. Devolver/);
    assert.match(ui, /Quantidade superior ao saldo disponível/);
    assert.match(ui, /Totais da Devolução/);
    assert.match(ui, /finNFe = 4/);
    assert.match(ui, /DEVOLUÇÃO DE COMPRA/);
    assert.match(ui, /Comparação Fiscal/);
    assert.match(ui, /Emitir NF-e de Devolução/);
    assert.match(ui, /Gerando XML/);
    assert.match(ui, /Assinando/);
    assert.match(ui, /Baixar XML/);
    assert.match(ui, /Imprimir DANFE/);
    assert.match(ui, /Ver Lifecycle/);
    assert.match(ui, /NF-e rejeitada/);
    assert.match(ui, /ndc-itens-cards/);
  });
});

describe('RC6 — reutiliza APIs RC1–RC4 sem motor paralelo', () => {
  it('consome preparar, origens, previa, emitir, xml, danfe, status, reenviar', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /nfe-devolucao\/preparar/);
    assert.match(ui, /nfe-devolucao\/origens/);
    assert.match(ui, /nfe-devolucao\/previa/);
    assert.match(ui, /emitir-nfe-devolucao/);
    assert.match(ui, /nfe-devolucao\/\$\{notaId\}\/xml/);
    assert.match(ui, /nfe-devolucao\/\$\{notaId\}\/danfe/);
    assert.match(ui, /nfe-devolucao\/\$\{notaId\}\/status/);
    assert.match(ui, /nfe-devolucao\/\$\{notaId\}\/consultar/);
    assert.match(ui, /nfe-devolucao\/\$\{notaId\}\/reenviar/);
    assert.match(ui, /nfe-devolucao\/\$\{notaId\}\/eventos/);
    assert.doesNotMatch(ui, /assinarNFe|enviarLote|buildXmlNFe/);
  });

  it('rota de origens existe e rotas fiscais oficiais permanecem', () => {
    const rotas = read('backend/rotas/compras.js');
    assert.match(rotas, /nfe-devolucao\/origens/);
    assert.match(rotas, /listarOrigensNfeDevolucaoCompra/);
    assert.match(rotas, /:id\/nfe-devolucao\/preparar/);
    assert.match(rotas, /:id\/emitir-nfe-devolucao/);
    assert.match(rotas, /nfe-devolucao\/:notaId\/cancelar/);
  });

  it('validação de origem e saldo continuam no backend', () => {
    const svc = read('backend/services/fiscal/nfeDevolucaoCompra.js');
    assert.match(svc, /function avaliarValidacaoNfeOrigemDevolucao/);
    assert.match(svc, /Esta NF-e está cancelada e não pode ser utilizada para devolução/);
    assert.match(svc, /Chave de acesso inválida/);
    assert.match(svc, /carregarSaldosDevolucaoCompra/);
    assert.match(svc, /espelharTributosNfeDevolucaoCompra/);
  });

  it('frontend não inventa saldo: usa saldo retornado pela API', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /it\.saldo/);
    assert.doesNotMatch(ui, /quantidade_comprada\s*-\s*quantidade_devolvida/);
  });

  it('não altera builders RC1/RC2/RC5', () => {
    const compra = read('backend/services/fiscal/xmlBuilderNfeDevolucaoCompra.js');
    const venda = read('backend/services/fiscal/xmlBuilderNfeDevolucaoVenda.js');
    assert.match(compra, /<finNFe>4<\/finNFe>/);
    assert.match(venda, /<finNFe>4<\/finNFe>/);
  });
});

describe('RC6 — validação de origem no backend', () => {
  const {
    avaliarValidacaoNfeOrigemDevolucao
  } = require('../../backend/services/fiscal/nfeDevolucaoCompra');

  it('chave inválida, inexistente e cancelada', () => {
    const inexistente = avaliarValidacaoNfeOrigemDevolucao({});
    assert.equal(inexistente.ok, false);
    assert.match(inexistente.erros[0].mensagem, /inexistente/i);

    const chave = avaliarValidacaoNfeOrigemDevolucao({
      compra: { chave_acesso: '123', status: 'finalizada', modelo_nf: '55' }
    });
    assert.equal(chave.ok, false);
    assert.ok(chave.erros.some((e) => /Chave de acesso inválida/.test(e.mensagem)));

    const cancelada = avaliarValidacaoNfeOrigemDevolucao({
      compra: {
        chave_acesso: '35260112345678000123550010000012341000012345',
        status: 'cancelada',
        modelo_nf: '55'
      }
    });
    assert.equal(cancelada.ok, false);
    assert.ok(cancelada.erros.some((e) => /cancelada/.test(e.mensagem)));
  });
});

describe('RC6 — seleção, quantidade, emissão e lifecycle na UI', () => {
  it('chave válida/inválida/inexistente/cancelada', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /Chave de acesso inválida/);
    assert.match(ui, /NF-e inexistente/);
    assert.match(ui, /validacaoOrigem/);
  });

  it('seleção assume saldo e quantidade 0 não participa', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /it\.qtdDevolver = Number\(it\.saldo/);
    assert.match(ui, /filter\(\(it\) => it\.selecionado && Number\(it\.qtdDevolver\) > 0\)/);
    assert.match(ui, /Selecionar todos/);
  });

  it('emissão: sucesso, rejeição, erro e processamento 103', () => {
    const ui = read('frontend/erp/js/nfe-devolucao-compra.js');
    assert.match(ui, /NF-e autorizada/);
    assert.match(ui, /NF-e rejeitada/);
    assert.match(ui, /cStat.*103|=== '103'/);
    assert.match(ui, /consultar/);
    assert.match(ui, /cancelada/);
    assert.match(ui, /emitindo/);
  });
});
