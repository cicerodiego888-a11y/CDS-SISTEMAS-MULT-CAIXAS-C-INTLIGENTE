'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const express = require('express');
const request = require('supertest');

const ROOT = path.join(__dirname, '../..');
const authSource = fs.readFileSync(path.join(ROOT, 'backend/middleware/auth.js'), 'utf8');
const middlewareSource = fs.readFileSync(
  path.join(ROOT, 'backend/middleware/exigirPermissaoOuSenhaAdmin.js'),
  'utf8'
);
const rotaTefSource = fs.readFileSync(path.join(ROOT, 'backend/rotas/tef.js'), 'utf8');
const pdvSource = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');

function criarMiddlewareAutorizacao({
  usuario,
  permissoes,
  erroPermissoes,
  senhaAdminValida,
  erroValidacaoSenhaAdmin
}) {
  const modulo = { exports: {} };
  vm.runInNewContext(middlewareSource, {
    module: modulo,
    exports: modulo.exports,
    require: (nome) => {
      if (nome === './auth') {
        return {
          verificarToken(req, res, next) {
            if (req.headers.authorization !== 'Bearer teste') {
              return res.status(401).json({ error: 'Acesso negado' });
            }
            req.user = usuario;
            return next();
          },
          buscarPermissoesUsuario(_usuarioId, callback) {
            callback(erroPermissoes || null, permissoes || []);
          }
        };
      }
      if (nome === '../utils/validarSenhaAdmin') {
        return {
          validarSenhaAdmin(senha, callback) {
            if (erroValidacaoSenhaAdmin) {
              return callback(erroValidacaoSenhaAdmin);
            }
            callback(null, senha === 'senha-admin-teste' && senhaAdminValida === true);
          }
        };
      }
      throw new Error(`Dependência não controlada no teste de autorização: ${nome}`);
    },
    console: { error() {} }
  }, { filename: 'backend/middleware/exigirPermissaoOuSenhaAdmin.js' });
  return modulo.exports;
}

function criarAppTef(opcoes = {}) {
  const eventos = [];
  const auditorias = [];
  const chamadasCancelamento = [];
  const usuario = opcoes.usuario || {
    id: 17,
    username: 'operador-teste',
    role: 'operador',
    perfil: 'USUARIO'
  };
  const auth = {
    verificarToken(req, res, next) {
      if (req.headers.authorization !== 'Bearer teste') {
        return res.status(401).json({ error: 'Acesso negado' });
      }
      req.user = usuario;
      return next();
    },
    buscarPermissoesUsuario(_usuarioId, callback) {
      callback(opcoes.erroPermissoes || null, opcoes.permissoes || []);
    }
  };
  const middleware = criarMiddlewareAutorizacao({
    usuario,
    permissoes: opcoes.permissoes,
    erroPermissoes: opcoes.erroPermissoes,
    senhaAdminValida: opcoes.senhaAdminValida,
    erroValidacaoSenhaAdmin: opcoes.erroValidacaoSenhaAdmin
  });
  const dependencias = new Map([
    ['express', express],
    ['../services/tef', {
      async cancelarPagamento(transacaoId) {
        eventos.push('servico-cancelamento');
        chamadasCancelamento.push(transacaoId);
        if (opcoes.erroCancelamento) throw opcoes.erroCancelamento;
        return { sucesso: true, cancelConfirmed: true, codigo: 'OK' };
      }
    }],
    ['./tefConfiguracao', express.Router()],
    ['./tefConciliacao', express.Router()],
    ['../database', {}],
    ['../services/tef/sdkDetector', {}],
    ['../services/tef/tefConciliacaoService', {}],
    ['../services/tef/tefDiagnosticoService', {}],
    ['../services/tef/tefEvents', {}],
    ['../services/tef/tefContrato', {}],
    ['../middleware/auth', auth],
    ['../middleware/exigirPermissaoOuSenhaAdmin', middleware],
    ['../services/tef/tefConfigService', {}],
    ['../services/tef/tefFluxoPagamento', {}],
    ['../services/configuracaoService', {}],
    ['../services/auditoria', {
      gravarAuditoria(dados) {
        auditorias.push(JSON.parse(JSON.stringify(dados)));
        eventos.push(dados.acao === 'autorizar_cancelamento'
          ? 'auditoria-autorizacao'
          : 'auditoria-operacao');
        if (opcoes.erroAuditoria && dados.acao === 'autorizar_cancelamento') {
          return Promise.reject(opcoes.erroAuditoria);
        }
        return Promise.resolve({ id: eventos.length });
      }
    }],
    ['../services/fechamento-fiscal/NfceSituacaoFiscalService', {
      classificarSituacaoFiscalDaVenda: async () => ({})
    }]
  ]);
  const modulo = { exports: {} };

  vm.runInNewContext(rotaTefSource, {
    module: modulo,
    exports: modulo.exports,
    require: (nome) => {
      if (!dependencias.has(nome)) {
        throw new Error(`Dependência não controlada no teste da rota TEF: ${nome}`);
      }
      return dependencias.get(nome);
    },
    console: { error() {}, warn() {}, log() {}, info() {} }
  }, { filename: 'backend/rotas/tef.js' });

  const app = express();
  app.use(express.json());
  app.use('/api/tef', modulo.exports);
  return { app, chamadasCancelamento, eventos, auditorias };
}

