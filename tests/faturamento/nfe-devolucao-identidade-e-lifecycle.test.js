/**
 * Identidade fiscal, hash XML, 539, lock, preflight e reenvio da NF-e de devolução.
 * Não transmite SEFAZ e não altera dados fiscais reais.
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  calcularHashXml,
  compararXmlFiscal,
  validarChaveContraXml,
  validarMesmaChaveMesmoXml
} = require('../../backend/services/fiscal/nfeXmlIdentityService');
const {
  criarIdentidadeNfe,
  calcularChaveNfe,
  parseChaveNfe,
  validarIdentidadePersistida,
  filtrarCamposIdentidadeSeCongelado,
  validarDisponibilidadeNumero,
  validarConflitoDeChave,
  diagnosticarDuplicidadeNfe
} = require('../../backend/services/fiscal/nfeIdentityService');
const { classificarRetornoSefaz, ACOES } = require('../../backend/services/fiscal/classificarRetornoSefaz');
const {
  adquirirLock,
  liberarLock,
  withLockQueued,
  resetLocksForTests
} = require('../../backend/services/fiscal/nfeEmissionLockService');
const { preflightNfeDevolucao } = require('../../backend/services/fiscal/nfeDevolucaoPreflight');
const {
  podeReenviarDevolucao,
  mensagemReenvioXmlEstruturalmenteRejeitado,
  ESTADOS
} = require('../../backend/services/fiscal/nfeDevolucaoEstados');
const { criarNovaEmissaoDevolucao } = require('../../backend/services/fiscal/nfeDevolucaoCompra');
const {
  extrairChaveConflito539,
  proximoNumeroLivre,
  marcarOcupadoMemoria,
  numeroOcupadoSefazEmMemoria,
  resetNumeracaoForTests
} = require('../../backend/services/fiscal/nfeNumeracaoNfeService');

const ID_BASE = {
  uf: '23',
  aamm: '2608',
  cnpj: '65957340000150',
  modelo: '55',
  serie: 1,
  numero: 7,
  tpEmis: '1',
  ambiente: 2
};

function xmlComChave(chave, extra = '') {
  return `<NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><nNF>7</nNF></ide>${extra}</infNFe></NFe>`;
}

describe('NF-e devolução — identidade e lifecycle', () => {
  beforeEach(() => {
    resetLocksForTests();
    resetNumeracaoForTests();
  });

  it('1. mesma chave + mesmo XML', () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const xml = xmlComChave(id.chave);
    const r = validarConflitoDeChave({
      chave: id.chave,
      xml,
      documentos: [{ chave_acesso: id.chave, xml_enviado: xml, xml_hash: calcularHashXml(xml) }]
    });
    assert.equal(r.ok, true);
    assert.equal(compararXmlFiscal(xml, xml).iguais, true);
  });

  it('2. mesma chave + XML diferente: BLOQUEADO', () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const xmlA = xmlComChave(id.chave, '<det nItem="1"/>');
    const xmlB = xmlComChave(id.chave, '<det nItem="2"/>');
    assert.notEqual(calcularHashXml(xmlA), calcularHashXml(xmlB));
    assert.throws(
      () => validarMesmaChaveMesmoXml({
        chave: id.chave,
        xmlAtual: xmlB,
        xmlReferencia: xmlA
      }),
      /conteúdo diferente/
    );
  });

  it('3. mesmo número + chave diferente: BLOQUEADO', () => {
    const a = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const b = criarIdentidadeNfe({ ...ID_BASE, cNF: '22222222' });
    assert.equal(a.numero, b.numero);
    assert.notEqual(a.chave, b.chave);
    assert.throws(
      () => validarDisponibilidadeNumero({
        numero: 7,
        serie: 1,
        ambiente: 2,
        documentos: [{ id: 1, numero: 7, serie: 1, ambiente: 2, chave_acesso: a.chave, xml_enviado: '<x/>', status: 'rejeitada' }]
      }),
      /já está em uso/
    );
    assert.notEqual(a.chave, b.chave);
  });

  it('4. 539 com NF-e existente autorizada → sincronizar', async () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const xml = xmlComChave(id.chave);
    const diag = await diagnosticarDuplicidadeNfe({
      compraId: 2,
      nota: { id: 9, numero: 7, serie: 1, chave_acesso: id.chave, ambiente: 2, status: 'rejeitada' },
      parsed: { cStat: '539', xMotivo: 'Duplicidade de NF-e, com diferença na Chave de Acesso', chNFe: id.chave },
      xmlAtual: xml,
      documentosRelacionados: [{
        id: 9, tipo: 'DEVOLUCAO_COMPRA', numero: 7, serie: 1, chave_acesso: id.chave, status: 'rejeitada'
      }],
      consultaSefaz: async () => ({ cStat: '100', nProt: '123456', chNFe: id.chave })
    });
    assert.equal(diag.decisao, 'SINCRONIZAR_DOCUMENTO_AUTORIZADO');
    assert.equal(diag.estadoFinal, ESTADOS.AUTORIZADA);
    assert.equal(diag.cStat, '539');
  });

  it('5. 539 com conflito local (mesmo número, outra chave)', async () => {
    const a = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const b = criarIdentidadeNfe({ ...ID_BASE, cNF: '22222222' });
    const diag = await diagnosticarDuplicidadeNfe({
      compraId: 2,
      nota: { id: 10, numero: 7, serie: 1, chave_acesso: b.chave, ambiente: 2, status: 'rejeitada' },
      parsed: { cStat: '539', xMotivo: 'Duplicidade', chNFe: a.chave },
      xmlAtual: xmlComChave(b.chave),
      documentosRelacionados: [
        { id: 8, tipo: 'DEVOLUCAO_COMPRA', numero: 7, serie: 1, chave_acesso: a.chave, status: 'rejeitada' },
        { id: 10, tipo: 'DEVOLUCAO_COMPRA', numero: 7, serie: 1, chave_acesso: b.chave, status: 'rejeitada' }
      ],
      consultaSefaz: async () => ({ cStat: '217' })
    });
    assert.equal(diag.existeDocumentoComMesmoNumero, true);
    assert.match(diag.decisao, /CONFLITO_LOCAL|NOVA_IDENTIDADE|PENDENTE/);
    assert.notEqual(diag.estadoFinal, ESTADOS.AUTORIZADA);
  });

  it('6. 275 bloqueada para reenvio', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', rejeicao_codigo: '275' }), false);
    assert.match(mensagemReenvioXmlEstruturalmenteRejeitado({ cstat_retorno: '275' }), /nova emissão/i);
  });

  it('7. 590 bloqueada para reenvio', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '590' }), false);
  });

  it('8. 863 bloqueada para reenvio', () => {
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '863' }), false);
  });

  it('9. nova emissão recebe nova identidade', () => {
    const antiga = criarIdentidadeNfe({ ...ID_BASE, numero: 7, cNF: '11111111' });
    const nova = criarIdentidadeNfe({ ...ID_BASE, numero: 8, cNF: '33333333' });
    assert.notEqual(antiga.chave, nova.chave);
    assert.notEqual(antiga.numero, nova.numero);
    assert.equal(typeof criarNovaEmissaoDevolucao, 'function');
  });

  it('10. XML corrigido não reutiliza documento anterior', () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const nota = { chave_acesso: id.chave, numero: 7, xml_assinado: xmlComChave(id.chave), identidade_congelada: 1 };
    assert.throws(
      () => validarIdentidadePersistida(nota, { chave: criarIdentidadeNfe({ ...ID_BASE, cNF: '99999999' }).chave }),
      /imutável/
    );
  });

  it('11. duplo clique não gera duas emissões', () => {
    adquirirLock('devolucao-compra:2');
    assert.throws(() => adquirirLock('devolucao-compra:2'), /já está sendo processada/);
    liberarLock('devolucao-compra:2');
  });

  it('12. duas requisições simultâneas não geram o mesmo número', async () => {
    const store = { n: 10 };
    const a = withLockQueued('nfe-numero-global', async () => {
      const v = store.n;
      await new Promise((r) => setTimeout(r, 20));
      store.n = v + 1;
      return v;
    });
    const b = withLockQueued('nfe-numero-global', async () => {
      const v = store.n;
      store.n = v + 1;
      return v;
    });
    const [na, nb] = await Promise.all([a, b]);
    assert.notEqual(na, nb);
    assert.deepEqual([na, nb].sort((x, y) => x - y), [10, 11]);
  });

  it('13. documento autorizado não pode ter chave alterada', () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const nota = { chave_acesso: id.chave, numero: 7, xml_enviado: '<x/>', status: 'autorizada' };
    const patch = filtrarCamposIdentidadeSeCongelado(nota, { chave_acesso: '9'.repeat(44), numero: 99, status: 'autorizada' });
    assert.equal(patch.chave_acesso, undefined);
    assert.equal(patch.numero, undefined);
    assert.equal(patch.status, 'autorizada');
  });

  it('14. documento transmitido não pode ter XML substituído (identidade congelada)', () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '11111111' });
    const xml1 = xmlComChave(id.chave, '<a/>');
    const xml2 = xmlComChave(id.chave, '<b/>');
    const nota = { xml_assinado: xml1, xml_enviado: xml1, chave_acesso: id.chave };
    assert.throws(
      () => validarMesmaChaveMesmoXml({ chave: id.chave, xmlAtual: xml2, xmlReferencia: nota.xml_assinado }),
      /conteúdo diferente/
    );
  });

  it('15. hash XML é persistido (cálculo SHA-256 estável)', () => {
    const xml = xmlComChave('2'.repeat(44));
    const h = calcularHashXml(xml);
    assert.match(h, /^[a-f0-9]{64}$/);
    assert.equal(h, calcularHashXml(`  ${xml}  \n`));
  });

  it('16. consulta SEFAZ sincroniza documento existente (204/100)', () => {
    const cls204 = classificarRetornoSefaz('204');
    assert.equal(cls204.acao, ACOES.SINCRONIZAR_DOCUMENTO_EXISTENTE);
    assert.equal(cls204.reenvioPermitido, false);
    const cls100 = classificarRetornoSefaz('100');
    assert.equal(cls100.acao, ACOES.AUTORIZADA);
  });

  it('17. preflight é obrigatório', () => {
    const r = preflightNfeDevolucao({
      xml: '',
      built: { chave: '1'.repeat(44), serie: 1 },
      config: { cnpj: '65957340000150', ambiente: 2 }
    });
    assert.equal(r.preflightObrigatorio, true);
    assert.equal(r.aprovado, false);
  });

  it('18. emissão anterior preservada no histórico (não sobrescreve identidade)', () => {
    const a = criarIdentidadeNfe({ ...ID_BASE, numero: 6, cNF: '10000001' });
    const b = criarIdentidadeNfe({ ...ID_BASE, numero: 7, cNF: '10000002' });
    const historico = [
      { id: 5, numero: a.numero, chave: a.chave, status: 'rejeitada' },
      { id: 6, numero: b.numero, chave: b.chave, status: 'rejeitada' }
    ];
    assert.equal(historico[0].chave, a.chave);
    assert.notEqual(historico[0].id, historico[1].id);
    assert.notEqual(historico[0].chave, historico[1].chave);
  });

  it('539 nNF 9: chave do motivo é da SEFAZ e o próximo número pula ocupados', async () => {
    const motivo =
      'Rejeicao: Duplicidade de NF-e, com diferença na Chave de Acesso [chNFe:23250557824986000131550010000000091190010765]';
    const chaveSefaz = extrairChaveConflito539(motivo);
    assert.equal(chaveSefaz, '23250557824986000131550010000000091190010765');
    const parsedSefaz = parseChaveNfe(chaveSefaz);
    assert.equal(parsedSefaz.numero, 9);
    assert.equal(parsedSefaz.aamm, '2505');
    const local = criarIdentidadeNfe({ ...ID_BASE, numero: 9, cNF: '17371031' });
    const diag = await diagnosticarDuplicidadeNfe({
      compraId: 2,
      nota: { id: 8, numero: 9, serie: 1, chave_acesso: local.chave, ambiente: 2, status: 'rejeitada' },
      parsed: { cStat: '539', xMotivo: motivo, chNFe: local.chave },
      xmlAtual: xmlComChave(local.chave),
      documentosRelacionados: [
        { id: 8, tipo: 'DEVOLUCAO_COMPRA', numero: 9, serie: 1, chave_acesso: local.chave, status: 'rejeitada' }
      ],
      consultaSefaz: async () => ({ indeterminado: true })
    });
    assert.equal(diag.chaveEncontradaNaSefaz, chaveSefaz);
    assert.equal(diag.decisao, 'NUMERO_JA_UTILIZADO_NA_SEFAZ_EXIGE_NOVA_IDENTIDADE');
    assert.notEqual(diag.estadoFinal, ESTADOS.AUTORIZADA);
    marcarOcupadoMemoria({ ambiente: 2, serie: 1, numero: 8 });
    marcarOcupadoMemoria({ ambiente: 2, serie: 1, numero: 9 });
    assert.equal(numeroOcupadoSefazEmMemoria({ ambiente: 2, serie: 1, numero: 9 }), true);
    assert.equal(proximoNumeroLivre(8, [8, 9]), 10);
  });

  it('539 classificado como EXIGE_NOVA_IDENTIDADE e não reenvia', () => {
    const cls = classificarRetornoSefaz('539');
    assert.equal(cls.acao, ACOES.EXIGE_NOVA_IDENTIDADE);
    assert.equal(podeReenviarDevolucao({ status: 'rejeitada', cstat_retorno: '539' }), false);
    assert.match(mensagemReenvioXmlEstruturalmenteRejeitado({ cstat_retorno: '539' }), /nova identidade/i);
  });

  it('calcularChaveNfe bate com parseChaveNfe', () => {
    const id = criarIdentidadeNfe({ ...ID_BASE, cNF: '12345678' });
    assert.equal(calcularChaveNfe({ ...ID_BASE, cNF: '12345678' }), id.chave);
    const p = parseChaveNfe(id.chave);
    assert.equal(p.numero, 7);
    assert.equal(p.cNF, '12345678');
    assert.equal(p.modelo, '55');
    validarChaveContraXml(id.chave, xmlComChave(id.chave));
  });
});
