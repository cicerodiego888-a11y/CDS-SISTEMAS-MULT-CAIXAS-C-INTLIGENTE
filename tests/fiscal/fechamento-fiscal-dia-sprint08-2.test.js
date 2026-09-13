/**
 * Sprint 08.2 — Restaurar menu original de ações em Fiscal → NFC-e Emitidas
 * Executar: node --test tests/fiscal/fechamento-fiscal-dia-sprint08-2.test.js
 * NÃO transmite em produção.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const FRONT_FISCAL = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/fiscal.js'), 'utf8');
const FRONT_FFD = fs.readFileSync(
  path.join(ROOT, 'frontend/erp/js/fechamento-fiscal-dia.js'),
  'utf8'
);
const HISTORICO = fs.readFileSync(
  path.join(ROOT, 'frontend/shared/js/vendasHistoricoUi.js'),
  'utf8'
);

function blocoMenuAcoes() {
  const start = FRONT_FISCAL.indexOf('function montarHtmlAcoesNfceEmitida');
  const end = FRONT_FISCAL.indexOf('function acaoNfceEmitidaExigirVenda');
  assert.ok(start > 0 && end > start, 'bloco montarHtmlAcoesNfceEmitida ausente');
  return FRONT_FISCAL.slice(start, end);
}

describe('Sprint 08.2 — menu original NFC-e Emitidas', () => {
  it('A — coluna Ações usa montarHtmlAcoesNfceEmitida (não botões improvisados do 08.1)', () => {
    assert.match(FRONT_FISCAL, /\$\{montarHtmlAcoesNfceEmitida\(n\)\}/);
    assert.doesNotMatch(FRONT_FISCAL, /onclick=\"abrirDanfeNfceEmitida/);
    assert.doesNotMatch(FRONT_FISCAL, /title=\"Cupom Fiscal\"/);
    assert.doesNotMatch(FRONT_FISCAL, /n\.venda_id \? `.*cancelarNfce/);
  });

  it('B — menu contém exatamente as 4 opções originais (textos)', () => {
    const bloco = blocoMenuAcoes();
    assert.match(bloco, /Ver detalhes/);
    assert.match(bloco, /Resumo NFC-e \/ TEF/);
    assert.match(bloco, /Devolução parcial/);
    assert.match(bloco, /Cancelar venda/);
    assert.doesNotMatch(bloco, /Reimprimir [Cc]upom|Cupom Fiscal|Abrir DANFE/);
    assert.doesNotMatch(bloco, /Cancelar NFC-e/);
  });

  it('C — NFC-e do Fechamento usa o mesmo gerador de menu (sem menu especial)', () => {
    assert.match(FRONT_FISCAL, /\$\{montarHtmlAcoesNfceEmitida\(n\)\}/);
    assert.doesNotMatch(FRONT_FISCAL, /origem === 'fechamento_fiscal_dia'[\s\S]{0,200}dropdown-item/);
    const bloco = blocoMenuAcoes();
    assert.doesNotMatch(bloco, /fechamento_fiscal_dia|menu especial/);
  });

  it('D — ícones e ordem iguais ao histórico de vendas', () => {
    assert.match(HISTORICO, /fa-eye[\s\S]*Ver detalhes/);
    assert.match(HISTORICO, /fa-file-alt[\s\S]*Resumo NFC-e \/ TEF/);
    assert.match(HISTORICO, /fa-undo[\s\S]*Devolução parcial/);
    assert.match(HISTORICO, /fa-times[\s\S]*Cancelar venda/);

    const bloco = blocoMenuAcoes();
    assert.match(
      bloco,
      /Ver detalhes[\s\S]*Resumo NFC-e \/ TEF[\s\S]*\$\{blocoOperacional\}/
    );
    assert.match(bloco, /fa-undo[\s\S]*Devolução parcial/);
    assert.match(bloco, /fa-times[\s\S]*Cancelar venda/);
    assert.match(bloco, /fa-eye/);
    assert.match(bloco, /fa-file-alt/);
  });

  it('E — cada opção chama o fluxo existente correspondente', () => {
    assert.match(FRONT_FISCAL, /viewVenda\(/);
    assert.match(FRONT_FISCAL, /verDetalheFiscal\(/);
    assert.match(FRONT_FISCAL, /verResumoVendaFiscalTEF\(/);
    assert.match(FRONT_FISCAL, /abrirDevolucaoVenda\(/);
    assert.match(FRONT_FISCAL, /cancelarVendaNaoFiscal\(/);
    assert.match(FRONT_FISCAL, /function cancelarNfce/);
    assert.doesNotMatch(FRONT_FISCAL, /function abrirDanfeNfceEmitida/);
  });

  it('F — cupom automático após AUTORIZADO no Fechamento permanece (fora do menu)', () => {
    assert.match(FRONT_FFD, /ffdAbrirCupomAposAutorizacao/);
    assert.match(FRONT_FFD, /body\.status === 'AUTORIZADO'/);
    assert.match(FRONT_FFD, /ffdMostrarModalCupomFiscal/);
    assert.match(FRONT_FFD, /imprimirHtmlFiscal/);
  });

  it('G — FF label de identificação permanece; ações não diferem por origem no gerador', () => {
    assert.match(FRONT_FISCAL, /FF-\$\{String\(ff\)\.padStart\(6, '0'\)\}|rotuloColunaVendaNfce/);
    const bloco = blocoMenuAcoes();
    assert.doesNotMatch(bloco, /menu especial/);
  });
});
