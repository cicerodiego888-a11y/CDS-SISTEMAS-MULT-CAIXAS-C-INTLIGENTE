/**
 * Unit tests RC3.4 — Homologação assistida (observabilidade).
 * Sem SEFAZ real; agregação somente leitura.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const CentralHomologacaoService = require('../../backend/motores/central-entradas/services/CentralHomologacaoService');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

test('RC3.4 health: AGUARDANDO_XML_COMPLETO → amarelo', () => {
  const h = CentralHomologacaoService.healthDoDocumento(
    { status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO },
    [],
    { ativo: false }
  );
  assert.equal(h.codigo, 'AGUARDANDO_PROC');
  assert.equal(h.tom, 'caution');
});

test('RC3.4 health: cooldown ativo → laranja', () => {
  const h = CentralHomologacaoService.healthDoDocumento(
    { status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO },
    [],
    { ativo: true }
  );
  assert.equal(h.codigo, 'COOLDOWN');
  assert.equal(h.tom, 'warning');
});

test('RC3.4 health: SINCRONIZADA → verde', () => {
  const h = CentralHomologacaoService.healthDoDocumento(
    { status: DocumentoFiscalStatus.SINCRONIZADA },
    [],
    { ativo: false }
  );
  assert.equal(h.codigo, 'SAUDAVEL');
});

test('RC3.4 health: ERRO → vermelho', () => {
  const h = CentralHomologacaoService.healthDoDocumento(
    { status: DocumentoFiscalStatus.ERRO },
    [],
    { ativo: false }
  );
  assert.equal(h.codigo, 'ERRO');
});

test('RC3.4 checklist e métricas com repositórios mock', async () => {
  const agora = Date.now();
  const docs = [{
    id: 1,
    chave: '3520'.padEnd(44, '0'),
    nsu: '1',
    fornecedor: 'Fornecedor Homolog',
    tipoDocumento: 'RES_NFE',
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    valorTotal: 10,
    createdAt: new Date(agora - 60000).toISOString(),
    updatedAt: new Date(agora).toISOString()
  }];

  const eventos = [
    {
      id: 1,
      tipo: TIPOS_EVENTO.DOCUMENTO_RECEBIDO,
      origem: 'sistema',
      descricao: 'RES',
      documentoId: 1,
      createdAt: new Date(agora - 50000).toISOString(),
      detalhe: { correlationId: 'corr-1' }
    },
    {
      id: 2,
      tipo: TIPOS_EVENTO.CIENCIA_ENVIADA,
      origem: 'sistema',
      documentoId: 1,
      duracaoMs: 1200,
      createdAt: new Date(agora - 40000).toISOString(),
      detalhe: { cStat: '135', correlationId: 'corr-1' }
    },
    {
      id: 3,
      tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
      origem: 'sistema',
      documentoId: 1,
      duracaoMs: 1500,
      createdAt: new Date(agora - 39000).toISOString(),
      detalhe: { cStat: '135', correlationId: 'corr-1' }
    }
  ];

  const svc = new CentralHomologacaoService({
    documentosRepository: {
      listar: async () => docs,
      buscarPorId: async (id) => (Number(id) === 1
        ? { ...docs[0], xml: '<resNFe/>', parseJson: null }
        : null)
    },
    eventosRepository: {
      listar: async (f = {}) => {
        if (f.documentoId) return eventos.filter((e) => e.documentoId === Number(f.documentoId));
        return eventos;
      },
      obterUltimoPorTipo: async (tipo) => eventos.find((e) => e.tipo === tipo) || null
    },
    historicoRepository: {
      listarPorDocumento: async () => []
    },
    nsuRepository: {
      obterUltimaSincronizacao: async () => ({
        ultNsu: '10',
        maxNsu: '12',
        dataSincronizacao: new Date(agora).toISOString(),
        ultimoCstat: '138',
        cooldownAte: null
      })
    },
    nsuService: {
      avaliarCooldown: () => ({ ativo: false })
    }
  });

  const painel = await svc.obterPainel({ limite: 10 });
  assert.ok(painel.monitor.length === 1);
  assert.equal(painel.monitor[0].health.codigo, 'AGUARDANDO_PROC');
  assert.ok(painel.diagnosticoSefaz);
  assert.equal(painel.nsu.ultNsu, '10');
  assert.ok(painel.checklistHomologacao.length >= 7);

  const insp = await svc.inspecionarDocumento(1);
  assert.equal(insp.documento.schema, 'resNFe');
  assert.equal(insp.documento.xmlArmazenado, true);
  assert.ok(insp.timeline.some((t) => t.codigo === 'CIENCIA' && t.concluida));
  assert.ok(insp.checklist.find((c) => c.codigo === 'CIENCIA').ok);
  assert.ok(insp.telemetria.correlationId === 'corr-1' || insp.telemetria.cStat != null);

  const exportJson = await svc.exportarRelatorio(1, 'json');
  assert.equal(exportJson.formato, 'json');
  assert.match(exportJson.corpo, /corr-1/);

  const exportTxt = await svc.exportarRelatorio(1, 'txt');
  assert.equal(exportTxt.formato, 'txt');
  assert.match(exportTxt.corpo, /Checklist/);
});
