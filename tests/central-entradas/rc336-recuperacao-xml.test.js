/**
 * RC3.3.6 — Recuperação XML: Scheduler não remanifesta; DistDFe direto.
 */

const assert = require('assert');
const CentralManifestacaoDfeService = require(
  '../../backend/motores/central-entradas/services/CentralManifestacaoDfeService'
);
const { POLITICAS_MANIFESTACAO } = CentralManifestacaoDfeService;
const { DocumentoFiscalStatus } = require(
  '../../backend/motores/central-entradas/core/DocumentoFiscalStatus'
);
const { DocumentoDfeTipo } = require(
  '../../backend/motores/central-entradas/core/DocumentoDfeTipo'
);
const { TIPOS_EVENTO } = require(
  '../../backend/motores/central-entradas/config/centralEventosTipos'
);
const fs = require('fs');
const path = require('path');

const CHAVE = '35260112345678000199550010000000641000000064';

function criarCenario(opcoes = {}) {
  const agora = new Date('2026-07-27T21:00:00.000Z');
  const documento = {
    id: 77,
    chave: CHAVE,
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    xml: '<resNFe/>',
    nsu: '265'
  };
  const eventos = [...(opcoes.eventosIniciais || [])];
  const historico = [];
  let consultasDist = 0;
  let consultasChave = 0;
  let manifestacoes = 0;

  const documentosRepository = {
    buscarPorId: async () => ({ ...documento }),
    listarPorStatus: async (status) => (
      documento.status === status ? [{ ...documento }] : []
    ),
    atualizar: async (_id, dados) => {
      if (dados.status) documento.status = dados.status;
      if (dados.tipoDocumento) documento.tipoDocumento = dados.tipoDocumento;
      if (dados.xml) documento.xml = dados.xml;
      return { ...documento };
    }
  };

  const eventosRepository = {
    listar: async (filtros) => eventos
      .filter((e) => e.tipo === filtros.tipo && e.documentoId === filtros.documentoId)
      .sort((a, b) => b.id - a.id)
      .slice(0, filtros.limite || 50),
    inserir: async (dados) => {
      const evento = {
        id: eventos.length + 1,
        createdAt: agora.toISOString(),
        ...dados,
        documentoId: dados.documentoId ?? dados.documento_id
      };
      eventos.push(evento);
      return evento;
    },
    inserirUnico: async (dados) => {
      const evento = await eventosRepository.inserir(dados);
      return { evento, criado: true, conflito: false };
    },
    removerPorTipoDocumento: async () => true,
    contar: async () => 0
  };

  const service = new CentralManifestacaoDfeService({
    documentosRepository,
    historicoRepository: {
      inserir: async (dados) => {
        historico.push(dados);
        return { id: historico.length, ...dados };
      },
      listarPorDocumento: async () => [...historico]
    },
    eventosRepository,
    nsuRepository: { buscarPorCnpjAmbiente: async () => null },
    nsuService: {
      buscarPorCnpjAmbiente: async () => ({
        ultNsu: '265',
        maxNsu: '270',
        dataSincronizacao: '2026-07-27T12:00:00.000Z'
      }),
      avaliarCooldown: () => ({ ativo: false })
    },
    configuracaoService: {
      obterPoliticaManifestacao: async () => POLITICAS_MANIFESTACAO.MANUAL,
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: {
          ambiente: 1,
          cnpj: '47627408000151',
          certificadoPath: 'fake.pfx',
          certificadoSenha: 'x'
        }
      })
    },
    prepararEnvelopeAssinado: () => '<envEvento/>',
    enviarManifestacao: async () => {
      manifestacoes += 1;
      return {
        success: true,
        body: `<retEvento><infEvento><cStat>596</cStat><xMotivo>prazo</xMotivo></infEvento></retEvento>`,
        source: 'PLATFORM',
        fallbackUtilizado: false,
        tempoTotalMs: 5,
        statusCode: 200
      };
    },
    sincronizarDfe: async () => {
      consultasDist += 1;
      if (opcoes.distComProc) {
        documento.status = DocumentoFiscalStatus.SINCRONIZADA;
        documento.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        documento.xml = '<nfeProc><NFe><infNFe/></NFe></nfeProc>';
        return { sucesso: true, cStat: '138', ultNsu: '266', maxNsu: '270' };
      }
      return { sucesso: true, cStat: opcoes.distCStat || '137', ultNsu: '265', maxNsu: '270' };
    },
    consultarNotaPorChave: async () => {
      consultasChave += 1;
      if (opcoes.chaveComProc) {
        documento.status = DocumentoFiscalStatus.SINCRONIZADA;
        documento.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        documento.xml = '<nfeProc><NFe><infNFe Id="NFe' + CHAVE + '"/></NFe></nfeProc>';
        return { sucesso: true, cStat: '138', notasNovas: 0, notasDuplicadas: 0 };
      }
      if (opcoes.chaveErro) {
        throw new Error(opcoes.chaveErro);
      }
      return { sucesso: true, cStat: '137', notasNovas: 0, notasDuplicadas: 0 };
    },
    cancelarXmlWait: () => true,
    agora: () => agora,
    emitirEvento: async (dados) => eventosRepository.inserir(dados)
  });

  return {
    service,
    documento,
    eventos,
    historico,
    getConsultasDist: () => consultasDist,
    getConsultasChave: () => consultasChave,
    getManifestacoes: () => manifestacoes
  };
}