test('POST /api/tef/cancelar exige autorização administrativa no backend e audita a decisão', async (t) => {
  assert.match(authSource, /'cancelar_tef'/, 'a permissão precisa existir no catálogo oficial');

  await t.test('usuário autenticado com permissão passa; auditoria precede serviço', async () => {
    const { app, chamadasCancelamento, eventos, auditorias } = criarAppTef({
      permissoes: ['cancelar_tef']
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73, motivo: 'teste isolado' });

    assert.equal(response.status, 200);
    assert.deepEqual(chamadasCancelamento, [73]);
    assert.deepEqual(eventos.slice(0, 2), ['auditoria-autorizacao', 'servico-cancelamento']);
    assert.equal(auditorias[0].usuario_id, 17);
    assert.equal(auditorias[0].detalhes.resultado, 'PERMITIDO');
  });

  await t.test('perfil ADMIN autenticado passa pelo bypass administrativo padrão', async () => {
    const { app, chamadasCancelamento } = criarAppTef({
      usuario: {
        id: 18,
        username: 'admin-teste',
        role: 'operador',
        perfil: 'ADMIN'
      }
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 200);
    assert.deepEqual(chamadasCancelamento, [73]);
  });

  await t.test('usuário sem permissão nem senha é negado antes do serviço', async () => {
    const { app, chamadasCancelamento, eventos, auditorias } = criarAppTef();
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 403);
    assert.equal(response.body.requer_senha_admin, true);
    assert.deepEqual(chamadasCancelamento, []);
    assert.deepEqual(eventos, ['auditoria-autorizacao']);
    assert.equal(auditorias[0].detalhes.motivo, 'CREDENCIAL_ADMIN_AUSENTE');
  });

  await t.test('usuário sem autenticação é negado sem chamar o serviço', async () => {
    const { app, chamadasCancelamento } = criarAppTef({ permissoes: ['cancelar_tef'] });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 401);
    assert.deepEqual(chamadasCancelamento, []);
  });

  await t.test('token sem identidade de usuário é negado antes do serviço', async () => {
    const { app, chamadasCancelamento } = criarAppTef({
      usuario: { role: 'admin', perfil: 'ADMIN' },
      permissoes: []
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 403);
    assert.deepEqual(chamadasCancelamento, []);
  });

  await t.test('senha administrativa inválida é negada e não é registrada', async () => {
    const senha = 'senha-incorreta-de-teste';
    const { app, chamadasCancelamento, eventos, auditorias } = criarAppTef();
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73, senha_admin: senha });

    assert.equal(response.status, 403);
    assert.deepEqual(chamadasCancelamento, []);
    assert.deepEqual(eventos, ['auditoria-autorizacao']);
    assert.equal(auditorias[0].detalhes.motivo, 'CREDENCIAL_ADMIN_INVALIDA');
    assert.equal(JSON.stringify(auditorias).includes(senha), false);
  });

  await t.test('senha administrativa válida autoriza apenas uma chamada', async () => {
    const { app, chamadasCancelamento, auditorias } = criarAppTef({ senhaAdminValida: true });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73, senha_admin: 'senha-admin-teste' });

    assert.equal(response.status, 200);
    assert.deepEqual(chamadasCancelamento, [73]);
    assert.equal(auditorias[0].detalhes.motivo, 'CREDENCIAL_ADMIN_VALIDADA');
  });

  await t.test('falha ao consultar permissões bloqueia a operação', async () => {
    const { app, chamadasCancelamento, eventos, auditorias } = criarAppTef({
      erroPermissoes: new Error('erro isolado')
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 500);
    assert.deepEqual(chamadasCancelamento, []);
    assert.deepEqual(eventos, ['auditoria-autorizacao']);
    assert.equal(auditorias[0].detalhes.resultado, 'FALHA_VALIDACAO');
  });

  await t.test('falha no validador de senha bloqueia a operação', async () => {
    const { app, chamadasCancelamento, auditorias } = criarAppTef({
      erroValidacaoSenhaAdmin: new Error('erro isolado')
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73, senha_admin: 'senha-incorreta-de-teste' });

    assert.equal(response.status, 500);
    assert.deepEqual(chamadasCancelamento, []);
    assert.equal(auditorias[0].detalhes.motivo, 'ERRO_VALIDACAO_CREDENCIAL_ADMIN');
  });

  await t.test('falha de auditoria bloqueia autorização e serviço', async () => {
    const { app, chamadasCancelamento } = criarAppTef({
      permissoes: ['cancelar_tef'],
      erroAuditoria: new Error('auditoria indisponível')
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 500);
    assert.deepEqual(chamadasCancelamento, []);
  });

  await t.test('falha ao auditar tentativa negada preserva 403 e bloqueia serviço', async () => {
    const { app, chamadasCancelamento } = criarAppTef({
      erroAuditoria: new Error('auditoria indisponível')
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 403);
    assert.deepEqual(chamadasCancelamento, []);
  });

  await t.test('falha do serviço é auditada sem executar componente financeiro real', async () => {
    const { app, chamadasCancelamento, eventos } = criarAppTef({
      permissoes: ['cancelar_tef'],
      erroCancelamento: Object.assign(new Error('falha simulada'), { code: 'MOCK_FAILURE' })
    });
    const response = await request(app)
      .post('/api/tef/cancelar')
      .set('Authorization', 'Bearer teste')
      .send({ transacao_id: 73 });

    assert.equal(response.status, 500);
    assert.deepEqual(chamadasCancelamento, [73]);
    assert.deepEqual(eventos, ['auditoria-autorizacao', 'servico-cancelamento', 'auditoria-operacao']);
  });
});

function criarContextoCancelamentoPdv({ respostas, solicitarSenha, erroFetch } = {}) {
  const inicio = pdvSource.indexOf('async function cancelarVendaAtual() {');
  const fim = pdvSource.indexOf('\nfunction emitirNFCeVenda', inicio);
  assert.notEqual(inicio, -1);
  assert.notEqual(fim, -1);

  const requisicoes = [];
  const notificacoes = [];
  const respostasPendentes = [...(respostas || [])];
  const contexto = {
    API_URL: '/api',
    carrinho: [{ produto_id: 1 }],
    formaPagamentoSelecionada: 'debito',
    clienteSelecionado: null,
    vendaPrazoInfo: null,
    valorRecebidoDinheiroPDV: null,
    pagamentoFiscalAtual: { transacao_id: 73 },
    localStorage: { getItem: () => 'token-teste' },
    window: {
      confirm: () => true,
      solicitarSenhaAdministrador: solicitarSenha || (async () => 'senha-admin-teste')
    },
    fetch: async (_url, opcoes) => {
      requisicoes.push(JSON.parse(opcoes.body));
      if (erroFetch) throw erroFetch;
      const resposta = respostasPendentes.shift();
      if (!resposta) throw new Error('Resposta simulada ausente');
      return {
        ok: resposta.status >= 200 && resposta.status < 300,
        status: resposta.status,
        json: async () => resposta.body
      };
    },
    console: { log() {}, error() {} },
    showNotification: (mensagem, tipo) => notificacoes.push({ mensagem, tipo }),
    aoAlterarFormaPagamento() {},
    removerClienteSelecionado() {},
    atualizarCarrinho() {},
    focarCampoCodigo() {},
    $: () => ({ val() {}, text() {} })
  };

  vm.runInNewContext(
    `${pdvSource.slice(inicio, fim)}\nthis.executarCancelamento = cancelarVendaAtual;`,
    contexto,
    { filename: 'frontend/pdv/js/pdv.js' }
  );
  return { contexto, requisicoes, notificacoes };
}

test('PDV pede senha apenas no desafio do backend e falha de forma fechada', async (t) => {
  await t.test('desafio administrativo permite uma única repetição com senha', async () => {
    const { contexto, requisicoes } = criarContextoCancelamentoPdv({
      respostas: [
        { status: 403, body: { requer_senha_admin: true } },
        { status: 200, body: { sucesso: true, cancelConfirmed: true } }
      ]
    });

    await contexto.executarCancelamento();

    assert.equal(requisicoes.length, 2);
    assert.equal(requisicoes[1].senha_admin, 'senha-admin-teste');
    assert.equal(contexto.pagamentoFiscalAtual, null);
    assert.equal(contexto.carrinho.length, 0);
  });

  await t.test('credencial recusada mantém venda e não tenta novamente', async () => {
    const { contexto, requisicoes, notificacoes } = criarContextoCancelamentoPdv({
      respostas: [
        { status: 403, body: { requer_senha_admin: true } },
        { status: 403, body: { requer_senha_admin: true } }
      ]
    });

    await contexto.executarCancelamento();

    assert.equal(requisicoes.length, 2);
    assert.notEqual(contexto.pagamentoFiscalAtual, null);
    assert.equal(contexto.carrinho.length, 1);
    assert.match(notificacoes[0].mensagem, /Acesso negado/);
  });

  await t.test('timeout não solicita credencial nem repete operação', async () => {
    let solicitacoesSenha = 0;
    const { contexto, requisicoes } = criarContextoCancelamentoPdv({
      erroFetch: new Error('timeout'),
      solicitarSenha: async () => {
        solicitacoesSenha += 1;
        return 'senha-admin-teste';
      }
    });

    await contexto.executarCancelamento();

    assert.equal(requisicoes.length, 1);
    assert.equal(solicitacoesSenha, 0);
    assert.notEqual(contexto.pagamentoFiscalAtual, null);
    assert.equal(contexto.carrinho.length, 1);
  });

  await t.test('403 sem desafio não solicita senha e mantém venda', async () => {
    let solicitacoesSenha = 0;
    const { contexto, requisicoes } = criarContextoCancelamentoPdv({
      respostas: [{ status: 403, body: { error: 'Token inválido ou expirado' } }],
      solicitarSenha: async () => {
        solicitacoesSenha += 1;
        return 'senha-admin-teste';
      }
    });

    await contexto.executarCancelamento();

    assert.equal(requisicoes.length, 1);
    assert.equal(solicitacoesSenha, 0);
    assert.notEqual(contexto.pagamentoFiscalAtual, null);
    assert.equal(contexto.carrinho.length, 1);
  });
});
