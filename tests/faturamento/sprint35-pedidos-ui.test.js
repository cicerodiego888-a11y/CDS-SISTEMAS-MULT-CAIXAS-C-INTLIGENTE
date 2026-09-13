/**
 * Sprint 3.5 — Interface operacional Pedidos
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { PedidoStatus } = require('../../backend/services/pedido/enums');
const { normalizarItens } = (() => {
  // reutiliza lógica via service operacional indiretamente — smoke de status
  return { normalizarItens: null };
})();

describe('Sprint 3.5 — status comerciais', () => {
  it('inclui EM_SEPARACAO e fluxo comercial', () => {
    assert.equal(PedidoStatus.ABERTO, 'ABERTO');
    assert.equal(PedidoStatus.EM_SEPARACAO, 'EM_SEPARACAO');
    assert.equal(PedidoStatus.AGUARDANDO_FATURAMENTO, 'AGUARDANDO_FATURAMENTO');
    assert.equal(PedidoStatus.FATURADO, 'FATURADO');
    assert.equal(PedidoStatus.CANCELADO, 'CANCELADO');
    // Sprint 3.14 — evolução sem regressão
    assert.equal(PedidoStatus.ORCAMENTO, 'ORCAMENTO');
    assert.equal(PedidoStatus.PEDIDO, 'PEDIDO');
  });
});

describe('Sprint 3.5 — frontend e rotas', () => {
  it('menu Pedidos + loadPage + script', () => {
    const index = fs.readFileSync(path.join(__dirname, '../../frontend/erp/index.html'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/app.js'), 'utf8');
    const core = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/core.js'), 'utf8');
    const acl = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/access-control.js'), 'utf8');
    const ui = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/pedidos.js'), 'utf8');

    assert.match(index, /data-page="pedidos"/);
    assert.match(index, /pedidos\.js/);
    assert.match(app, /case 'pedidos'/);
    assert.match(app, /loadPedidos/);
    assert.match(core, /page === 'pedidos'/);
    assert.match(acl, /pedidos:\s*'vendas'/);
    assert.match(ui, /loadPedidos/);
    assert.match(ui, /btnPedNovo/);
    assert.match(ui, /pedClienteBusca/);
    assert.match(ui, /pedProdutoBusca/);
    assert.match(ui, /itensEditor/);
    assert.match(ui, /enviar-faturamento/);
    assert.match(ui, /\$\{API_URL\}\/pedidos/);
  });

  it('API operacional /api/pedidos existe sem alterar PedidoService', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/pedidos.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
    const svc = fs.readFileSync(path.join(__dirname, '../../backend/services/pedido/PedidoService.js'), 'utf8');
    const op = fs.readFileSync(path.join(__dirname, '../../backend/services/pedido/PedidoOperacionalService.js'), 'utf8');

    assert.match(server, /\/api\/pedidos/);
    assert.match(rotas, /enviar-faturamento/);
    assert.match(rotas, /duplicar/);
    assert.match(rotas, /cancelar/);
    assert.match(op, /enviarParaFaturamento/);
    // PedidoService permanece o de criação mínima da 3.1
    assert.match(svc, /AGUARDANDO_FATURAMENTO/);
    assert.doesNotMatch(svc, /enviarParaFaturamento/);
  });

  it('Núcleo e FaturamentoService não referenciam UI pedidos', () => {
    const root = path.join(__dirname, '../..');
    const app = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaApplicationService.js'), 'utf8');
    const pag = fs.readFileSync(path.join(root, 'backend/services/vendas/VendaPagamentoService.js'), 'utf8');
    const fat = fs.readFileSync(path.join(root, 'backend/services/faturamento/FaturamentoService.js'), 'utf8');
    assert.doesNotMatch(app, /PedidoOperacionalService|loadPedidos/);
    assert.doesNotMatch(pag, /PedidoOperacionalService|loadPedidos/);
    assert.doesNotMatch(fat, /PedidoOperacionalService/);
  });
});