async function run() {
  console.log('\n=== RC3.3.6 — Recuperação XML sem remanifestação ===\n');

  // Fonte: MIRX Worker (RC3.4.1) — recuperação sem forcarConsulta permanente
  const srcMirx = fs.readFileSync(
    path.join(__dirname, '../../backend/motores/central-entradas/mirx/MirxWorker.js'),
    'utf8'
  );
  assert.ok(srcMirx.includes('modoRecuperacaoXml: true'));
  assert.ok(srcMirx.includes('forcarConsulta: false'));
  console.log('✓ MIRX Worker envia modoRecuperacaoXml:true com forcarConsulta:false');

  const srcManif = fs.readFileSync(
    path.join(__dirname, '../../backend/motores/central-entradas/services/CentralManifestacaoDfeService.js'),
    'utf8'
  );
  assert.ok(
    srcManif.includes('forcarConsulta: opcoes.forcarConsulta === true'),
    'modoRecuperacaoXml não deve forçar forcarConsulta:true'
  );
  console.log('✓ Manifestação recuperação herda forcarConsulta do caller (não força true)');

  const srcWait = fs.readFileSync(
    path.join(__dirname, '../../backend/motores/central-entradas/services/CentralXmlWaitScheduler.js'),
    'utf8'
  );
  assert.ok(srcWait.includes('MIRX') || srcWait.includes('mirx'));
  console.log('✓ XmlWaitScheduler é fachada MIRX (RC3.4.1)');

  // 1) MANIFESTACAO_ACEITA + recuperação → DistDFe, zero Ciência
  {
    const c = criarCenario({
      eventosIniciais: [{
        id: 1,
        tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        documentoId: 77,
        resultado: '135',
        sucesso: true,
        createdAt: '2026-07-27T14:00:00.000Z',
        detalhe: { cStat: '135' }
      }]
    });
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true,
      forcarConsulta: true
    });
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.ok(c.getConsultasDist() >= 1);
    assert.notStrictEqual(c.documento.status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    assert.ok(r.cStat === '137' || r.xmlCompleto === true || r.aguardandoDisponibilizacao !== false);
    console.log('✓ com MANIFESTACAO_ACEITA: DistDFe direto, sem remanifestação');
  }

  // 2) Histórico 596 (reenvio) + recuperação → DistDFe, NÃO XML_INDISPONIVEL
  {
    const c = criarCenario({
      eventosIniciais: [{
        id: 2,
        tipo: TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
        documentoId: 77,
        resultado: '596',
        sucesso: false,
        createdAt: '2026-07-27T14:00:00.000Z',
        detalhe: {
          cStat: '596',
          xMotivo: 'Evento apresentado após o prazo permitido.'
        }
      }]
    });
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true,
      forcarConsulta: true
    });
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.ok(c.getConsultasDist() >= 1);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.notStrictEqual(r.status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    assert.notStrictEqual(r.encerrado, true);
    console.log('✓ com 596 prévio: recuperação NÃO encerra; chama DistDFe');
  }

  // 3) Sem eventos + recuperação → DistDFe, sem Ciência
  {
    const c = criarCenario();
    await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.ok(c.getConsultasDist() >= 1);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    console.log('✓ sem eventos: recuperação só DistDFe');
  }

  // 4) PROC via DistDFe → SINCRONIZADA (sem precisar consChNFe)
  {
    const c = criarCenario({ distComProc: true });
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.ok(c.getConsultasDist() >= 1);
    assert.strictEqual(c.getConsultasChave(), 0);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.strictEqual(r.xmlCompleto, true);
    console.log('✓ DistDFe com PROC: promove SINCRONIZADA (sem consChNFe)');
  }

  // 4b) DistDFe sem PROC → consChNFe com PROC → SINCRONIZADA
  {
    const c = criarCenario({ chaveComProc: true });
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.ok(c.getConsultasDist() >= 1);
    assert.ok(c.getConsultasChave() >= 1);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.strictEqual(r.xmlCompleto, true);
    assert.strictEqual(r.consultaPorChave, true);
    console.log('✓ DistDFe sem PROC → consChNFe → SINCRONIZADA');
  }

  // 4c) DistDFe sem PROC → consChNFe sem PROC → continua AGUARDANDO
  {
    const c = criarCenario();
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.ok(c.getConsultasDist() >= 1);
    assert.ok(c.getConsultasChave() >= 1);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.strictEqual(r.xmlCompleto, false);
    assert.strictEqual(r.aguardandoDisponibilizacao, true);
    console.log('✓ DistDFe + consChNFe sem PROC: continua AGUARDANDO');
  }

  // 4d) DistDFe 656 → não chama consChNFe
  {
    const c = criarCenario({ distCStat: '656' });
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.ok(c.getConsultasDist() >= 1);
    assert.strictEqual(c.getConsultasChave(), 0);
    assert.strictEqual(String(r.cStat), '656');
    console.log('✓ DistDFe 656: não dispara consChNFe');
  }

  // 5) Fluxo inicial (sem recuperação) + 596 → ainda encerra (RC7.4.7)
  {
    const c = criarCenario();
    const r = await c.service.processarDocumento(77, { confirmado: true });
    assert.ok(c.getManifestacoes() >= 1);
    assert.strictEqual(c.getConsultasDist(), 0);
    assert.strictEqual(r.encerrado, true);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    console.log('✓ fluxo inicial com 596: ainda encerra XML_INDISPONIVEL');
  }

  // 6) Já sincronizado → ignora
  {
    const c = criarCenario();
    c.documento.status = DocumentoFiscalStatus.SINCRONIZADA;
    c.documento.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.strictEqual(r.ignorado, true);
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.strictEqual(c.getConsultasDist(), 0);
    console.log('✓ documento já sincronizado: ciclo não reinicia');
  }

  // 7) XML_INDISPONIVEL legítimo → permanece
  {
    const c = criarCenario();
    c.documento.status = DocumentoFiscalStatus.XML_INDISPONIVEL;
    const r = await c.service.processarDocumento(77, {
      confirmado: true,
      modoRecuperacaoXml: true
    });
    assert.strictEqual(r.encerrado, true);
    assert.strictEqual(c.getConsultasDist(), 0);
    assert.strictEqual(c.getManifestacoes(), 0);
    console.log('✓ XML_INDISPONIVEL legítimo: não reinicia DistDFe');
  }

  console.log('\nRC3.3.6 homologada com sucesso.\n');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
