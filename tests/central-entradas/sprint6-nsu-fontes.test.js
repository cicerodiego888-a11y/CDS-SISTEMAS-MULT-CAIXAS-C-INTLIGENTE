/**
 * Sprint 6 — Classificação DOCUMENT/CURSOR/QUERY NSU + intervalos
 * node --test tests/central-entradas/sprint6-nsu-fontes.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MotorReconcilicaoDfe,
  AchadoCodigo,
  classificarNsus,
  NsuFonte
} = require('../../backend/services/fiscal/descoberta-nsu');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

function motorComDados({ cursor, documentos = [], auditoria = [], cnpj = '14200166000187', ambiente = 1 }) {
  const m = new MotorReconcilicaoDfe({});
  return m.reconciliar({
    cnpj,
    ambiente,
    cursor,
    documentos,
    auditoriaItens: auditoria,
    modo: 'profunda',
    salvarSnapshot: false
  });
}

describe('Sprint 6 — fontes NSU', () => {
  it('classificarNsus separa DOCUMENT / CURSOR / QUERY', () => {
    const r = classificarNsus(
      [{ nsu: '100' }, { nsu: '101' }],
      [
        { tipo: 'NSU', nsu: '200', detalhe: JSON.stringify({ ultNsuAnterior: '100', ultNsuNovo: '200' }) },
        { tipo: 'CONSULTA', nsu: '150' },
        { tipo: 'ZIP', nsu: '104' }
      ],
      (n) => String(n).padStart(15, '0')
    );
    assert.ok(r.documentNsus.some((n) => n.endsWith('100')));
    assert.ok(r.documentNsus.some((n) => n.endsWith('104')));
    assert.ok(r.cursorNsus.some((n) => n.endsWith('200')));
    assert.ok(r.queryNsus.some((n) => n.endsWith('150')));
    assert.equal(NsuFonte.DOCUMENT, 'DOCUMENT_NSUS');
  });

  it('1. docs 100,101,104 → possível intervalo (não NF-e perdidas)', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '104', maxNsu: '104' },
      documentos: [
        { id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '101', chave: '2'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 3, nsu: '104', chave: '3'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ]
    });
    const lac = r.achados.find((a) => a.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU);
    assert.ok(lac);
    assert.equal(lac.classificacao, 'POSSIVEL_INTERVALO_NSU');
    assert.equal(lac.fonte, 'DOCUMENT_NSUS');
    assert.match(lac.observacao || '', /Não representa quantidade de NF-e perdidas/i);
    assert.equal(r.indicadoresDashboard.possiveisIntervalosNsu, 1);
    assert.equal(r.indicadoresDashboard.posicoesNaoObservadas, 2);
  });

  it('2. cursor 100→104 não classifica 102,103 como documentos ausentes via lacuna', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '104', maxNsu: '104' },
      documentos: [
        { id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '104', chave: '2'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ],
      auditoria: [{
        tipo: 'NSU',
        nsu: '104',
        correlation_id: 'REQ-1',
        detalhe: JSON.stringify({ ultNsuAnterior: '100', ultNsuNovo: '104', avancou: true })
      }]
    });
    // Intervalo entre docs 100 e 104 = 1 achado de intervalo
    const intervalos = r.achados.filter((a) => a.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU);
    assert.equal(intervalos.length, 1);
    assert.equal(intervalos[0].intervalo, 3);
    // Salto de cursor pode existir, mas não multiplica lacunas de documento
    const salto = r.achados.find((a) => a.codigo === AchadoCodigo.SALTO_NSU_OBSERVADO);
    if (salto) assert.equal(salto.fonte, 'CURSOR_NSUS');
  });

  it('3. CRÍTICO: cursor 100→200 com docs 100,101,200 NÃO cria ~98 lacunas', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '200', maxNsu: '200' },
      documentos: [
        { id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '101', chave: '2'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 3, nsu: '200', chave: '3'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ],
      auditoria: [{
        tipo: 'NSU',
        nsu: '200',
        detalhe: JSON.stringify({ ultNsuAnterior: '100', ultNsuNovo: '200' })
      }]
    });
    const intervalos = r.achados.filter((a) => a.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU);
    // Apenas intervalos entre documentos observados: 100-101 (0) e 101-200 (1 intervalo)
    assert.equal(intervalos.length, 1);
    assert.equal(intervalos[0].intervalo, 98);
    assert.ok(intervalos.length < 90, 'não deve explodir em dezenas de achados por posição de cursor');
    assert.equal(r.nsuFontes.CURSOR_NSUS.length >= 1, true);
    assert.ok(!r.nsuFontes.DOCUMENT_NSUS.includes(r.nsuFontes.CURSOR_NSUS[0])
      || r.nsuFontes.DOCUMENT_NSUS.includes('000000000000200'));
  });

  it('4. isolamento CNPJ A vs B', async () => {
    const a = await motorComDados({
      cnpj: '11111111000111',
      cursor: { ultNsu: '105', maxNsu: '105' },
      documentos: [
        { id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '101', chave: '2'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 3, nsu: '105', chave: '3'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ]
    });
    const b = await motorComDados({
      cnpj: '22222222000122',
      cursor: { ultNsu: '102', maxNsu: '102' },
      documentos: [
        { id: 1, nsu: '100', chave: '4'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '101', chave: '5'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 3, nsu: '102', chave: '6'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ]
    });
    assert.equal(a.cnpj, '11111111000111');
    assert.equal(b.cnpj, '22222222000122');
    assert.ok(a.achados.some((x) => x.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU));
    assert.ok(!b.achados.some((x) => x.codigo === AchadoCodigo.POSSIVEL_LACUNA_NSU));
  });
});
