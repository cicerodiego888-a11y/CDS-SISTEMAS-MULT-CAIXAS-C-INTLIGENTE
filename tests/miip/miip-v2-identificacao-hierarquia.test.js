'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const MiipAction = require('../../backend/motores/miip/core/MiipAction');
const {
  aplicarPoliticaIdentificacaoV2,
  aplicarPoliticaNoResultado,
  montarAssociacaoLinha,
  gtinIdentificador,
  CRITERIOS
} = require('../../backend/motores/miip/core/MiipIdentificacaoV2Policy');
const { mapearItemCompraParaIdentificavel } = require('../../backend/motores/miip/utils/mapearItemCompra');
const { MiipService } = require('../../backend/motores/miip/MiipService');
const { MiipOrchestrator } = require('../../backend/motores/miip/MiipOrchestrator');
const { criarPipelinePadrao } = require('../../backend/motores/miip/core/MiipPipelineFactory');
const { MotorRegistry } = require('../../backend/motores/miip/core/MotorRegistry');
const MotorGTIN = require('../../backend/motores/miip/engines/gtin/MotorGTIN');
const MotorAssociacaoFornecedor = require('../../backend/motores/miip/engines/fornecedor/MotorAssociacaoFornecedor');
const ProdutoSnapshot = require('../../backend/motores/miip/core/ProdutoSnapshot');
const { MiipFeatureFlags } = require('../../backend/motores/miip/config/miipFeatureFlags');
const { MiipIntegracaoLogService } = require('../../backend/motores/miip/logs/MiipIntegracaoLogService');

const CNPJ_A = '11111111000191';
const CNPJ_B = '22222222000191';

function cand(id, extras = {}) {
  return {
    produtoId: id,
    snapshot: ProdutoSnapshot.fromRow({
      id,
      codigo: extras.codigo || `C${id}`,
      nome: extras.nome || `Produto ${id}`,
      codigo_barras: extras.codigo_barras || null,
      ativo: extras.ativo ?? 1
    }),
    produto: { id, codigo: extras.codigo || `C${id}`, nome: extras.nome || `Produto ${id}`, codigo_barras: extras.codigo_barras || null },
    scoreTotal: extras.score || 80,
    evidencias: extras.evidencias || [],
    motoresQueVotaram: extras.motores || [],
    atributosExtraidos: extras.atributos || {}
  };
}

function candNome(id, nome, extras = {}) {
  return cand(id, { nome, motores: ['motor_similarity'], evidencias: [{ tipo: 'descricao' }], ...extras });
}

function candMapeado(id, { cnpj = CNPJ_A, cprod = 'FORN-A', status = 'ativa', ativo = 1, codigo } = {}) {
  return cand(id, {
    codigo,
    ativo,
    motores: ['motor_associacao_fornecedor'],
    atributos: { statusAssociacao: status },
    evidencias: [
      { motor: 'motor_associacao_fornecedor', tipo: 'associacao_fornecedor', valor: 900 + id },
      { motor: 'motor_associacao_fornecedor', tipo: 'fornecedor_cnpj', valor: cnpj },
      { motor: 'motor_associacao_fornecedor', tipo: 'codigo_fornecedor', valor: cprod }
    ]
  });
}

