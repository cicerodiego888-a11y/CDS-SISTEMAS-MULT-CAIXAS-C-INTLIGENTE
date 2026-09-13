/**
 * Central de DANFE NF-e 55 — visualização, reimpressão, XML e PDF.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const {
  normalizarTipoDocumento,
  statusEhAutorizado,
  statusBloqueiaDanfeAutorizado,
  validarDocumentoAutorizado,
  validarIdentidadeDocumento,
  extrairXmlPersistido,
  gerarPdfDanfeBuffer,
  aplicarCssImpressaoA4
} = require('../../backend/services/fiscal/danfeService');
const { gerarDanfeNfeHtml } = require('../../backend/services/fiscal/danfeNfe');

const CHAVE_A = '23260865957340000150550010000001001234567890';
const CHAVE_B = '23260865957340000150550010000002009876543210';

function doc(parcial) {
  return {
    modelo: '55',
    tipo: 'VENDA',
    id: 1,
    numero: 10,
    serie: 1,
    chave: CHAVE_A,
    status: 'autorizada',
    protocolo: '141250000012345',
    ...parcial
  };
}

describe('Central DANFE — identificação e status', () => {
  it('normaliza tipos de origem para um único domínio', () => {
    assert.equal(normalizarTipoDocumento('venda'), 'VENDA');
    assert.equal(normalizarTipoDocumento('DEVOLUCAO_COMPRA'), 'DEVOLUCAO_COMPRA');
    assert.equal(normalizarTipoDocumento('dev-venda'), 'DEVOLUCAO_VENDA');
    assert.equal(normalizarTipoDocumento('nfe'), 'VENDA');
  });

  it('somente AUTORIZADA/AUTORIZADO abre como DANFE definitivo', () => {
    assert.equal(statusEhAutorizado('AUTORIZADA'), true);
    assert.equal(statusEhAutorizado('autorizado'), true);
    assert.equal(statusEhAutorizado('rejeitada'), false);
    assert.equal(statusEhAutorizado('rascunho'), false);
    assert.equal(statusEhAutorizado('pendente'), false);
    assert.equal(statusBloqueiaDanfeAutorizado('rejeitada'), true);
    assert.equal(statusBloqueiaDanfeAutorizado('rascunho'), true);
    assert.equal(statusBloqueiaDanfeAutorizado('pendente'), true);
  });

  it('rejeitada / rascunho / pendente não validam como autorizada', () => {
    for (const status of ['rejeitada', 'rascunho', 'pendente']) {
      assert.throws(
        () => validarDocumentoAutorizado(doc({ status })),
        (err) => err.code === 'DOCUMENTO_NAO_AUTORIZADO'
      );
    }
    assert.doesNotThrow(() => validarDocumentoAutorizado(doc({ status: 'autorizada' })));
  });

  it('chave, número e série divergentes não misturam documentos', () => {
    const autorizado = doc({ id: 1, numero: 10, serie: 1, chave: CHAVE_A });
    assert.throws(
      () => validarIdentidadeDocumento(autorizado, { chave: CHAVE_B }),
      (err) => err.code === 'IDENTIDADE_DIVERGENTE'
    );
    assert.throws(
      () => validarIdentidadeDocumento(autorizado, { numero: 11 }),
      (err) => err.code === 'IDENTIDADE_DIVERGENTE'
    );
    assert.throws(
      () => validarIdentidadeDocumento(autorizado, { serie: 2 }),
      (err) => err.code === 'IDENTIDADE_DIVERGENTE'
    );
    assert.doesNotThrow(() => validarIdentidadeDocumento(autorizado, {
      chave: CHAVE_A, numero: 10, serie: 1
    }));
  });
});

describe('Central DANFE — XML persistido e PDF', () => {
  it('XML autorizado usa o persistido e não reconstrói identidade', () => {
    const xmlAut = `<nfeProc><protNFe><infProt><chNFe>${CHAVE_A}</chNFe><nProt>P1</nProt></infProt></protNFe></nfeProc>`;
    const xml = extrairXmlPersistido({
      xml_autorizado: xmlAut,
      xml_enviado: '<NFe>NOVO</NFe>',
      xml_retorno: '<ret>x</ret>'
    });
    assert.equal(xml, xmlAut);
    const svc = read('backend/services/fiscal/danfeService.js');
    assert.doesNotMatch(svc, /buildXmlNFe|assinarXml|proximoNumeroNFeVenda|reservarProximoNumeroNfe/);
  });

  it('sem xml_autorizado extrai nfeProc já persistido no retorno', () => {
    const proc = `<nfeProc versao="4.00"><NFe/><protNFe><infProt><chNFe>${CHAVE_A}</chNFe></infProt></protNFe></nfeProc>`;
    const xml = extrairXmlPersistido({ xml_retorno: `<?xml?><soap>${proc}</soap>` });
    assert.match(xml, /<nfeProc/);
    assert.match(xml, new RegExp(CHAVE_A));
  });

  it('PDF é representação visual e contém identidade do documento', () => {
    const buf = gerarPdfDanfeBuffer(doc({}));
    const txt = buf.toString('latin1');
    assert.match(txt, /%PDF-1.4/);
    assert.match(txt, /DANFE/);
    assert.match(txt, /000\.000\.010|N\. 000\.000\.010/);
    assert.match(txt, /Serie 001/);
    assert.match(txt, new RegExp(CHAVE_A));
    assert.match(txt, /141250000012345/);
    assert.match(txt, /CALCULO DO IMPOSTO/);
    assert.match(txt, /DADOS DOS PRODUTOS/);
  });
});

describe('Central DANFE — HTML autorizado vs prévia', () => {
  it('DANFE autorizado usa chave, número, série e protocolo corretos', async () => {
    const html = await gerarDanfeNfeHtml({
      venda: { valor_fiscal: 10, cliente_nome: 'DEST' },
      itens: [{ produto_nome: 'Item', quantidade_fiscal: 1, valor_fiscal: 10 }],
      empresa: { nome: 'EMP', cnpj: '65957340000150' },
      chave: CHAVE_A,
      numero: 88,
      serie: 3,
      protocolo: 'PROT-88',
      status: 'autorizada',
      dhAutorizacao: '2026-08-27 10:00:00',
      chaveReferenciada: CHAVE_B
    });
    assert.match(html, /88/);
    assert.match(html, /003/);
    assert.match(html, new RegExp(CHAVE_A));
    assert.match(html, /PROT-88/);
    assert.match(html, /DANFE/);
    assert.match(html, new RegExp(CHAVE_B));
    assert.doesNotMatch(html, /SEM VALOR FISCAL/);
    assert.match(aplicarCssImpressaoA4(html), /size:\s*A4/);
  });

  it('prévia não se apresenta como DANFE autorizado', async () => {
    const html = await gerarDanfeNfeHtml({
      venda: { cliente_nome: 'X' },
      itens: [],
      empresa: {},
      chave: '',
      numero: 1,
      serie: 1,
      status: 'PREVIA'
    });
    assert.match(html, /SEM VALOR FISCAL/);
    assert.doesNotMatch(html, /✓ AUTORIZADA/);
  });
});

describe('Central DANFE — UI pós-autorização e reimpressão', () => {
  it('NF-e normal autorizada abre DANFE (não encerra só com alert)', () => {
    const ui = read('frontend/erp/js/nfe-central.js');
    assert.match(ui, /apresentarDocumentoNfePosEmissao/);
    assert.match(ui, /abrirDanfe\(/);
    assert.match(ui, /auto:\s*true/);
  });

  it('alert antigo da devolução de compra não encerra o fluxo antes do DANFE', () => {
    const compras = read('frontend/erp/js/compras.js');
    assert.match(compras, /abrirDanfe\(\{[\s\S]*DEVOLUCAO_COMPRA/);
    assert.doesNotMatch(compras, /alert\(\s*`NF-e de devolução autorizada/);
  });

  it('devolução de venda autorizada abre DANFE', () => {
    const fat = read('frontend/erp/js/faturamento.js');
    assert.match(fat, /abrirDanfe\(\{[\s\S]*DEVOLUCAO_VENDA/);
  });

  it('reimpressão não transmite nem gera nova nota', () => {
    const viewer = read('frontend/shared/js/nfeDanfeViewer.js');
    const compras = read('frontend/erp/js/compras.js');
    const fat = read('frontend/erp/js/faturamento.js');
    assert.match(viewer, /imprimirDanfeAtual/);
    assert.doesNotMatch(viewer, /emitir-nfe|emitirNfe|reenviar/);
    assert.match(compras, /imprimir:true/);
    assert.match(fat, /imprimir:true/);
    assert.doesNotMatch(viewer, /proximoNumero|reservarProximo/);
  });

  it('histórico autorizado oferece DANFE, reimpressão, PDF e XML', () => {
    const compras = read('frontend/erp/js/compras.js');
    const fat = read('frontend/erp/js/faturamento.js');
    const central = read('frontend/erp/js/nfe-central.js');
    assert.match(compras, /baixarDanfePdf/);
    assert.match(compras, /baixarXmlNfe55/);
    assert.match(fat, /baixarDanfePdf/);
    assert.match(central, /Baixar PDF/);
  });

  it('API central reutiliza um único serviço', () => {
    const rota = read('backend/rotas/nfe.js');
    assert.match(rota, /documentos\/:tipo\/:id\/danfe/);
    assert.match(rota, /documentos\/:tipo\/:id\/xml/);
    assert.match(rota, /documentos\/:tipo\/:id\/pdf/);
    assert.match(rota, /danfeCentral/);
    assert.doesNotMatch(rota, /DanfeCompraService|DanfeVendaService|DanfeDevolucaoService/);
  });

  it('Central NF-e lista devolução de compra junto com venda', () => {
    const svc = read('backend/services/fiscal/nfeCentralService.js');
    const ui = read('frontend/erp/js/nfe-central.js');
    assert.match(svc, /nfe_devolucoes_compra/);
    assert.match(svc, /DEVOLUCAO_COMPRA/);
    assert.match(ui, /Reimprimir/);
    assert.match(ui, /DEVOLUCAO_COMPRA/);
  });
});
