/**
 * Sprint 3.8A — MIDP infraestrutura (paridade com Distribuidor legado).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const midp = require('../../backend/services/midp');
const { distribuirPagamentos } = require('../../backend/services/DistribuidorPagamento');
const Orquestrador = require('../../backend/services/OrquestradorPagamento');

function assertMesmaDistribuicao(a, b) {
  assert.deepEqual(a.recebimentosFiscal, b.recebimentosFiscal);
  assert.deepEqual(a.recebimentosNaoFiscal, b.recebimentosNaoFiscal);
  assert.equal(a.saldoFiscal, b.saldoFiscal);
  assert.equal(a.saldoNaoFiscal, b.saldoNaoFiscal);
}

describe('Sprint 3.8A — MIDP criado e slotado', () => {
  it('exporta interface pública executar + contrato comercial/fiscal/NF', () => {
    const r = midp.executar({
      pagamentosComerciais: [
        { forma_pagamento: 'dinheiro', valor: 40 },
        { forma_pagamento: 'pix', valor: 60 }
      ],
      valorFiscalEfetivo: 50,
      valorNaoFiscal: 50,
      midpAtivo: false
    });
    assert.equal(r.sucesso, true);
    assert.equal(r.motor, 'MIDP');
    assert.equal(r.modo, midp.MODO_PARIDADE_LEGADO);
    assert.ok(Array.isArray(r.pagamentoComercial));
    assert.ok(Array.isArray(r.pagamentoFiscal));
    assert.ok(Array.isArray(r.pagamentoNaoFiscal));
    assert.equal(r.pagamentoFiscal, r.recebimentosFiscal);
    assert.equal(r.pagamentoNaoFiscal, r.recebimentosNaoFiscal);
  });

  it('paridade total com adaptador DistribuidorPagamento (venda mista)', () => {
    const pagamentos = [
      { forma_pagamento: 'dinheiro', valor: 30 },
      { forma_pagamento: 'pix', valor: 70 }
    ];
    // Cópias independentes — sort mutável
    const viaMidp = midp.distribuirPagamentos(
      pagamentos.map((p) => ({ ...p })),
      50,
      50
    );
    const viaAdapter = distribuirPagamentos(
      pagamentos.map((p) => ({ ...p })),
      50,
      50
    );
    assertMesmaDistribuicao(viaMidp, viaAdapter);
    // PIX tem prioridade: 50 fiscal + 20 NF; dinheiro 30 NF
    assert.equal(viaMidp.recebimentosFiscal.length, 1);
    assert.equal(viaMidp.recebimentosFiscal[0].forma_pagamento, 'pix');
    assert.equal(viaMidp.recebimentosFiscal[0].valor, 50);
    assert.equal(viaMidp.saldoFiscal, 0);
    assert.equal(viaMidp.saldoNaoFiscal, 0);
  });

  it('Orquestrador importa MIDP (não Distribuidor direto)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/OrquestradorPagamento.js'),
      'utf8'
    );
    assert.match(src, /require\('\.\/midp'\)/);
    assert.match(src, /midp\.executar/);
    assert.doesNotMatch(src, /require\('\.\/DistribuidorPagamento'\)/);
  });

  it('DistribuidorPagamento é adaptador fino', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/services/DistribuidorPagamento.js'),
      'utf8'
    );
    assert.match(src, /require\('\.\/midp'\)/);
    assert.match(src, /Adaptador temporário|adaptador/i);
  });

  it('não altera Motor F×NF nem VendaPagamentoService nesta sprint', () => {
    const root = path.join(__dirname, '../..');
    const motor = fs.readFileSync(path.join(root, 'backend/services/distribuidorEstoqueVenda.js'), 'utf8');
    const pag = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    assert.match(motor, /function distribuirItemVenda/);
    assert.doesNotMatch(pag, /require\(['\"].*midp/);
    assert.match(pag, /OrquestradorPagamento/);
  });

  it('config ativar_midp existe (default false) e Orquestrador status regressão ok', () => {
    const configService = require('../../backend/services/configuracaoService');
    assert.equal(configService.DEFAULT.ativar_midp, false);
    assert.equal(typeof configService.isMidpAtivado, 'function');
    assert.equal(configService.isMidpAtivado({ ativar_midp: false }), false);

    const status = Orquestrador.determinarStatusPagamento({
      totalFiscal: 50,
      totalNaoFiscal: 50,
      fiscalProcessado: true,
      recebimentosNaoFiscalConfirmados: []
    });
    assert.equal(status, 'aguardando_nao_fiscal');
  });

  it('documentação registra MIDP', () => {
    const nucleo = fs.readFileSync(
      path.join(__dirname, '../../docs/arquitetura/NUCLEO_TRANSACIONAL_VENDA_V1.md'),
      'utf8'
    );
    const changelog = fs.readFileSync(
      path.join(__dirname, '../../docs/roadmap/CHANGELOG_ARQUITETURAL.md'),
      'utf8'
    );
    assert.match(nucleo, /MIDP/);
    assert.match(nucleo, /Motor Inteligente de Distribuição/);
    assert.match(changelog, /Sprint 3\.8A/);
  });
});
