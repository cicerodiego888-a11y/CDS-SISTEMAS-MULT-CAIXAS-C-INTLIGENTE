/**
 * Fechamento de Caixa V2 UX 1.0 — estrutura, linguagem e payload.
 * node --test tests/caixa/fechamento-caixa-v2-ux.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const UI_PATH = path.join(ROOT, 'frontend/shared/js/fechamentoCaixaV2Ui.js');

function loadUi() {
  const sandbox = { module: { exports: {} } };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  const code = fs.readFileSync(UI_PATH, 'utf8');
  const fn = new Function('window', 'global', 'module', 'exports', code + '\nreturn module.exports || window.FechamentoCaixaV2Ui;');
  const Ui = fn(sandbox, sandbox, sandbox.module, sandbox.module.exports);
  return { Ui, sandbox };
}

function resumoFixture() {
  return {
    caixa: { id: 1, data: '2026-01-26', aberto_em: '2026-01-26 08:02:00', terminal_id: 'T01' },
    dinheiro: {
      valor_inicial: 50,
      vendas_dinheiro: 10,
      suprimentos: 0,
      sangrias: 0,
      dinheiro_esperado: 60
    },
    digital: { pix: 1.6, cartao_credito: 0, cartao_debito: 0, total_digital: 1.6 },
    total_vendido: 11.6,
    total_recebido: 11.6,
    total_pendente: 0,
    prazo: 0,
    tef: 0,
    outras_formas: 0,
    entregas_pendentes: 0,
    saldo_fisico: 60,
    total_financeiro_sessao: 11.6,
    consolidacao: {
      reconciliacao: { vendas_ok: 1, vendas_parciais: 0, vendas_pendentes: 0, vendas_inconsistentes: 0, vendas: [] },
      caixa_fisico: { dinheiro_esperado: 60 },
      pagamentos: { dinheiro: 10, pix: 1.6, credito: 0, debito: 0, tef: 0, prazo: 0, outros: 0 }
    }
  };
}

function fake$(store) {
  const api = (sel) => ({
    val(v) {
      if (arguments.length) { store[sel] = v; return this; }
      if (sel === 'input[name="caixa-v2-retirada"]:checked') return store.modo || 'nenhuma';
      return store[sel] != null ? store[sel] : '';
    },
    prop() { return this; },
    text() { return this; },
    addClass() { return this; },
    removeClass() { return this; },
    toggleClass() { return this; }
  });
  api.off = () => api;
  api.on = () => api;
  return api;
}

describe('Fechamento Caixa V2 UX 1.0', () => {
  it('fonte da UI preserva contrato e atalho Retirar tudo', () => {
    const ui = fs.readFileSync(UI_PATH, 'utf8');
    assert.match(ui, /Retirar tudo/);
    assert.match(ui, /fechar_com_divergencia/);
    assert.match(ui, /valor_informado/);
    assert.match(ui, /dinheiro_conferido/);
    assert.match(ui, /retirada_fechamento/);
    assert.match(ui, /id="valor-fechamento"/);
    assert.match(ui, /id="btn-fechar-caixa-v2"/);
    assert.match(ui, /id="btn-fechar-caixa-div-v2"/);
    assert.match(ui, /id="caixa-v2-esperado"/);
    assert.match(ui, /id="caixa-v2-diferenca"/);
    assert.match(ui, /id="caixa-v2-saldo-final"/);
    assert.doesNotMatch(ui, /1\. Resumo da sessão/);
    assert.doesNotMatch(ui, /6\. Conclusão/);
  });

  it('três cards + conferência + retirada + movimentações + finalizar numa única tela', () => {
    const { Ui } = loadUi();
    const html = Ui.montarHtmlTelaAberta(resumoFixture());
    assert.match(html, /Dinheiro Físico/);
    assert.match(html, /Recebimentos Digitais/);
    assert.match(html, /Resumo Geral/);
    assert.match(html, /Dinheiro Esperado/);
    assert.match(html, /Total Digital/);
    assert.match(html, /Total financeiro da sessão/);
    assert.doesNotMatch(html, /Saldo físico \(esperado\)/);
    assert.match(html, /Conferência do dinheiro/);
    assert.match(html, /Quanto você contou\?/);
    assert.match(html, /Retirada no fechamento/);
    assert.match(html, /Não retirar/);
    assert.match(html, /Retirar tudo/);
    assert.match(html, /Informar valor/);
    assert.match(html, /Saldo que ficará no caixa/);
    assert.match(html, /Movimentações do Caixa/);
    assert.match(html, /Registrar Sangria/);
    assert.match(html, /Registrar Suprimento/);
    assert.match(html, /Finalizar Fechamento/);
    assert.match(html, /Dinheiro conferido/);
    assert.match(html, /Diferença física/);
    assert.match(html, /caixa-v2-ver-inconsistencias/);
    assert.match(html, /id="caixa-v2-tela"/);
    assert.match(html, /cds-ui-fc-scroll/);
    assert.match(html, /id="caixa-v2-acoes"/);
    assert.doesNotMatch(html, /wizard/i);

    const css = fs.readFileSync(
      path.join(ROOT, 'frontend/shared/design-system/cds-ui-foundation.css'),
      'utf8'
    );
    assert.match(css, /\.cds-ui-fc-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(css, /\.cds-ui-fc-scroll\s*\{[^}]*max-height:\s*calc\(/s);
    assert.match(css, /#caixa-area\s*~\s*\.card/);
    assert.match(css, /#caixa-consulta-anteriores/);
    assert.match(css, /display:\s*block\s*!important/);
    assert.match(css, /cds-ui-fc-consulta-peek/);
    assert.match(html, /btn-caixa-v2-ver-anteriores|Caixas anteriores/);
  });

  it('coletarPayload preserva contrato financeiro', () => {
    const { Ui, sandbox } = loadUi();
    const store = {
      '#valor-fechamento': '60,00',
      modo: 'valor',
      '#caixa-v2-retirada-valor': '20,00',
      '#observacao-fechamento': 'ok',
      '#caixa-v2-justificativa': ''
    };
    sandbox.$ = fake$(store);
    const payload = Ui.coletarPayload(false);
    assert.equal(payload.valor_informado, 60);
    assert.equal(payload.dinheiro_conferido, 60);
    assert.equal(payload.modo_retirada, 'valor');
    assert.equal(payload.retirada_fechamento, 20);
    assert.equal(payload.observacao, 'ok');
    assert.equal(payload.justificativa_divergencia, '');
    assert.equal(payload.fechar_com_divergencia, false);
    const comDiv = Ui.coletarPayload(true);
    assert.equal(comDiv.fechar_com_divergencia, true);
  });

  it('retirar tudo usa o dinheiro conferido no payload', () => {
    const { Ui, sandbox } = loadUi();
    const store = {
      '#valor-fechamento': '60,00',
      modo: 'total',
      '#caixa-v2-retirada-valor': '999,00',
      '#observacao-fechamento': '',
      '#caixa-v2-justificativa': ''
    };
    sandbox.$ = fake$(store);
    const payload = Ui.coletarPayload(false);
    assert.equal(payload.modo_retirada, 'total');
    assert.equal(payload.retirada_fechamento, 60);
  });

  it('CASO 1 — Resumo Geral usa 85,70 e não o dinheiro esperado 60', () => {
    const { Ui } = loadUi();
    const resumo = {
      dinheiro: { valor_inicial: 50, vendas_dinheiro: 10, suprimentos: 0, sangrias: 0, dinheiro_esperado: 60 },
      digital: { pix: 4.2, cartao_credito: 71.5, cartao_debito: 0, total_digital: 75.7 },
      total_vendido: 85.7,
      total_recebido: 85.7,
      total_pendente: 0,
      prazo: 0,
      tef: 0,
      outras_formas: 0,
      entregas_pendentes: 0,
      saldo_fisico: 60,
      total_financeiro_sessao: 85.7
    };
    const r = Ui.obterResumoV2(resumo);
    assert.equal(r.totalFinanceiro, 85.7);
    assert.equal(r.esperado, 60);
    const html = Ui.montarHtmlTelaAberta(resumo);
    assert.match(html, /id="caixa-v2-val-financeiro"[^>]*>[^<]*85,70/);
    assert.match(html, /id="caixa-v2-card-esperado"[^>]*>[^<]*60,00/);
    assert.match(html, /id="caixa-v2-val-digital"[^>]*>[^<]*75,70/);
    assert.doesNotMatch(html, /135,70/);
    assert.doesNotMatch(html, /Saldo físico \(esperado\)/);
  });

  it('CASO 2 — venda só em dinheiro: resumo = 100', () => {
    const { Ui } = loadUi();
    const resumo = {
      dinheiro: { valor_inicial: 0, vendas_dinheiro: 100, dinheiro_esperado: 100 },
      digital: { pix: 0, cartao_credito: 0, cartao_debito: 0, total_digital: 0 },
      total_vendido: 100,
      total_recebido: 100,
      saldo_fisico: 100,
      total_financeiro_sessao: 100
    };
    assert.equal(Ui.obterResumoV2(resumo).totalFinanceiro, 100);
    assert.match(Ui.montarHtmlTelaAberta(resumo), /id="caixa-v2-val-financeiro"[^>]*>[^<]*100,00/);
  });

  it('CASO 3 — venda só digital: resumo = 100, não o dinheiro esperado 0', () => {
    const { Ui } = loadUi();
    const resumo = {
      dinheiro: { valor_inicial: 0, vendas_dinheiro: 0, dinheiro_esperado: 0 },
      digital: { pix: 100, cartao_credito: 0, cartao_debito: 0, total_digital: 100 },
      total_vendido: 100,
      total_recebido: 100,
      saldo_fisico: 0,
      total_financeiro_sessao: 100
    };
    const r = Ui.obterResumoV2(resumo);
    assert.equal(r.totalFinanceiro, 100);
    assert.equal(r.esperado, 0);
    const html = Ui.montarHtmlTelaAberta(resumo);
    assert.match(html, /id="caixa-v2-val-financeiro"[^>]*>[^<]*100,00/);
    assert.match(html, /id="caixa-v2-card-esperado"[^>]*>[^<]*0,00/);
  });

  it('CASO 4 — mista 40 dinheiro + 60 PIX: resumo = 100', () => {
    const { Ui } = loadUi();
    const resumo = {
      dinheiro: { valor_inicial: 0, vendas_dinheiro: 40, dinheiro_esperado: 40 },
      digital: { pix: 60, cartao_credito: 0, cartao_debito: 0, total_digital: 60 },
      total_vendido: 100,
      total_recebido: 100,
      saldo_fisico: 40,
      total_financeiro_sessao: 100
    };
    const r = Ui.obterResumoV2(resumo);
    assert.equal(r.totalFinanceiro, 100);
    assert.equal(r.esperado, 40);
    const html = Ui.montarHtmlTelaAberta(resumo);
    assert.match(html, /id="caixa-v2-val-financeiro"[^>]*>[^<]*100,00/);
    assert.match(html, /id="caixa-v2-val-digital"[^>]*>[^<]*60,00/);
    assert.doesNotMatch(html, /id="caixa-v2-val-financeiro"[^>]*>[^<]*40,00/);
  });

  it('CASO 5 — parcial: vendido 100 / recebido 70 / pendente 30, sem usar gaveta', () => {
    const { Ui } = loadUi();
    const resumo = {
      dinheiro: { valor_inicial: 0, vendas_dinheiro: 0, dinheiro_esperado: 0 },
      digital: { pix: 70, cartao_credito: 0, cartao_debito: 0, total_digital: 70 },
      total_vendido: 100,
      total_recebido: 70,
      total_pendente: 30,
      saldo_fisico: 0,
      total_financeiro_sessao: 70
    };
    const r = Ui.obterResumoV2(resumo);
    assert.equal(r.totalVendido, 100);
    assert.equal(r.totalRecebido, 70);
    assert.equal(r.totalPendente, 30);
    assert.equal(r.totalFinanceiro, 70);
    assert.equal(r.esperado, 0);
    const html = Ui.montarHtmlTelaAberta(resumo);
    assert.match(html, /id="caixa-v2-val-vendido"[^>]*>[^<]*100,00/);
    assert.match(html, /id="caixa-v2-val-recebido"[^>]*>[^<]*70,00/);
    assert.match(html, /id="caixa-v2-val-pendente"[^>]*>[^<]*30,00/);
    assert.match(html, /id="caixa-v2-val-financeiro"[^>]*>[^<]*70,00/);
  });
});
