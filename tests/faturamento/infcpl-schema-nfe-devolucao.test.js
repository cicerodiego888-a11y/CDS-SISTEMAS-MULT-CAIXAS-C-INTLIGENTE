/**
 * infCpl da NF-e de devolução: schema TString, sem Unicode (225).
 * Não transmite SEFAZ e não altera saldo, NF 100, itens ou NFref.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizarInfCplNfe,
  infCplAceitoPeloSchema
} = require('../../backend/services/fiscal/sanitizarInfCplNfe');
const { montarObservacaoSubstituicao } = require('../../backend/services/fiscal/nfeDevolucaoSubstituicaoService');
const { buildXmlNFeDevolucaoCompra } = require('../../backend/services/fiscal/xmlBuilderNfeDevolucaoCompra');

const CHAVE_COMPRA = '42260707670414000258550010000158601949669171';
const CHAVE_100 = '23260857824986000131550010000001001956868253';
const INF_CPL_ESPERADO = (
  'Nova NF-e de devolucao emitida em substituicao operacional a NF-e no 100, serie 001, '
  + `chave de acesso ${CHAVE_100}, em razao de manifestacao do destinatario - evento 210240 `
  + '(Operacao nao Realizada), relacionada a divergencia nos valores informados na NF-e anterior. '
  + `Devolucao referente a NF-e ${CHAVE_COMPRA}.`
);

function gerarXml(observacoes) {
  return buildXmlNFeDevolucaoCompra({
    config: {
      codigoUf: '23', cnpj: '57824986000131', ie: '1', crt: 1, ambiente: 1, serie: 1,
      nomeEmpresa: 'X', logradouro: 'R', numero: '1', bairro: 'B',
      municipioCodigo: '2307304', municipioNome: 'JUAZEIRO DO NORTE', uf: 'CE',
      cep: '63000000', telefone: '1'
    },
    compra: {
      id: 2,
      chave_acesso: CHAVE_COMPRA,
      numero_nf: '15860',
      fornecedor: 'FORN',
      fornecedor_cnpj: '07670414000258',
      cidade: 'Joinville',
      uf: 'SC'
    },
    itens: [{
      produto_nome: 'ITEM', quantidade: 1, valor_unitario: 10,
      csosn: '102', ncm: '82041100', cst_pis: '07', cst_cofins: '07'
    }],
    numero: 103,
    observacoes
  });
}

describe('infCpl schema NF-e devolução — rejeição 225', () => {
  it('U+2013 e acentos viram representação ASCII segura', () => {
    const bruto = 'destinatário – evento 210240 (Operação não Realizada)';
    const limpo = sanitizarInfCplNfe(bruto);
    assert.equal(limpo.includes('\u2013'), false);
    assert.equal(limpo, 'destinatario - evento 210240 (Operacao nao Realizada)');
    assert.equal(infCplAceitoPeloSchema(limpo), true);
    assert.equal(infCplAceitoPeloSchema(bruto), false);
  });

  it('quebra de linha do infCpl é removida (TString não aceita LF)', () => {
    const limpo = sanitizarInfCplNfe('linha um.\n\nlinha dois.');
    assert.equal(limpo.includes('\n'), false);
    assert.equal(limpo, 'linha um. linha dois.');
    assert.equal(infCplAceitoPeloSchema(limpo), true);
  });

  it('observação 210240 desta NF é o texto ASCII acordado', () => {
    const obs = montarObservacaoSubstituicao({
      numero: 100, serie: 1, chaveAnterior: CHAVE_100, chaveCompra: CHAVE_COMPRA
    });
    assert.equal(obs, INF_CPL_ESPERADO);
    assert.equal(infCplAceitoPeloSchema(obs), true);
  });

  it('XML gerado não leva caractere fora do schema no infCpl; NFref permanece 15860', () => {
    const sujo = (
      'Nova NF-e de devolução emitida em substituição operacional à NF-e nº 100, série 001, '
      + `chave de acesso ${CHAVE_100}, em razão de manifestação do destinatário – evento 210240 `
      + '(Operação não Realizada), relacionada à divergência nos valores informados na NF-e anterior.\n\n'
      + `Devolução referente à NF-e ${CHAVE_COMPRA}.`
    );
    const built = gerarXml(sujo);
    const m = String(built.xmlSemAssinatura).match(/<infCpl>([\s\S]*?)<\/infCpl>/);
    assert.ok(m, 'infCpl ausente');
    const infCplXml = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    assert.equal(infCplXml.includes('\u2013'), false);
    assert.equal(/\n/.test(infCplXml), false);
    assert.equal(infCplAceitoPeloSchema(infCplXml), true);
    assert.equal(built.infCpl, INF_CPL_ESPERADO);
    assert.equal(infCplXml, INF_CPL_ESPERADO);
    assert.match(built.xmlSemAssinatura, new RegExp(`<NFref><refNFe>${CHAVE_COMPRA}</refNFe></NFref>`));
    assert.doesNotMatch(built.xmlSemAssinatura, /<DFeReferenciado>/);
  });
});