function criarService(opcoes = {}) {
  const registry = new MotorRegistry();
  registry.registrar({
    codigo: 'motor_gtin',
    Classe: MotorGTIN,
    ativo: true,
    prioridade: 10,
    meta: {
      config: {
        produtoRepository: {
          async buscarPorGtin(gtin) {
            const produto = opcoes.produtoGtin ?? null;
            if (!produto || produto.codigo_barras !== gtin) return null;
            return ProdutoSnapshot.fromRow(produto);
          }
        }
      }
    }
  });
  registry.registrar({
    codigo: 'motor_associacao_fornecedor',
    Classe: MotorAssociacaoFornecedor,
    ativo: true,
    prioridade: 20,
    meta: {
      config: {
        associacoesRepository: {
          async buscarPorFornecedorCodigo(cnpj, codigo) {
            const assoc = opcoes.associacao ?? null;
            if (!assoc || assoc.fornecedorCnpj !== cnpj || assoc.codigoFornecedor !== codigo) return null;
            return assoc;
          }
        },
        produtoRepository: {
          async buscarPorId(id) {
            const produto = opcoes.produtoFornecedor ?? null;
            if (!produto || Number(produto.id) !== Number(id)) return null;
            return ProdutoSnapshot.fromRow(produto);
          }
        }
      }
    }
  });
  const pipeline = criarPipelinePadrao({
    motorRegistry: registry,
    configuracoesRepository: { async buscarPorChave() { return null; } }
  });
  const aprendizados = [];
  const service = new MiipService({
    orchestrator: new MiipOrchestrator({ pipeline }),
    inicializar: () => {},
    featureFlags: new MiipFeatureFlags(),
    integracaoLog: new MiipIntegracaoLogService(),
    configuracoesRepository: {
      async buscarPorChave() { return null; },
      parseValor() { return true; }
    }
  });
  service._learningService = {
    async registrarConfirmacao(dados) {
      aprendizados.push(dados);
      return { gravado: false, motivo: 'stub_teste' };
    }
  };
  return { service, aprendizados };
}

