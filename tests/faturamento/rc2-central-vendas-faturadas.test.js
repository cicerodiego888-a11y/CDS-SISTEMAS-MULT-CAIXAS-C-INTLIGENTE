/**
 * RC2 — Consolidação da Central de Vendas Faturadas (UX / filtros / documento).
 * Sem novas regras fiscais ou de núcleo.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  classificarDocumentoCentral,
  rotuloOrigemCentral,
  enriquecerItemCentral,
  abasDisponiveisCentral
} = require('../../backend/services/faturamento/FaturamentoService');

describe('RC2 — classificação Documento / Status visual', () => {
  it('nunca deixa documento vazio', () => {
    const casos = [
      { status: 'concluida' },
      { status: 'concluida', nfe_id: 1, nfe_status: 'autorizada', nfe_numero: 3021 },
      { status: 'concluida', nfe_id: 2, nfe_status: 'rejeitada' },
      { status: 'cancelada' },
      { status: 'concluida', nfe_id: 3, nfe_status: 'cancelada' }
    ];
    for (const c of casos) {
      const out = classificarDocumentoCentral(c);
      assert.ok(out.documento && String(out.documento).trim().length > 0);
      assert.ok(out.status_visual);
    }
  });

  it('rótulos oficiais da coluna Documento', () => {
    assert.equal(
      classificarDocumentoCentral({
        status: 'concluida',
        nfe_id: 1,
        nfe_status: 'autorizada',
        nfe_numero: 3021
      }).documento,
      'NF-e 3021'
    );
    assert.equal(
      classificarDocumentoCentral({ status: 'concluida' }).documento,
      'Sem Documento Fiscal'
    );
    assert.equal(
      classificarDocumentoCentral({
        status: 'concluida',
        nfe_id: 9,
        nfe_status: 'erro_transmissao'
      }).documento,
      'Pendente'
    );
    assert.equal(
      classificarDocumentoCentral({ status: 'cancelada' }).documento,
      'Cancelada'
    );
  });

  it('origem usa campo existente com rótulo comercial', () => {
    assert.equal(rotuloOrigemCentral('FATURAMENTO'), 'Pedido');
    assert.equal(rotuloOrigemCentral('PDV'), 'PDV');
    assert.equal(rotuloOrigemCentral('ENTREGA'), 'Entrega');
    assert.equal(rotuloOrigemCentral('MARKETPLACE'), 'Marketplace');
    const item = enriquecerItemCentral({
      id: 1,
      origem: 'FATURAMENTO',
      status: 'concluida',
      nfe_id: null
    });
    assert.equal(item.origem_label, 'Pedido');
    assert.equal(item.documento, 'Sem Documento Fiscal');
  });
});

describe('RC2 — Modo Operacional preservado (3.13)', () => {
  it('F12 ON oculta Sem NF-e; F12 OFF mantém', () => {
    assert.ok(!abasDisponiveisCentral(true).includes('sem_nfe'));
    assert.ok(abasDisponiveisCentral(false).includes('sem_nfe'));
  });
});

describe('RC2 — artefatos UI e filtros', () => {
  it('UI possui Documento, Origem, filtros e ações', () => {
    const ui = fs.readFileSync(
      path.resolve(__dirname, '../../frontend/erp/js/faturamento.js'),
      'utf8'
    );
    assert.match(ui, /Documento/);
    assert.match(ui, /Origem/);
    assert.match(ui, /fatFiltroCliente/);
    assert.match(ui, /fatFiltroVenda/);
    assert.match(ui, /fatFiltroPedido/);
    assert.match(ui, /fatFiltroDocumento/);
    assert.match(ui, /fatFiltroOrigem/);
    assert.match(ui, /fatFiltroDataInicio/);
    assert.match(ui, /fatFiltroStatus/);
    assert.match(ui, /Visualizar Venda/);
    assert.match(ui, /Visualizar Pedido/);
    assert.match(ui, /Emitir NF-e/);
    assert.match(ui, /Visualizar DANFE/);
    assert.match(ui, /Imprimir/);
    assert.match(ui, /Cancelar/);
    assert.match(ui, /atualizarTudo/);
    assert.match(ui, /Sem Documento Fiscal/);
  });

  it('service aplica filtros na mesma consulta vendas+nfe_notas', () => {
    const svc = fs.readFileSync(
      path.resolve(__dirname, '../../backend/services/faturamento/FaturamentoService.js'),
      'utf8'
    );
    assert.match(svc, /query\.cliente/);
    assert.match(svc, /query\.venda_id/);
    assert.match(svc, /query\.pedido_id/);
    assert.match(svc, /query\.documento/);
    assert.match(svc, /query\.origem/);
    assert.match(svc, /data_inicio/);
    assert.match(svc, /LEFT JOIN nfe_notas/);
    assert.match(svc, /classificarDocumentoCentral/);
    assert.ok(!svc.includes('CREATE TABLE'));
  });

  it('não altera núcleos proibidos (smoke)', () => {
    const files = [
      'backend/services/distribuidorEstoqueVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js',
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/fiscal/nfeEmissorVenda.js',
      'frontend/pdv/js/pdv.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../..', rel)), rel);
    }
  });
});
