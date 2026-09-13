/**
 * RC3.7.5 — Motor de Recuperação Automática de XML
 * Executar: node tests/central-entradas/rc375-recuperacao-xml.test.js
 */

'use strict';

const assert = require('assert');
const {
  DocumentoFiscalStatus
} = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const {
  ehElegivelRecuperacaoXml,
  filtrarCandidatosFila,
  ordenarFila,
  STATUS_MONITORADOS
} = require('../../backend/motores/central-entradas/recuperacao-xml/FilaRecuperacaoXml');
const {
  lerConfigDeMapa,
  CHAVES,
  INTERVALOS_PERMITIDOS,
  DEFAULTS
} = require('../../backend/motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlConfig');
const MotorRecuperacaoXmlService = require('../../backend/motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlService');
const CentralDocumentoAtualizacaoService = require('../../backend/motores/central-entradas/services/CentralDocumentoAtualizacaoService');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');

const S = DocumentoFiscalStatus;
let ok = 0;
let falhas = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      ok += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((err) => {
      falhas += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${err.message}`);
    });
}

function criarRepoMemoria(docsIniciais = []) {
  const docs = new Map(docsIniciais.map((d) => [Number(d.id), { ...d }]));
  const historico = [];
  const eventos = [];
  const config = new Map();

  return {
    docs,
    historico,
    eventos,
    config,
    documentosRepository: {
      async listar({ statusIn }) {
        return [...docs.values()].filter((d) => statusIn.includes(d.status));
      },
      async buscarPorId(id) {
        return docs.get(Number(id)) || null;
      },
      async buscarPorChave(chave) {
        return [...docs.values()].find((d) => d.chave === chave) || null;
      },
      async atualizar(id, patch) {
        const cur = docs.get(Number(id));
        if (!cur) return null;
        const next = { ...cur };
        if (patch.xml != null) next.xml = patch.xml;
        if (patch.numero != null) next.numero = patch.numero;
        if (patch.serie != null) next.serie = patch.serie;
        if (patch.tipoDocumento != null) next.tipoDocumento = patch.tipoDocumento;
        if (patch.status != null) next.status = patch.status;
        if (patch.statusDetalhe != null) next.statusDetalhe = patch.statusDetalhe;
        if (patch.nsu != null) next.nsu = patch.nsu;
        docs.set(Number(id), next);
        return next;
      }
    },
    historicoRepository: {
      async inserir(row) {
        historico.push(row);
        return row;
      }
    },
    eventosRepository: {
      async inserir(row) {
        eventos.push(row);
        return { id: eventos.length, ...row };
      }
    },
    configRepository: {
      parseValor(reg) {
        if (!reg) return null;
        if (reg.tipo === 'json') return typeof reg.valor === 'string' ? JSON.parse(reg.valor) : reg.valor;
        if (reg.tipo === 'boolean') return reg.valor === true || reg.valor === 'true';
        if (reg.tipo === 'number') return Number(reg.valor);
        return reg.valor;
      },
      async listarTodas() {
        return [...config.entries()].map(([chave, v]) => ({ chave, ...v }));
      },
      async buscarPorChave(chave) {
        const v = config.get(chave);
        return v ? { chave, ...v } : null;
      },
      async salvar(chave, valor, tipo = 'string') {
        config.set(chave, { valor, tipo });
        return { chave, valor, tipo };
      },
      async ensureDefaults() {}
    },
    transitionService: {
      async transicionar(id, de, para) {
        const cur = docs.get(Number(id));
        if (!cur) throw new Error('doc');
        cur.status = para;
        docs.set(Number(id), cur);
        historico.push({ documentoId: id, statusAnterior: de, statusNovo: para });
        return cur;
      }
    }
  };
}

const PROC_XML = `<?xml version="1.0"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe23260635065903000640550010002465111132193245">
    <ide><nNF>246511</nNF><serie>1</serie></ide>
    <emit><CNPJ>35065903000640</CNPJ><xNome>NILO MAIA</xNome></emit>
    <total><ICMSTot><vNF>1319.28</vNF></ICMSTot></total>
  </infNFe></NFe>
  <protNFe><infProt><cStat>100</cStat><chNFe>23260635065903000640550010002465111132193245</chNFe></infProt></protNFe>
</nfeProc>`;

async function main() {
  console.log('\n=== RC3.7.5 — Recuperação Automática XML ===\n');

  await test('Fila: XML_INDISPONIVEL e RESUMO_RECEBIDO entram', async () => {
    assert.strictEqual(ehElegivelRecuperacaoXml(S.XML_INDISPONIVEL), true);
    assert.strictEqual(ehElegivelRecuperacaoXml(S.RESUMO_RECEBIDO), true);
    assert.strictEqual(ehElegivelRecuperacaoXml(S.AGUARDANDO_XML_COMPLETO), true);
    assert.ok(STATUS_MONITORADOS.includes(S.XML_INDISPONIVEL));
  });

  await test('Fila: terminais não entram', async () => {
    assert.strictEqual(ehElegivelRecuperacaoXml(S.IMPORTADA), false);
    assert.strictEqual(ehElegivelRecuperacaoXml(S.CANCELADA), false);
    assert.strictEqual(ehElegivelRecuperacaoXml(S.FINALIZADA), false);
    assert.strictEqual(ehElegivelRecuperacaoXml(S.DENEGADA), false);
    assert.strictEqual(ehElegivelRecuperacaoXml(S.INUTILIZADA), false);
  });

  await test('Filtrar e ordenar prioriza XML_INDISPONIVEL', async () => {
    const lista = filtrarCandidatosFila([
      { id: 1, status: S.RESUMO_RECEBIDO, createdAt: '2026-01-01' },
      { id: 2, status: S.IMPORTADA, createdAt: '2026-01-01' },
      { id: 3, status: S.XML_INDISPONIVEL, createdAt: '2026-01-02' }
    ]);
    assert.strictEqual(lista.length, 2);
    const ord = ordenarFila(lista);
    assert.strictEqual(ord[0].id, 3);
  });

  await test('Config: defaults e intervalos', async () => {
    const cfg = lerConfigDeMapa({});
    assert.strictEqual(cfg.ativa, true);
    assert.strictEqual(cfg.intervaloMinutos, DEFAULTS.intervaloMinutos);
    assert.ok(INTERVALOS_PERMITIDOS.includes(60));
    assert.strictEqual(CHAVES.ATIVA, 'recuperacao_xml_ativa');
  });

  await test('Documento entra automaticamente na fila no ciclo', async () => {
    const mem = criarRepoMemoria([{
      id: 27,
      chave: '23260635065903000640550010002465111132193245',
      status: S.XML_INDISPONIVEL,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      nsu: '000000000000264',
      xml: '<resNFe><chNFe>23260635065903000640550010002465111132193245</chNFe></resNFe>',
      createdAt: '2026-07-27T13:50:33Z'
    }]);

    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      gate: { autorizarConsultaDistDfe: async () => ({ permitido: true }) },
      obterContextoOperacional: async () => ({ ok: true, contexto: {} }),
      consultarNotaPorChave: async () => ({ cStat: '137', notasNovas: 0 }),
      processarDocumento: async () => null,
      agora: () => new Date('2026-07-29T12:00:00Z')
    });

    const rel = await motor.executarCiclo({ forcar: true });
    assert.strictEqual(rel.consultados, 1);
    const status = await motor.obterStatus();
    assert.ok(status.documentosMonitorados >= 1);
    assert.ok(mem.eventos.some((e) => e.tipo === 'RECUPERACAO_XML_ENTROU_FILA'));
    assert.ok(mem.eventos.some((e) => e.tipo === 'RECUPERACAO_XML_CONSULTA'));
    motor.parar({ silencioso: true });
  });

  await test('procNFe encontrado atualiza mesmo documento (sem INSERT)', async () => {
    const mem = criarRepoMemoria([{
      id: 27,
      chave: '23260635065903000640550010002465111132193245',
      status: S.XML_INDISPONIVEL,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      nsu: '000000000000264',
      numero: '',
      serie: '',
      xml: '<resNFe/>',
      createdAt: '2026-07-27T13:50:33Z'
    }]);

    let inserts = 0;
    const atualizacao = new CentralDocumentoAtualizacaoService({
      documentosRepository: {
        ...mem.documentosRepository,
        async inserir() {
          inserts += 1;
          throw new Error('INSERT não permitido');
        }
      },
      historicoRepository: mem.historicoRepository,
      transitionService: mem.transitionService
    });

    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      gate: { autorizarConsultaDistDfe: async () => ({ permitido: true }) },
      obterContextoOperacional: async () => ({ ok: true, contexto: {} }),
      consultarNotaPorChave: async () => {
        await atualizacao.atualizarComXmlCompleto({
          documento: await mem.documentosRepository.buscarPorId(27),
          xml: PROC_XML,
          metadados: { numero: '246511', serie: '1', valorTotal: 1319.28 },
          tipoDfe: DocumentoDfeTipo.PROC_NFE,
          origem: 'consulta_chave'
        });
        return { cStat: '138', notasNovas: 0 };
      },
      processarDocumento: async (id) => {
        await mem.transitionService.transicionar(
          id,
          S.XML_COMPLETO,
          S.EM_REVISAO
        );
        return { sucesso: true };
      },
      agora: () => new Date('2026-07-29T12:00:00Z')
    });

    const rel = await motor.executarCiclo({ forcar: true });
    assert.strictEqual(inserts, 0);
    assert.strictEqual(rel.recuperados, 1);
    const doc = await mem.documentosRepository.buscarPorId(27);
    assert.strictEqual(doc.status, S.EM_REVISAO);
    assert.strictEqual(doc.tipoDocumento, DocumentoDfeTipo.PROC_NFE);
    assert.strictEqual(doc.numero, '246511');
    assert.ok(mem.eventos.some((e) => e.tipo === 'RECUPERACAO_XML_RECUPERADO'));
    assert.ok(mem.historico.some((h) => String(h.detalhe || '').includes('XML recuperado automaticamente')));
    motor.parar({ silencioso: true });
  });

  await test('Scheduler inicia e para', async () => {
    const mem = criarRepoMemoria([]);
    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      consultarNotaPorChave: async () => ({}),
      processarDocumento: async () => null
    });
    await mem.configRepository.salvar(CHAVES.ATIVA, true, 'boolean');
    const r = await motor.iniciar({ delayMs: 60000 });
    assert.strictEqual(r.iniciado, true);
    assert.strictEqual(motor.estaAtivo(), true);
    motor.parar();
    assert.strictEqual(motor.estaAtivo(), false);
  });

  await test('Limite de tentativas remove da fila (timeout)', async () => {
    const mem = criarRepoMemoria([{
      id: 10,
      chave: '23260635065903000640550010002465111132193245',
      status: S.XML_INDISPONIVEL,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: '2026-01-01T00:00:00Z'
    }]);
    await mem.configRepository.salvar(CHAVES.MAX_TENTATIVAS, 2, 'number');
    await mem.configRepository.salvar(CHAVES.ESTADO, {
      docs: {
        '10': {
          tentativas: 2,
          desde: '2026-01-01T00:00:00Z',
          motivo: 'teste'
        }
      },
      metricas: {}
    }, 'json');

    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      gate: { autorizarConsultaDistDfe: async () => ({ permitido: true }) },
      obterContextoOperacional: async () => ({ ok: true, contexto: {} }),
      consultarNotaPorChave: async () => {
        throw new Error('não deveria consultar');
      },
      processarDocumento: async () => null,
      agora: () => new Date('2026-01-02T00:00:00Z')
    });

    const rel = await motor.executarCiclo({ forcar: true });
    assert.strictEqual(rel.removidos, 1);
    assert.strictEqual(rel.timeouts, 1);
    assert.ok(mem.eventos.some((e) => e.tipo === 'RECUPERACAO_XML_TIMEOUT'));
    motor.parar({ silencioso: true });
  });

  console.log(`\nResultado: ${ok} ok, ${falhas} falhas\n`);
  process.exit(falhas ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