describe('Sprint 2.3 — MIIP V2 hierarquia de identificação', () => {
  test('1. código de barras idêntico, fornecedor diferente: assimila o produto', async () => {
    const produto = { id: 10, codigo: 'INT-10', nome: 'Arroz 5kg', codigo_barras: '7891000100103', ativo: 1 };
    const { service } = criarService({ produtoGtin: produto });
    const r = await service.identificar({
      codigo_barras: '7891000100103',
      fornecedor_cnpj: CNPJ_B,
      codigo_fornecedor: 'OUTRO-FORN-77',
      produto_nome: 'ARROZ TIPO 1 PCT'
    });
    assert.equal(r.produtoId, 10);
    assert.equal(r.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(r.resultado.decisao.criterio, CRITERIOS.CODIGO_BARRAS);
    assert.equal(r.resultado.decisao.precisaCadastro, false);
    assert.equal(produto.codigo_barras, '7891000100103', 'cadastro não é sobrescrito');
    assert.equal(produto.codigo, 'INT-10');
  });

  test('1b. barras exato via identificador secundário (evidência do motor de barras)', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: '7891000100103' },
      {
        candidatos: [cand(11, {
          codigo_barras: '7890000000017',
          motores: ['motor_gtin'],
          evidencias: [{ motor: 'motor_gtin', tipo: 'gtin_exato', valor: '7891000100103' }]
        })]
      }
    );
    assert.equal(v2.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(v2.criterio, CRITERIOS.CODIGO_BARRAS);
    assert.equal(v2.produtoId, 11);

    const inativo = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: '7891000100103' },
      { candidatos: [cand(12, { codigo_barras: '7891000100103', ativo: 0, motores: ['motor_gtin'] })] }
    );
    assert.equal(inativo.acao, MiipAction.CRIAR_NOVO, 'barras de produto inativo não assimila');
    assert.equal(inativo.produtoId, null);
    assert.equal(inativo.motivo, 'codigo_barras_produto_inativo');
  });

  test('2. barras divergente, código interno confiável igual: assimila pelo interno', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: '7891000100103', codigoInterno: 'ABC001', produtoNome: 'X' },
      { candidatos: [cand(5, { codigo: 'ABC001', codigo_barras: '7899999999999', nome: 'Outro', motores: ['motor_mubc'] })] }
    );
    assert.equal(v2.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(v2.criterio, CRITERIOS.CODIGO_INTERNO);
    assert.equal(v2.produtoId, 5);
  });

  test('3. barras divergente, interno divergente e nome igual: não assimila por nome', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: '7891000100103', codigoInterno: 'ABC001', produtoNome: 'ARROZ TIPO 1' },
      { candidatos: [candNome(8, 'ARROZ TIPO 1', { codigo: 'XYZ', codigo_barras: '7899999999999' })] }
    );
    assert.equal(v2.acao, MiipAction.CRIAR_NOVO);
    assert.equal(v2.criterio, CRITERIOS.SEM_CORRESPONDENCIA);
    assert.equal(v2.produtoId, null);
    assert.equal(v2.bloquearNome, true);
    assert.equal(v2.candidatos.length, 0, 'nome não vira sugestão quando há identificador divergente');

    const soBarras = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: '7891000100103', produtoNome: 'ARROZ TIPO 1' },
      { candidatos: [candNome(2, 'ARROZ TIPO 1', { codigo_barras: '7899999999999' })] }
    );
    assert.equal(soBarras.acao, MiipAction.CRIAR_NOVO);
    assert.equal(soBarras.bloquearNome, true);

    const soInterno = aplicarPoliticaIdentificacaoV2(
      { codigoInterno: 'ABC001', produtoNome: 'ARROZ TIPO 1' },
      { candidatos: [candNome(9, 'ARROZ TIPO 1', { codigo: 'XYZ' })] }
    );
    assert.equal(soInterno.acao, MiipAction.CRIAR_NOVO);
    assert.equal(soInterno.produtoId, null);
  });

  test('4. sem barras e sem interno: sugere por nome, sem associação automática', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(
      { produtoNome: 'ARROZ TIPO 1', codigoFornecedor: 'FORN-A', fornecedorCnpj: CNPJ_A },
      { candidatos: [candNome(3, 'ARROZ TIPO 1')] }
    );
    assert.equal(v2.acao, MiipAction.SUGERIR);
    assert.equal(v2.criterio, CRITERIOS.NOME);
    assert.equal(v2.precisaConfirmacao, true);
    assert.equal(v2.produtoId, null);
    assert.equal(v2.origemDecisao, 'manual');
  });

  test('5. vários candidatos semelhantes por nome: pendente para revisão', () => {
    const v2 = aplicarPoliticaIdentificacaoV2(
      { produtoNome: 'ARROZ' },
      { candidatos: [candNome(1, 'ARROZ 1'), candNome(2, 'ARROZ 2')] }
    );
    assert.equal(v2.acao, MiipAction.REVISAR_MANUAL);
    assert.equal(v2.motivo, 'nome_ambiguo');
    assert.equal(v2.produtoId, null);
  });

  test('6. SEM GTIN, vazio e GTIN zerado: ausência de código de barras', () => {
    for (const marcador of ['SEM GTIN', 'sem gtin', '', '   ', null, '0000000000000', '00000000']) {
      assert.equal(gtinIdentificador(marcador), null, `marcador ${JSON.stringify(marcador)}`);
    }
    const semGtin = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: 'SEM GTIN', produtoNome: 'ARROZ TIPO 1' },
      { candidatos: [candNome(3, 'ARROZ TIPO 1')] }
    );
    assert.equal(semGtin.acao, MiipAction.SUGERIR, 'SEM GTIN segue para o nome, como ausência');
    assert.equal(semGtin.criterio, CRITERIOS.NOME);

    const zerado = aplicarPoliticaIdentificacaoV2(
      { codigoBarras: '0000000000000', produtoNome: 'QUALQUER' },
      { candidatos: [cand(4, { codigo_barras: '0000000000000', motores: ['motor_gtin'] })] }
    );
    assert.notEqual(zerado.acao, MiipAction.AUTO_VINCULAR, 'GTIN zerado nunca casa com cadastro zerado');
    assert.equal(zerado.produtoId, null);
  });

  test('7. cProd igual ao código interno por coincidência, sem mapeamento: sem equivalência', async () => {
    const dto = mapearItemCompraParaIdentificavel({
      codigo: 'ABC001',
      cProd: 'ABC001',
      codigo_fornecedor: 'ABC001',
      fornecedor_cnpj: CNPJ_A,
      produto_nome: 'Coincidência'
    });
    assert.equal(dto.codigoInterno, null);
    assert.equal(dto.codigoFornecedor, 'ABC001');
    const v2 = aplicarPoliticaIdentificacaoV2(dto, {
      candidatos: [cand(9, { codigo: 'ABC001', nome: 'Outro nome', motores: ['motor_mubc'], evidencias: [{ tipo: 'codigo_interno' }] })]
    });
    assert.notEqual(v2.criterio, CRITERIOS.CODIGO_INTERNO);
    assert.notEqual(v2.acao, MiipAction.AUTO_VINCULAR);
    assert.equal(v2.produtoId, null);

    const { service } = criarService({
      produtoFornecedor: { id: 9, codigo: 'ABC001', nome: 'Outro nome', ativo: 1 }
    });
    const r = await service.identificar({
      codigo_fornecedor: 'ABC001', fornecedor_cnpj: CNPJ_A, produto_nome: 'Coincidência'
    });
    assert.equal(r.produtoId, null, 'sem mapeamento persistido não há associação');
    assert.notEqual(r.resultado.decisao.acao, MiipAction.AUTO_VINCULAR);
  });

  test('8. CNPJ + cProd mapeado: assimila só com mapeamento persistido válido', async () => {
    const produto = { id: 20, codigo: 'INT-20', nome: 'Feijão 1kg', codigo_barras: '', ativo: 1 };
    const associacao = { id: 77, fornecedorCnpj: CNPJ_A, codigoFornecedor: 'FORN-A', produtoId: 20, status: 'ativa' };

    const valido = criarService({ associacao, produtoFornecedor: produto });
    const ok = await valido.service.identificar({
      codigo_fornecedor: 'FORN-A', fornecedor_cnpj: '11.111.111/0001-91', produto_nome: 'FEIJAO'
    });
    assert.equal(ok.produtoId, 20);
    assert.equal(ok.resultado.decisao.criterio, CRITERIOS.MAPEAMENTO_FORNECEDOR);

    const outroFornecedor = await valido.service.identificar({
      codigo_fornecedor: 'FORN-A', fornecedor_cnpj: CNPJ_B, produto_nome: 'FEIJAO'
    });
    assert.equal(outroFornecedor.produtoId, null, 'mesmo cProd de outro CNPJ não usa o mapeamento');

    const inativo = criarService({ associacao, produtoFornecedor: { ...produto, ativo: 0 } });
    const rInativo = await inativo.service.identificar({
      codigo_fornecedor: 'FORN-A', fornecedor_cnpj: CNPJ_A, produto_nome: 'FEIJAO'
    });
    assert.equal(rInativo.produtoId, null, 'mapeamento para produto inativo não assimila');
    assert.equal(rInativo.resultado.decisao.acao, MiipAction.REVISAR_MANUAL);

    const adulterado = aplicarPoliticaIdentificacaoV2(
      { codigoFornecedor: 'FORN-A', fornecedorCnpj: CNPJ_A, produtoNome: 'FEIJAO' },
      { candidatos: [candMapeado(21, { cnpj: CNPJ_B })] }
    );
    assert.notEqual(adulterado.acao, MiipAction.AUTO_VINCULAR, 'evidência de outro CNPJ não vale');

    const outroCprod = aplicarPoliticaIdentificacaoV2(
      { codigoFornecedor: 'FORN-A', fornecedorCnpj: CNPJ_A },
      { candidatos: [candMapeado(22, { cprod: 'FORN-B' })] }
    );
    assert.notEqual(outroCprod.acao, MiipAction.AUTO_VINCULAR);

    const desativada = aplicarPoliticaIdentificacaoV2(
      { codigoFornecedor: 'FORN-A', fornecedorCnpj: CNPJ_A },
      { candidatos: [candMapeado(23, { status: 'inativa' })] }
    );
    assert.notEqual(desativada.acao, MiipAction.AUTO_VINCULAR);

    const semCnpj = aplicarPoliticaIdentificacaoV2(
      { codigoFornecedor: 'FORN-A' },
      { candidatos: [candMapeado(24)] }
    );
    assert.notEqual(semCnpj.acao, MiipAction.AUTO_VINCULAR);

    const invalidoComNome = aplicarPoliticaIdentificacaoV2(
      { codigoFornecedor: 'FORN-A', fornecedorCnpj: CNPJ_A, produtoNome: 'FEIJAO' },
      { candidatos: [candMapeado(25, { ativo: 0 }), candNome(26, 'FEIJAO')] }
    );
    assert.equal(invalidoComNome.acao, MiipAction.REVISAR_MANUAL);
    assert.ok(!invalidoComNome.candidatos.some((c) => c.produtoId === 26), 'nome não contorna mapeamento inválido');
  });

  test('9. nenhuma correspondência: pendente para associação ou cadastro, sem cadastro automático', async () => {
    const v2 = aplicarPoliticaIdentificacaoV2({ produtoNome: 'ITEM NOVO' }, { candidatos: [] });
    assert.equal(v2.acao, MiipAction.CRIAR_NOVO);
    assert.equal(v2.criterio, CRITERIOS.SEM_CORRESPONDENCIA);
    assert.equal(v2.estado, 'pendente');
    assert.equal(v2.produtoId, null);
    assert.equal(v2.precisaConfirmacao, true);

    const { service, aprendizados } = criarService({});
    const r = await service.identificar({
      codigo_barras: '7891000999990', codigo_fornecedor: 'X-1', fornecedor_cnpj: CNPJ_A, produto_nome: 'ITEM NOVO'
    });
    assert.equal(r.encontrado, false);
    assert.equal(r.produtoId, null);
    assert.equal(r.resultado.decisao.precisaCadastro, true);
    assert.equal(aprendizados.length, 0, 'sem associação, nenhum mapeamento é gravado');
  });

  test('9b. decisão anterior do pipeline não sobrevive à política V2', () => {
    const r = aplicarPoliticaNoResultado(
      { codigoBarras: '7891000100103', produtoNome: 'ARROZ' },
      {
        candidatos: [candNome(2, 'ARROZ', { codigo_barras: '7899999999999' })],
        decisao: { acao: MiipAction.AUTO_VINCULAR, precisaCadastro: false, precisaConfirmacao: false }
      }
    );
    assert.equal(r.decisao.acao, MiipAction.CRIAR_NOVO);
    assert.equal(r.decisao.precisaCadastro, true);
    assert.equal(r.candidatos.length, 0);
    assert.equal(r.identificacaoV2.produtoId, null);
  });

  test('duas linhas do mesmo produto preservam a identidade da linha', () => {
    const itemA = { nItem: 1, codigoBarras: '7891000100103' };
    const itemB = { nItem: 2, codigoBarras: '7891000100103' };
    const candUnico = [cand(10, { codigo_barras: '7891000100103' })];
    const a = aplicarPoliticaNoResultado(itemA, { candidatos: candUnico, decisao: {} });
    const b = aplicarPoliticaNoResultado(itemB, { candidatos: candUnico, decisao: {} });
    const assocA = montarAssociacaoLinha(itemA, 0, a.identificacaoV2, a.identificacaoV2.produtoId);
    const assocB = montarAssociacaoLinha(itemB, 1, b.identificacaoV2, b.identificacaoV2.produtoId);
    assert.equal(assocA.produto_id, assocB.produto_id);
    assert.notEqual(assocA.linha_xml, assocB.linha_xml);
  });

  test('10. a política de identificação não participa da confirmação SIM/NÃO nem da efetivação', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const raiz = path.join(__dirname, '..', '..');
    const arquivos = [
      'backend/services/unidades/ConfirmacaoConversaoEntradaNfe.js',
      'backend/rotas/compras.js'
    ];
    for (const rel of arquivos) {
      const fonte = fs.readFileSync(path.join(raiz, rel), 'utf8');
      assert.ok(!/MiipIdentificacaoV2Policy|aplicarPoliticaIdentificacaoV2/.test(fonte), `${rel} não depende da hierarquia`);
    }
  });
});
