'use strict';

/**
 * Harness E2E da Central NF-e: Central real → tela de Compras real (compras.js em VM)
 * → rotas Express reais → SQLite temporário.
 * Somente DOM/jQuery/Bootstrap são simulados; fetch e $.ajax chegam nas rotas reais.
 * Deve ser o primeiro require do teste: define DB_DIR antes de carregar o banco.
 */

const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const request = require('supertest');

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-central-nfe-e2e-'));
process.env.DB_DIR = dbDir;
delete require.cache[require.resolve('../../../backend/database')];

const db = require('../../../backend/database');
const { DocumentoFiscalStatus, normalizarStatus } = require('../../../backend/motores/central-entradas/core/DocumentoFiscalStatus');

const root = path.join(__dirname, '../../..');
const SCRIPTS_PAGINA_COMPRAS = [
  'frontend/erp/js/produto-apresentacao-resolver.js',
  'frontend/shared/js/motor-quantidade-compra.js',
  'frontend/erp/js/tratamento-fiscal-item-compra.js',
  'frontend/erp/js/compras-fornecedor-cnpj-rc831.js',
  'frontend/erp/js/compras.js'
];
const FUNCOES_CORE_FORMATACAO = ['formatDate', 'formatCurrency'];
const CNPJ_FORNECEDOR = '11222333000181';

function extrairFuncaoCore(nome) {
  const fonte = fs.readFileSync(path.join(root, 'frontend/shared/js/core.js'), 'utf8');
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `core.js deve definir ${nome}`);
  const fim = fonte.indexOf('\n}\n', inicio);
  return fonte.slice(inicio, fim + 3);
}

function runDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runCallback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function allDb(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbReady() {
  return new Promise((resolve, reject) => {
    db.whenReady((err) => (err ? reject(err) : resolve()));
  });
}

function aguardarReconciliacaoEstoque() {
  return new Promise((resolve, reject) => {
    const check = () => db.get(
      'SELECT valor FROM configuracoes WHERE chave = ?',
      ['migracao_recalc_saldos_estoque_v1'],
      (err, row) => {
        if (err) return reject(err);
        if (row?.valor === '1') return resolve();
        setImmediate(check);
      }
    );
    check();
  });
}

async function aguardar(condicao, descricao, pagina = null, timeoutMs = 15000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      const diagnostico = pagina
        ? JSON.stringify({
          requisicoes: pagina.requisicoes.map((r) => `${r.metodo} ${r.url} → ${r.resposta.status}${r.resposta.ok ? '' : ` ${JSON.stringify(r.resposta.body).slice(0, 300)}`}`),
          notificacoes: pagina.notificacoes,
          erros: pagina.errosCallback.map((e) => String(e?.stack || e).slice(0, 500))
        }, null, 1)
        : '';
      throw new Error(`Tempo esgotado aguardando: ${descricao} ${diagnostico}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function decodificarHtml(valor) {
  return String(valor)
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function digitoVerificadorChave(chave43) {
  let peso = 2;
  let soma = 0;
  for (let i = chave43.length - 1; i >= 0; i -= 1) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function montarXml(caso) {
  const chave43 = `3526101122233300018155001${String(caso.nf).padStart(9, '0')}1${String(caso.nf).padStart(8, '0')}`;
  const chave = `${chave43}${digitoVerificadorChave(chave43)}`;
  const vProd = (caso.qCom * caso.vUnCom).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
    <NFe>
      <infNFe Id="NFe${chave}" versao="4.00">
        <ide><cUF>35</cUF>${caso.natOp ? `<natOp>${caso.natOp}</natOp>` : ''}<mod>55</mod><serie>1</serie><nNF>${caso.nf}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi>${caso.finNFe ? `<finNFe>${caso.finNFe}</finNFe>` : ''}${caso.refNFe ? `<NFref><refNFe>${caso.refNFe}</refNFe></NFref>` : ''}</ide>
        <emit><CNPJ>${CNPJ_FORNECEDOR}</CNPJ><xNome>Fornecedor Sprint 2</xNome></emit>
        <det nItem="1"><prod>
          <cProd>${caso.codigo}</cProd><cEAN>${caso.gtin}</cEAN><xProd>${caso.nome}</xProd>
          <NCM>${caso.ncm || '00000000'}</NCM><CFOP>${caso.cfop || '5102'}</CFOP>
          <uCom>${caso.uCom}</uCom><qCom>${caso.qCom}</qCom><vUnCom>${caso.vUnCom.toFixed(2)}</vUnCom>
          <vProd>${vProd}</vProd><cEANTrib>${caso.gtin}</cEANTrib>
          <uTrib>${caso.uTrib}</uTrib><qTrib>${caso.qTrib}</qTrib><vUnTrib>${caso.vUnTrib.toFixed(2)}</vUnTrib>
        </prod>${caso.impostoXml || '<imposto />'}</det>
        <total><ICMSTot><vProd>${vProd}</vProd><vNF>${vProd}</vNF></ICMSTot></total>
      </infNFe>
    </NFe>`;
}

function criarApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/compras', require('../../../backend/rotas/compras'));
  app.use('/api/produtos', require('../../../backend/rotas/produtos'));
  app.use('/api/fornecedores', require('../../../backend/rotas/fornecedores'));
  return app;
}

/**
 * Página de Compras real em VM: carrega os mesmos scripts que app.js carrega para a rota
 * "compras" e liga fetch/$.ajax às rotas Express reais.
 */
function criarPaginaCompras(app) {
  const valores = new Map();
  const marcados = new Map();
  const handlers = new Map();
  const elementos = new Map();
  const sessao = new Map();
  const notificacoes = [];
  const requisicoes = [];
  const errosCallback = [];
  let ultimoHtmlAnexado = '';
  const htmlAnexados = [];

  function semearCampos(html) {
    for (const tag of String(html).matchAll(/<(input|textarea)\b([^>]*)>/gi)) {
      const attrs = tag[2];
      const id = attrs.match(/\bid="([^"]+)"/)?.[1];
      if (!id || /type="radio"/.test(attrs)) continue;
      const value = attrs.match(/\bvalue="([^"]*)"/)?.[1];
      if (value !== undefined) valores.set(`#${id}`, decodificarHtml(value));
      if (/\bchecked\b/.test(attrs)) marcados.set(`#${id}`, true);
    }
  }

  async function enviar(metodo, url, corpo) {
    let req = request(app)[String(metodo || 'GET').toLowerCase()](url)
      .set('Authorization', 'Bearer token-teste');
    if (corpo !== undefined) req = req.send(corpo);
    const res = await req;
    const resposta = { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body };
    requisicoes.push({ metodo: String(metodo || 'GET').toUpperCase(), url, corpo, resposta });
    return resposta;
  }

  function jq(alvo) {
    const chave = typeof alvo === 'string' ? alvo.trim() : '__objeto__';
    const base = {
      length: 1,
      val(...args) {
        if (args.length) {
          valores.set(chave, args[0] == null ? '' : String(args[0]));
          return proxy;
        }
        return valores.get(chave) ?? '';
      },
      is(seletor) {
        return seletor === ':checked' ? Boolean(marcados.get(chave)) : false;
      },
      prop(nome, valor) {
        if (valor === undefined) return nome === 'checked' ? Boolean(marcados.get(chave)) : undefined;
        if (nome === 'checked') marcados.set(chave, Boolean(valor));
        return proxy;
      },
      on(evento, ...resto) {
        const fn = resto.find((arg) => typeof arg === 'function');
        if (fn) handlers.set(`${chave}|${evento}`, fn);
        return proxy;
      },
      html(conteudo) {
        if (conteudo === undefined) return '';
        semearCampos(conteudo);
        return proxy;
      },
      append(conteudo) {
        if (typeof conteudo === 'string') {
          ultimoHtmlAnexado = conteudo;
          htmlAnexados.push(conteudo);
          semearCampos(conteudo);
        }
        return proxy;
      },
      text(valor) { return valor === undefined ? '' : proxy; },
      attr(nome, valor) { return valor === undefined ? undefined : proxy; },
      data() { return undefined; },
      toArray() { return []; },
      get() { return undefined; }
    };
    const proxy = new Proxy(base, {
      get(alvoBase, prop) {
        if (prop in alvoBase) return alvoBase[prop];
        if (typeof prop === 'symbol' || /^\d+$/.test(String(prop))) return undefined;
        return () => proxy;
      }
    });
    return proxy;
  }
  jq.ajax = (opcoes = {}) => {
    const corpo = typeof opcoes.data === 'string' ? JSON.parse(opcoes.data) : opcoes.data;
    const promessa = enviar(opcoes.method || opcoes.type || 'GET', opcoes.url, corpo);
    const registrar = (fn) => promessa.then(fn).catch((err) => errosCallback.push(err));
    const deferred = {
      promessa,
      done(cb) { registrar((r) => r.ok && cb(r.body, 'success', { status: r.status })); return deferred; },
      fail(cb) { registrar((r) => !r.ok && cb({ status: r.status, responseJSON: r.body })); return deferred; },
      always(cb) { registrar(() => cb()); return deferred; },
      then(ok, falha) {
        return promessa.then((r) => (r.ok ? ok?.(r.body) : falha?.({ status: r.status, responseJSON: r.body })));
      }
    };
    return deferred;
  };
  jq.when = (...deferreds) => {
    const todas = Promise.all(deferreds.map((d) => d.promessa));
    const registrar = (fn) => todas.then(fn).catch((err) => errosCallback.push(err));
    const combinado = {
      done(cb) {
        registrar((rs) => rs.every((r) => r.ok) && cb(...rs.map((r) => [r.body, 'success', { status: r.status }])));
        return combinado;
      },
      fail(cb) {
        registrar((rs) => rs.some((r) => !r.ok) && cb({ status: rs.find((r) => !r.ok).status }));
        return combinado;
      }
    };
    return combinado;
  };
  const $ = new Proxy(jq, {
    get(alvo, prop) {
      if (prop in alvo) return alvo[prop];
      return () => jq('__estatico__');
    }
  });

  function elementoDom(id) {
    if (!elementos.has(id)) {
      const ouvintes = [];
      elementos.set(id, {
        id,
        addEventListener(evento, fn, opcoes) { ouvintes.push({ evento, fn, once: opcoes?.once === true }); },
        removeEventListener() {},
        disparar(evento) {
          for (const ouvinte of [...ouvintes]) {
            if (ouvinte.evento !== evento) continue;
            if (ouvinte.once) ouvintes.splice(ouvintes.indexOf(ouvinte), 1);
            ouvinte.fn();
          }
        },
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        focus() {},
        select() {},
        scrollIntoView() {},
        style: {},
        querySelector: () => null,
        querySelectorAll: () => []
      });
    }
    return elementos.get(id);
  }

  const confirmacoesModal = {
    politicaEntradaModal: '#politicaEntradaConfirmar|click',
    resumoFiscalEntradaModal: '#btnConfirmarEscrituracaoFiscal|click',
    trocaProdutoCentralModal: '#trocaProdutoCentralConfirmar|click'
  };
  class Modal {
    constructor(el) { this.el = el; }
    show() {
      const chave = confirmacoesModal[this.el?.id];
      if (chave) setImmediate(() => handlers.get(chave)?.());
    }
    hide() { setImmediate(() => this.el?.disparar('hidden.bs.modal')); }
    static getInstance() { return null; }
    static getOrCreateInstance(el) { return new Modal(el); }
  }

  const documento = {
    getElementById: elementoDom,
    querySelectorAll(seletor) {
      if (!String(seletor).includes('.fiscal-campo-utilizado')) return [];
      return [...ultimoHtmlAnexado.matchAll(/<input\b[^>]*fiscal-campo-utilizado[^>]*>/g)].map((m) => {
        const attrs = m[0];
        const campo = decodificarHtml(attrs.match(/data-campo="([^"]*)"/)?.[1] || '');
        return {
          value: decodificarHtml(attrs.match(/\bvalue="([^"]*)"/)?.[1] || ''),
          getAttribute: (nome) => (nome === 'data-campo' ? campo : null)
        };
      });
    },
    querySelector: () => null,
    addEventListener() {},
    createElement: () => elementoDom(`tmp-${elementos.size}`),
    body: elementoDom('body'),
    currentScript: null,
    activeElement: null
  };

  const consoleSilencioso = { log() {}, info() {}, debug() {}, warn() {}, error() {}, trace() {}, group() {}, groupEnd() {}, table() {} };
  const context = {
    console: consoleSilencioso,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    $,
    jQuery: $,
    bootstrap: { Modal, Tooltip: class { dispose() {} }, Popover: class { dispose() {} } },
    document: documento,
    location: { href: 'http://localhost/erp/', pathname: '/erp/' },
    API_URL: '/api',
    localStorage: { getItem: () => 'token-teste', setItem() {}, removeItem() {} },
    sessionStorage: {
      getItem: (k) => (sessao.has(k) ? sessao.get(k) : null),
      setItem: (k, v) => sessao.set(k, String(v)),
      removeItem: (k) => sessao.delete(k)
    },
    fetch: async (url, opcoes = {}) => {
      const corpo = typeof opcoes.body === 'string' ? JSON.parse(opcoes.body) : opcoes.body;
      const r = await enviar(opcoes.method || 'GET', url, corpo);
      return { ok: r.ok, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    },
    showNotification: (mensagem, tipo = 'success') => notificacoes.push({ mensagem, tipo }),
    confirm: () => true,
    prompt() { throw new Error('prompt() is and will not be supported.'); },
    alert() {}
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(FUNCOES_CORE_FORMATACAO.map(extrairFuncaoCore).join('\n'), context, { filename: 'core.js' });
  for (const script of SCRIPTS_PAGINA_COMPRAS) {
    vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context, { filename: script });
  }

  return {
    context,
    valores,
    confirmacoesModal,
    sessao,
    notificacoes,
    requisicoes,
    errosCallback,
    htmlAnexados,
    avaliar: (codigo) => vm.runInContext(codigo, context)
  };
}

