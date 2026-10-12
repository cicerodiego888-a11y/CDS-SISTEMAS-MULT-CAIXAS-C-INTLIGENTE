'use strict';

/**
 * Motor de Natureza da Entrada — fluxo real:
 * XML (CFOP 5101/6101 do emitente) → Central (upload, revisão, finalizar) → tela de Compras
 * (sugestão + confirmação) → POST /api/compras → SQLite → reabertura (GET /api/compras/:id).
 * XML sintético; nenhuma NF-e real, SEFAZ ou serviço externo.
 */

const {
  getDb,
  allDb,
  runDb,
  criarCentral,
  receberPelaCentral,
  lancarCompraPelaTela
} = require('./helpers/centralNfeE2eHarness');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const request = require('supertest');
const { test } = require('node:test');

const CHAVE_REFERENCIADA = '35261011222333000181550010000012341000012345';

function extrairFuncao(src, nome) {
  const inicio = src.indexOf(`function ${nome}(`);
  assert.ok(inicio >= 0, `função ${nome} existe`);
  let i = src.indexOf('{', src.indexOf(')', inicio));
  let nivel = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') nivel += 1;
    else if (src[i] === '}' && --nivel === 0) break;
  }
  return src.slice(inicio, i + 1);
}

/** Painel "Classificação da Entrada" da Central, isolado do restante da página. */
function carregarPainelCentral() {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/central-entradas.js'), 'utf8');
  const constante = src.match(/const NOTA_HEURISTICA_CENTRAL = [^\n]+/)[0];
  const codigo = [
    constante,
    ...['escapeHtmlCentralEntradas', 'rotuloTipoEntradaCentral', 'obterSugestaoEntradaCentral',
      'renderSugestaoEntradaCentral', 'renderClassificacaoEntradaCentral'].map((n) => extrairFuncao(src, n)),
    'this.renderClassificacaoEntradaCentral = renderClassificacaoEntradaCentral;'
  ].join('\n');
  const context = { centralEntradasState: { parseAtual: null } };
  vm.createContext(context);
  vm.runInContext(codigo, context);
  return {
    render(doc, parseAtual = null) {
      context.centralEntradasState.parseAtual = parseAtual;
      return context.renderClassificacaoEntradaCentral(doc);
    }
  };
}

