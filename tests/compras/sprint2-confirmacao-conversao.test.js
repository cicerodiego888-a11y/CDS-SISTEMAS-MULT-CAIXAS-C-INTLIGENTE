'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const fs = require('fs');
const path = require('path');

const Confirmacao = require('../../backend/services/unidades/ConfirmacaoConversaoEntradaNfe');
const MotorUM = require('../../backend/services/unidades/MotorUnidadesMedida');
const MotorConversaoCalculo = require('../../backend/motores/muc/core/MotorConversaoCalculo');
const MotorParser = require('../../backend/motores/muc/core/MotorParser');
const MotorNormalizacao = require('../../backend/motores/muc/core/MotorNormalizacao');
const MotorInferenciaEtapa = require('../../backend/motores/muc/core/MotorInferenciaEtapa');
const { MotorAprendizado } = require('../../backend/motores/muc/aprendizado/MotorAprendizado');

const comprasSrc = fs.readFileSync(path.join(__dirname, '../../backend/rotas/compras.js'), 'utf8');
const centralJs = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/miip-central-revisao.js'), 'utf8');
const comprasJs = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/compras.js'), 'utf8');

const produtoCabo = { id: 93, nome: 'CABO PP 2 X 2,50', unidade: 'M' };

function itemCabo(overrides = {}) {
  return {
    nItem: 1,
    produto_id: 93,
    produto_nome: 'CABO PP 2 X 2,50',
    quantidade_comercial: 5,
    unidade_comercial: 'CENTO',
    quantidade_tributavel: 500,
    unidade_tributavel: 'M',
    qCom: 5,
    uCom: 'CENTO',
    qTrib: 500,
    uTrib: 'M',
    subtotal: 1000,
    ...overrides
  };
}

function produtoMap() {
  return new Map([[93, produtoCabo], [94, { id: 94, nome: 'Fio', unidade: 'M' }]]);
}

