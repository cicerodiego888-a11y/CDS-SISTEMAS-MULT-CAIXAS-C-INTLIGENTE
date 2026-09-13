/**
 * Sprint 3.14 — Orçamento (evolução do módulo Pedidos)
 * Mesma entidade / mesma tela / sem nova tabela.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  PedidoStatus,
  STATUS_ABA_PEDIDOS,
  STATUS_ENVIAVEIS_FATURAMENTO,
  normalizarPedidoStatus
} = require('../../backend/services/pedido/enums');

describe('Sprint 3.14 — status ORCAMENTO / PEDIDO', () => {
  it('adiciona ORCAMENTO e PEDIDO sem remover status legados', () => {
    assert.equal(PedidoStatus.ORCAMENTO, 'ORCAMENTO');
    assert.equal(PedidoStatus.PEDIDO, 'PEDIDO');
    assert.equal(PedidoStatus.ABERTO, 'ABERTO');
    assert.equal(PedidoStatus.EM_SEPARACAO, 'EM_SEPARACAO');
    assert.equal(PedidoStatus.AGUARDANDO_FATURAMENTO, 'AGUARDANDO_FATURAMENTO');
    assert.equal(PedidoStatus.FATURADO, 'FATURADO');
    assert.equal(PedidoStatus.CANCELADO, 'CANCELADO');
    assert.equal(normalizarPedidoStatus('orcamento'), 'ORCAMENTO');
    assert.equal(normalizarPedidoStatus('pedido'), 'PEDIDO');
  });

  it('aba Pedidos e envio ao faturamento nunca incluem ORCAMENTO', () => {
    assert.ok(STATUS_ABA_PEDIDOS.includes(PedidoStatus.PEDIDO));
    assert.ok(STATUS_ABA_PEDIDOS.includes(PedidoStatus.ABERTO));
    assert.ok(!STATUS_ABA_PEDIDOS.includes(PedidoStatus.ORCAMENTO));
    assert.ok(STATUS_ENVIAVEIS_FATURAMENTO.includes(PedidoStatus.PEDIDO));
    assert.ok(!STATUS_ENVIAVEIS_FATURAMENTO.includes(PedidoStatus.ORCAMENTO));
  });
});

describe('Sprint 3.14 — conversão e exclusão (API operacional)', () => {
  it('rota converter e excluir existem no PedidoOperacionalService', () => {
    const op = fs.readFileSync(
      path.join(__dirname, '../../backend/services/pedido/PedidoOperacionalService.js'),
      'utf8'
    );
    const rotas = fs.readFileSync(
      path.join(__dirname, '../../backend/rotas/pedidos.js'),
      'utf8'
    );
    assert.match(op, /converterParaPedido/);
    assert.match(op, /PedidoStatus\.ORCAMENTO/);
    assert.match(op, /PedidoStatus\.PEDIDO/);
    assert.match(op, /ORCAMENTO_NAO_FATURAVEL|Orçamento não pode ser faturado/);
    assert.match(op, /async function excluir/);
    assert.match(rotas, /\/:id\/converter/);
    assert.match(rotas, /router\.delete\('\/:id'/);
  });

  it('conversão altera apenas status (sem novo registro)', () => {
    const op = fs.readFileSync(
      path.join(__dirname, '../../backend/services/pedido/PedidoOperacionalService.js'),
      'utf8'
    );
    // converter usa atualizarStatus ORCAMENTO → PEDIDO; não chama criarPedido
    const bloco = op.slice(op.indexOf('async function converterParaPedido'));
    const fim = bloco.indexOf('async function enviarParaFaturamento');
    const fn = bloco.slice(0, fim > 0 ? fim : undefined);
    assert.match(fn, /atualizarStatus\(id,\s*PedidoStatus\.PEDIDO/);
    assert.doesNotMatch(fn, /criarPedido|repo\.criar/);
  });

  it('fila de faturamento continua só AGUARDANDO_FATURAMENTO', () => {
    const repo = fs.readFileSync(
      path.join(__dirname, '../../backend/services/pedido/PedidoRepository.js'),
      'utf8'
    );
    assert.match(repo, /WHERE p\.status IN \('AGUARDANDO_FATURAMENTO'\)/);
    assert.doesNotMatch(repo, /listarAguardandoFaturamento[\s\S]{0,400}ORCAMENTO/);
  });
});

describe('Sprint 3.14 — UI mesma tela', () => {
  it('abas + tipo Orçamento/Pedido + converter + impressão', () => {
    const ui = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/pedidos.js'),
      'utf8'
    );
    assert.match(ui, /Orçamentos/);
    assert.match(ui, /Aguardando Expedição/);
    assert.match(ui, /Expedidos/);
    assert.match(ui, /Cancelados/);
    assert.match(ui, /pedTipoOrcamento/);
    assert.match(ui, /pedTipoPedido/);
    assert.match(ui, /converter|\/converter/);
    assert.match(ui, /tipoDoc.*ORÇAMENTO|ORÇAMENTO.*tipoDoc/);
    assert.match(ui, /status === 'ORCAMENTO'/);
    assert.doesNotMatch(ui, /loadOrcamentos|modulo-orcamento/);
  });

  it('não altera núcleo / faturamento / MIDP', () => {
    const root = path.join(__dirname, '../..');
    const fat = fs.readFileSync(path.join(root, 'backend/services/faturamento/FaturamentoService.js'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaApplicationService.js'), 'utf8');
    const midp = fs.readFileSync(path.join(root, 'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'), 'utf8');
    assert.doesNotMatch(fat, /PedidoOperacionalService|converterParaPedido/);
    assert.doesNotMatch(app, /ORCAMENTO.*PedidoOperacional|converterParaPedido/);
    assert.doesNotMatch(midp, /PedidoStatus\.ORCAMENTO|converterParaPedido/);
  });
});
