/**
 * RC4.0.1 — Central de Faturamento UX (pendências, timeline, documentos).
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SVC = 'backend/services/faturamento/CentralFaturamentoService.js';
const UI = 'frontend/erp/js/central-faturamento.js';
const ROTAS = 'backend/rotas/centralFaturamento.js';

describe('RC4.0.1 — Backend operacional', () => {
  it('exporta montadores de painéis', () => {
    const Central = require('../../backend/services/faturamento/CentralFaturamentoService');
    assert.equal(typeof Central.montarChecklist, 'function');
    assert.equal(typeof Central.montarAlertas, 'function');
    assert.equal(typeof Central.montarTimeline, 'function');
    assert.equal(typeof Central.montarResumoFiscal, 'function');
    assert.equal(typeof Central.montarLogSefaz, 'function');
    assert.equal(typeof Central.montarAcoesDocumentos, 'function');
    assert.ok(Array.isArray(Central.MODULOS_FUTUROS));
    assert.ok(Central.MODULOS_FUTUROS.some((m) => m.id === 'nfe' && m.ativo));
    assert.ok(Central.MODULOS_FUTUROS.some((m) => m.id === 'cce' && m.preparado));
  });

  it('checklist cobre itens obrigatórios do sprint', () => {
    const src = read(SVC);
    const codigos = [
      'cpf_cnpj', 'nome', 'cep', 'municipio', 'uf', 'endereco', 'ind_ie',
      'natureza', 'cfop', 'ncm', 'cfg_produtos', 'cert_instalado', 'cert_valido',
      'serie', 'numeracao', 'ambiente', 'csc', 'xml_pronto'
    ];
    for (const c of codigos) {
      assert.match(src, new RegExp(`'${c}'`));
    }
    assert.match(src, /Existem pendências fiscais que impedem a emissão/);
  });

  it('bloquear emissão com documento inválido', async () => {
    const { montarChecklist } = require('../../backend/services/faturamento/CentralFaturamentoService');
    const pacote = {
      venda: {
        id: 1,
        cliente_nome: '',
        cliente_cpf: '',
        cliente_rua: '',
        cliente_cidade: '',
        cliente_uf: '',
        cliente_cep: '',
        total: 10
      },
      itens: [{ quantidade_fiscal: 1, valor_fiscal: 10, produto_ncm: '', produto_csosn: '', produto_cfop: '' }],
      pedido: null,
      nota: null
    };
    const checklist = await montarChecklist(pacote, {});
    assert.equal(checklist.pode_emitir, false);
    assert.ok(checklist.resumo.erro >= 1);
    assert.match(checklist.mensagem_bloqueio || '', /pendências fiscais/);
    const doc = checklist.itens.find((i) => i.codigo === 'cpf_cnpj');
    assert.equal(doc.nivel, 'erro');
  });

  it('documentos respeitam status e preparam CCe/manifestação', () => {
    const { montarAcoesDocumentos } = require('../../backend/services/faturamento/CentralFaturamentoService');
    const semNota = montarAcoesDocumentos({ nota: null });
    assert.equal(semNota.visualizar_xml.habilitado, false);
    assert.equal(semNota.carta_correcao.preparado, true);
    assert.equal(semNota.carta_correcao.habilitado, false);

    const auth = montarAcoesDocumentos({
      nota: {
        id: 9,
        status: 'autorizada',
        xml_enviado: '<nfe/>',
        danfe_html: '<html/>',
        chave_acesso: '3524...'
      }
    });
    assert.equal(auth.cancelar.habilitado, true);
    assert.equal(auth.reenviar.habilitado, false);
    assert.equal(auth.copiar_chave.habilitado, true);
  });

  it('resumo e log SEFAZ montam estrutura esperada', () => {
    const {
      montarResumoFiscal,
      montarLogSefaz
    } = require('../../backend/services/faturamento/CentralFaturamentoService');
    const pacote = {
      venda: { total: 100, valor_fiscal: 100, forma_pagamento: 'PIX', frete: 0, desconto: 5 },
      itens: [{ valor_fiscal: 100 }],
      pedido: { frete: 10, peso: 2, volumes: 1, transportadora: 'Transp X', cfop: '5102' },
      nota: {
        numero: 12,
        serie: 1,
        ambiente: 2,
        status: 'rejeitada',
        erro_mensagem: 'Rejeição teste',
        erro_sugestao: 'Corrigir dest',
        xml_enviado: '<x/>',
        venda_id: 7,
        tentativas: 2
      }
    };
    const resumo = montarResumoFiscal(pacote, { natureza_operacao: 'VENDA' }, { dados_avaliados: { serie: 1, ambiente: 2, cfop: '5102' } });
    assert.equal(resumo.modelo, 55);
    assert.equal(resumo.valor_desconto, 5);
    assert.equal(resumo.qtd_itens, 1);

    const log = montarLogSefaz(pacote);
    assert.equal(log.disponivel, true);
    assert.ok(log.rejeicao);
    assert.match(log.rejeicao.link_xml, /central-faturamento/);
  });

  it('rota consultar situação registrada', () => {
    const src = read(ROTAS);
    assert.match(src, /\/vendas\/:vendaId\/consultar/);
    assert.match(src, /consultarSituacao/);
  });
});

describe('RC4.0.1 — UI Centro Operacional', () => {
  it('renderiza painéis do sprint', () => {
    const src = read(UI);
    assert.match(src, /Pendências para emissão/);
    assert.match(src, /cfPendencias/);
    assert.match(src, /Timeline Fiscal/);
    assert.match(src, /cfTimeline/);
    assert.match(src, /Central de Documentos/);
    assert.match(src, /cfDocumentos/);
    assert.match(src, /Resumo Fiscal/);
    assert.match(src, /cfResumoFiscal/);
    assert.match(src, /Log da SEFAZ/);
    assert.match(src, /cfLogSefaz/);
    assert.match(src, /cfAlertas/);
    assert.match(src, /cfModulosFuturos/);
    assert.match(src, /Existem pendências fiscais que impedem a emissão/);
    assert.match(src, /cfBtnEmitir/);
  });

  it('ações de documento cobrem o card 3', () => {
    const src = read(UI);
    for (const a of [
      'visualizar_xml', 'download_xml', 'visualizar_danfe', 'reimprimir_danfe',
      'copiar_chave', 'consultar_situacao', 'reenviar', 'cancelar',
      'carta_correcao', 'manifestacao'
    ]) {
      assert.match(src, new RegExp(a));
    }
  });
});