describe('Sprint 2 — confirmação de conversão NF-e', () => {
  test('1. pendência com decisão SIM aplica qTrib', () => {
    const itens = [itemCabo()];
    const [pendenciaEmitida] = Confirmacao.validarPendenciasConversaoEntrada(itens, {
      produtoMap: produtoMap(),
      documentoId: 10,
      origemCompra: 'CENTRAL_NFE'
    });
    const selo = pendenciaEmitida.selo_conversao;
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada(itens, {
      produtoMap: produtoMap(),
      confirmacoes: [{ nItem: 1, confirmacao: true, documento_id: 10, selo_conversao: selo }],
      documentoId: 10,
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 0);
    const aplicados = Confirmacao.aplicarDecisoesNosItens(itens, {
      produtoMap: produtoMap(),
      confirmacoes: [{ nItem: 1, confirmacao: true, selo_conversao: selo }],
      documentoId: 10
    });
    assert.equal(aplicados[0].quantidade_estoque_confirmada, 500);
    assert.equal(aplicados[0].quantidade_comercial, 5);
    assert.equal(aplicados[0].uCom, 'CENTO');
  });

  test('2. decisão NÃO não aplica conversão e bloqueia efetivação', () => {
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada([itemCabo()], {
      produtoMap: produtoMap(),
      confirmacoes: [{ nItem: 1, confirmacao: false }],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 1);
    assert.equal(pendencias[0].codigo, 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA');
    assert.equal(pendencias[0].estado_decisao, 'NAO');
  });

  test('3. várias pendências apresentadas simultaneamente', () => {
    const itens = [
      itemCabo({ nItem: 1 }),
      itemCabo({ nItem: 2, produto_id: 94, produto_nome: 'Fio' })
    ];
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada(itens, {
      produtoMap: produtoMap(),
      confirmacoes: [],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 2);
    assert.equal(pendencias[0].item_key, 'linha:1');
    assert.equal(pendencias[1].item_key, 'linha:2');
  });

  test('4. decisão faltante bloqueia efetivação', () => {
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada([itemCabo()], {
      produtoMap: produtoMap(),
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 1);
    assert.equal(pendencias[0].estado_decisao, 'PENDENTE');
    assert.equal(pendencias[0].bloqueia_efetivacao, true);
  });

  test('5. duas linhas do mesmo produto com decisões diferentes', () => {
    const itens = [
      itemCabo({ nItem: 1, item_id: undefined }),
      itemCabo({ nItem: 2 })
    ];
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada(itens, {
      produtoMap: produtoMap(),
      confirmacoes: [
        { nItem: 1, confirmacao: true },
        { nItem: 2, confirmacao: false }
      ],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 1);
    assert.equal(pendencias[0].nItem, 2);
    assert.equal(Confirmacao.extrairChaveConversaoItem(itens[0], 0), 'linha:1');
    assert.equal(Confirmacao.extrairChaveConversaoItem(itens[1], 1), 'linha:2');
  });

  test('6. decisão vinculada à nota errada é rejeitada', () => {
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada([itemCabo()], {
      produtoMap: produtoMap(),
      confirmacoes: [{ nItem: 1, confirmacao: true, documento_id: 99 }],
      documentoId: 10,
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 1);
    assert.equal(pendencias[0].codigo, 'DECISAO_NOTA_INCORRETA');
  });

  test('7. requisição repetida não duplica conversão no MUC', () => {
    const item = itemCabo({
      decisao_conversao: true,
      quantidade_estoque_confirmada: 500,
      conversao_aplicada: true,
      fator_conversao_confirmado: 100,
      origem_conversao_confirmada: 'QTRIB_UNIDADE_ESTOQUE'
    });
    let ctx = MotorParser.executar({
      origem: 'CENTRAL_NFE',
      produto: produtoCabo,
      item,
      origemDados: 'COMPRA_ITEM',
      unidadeEstoque: 'M',
      valorTotalCompra: 1000
    });
    ctx = MotorNormalizacao.executar(ctx);
    ctx = MotorInferenciaEtapa.executar(ctx);
    const calc = MotorConversaoCalculo.executar(ctx);
    assert.equal(calc.calculado.quantidadeEstoque, 500);
  });

  test('8. persistência de decisão usa identidade de linha e documento', () => {
    const registro = Confirmacao.montarRegistroConversaoPersistente(
      itemCabo(),
      produtoCabo,
      'SIM',
      { ok: true, quantidade_estoque: 500 },
      0,
      77
    );
    assert.equal(registro.item_key, 'linha:1');
    assert.equal(registro.documento_id, 77);
    assert.equal(registro.estado, 'SIM');
    assert.equal(registro.xml_original.qCom, 5);
    assert.equal(registro.xml_original.uCom, 'CENTO');
  });

  test('9. qTrib/uTrib compatíveis com estoque', () => {
    const r = MotorUM.resolverQuantidadeEntradaNfe(itemCabo(), produtoCabo, null);
    assert.equal(r.ok, true);
    assert.equal(r.origem, 'QTRIB_UNIDADE_ESTOQUE');
    assert.equal(r.quantidadeEstoque, 500);
  });

  test('10. qTrib/uTrib incompatíveis não inventam fator', () => {
    const r = MotorUM.resolverQuantidadeEntradaNfe(itemCabo({
      unidade_tributavel: 'UN',
      uTrib: 'UN',
      quantidade_tributavel: 500,
      qTrib: 500
    }), produtoCabo, null);
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'FATOR_CONVERSAO_AUSENTE');
    const pendencias = Confirmacao.validarPendenciasConversaoEntrada([
      itemCabo({ uTrib: 'UN', unidade_tributavel: 'UN' })
    ], {
      produtoMap: produtoMap(),
      confirmacoes: [{ nItem: 1, confirmacao: true }],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendencias.length, 1);
  });

  test('11. CENTO para metros no caso de referência', () => {
    assert.equal(MotorUM.normalizarUnidadeEntradaNfe('CENTO'), 'CENTO');
    assert.equal(MotorUM.normalizarUnidadeEntradaNfe('CT'), 'CENTO');
    assert.equal(MotorUM.normalizarUnidadeEntradaNfe('CEN'), 'CENTO');
    assert.equal(MotorUM.normalizarUnidadeEntradaNfe('CENTENA'), 'CENTO');
    const r = MotorUM.resolverQuantidadeEntradaNfe(itemCabo({ uCom: 'CT', unidade_comercial: 'CT' }), produtoCabo, null);
    assert.equal(r.quantidadeEstoque, 500);
  });

  test('12. recusa não gera aprendizado permanente', async () => {
    let inseriu = false;
    const aprendizado = new MotorAprendizado({
      get() { throw new Error('não deveria consultar aprendizado'); },
      run() { inseriu = true; }
    });
    await new Promise((resolve) => {
      aprendizado.registrar({
        origem: 'CENTRAL_NFE',
        produtoId: 93,
        fornecedorCnpj: '12345678000199',
        fatorConversao: 100,
        decisaoConversao: 'NAO'
      }, () => resolve());
    });
    assert.equal(inseriu, false);
  });

  test('13. aceitação SIM não altera unidade permanente no UPDATE de produto', () => {
    assert.match(comprasSrc, /unidade = \$\{origemCentralNfe \? 'unidade' : 'COALESCE\(\?, unidade\)'\}/);
    assert.match(comprasSrc, /registrarAprendizado: origemCentralNfe \? false : true/);
  });

  test('14. cancelar revisão não apaga cadastro — UI de pausa preservada', () => {
    assert.match(centralJs, /function cancelarRevisao/);
    assert.match(centralJs, /progresso não é apagado/);
    assert.match(centralJs, /miip-conv-reavaliar/);
  });

  test('15. falha de validação ocorre antes do BEGIN', () => {
    const idxValidar = comprasSrc.indexOf('validarPendenciasConversaoEntrada(itensComRateio');
    const idxCall = comprasSrc.indexOf('return iniciarTransacaoCompra();', idxValidar);
    assert.ok(idxValidar > 0);
    assert.ok(idxCall > idxValidar);
    assert.match(comprasSrc, /montarErroPendencias/);
  });

  test('16. regressão de embalagens CAIXA/FARDO', () => {
    assert.equal(MotorUM.identificarUnidadeDoXml('CX'), 'CAIXA');
    assert.equal(MotorUM.identificarUnidadeDoXml('FD'), 'FARDO');
    const produtoCx = {
      id: 1,
      unidade: 'UN',
      unidade_comercial: 'CAIXA',
      quantidade_por_embalagem: 12,
      embalagens: [{ ativa: 1, compra: 1, tipo: 'CAIXA', unidade: 'UN', quantidade: 12 }]
    };
    const r = MotorUM.resolverQuantidadeEntradaNfe({
      quantidade_comercial: 2,
      unidade_comercial: 'CAIXA',
      qCom: 2,
      uCom: 'CX'
    }, produtoCx, null);
    assert.equal(r.ok, true);
    assert.equal(r.quantidadeEstoque, 24);

    // Apresentação já cadastrada e coerente com qTrib: conversão existente, sem SIM/NÃO e sem bloqueio.
    const itemCxCoerente = {
      produto_id: 1, nItem: 1, quantidade_comercial: 2, unidade_comercial: 'CX',
      qCom: 2, uCom: 'CX', qTrib: 24, uTrib: 'UN', quantidade_tributavel: 24, unidade_tributavel: 'UN'
    };
    const rCoerente = MotorUM.resolverQuantidadeEntradaNfe(itemCxCoerente, produtoCx, null);
    assert.equal(rCoerente.ok, true);
    assert.equal(rCoerente.origem, 'FATOR_APRESENTACAO');
    assert.equal(Confirmacao.itemRequerConfirmacaoConversao(itemCxCoerente, rCoerente), false);
    const pend = Confirmacao.validarPendenciasConversaoEntrada([itemCxCoerente], {
      produtoMap: new Map([[1, produtoCx]]),
      confirmacoes: [],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.deepEqual(pend, [], 'caixa cadastrada coerente não pode virar pendência');

    // Divergência entre fator cadastrado e qTrib continua exigindo decisão.
    const itemCxDivergente = { ...itemCxCoerente, qTrib: 30, quantidade_tributavel: 30 };
    const pendDiv = Confirmacao.validarPendenciasConversaoEntrada([itemCxDivergente], {
      produtoMap: new Map([[1, produtoCx]]),
      confirmacoes: [],
      origemCompra: 'CENTRAL_NFE'
    });
    assert.equal(pendDiv.length, 1, 'divergência entre fator e qTrib exige decisão');
  });

  test('17. valores originais do XML são preservados após SIM', () => {
    const aplicados = Confirmacao.aplicarDecisoesNosItens([itemCabo()], {
      produtoMap: produtoMap(),
      confirmacoes: [{ nItem: 1, confirmacao: true }]
    });
    assert.equal(aplicados[0].qCom, 5);
    assert.equal(aplicados[0].uCom, 'CENTO');
    assert.equal(aplicados[0].qTrib, 500);
    assert.equal(aplicados[0].uTrib, 'M');
    assert.equal(aplicados[0].quantidade_comercial, 5);
  });

  test('18. quantidade, unidade e custo consistentes no MUC após SIM', () => {
    const item = itemCabo({
      decisao_conversao: true,
      quantidade_estoque_confirmada: 500,
      origem_conversao_confirmada: 'QTRIB_UNIDADE_ESTOQUE',
      fator_conversao_confirmado: 100
    });
    let ctx = MotorParser.executar({
      origem: 'CENTRAL_NFE',
      produto: produtoCabo,
      item,
      origemDados: 'COMPRA_ITEM',
      unidadeEstoque: 'M',
      valorTotalCompra: 1000
    });
    ctx = MotorNormalizacao.executar(ctx);
    ctx = MotorInferenciaEtapa.executar(ctx);
    const calc = MotorConversaoCalculo.executar(ctx);
    assert.equal(calc.calculado.quantidadeEstoque, 500);
    assert.equal(calc.calculado.custoTotal, 1000);
    assert.ok(Math.abs(calc.calculado.custoUnitario - 2) < 0.001);
  });

  test('interface da Central lista todas as pendências SIM/NÃO', () => {
    assert.match(centralJs, /miipCentralConversoes/);
    assert.match(centralJs, /carregarConversoesRevisao/);
    assert.match(centralJs, /bloqueia_efetivacao/);
    assert.match(comprasJs, /decisoes\.get\(p\.item_key\)/);
    assert.doesNotMatch(comprasJs, /decisions\.has/);
  });
});
