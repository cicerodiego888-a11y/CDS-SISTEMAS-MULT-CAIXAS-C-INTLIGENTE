/**
 * Sprint 1 — Infraestrutura Vendas para Entrega
 * Valida estrutura sem alterar fluxo de venda/estoque/financeiro/NFC-e.
 *
 * Executar: node tests/vendas-entrega/sprint01-infra.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  TipoVenda,
  StatusEntrega,
  PagamentoPrevisto,
  TIPOS_VENDA,
  STATUS_ENTREGA,
  PAGAMENTOS_PREVISTOS,
  EntregaAuditoriaEventos,
  MODULO_AUDITORIA_ENTREGA,
  montarPayloadAuditoriaEntrega,
  montarHtmlComprovantePrestacao,
  EntregaService,
  EntregaValidator,
  EntregaRepository,
  moduloHabilitado
} = require('../../backend/services/entrega');

const configService = require('../../backend/services/configuracaoService');
const { PERMISSOES_DISPONIVEIS } = require('../../backend/middleware/auth');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error && error.message ? error.message : error}`);
    });
}

async function main() {
  console.log('\n=== Sprint 1 — Infra Vendas para Entrega ===\n');

  await test('enums TipoVenda / StatusEntrega / PagamentoPrevisto', async () => {
    assert.strictEqual(TipoVenda.BALCAO, 'BALCAO');
    assert.strictEqual(TipoVenda.ENTREGA, 'ENTREGA');
    assert.ok(STATUS_ENTREGA.includes(StatusEntrega.AGUARDANDO_ENTREGA));
    assert.ok(STATUS_ENTREGA.includes(StatusEntrega.CONCLUIDA));
    assert.ok(PAGAMENTOS_PREVISTOS.includes(PagamentoPrevisto.PIX));
    assert.strictEqual(TIPOS_VENDA.length, 2);
    assert.strictEqual(STATUS_ENTREGA.length, 5);
    assert.strictEqual(PAGAMENTOS_PREVISTOS.length, 7);
  });

  await test('feature flag default OFF e recurso vendasEntrega', async () => {
    const recursosOff = configService.getRecursos({
      tipoImplantacao: 'ERP_MULTICAIXA',
      modoOperacao: 'LOCAL',
      porta: 3001,
      habilitar_vendas_entrega: false
    });
    assert.strictEqual(recursosOff.recursos.vendasEntrega, false);
    assert.strictEqual(recursosOff.recursos.fiscal, true);

    const recursosOn = configService.getRecursos({
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      porta: 3001,
      habilitar_vendas_entrega: true
    });
    assert.strictEqual(recursosOn.recursos.vendasEntrega, true);
    assert.strictEqual(recursosOn.recursos.fiscal, false);
  });

  await test('permissões de entrega registradas', async () => {
    const esperadas = [
      'entrega_visualizar',
      'entrega_criar',
      'entrega_prestacao',
      'entrega_cancelar',
      'entrega_reabrir',
      'entrega_alterar_pagamento'
    ];
    for (const p of esperadas) {
      assert.ok(PERMISSOES_DISPONIVEIS.includes(p), `faltou ${p}`);
    }
  });

  await test('serviços estruturais respondem (Sprint 2 — listagem real)', async () => {
    const service = new EntregaService({
      repository: {
        async listar() { return []; },
        async listarPendentes() { return []; },
        async buscarPorVendaId() { return null; }
      }
    });
    const list = await service.listar();
    assert.ok(String(list.sprint).startsWith('2'));
    assert.ok(Array.isArray(list.items));

    const pend = await service.listarPendentes();
    assert.strictEqual(pend.total, 0);
    assert.ok(Array.isArray(pend.items));

    const det = await service.buscarPorId(99);
    assert.strictEqual(det.venda_id, 99);
    assert.strictEqual(det.item, null);

    let prestacaoErro = null;
    try {
      await service.registrarPrestacao(999999, {});
    } catch (e) {
      prestacaoErro = e;
    }
    assert.ok(prestacaoErro, 'prestação de venda inexistente deve falhar');
  });

  await test('validator reconhece enums', async () => {
    const v = new EntregaValidator();
    assert.strictEqual(v.validarTipoVenda('BALCAO'), true);
    assert.strictEqual(v.validarTipoVenda('X'), false);
    assert.strictEqual(v.validarStatusEntrega('EM_ENTREGA'), true);
    assert.strictEqual(v.validarPagamentoPrevisto('MISTO'), true);
  });

  await test('repository vazio não lança', async () => {
    const repo = new EntregaRepository();
    assert.deepStrictEqual(await repo.listar(), []);
    assert.strictEqual(await repo.buscarPorVendaId(1), null);
  });

  await test('auditoria — catálogo de eventos preparado', async () => {
    assert.strictEqual(MODULO_AUDITORIA_ENTREGA, 'vendas_entrega');
    assert.ok(EntregaAuditoriaEventos.VENDA_MARCADA_PARA_ENTREGA);
    assert.ok(EntregaAuditoriaEventos.PRESTACAO_REALIZADA);
    const payload = montarPayloadAuditoriaEntrega({
      acao: EntregaAuditoriaEventos.ENTREGA_INICIADA,
      vendaId: 10,
      detalhes: { teste: true }
    });
    assert.strictEqual(payload.modulo, 'vendas_entrega');
    assert.strictEqual(payload.referencia_id, '10');
  });

  await test('template ComprovantePrestacao existe e é HTML', async () => {
    const html = montarHtmlComprovantePrestacao({ pedido: '42', valor: 10 });
    assert.ok(html.includes('COMPROVANTE DE PRESTAÇÃO'));
    assert.ok(html.includes('PRESTAÇÃO DE CONTAS FINALIZADA'));
    assert.ok(html.includes('42'));
  });

  await test('schema database.js contém colunas de entrega', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../backend/database.js'),
      'utf8'
    );
    const cols = [
      'tipo_venda',
      'status_entrega',
      'pagamento_previsto',
      'entregador',
      'endereco_entrega',
      'referencia_entrega',
      'observacao_entrega',
      'taxa_entrega',
      'leva_maquineta',
      'troco_para',
      'prestacao_realizada',
      'prestado_por',
      'prestado_em'
    ];
    for (const c of cols) {
      assert.ok(src.includes(`ADD COLUMN ${c}`), `faltou coluna ${c}`);
    }
  });

  await test('rotas e controller existem', async () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../../backend/rotas/entregas.js')));
    assert.ok(fs.existsSync(path.join(__dirname, '../../backend/controllers/EntregaController.js')));
    const rotas = fs.readFileSync(path.join(__dirname, '../../backend/rotas/entregas.js'), 'utf8');
    assert.ok(rotas.includes("router.get('/entregas'"));
    assert.ok(rotas.includes("router.get('/entregas/pendentes'"));
    assert.ok(rotas.includes("router.post('/:id/prestacao'"));
    assert.ok(rotas.includes('exigirModuloVendasEntrega'));
    // Gate NÃO pode ser router.use no root — bloqueia POST /api/vendas do PDV
    assert.ok(rotas.includes("router.use('/entregas', exigirModuloVendasEntrega)"));
    assert.ok(!/router\.use\(\s*exigirModuloVendasEntrega\s*\)/.test(rotas));
  });

  await test('infra widget rodapé preparada sem botão operacional', async () => {
    const widgets = fs.readFileSync(
      path.join(__dirname, '../../frontend/pdv/js/pdv-footer-widgets.js'),
      'utf8'
    );
    assert.ok(widgets.includes('PdvFooterWidgets'));
    assert.ok(widgets.includes('ENTREGAS_PENDENTES'));
    // Não deve auto-registrar o widget de entregas nesta sprint
    assert.ok(!widgets.includes("register({ id: 'entregas-pendentes'"));
  });

  await test('moduloHabilitado é função segura', async () => {
    assert.strictEqual(typeof moduloHabilitado, 'function');
    const valor = moduloHabilitado();
    assert.strictEqual(typeof valor, 'boolean');
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
