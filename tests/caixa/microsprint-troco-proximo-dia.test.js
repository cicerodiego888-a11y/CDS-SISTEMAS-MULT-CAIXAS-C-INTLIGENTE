'use strict';

/**
 * Etapa 4 "Retirada no fechamento" — troco reservado para o próximo dia (somente texto/visual).
 * Usa o HTML real da tela e o recálculo real (ligarCalculos) com DOM e jQuery mínimos.
 * node --test tests/caixa/microsprint-troco-proximo-dia.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');
const UI_CODE = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/fechamentoCaixaV2Ui.js'), 'utf8');

const resumo = {
  caixa: { id: 1, aberto_em: '2026-10-11 08:00:00' },
  dinheiro: { valor_inicial: 100, vendas_dinheiro: 201.99, suprimentos: 0, sangrias: 0, dinheiro_esperado: 301.99 },
  digital: { pix: 0, cartao_credito: 0, cartao_debito: 0, total_digital: 0 },
  total_vendido: 201.99,
  total_recebido: 201.99,
  consolidacao: { reconciliacao: { vendas_ok: 1, vendas: [] }, caixa_fisico: { dinheiro_esperado: 301.99 } }
};

function montarTela() {
  const els = {};
  const handlers = [];
  const criar = (id, attrs = '') => {
    const classe = /class="([^"]*)"/.exec(attrs);
    const valor = /value="([^"]*)"/.exec(attrs);
    const classes = new Set(classe ? classe[1].split(/\s+/).filter(Boolean) : []);
    els[id] = {
      id,
      value: valor ? valor[1] : '',
      textContent: '',
      checked: /\schecked\b/.test(attrs),
      classes,
      classList: { add: (c) => classes.add(c), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) }
    };
    return els[id];
  };

  const sandbox = { module: { exports: {} }, console };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.document = { getElementById: (id) => els[id] || null, querySelector: () => null, activeElement: null };
  vm.createContext(sandbox);
  vm.runInContext(UI_CODE, sandbox);
  const Ui = sandbox.FechamentoCaixaV2Ui;

  const html = Ui.montarHtmlTelaAberta(resumo);
  for (const m of html.matchAll(/<\w+([^>]*\sid="([^"]+)"[^>]*)>/g)) criar(m[2], m[1]);

  const resolver = (sel) => {
    if (sel === sandbox.document) return [];
    return String(sel).split(',').map((s) => s.trim()).flatMap((s) => {
      if (s === 'input[name="caixa-v2-retirada"]:checked') {
        return ['caixa-v2-ret-nao', 'caixa-v2-ret-tudo', 'caixa-v2-ret-valor'].map((id) => els[id]).filter((e) => e.checked);
      }
      if (s.startsWith('#')) return [els[s.slice(1)] || criar(s.slice(1))];
      return [];
    });
  };
  const $ = (sel) => {
    const lista = resolver(sel);
    const w = {
      length: lista.length,
      val(v) {
        if (arguments.length) { lista.forEach((e) => { e.value = v; }); return w; }
        return lista[0] ? lista[0].value : undefined;
      },
      text(v) {
        if (arguments.length) { lista.forEach((e) => { e.textContent = v; }); return w; }
        return lista[0] ? lista[0].textContent : '';
      },
      addClass(c) { lista.forEach((e) => e.classes.add(c)); return w; },
      removeClass(c) { lista.forEach((e) => String(c).split(/\s+/).forEach((x) => e.classes.delete(x))); return w; },
      toggleClass(c, on) { lista.forEach((e) => (on ? e.classes.add(c) : e.classes.delete(c))); return w; },
      prop() { return w; },
      removeAttr() { return w; },
      on(evts, _sel, fn) { if (/input\.caixaV2/.test(evts)) handlers.push(fn); return w; },
      off() { return w; }
    };
    return w;
  };
  sandbox.$ = $;
  Ui.ligarCalculos(301.99);

  const disparar = () => handlers.forEach((fn) => fn());
  return {
    Ui,
    els,
    contar(valor) { els['valor-fechamento'].value = valor; disparar(); },
    modo(m) {
      const ids = { nenhuma: 'caixa-v2-ret-nao', total: 'caixa-v2-ret-tudo', valor: 'caixa-v2-ret-valor' };
      Object.values(ids).forEach((id) => { els[id].checked = id === ids[m]; });
      disparar();
    },
    retirar(valor) { els['caixa-v2-retirada-valor'].value = valor; disparar(); },
    saldo: () => els['caixa-v2-saldo-final'].textContent.replace(/\s/g, ' '),
    visivel: (id) => !els[id].classes.has('d-none'),
    destaque: () => els['caixa-v2-saldo-box'].classes.has('is-troco')
  };
}

function assertTextoTroco(t, ativo) {
  assert.equal(t.visivel('caixa-v2-troco-rotulo'), ativo, 'rótulo de troco');
  assert.equal(t.visivel('caixa-v2-troco-hint'), ativo, 'texto explicativo');
  assert.equal(t.visivel('caixa-v2-saldo-rotulo'), !ativo, 'rótulo antigo');
  assert.equal(t.visivel('caixa-v2-saldo-hint'), !ativo, 'dica antiga');
  assert.equal(t.destaque(), ativo, 'destaque do valor');
}

describe('Retirada no fechamento — troco reservado para o próximo dia', () => {
  it('HTML mantém títulos e traz os novos textos da opção Informar valor', () => {
    const { Ui } = montarTela();
    const html = Ui.montarHtmlTelaAberta(resumo);
    assert.match(html, /Retirada no fechamento/);
    assert.match(html, /Informar valor/);
    assert.match(html, /Quanto vai retirar\?/);
    assert.match(html, /Troco reservado para o próximo dia/);
    assert.match(html, /Esse valor permanecerá no caixa para facilitar o troco nas vendas do próximo dia\./);
    assert.match(html, /Saldo que ficará no caixa/);
  });

  it('Informar valor: exibe o troco restante em destaque com o texto explicativo', () => {
    const t = montarTela();
    t.contar('592,35');
    t.modo('valor');
    t.retirar('392,35');
    assert.equal(t.saldo(), 'R$ 200,00');
    assertTextoTroco(t, true);
  });

  it('atualiza o troco ao editar a retirada', () => {
    const t = montarTela();
    t.contar('301,99');
    t.modo('valor');
    t.retirar('101,99');
    assert.equal(t.saldo(), 'R$ 200,00');
    t.retirar('50,00');
    assert.equal(t.saldo(), 'R$ 251,99');
    t.retirar('301,99');
    assert.equal(t.saldo(), 'R$ 0,00');
    t.retirar('');
    assert.equal(t.saldo(), 'R$ 301,99');
    assertTextoTroco(t, true);
  });

  it('fechamento parcial: payload e saldo inalterados', () => {
    const t = montarTela();
    t.contar('301,99');
    t.modo('valor');
    t.retirar('101,99');
    const p = t.Ui.coletarPayload(false);
    assert.equal(p.modo_retirada, 'valor');
    assert.equal(p.dinheiro_conferido, 301.99);
    assert.equal(p.retirada_fechamento, 101.99);
    assert.equal(t.saldo(), 'R$ 200,00');
  });

  it('Retirar tudo e Não retirar mantêm rótulo, valor e payload anteriores', () => {
    const t = montarTela();
    t.contar('301,99');
    t.modo('total');
    assert.equal(t.saldo(), 'R$ 0,00');
    assertTextoTroco(t, false);
    assert.equal(t.Ui.coletarPayload(false).retirada_fechamento, 301.99);

    t.modo('nenhuma');
    assert.equal(t.saldo(), 'R$ 301,99');
    assertTextoTroco(t, false);
    assert.equal(t.Ui.coletarPayload(false).retirada_fechamento, 0);

    t.modo('valor');
    t.retirar('101,99');
    assertTextoTroco(t, true);
    t.modo('total');
    assert.equal(t.saldo(), 'R$ 0,00');
    assertTextoTroco(t, false);
  });
});
