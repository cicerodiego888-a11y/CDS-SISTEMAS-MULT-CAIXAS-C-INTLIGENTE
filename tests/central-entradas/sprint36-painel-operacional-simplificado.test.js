/**
 * Sprint 3.6 — Painel "CENTRAL DE ENTRADAS" sem indicadores técnicos.
 * Somente apresentação: dados de operação/reconciliação continuam vindo da API.
 *
 * Executar: node --test tests/central-entradas/sprint36-painel-operacional-simplificado.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const mainSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');
const diagSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-diagnostico.js'), 'utf8');

const OCULTOS = [
  /Último NSU/i,
  /MAX NSU/i,
  /XML pendentes/i,
  /Possíveis intervalos/i,
  /Posições não observadas/i,
  /Inconsistências/i,
  /Ações aguardando/i
];

function extrairFuncao(nome) {
  const inicio = mainSrc.search(new RegExp(`(async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  const fim = mainSrc.slice(inicio).search(/\r?\n\}\r?\n/);
  return mainSrc.slice(inicio, inicio + fim) + '\n}\n';
}

function renderizar(operacao, reconcilicao) {
  const wrap = { innerHTML: '', querySelectorAll: () => [], remove() { this.innerHTML = ''; } };
  const ctx = {
    document: { getElementById: (id) => (id === 'centralOperacaoWrap' ? wrap : null) },
    escapeHtmlCentralEntradas: (v) => String(v == null ? '' : v)
  };
  vm.createContext(ctx);
  vm.runInContext(`${extrairFuncao('renderPainelOperacaoCentral')}\nthis.__fn = renderPainelOperacaoCentral;`, ctx);
  ctx.__fn(operacao, reconcilicao);
  return wrap.innerHTML;
}

function renderizarChipModo(operacao) {
  const ctx = {
    centralEntradasState: {},
    escapeHtmlCentralEntradas: (v) => String(v == null ? '' : v)
  };
  vm.createContext(ctx);
  vm.runInContext(`${extrairFuncao('renderChipModoOperacaoCentral')}\nthis.__fn = renderChipModoOperacaoCentral;`, ctx);
  return ctx.__fn(operacao);
}

const PENDENTE = { action_id: 'a1', titulo: 'Baixar XML', motivo: 'XML completo disponível', labelAcao: 'EXECUTAR' };

const RESUMO_COMPLETO = {
  ultNsu: '000000000000428',
  maxNsu: '000000000000430',
  xmlPendentes: 7,
  possiveisIntervalosNsu: 3,
  posicoesNaoObservadas: 12,
  inconsistencias: 2,
  acoesAguardandoConfirmacao: 1
};
const RECONCILIACAO = {
  indicadores: { xmlPendentes: 7, possiveisIntervalosNsu: 3, posicoesNaoObservadas: 12, inconsistencias: 2 }
};

describe('Sprint 3.6 — painel operacional', () => {
  it('não exibe indicadores técnicos nem seus valores', () => {
    const html = renderizar({ modo: 'ASSISTIDO', resumo: RESUMO_COMPLETO, pendentes: [PENDENTE] }, RECONCILIACAO);
    OCULTOS.forEach((re) => assert.doesNotMatch(html, re));
    assert.doesNotMatch(html, /000000000000428|000000000000430/);
  });

  it('modo ASSISTIDO continua visível (chip do cabeçalho)', () => {
    const html = renderizarChipModo({ modo: 'ASSISTIDO', modoLabel: 'Assistido' });
    assert.match(html, /Modo: ASSISTIDO/);
    assert.doesNotMatch(html, /AUTOMÁTICO/);
  });

  it('modo AUTOMÁTICO continua visível (chip do cabeçalho)', () => {
    const html = renderizarChipModo({ modo: 'AUTOMATICO' });
    assert.match(html, /Modo: AUTOMÁTICO/);
  });

  it('sem pendências não sobra faixa vazia (nenhum card nem linha de métricas)', () => {
    const html = renderizar({ modo: 'ASSISTIDO', resumo: RESUMO_COMPLETO, pendentes: [] }, RECONCILIACAO);
    assert.equal(html, '');
  });

  it('modo ASSISTIDO com ações pendentes continua mostrando as ações confirmáveis', () => {
    const html = renderizar({
      modo: 'ASSISTIDO',
      resumo: RESUMO_COMPLETO,
      pendentes: [PENDENTE]
    }, RECONCILIACAO);
    assert.match(html, /AÇÕES PENDENTES/);
    assert.match(html, /central-btn-confirmar-acao/);
    assert.match(html, /data-action-id="a1"/);
    assert.doesNotMatch(html, /Ações aguardando/);
  });
});

describe('Sprint 3.6 — dados e diagnóstico preservados', () => {
  it('dashboard continua repassando operação e reconciliação ao painel', () => {
    assert.match(mainSrc, /renderPainelOperacaoCentral\(dashboard\.operacao, dashboard\.reconcilicao\)/);
  });

  it('diagnóstico técnico mantém os indicadores de NSU', () => {
    assert.match(diagSrc, /Último NSU recebido/);
    assert.match(diagSrc, /Último NSU processado/);
  });
});