/**
 * Upload → revisão → finalizar pela Central real.
 * `revisao`: { decisao: 'ASSOCIAR' | 'CADASTRAR', produtoId } aplicada quando o documento cai em revisão.
 */
async function receberPelaCentral(central, caso, revisao = { decisao: 'ASSOCIAR', produtoId: caso.id }) {
  const xml = montarXml(caso);
  const upload = await central.uploadDocumentos([{
    originalname: `central-e2e-${caso.nf}.xml`,
    mimetype: 'application/xml',
    buffer: Buffer.from(xml, 'utf8')
  }]);
  assert.equal(upload.importados, 1, JSON.stringify(upload));
  const documentoId = Number(upload.itens[0].documentoId);
  assert.ok(documentoId > 0, 'Central deve persistir o documento');

  const documento = await central.obterDocumento(documentoId);
  const statusInicial = normalizarStatus(documento.status);
  const itemParse = documento.parseJson?.itens?.[0] || null;
  if (statusInicial === DocumentoFiscalStatus.EM_REVISAO) {
    await central.obterOuCriarSessaoRevisao(documentoId, { usuarioId: null });
    const produtoId = typeof revisao.produtoId === 'function'
      ? await revisao.produtoId(itemParse)
      : revisao.produtoId;
    await central.salvarDecisaoRevisao(documentoId, 0, {
      decisao: revisao.decisao,
      produtoId,
      item: { produto_id: produtoId }
    });
  }

  // Sprint 2 — decisões SIM/NÃO de conversão gravadas pela rota oficial da Central (revalidadas no backend).
  const conversoes = [];
  for (const conv of (Array.isArray(revisao.conversoes) ? revisao.conversoes : [])) {
    const salvo = await central.salvarDecisaoConversaoRevisao(documentoId, conv.indice ?? 0, {
      decisao: conv.decisao,
      documento_id: documentoId
    });
    conversoes.push(salvo);
  }

  const entrada = await central.finalizarEntrada(documentoId, { usuarioId: null });
  assert.equal(entrada.sucesso, true, JSON.stringify(entrada));
  assert.equal(entrada.proximaAcao, 'ABRIR_COMPRA');
  return { documentoId: Number(entrada.documentoId || documentoId), dadosCompra: entrada.dadosCompra, xml, statusInicial, itemParse, conversoes };
}

