/**
 * RC6.5 — Migração de documentos legados (RES_NFE pré-RC6.2)
 *
 * Executar: npm run test:central-entradas-rc6.5
 */

const assert = require('assert');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const CentralMigracaoLegadoService = require('../../backend/motores/central-entradas/services/CentralMigracaoLegadoService');
const { TIPOS_EVENTO, ORIGENS } = require('../../backend/motores/central-entradas/config/centralEventosTipos');

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

const XML_RES = `<?xml version="1.0"?>
<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <chNFe>${CHAVE}</chNFe>
  <CNPJ>12345678000199</CNPJ>
  <xNome>Legado RC65</xNome>
  <vNF>10.00</vNF>
</resNFe>`;

const XML_PROC = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe${CHAVE}"><ide><nNF>1</nNF></ide></infNFe></NFe>
</nfeProc>`;

function criarHarness() {
  const docs = new Map();
  let seq = 1;
  const historico = [];
  const eventos = [];
  let parserChamado = 0;
  let miipChamado = 0;
  let compraChamada = 0;

  const documentosRepository = {
    _obterSql() {
      return {
        whenReady: async () => {},
        all: async () => [...docs.values()].map((d) => ({
          id: d.id,
          chave: d.chave,
          xml: d.xml,
          status: d.status,
          status_detalhe: d.statusDetalhe,
          tipo_documento: d.tipoDocumento,
          nsu: d.nsu,
          origem: d.origem,
          created_at: d.createdAt,
          updated_at: d.updatedAt,
          numero: d.numero,
          serie: d.serie,
          modelo: d.modelo,
          fornecedor: d.fornecedor,
          cnpj_fornecedor: d.cnpjFornecedor,
          data_emissao: d.dataEmissao,
          data_entrada: d.dataEntrada,
          valor_total: d.valorTotal,
          parse_json: d.parseJson ? JSON.stringify(d.parseJson) : null,
          miip_sessao_id: d.miipSessaoId,
          miip_resumo_json: d.miipResumoJson ? JSON.stringify(d.miipResumoJson) : null,
          compra_id: d.compraId,
          usuario_id: d.usuarioId,
          processado_em: d.processadoEm
        })),
        get: async () => null,
        run: async () => ({ lastID: 0 })
      };
    },
    _mapearRow(row) {
      return {
        id: row.id,
        chave: row.chave,
        xml: row.xml,
        status: row.status,
        statusDetalhe: row.status_detalhe,
        tipoDocumento: row.tipo_documento,
        nsu: row.nsu,
        origem: row.origem,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        numero: row.numero,
        serie: row.serie,
        modelo: row.modelo,
        fornecedor: row.fornecedor,
        cnpjFornecedor: row.cnpj_fornecedor,
        dataEmissao: row.data_emissao,
        dataEntrada: row.data_entrada,
        valorTotal: row.valor_total,
        parseJson: null,
        miipSessaoId: null,
        miipResumoJson: null,
        compraId: row.compra_id,
        usuarioId: row.usuario_id,
        processadoEm: row.processado_em
      };
    },
    buscarPorId: async (id) => {
      const d = docs.get(Number(id));
      return d ? { ...d } : null;
    },
    inserir: async (dados) => {
      const doc = {
        id: seq++,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
        parseJson: null,
        miipSessaoId: null,
        miipResumoJson: null,
        processadoEm: null,
        compraId: null,
        tipoDocumento: null,
        ...dados
      };
      docs.set(doc.id, doc);
      return { ...doc };
    },
    atualizar: async (id, patch) => {
      const doc = docs.get(Number(id));
      if (!doc) return null;
      Object.assign(doc, patch, { updatedAt: '2026-07-11T12:00:00.000Z' });
      return { ...doc };
    },
    _docs: docs
  };

  // Override listar via SQL mock: all() already returns docs; service filters
  const historicoRepository = {
    inserir: async (row) => {
      const item = { id: historico.length + 1, ...row };
      historico.push(item);
      return item;
    },
    listarPorDocumento: async (documentoId) => historico.filter((h) => h.documentoId === Number(documentoId)),
    _rows: historico
  };

  const service = new CentralMigracaoLegadoService({
    documentosRepository,
    historicoRepository
  });

  // Interceptar emissão de eventos
  const emitter = require('../../backend/motores/central-entradas/utils/centralEventosEmitter');
  const original = emitter.emitirDocumentoMigrado;
  emitter.emitirDocumentoMigrado = async (documento, opcoes) => {
    eventos.push({
      tipo: TIPOS_EVENTO.DOCUMENTO_MIGRADO,
      origem: opcoes?.origem || ORIGENS.MIGRACAO_RC65,
      documentoId: documento.id
    });
  };

  return {
    service,
    documentosRepository,
    historicoRepository,
    eventos,
    contadores: { parserChamado, miipChamado, compraChamada },
    async seedLegado(overrides = {}) {
      return documentosRepository.inserir({
        chave: CHAVE,
        xml: XML_RES,
        status: DocumentoFiscalStatus.SINCRONIZADA,
        statusDetalhe: null,
        tipoDocumento: null,
        nsu: '000000000000099',
        origem: 'dfe',
        numero: '77',
        ...overrides
      });
    },
    restaurarEmitter() {
      emitter.emitirDocumentoMigrado = original;
    }
  };
}

async function main() {
  console.log('\n=== RC6.5 — Migração documentos legados ===\n');

  await test('tipos: DOCUMENTO_MIGRADO e origem MIGRACAO_RC65 existem', () => {
    assert.strictEqual(TIPOS_EVENTO.DOCUMENTO_MIGRADO, 'DOCUMENTO_MIGRADO');
    assert.strictEqual(ORIGENS.MIGRACAO_RC65, 'MIGRACAO_RC65');
  });

  await test('localizar: candidato SINCRONIZADA + tipo null + RES_NFE', async () => {
    const h = criarHarness();
    await h.seedLegado();
    const candidatos = await h.service.listarCandidatos();
    assert.strictEqual(candidatos.length, 1);
    assert.strictEqual(candidatos[0].chave, CHAVE);
    h.restaurarEmitter();
  });

  await test('localizar: candidato ERRO + tipo null + RES_NFE', async () => {
    const h = criarHarness();
    await h.seedLegado({
      status: DocumentoFiscalStatus.ERRO,
      statusDetalhe: 'XML não contém uma NF-e válida.'
    });
    const candidatos = await h.service.listarCandidatos();
    assert.strictEqual(candidatos.length, 1);
    h.restaurarEmitter();
  });

  await test('nunca migrar PROC_NFE / GRAVADA / tipo preenchido', async () => {
    const h = criarHarness();
    await h.seedLegado({ xml: XML_PROC });
    await h.seedLegado({
      chave: CHAVE + '1',
      status: DocumentoFiscalStatus.GRAVADA,
      tipoDocumento: null
    });
    await h.seedLegado({
      chave: CHAVE + '2',
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      status: DocumentoFiscalStatus.SINCRONIZADA
    });
    const candidatos = await h.service.listarCandidatos();
    assert.strictEqual(candidatos.length, 0);
    h.restaurarEmitter();
  });

  await test('migrar: preenche tipo, status, preserva xml/id/nsu/origem/histórico', async () => {
    const h = criarHarness();
    const doc = await h.seedLegado();
    await h.historicoRepository.inserir({
      documentoId: doc.id,
      statusAnterior: null,
      statusNovo: DocumentoFiscalStatus.SINCRONIZADA,
      detalhe: 'Histórico original'
    });

    const antesHist = h.historicoRepository._rows.length;
    const r = await h.service.migrarDocumento(doc);
    assert.strictEqual(r.migrado, true);

    const atual = await h.documentosRepository.buscarPorId(doc.id);
    assert.strictEqual(atual.id, doc.id);
    assert.strictEqual(atual.xml, XML_RES);
    assert.strictEqual(atual.chave, CHAVE);
    assert.strictEqual(atual.nsu, '000000000000099');
    assert.strictEqual(atual.origem, 'dfe');
    assert.strictEqual(atual.tipoDocumento, DocumentoDfeTipo.RES_NFE);
    assert.strictEqual(atual.status, DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO);
    assert.ok(String(atual.statusDetalhe).includes('Resumo da NF-e'));

    const hist = h.historicoRepository._rows;
    assert.ok(hist.length > antesHist);
    assert.ok(hist.some((x) => x.detalhe === 'Histórico original'));
    assert.ok(hist.some((x) => /Migração RC6\.5/.test(x.detalhe)));

    assert.ok(h.eventos.some((e) => e.tipo === 'DOCUMENTO_MIGRADO' && e.origem === 'MIGRACAO_RC65'));
    assert.strictEqual(h.contadores.parserChamado, 0);
    assert.strictEqual(h.contadores.miipChamado, 0);
    assert.strictEqual(h.contadores.compraChamada, 0);
    h.restaurarEmitter();
  });

  await test('executar: lote + idempotência', async () => {
    const h = criarHarness();
    await h.seedLegado();
    await h.seedLegado({
      chave: '35260112345678000199550010000000781000000078',
      status: DocumentoFiscalStatus.ERRO,
      statusDetalhe: 'XML não contém uma NF-e válida.'
    });

    const r1 = await h.service.executar();
    assert.strictEqual(r1.analisados, 2);
    assert.strictEqual(r1.migrados, 2);
    assert.strictEqual(r1.erros, 0);

    const r2 = await h.service.executar();
    assert.strictEqual(r2.analisados, 0);
    assert.strictEqual(r2.migrados, 0);
    assert.strictEqual(r2.erros, 0);
    h.restaurarEmitter();
  });

  await test('ehCandidatoMigracao: helper estático', () => {
    assert.strictEqual(CentralMigracaoLegadoService.ehResumoNfeLegado(XML_RES), true);
    assert.strictEqual(CentralMigracaoLegadoService.ehResumoNfeLegado(XML_PROC), false);
    assert.strictEqual(CentralMigracaoLegadoService.ehCandidatoMigracao({
      tipoDocumento: null,
      status: DocumentoFiscalStatus.SINCRONIZADA,
      xml: XML_RES
    }), true);
    assert.strictEqual(CentralMigracaoLegadoService.ehCandidatoMigracao({
      tipoDocumento: null,
      status: DocumentoFiscalStatus.EM_COMPRA,
      xml: XML_RES
    }), false);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falhou\n`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
