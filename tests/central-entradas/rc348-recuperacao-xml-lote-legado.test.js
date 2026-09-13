/**
 * RC3.4.8 — Recuperação em lote de XMLs legados (fluxo oficial MIRX).
 *
 * Executar: npm run test:central-entradas-rc3.4.8
 */

const assert = require('assert');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const {
  validarTransicao,
  podeTransicionar,
  ehReaberturaXmlLegado
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');
const CentralRecuperacaoXmlLoteLegadoService = require('../../backend/motores/central-entradas/services/CentralRecuperacaoXmlLoteLegadoService');
const DocumentoTransitionService = require('../../backend/motores/central-entradas/services/DocumentoTransitionService');
const { TIPOS_EVENTO } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

const CHAVE = '35260112345678000199550010000000771000000077';
const AGORA = new Date('2026-07-28T12:00:00.000Z');

function criarHarness(opcoes = {}) {
  const docs = new Map();
  const historico = [];
  const eventos = [];
  const mirxChamados = [];

  function seed(doc) {
    docs.set(Number(doc.id), { ...doc });
    return docs.get(Number(doc.id));
  }

  const documentosRepository = {
    async listar(filtros = {}) {
      let lista = [...docs.values()];
      const statusIn = filtros.statusIn || filtros.status_in;
      if (Array.isArray(statusIn) && statusIn.length) {
        lista = lista.filter((d) => statusIn.includes(d.status));
      }
      if (filtros.status) {
        lista = lista.filter((d) => d.status === filtros.status);
      }
      lista.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const limite = filtros.limite || 50;
      return lista.slice(0, limite);
    },
    async buscarPorId(id) {
      return docs.get(Number(id)) || null;
    },
    async atualizar(id, dados) {
      const d = docs.get(Number(id));
      if (!d) return null;
      Object.assign(d, dados);
      if (dados.statusDetalhe != null) d.statusDetalhe = dados.statusDetalhe;
      return d;
    }
  };

  const eventosRepository = {
    async existePorTipoDocumento(tipo, documentoId) {
      return eventos.some(
        (e) => e.tipo === tipo && Number(e.documentoId) === Number(documentoId)
      );
    },
    async listar(filtros = {}) {
      return eventos.filter((e) => {
        if (filtros.tipo && e.tipo !== filtros.tipo) return false;
        if (filtros.documentoId != null && Number(e.documentoId) !== Number(filtros.documentoId)) {
          return false;
        }
        return true;
      }).slice(0, filtros.limite || 50);
    }
  };

  const historicoService = {
    async registrar(ev) {
      historico.push(ev);
    }
  };

  const transitionService = new DocumentoTransitionService({
    documentosRepository,
    historicoService
  });

  const xmlWait = {
    async solicitarXmlManual(documentoId, meta = {}) {
      mirxChamados.push({ documentoId: Number(documentoId), meta });
      const d = docs.get(Number(documentoId));
      if (opcoes.mirxResultado === 'recuperado') {
        d.status = DocumentoFiscalStatus.SINCRONIZADA;
        d.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        return { sucesso: true, codigo: 'XML_RECUPERADO', xmlCompleto: true };
      }
      if (opcoes.mirxResultado === 'parser') {
        d.status = DocumentoFiscalStatus.EM_PROCESSAMENTO;
        d.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        d.parseJson = { ok: true };
        return { sucesso: true, codigo: 'XML_RECUPERADO', xmlCompleto: true };
      }
      if (opcoes.mirxResultado === 'miip') {
        d.status = DocumentoFiscalStatus.AGUARDANDO_REVISAO;
        d.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        d.miipSessaoId = 'sess-1';
        return { sucesso: true, codigo: 'XML_RECUPERADO', xmlCompleto: true };
      }
      if (opcoes.mirxResultado === 'compra') {
        d.status = DocumentoFiscalStatus.PRONTA_PARA_COMPRA;
        d.tipoDocumento = DocumentoDfeTipo.PROC_NFE;
        d.miipSessaoId = 'sess-1';
        return { sucesso: true, codigo: 'XML_RECUPERADO', xmlCompleto: true };
      }
      return {
        sucesso: true,
        codigo: 'AGUARDANDO_NSU',
        mensagem: 'XML ainda não disponível na SEFAZ'
      };
    }
  };

  const service = new CentralRecuperacaoXmlLoteLegadoService({
    documentosRepository,
    eventosRepository,
    transitionService,
    xmlWait,
    agora: () => new Date(AGORA)
  });

  // stub health
  service._atualizarSaude = async () => {};

  return {
    seed,
    docs,
    historico,
    eventos,
    mirxChamados,
    service,
    addCiencia(documentoId) {
      eventos.push({
        tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        documentoId: Number(documentoId)
      });
    }
  };
}

async function run() {
  console.log('\n=== RC3.4.8 — Recuperação em lote XMLs legados ===\n');

  await test('máquina: reabertura XML_INDISPONIVEL → AGUARDANDO (RC3.4.8)', () => {
    assert.strictEqual(
      ehReaberturaXmlLegado(
        DocumentoFiscalStatus.XML_INDISPONIVEL,
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      ),
      true
    );
    assert.strictEqual(
      podeTransicionar(
        DocumentoFiscalStatus.XML_INDISPONIVEL,
        DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      ),
      true
    );
    assert.strictEqual(
      validarTransicao(
        DocumentoFiscalStatus.XML_INDISPONIVEL,
        DocumentoFiscalStatus.SINCRONIZADA
      ).valido,
      false
    );
  });

  await test('ignora documentos recentes (< idadeMinimaHoras)', async () => {
    const h = criarHarness();
    h.seed({
      id: 1,
      chave: CHAVE,
      nsu: '100',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-07-28T10:00:00.000Z' // 2h atrás
    });
    h.addCiencia(1);

    const r = await h.service.executar({ idadeMinimaHoras: 24, dryRun: false });
    assert.strictEqual(r.analisados, 0);
    assert.strictEqual(r.ignoradosRecentes, 1);
    assert.strictEqual(h.mirxChamados.length, 0);
  });

  await test('dryRun lista legado AGUARDANDO sem chamar MIRX', async () => {
    const h = criarHarness();
    h.seed({
      id: 2,
      chave: CHAVE,
      nsu: '200',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-07-20T10:00:00.000Z'
    });
    h.addCiencia(2);

    const r = await h.service.executar({ idadeMinimaHoras: 24, dryRun: true });
    assert.strictEqual(r.analisados, 1);
    assert.strictEqual(r.aindaIndisponivel, 1);
    assert.strictEqual(h.mirxChamados.length, 0);
    assert.match(r.detalhes[0].motivo, /DRY_RUN/);
  });

  await test('sem Ciência: não consulta SEFAZ (precondição)', async () => {
    const h = criarHarness({ mirxResultado: 'recuperado' });
    h.seed({
      id: 3,
      chave: CHAVE,
      nsu: '300',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-07-10T10:00:00.000Z'
    });

    const r = await h.service.executar({ idadeMinimaHoras: 24 });
    assert.strictEqual(r.analisados, 1);
    assert.strictEqual(r.ignoradosPrecondicao, 1);
    assert.strictEqual(h.mirxChamados.length, 0);
    assert.match(r.detalhes[0].motivo, /SEM_MANIFESTACAO/);
  });

  await test('XML_INDISPONIVEL legado: reabre + MIRX oficial', async () => {
    const h = criarHarness({ mirxResultado: 'recuperado' });
    h.seed({
      id: 4,
      chave: CHAVE,
      nsu: '400',
      status: DocumentoFiscalStatus.XML_INDISPONIVEL,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-06-01T10:00:00.000Z'
    });
    h.addCiencia(4);

    const r = await h.service.executar({ idadeMinimaHoras: 24 });
    assert.strictEqual(r.analisados, 1);
    assert.strictEqual(r.reabertosTerminal, 1);
    assert.strictEqual(r.xmlsRecuperados, 1);
    assert.strictEqual(r.aindaIndisponivel, 0);
    assert.strictEqual(h.mirxChamados.length, 1);
    assert.strictEqual(h.docs.get(4).status, DocumentoFiscalStatus.SINCRONIZADA);
    assert.ok(h.historico.some(
      (x) => x.statusAnterior === DocumentoFiscalStatus.XML_INDISPONIVEL
        && x.statusNovo === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
    ));
  });

  await test('XML ainda indisponível: mantém estado e registra motivo', async () => {
    const h = criarHarness({ mirxResultado: 'indisponivel' });
    h.seed({
      id: 5,
      chave: CHAVE,
      nsu: '500',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-05-01T10:00:00.000Z'
    });
    h.addCiencia(5);

    const r = await h.service.executar({ idadeMinimaHoras: 24 });
    assert.strictEqual(r.xmlsRecuperados, 0);
    assert.strictEqual(r.aindaIndisponivel, 1);
    assert.strictEqual(h.docs.get(5).status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.ok(r.detalhes[0].motivo);
  });

  await test('relatório: Parser / MIIP / Compra após recuperação', async () => {
    const h = criarHarness({ mirxResultado: 'compra' });
    h.seed({
      id: 6,
      chave: CHAVE,
      nsu: '600',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-04-01T10:00:00.000Z'
    });
    h.addCiencia(6);

    const r = await h.service.executar({ idadeMinimaHoras: 24 });
    assert.strictEqual(r.xmlsRecuperados, 1);
    assert.strictEqual(r.seguiramParser, 1);
    assert.strictEqual(r.chegaramMiip, 1);
    assert.strictEqual(r.prontosCompra, 1);
  });

  await test('sem chave: precondição, sem MIRX', async () => {
    const h = criarHarness({ mirxResultado: 'recuperado' });
    h.seed({
      id: 7,
      chave: null,
      nsu: '700',
      status: DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-03-01T10:00:00.000Z'
    });
    h.addCiencia(7);

    const r = await h.service.executar({ idadeMinimaHoras: 24 });
    assert.strictEqual(r.ignoradosPrecondicao, 1);
    assert.strictEqual(h.mirxChamados.length, 0);
    assert.match(r.detalhes[0].motivo, /SEM_CHAVE/);
  });

  console.log(`\nResultado: ${passou} passou, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