/**
 * Mesmo caminho do "Abrir compra" na Central: abertura da página (loadCompras) até "Confirmar e gravar entrada".
 * `antesDeGravar(pagina)`: interação na tela entre o carregamento e o saveCompra (ex.: EDITAR a linha).
 */
async function lancarCompraPelaTela(app, recebimento, { antesDeGravar = null, tipoEntrada = 'REVENDA' } = {}) {
  const pagina = criarPaginaCompras(app);
  pagina.sessao.set('central_abrir_compra', JSON.stringify({
    documentoId: recebimento.documentoId,
    origem: 'CENTRAL_NFE',
    dadosCompra: recebimento.dadosCompra
  }));
  pagina.valores.set('input[name="politica_entrada_import"]:checked', tipoEntrada);

  pagina.context.loadCompras();
  await aguardar(
    () => pagina.notificacoes.some((n) => /carregados pela Central/.test(n.mensagem))
      || pagina.notificacoes.some((n) => n.tipo === 'danger'),
    'tela de Compras carregar a NF-e da Central', pagina
  );
  assert.deepEqual(pagina.notificacoes.filter((n) => n.tipo === 'danger'), []);
  assert.ok(
    pagina.avaliar('produtosCompraList').some((p) => Number(p.id) === Number(recebimento.dadosCompra.itens[0].produto_id)),
    'loadCompras deve carregar o cadastro do produto pela rota real'
  );

  const itensTela = JSON.parse(JSON.stringify(pagina.avaliar('itensCompraAtual')));
  const custoTela = itensTela.map((item) => pagina.context.resolverCustoUnitarioCentralNfe(item));
  if (antesDeGravar) await antesDeGravar(pagina);

  pagina.context.saveCompra();
  await aguardar(
    () => pagina.requisicoes.some((r) => r.metodo === 'POST' && r.url === '/api/compras')
      || pagina.notificacoes.some((n) => n.tipo === 'warning' || n.tipo === 'danger'),
    'saveCompra enviar POST /api/compras', pagina
  );
  assert.deepEqual(
    pagina.notificacoes.filter((n) => n.tipo === 'warning' || n.tipo === 'danger'),
    [],
    'saveCompra não pode ser bloqueado'
  );
  const gravacao = pagina.requisicoes.find((r) => r.metodo === 'POST' && r.url === '/api/compras');
  await aguardar(
    () => pagina.notificacoes.some((n) => /registrada com sucesso|vínculo com a Central/.test(n.mensagem)),
    'retorno da gravação na tela',
    pagina
  );
  assert.deepEqual(pagina.errosCallback, []);
  return { pagina, itensTela, custoTela, gravacao };
}

async function criarCentral() {
  await dbReady();
  const { CentralEntradasOrchestrator } = require('../../../backend/motores/central-entradas/CentralEntradasOrchestrator');
  const app = criarApp();
  await aguardarReconciliacaoEstoque();
  return { app, central: new CentralEntradasOrchestrator({ db }) };
}

module.exports = {
  db,
  DocumentoFiscalStatus,
  runDb,
  getDb,
  allDb,
  montarXml,
  criarApp,
  criarCentral,
  criarPaginaCompras,
  receberPelaCentral,
  lancarCompraPelaTela
};
