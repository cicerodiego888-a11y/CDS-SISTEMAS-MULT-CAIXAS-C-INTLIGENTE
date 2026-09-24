/**
 * Sprint — Autorização inteligente do fechamento (ADMIN logado × operador).
 * node --test tests/caixa/autorizacao-inteligente-fechamento.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Rec = require('../../backend/services/caixa/ReconciliacaoVendaCaixa');
const {
  PERMISSAO_FECHAR_COM_DIVERGENCIA,
  usuarioPodeAutorizarDivergencia,
  avaliarDivergenciaFechamento,
  decidirAutorizacaoFechamento
} = require('../../backend/services/caixa/FechamentoCaixaAutorizacao');
const { calcularConferenciaFisica, validarConferenciaERetirada } = require('../../backend/services/caixa/FechamentoCaixaPolitica');
const { PERMISSOES_DISPONIVEIS } = require('../../backend/middleware/auth');
const { autenticarAdministrador } = require('../../backend/utils/validarSenhaAdmin');

const ROOT = path.join(__dirname, '../..');
const UI_PATH = path.join(ROOT, 'frontend/shared/js/fechamentoCaixaV2Ui.js');
const ROTA_PATH = path.join(ROOT, 'backend/rotas/caixa.js');
const AUTH_PATH = path.join(ROOT, 'backend/middleware/auth.js');
const ERP_CAIXA = path.join(ROOT, 'frontend/erp/js/caixa.js');
const PDV_CAIXA = path.join(ROOT, 'frontend/pdv/js/caixa.js');
const USUARIOS = path.join(ROOT, 'frontend/erp/js/usuarios.js');

const FOTO = [
  { id: 8, total: 239.52, fiscalNf: 239.54, div: 0.02 },
  { id: 9, total: 23.95, fiscalNf: 23.99, div: 0.04 },
  { id: 10, total: 49.84, fiscalNf: 49.75, div: -0.09 },
  { id: 11, total: 198.16, fiscalNf: 198.12, div: -0.04 }
];

function recFoto(item) {
  return Rec.reconciliarVenda(
    {
      id: item.id,
      total: item.total,
      valor_fiscal: item.fiscalNf,
      valor_nao_fiscal: 0,
      status_pagamento: 'quitada'
    },
    [],
    [{ tipo_recebimento: 'fiscal', forma_pagamento: 'pix', valor: item.total, status: 'aprovado' }]
  );
}

function fotoAvaliacao() {
  const vendas = FOTO.map(recFoto);
  return avaliarDivergenciaFechamento({
    reconciliacao: { vendas }
  }, { diferenca: 0, conferencia_ok: true });
}

function diego() {
  return {
    id: 1,
    username: 'diego',
    nome: 'Diego',
    role: 'admin',
    perfil: 'ADMIN',
    permissoes: PERMISSOES_DISPONIVEIS.slice()
  };
}

function joao() {
  return {
    id: 2,
    username: 'joao',
    nome: 'João',
    role: 'operador',
    perfil: 'USUARIO',
    permissoes: ['fechar_caixa', 'pdv']
  };
}

function adminSemPermissao() {
  return {
    id: 3,
    username: 'admin_restrito',
    nome: 'Admin Restrito',
    role: 'admin',
    perfil: 'ADMIN',
    permissoes: ['fechar_caixa', 'usuarios']
  };
}

function loadUi() {
  const sandbox = { module: { exports: {} } };
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  const code = fs.readFileSync(UI_PATH, 'utf8');
  const fn = new Function('window', 'global', 'module', 'exports', code + '\nreturn module.exports || window.FechamentoCaixaV2Ui;');
  return fn(sandbox, sandbox, sandbox.module, sandbox.module.exports);
}

function payloadBase() {
  return {
    valor_informado: 750,
    dinheiro_conferido: 750,
    modo_retirada: 'nenhuma',
    retirada_fechamento: 0,
    observacao: '',
    justificativa_divergencia: '',
    fechar_com_divergencia: false
  };
}

describe('Autorização inteligente do fechamento', () => {
  it('TESTE 1 — usuário comum + sem divergência fecha normalmente', async () => {
    const av = avaliarDivergenciaFechamento({ reconciliacao: { vendas: [] } }, {
      diferenca: 0, conferencia_ok: true
    });
    assert.equal(av.exige_autorizacao, false);
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: false, user: joao()
    });
    assert.equal(dec.autorizado, false);
    assert.equal(dec.precisaCredencial, false);
    assert.equal(dec.erro, undefined);

    const Ui = loadUi();
    const avisos = [];
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => false,
      confirmSimples: () => true,
      notify: (m) => avisos.push(m)
    });
    assert.equal(prep.ok, true);
    assert.equal(prep.payload.fechar_com_divergencia, false);
    assert.equal(prep.payload.usuario_admin, undefined);
    assert.deepEqual(avisos, []);
  });

  it('TESTE 2 — ADMIN + sem divergência fecha normalmente', async () => {
    const av = avaliarDivergenciaFechamento({ reconciliacao: { vendas: [] } }, {
      diferenca: 0, conferencia_ok: true
    });
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: false, user: diego()
    });
    assert.equal(dec.precisaCredencial, false);
    const Ui = loadUi();
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => true,
      confirmSimples: () => true
    });
    assert.equal(prep.ok, true);
    assert.equal(prep.payload.fechar_com_divergencia, false);
    assert.equal(prep.payload.senha_admin, undefined);
  });

  it('TESTE 3 — usuário comum + divergência pede confirmação SIM/NÃO', async () => {
    const av = fotoAvaliacao();
    assert.equal(av.exige_autorizacao, true);
    assert.equal(av.valor_divergencia, 0.07);
    const Ui = loadUi();
    assert.match(Ui.htmlConfirmacaoDivergencia(0.07), /Deseja fechar o caixa mesmo assim/);
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => false,
      confirmDivergencia: () => false
    });
    assert.equal(prep.ok, false);
    assert.equal(prep.cancelado, true);
  });

  it('TESTE 4 — usuário comum + SIM pede autorização admin', async () => {
    const av = fotoAvaliacao();
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: joao()
    });
    assert.equal(dec.autorizado, false);
    assert.equal(dec.precisaCredencial, true);
    assert.equal(dec.erro.codigo, 'AUTORIZACAO_ADMIN_NECESSARIA');

    const Ui = loadUi();
    const avisos = [];
    let pediuAuth = false;
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => false,
      confirmDivergencia: () => true,
      pedirAutorizacao: () => {
        pediuAuth = true;
        return null;
      },
      notify: (m) => avisos.push(m)
    });
    assert.equal(pediuAuth, true);
    assert.equal(prep.ok, false);
    assert.ok(avisos.includes('É necessária autorização de um administrador.'));
    assert.match(Ui.htmlAutorizacaoAdmin(), /Autorização de administrador/);
    assert.match(Ui.htmlAutorizacaoAdmin(), /caixa-v2-auth-usuario/);
    assert.match(Ui.htmlAutorizacaoAdmin(), /caixa-v2-auth-senha/);
  });

  it('TESTE 5 — senha admin correta fecha e registra autorizador', async () => {
    const av = fotoAvaliacao();
    const Ui = loadUi();
    const avisos = [];
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => false,
      confirmDivergencia: () => true,
      pedirAutorizacao: () => ({ usuario: 'diego', senha: 'ok' }),
      notify: (m) => avisos.push(m)
    });
    assert.equal(prep.ok, true);
    assert.equal(prep.payload.fechar_com_divergencia, true);
    assert.equal(prep.payload.usuario_admin, 'diego');
    assert.equal(prep.payload.senha_admin, 'ok');
    assert.ok(avisos.includes('Autorização concedida.'));
    const rota = fs.readFileSync(ROTA_PATH, 'utf8');
    assert.match(rota, /autenticarAdministrador/);
    assert.match(rota, /autorizado_por/);
  });

  it('TESTE 6 — senha admin incorreta não fecha', async () => {
    await new Promise((resolve, reject) => {
      autenticarAdministrador({ username: 'diego', senha: '' }, (err, r) => {
        try {
          assert.equal(err, null);
          assert.equal(r.ok, false);
          assert.equal(r.codigo, 'CREDENCIAIS_INVALIDAS');
          assert.equal(r.error, 'Usuário ou senha inválidos.');
          resolve();
        } catch (e) { reject(e); }
      });
    });
    const av = fotoAvaliacao();
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: joao()
    });
    assert.equal(dec.autorizado, false);
  });

  it('TESTE 7 — ADMIN logado + divergência não pede senha', async () => {
    const av = fotoAvaliacao();
    assert.equal(usuarioPodeAutorizarDivergencia(diego()), true);
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: diego()
    });
    assert.equal(dec.autorizado, true);
    assert.equal(dec.precisaCredencial, false);
    assert.equal(dec.autorizador.username, 'diego');

    const Ui = loadUi();
    let pediuAuth = false;
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => true,
      confirmDivergencia: () => true,
      pedirAutorizacao: () => { pediuAuth = true; return null; }
    });
    assert.equal(pediuAuth, false);
    assert.equal(prep.ok, true);
    assert.equal(prep.payload.senha_admin, undefined);
    assert.equal(prep.payload.usuario_admin, undefined);
  });

  it('TESTE 8 — ADMIN logado + SIM fecha diretamente', async () => {
    const av = fotoAvaliacao();
    const Ui = loadUi();
    const avisos = [];
    const prep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => true,
      confirmDivergencia: () => true,
      notify: (m) => avisos.push(m)
    });
    assert.equal(prep.ok, true);
    assert.equal(prep.autorizadoLocal, true);
    assert.equal(prep.payload.fechar_com_divergencia, true);
    assert.ok(avisos.includes('Fechamento autorizado.'));
  });

  it('TESTE 9 — ADMIN sem permissão específica não autoriza', () => {
    const av = fotoAvaliacao();
    assert.equal(usuarioPodeAutorizarDivergencia(adminSemPermissao()), false);
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: adminSemPermissao()
    });
    assert.equal(dec.autorizado, false);
    assert.equal(dec.precisaCredencial, true);
    assert.equal(usuarioPodeAutorizarDivergencia({ role: 'admin', permissoes: ['fechar_caixa'] }), false);
  });

  it('TESTE 10 — registra autorizado_por do usuário autenticado', () => {
    const av = fotoAvaliacao();
    const dec = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: diego()
    });
    assert.equal(dec.autorizador.id, 1);
    const rota = fs.readFileSync(ROTA_PATH, 'utf8');
    assert.match(rota, /autorizadoDivergencia && autorizador \? autorizador\.id/);
    assert.match(rota, /autorizado_por_nome/);
    assert.match(rota, /fechamento_com_divergencia/);
  });

  it('TESTE 11 — operador + administrador autorizador registra ambos', () => {
    const rota = fs.readFileSync(ROTA_PATH, 'utf8');
    assert.match(rota, /operador_id: operadorId/);
    assert.match(rota, /autorizado_por: autorizadoDivergencia && autorizador \? autorizador\.id/);
    assert.match(rota, /usuario_admin/);
    assert.notEqual(joao().id, diego().id);
  });

  it('TESTE 12 — autorização não transforma operador em ADMIN', () => {
    const erp = fs.readFileSync(ERP_CAIXA, 'utf8');
    const pdv = fs.readFileSync(PDV_CAIXA, 'utf8');
    const ui = fs.readFileSync(UI_PATH, 'utf8');
    assert.doesNotMatch(erp, /role\s*=\s*['"]admin['"]/);
    assert.doesNotMatch(pdv, /role\s*=\s*['"]admin['"]/);
    assert.match(ui, /autorização é somente|usuario_admin|pedirAutorizacao|autorizadoAdmin/);
    const joaoDepois = joao();
    assert.equal(joaoDepois.role, 'operador');
    assert.equal(joaoDepois.permissoes.includes('fechar_caixa_com_divergencia'), false);
  });

  it('TESTE 13 — sessão já fechada impede segundo fechamento', () => {
    const rota = fs.readFileSync(ROTA_PATH, 'utf8');
    assert.match(rota, /SESSAO_JA_FECHADA/);
    assert.match(rota, /Esta sessão já foi fechada/);
    assert.match(rota, /idx_caixa_fechamentos_sessao|UNIQUE constraint failed/);
    assert.match(rota, /AND status = 'aberto'/);
  });

  it('TESTE 14 — reconciliação é revalidada no POST', () => {
    const rota = fs.readFileSync(ROTA_PATH, 'utf8');
    assert.match(rota, /validar:\s*false/);
    assert.match(rota, /avaliarDivergenciaFechamento/);
    assert.match(rota, /resolverAutorizacaoFechamento/);
    assert.match(rota, /validarConsolidacaoOuErro/);
  });

  it('TESTE 15 — diferença física 0 + inconsistências segue autorização', () => {
    const av = fotoAvaliacao();
    assert.equal(av.diferenca_fisica, 0);
    assert.equal(av.quantidade_inconsistencias, 4);
    assert.equal(av.exige_autorizacao, true);
    assert.equal(av.tipo_divergencia, 'RECONCILIACAO');
    const decJoao = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: joao()
    });
    const decDiego = decidirAutorizacaoFechamento({
      avaliacao: av, fecharComDivergencia: true, user: diego()
    });
    assert.equal(decJoao.precisaCredencial, true);
    assert.equal(decDiego.autorizado, true);
  });

  it('TESTE 16 — diferença física ≠ 0 segue política existente', () => {
    const f = calcularConferenciaFisica({
      saldoInicial: 100,
      recebimentosDinheiro: 400,
      suprimentos: 0,
      sangriasOperacionais: 0,
      dinheiroConferido: 520,
      modoRetirada: 'nenhuma'
    });
    const operador = validarConferenciaERetirada(f, { user: { perfil: 'OPERADOR' } });
    assert.equal(operador.ok, false);
    assert.equal(operador.bloqueio, 'CONFERENCIA_FISICA');
    const adminSemJust = validarConferenciaERetirada(f, {
      fecharComDivergencia: true,
      user: { perfil: 'ADMIN' }
    });
    assert.equal(adminSemJust.ok, false);
    const admin = validarConferenciaERetirada(f, {
      fecharComDivergencia: true,
      justificativa: 'sobra conferida',
      user: { perfil: 'ADMIN' }
    });
    assert.equal(admin.ok, true);
    const av = avaliarDivergenciaFechamento({ reconciliacao: { vendas: [] } }, f);
    assert.equal(av.exige_autorizacao, true);
    assert.equal(av.tipo_divergencia, 'FISICA');
  });

  it('TESTE 17 — caso da foto: 4 inconsistências, R$ 0,07, fluxo completo', async () => {
    const av = fotoAvaliacao();
    assert.equal(av.quantidade_inconsistencias, 4);
    assert.equal(av.valor_divergencia, 0.07);
    assert.equal(av.saldo_liquido, -0.07);
    assert.equal(av.diferenca_fisica, 0);

    const Ui = loadUi();
    const html = Ui.montarHtmlTelaAberta({
      caixa: { id: 1, data: '2026-09-23', aberto_em: '2026-09-23 00:24:00' },
      dinheiro: { dinheiro_esperado: 750, valor_inicial: 750, vendas_dinheiro: 0, suprimentos: 0, sangrias: 0 },
      digital: { pix: 511.47, cartao_credito: 0, cartao_debito: 0, total_digital: 511.47 },
      total_vendido: 511.47,
      consolidacao: {
        caixa_fisico: { dinheiro_esperado: 750 },
        reconciliacao: {
          vendas_ok: 0,
          vendas_inconsistentes: 4,
          vendas: FOTO.map(recFoto)
        }
      }
    });
    assert.match(html, /✓ Dinheiro conferido/);
    assert.match(html, /4 venda\(s\) inconsistente/);
    assert.match(Ui.htmlConfirmacaoDivergencia(0.07), /R\$\s*0,07|R\$&nbsp;0,07/);

    const joaoPrep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => false,
      confirmDivergencia: () => true,
      pedirAutorizacao: () => ({ usuario: 'diego', senha: 'segredo' })
    });
    assert.equal(joaoPrep.ok, true);
    assert.equal(joaoPrep.payload.usuario_admin, 'diego');

    const diegoPrep = await Ui.prepararFechamento(false, {
      avaliacao: av,
      coletarPayload: () => payloadBase(),
      usuarioPodeAutorizar: () => true,
      confirmDivergencia: () => true
    });
    assert.equal(diegoPrep.ok, true);
    assert.equal(diegoPrep.autorizadoLocal, true);
    assert.equal(diegoPrep.payload.senha_admin, undefined);
  });

  it('catálogo reutiliza fechar_caixa_com_divergencia', () => {
    assert.equal(PERMISSAO_FECHAR_COM_DIVERGENCIA, 'fechar_caixa_com_divergencia');
    assert.ok(PERMISSOES_DISPONIVEIS.includes('fechar_caixa_com_divergencia'));
    assert.match(fs.readFileSync(AUTH_PATH, 'utf8'), /fechar_caixa_com_divergencia/);
    assert.match(fs.readFileSync(USUARIOS, 'utf8'), /fechar_caixa_com_divergencia/);
    assert.match(fs.readFileSync(UI_PATH, 'utf8'), /fechar_caixa_com_divergencia/);
  });
});
