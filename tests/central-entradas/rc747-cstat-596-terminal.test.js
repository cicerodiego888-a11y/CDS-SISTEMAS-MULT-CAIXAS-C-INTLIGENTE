/**
 * RC7.4.7 — cStat 596 → estado terminal XML_INDISPONIVEL (sem XML_WAIT / retry).
 */

const assert = require('assert');
const CentralManifestacaoDfeService = require(
  '../../backend/motores/central-entradas/services/CentralManifestacaoDfeService'
);
const {
  POLITICAS_MANIFESTACAO,
  MENSAGEM_XML_INDISPONIVEL,
  CSTAT_XML_INDISPONIVEL
} = CentralManifestacaoDfeService;
const { DocumentoFiscalStatus, isTerminal } = require(
  '../../backend/motores/central-entradas/core/DocumentoFiscalStatus'
);
const { DocumentoDfeTipo } = require(
  '../../backend/motores/central-entradas/core/DocumentoDfeTipo'
);
const { TIPOS_EVENTO } = require(
  '../../backend/motores/central-entradas/config/centralEventosTipos'
);
const {
  podeTransicionar,
  validarTransicao
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');

const CHAVE = '35260112345678000199550010000000641000000064';

function retornoManifestacao(cStat, xMotivo) {
  return `<soap:Envelope><soap:Body><retEnvEvento versao="1.00">
    <cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>
    <retEvento><infEvento>
      <tpAmb>2</tpAmb><cOrgao>91</cOrgao>
      <cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>
      <chNFe>${CHAVE}</chNFe><tpEvento>210210</tpEvento>
      <nProt>135260000000001</nProt><dhRegEvento>2026-07-15T20:00:00-03:00</dhRegEvento>
    </infEvento></retEvento>
  </retEnvEvento></soap:Body></soap:Envelope>`;
}

function criarCenario(cStatCiencia = '135', xMotivo = 'Evento registrado') {
  const agora = new Date('2026-07-27T20:00:00.000Z');
  const documento = {
    id: 42,
    chave: CHAVE,
    status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
    tipoDocumento: DocumentoDfeTipo.RES_NFE,
    xml: '<resNFe/>',
    nsu: '1'
  };
  const eventos = [];
  const historico = [];
  const xmlWaitCancelados = [];
  let consultasDist = 0;
  let manifestacoes = 0;

  const documentosRepository = {
    buscarPorId: async () => ({ ...documento }),
    listarPorStatus: async (status) => (
      documento.status === status ? [{ ...documento }] : []
    ),
    atualizar: async (id, dados) => {
      assert.strictEqual(Number(id), documento.id);
      if (dados.status) documento.status = dados.status;
      if (dados.statusDetalhe != null) documento.statusDetalhe = dados.statusDetalhe;
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
      buscarPorCnpjAmbiente: async () => ({ ultNsu: '1', maxNsu: '1' }),
      avaliarCooldown: () => ({ ativo: false })
    },
    configuracaoService: {
      obterPoliticaManifestacao: async () => POLITICAS_MANIFESTACAO.MANUAL,
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: {
          ambiente: 2,
          cnpj: '12345678000199',
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
        body: retornoManifestacao(cStatCiencia, xMotivo),
        source: 'PLATFORM',
        fallbackUtilizado: false,
        tempoTotalMs: 10,
        tempoSoapMs: 8,
        endpoint: 'https://example',
        statusCode: 200
      };
    },
    sincronizarDfe: async () => {
      consultasDist += 1;
      return { sucesso: true, cStat: '137' };
    },
    cancelarXmlWait: (id, motivo) => {
      xmlWaitCancelados.push({ id: Number(id), motivo });
      return true;
    },
    agora: () => agora,
    emitirEvento: async (dados) => eventosRepository.inserir(dados)
  });

  return {
    service,
    documento,
    eventos,
    historico,
    xmlWaitCancelados,
    getConsultasDist: () => consultasDist,
    getManifestacoes: () => manifestacoes
  };
}

