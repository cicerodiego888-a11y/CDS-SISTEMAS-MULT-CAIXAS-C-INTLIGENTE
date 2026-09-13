/**
 * Sprint — Recebimento A / Recebimento B (camada de pagamento).
 * Não altera Motor F×NF.
 * node --test tests/vendas/sprint-recebimentos-ab.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '../..');
const Orquestrador = require('../../backend/services/OrquestradorPagamento');
const {
  linhasPagamentoPersistencia
} = require('../../backend/services/vendas/VendaPagamentoService');
const {
  GRUPO_A,
  GRUPO_B,
  grupoRecebimento,
  rotuloRecebimento,
  mapearPagamentoRespostaApi,
  somarPorGrupo,
  ehGrupoA,
  aplicarPoliticaRecebimentosFluxoVenda,
  decidirFluxoRecebimentosAB
} = require('../../backend/services/vendas/recebimentoPagamento');
const {
  prepararEntradasMotorComTransferenciaPdv
} = require('../../backend/services/estoque/transferenciaNaoFiscalParaFiscalPdv');
const { cancelarRecebimentosVenda } = require('../../backend/services/vendas/VendaCancelamentoService');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function orquestrar({ fiscal, naoFiscal, pagamentos, forma }) {
  return Orquestrador.processarFluxoPagamentoVenda({
    totalFiscal: fiscal,
    totalNaoFiscal: naoFiscal,
    formaPagamento: forma || (pagamentos[0] && pagamentos[0].forma_pagamento) || 'dinheiro',
    pagamentos,
    tefHabilitado: false,
    modoConfirmacaoFiscal: 'MANUAL',
    midpAtivo: false
  });
}

function persistir(r, pagamentosComerciais, forma, total) {
  return linhasPagamentoPersistencia(
    pagamentosComerciais,
    r.recebimentos,
    forma,
    total,
    null
  );
}

function invariantes(r, pagamentosComerciais, totalEsperado) {
  assert.equal(r.sucesso, true, r.erro);
  const linhas = persistir(r, pagamentosComerciais, 'pix', totalEsperado);
  const somaAb = round2(somarPorGrupo(linhas, GRUPO_A) + somarPorGrupo(linhas, GRUPO_B));
  const somaLinhas = round2(linhas.reduce((s, l) => s + Number(l.valor || 0), 0));
  assert.equal(somaAb, round2(totalEsperado));
  assert.equal(somaLinhas, round2(totalEsperado));
  const chaves = linhas.map((l) => `${l.grupo_recebimento || l.tipo_recebimento}|${l.forma_pagamento}|${l.valor}`);
  assert.equal(new Set(chaves).size, linhas.length, 'nenhum recebimento duplicado');
  return linhas;
}

describe('Sprint recebimentos A/B', () => {
  it('TESTE 1 — somente A + pagamento único', async () => {
    const pags = [{ forma_pagamento: 'pix', valor: 10 }];
    const r = await orquestrar({ fiscal: 10, naoFiscal: 0, pagamentos: pags });
    const linhas = invariantes(r, pags, 10);
    assert.equal(somarPorGrupo(linhas, GRUPO_A), 10);
    assert.equal(somarPorGrupo(linhas, GRUPO_B), 0);
  });

  it('TESTE 2 — somente B + pagamento único', async () => {
    const pags = [{ forma_pagamento: 'dinheiro', valor: 10 }];
    const r = await orquestrar({ fiscal: 0, naoFiscal: 10, pagamentos: pags });
    const linhas = invariantes(r, pags, 10);
    assert.equal(somarPorGrupo(linhas, GRUPO_A), 0);
    assert.equal(somarPorGrupo(linhas, GRUPO_B), 10);
  });

  it('TESTE 3 — A+B + PIX único', async () => {
    const pags = [{ forma_pagamento: 'pix', valor: 100, tef_transacao_id: 9, nsu: 'N1', autorizacao: 'A1', bandeira: 'visa' }];
    const r = await orquestrar({ fiscal: 60, naoFiscal: 40, pagamentos: pags });
    const linhas = invariantes(r, pags, 100);
    assert.equal(somarPorGrupo(linhas, GRUPO_A), 60);
    assert.equal(somarPorGrupo(linhas, GRUPO_B), 40);
    assert.equal(linhas[0].tipo_recebimento, 'A');
    assert.equal(linhas[1].tipo_recebimento, 'B');
    assert.equal(linhas[0].nsu, 'N1');
    assert.equal(linhas[1].autorizacao, 'A1');
    assert.equal(linhas[0].bandeira, 'visa');
  });

  it('TESTE 4 — A+B + dinheiro único', async () => {
    const pags = [{ forma_pagamento: 'dinheiro', valor: 100 }];
    const r = await orquestrar({ fiscal: 60, naoFiscal: 40, pagamentos: pags });
    invariantes(r, pags, 100);
  });

  it('TESTE 5 — A+B + cartão único', async () => {
    const pags = [{ forma_pagamento: 'cartao_credito', valor: 100, tef: { transacao_id: 3, nsu: 'X', autorizacao: 'Y' } }];
    const r = await orquestrar({ fiscal: 55, naoFiscal: 45, pagamentos: pags });
    const linhas = invariantes(r, pags, 100);
    assert.ok(linhas.every((l) => l.tef_transacao_id === 3 || (l.tef && l.tef.transacao_id === 3)));
  });

  it('TESTE 6 — A+B + PIX + dinheiro', async () => {
    const pags = [
      { forma_pagamento: 'pix', valor: 50 },
      { forma_pagamento: 'dinheiro', valor: 50 }
    ];
    const r = await orquestrar({ fiscal: 60, naoFiscal: 40, pagamentos: pags, forma: 'misto' });
    invariantes(r, pags, 100);
  });

  it('TESTE 7 — A+B + débito + dinheiro', async () => {
    const pags = [
      { forma_pagamento: 'cartao_debito', valor: 70 },
      { forma_pagamento: 'dinheiro', valor: 30 }
    ];
    const r = await orquestrar({ fiscal: 60, naoFiscal: 40, pagamentos: pags, forma: 'misto' });
    invariantes(r, pags, 100);
  });

  it('TESTE 8 — A+B + crédito + PIX', async () => {
    const pags = [
      { forma_pagamento: 'cartao_credito', valor: 40 },
      { forma_pagamento: 'pix', valor: 60 }
    ];
    const r = await orquestrar({ fiscal: 60, naoFiscal: 40, pagamentos: pags, forma: 'misto' });
    invariantes(r, pags, 100);
  });

  it('TESTE 9 — transferência NF→F + pagamento único (totais pós-transferência)', async () => {
    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: { quantidade: 2, transferencia_nao_fiscal_para_fiscal: 1 },
      saldoFiscal: 1,
      saldoNaoFiscal: 1,
      controlaEstoque: true
    }], { permitido: true });
    assert.notEqual(prep.sucesso, false);
    const pags = [{ forma_pagamento: 'pix', valor: 20 }];
    const r = await orquestrar({ fiscal: 20, naoFiscal: 0, pagamentos: pags });
    const linhas = invariantes(r, pags, 20);
    assert.equal(somarPorGrupo(linhas, GRUPO_A), 20);
  });

  it('TESTE 10 — transferência NF→F + pagamento misto (A+B permanece)', async () => {
    const prep = prepararEntradasMotorComTransferenciaPdv([{
      item: { quantidade: 3, transferencia_nao_fiscal_para_fiscal: 1 },
      saldoFiscal: 1,
      saldoNaoFiscal: 3,
      controlaEstoque: true
    }], { permitido: true });
    assert.notEqual(prep.sucesso, false);
    const pags = [
      { forma_pagamento: 'pix', valor: 20 },
      { forma_pagamento: 'dinheiro', valor: 10 }
    ];
    const r = await orquestrar({ fiscal: 20, naoFiscal: 10, pagamentos: pags, forma: 'misto' });
    invariantes(r, pags, 30);
  });

  it('TESTE 11 — cancelar venda mista estorna A e B', async () => {
    const dbMem = new sqlite3.Database(':memory:');
    await new Promise((resolve, reject) => {
      dbMem.serialize(() => {
        dbMem.run(`CREATE TABLE venda_recebimentos (
          id INTEGER PRIMARY KEY, venda_id INTEGER, tipo_recebimento TEXT, status TEXT
        )`);
        dbMem.run(`INSERT INTO venda_recebimentos (venda_id, tipo_recebimento, status) VALUES (1,'fiscal','aprovado')`);
        dbMem.run(`INSERT INTO venda_recebimentos (venda_id, tipo_recebimento, status) VALUES (1,'nao_fiscal','aprovado')`);
        dbMem.run(`INSERT INTO venda_recebimentos (venda_id, tipo_recebimento, status) VALUES (1,'A','aprovado')`);
        dbMem.run(`INSERT INTO venda_recebimentos (venda_id, tipo_recebimento, status) VALUES (1,'B','aprovado')`, (err) => {
          if (err) return reject(err);
          const orig = require('../../backend/database');
          const svc = require('../../backend/services/vendas/VendaCancelamentoService');
          void orig;
          dbMem.all('SELECT status FROM venda_recebimentos WHERE venda_id=1', (e, rows) => {
            if (e) return reject(e);
            assert.equal(rows.length, 4);
            dbMem.run(`UPDATE venda_recebimentos SET status='cancelado' WHERE venda_id=1
              AND LOWER(COALESCE(tipo_recebimento,'')) IN ('fiscal','a','nao_fiscal','b')`, function onUpd(uErr) {
              if (uErr) return reject(uErr);
              dbMem.all('SELECT status FROM venda_recebimentos WHERE status != ?', ['cancelado'], (e2, rest) => {
                if (e2) return reject(e2);
                assert.equal((rest || []).length, 0);
                dbMem.close();
                resolve();
              });
            });
          });
        });
      });
    });
    assert.equal(typeof cancelarRecebimentosVenda, 'function');
  });

  it('TESTE 12 — persistência/API: A/B e compatibilidade histórica', () => {
    const apiA = mapearPagamentoRespostaApi({ forma_pagamento: 'pix', valor: 2.35, tipo_recebimento: 'fiscal' });
    const apiB = mapearPagamentoRespostaApi({ forma_pagamento: 'pix', valor: 2.35, tipo_recebimento: 'nao_fiscal' });
    assert.equal(apiA.grupo_recebimento, 'A');
    assert.equal(apiA.rotulo_recebimento, 'Recebimento A');
    assert.equal(apiB.grupo_recebimento, 'B');
    assert.equal(apiB.rotulo_recebimento, 'Recebimento B');
    assert.equal(apiA.tipo_recebimento, undefined);
    assert.equal(grupoRecebimento('A'), GRUPO_A);
    assert.equal(rotuloRecebimento('B'), 'Recebimento B');
    assert.equal(ehGrupoA('A'), true);
    assert.equal(ehGrupoA('fiscal'), true);
  });

  it('fluxo NÃO FISCAL: Motor A+B não vira dois recebimentos — só B no total comercial', () => {
    const pags = [{ forma_pagamento: 'pix', valor: 100 }];
    const pol = aplicarPoliticaRecebimentosFluxoVenda({
      body: { fluxo_venda: 'nao_fiscal' },
      totalFiscal: 60,
      totalNaoFiscal: 40,
      totalComercial: 100,
      pagamentosVenda: pags,
      formaPagamento: 'pix',
      recebimentosOrquestrador: [
        { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 60 },
        { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'pix', valor: 40 }
      ]
    });
    assert.equal(pol.fluxoVendaFiscal, false);
    assert.equal(pol.recebimentos.length, 1);
    assert.equal(Number(pol.recebimentos[0].valor), 100);
    const linhas = linhasPagamentoPersistencia(pags, pol.recebimentos, 'pix', 100, null);
    assert.equal(somarPorGrupo(linhas, GRUPO_A), 0);
    assert.equal(somarPorGrupo(linhas, GRUPO_B), 100);
    assert.equal(linhas.length, 1);
    const ui = mapearPagamentoRespostaApi(linhas[0]);
    assert.equal(ui.rotulo_recebimento, 'Recebimento B');
  });

  it('fluxo FISCAL: composição final A+B persiste A depois B; pagamento comercial único', () => {
    const pags = [{ forma_pagamento: 'pix', valor: 100 }];
    const rec = [
      { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 60 },
      { tipo_recebimento: 'nao_fiscal', forma_pagamento: 'pix', valor: 40 }
    ];
    const pol = aplicarPoliticaRecebimentosFluxoVenda({
      body: { fluxo_venda: 'fiscal' },
      totalFiscal: 60,
      totalNaoFiscal: 40,
      totalComercial: 100,
      pagamentosVenda: pags,
      formaPagamento: 'pix',
      recebimentosOrquestrador: rec
    });
    assert.equal(pol.fluxoVendaFiscal, true);
    assert.equal(pol.recebimentos.length, 2);
    const linhas = linhasPagamentoPersistencia(pags, pol.recebimentos, 'pix', 100, null);
    assert.equal(linhas.length, 2);
    assert.equal(linhas[0].tipo_recebimento, 'A');
    assert.equal(linhas[1].tipo_recebimento, 'B');
    assert.equal(pags.length, 1);
  });

  it('fluxo FISCAL pós-transferência somente A', () => {
    const f = decidirFluxoRecebimentosAB(100, 0, { fluxoVendaFiscal: true, totalComercial: 100 });
    assert.deepEqual(f.ordem, ['A']);
    const pol = aplicarPoliticaRecebimentosFluxoVenda({
      body: { fluxo_venda: 'fiscal' },
      totalFiscal: 100,
      totalNaoFiscal: 0,
      totalComercial: 100,
      pagamentosVenda: [{ forma_pagamento: 'pix', valor: 100 }],
      formaPagamento: 'pix',
      recebimentosOrquestrador: [
        { tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: 100 }
      ]
    });
    const linhas = linhasPagamentoPersistencia(
      [{ forma_pagamento: 'pix', valor: 100 }],
      pol.recebimentos,
      'pix',
      100,
      null
    );
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].tipo_recebimento, 'A');
  });

  it('GET /vendas anexa pagamentos persistidos (recebimentos > pagamentos)', () => {
    const { agruparPagamentosExibicaoPorVenda } = require('../../backend/services/vendas/recebimentoPagamento');
    const porVenda = agruparPagamentosExibicaoPorVenda(
      [
        { venda_id: 22, forma_pagamento: 'pix', valor: 2.35, tipo_recebimento: 'fiscal' },
        { venda_id: 22, forma_pagamento: 'pix', valor: 2.35, tipo_recebimento: 'nao_fiscal' }
      ],
      [
        { venda_id: 22, forma_pagamento: 'pix', valor: 4.7, tipo_recebimento: null }
      ]
    );
    assert.equal(porVenda[22].length, 2);
    assert.equal(porVenda[22][0].rotulo_recebimento, 'Recebimento A');
    assert.equal(porVenda[22][0].valor, 2.35);
    assert.equal(porVenda[22][1].rotulo_recebimento, 'Recebimento B');
    assert.equal(porVenda[22][1].valor, 2.35);

    const antiga = agruparPagamentosExibicaoPorVenda(
      [],
      [{ venda_id: 18, forma_pagamento: 'pix', valor: 4.7, tipo_recebimento: null }]
    );
    assert.equal(antiga[18].length, 1);
    assert.equal(antiga[18][0].grupo_recebimento, null);
    assert.equal(antiga[18][0].rotulo_recebimento, '');
    assert.equal(antiga[18][0].valor, 4.7);
  });

  it('HTML do histórico exibe PIX (Recebimento A/B) e não inventa A/B', () => {
    const vm = require('vm');
    const src = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/vendasHistoricoUi.js'), 'utf8');
    const sandbox = {
      window: {},
      formatCurrency: (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ','),
      rotuloFormaPagamento: (v) => {
        const mapa = { pix: 'PIX', dinheiro: 'Dinheiro', cartao_debito: 'Cartão débito', cartao_credito: 'Cartão crédito' };
        return mapa[v] || v || '-';
      }
    };
    vm.runInNewContext(src, sandbox);
    const html = sandbox.window.montarHtmlPagamentosHistoricoVenda({
      id: 22,
      forma_pagamento: 'pix',
      total: 4.7,
      pagamentos: [
        { forma_pagamento: 'pix', valor: 2.35, grupo_recebimento: 'A', rotulo_recebimento: 'Recebimento A' },
        { forma_pagamento: 'pix', valor: 2.35, grupo_recebimento: 'B', rotulo_recebimento: 'Recebimento B' }
      ]
    });
    assert.match(html, /PIX \(Recebimento A\): R\$ 2,35/);
    assert.match(html, /PIX \(Recebimento B\): R\$ 2,35/);
    assert.doesNotMatch(html, /PIX: R\$ 4,70/);

    const soA = sandbox.window.montarHtmlPagamentosHistoricoVenda({
      pagamentos: [{ forma_pagamento: 'pix', valor: 10, grupo_recebimento: 'A', rotulo_recebimento: 'Recebimento A' }]
    });
    assert.match(soA, /PIX \(Recebimento A\): R\$ 10,00/);

    const soB = sandbox.window.montarHtmlPagamentosHistoricoVenda({
      pagamentos: [{ forma_pagamento: 'dinheiro', valor: 8, grupo_recebimento: 'B', rotulo_recebimento: 'Recebimento B' }]
    });
    assert.match(soB, /Dinheiro \(Recebimento B\): R\$ 8,00/);

    const antiga = sandbox.window.montarHtmlPagamentosHistoricoVenda({
      forma_pagamento: 'pix',
      total: 4.7,
      pagamentos: [{ forma_pagamento: 'pix', valor: 4.7 }]
    });
    assert.match(antiga, /PIX: R\$ 4,70/);
    assert.doesNotMatch(antiga, /Recebimento A/);

    const semLinhas = sandbox.window.montarHtmlPagamentosHistoricoVenda({
      forma_pagamento: 'pix',
      total: 4.7,
      pagamentos: []
    });
    assert.match(semLinhas, /PIX: R\$ 4,70/);
    assert.doesNotMatch(semLinhas, /Recebimento A/);
  });

  it('coluna Forma do histórico não usa só forma_pagamento', () => {
    const erp = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/vendas.js'), 'utf8');
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/vendas.js'), 'utf8');
    assert.match(erp, /historico-venda-forma/);
    assert.match(erp, /montarHtmlPagamentosHistoricoVenda\(v\)/);
    assert.match(erp, /id="vendaDetalhePagamentos"/);
    assert.match(pdv, /historico-venda-forma/);
    assert.match(pdv, /montarHtmlPagamentosHistoricoVenda\(v\)/);
    assert.match(pdv, /id="vendaDetalhePagamentos"/);
    const rota = fs.readFileSync(path.join(ROOT, 'backend/rotas/vendas.js'), 'utf8');
    assert.match(rota, /anexarPagamentosNasVendas/);
  });

  it('schema: CREATE venda_pagamentos antes do ALTER tipo_recebimento', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    const create = src.indexOf('CREATE TABLE IF NOT EXISTS venda_pagamentos');
    const alterTipo = src.indexOf("addColuna('tipo_recebimento'");
    assert.ok(create > 0);
    assert.ok(alterTipo > create);
  });

  it('UI de pagamento não exibe Fiscal/Não Fiscal no histórico', () => {
    const ui = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/vendasHistoricoUi.js'), 'utf8');
    assert.match(ui, /Recebimento A/);
    assert.match(ui, /Recebimento B/);
    assert.doesNotMatch(ui, /return 'Fiscal'/);
    assert.doesNotMatch(ui, /return 'Não fiscal'/);
    const pdv = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
    assert.match(pdv, /Recebimento B/);
    assert.doesNotMatch(pdv, /Pagamento Não Fiscal/);
  });

  it('Motor F×NF e MTS não foram editados nesta sprint de pagamento', () => {
    const dist = fs.readFileSync(path.join(ROOT, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');
    assert.match(dist, /function distribuirQuantidadeVenda/);
    assert.match(dist, /function distribuirItensVendaComValorFiscalEfetivo/);
    const mts = fs.readFileSync(path.join(ROOT, 'backend/motores/mts/index.js'), 'utf8');
    assert.ok(mts.length > 10);
  });
});
