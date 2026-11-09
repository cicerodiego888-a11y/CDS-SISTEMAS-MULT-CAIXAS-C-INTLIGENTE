'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const express = require('express');
const request = require('supertest');
const tefFiscalContextService = require('../../backend/services/tef/tefFiscalContextService');

const rotaTefSource = fs.readFileSync(
  path.join(__dirname, '../../backend/rotas/tef.js'),
  'utf8'
);

function criarApp({ valorFiscal }) {
  const chamadasTef = [];
  const db = {
    get(sql, params, callback) {
      if (sql.includes('FROM vendas')) {
        return callback(null, { id: 42, valor_fiscal: valorFiscal });
      }
      if (sql.includes('FROM venda_recebimentos')) {
        return callback(null, { total: 0 });
      }
      if (sql.includes('FROM tef_transacoes') && sql.includes('idempotency_key')) {
        return callback(null, null);
      }
      if (sql.includes('FROM tef_transacoes') && sql.includes('SUM(valor)')) {
        return callback(null, { total: 0 });
      }
      throw new Error(`Consulta inesperada no teste HTTP TEF: ${sql}`);
    }
  };

  const estadosVinculo = {
    VENDA_INFORMADA: 'VENDA_INFORMADA',
    PENDENTE_FINALIZACAO: 'PENDENTE_FINALIZACAO'
  };
  const dependencias = new Map([
    ['express', express],
    ['./tefConfiguracao', express.Router()],
    ['./tefConciliacao', express.Router()],
    ['../database', db],
    ['../services/tef', {
      iniciarPagamento: async (dados) => {
        chamadasTef.push(dados);
        return { sucesso: true, aprovado: true, transacao_id: 7301 };
      }
    }],
    ['../services/tef/sdkDetector', {}],
    ['../services/tef/tefConciliacaoService', {}],
    ['../services/tef/tefDiagnosticoService', {}],
    ['../services/tef/tefEvents', {}],
    ['../services/tef/tefContrato', { estaAprovado: (resultado) => resultado.aprovado === true }],
    ['../middleware/auth', { verificarToken: (req, res, next) => next() }],
    ['../services/tef/tefConfigService', {}],
    ['../services/tef/tefFluxoPagamento', require('../../backend/services/tef/tefFluxoPagamento')],
    ['../services/configuracaoService', {}],
    ['../services/auditoria', { gravarAuditoria: async () => {} }],
    ['../services/fechamento-fiscal/NfceSituacaoFiscalService', {
      classificarSituacaoFiscalDaVenda: () => null
    }],
    ['../services/tef/tefVinculoVendaService', {
      ESTADOS_VINCULO: estadosVinculo,
      validarVendaIdParaPagamento: async (vendaId) => ({
        ok: Number(vendaId) === 42,
        venda_id: Number(vendaId)
      }),
      montarMetaRespostaPagamento: ({ vendaId, estadoVinculo, idempotencyKey, transacaoId }) => ({
        venda_id: vendaId,
        estado_vinculo: estadoVinculo,
        idempotency_key: idempotencyKey,
        transacao_id: transacaoId
      })
    }],
    ['../services/tef/tefFiscalContextService', tefFiscalContextService]
  ]);
  const modulo = { exports: {} };

  vm.runInNewContext(rotaTefSource, {
    module: modulo,
    exports: modulo.exports,
    require: (nome) => {
      if (!dependencias.has(nome)) {
        throw new Error(`Dependência não controlada no teste HTTP TEF: ${nome}`);
      }
      return dependencias.get(nome);
    },
    console: { error() {}, warn() {}, log() {}, info() {} }
  }, { filename: 'backend/rotas/tef.js' });

  const app = express();
  app.use(express.json());
  app.use('/api/tef', modulo.exports);
  return { app, chamadasTef };
}

test('POST /api/tef/pagar bloqueia requisição sem venda antes do serviço TEF', async () => {
  const { app, chamadasTef } = criarApp({ valorFiscal: 25 });
  const response = await request(app)
    .post('/api/tef/pagar')
    .send({ tipo: 'debito', valor: 10, modoFiscal: true });

  assert.equal(response.status, 400);
  assert.equal(chamadasTef.length, 0);
});

test('POST /api/tef/pagar bloqueia venda sem parcela fiscal antes do serviço TEF', async () => {
  const { app, chamadasTef } = criarApp({ valorFiscal: 0 });
  const response = await request(app)
    .post('/api/tef/pagar')
    .send({ venda_id: 42, tipo: 'debito', valor: 10, modoFiscal: true });

  assert.equal(response.status, 403);
  assert.equal(response.body.codigo, 'TEF_VENDA_SEM_VALOR_FISCAL');
  assert.equal(chamadasTef.length, 0);
});

test('POST /api/tef/pagar autoriza pelo serviço TEF stubado com contexto fiscal backend válido', async () => {
  const { app, chamadasTef } = criarApp({ valorFiscal: 25 });
  const response = await request(app)
    .post('/api/tef/pagar')
    .send({ venda_id: 42, tipo: 'debito', valor: 10 });

  assert.equal(response.status, 200);
  assert.equal(response.body.sucesso, true);
  assert.equal(chamadasTef.length, 1);
  assert.equal(
    tefFiscalContextService.validarContextoFiscal(chamadasTef[0].contextoFiscal, {
      valor: 10,
      tipo: 'debito'
    }),
    true
  );
});