function textoHtml(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const IMPOSTO_ICMS00 = '<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS></imposto>';

function caso(id, extras = {}) {
  return {
    id,
    nf: id,
    codigo: `NATUREZA-${id}`,
    gtin: `78912345${String(id).padStart(5, '0')}`,
    nome: `BISCOITO NATUREZA ${id}`,
    ncm: '19053100',
    uCom: 'UN', qCom: 20, vUnCom: 5,
    uTrib: 'UN', qTrib: 20, vUnTrib: 5,
    impostoXml: IMPOSTO_ICMS00,
    ...extras
  };
}

async function cadastrarProduto(c) {
  await runDb('DELETE FROM produtos WHERE id = ?', [c.id]);
  await runDb(
    `INSERT INTO produtos (
      id, nome, unidade, unidade_comercial, quantidade_por_embalagem,
      preco_compra, preco_venda, estoque_atual, produto_fracionado, vendido_por_peso,
      saldo_fiscal, saldo_nao_fiscal, codigo, categoria_id, codigo_barras, fornecedor, ativo
    ) VALUES (?, ?, 'UN', 'UN', 1, 4.8, 6, 5, 0, 0, 5, 0, ?, 1, ?, 'Fornecedor Sprint 2', 1)`,
    [c.id, c.nome, c.codigo, c.gtin]
  );
}

function respostaClassificacao(pagina) {
  const req = pagina.requisicoes.find((r) => r.metodo === 'POST' && r.url === '/api/compras/classificar-entrada');
  assert.ok(req, 'tela deve solicitar a classificação da natureza');
  return req.resposta.body;
}

async function verificarPersistencia(app, recebimento, gravacao, esperado) {
  assert.equal(gravacao.resposta.status, 200, JSON.stringify(gravacao.resposta.body));
  const compraId = Number(gravacao.resposta.body.id);
  assert.ok(compraId > 0);

  const compra = await getDb('SELECT * FROM compras WHERE id = ?', [compraId]);
  assert.equal(compra.tipo_entrada, esperado.tipoEntrada, 'compras.tipo_entrada = escolha do usuário');
  assert.equal(compra.tipo_entrada_sugerido, esperado.sugerido, 'sugestão automática auditada');
  assert.equal(Number(compra.tipo_entrada_alterado), esperado.sugerido && esperado.sugerido !== esperado.tipoEntrada ? 1 : 0);
  assert.equal(compra.cfop_xml, esperado.cfopXml, 'CFOP original do XML preservado');
  assert.equal(compra.csosn_cst_xml, '00', 'CST do grupo ICMS00 do XML');

  const itens = await allDb('SELECT * FROM compras_itens WHERE compra_id = ?', [compraId]);
  assert.equal(itens.length, 1);
  assert.equal(itens[0].cfop, esperado.cfopXml, 'compras_itens.cfop = CFOP do XML');
  assert.equal(itens[0].ncm, '19053100', 'NCM preservado');
  assert.equal(Number(itens[0].quantidade), 20, 'quantidade preservada');
  assert.equal(itens[0].tipo_fiscal_item, esperado.tipoItem, 'tratamento interno do item');

  const doc = await getDb('SELECT xml FROM central_entradas_documentos WHERE id = ?', [recebimento.documentoId]);
  assert.equal(doc.xml, recebimento.xml, 'XML original da Central intacto');
  assert.match(doc.xml, new RegExp(`<CFOP>${esperado.cfopXml}</CFOP>`));
  assert.match(doc.xml, /<CST>00<\/CST><modBC>3<\/modBC><vBC>100\.00<\/vBC><pICMS>18\.00<\/pICMS>/);

  const reaberta = await request(app).get(`/api/compras/${compraId}`).set('Authorization', 'Bearer token-teste');
  assert.equal(reaberta.status, 200);
  assert.equal(reaberta.body.tipo_entrada, esperado.tipoEntrada, 'reabertura: natureza confirmada');
  assert.equal(reaberta.body.itens[0].tipo_fiscal_item, esperado.tipoItem, 'reabertura: tratamento do item');
  assert.equal(reaberta.body.itens[0].cfop, esperado.cfopXml, 'reabertura: CFOP original');
  return { compra, itens };
}

test('Natureza da entrada — 5101/6101 do emitente, escolha manual, item manual e histórico confirmado', async (t) => {
  const { app, central } = await criarCentral();

  await t.test('5101 + venda de produção: não sugere industrialização; Revenda escolhida é persistida e respeitada nos itens', async () => {
    const c = caso(9301, { cfop: '5101', natOp: 'VENDA DE PRODUCAO DO ESTABELECIMENTO' });
    await cadastrarProduto(c);
    const recebimento = await receberPelaCentral(central, c);
    const { pagina, gravacao } = await lancarCompraPelaTela(app, recebimento, { tipoEntrada: 'REVENDA' });

    const sugestao = respostaClassificacao(pagina);
    assert.notEqual(sugestao.tipoEntrada, 'INDUSTRIALIZACAO');
    assert.equal(sugestao.requerConfirmacao, true);
    assert.equal(sugestao.sinais.cfopDirecao, 'SAIDA');

    assert.equal(gravacao.corpo.tipo_entrada, 'REVENDA');
    assert.equal(gravacao.corpo.itens[0].cfop, '5101', 'payload mantém o CFOP do XML');
    assert.equal(gravacao.corpo.itens[0].tipo_fiscal_item, null, 'item sem escolha manual não força tipo');

    await verificarPersistencia(app, recebimento, gravacao, {
      tipoEntrada: 'REVENDA', sugerido: sugestao.tipoEntrada, cfopXml: '5101', tipoItem: 'REVENDA'
    });
  });

  await t.test('Escolha manual de tipo do item é preservada após salvar e reabrir', async () => {
    const c = caso(9302, { cfop: '5101', natOp: 'VENDA DE PRODUCAO DO ESTABELECIMENTO' });
    await cadastrarProduto(c);
    const recebimento = await receberPelaCentral(central, c);
    const { gravacao } = await lancarCompraPelaTela(app, recebimento, {
      tipoEntrada: 'REVENDA',
      antesDeGravar: (pagina) => pagina.context.alterarTipoFiscalItemCompra(0, 'INDUSTRIALIZACAO')
    });
    assert.equal(gravacao.corpo.itens[0].tipo_fiscal_item, 'INDUSTRIALIZACAO', 'payload envia a escolha manual');

    await verificarPersistencia(app, recebimento, gravacao, {
      tipoEntrada: 'REVENDA', sugerido: 'REVENDA', cfopXml: '5101', tipoItem: 'INDUSTRIALIZACAO'
    });
  });

  await t.test('6101 com histórico confirmado de Revenda: sugere Revenda; usuário escolhe Industrialização e ela prevalece', async () => {
    const c = caso(9303, { cfop: '6101', natOp: 'VENDA' });
    await cadastrarProduto(c);
    const recebimento = await receberPelaCentral(central, c);
    const { pagina, gravacao } = await lancarCompraPelaTela(app, recebimento, { tipoEntrada: 'INDUSTRIALIZACAO' });

    const sugestao = respostaClassificacao(pagina);
    assert.equal(sugestao.tipoEntrada, 'REVENDA', 'histórico confirmado decide quando o CFOP do emitente é neutro');
    assert.equal(sugestao.sinais.historico.tipo, 'REVENDA');
    assert.ok(sugestao.sinais.historico.qtd >= 2);
    assert.match(sugestao.motivo, /entradas confirmadas/);

    await verificarPersistencia(app, recebimento, gravacao, {
      tipoEntrada: 'INDUSTRIALIZACAO', sugerido: 'REVENDA', cfopXml: '6101', tipoItem: 'INDUSTRIALIZACAO'
    });
  });

  await t.test('Devolução recebida (finNFe 4): Central e diálogo coerentes, sem sugestão operacional; escolha explícita persistida', async () => {
    const painel = carregarPainelCentral();
    const c = caso(9304, { cfop: '5202', natOp: 'DEVOLUCAO DE MERCADORIA', finNFe: '4', refNFe: CHAVE_REFERENCIADA });
    await cadastrarProduto(c);
    const recebimento = await receberPelaCentral(central, c);

    const parse = await central.obterParseDocumento(recebimento.documentoId);
    const naCentral = parse.classificacaoEntrada;
    assert.ok(naCentral, 'Central expõe a classificação do backend');
    assert.equal(naCentral.naturezaDetectada, 'DEVOLUCAO');
    assert.equal(naCentral.tipoEntrada, null);
    assert.equal(naCentral.requerConfirmacao, true);

    const htmlPainel = textoHtml(painel.render({ id: recebimento.documentoId }, parse));
    assert.match(htmlPainel, /Natureza sugerida Devolução recebida — sem sugestão de tratamento/);
    assert.match(htmlPainel, /pontuação heurística, não probabilidade/);
    assert.match(htmlPainel, /Confirmação necessária ao abrir a compra/);
    assert.equal(painel.render({ id: recebimento.documentoId + 1 }, parse), '', 'parse de outro documento não é exibido');

    const { pagina, gravacao } = await lancarCompraPelaTela(app, recebimento, { tipoEntrada: 'REVENDA' });
    const noDialogo = respostaClassificacao(pagina);
    for (const campo of ['tipoEntrada', 'naturezaDetectada', 'confianca', 'requerConfirmacao', 'conflitos', 'motivo']) {
      assert.deepEqual(noDialogo[campo], naCentral[campo], `Central × Compras: ${campo}`);
    }

    const dialogo = pagina.htmlAnexados.find((h) => h.includes('politicaEntradaModal'));
    assert.ok(dialogo, 'diálogo de natureza exibido');
    assert.doesNotMatch(dialogo, /name="politica_entrada_import"[^>]*checked/, 'nenhuma natureza pré-selecionada');
    assert.match(textoHtml(dialogo), /Natureza identificada: Devolução recebida — sem sugestão de tratamento operacional/);
    assert.match(dialogo, /não possui tratamento próprio para devolução recebida/);
    assert.match(dialogo, /Escolha a natureza da entrada para continuar/);

    const { compra } = await verificarPersistencia(app, recebimento, gravacao, {
      tipoEntrada: 'REVENDA', sugerido: null, cfopXml: '5202', tipoItem: 'REVENDA'
    });
    assert.equal(Number(compra.tipo_entrada_alterado), 0);
    assert.match(compra.tipo_entrada_motivo, /^Devolução identificada/);
    assert.match(recebimento.xml, /<finNFe>4<\/finNFe><NFref><refNFe>/, 'finalidade e referência permanecem no XML original');

    const htmlReaberto = textoHtml(painel.render({
      id: recebimento.documentoId,
      compraTipoEntrada: compra.tipo_entrada,
      compraTipoEntradaSugerido: compra.tipo_entrada_sugerido,
      compraTipoEntradaAlterado: compra.tipo_entrada_alterado,
      compraTipoEntradaConfianca: compra.tipo_entrada_confianca,
      compraTipoEntradaMotivo: compra.tipo_entrada_motivo
    }));
    assert.match(htmlReaberto, /Tipo sugerido Sem sugestão automática/);
    assert.match(htmlReaberto, /Tipo escolhido Compra para Revenda/);
    assert.match(htmlReaberto, /pontuação heurística/);

    const { historicoFornecedor } = require('../../backend/services/compras/ClassificadorEntradaCompra');
    const hist = await historicoFornecedor(compra.fornecedor_cnpj);
    const devolucaoNoHistorico = await getDb(
      `SELECT COUNT(*) AS n FROM compras WHERE id = ? AND (tipo_entrada_sugerido IS NOT NULL OR COALESCE(tipo_entrada_alterado, 0) = 1)`,
      [compra.id]
    );
    assert.equal(Number(devolucaoNoHistorico.n), 0, 'devolução sem sugestão não entra no histórico confirmado de compras');
    assert.ok(hist, 'histórico das compras anteriores segue disponível');
  });

  await t.test('Diálogo sem sugestão exige escolha explícita antes de continuar', async () => {
    const c = caso(9306, { cfop: '5102', natOp: 'VENDA DE MERCADORIA' });
    await cadastrarProduto(c);
    const recebimento = await receberPelaCentral(central, c);
    const { pagina } = await lancarCompraPelaTela(app, recebimento, { tipoEntrada: 'REVENDA' });
    pagina.valores.set('input[name="politica_entrada_import"]:checked', '');
    let chamado = false;
    pagina.context.mostrarDialogoPoliticaEntrada(() => { chamado = true; }, {
      tipoEntrada: null, naturezaDetectada: 'DEVOLUCAO', confianca: 65, motivo: 'Devolução identificada.', requerConfirmacao: true, conflitos: []
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(chamado, false, 'não continua sem natureza escolhida');
    assert.ok(pagina.notificacoes.some((n) => /Escolha a natureza da entrada/.test(n.mensagem) && n.tipo === 'warning'));
  });

  await t.test('CFOP 1101 no item não sobrescreve a natureza Revenda confirmada no cabeçalho', async () => {
    const painel = carregarPainelCentral();
    const c = caso(9305, { cfop: '1101', natOp: 'COMPRA PARA INDUSTRIALIZACAO' });
    await cadastrarProduto(c);
    const recebimento = await receberPelaCentral(central, c);
    const parse = await central.obterParseDocumento(recebimento.documentoId);
    assert.equal(parse.classificacaoEntrada.tipoEntrada, 'INDUSTRIALIZACAO');
    assert.match(textoHtml(painel.render({ id: recebimento.documentoId }, parse)), /Natureza sugerida Compra para Industrialização/);

    const { pagina, gravacao } = await lancarCompraPelaTela(app, recebimento, { tipoEntrada: 'REVENDA' });
    assert.equal(respostaClassificacao(pagina).tipoEntrada, parse.classificacaoEntrada.tipoEntrada, 'Central × Compras');
    assert.equal(gravacao.corpo.itens[0].tipo_fiscal_item, null, 'sem escolha manual no item');

    await verificarPersistencia(app, recebimento, gravacao, {
      tipoEntrada: 'REVENDA', sugerido: 'INDUSTRIALIZACAO', cfopXml: '1101', tipoItem: 'REVENDA'
    });
  });
});
