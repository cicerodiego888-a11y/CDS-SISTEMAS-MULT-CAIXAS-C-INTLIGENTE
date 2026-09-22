/**
 * Sprint 2 — Recuperação inteligente de XML + consChNFe
 * node --test tests/central-entradas/sprint2-recuperacao-xml-gate.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../../backend/motores/central-entradas/core/DocumentoDfeTipo');
const {
  StatusRecuperacaoXml,
  classificarResultadoRecuperacao,
  calcularProximaTentativa,
  avaliarJanelaRecuperacao,
  deduplicarPorChave,
  ordenarFila,
  PRIORIDADE,
  JANELA_RECUPERACAO_DIAS,
  MotorRecuperacaoXmlService
} = require('../../backend/motores/central-entradas/recuperacao-xml');

function ler(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function criarRepoMemoria(docsIniciais = []) {
  const docs = new Map(docsIniciais.map((d) => [Number(d.id), { ...d }]));
  const historico = [];
  const config = new Map();
  return {
    docs,
    historico,
    documentosRepository: {
      async listar({ statusIn }) {
        return [...docs.values()].filter((d) => statusIn.includes(d.status));
      },
      async buscarPorId(id) {
        return docs.get(Number(id)) || null;
      },
      async buscarPorChave(chave) {
        const c = String(chave).replace(/\D/g, '');
        return [...docs.values()].find((d) => String(d.chave).replace(/\D/g, '') === c) || null;
      },
      async atualizar(id, patch) {
        const cur = docs.get(Number(id));
        if (!cur) return null;
        const next = { ...cur, ...patch };
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
      async inserir() { return {}; }
    },
    configRepository: {
      async listarTodas() {
        return [...config.entries()].map(([chave, valor]) => ({ chave, valor, tipo: 'json' }));
      },
      async buscarPorChave(chave) {
        if (!config.has(chave)) return null;
        return { chave, valor: config.get(chave), tipo: 'json' };
      },
      parseValor(reg) {
        return reg?.valor;
      },
      async salvar(chave, valor) {
        config.set(chave, valor);
        return { chave, valor };
      },
      async ensureDefaults() {}
    },
    transitionService: {
      async transicionar(id, de, para) {
        const cur = docs.get(Number(id));
        if (!cur) return null;
        cur.status = para;
        docs.set(Number(id), cur);
        return cur;
      }
    }
  };
}

describe('Sprint 2 — contratos Gate + recuperação', () => {
  it('motor usa SEFAZQueryGate / recuperacaoXml (sem caminho SOAP paralelo)', () => {
    const motor = ler('backend/motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlService.js');
    assert.match(motor, /SEFAZQueryGate|sefazQueryGate|ORIGENS_SEFAZ\.RECUPERACAO_XML/);
    assert.match(motor, /recuperacaoXml:\s*true/);
    assert.match(motor, /\[XML-RECOVERY\]|logXmlRecovery/);
    assert.match(motor, /next_attempt|proximaTentativa|calcularProximaTentativa/);
    assert.doesNotMatch(motor, /enviarDistribuicaoDfe\s*\(/);
  });

  it('distribuicaoDFe consChNFe passa pelo Gate', () => {
    const dfe = ler('backend/services/fiscal/distribuicaoDFe.js');
    assert.match(dfe, /TIPOS_CONSULTA\.CONS_CH_NFE/);
    assert.match(dfe, /sefazQueryGate\.request/);
  });
});

describe('Sprint 2 — classificador de estados', () => {
  it('1. resNFe → AGUARDANDO_XML_COMPLETO (não é erro)', () => {
    const r = classificarResultadoRecuperacao({
      resultadoConsulta: { cStat: '138', mensagem: 'Documento localizado' },
      documentoAtualizado: {
        status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
        tipoDocumento: DocumentoDfeTipo.RES_NFE
      }
    });
    assert.equal(r.statusRecuperacao, StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO);
    assert.equal(r.xmlCompleto, false);
    assert.equal(r.aguardando, true);
    assert.equal(r.caso, 'RESUMO');
  });

  it('2. XML completo → XML_COMPLETO', () => {
    const r = classificarResultadoRecuperacao({
      resultadoConsulta: { cStat: '138' },
      documentoAtualizado: {
        status: DocumentoFiscalStatus.XML_COMPLETO,
        tipoDocumento: DocumentoDfeTipo.PROC_NFE,
        xmlCompleto: true
      }
    });
    assert.equal(r.statusRecuperacao, StatusRecuperacaoXml.XML_COMPLETO);
    assert.equal(r.xmlCompleto, true);
  });

  it('3. erro recuperável', () => {
    const r = classificarResultadoRecuperacao({
      erro: { message: 'timeout ETIMEDOUT', codigo: 'ERRO_TIMEOUT' }
    });
    assert.equal(r.recuperavel, true);
    assert.equal(r.codigoErro, 'ERRO_TIMEOUT');
  });

  it('4. erro não recuperável (certificado)', () => {
    const r = classificarResultadoRecuperacao({
      erro: { message: 'certificado inválido', codigo: 'ERRO_CERTIFICADO' }
    });
    assert.equal(r.recuperavel, false);
    assert.equal(r.statusRecuperacao, StatusRecuperacaoXml.ERRO_RECUPERACAO);
  });

  it('5. 656 → cooldown / sem retry imediato', () => {
    const r = classificarResultadoRecuperacao({
      resultadoConsulta: { cStat: '656', mensagem: 'Consumo Indevido' }
    });
    assert.equal(r.caso, 'CSTAT_656');
    assert.equal(r.gateBloqueado, true);
    assert.equal(r.aguardando, true);
  });

  it('6. 137 → cooldown', () => {
    const r = classificarResultadoRecuperacao({
      resultadoConsulta: { cStat: '137' }
    });
    assert.equal(r.caso, 'CSTAT_137');
    assert.equal(r.gateBloqueado, true);
  });

  it('8. fora da janela 90 dias', () => {
    const antigo = new Date();
    antigo.setDate(antigo.getDate() - (JANELA_RECUPERACAO_DIAS + 5));
    const j = avaliarJanelaRecuperacao(antigo.toISOString());
    assert.equal(j.fora, true);
  });

  it('next_attempt_at respeita backoff e gate', () => {
    const agora = new Date('2026-09-22T12:00:00.000Z');
    const a = calcularProximaTentativa(0, agora);
    assert.ok(Date.parse(a) > agora.getTime());
    const b = calcularProximaTentativa(0, agora, '2026-09-22T18:00:00.000Z');
    assert.equal(b, '2026-09-22T18:00:00.000Z');
  });
});

describe('Sprint 2 — motor: estados / idempotência / duplicidade', () => {
  it('7. limite de tentativas → RECUPERACAO_ESGOTADA', async () => {
    const mem = criarRepoMemoria([{
      id: 1,
      chave: '35260114200166000187550010000000011000000010',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      createdAt: new Date().toISOString()
    }]);
    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      consultarNotaPorChave: async () => ({ cStat: '138' }),
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: { cnpj: '14200166000187', ambiente: 1 }
      }),
      processarDocumento: async () => null,
      sefazQueryGate: { autorizar: async () => ({ permitido: true }) },
      agora: () => new Date()
    });
    motor._estado.docs['1'] = {
      tentativas: 48,
      desde: new Date().toISOString(),
      chave: '35260114200166000187550010000000011000000010'
    };
    const config = await motor.obterConfig();
    const item = {
      id: 1,
      chave: '35260114200166000187550010000000011000000010',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      tentativas: 48,
      createdAt: new Date().toISOString()
    };
    const d = motor._avaliarLimites(item, { ...config, maxTentativas: 48 });
    assert.equal(d.remover, true);
    assert.equal(d.timeout, true);
  });

  it('9-10. mesma chave duas vezes → uma recuperação (dedup + lock)', async () => {
    const docs = [
      {
        id: 1,
        chave: '35260114200166000187550010000000011000000010',
        status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
        recuperacaoPrioridade: PRIORIDADE.NORMAL
      },
      {
        id: 2,
        chave: '35260114200166000187550010000000011000000010',
        status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
        recuperacaoPrioridade: PRIORIDADE.ALTA
      }
    ];
    const dedup = deduplicarPorChave(ordenarFila(docs));
    assert.equal(dedup.length, 1);
    assert.equal(dedup[0].id, 2);
  });

  it('11. XML já existente → não consulta SEFAZ', async () => {
    let consultas = 0;
    const mem = criarRepoMemoria([{
      id: 10,
      chave: '35260114200166000187550010000000011000000011',
      status: DocumentoFiscalStatus.XML_COMPLETO,
      tipoDocumento: DocumentoDfeTipo.PROC_NFE,
      xml: '<nfeProc><chNFe>35260114200166000187550010000000011000000011</chNFe></nfeProc>'
    }]);
    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      consultarNotaPorChave: async () => {
        consultas += 1;
        return { cStat: '138' };
      },
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: { cnpj: '14200166000187', ambiente: 1 }
      }),
      sefazQueryGate: { autorizar: async () => ({ permitido: true }) }
    });
    motor._estado.docs['10'] = { tentativas: 0, chave: '35260114200166000187550010000000011000000011' };
    const r = await motor._consultarDocumento(
      { id: 10, chave: '35260114200166000187550010000000011000000011', status: DocumentoFiscalStatus.XML_COMPLETO },
      { maxTentativas: 48, janelaRecuperacaoDias: 90 },
      'ciclo-test'
    );
    assert.equal(consultas, 0);
    assert.equal(r.recuperado, true);
    assert.match(r.mensagem, /já existente|não consultada/i);
  });

  it('resNFe no motor → AGUARDANDO (não falha)', async () => {
    const mem = criarRepoMemoria([{
      id: 3,
      chave: '35260114200166000187550010000000011000000012',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      dataEmissao: new Date().toISOString()
    }]);
    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      consultarNotaPorChave: async () => ({ cStat: '138', mensagem: 'ok' }),
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: { cnpj: '14200166000187', ambiente: 1 }
      }),
      sefazQueryGate: { autorizar: async () => ({ permitido: true }) }
    });
    motor._estado.docs['3'] = {
      tentativas: 0,
      desde: new Date().toISOString(),
      chave: '35260114200166000187550010000000011000000012'
    };
    const r = await motor._consultarDocumento(
      {
        id: 3,
        chave: '35260114200166000187550010000000011000000012',
        status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
        dataEmissao: new Date().toISOString()
      },
      { maxTentativas: 48, janelaRecuperacaoDias: 90 },
      'ciclo'
    );
    assert.equal(r.falha, false);
    assert.equal(r.recuperado, false);
    assert.match(r.mensagem, /resumo|ainda não disponível/i);
    assert.ok(motor._estado.docs['3'].proximaTentativa);
    assert.equal(
      motor._estado.docs['3'].statusRecuperacao,
      StatusRecuperacaoXml.AGUARDANDO_XML_COMPLETO
    );
  });

  it('13-14. lock impede duas execuções da mesma chave', async () => {
    const mem = criarRepoMemoria([{
      id: 5,
      chave: '35260114200166000187550010000000011000000015',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      tipoDocumento: DocumentoDfeTipo.RES_NFE,
      dataEmissao: new Date().toISOString()
    }]);
    let liberar;
    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      consultarNotaPorChave: () => new Promise((resolve) => {
        liberar = () => resolve({ cStat: '138' });
      }),
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: { cnpj: '14200166000187', ambiente: 1 }
      }),
      sefazQueryGate: { autorizar: async () => ({ permitido: true }) }
    });
    motor._estado.docs['5'] = { tentativas: 0, desde: new Date().toISOString() };
    const item = {
      id: 5,
      chave: '35260114200166000187550010000000011000000015',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      dataEmissao: new Date().toISOString()
    };
    const p1 = motor._consultarDocumento(item, { maxTentativas: 48, janelaRecuperacaoDias: 90 }, 'a');
    await new Promise((r) => setTimeout(r, 20));
    const p2 = await motor._consultarDocumento(item, { maxTentativas: 48, janelaRecuperacaoDias: 90 }, 'b');
    assert.match(p2.mensagem, /já em andamento/i);
    liberar();
    await p1;
  });

  it('isolamento Gate: pré-check bloqueado agenda next_attempt', async () => {
    const mem = criarRepoMemoria([{
      id: 7,
      chave: '35260114200166000187550010000000011000000017',
      status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
      dataEmissao: new Date().toISOString()
    }]);
    let consultou = false;
    const motor = new MotorRecuperacaoXmlService({
      documentosRepository: mem.documentosRepository,
      historicoRepository: mem.historicoRepository,
      eventosRepository: mem.eventosRepository,
      configRepository: mem.configRepository,
      transitionService: mem.transitionService,
      consultarNotaPorChave: async () => {
        consultou = true;
        return { cStat: '138' };
      },
      obterContextoOperacional: async () => ({
        ok: true,
        contexto: { cnpj: '111', ambiente: 1 }
      }),
      sefazQueryGate: {
        autorizar: async () => ({
          permitido: false,
          motivo: 'COOLDOWN',
          erro: 'ERRO_COOLDOWN',
          cstat: '656',
          retry_at: '2099-01-01T12:00:00.000Z',
          request_id: 'SEFAZ-TEST'
        })
      }
    });
    motor._estado.docs['7'] = { tentativas: 1, desde: new Date().toISOString() };
    const r = await motor._consultarDocumento(
      {
        id: 7,
        chave: '35260114200166000187550010000000011000000017',
        status: DocumentoFiscalStatus.RESUMO_RECEBIDO,
        dataEmissao: new Date().toISOString()
      },
      { maxTentativas: 48, janelaRecuperacaoDias: 90 },
      'c'
    );
    assert.equal(consultou, false);
    assert.equal(r.gateBloqueado, true);
    assert.equal(motor._estado.docs['7'].proximaTentativa, '2099-01-01T12:00:00.000Z');
  });
});

describe('Sprint 2 — label RESUMO', () => {
  it('UI label RESUMO_RECEBIDO comunica aguardando XML', () => {
    const { obterLabel } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
    assert.match(obterLabel(DocumentoFiscalStatus.RESUMO_RECEBIDO), /Aguardando XML/i);
  });
});
