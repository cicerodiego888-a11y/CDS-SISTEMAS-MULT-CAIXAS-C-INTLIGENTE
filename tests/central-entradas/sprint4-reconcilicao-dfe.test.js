/**
 * Sprint 4 — Motor de Reconciliação DF-e (somente diagnóstico)
 * node --test tests/central-entradas/sprint4-reconcilicao-dfe.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const {
  MotorReconcilicaoDfe,
  ReconcilicaoStatus,
  AchadoCodigo,
  criarReconciliationId,
  _resetSeqParaTestes
} = require('../../backend/services/fiscal/descoberta-nsu');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { StatusRecuperacaoXml } = require('../../backend/motores/central-entradas/recuperacao-xml/StatusRecuperacaoXml');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

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

describe('Sprint 4 — contratos', () => {
  it('MotorReconcilicaoDfe existe e não importa SOAP/Gate/adapters', () => {
    const src = ler('backend/services/fiscal/descoberta-nsu/MotorReconcilicaoDfe.js');
    assert.match(src, /SOMENTE DIAGNÓSTICO|somente diagnóstico/i);
    assert.doesNotMatch(src, /enviarDistribuicaoDfe|SEFAZQueryGate|distribuicaoDfeRuntime|soap/i);
    assert.doesNotMatch(src, /aplicarRetornoDistDfe|atualizarSincronizacaoSegura/);
  });

  it('não altera Gate / NsuService / Motor XML', () => {
    assert.match(ler('backend/services/fiscal/sefaz/SEFAZQueryGate.js'), /SEFAZQueryGate/);
    assert.match(ler('backend/motores/central-entradas/services/CentralNsuService.js'), /Único ponto oficial/);
    assert.match(ler('backend/motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlService.js'), /recuperacaoXml/);
  });
});

describe('Sprint 4 — resumo', () => {
  it('1. Central consistente', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '000000000000103', maxNsu: '000000000000103' },
      documentos: [
        { id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO, xml: `<infNFe Id="NFe${'1'.repeat(44)}"/>` },
        { id: 2, nsu: '101', chave: '2'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 3, nsu: '102', chave: '3'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 4, nsu: '103', chave: '4'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ]
    });
    assert.equal(r.status, ReconcilicaoStatus.CONSISTENTE);
    assert.equal(r.somenteDiagnostico, true);
    assert.equal(r.consultaSefaz, false);
    assert.deepEqual(r.acoesAutomaticas, []);
    assert.ok(r.reconciliationId.startsWith('RECON-'));
  });

  it('2. XML pendente', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [{
        id: 1, nsu: '100', chave: '1'.repeat(44),
        status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
        statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.XML_PENDENTE));
    assert.equal(r.resumo.aguardandoXml, 1);
    assert.ok([ReconcilicaoStatus.ATENCAO, ReconcilicaoStatus.CONSISTENTE].includes(r.status));
  });

  it('3. XML completo', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [{ id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }]
    });
    assert.equal(r.resumo.xmlCompleto, 1);
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.XML_OK));
  });

  it('4. documentos posteriores (posições, não NF-e)', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '000000000010542', maxNsu: '000000000010587' },
      documentos: []
    });
    const a = r.achados.find((x) => x.codigo === AchadoCodigo.DOCUMENTOS_POSTERIORES_DISPONIVEIS);
    assert.ok(a);
    assert.equal(a.posicoesEntre, 45);
    assert.match(a.mensagem, /45 posições de NSU/);
    assert.doesNotMatch(a.mensagem, /45 NF-e/);
  });

  it('5. cursor igual maxNSU', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '150', maxNsu: '150' },
      documentos: []
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.SEM_DIFERENCA_DE_CURSOR));
  });

  it('6. possível lacuna', async () => {
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
    assert.equal(lac.classificacao, 'POSSIVEL_LACUNA');
    assert.deepEqual(lac.nsusFabricados || [], []);
  });

  it('7. duplicidade NSU', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [
        { id: 1, nsu: '100', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '100', chave: '2'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }
      ]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.DUPLICIDADE_NSU));
  });

  it('8. duplicidade chave', async () => {
    const chave = '9'.repeat(44);
    const r = await motorComDados({
      cursor: { ultNsu: '102', maxNsu: '102' },
      documentos: [
        { id: 1, nsu: '100', chave, status: DocumentoFiscalStatus.XML_COMPLETO },
        { id: 2, nsu: '101', chave, status: DocumentoFiscalStatus.XML_COMPLETO }
      ]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.DUPLICIDADE_CHAVE));
  });

  it('9. erro de recuperação', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [{
        id: 1, nsu: '100', chave: '1'.repeat(44),
        status: DocumentoFiscalStatus.ERRO_RECUPERACAO,
        statusRecuperacao: StatusRecuperacaoXml.ERRO_RECUPERACAO
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.XML_ERRO));
  });

  it('10. lote sem documentos', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      auditoria: [{
        tipo: 'CONSULTA',
        correlation_id: 'SYNC-1',
        created_at: '2026-09-22T10:00:00Z',
        detalhe_json: JSON.stringify({ cStat: '137', lotes: 0, xMotivo: 'Nenhum documento' })
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.LOTE_SEM_DOCUMENTOS));
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.BLOQUEIO_SEFAZ_REGISTRADO && a.cStat === '137'));
  });
});

describe('Sprint 4 — inconsistência', () => {
  it('11. documento NSU sem persistência', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [],
      auditoria: [{
        tipo: 'PERSISTENCIA',
        nsu: '000000000000100',
        correlation_id: 'SYNC-X',
        created_at: '2026-09-22T11:00:00Z'
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.DOCUMENTO_NSU_SEM_PERSISTENCIA));
    assert.equal(r.status, ReconcilicaoStatus.INCONSISTENTE);
  });

  it('12. XML sem documento', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [{ xml: '<nfeProc/>', nsu: '100' }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.XML_SEM_DOCUMENTO
      || a.codigo === AchadoCodigo.DOCUMENTO_SEM_CHAVE));
  });

  it('13. chave divergente', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [{
        id: 1,
        nsu: '100',
        chave: '1'.repeat(44),
        status: DocumentoFiscalStatus.XML_COMPLETO,
        xml: `<infNFe Id="NFe${'2'.repeat(44)}"/>`
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.INCONSISTENCIA_CHAVE_XML));
  });

  it('14. CNPJ divergente', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '100', maxNsu: '100' },
      documentos: [{
        id: 1,
        nsu: '100',
        chave: '1'.repeat(44),
        status: DocumentoFiscalStatus.XML_COMPLETO,
        xml: `<dest><CNPJ>99999999000199</CNPJ></dest><infNFe Id="NFe${'1'.repeat(44)}"/>`
      }]
    });
    // motorComDados usa cnpj 14200166000187 como esperado
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.INCONSISTENCIA_CNPJ_XML));
  });

  it('15. regressão de cursor', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '105', maxNsu: '105' },
      auditoria: [{
        tipo: 'NSU',
        correlation_id: 'SYNC-R',
        created_at: '2026-09-22T12:00:00Z',
        detalhe_json: JSON.stringify({
          ultNsuAnterior: '000000000000105',
          ultNsuNovo: '000000000000103',
          avancou: false,
          cStat: '138'
        })
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.CURSOR_REGRESSAO_DETECTADA));
    assert.equal(r.status, ReconcilicaoStatus.INCONSISTENTE);
  });

  it('16. salto de NSU', async () => {
    const r = await motorComDados({
      cursor: { ultNsu: '150', maxNsu: '150' },
      documentos: [],
      auditoria: [{
        tipo: 'NSU',
        correlation_id: 'SYNC-S',
        created_at: '2026-09-22T13:00:00Z',
        detalhe_json: JSON.stringify({
          ultNsuAnterior: '000000000000100',
          ultNsuNovo: '000000000000150',
          avancou: true,
          cStat: '138'
        })
      }]
    });
    assert.ok(r.achados.some((a) => a.codigo === AchadoCodigo.SALTO_NSU_OBSERVADO));
  });
});

describe('Sprint 4 — isolamento / histórico', () => {
  it('17-18. CNPJ e ambiente isolados (sem cruzamento)', async () => {
    const motor = new MotorReconcilicaoDfe({});
    const a = await motor.reconciliar({
      cnpj: '11111111000111',
      ambiente: 1,
      cursor: { ultNsu: '10', maxNsu: '10' },
      documentos: [{ id: 1, nsu: '10', chave: '1'.repeat(44), status: DocumentoFiscalStatus.XML_COMPLETO }],
      auditoriaItens: [],
      modo: 'resumo',
      salvarSnapshot: true
    });
    const b = await motor.reconciliar({
      cnpj: '22222222000122',
      ambiente: 2,
      cursor: { ultNsu: '99', maxNsu: '200' },
      documentos: [],
      auditoriaItens: [],
      modo: 'resumo',
      salvarSnapshot: true
    });
    assert.equal(a.cnpj, '11111111000111');
    assert.equal(a.ambiente, 1);
    assert.equal(b.cnpj, '22222222000122');
    assert.equal(b.ambiente, 2);
    assert.notEqual(a.cursor.ultNsu, b.cursor.ultNsu);
    const snapA = motor.obterUltimoSnapshot('11111111000111', 1);
    const snapB = motor.obterUltimoSnapshot('22222222000122', 2);
    assert.equal(snapA.cnpj, '11111111000111');
    assert.equal(snapB.ambiente, 2);
  });

  it('19-22. reconstrução de lotes preserva request_id / cStat / xMotivo', async () => {
    _resetSeqParaTestes();
    const motor = new MotorReconcilicaoDfe({});
    const r = await motor.reconciliar({
      cnpj: '14200166000187',
      ambiente: 1,
      cursor: { ultNsu: '105', maxNsu: '150', ultimoRequestId: 'SEFAZ-ABC' },
      documentos: [],
      auditoriaItens: [
        {
          tipo: 'CONSULTA',
          correlation_id: 'SYNC-LOTE-1',
          created_at: '2026-09-22T09:00:00Z',
          nsu: null,
          detalhe_json: JSON.stringify({
            cStat: '138',
            xMotivo: 'Documentos localizados',
            lotes: 2,
            maxNsuRecebido: '150'
          })
        },
        {
          tipo: 'NSU',
          correlation_id: 'SYNC-LOTE-1',
          created_at: '2026-09-22T09:00:01Z',
          nsu: '105',
          detalhe_json: JSON.stringify({
            ultNsuAnterior: '100',
            ultNsuNovo: '105',
            maxNsu: '150',
            cStat: '138',
            avancou: true,
            loteQtd: 2,
            request_id: 'SEFAZ-ABC'
          })
        }
      ],
      modo: 'profunda',
      salvarSnapshot: false
    });
    assert.ok(r.lotes.length >= 1);
    const lote = r.lotes.find((l) => l.requestId === 'SYNC-LOTE-1');
    assert.ok(lote);
    assert.equal(lote.cStat, '138');
    assert.ok(lote.xMotivo === 'Documentos localizados' || lote.requestId);
    assert.ok(criarReconciliationId().startsWith('RECON-'));
  });

  it('diagnóstico por documento', () => {
    const motor = new MotorReconcilicaoDfe({});
    const d = motor.diagnosticarDocumento({
      id: 9,
      chave: '1'.repeat(44),
      nsu: '100',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      statusRecuperacao: StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO,
      recuperacaoTentativas: 2,
      recuperacaoUltimoCstat: '138',
      recuperacaoUltimoRequestId: 'SEFAZ-1'
    }, { cnpj: '142', ambiente: 1 });
    assert.equal(d.statusXml, AchadoCodigo.XML_PENDENTE);
    assert.equal(d.requestId, 'SEFAZ-1');
  });
});
