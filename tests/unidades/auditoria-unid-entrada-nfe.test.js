/**
 * Entrada de NF-e — aliases explícitos UNID e UNIDADE na normalização.
 * Não cria fallback de unidade desconhecida para UN.
 *
 * Executar: node tests/unidades/auditoria-unid-entrada-nfe.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MotorUM = require('../../backend/services/unidades/MotorUnidadesMedida');
const { normalizarTipoApresentacao } = require('../../backend/motores/muc/constants/tiposApresentacao');
const MotorParser = require('../../backend/motores/muc/core/MotorParser');
const MotorNormalizacao = require('../../backend/motores/muc/core/MotorNormalizacao');
const MotorInferenciaEtapa = require('../../backend/motores/muc/core/MotorInferenciaEtapa');
const MotorConversaoCalculo = require('../../backend/motores/muc/core/MotorConversaoCalculo');
const NFeParserService = require('../../backend/shared/nfe/NFeParserService');

const ROOT = path.join(__dirname, '../..');
const comprasJs = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras.js'), 'utf8');
const motorFront = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/motor-unidades-medida.js'), 'utf8');

const produtoUN = {
  id: 497,
  nome: 'Produto estoque UN',
  unidade: 'UN',
  unidade_comercial: 'UN',
  quantidade_por_embalagem: 0,
  embalagens: []
};

function itemNfe({ qCom, uCom, qTrib, uTrib, vUnCom = 1, vUnTrib = 1 }) {
  return {
    produto_nome: 'ITEM AUDITORIA',
    codigo_fornecedor: '1',
    codigo_barras: 'SEM GTIN',
    quantidade: qCom,
    quantidade_comercial: qCom,
    qCom,
    unidade: uCom,
    unidade_comercial: uCom,
    uCom,
    quantidade_tributavel: qTrib,
    qTrib,
    unidade_tributavel: uTrib,
    uTrib,
    preco_unitario: vUnCom,
    preco_unitario_trib: vUnTrib,
    subtotal: Number(qCom) * Number(vUnCom)
  };
}

function normalizarFrontendCompras(valor) {
  const inicio = comprasJs.indexOf('function normalizarUnidadeApresentacaoCentralCompra');
  const fim = comprasJs.indexOf('function resolverApresentacaoItemCentralCompra');
  const trecho = comprasJs.slice(inicio, fim);
  const sandbox = {};
  vm.runInNewContext(`${trecho}\nthis.fn = normalizarUnidadeApresentacaoCentralCompra;`, sandbox);
  return sandbox.fn(valor);
}

function passarPeloPipeline(item, produto = produtoUN) {
  let ctx = MotorParser.executar({
    origem: 'CENTRAL_NFE',
    produto,
    item,
    origemDados: 'COMPRA_ITEM',
    unidadeEstoque: produto.unidade,
    valorTotalCompra: item.subtotal
  });
  ctx = MotorNormalizacao.executar(ctx);
  ctx = MotorInferenciaEtapa.executar(ctx);
  return MotorConversaoCalculo.executar(ctx);
}

function resumir(rotulo, item, produto = produtoUN) {
  const direto = MotorUM.resolverQuantidadeEntradaNfe(item, produto, null);
  let pipeline = null;
  let erroPipeline = null;
  try {
    const ctx = passarPeloPipeline(item, produto);
    pipeline = {
      quantidadeEstoque: ctx.calculado.quantidadeEstoque,
      fatorConversao: ctx.calculado.fatorConversao,
      unidadeCompra: ctx.dto.unidadeCompra,
      unidadeEstoqueDto: ctx.dto.unidadeEstoque
    };
  } catch (erro) {
    erroPipeline = { code: erro.code, message: erro.message };
  }
  return {
    rotulo,
    normalizacao: {
      entradaNfe: {
        uCom: MotorUM.normalizarUnidadeEntradaNfe(item.uCom),
        uTrib: MotorUM.normalizarUnidadeEntradaNfe(item.uTrib),
        estoque: MotorUM.normalizarUnidadeEntradaNfe(produto.unidade)
      },
      comercialFallback: {
        uCom: MotorUM.normalizarUnidadeComercial(item.uCom),
        uTrib: MotorUM.normalizarUnidadeComercial(item.uTrib)
      },
      mucTipo: {
        uCom: normalizarTipoApresentacao(item.uCom),
        uTrib: normalizarTipoApresentacao(item.uTrib)
      },
      frontendCompras: {
        uCom: normalizarFrontendCompras(item.uCom),
        uTrib: normalizarFrontendCompras(item.uTrib),
        estoque: normalizarFrontendCompras(produto.unidade)
      }
    },
    motor: direto,
    pipeline,
    erroPipeline
  };
}

const xmlUnid = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35200100000000000000550010000000011000000010">
  <ide><nNF>1</nNF><serie>1</serie><mod>55</mod></ide>
  <emit><xNome>FORNECEDOR</xNome><CNPJ>00000000000000</CNPJ></emit>
  <det nItem="1"><prod>
    <cProd>8031</cProd><cEAN>SEM GTIN</cEAN><xProd>ITEM UNID</xProd>
    <NCM>00000000</NCM><CFOP>1102</CFOP>
    <uCom>UNID</uCom><qCom>10.0000</qCom><vUnCom>2.5000000000</vUnCom><vProd>25.00</vProd>
    <cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>10.0000</qTrib><vUnTrib>2.5000000000</vUnTrib>
  </prod></det>
  <total><ICMSTot><vProd>25.00</vProd><vNF>25.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

let ok = 0;
let falhas = 0;

console.log('\n=== AUDITORIA UNID → UN — entrada NF-e (comportamento atual) ===\n');

(async () => {
  const parsed = await NFeParserService.parse(xmlUnid);
  const item = parsed.itens[0];
  assert.equal(item.uCom, 'UNID');
  assert.equal(item.unidade_comercial, 'UNID');
  assert.equal(item.qCom, 10);
  assert.equal(item.quantidade, 10);
  assert.equal(item.uTrib, 'UN');
  assert.equal(item.unidade_tributavel, 'UN');
  assert.equal(item.qTrib, 10);
  assert.equal(item.quantidade_tributavel, 10);
  assert.equal(item.codigo_barras, 'SEM GTIN');
  assert.equal(item.preco_unitario, 2.5);
  assert.equal(item.preco_unitario_trib, 2.5);
  console.log('  OK  parser preserva qCom/uCom/qTrib/uTrib do XML');
  ok += 1;

  const cenarioA = resumir('A uCom=UNID uTrib=UN', itemNfe({
    qCom: 10, uCom: 'UNID', qTrib: 10, uTrib: 'UN'
  }));
  const cenarioAigual = resumir('A2 uCom=UNID uTrib=UNID', itemNfe({
    qCom: 10, uCom: 'UNID', qTrib: 10, uTrib: 'UNID'
  }));
  const cenarioAsemQtrib = resumir('A3 uCom=UNID sem qTrib', itemNfe({
    qCom: 10, uCom: 'UNID', qTrib: 0, uTrib: ''
  }));
  const cenarioB = resumir('B uCom=CX uTrib=UN qTrib=120', itemNfe({
    qCom: 10, uCom: 'CX', qTrib: 120, uTrib: 'UN'
  }));
  const cenarioC = resumir('C uCom=CX uTrib=UN qTrib=10', itemNfe({
    qCom: 10, uCom: 'CX', qTrib: 10, uTrib: 'UN'
  }));
  const cenarioUnd = resumir('UND/UND', itemNfe({
    qCom: 10, uCom: 'UND', qTrib: 10, uTrib: 'UND'
  }));
  const cenarioUnidade = resumir('UNIDADE/UNIDADE', itemNfe({
    qCom: 10, uCom: 'UNIDADE', qTrib: 10, uTrib: 'UNIDADE'
  }));
  const cenarioFd = resumir('FD/FD sem fator', itemNfe({
    qCom: 10, uCom: 'FD', qTrib: 10, uTrib: 'FD'
  }));
  const cenarioKg = resumir('KG/KG sem fator', itemNfe({
    qCom: 10, uCom: 'KG', qTrib: 10, uTrib: 'KG'
  }));
  const realCx = resumir('REAL CX/CX da Central', itemNfe({
    qCom: 5, uCom: 'CX', qTrib: 5, uTrib: 'CX'
  }));

  const frontendTemResolver = /resolverQuantidadeEntradaNfe|FATOR_CONVERSAO_AUSENTE/.test(motorFront);
  console.log(JSON.stringify({
    A: { ok: cenarioA.motor.ok, origem: cenarioA.motor.origem, qtd: cenarioA.motor.quantidadeEstoque, norm: cenarioA.normalizacao },
    A2: { ok: cenarioAigual.motor.ok, codigo: cenarioAigual.motor.codigo, erro: cenarioAigual.motor.erro, qTrib: cenarioAigual.motor.quantidadeTributavel },
    B: { ok: cenarioB.motor.ok, origem: cenarioB.motor.origem, qtd: cenarioB.motor.quantidadeEstoque, fator: cenarioB.motor.fatorConversao, pipeline: cenarioB.pipeline },
    C: { ok: cenarioC.motor.ok, origem: cenarioC.motor.origem, qtd: cenarioC.motor.quantidadeEstoque },
    UND: { ok: cenarioUnd.motor.ok, origem: cenarioUnd.motor.origem, uCom: cenarioUnd.normalizacao.entradaNfe.uCom },
    UNIDADE: { ok: cenarioUnidade.motor.ok, origem: cenarioUnidade.motor.origem, qtd: cenarioUnidade.motor.quantidadeEstoque },
    CX: { ok: realCx.motor.ok, erro: realCx.motor.erro },
    FD: { ok: cenarioFd.motor.ok, erro: cenarioFd.motor.erro },
    KG: { ok: cenarioKg.motor.ok, norm: cenarioKg.normalizacao.entradaNfe.uCom }
  }, null, 2));

  assert.equal(cenarioA.motor.ok, true);
  assert.equal(cenarioA.motor.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(cenarioA.motor.quantidadeEstoque, 10);
  assert.equal(cenarioA.motor.quantidadeComercial, 10);
  assert.equal(cenarioA.motor.unidadeComercial, 'UN');
  assert.equal(cenarioA.pipeline.quantidadeEstoque, 10);
  console.log('  OK  cenario A UNID/UN aceito pela unidade de estoque');
  ok += 1;

  const itemOriginal = itemNfe({ qCom: 10, uCom: 'UNID', qTrib: 10, uTrib: 'UNID' });
  const convertido = MotorUM.resolverQuantidadeEntradaNfe(itemOriginal, produtoUN, null);
  assert.equal(convertido.ok, true);
  assert.equal(convertido.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(convertido.quantidadeEstoque, 10);
  assert.equal(convertido.unidadeComercial, 'UN');
  assert.equal(convertido.unidadeEstoque, 'UN');
  assert.equal(itemOriginal.uCom, 'UNID');
  assert.equal(itemOriginal.uTrib, 'UNID');
  assert.equal(itemOriginal.qCom, 10);
  assert.equal(itemOriginal.qTrib, 10);
  assert.equal(cenarioAigual.motor.ok, true);
  assert.equal(cenarioAigual.motor.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(cenarioAigual.motor.quantidadeEstoque, 10);
  assert.equal(cenarioAigual.pipeline.quantidadeEstoque, 10);
  assert.equal(cenarioAigual.erroPipeline, null);
  console.log('  OK  cenario uCom=uTrib=UNID aceito sem alterar o item fiscal');
  ok += 1;

  assert.equal(cenarioAsemQtrib.motor.ok, true);
  assert.equal(cenarioAsemQtrib.motor.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(cenarioAsemQtrib.motor.quantidadeEstoque, 10);
  console.log('  OK  UNID sem qTrib usa qCom porque a unidade comercial ja e UN');
  ok += 1;

  assert.equal(cenarioB.motor.ok, true);
  assert.equal(cenarioB.motor.origem, 'QTRIB_UNIDADE_ESTOQUE');
  assert.equal(cenarioB.motor.quantidadeEstoque, 120);
  assert.equal(cenarioB.motor.fatorConversao, 12);
  assert.equal(cenarioB.pipeline.quantidadeEstoque, 120);
  console.log('  OK  cenario B aceito via qTrib sem segunda multiplicacao');
  ok += 1;

  assert.equal(cenarioC.motor.ok, true);
  assert.equal(cenarioC.motor.origem, 'QTRIB_UNIDADE_ESTOQUE');
  assert.equal(cenarioC.motor.quantidadeEstoque, 10);
  console.log('  OK  cenario C aceito via qTrib mesmo com qTrib=qCom');
  ok += 1;

  assert.equal(cenarioUnd.motor.ok, true);
  assert.equal(cenarioUnd.motor.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(cenarioUnd.motor.quantidadeEstoque, 10);
  assert.equal(cenarioUnd.normalizacao.entradaNfe.uCom, 'UN');
  console.log('  OK  UND continua normalizando para UN');
  ok += 1;

  assert.equal(cenarioUnidade.motor.ok, true);
  assert.equal(cenarioUnidade.motor.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(cenarioUnidade.motor.quantidadeEstoque, 10);
  assert.equal(cenarioUnidade.normalizacao.entradaNfe.uCom, 'UN');
  assert.equal(cenarioUnidade.normalizacao.entradaNfe.uTrib, 'UN');
  assert.equal(cenarioUnidade.normalizacao.frontendCompras.uCom, 'UN');
  console.log('  OK  UNIDADE normaliza para UN');
  ok += 1;

  assert.equal(realCx.motor.ok, false);
  assert.equal(realCx.motor.codigo, 'FATOR_CONVERSAO_AUSENTE');
  assert.match(realCx.motor.erro, /CAIXA para UN/);
  assert.equal(cenarioFd.motor.ok, false);
  assert.match(cenarioFd.motor.erro, /FARDO para UN/);
  assert.equal(cenarioKg.motor.ok, false);
  assert.equal(cenarioKg.normalizacao.entradaNfe.uCom, 'KG');
  console.log('  OK  CX, FD e KG sem fator continuam rejeitados');
  ok += 1;

  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('UN'), 'UN');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('UND'), 'UN');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('UNI'), 'UN');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('UNID'), 'UN');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('UNIDADE'), 'UN');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('CX'), 'CAIXA');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('FD'), 'FARDO');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('KG'), 'KG');
  assert.equal(MotorUM.normalizarUnidadeEntradaNfe('DZ'), 'DZ');
  assert.equal(normalizarFrontendCompras('UNID'), 'UN');
  assert.equal(normalizarFrontendCompras('UNIDADE'), 'UN');
  assert.equal(normalizarFrontendCompras('UNID'), MotorUM.normalizarUnidadeEntradaNfe('UNID'));
  assert.equal(normalizarFrontendCompras('UNIDADE'), MotorUM.normalizarUnidadeEntradaNfe('UNIDADE'));
  assert.equal(normalizarFrontendCompras('CX'), 'CX');
  assert.equal(normalizarFrontendCompras('FD'), 'FD');
  assert.equal(normalizarFrontendCompras('KG'), 'KG');
  assert.equal(normalizarFrontendCompras('DZ'), 'DZ');
  assert.equal(frontendTemResolver, false);
  console.log('  OK  aliases UNID/UNIDADE alinhados e sem fallback generico');
  ok += 1;

  const produtoCabo = {
    id: 93,
    nome: 'CABO PP 2 X 2,50',
    unidade: 'UN',
    unidade_comercial: 'PACOTE',
    quantidade_por_embalagem: 100,
    compra_por_embalagem: 1,
    valor_compra_embalagem: 615,
    preco_compra: 6.15,
    preco_venda: 8.3,
    embalagens: []
  };
  const caboPacote = itemNfe({
    qCom: 1, uCom: 'UN', qTrib: 1, uTrib: 'UN', vUnCom: 615, vUnTrib: 615
  });
  const diretoCabo = MotorUM.resolverQuantidadeEntradaNfe(caboPacote, produtoCabo, null);
  const pipelineCabo = passarPeloPipeline(caboPacote, produtoCabo);
  assert.equal(diretoCabo.ok, true);
  assert.equal(diretoCabo.origem, 'FATOR_APRESENTACAO');
  assert.equal(diretoCabo.quantidadeComercial, 1);
  assert.equal(diretoCabo.quantidadeEstoque, 100);
  assert.equal(diretoCabo.fatorConversao, 100);
  assert.equal(caboPacote.uCom, 'UN');
  assert.equal(caboPacote.qCom, 1);
  assert.equal(pipelineCabo.calculado.quantidadeEstoque, 100);
  assert.ok(Math.abs(pipelineCabo.calculado.custoUnitario - 6.15) < 0.0001);
  assert.equal(pipelineCabo.calculado.subtotal, 615);
  console.log('  OK  pacote a R$ 615 entra como 100 UN a R$ 6,15');
  ok += 1;

  const caboSemTrib = itemNfe({
    qCom: 1, uCom: 'UN', qTrib: 0, uTrib: '', vUnCom: 615, vUnTrib: 615
  });
  const diretoSemTrib = MotorUM.resolverQuantidadeEntradaNfe(caboSemTrib, produtoCabo, null);
  assert.equal(diretoSemTrib.quantidadeEstoque, 100);

  const caboUnidade = itemNfe({
    qCom: 1, uCom: 'UN', qTrib: 1, uTrib: 'UN', vUnCom: 6.15, vUnTrib: 6.15
  });
  const diretoUnidade = MotorUM.resolverQuantidadeEntradaNfe(caboUnidade, produtoCabo, null);
  const pipelineUnidade = passarPeloPipeline(caboUnidade, produtoCabo);
  assert.equal(diretoUnidade.origem, 'QCOM_UNIDADE_ESTOQUE');
  assert.equal(diretoUnidade.quantidadeEstoque, 1);
  assert.equal(pipelineUnidade.calculado.quantidadeEstoque, 1);
  const caboSete = MotorUM.resolverQuantidadeEntradaNfe(
    itemNfe({ qCom: 1, uCom: 'UN', qTrib: 1, uTrib: 'UN', vUnCom: 7, vUnTrib: 7 }),
    produtoCabo,
    null
  );
  assert.equal(caboSete.quantidadeEstoque, 1);
  console.log('  OK  preco unitario real nao multiplica o pacote');
  ok += 1;

  const caboCx = MotorUM.resolverQuantidadeEntradaNfe(
    itemNfe({ qCom: 1, uCom: 'CX', qTrib: 1, uTrib: 'CX', vUnCom: 615, vUnTrib: 615 }),
    produtoCabo,
    null
  );
  assert.equal(caboCx.ok, false);
  assert.equal(caboCx.codigo, 'FATOR_CONVERSAO_AUSENTE');
  console.log('  OK  CX no preco do pacote continua sem conversao automatica');
  ok += 1;

  console.log(`\n${ok} ok, ${falhas} falhas\n`);
  if (falhas) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
