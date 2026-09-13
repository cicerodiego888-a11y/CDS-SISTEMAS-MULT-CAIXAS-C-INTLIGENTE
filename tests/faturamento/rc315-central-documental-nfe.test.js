/**
 * RC3.15 — Central NF-e como única Central Documental.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('RC3.15 — Fase A consolidação', () => {
  it('Expedição remove Emitir/DANFE e navega para Central após autorização', () => {
    const fat = read('frontend/erp/js/faturamento.js');
    assert.match(fat, /concluirEmissaoNaCentralDocumental/);
    assert.match(fat, /Abrir Central NF-e/);
    assert.match(fat, /apresentarDocumentoNfePosEmissao|posEmissao/);
    assert.doesNotMatch(fat, /fat-acao-emitir/);
    assert.doesNotMatch(fat, /fat-acao-danfe/);
    assert.ok(!/>\s*Emitir NF-e\s*</.test(fat));
  });

  it('Central NF-e expõe deep-link e ficha documental', () => {
    const ui = read('frontend/erp/js/nfe-central.js');
    assert.match(ui, /abrirCentralNfeDocumental/);
    assert.match(ui, /apresentarDocumentoNfePosEmissao/);
    assert.match(ui, /visualizarFichaNfe/);
    assert.match(ui, /__CDS_NFE_FOCUS_NOTA_ID/);
    assert.match(ui, /__CDS_NFE_POS_EMISSAO/);
    assert.match(ui, /copiarXmlNfe/);
    assert.match(ui, /renderTimelineNfe|Criada/);
    assert.match(ui, /Central Documental/);
    assert.match(ui, /nfe\/notas\/\$\{.*\}\/ficha|\/ficha/);
  });
});

describe('RC3.15.2 — paridade UX pós-emissão', () => {
  it('abre visualização automaticamente e oferecee DANFE após autorização', () => {
    const ui = read('frontend/erp/js/nfe-central.js');
    assert.match(ui, /posEmissao/);
    assert.match(ui, /visualizarDanfeNfe/);
    assert.match(ui, /Imprimir DANFE/);
    assert.match(ui, /Copiar Chave|copiarChaveNfe/);
    assert.match(ui, /Pendência documental|pendente/);
  });

  it('Expedição e Avulsa usam apresentarDocumentoNfePosEmissao', () => {
    const fat = read('frontend/erp/js/faturamento.js');
    const av = read('frontend/erp/js/nfe-avulsa.js');
    assert.match(fat, /apresentarDocumentoNfePosEmissao/);
    assert.match(av, /apresentarDocumentoNfePosEmissao/);
  });
});

describe('RC3.15.3 — cabeçalho documental autorizado', () => {
  it('exibe cabeçalho com número, série, chave, protocolo e data', () => {
    const ui = read('frontend/erp/js/nfe-central.js');
    assert.match(ui, /renderCabecalhoNfeAutorizada/);
    assert.match(ui, /NF-e autorizada/i);
    assert.match(ui, /Chave de Acesso/);
    assert.match(ui, /Data\/Hora da autorização/);
    assert.match(ui, /renderAcoesPrincipaisNfeAutorizada/);
    assert.match(ui, /copiarChaveNfe/);
    assert.match(ui, /Chave copiada/);
    assert.match(ui, /renderPendenciaDocumentalNfe/);
    assert.match(ui, /Motivo da rejeição/);
    assert.match(ui, /imprimir:\s*true|imprimir = true/);
  });
});

describe('RC3.15 — API e núcleos', () => {
  it('API ficha documental montada sem alterar emissor', () => {
    const rota = read('backend/rotas/nfe.js');
    const svc = read('backend/services/fiscal/nfeCentralService.js');
    assert.match(rota, /notas\/:id\/ficha/);
    assert.match(svc, /obterFichaDocumentalNfe/);
    assert.match(svc, /timeline/);
    const emissor = read('backend/services/fiscal/nfeEmissorVenda.js');
    // Emissor não navega para a Central (comentários de RC ok)
    assert.doesNotMatch(emissor, /abrirCentralNfe|loadPage\(['"]nfe-central['"]\)/);
  });

  it('núcleos preservados', () => {
    const files = [
      'backend/services/vendas/VendaApplicationService.js',
      'backend/services/vendas/VendaPagamentoService.js',
      'backend/services/fiscal/nfeEmissorVenda.js',
      'backend/services/midp/MotorInteligenteDistribuicaoPagamentos.js'
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
    }
  });
});