async function run() {
  console.log('\n=== RC7.4.7 — cStat 596 / XML_INDISPONIVEL ===\n');

  // Máquina
  assert.ok(CSTAT_XML_INDISPONIVEL.has('596'));
  assert.ok(isTerminal(DocumentoFiscalStatus.XML_INDISPONIVEL));
  assert.strictEqual(
    podeTransicionar(
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      DocumentoFiscalStatus.XML_INDISPONIVEL
    ),
    true
  );
  // RC3.4.8 — isTerminal permanece; única saída oficial é → AGUARDANDO_XML_COMPLETO (lote).
  assert.strictEqual(
    validarTransicao(
      DocumentoFiscalStatus.XML_INDISPONIVEL,
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
    ).valido,
    true
  );
  assert.strictEqual(
    validarTransicao(
      DocumentoFiscalStatus.XML_INDISPONIVEL,
      DocumentoFiscalStatus.SINCRONIZADA
    ).valido,
    false
  );
  console.log('✓ máquina: XML_INDISPONIVEL terminal + reabertura RC3.4.8 → AGUARDANDO');

  // Caso 1 — cStat 135 inalterado (aceita → aguardando, sem DistDFe imediata)
  {
    const c = criarCenario('135', 'Evento registrado e vinculado a NF-e');
    const r = await c.service.processarDocumento(42, { confirmado: true });
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.strictEqual(c.getConsultasDist(), 0);
    assert.ok(c.xmlWaitCancelados.length === 0);
    console.log('✓ cStat 135: fluxo permanece AGUARDANDO_XML_COMPLETO (sem DistDFe imediata)');
  }

  // Caso 2 — cStat 573 (duplicata aceita)
  {
    const c = criarCenario('573', 'Duplicidade de Evento');
    const r = await c.service.processarDocumento(42, { confirmado: true });
    assert.strictEqual(r.sucesso, true);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.strictEqual(c.getConsultasDist(), 0);
    console.log('✓ cStat 573: fluxo permanece inalterado');
  }

  // Caso 3 — cStat 596 → terminal, sem XML_WAIT / DistDFe
  {
    const c = criarCenario('596', 'Evento apresentado após o prazo permitido.');
    const r = await c.service.processarDocumento(42, { confirmado: true });
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.cStat, '596');
    assert.strictEqual(r.encerrado, true);
    assert.strictEqual(r.aguardandoDisponibilizacao, false);
    assert.strictEqual(r.status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    assert.strictEqual(c.getConsultasDist(), 0);
    assert.ok(c.xmlWaitCancelados.some((x) => x.motivo === 'xml_indisponivel'));
    assert.ok(
      c.eventos.some(
        (e) => e.tipo === TIPOS_EVENTO.MANIFESTACAO_REJEITADA && String(e.resultado) === '596'
      )
    );
    assert.ok(
      c.historico.some(
        (h) => h.statusNovo === DocumentoFiscalStatus.XML_INDISPONIVEL
      )
    );
    assert.match(r.mensagem, /prazo|indispon/i);
    console.log('✓ cStat 596: XML_INDISPONIVEL + auditoria + cancela XML_WAIT + sem DistDFe');
  }

  // Caso 4 — já terminal: nova solicitação não reinicia
  {
    const c = criarCenario('135');
    c.documento.status = DocumentoFiscalStatus.XML_INDISPONIVEL;
    const r = await c.service.processarDocumento(42, { confirmado: true });
    assert.strictEqual(r.encerrado, true);
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.strictEqual(c.getConsultasDist(), 0);
    assert.match(r.mensagem, /indisponível|prazo/i);
    console.log('✓ documento já terminal: não reinicia ciclo / sem nova Ciência');
  }

  // Caso 5 — rejeição 596 pré-existente (legado) encerra sem cooldown
  {
    const c = criarCenario('135');
    c.eventos.push({
      id: 99,
      tipo: TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
      documentoId: 42,
      resultado: '596',
      descricao: 'Manifestação rejeitada (prazo)',
      detalhe: { cStat: '596', xMotivo: 'Evento apresentado após o prazo permitido.' },
      createdAt: '2026-07-27T19:00:00.000Z'
    });
    const r = await c.service.processarDocumento(42, { confirmado: true });
    assert.strictEqual(r.encerrado, true);
    assert.strictEqual(c.documento.status, DocumentoFiscalStatus.XML_INDISPONIVEL);
    assert.strictEqual(c.getManifestacoes(), 0);
    assert.ok(c.xmlWaitCancelados.length >= 1);
    console.log('✓ legado com 596 já registrado: encerra sem nova tentativa');
  }

  // recuperarPendentes não lista XML_INDISPONIVEL
  {
    const c = criarCenario('596', 'prazo');
    await c.service.processarDocumento(42, { confirmado: true });
    const lista = await c.service._documentosRepository.listarPorStatus(
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
    );
    assert.strictEqual(lista.length, 0);
    console.log('✓ XML_INDISPONIVEL fora da lista AGUARDANDO (sem nova inscrição XML_WAIT)');
  }

  console.log(`\nMensagem canônica: ${MENSAGEM_XML_INDISPONIVEL}`);
  console.log('RC7.4.7 homologada com sucesso.\n');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
