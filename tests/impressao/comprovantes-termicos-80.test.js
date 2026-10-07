/**
 * Família de comprovantes térmicos 80mm — geometria, quebra e conteúdo.
 * Executar: node --test tests/impressao/comprovantes-termicos-80.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { montarHtmlComprovanteEntrega } = require('../../backend/services/entrega/CriarVendaEntregaService');
const { montarHtmlComprovantePrestacao } = require('../../backend/services/entrega/ComprovantePrestacao');
const { gerarHtmlCupomFechamento } = require('../../backend/services/caixa/FechamentoCaixaCupomService');

const LONGO = 'NOME EXTENSO '.repeat(12).trim();
const PRODUTO_LONGO = 'PICOLÉ LINHA CREMOSA ESPECIAL DE MORANGO COM LEITE CONDENSADO E GRANULADO';

function cupomNaoFiscal(venda, total, desconto) {
  const codigo = fs.readFileSync(path.join(__dirname, '../../frontend/shared/js/fiscalImpressao.js'), 'utf8');
  const contexto = { console, Date, window: null, globalThis: null };
  contexto.window = contexto;
  contexto.globalThis = contexto;
  vm.runInNewContext(`${codigo}\nwindow.__gerar = montarHtmlCupomNaoFiscal;`, contexto);
  return contexto.__gerar(42, venda, total, desconto);
}

function proibirGeometriaRuim(html, papel) {
  assert.match(html, new RegExp(`@page \\{ size: ${papel}mm auto; margin: 0; \\}`));
  assert.match(html, new RegExp(`width:\\s*${papel}mm`));
  assert.match(html, new RegExp(`max-width:\\s*${papel}mm`));
  assert.match(html, /padding:\s*1\.5mm 2\.5mm 2mm/);
  assert.doesNotMatch(html, /width:\s*(?:280|300|380)px|48ch|32ch|76mm/);
  assert.doesNotMatch(html, /overflow-x\s*:\s*hidden|zoom|scaleFactor|pageSize/);
  assert.doesNotMatch(html, /max-height\s*:/);
  assert.doesNotMatch(html, /<(?:html|body|main)[^>]*\sstyle="[^"]*\bheight\s*:/i);
}

describe('comprovante não fiscal 80mm', () => {
  const base = {
    nome_empresa: 'CREMOLÍCIA',
    endereco: 'A TITO DOS SANTOS CREMOLICIA, CENTRO',
    forma_pagamento: 'dinheiro',
    cliente_nome: 'Cliente da esquina',
    valor_recebido: 20,
    itens: [{ produto_nome: 'PICOLE', quantidade: 1, preco_unitario: 2, subtotal: 2, tipo_venda: 'UNIDADE' }]
  };

  it('geometria, itens, pagamento, troco, cliente e aviso não fiscal', () => {
    const html = cupomNaoFiscal(base, 10, 1);
    proibirGeometriaRuim(html, 80);
    for (const trecho of [
      'CREMOLÍCIA', 'COMPROVANTE NÃO FISCAL', 'Venda #42', 'PICOLE', '1 UN',
      'Total:', 'Desconto:', 'Dinheiro', 'Valor entregue:', 'Troco:',
      'Cliente: Cliente da esquina', 'ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL',
      'OBRIGADO PELA PREFERÊNCIA!', 'VOLTE SEMPRE.'
    ]) {
      assert.ok(html.includes(trecho), trecho);
    }
    assert.doesNotMatch(html, /DANFE|chave de acesso|protocolo|SEFAZ/i);
    assert.doesNotMatch(html, /<pre\b|<img\b/);
  });

  it('produto longo, muitos itens e nome de empresa longo quebram sem largura em px', () => {
    const itens = Array.from({ length: 50 }, (_, i) => ({
      produto_nome: i === 0 ? PRODUTO_LONGO : `ITEM ${i + 1}`,
      quantidade: 1,
      preco_unitario: 2,
      subtotal: 2,
      tipo_venda: 'UNIDADE'
    }));
    const html = cupomNaoFiscal({ ...base, nome_empresa: LONGO, itens }, 100, 0);
    proibirGeometriaRuim(html, 80);
    assert.ok(html.includes(PRODUTO_LONGO));
    assert.ok(html.includes('ITEM 50'));
    assert.match(html, /overflow-wrap:\s*anywhere/);
    assert.equal((html.match(/class="item"/g) || []).length, 50);
  });
});

describe('comprovante de entrega 80mm', () => {
  const venda = {
    id: 77,
    total: 25,
    data_venda: '2026-09-26 03:39:34',
    nome_cliente_entrega: LONGO,
    cpf_cnpj_cliente_entrega: '111.222.333-44',
    telefone_entrega: '88999999999',
    email_cliente_entrega: 'cliente@email.com',
    endereco_entrega: 'Rua muito longa que precisa quebrar no papel térmico de oitenta milímetros',
    numero_entrega: '50',
    bairro_entrega: 'Centro',
    cidade_entrega: 'Juazeiro do Norte',
    uf_entrega: 'CE',
    referencia_entrega: 'Referência longa perto da praça principal do bairro',
    entregador: 'Entregador com nome comprido demais',
    taxa_entrega: 5,
    pagamento_previsto: 'DINHEIRO',
    leva_maquineta: 1,
    troco_para: 50,
    observacao_entrega: 'Observação longa: deixar na portaria do prédio azul ao lado da padaria',
    reimpressao: true
  };

  it('dados, reimpressão, endereço longo e aviso não fiscal', () => {
    const html = montarHtmlComprovanteEntrega(venda, [
      { nome: PRODUTO_LONGO, quantidade: 2, preco_unitario: 10, subtotal: 20 }
    ], { nome: 'CREMOLÍCIA', cnpj: '36.811.652/0001-53' });
    proibirGeometriaRuim(html, 80);
    for (const trecho of [
      'COMPROVANTE DE ENTREGA', 'REIMPRESSÃO', LONGO, '111.222.333-44',
      'Rua muito longa', 'Número:', '50', 'Referência longa',
      'Entregador com nome comprido', 'Taxa de entrega:', 'DINHEIRO',
      'Levar maquineta:', 'SIM', 'Troco para:', 'Observação longa',
      PRODUTO_LONGO, 'Subtotal:', 'Total:',
      'ESTE DOCUMENTO NÃO POSSUI VALOR FISCAL',
      'prestação de contas'
    ]) {
      assert.ok(html.includes(trecho), trecho);
    }
    assert.doesNotMatch(html, /width:\s*280px|<pre\b/);
  });
});

describe('comprovante de prestação 80mm', () => {
  it('várias formas, troco, operador longo e prestação finalizada', () => {
    const html = montarHtmlComprovantePrestacao({
      empresa: LONGO,
      pedido: 100,
      codigo: 'ENT-9',
      cliente: 'Maria Oliveira',
      endereco: 'Rua das Flores bem comprida para testar a quebra',
      numero: '50',
      cidade: 'Juazeiro',
      uf: 'CE',
      valor: 45,
      pagamento_previsto: 'MISTO',
      pagamento_recebido: 'MISTO',
      formas_pagamento: [
        { forma_pagamento: 'PIX', valor: 20 },
        { forma_pagamento: 'DINHEIRO', valor: 15 },
        { forma_pagamento: 'CARTÃO DE CRÉDITO DO CLIENTE', valor: 10 }
      ],
      documento: 'NAO_FISCAL',
      troco_levado: 50,
      troco_devolvido: 5,
      maquineta: 'SIM',
      entregador: 'João',
      operador: LONGO,
      observacoes: 'Observação da prestação bem longa para não estourar a lateral'
    });
    proibirGeometriaRuim(html, 80);
    for (const trecho of [
      'COMPROVANTE DE PRESTAÇÃO', 'Maria Oliveira', 'Rua das Flores bem comprida',
      'FORMAS DE PAGAMENTO', 'PIX', 'DINHEIRO', 'CARTÃO DE CRÉDITO DO CLIENTE',
      'Pagamento recebido:', 'Troco levado:', 'Troco devolvido:', 'Maquineta:',
      'João', LONGO, 'Observação da prestação', 'PRESTAÇÃO DE CONTAS FINALIZADA'
    ]) {
      assert.ok(html.includes(trecho), trecho);
    }
    assert.doesNotMatch(html, /width:\s*280px/);
  });
});

describe('fechamento de caixa 80mm', () => {
  it('muitos dados, valores à direita e crescimento sem corte', () => {
    const html = gerarHtmlCupomFechamento({
      empresa: { nome: LONGO, cnpj: '36.811.652/0001-53' },
      caixa: { id: 7 },
      terminal: { nome: 'Terminal do salão principal com nome longo' },
      operador: { nome: LONGO },
      totais: { vendido: 1250, recebido: 1200, pendente: 50 },
      vendas: { quantidade: 40, bruto: 1300, descontos: 50, acrescimos: 0, fiscal: 800, nao_fiscal: 450 },
      pagamentos: { dinheiro: 400, pix: 300, debito: 200, credito: 150, tef: 50, prazo: 80, outros: 20 },
      pagamentos_contagem: { dinheiro: 10, pix: 8, debito: 4, credito: 3, tef: 1, prazo: 2, outros: 1 },
      entregas: { quantidade_total: 3, valor_total: 90, quantidade_prestada: 2, valor_prestado: 60, quantidade_pendente: 1, valor_pendente: 30 },
      movimentacoes: { suprimentos: 100, sangrias: 40 },
      dinheiro: { saldo_inicial: 200, vendas_dinheiro: 400, suprimentos: 100, sangrias: 40, esperado: 660, informado: 650, diferenca: -10 },
      cancelamentos: { quantidade: 2, valor: 30 },
      reconciliacao: { vendas_ok: 30, vendas_parciais: 2, vendas_pendentes: 1, vendas_inconsistentes: 0 }
    }, { papel_mm: 80 });
    proibirGeometriaRuim(html, 80);
    for (const trecho of [
      'RESUMO DO PERÍODO', 'FORMAS DE PAGAMENTO', 'VENDAS PARA ENTREGA',
      'MOVIMENTAÇÕES', 'CONFERÊNCIA DO CAIXA', 'RECONCILIAÇÃO',
      'CANCELAMENTOS', 'FISCAL / NÃO FISCAL', 'Documento de conferência do caixa.',
      '1.250,00', '1.200,00', '50,00', LONGO, 'Terminal do salão principal'
    ]) {
      assert.ok(html.includes(trecho), trecho);
    }
    assert.match(html, /class="valor"[^>]*>[^<]*1\.250,00/);
    assert.doesNotMatch(html, /white-space:\s*nowrap/);
  });
});
