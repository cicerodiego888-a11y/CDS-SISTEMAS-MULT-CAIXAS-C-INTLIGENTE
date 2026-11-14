'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { after, before, describe, it } = require('node:test');
const sqlite3 = require('sqlite3');
const {
  listarComprasRelatorio,
  validarFiltros,
  montarConsultaCompras
} = require('../../backend/services/compras/RelatorioComprasService');
const reportUi = require('../../frontend/erp/js/compras-relatorio');
const reportHtml = fs.readFileSync(path.join(__dirname, '../../frontend/erp/pages/compras-relatorio.html'), 'utf8');
const reportScript = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/compras-relatorio.js'), 'utf8');
const reportCss = fs.readFileSync(path.join(__dirname, '../../frontend/css/compras-relatorio.css'), 'utf8');

const ROOT = path.join(__dirname, '../..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-compras-relatorio-'));
const dbPath = path.join(tempDir, 'compras-report.db');
let db;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function openDatabase(mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(dbPath, mode, (error) => {
      if (error) return reject(error);
      resolve(connection);
    });
  });
}

function closeDatabase(connection) {
  return new Promise((resolve, reject) => {
    connection.close((error) => (error ? reject(error) : resolve()));
  });
}

function criarPaginaRelatorio(compras, resultadoImpressao = { ok: true }) {
  const elements = new Map();
  const requests = [];
  const printPayloads = [];
  let focusedId = null;

  class Elemento {
    constructor(id) {
      this.id = id;
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.hidden = false;
      this.disabled = false;
      this.attributes = {};
      this.handlers = new Map();
      this.classList = { toggle() {} };
    }

    addEventListener(event, handler) {
      this.handlers.set(event, handler);
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    focus() {
      focusedId = this.id;
    }

    dispatch(eventName, extra = {}) {
      const handler = this.handlers.get(eventName);
      if (handler) handler({ preventDefault() {}, target: this, ...extra });
    }

    reset() {
      for (const id of [
        'compras-report-date-start',
        'compras-report-date-end',
        'compras-report-supplier',
        'compras-report-invoice',
        'compras-report-purchase-id'
      ]) elements.get(id).value = '';
    }
  }

  for (const match of reportHtml.matchAll(/\bid="([^"]+)"/g)) {
    if (!elements.has(match[1])) elements.set(match[1], new Elemento(match[1]));
  }
  const document = {
    title: 'CDS',
    styleSheets: [{
      href: 'http://localhost/css/compras-relatorio.css',
      cssRules: [{ cssText: '.compras-report-purchase-meta { display: flex; gap: 0.3rem 1rem; }', conditionText: '' }]
    }],
    getElementById: (id) => elements.get(id) || null
  };
  const context = {
    document,
    URLSearchParams,
    API_URL: '/api',
    localStorage: { getItem: () => 'fixture-token' },
    carregarPaginaHtml(_path, onLoaded) { onLoaded(); },
    fetch: async (url) => {
      requests.push(String(url));
      return { ok: true, status: 200, json: async () => ({ compras }) };
    },
    addEventListener() {},
    removeEventListener() {},
    electronAPI: {
      imprimirRelatorioHtml(payload) {
        printPayloads.push(payload);
        return Promise.resolve(resultadoImpressao);
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    open() {
      const printWindow = {
        document: {
          open() {},
          write() {},
          close() {},
          body: {}
        },
        listeners: new Map(),
        focus() {},
        print() { printCount += 1; },
        close() {},
        get closed() { return false; },
        addEventListener(event, handler) {
          this.listeners.set(event, handler);
        }
      };
      return printWindow;
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(reportScript, context, { filename: 'compras-relatorio.js' });

  return {
    elements,
    requests,
    context,
    printPayloads,
    get focusedId() { return focusedId; }
  };
}

async function aguardarConsulta() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

before(async () => {
  db = await openDatabase();
  await run(`CREATE TABLE compras (
    id INTEGER PRIMARY KEY,
    data_compra TEXT,
    data_emissao TEXT,
    data_entrada TEXT,
    fornecedor TEXT,
    numero_nf TEXT,
    serie_nf TEXT,
    status TEXT,
    condicao_pagamento TEXT,
    forma_pagamento TEXT,
    valor_produtos REAL,
    valor_desconto REAL,
    valor_frete REAL,
    valor_seguro REAL,
    valor_outras_despesas REAL,
    valor_ipi REAL,
    valor_icms_st REAL,
    total REAL NOT NULL
  )`);
  await run(`CREATE TABLE compras_itens (
    id INTEGER PRIMARY KEY,
    compra_id INTEGER,
    produto_id INTEGER,
    quantidade REAL,
    preco_unitario REAL,
    subtotal REAL,
    descricao_produto TEXT,
    codigo_barras TEXT,
    unidade TEXT
  )`);

  await run(
    `INSERT INTO compras VALUES
      (1, '2026-10-01', '2026-09-30', '2026-10-01', 'Fornecedor A', 'NF-10', '1',
       'concluida', 'avista', 'pix', 50, 5, 10, 0, 2, 0, 0, 57),
      (2, '2026-10-15', NULL, NULL, 'Fornecedor B', NULL, NULL,
       'pendente', NULL, NULL, 30, 0, 0, 0, 0, 0, 0, 30),
      (3, '2026-09-30', NULL, NULL, 'Fornecedor A', 'NF-10', '1',
       'concluida', 'prazo', 'boleto', 15, 0, 0, 0, 0, 0, 0, 15)`
  );

  await run(
    `INSERT INTO compras_itens
      (id, compra_id, produto_id, quantidade, preco_unitario, subtotal, descricao_produto, codigo_barras, unidade)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [1, 1, 10, 2, 20, 40, 'Produto um', '789000000001', 'CX']
  );
  await run(
    `INSERT INTO compras_itens
      (id, compra_id, produto_id, quantidade, preco_unitario, subtotal, descricao_produto, codigo_barras, unidade)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [2, 1, 11, 1, 10, 10, 'Produto dois', '789000000002', 'UN']
  );
  for (let i = 0; i < 12; i += 1) {
    await run(
      `INSERT INTO compras_itens
        (id, compra_id, produto_id, quantidade, preco_unitario, subtotal, descricao_produto, codigo_barras, unidade)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [3 + i, 2, 20 + i, 1, 2, 2, `Item longo ${i + 1}`, null, 'UN']
    );
  }
  await run(
    `INSERT INTO compras_itens
      (id, compra_id, produto_id, quantidade, preco_unitario, subtotal, descricao_produto, codigo_barras, unidade)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [15, 3, 30, 1, 15, 15, 'Produto três', null, 'UN']
  );
});

after(async () => {
  if (db) await closeDatabase(db);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Relatório detalhado de compras', () => {
  it('valida datas, intervalo, ID e limites sem criar filtros padrão', () => {
    assert.deepEqual(validarFiltros({}), {
      dataInicio: null,
      dataFim: null,
      fornecedor: '',
      numeroNf: '',
      compraId: null
    });
    assert.throws(() => validarFiltros({ data_inicio: '2026-02-30' }), /data inicial inválido/);
    assert.throws(() => validarFiltros({ data_inicio: '2026-10-16', data_fim: '2026-10-15' }), /posterior/);
    assert.throws(() => validarFiltros({ compra_id: '1 OR 1=1' }), /ID da compra inválido/);
    assert.throws(() => validarFiltros({ fornecedor: 'x'.repeat(201) }), /limite permitido/);
  });

  it('usa filtros parametrizados e ordena data e ID de forma decrescente', () => {
    const built = montarConsultaCompras({
      dataInicio: '2026-10-01',
      dataFim: '2026-10-15',
      fornecedor: 'Fornecedor',
      numeroNf: 'NF',
      compraId: 2
    });
    assert.match(built.sql, /date\(c\.data_compra\) >= date\(\?\)/);
    assert.match(built.sql, /date\(c\.data_compra\) <= date\(\?\)/);
    assert.match(built.sql, /COALESCE\(c\.fornecedor, ''\) LIKE \? COLLATE NOCASE/);
    assert.match(built.sql, /COALESCE\(c\.numero_nf, ''\) LIKE \? COLLATE NOCASE/);
    assert.match(built.sql, /c\.id = \?/);
    assert.match(built.sql, /ORDER BY date\(c\.data_compra\) DESC, c\.id DESC/);
    assert.deepEqual(built.params, ['2026-10-01', '2026-10-15', '%Fornecedor%', '%NF%', 2]);
  });

  it('retorna todas as compras e todos os itens agrupados, sem substituir o total oficial', async () => {
    const result = await listarComprasRelatorio(db, {});
    assert.deepEqual(result.compras.map((purchase) => purchase.id), [2, 1, 3]);
    assert.equal(result.compras[0].itens.length, 12);
    assert.equal(result.compras[1].itens.length, 2);
    assert.equal(result.compras[1].total_oficial, 57);
    assert.equal(result.compras[1].itens.reduce((sum, item) => sum + item.subtotal, 0), 50);
    assert.equal(result.compras[1].valor_frete, 10);
    assert.equal(result.compras[1].valor_desconto, 5);
    assert.equal(result.compras[1].valor_icms_st, 0);
    assert.equal(result.compras[0].numero_nf, null);
  });

  it('aplica período, fornecedor, número de nota e ID sem chamadas por compra', async () => {
    const period = await listarComprasRelatorio(db, {
      data_inicio: '2026-10-01',
      data_fim: '2026-10-15'
    });
    assert.deepEqual(period.compras.map((purchase) => purchase.id), [2, 1]);

    const supplier = await listarComprasRelatorio(db, { fornecedor: 'fornecedor a' });
    assert.deepEqual(supplier.compras.map((purchase) => purchase.id), [1, 3]);

    const invoice = await listarComprasRelatorio(db, { numero_nf: 'NF-10' });
    assert.deepEqual(invoice.compras.map((purchase) => purchase.id), [1, 3]);

    const purchaseId = await listarComprasRelatorio(db, { compra_id: '2' });
    assert.deepEqual(purchaseId.compras.map((purchase) => purchase.id), [2]);
    assert.equal(purchaseId.compras[0].itens.length, 12);
  });

  it('formata métricas com compras únicas, linhas e notas identificadas', async () => {
    const result = await listarComprasRelatorio(db, {});
    const summary = reportUi.summarizePurchases(result.compras);
    assert.deepEqual(summary, {
      purchaseCount: 3,
      officialTotalCents: 10200,
      itemLineCount: 15,
      invoiceCount: 1
    });
  });

  it('renderiza todos os itens, campos ausentes, divergência e total persistido com escape HTML', async () => {
    const result = await listarComprasRelatorio(db, { compra_id: '2' });
    result.compras[0].itens[0].descricao_produto = '<Produto>';
    const rendered = reportUi.renderReport(result.compras, { compra_id: '2' }, '2026-10-15T15:00:00Z');
    assert.equal((rendered.html.match(/<tr>/g) || []).length, 13);
    assert.match(rendered.html, /&lt;Produto&gt;/);
    assert.match(rendered.html, /Sem nota identificada/);
    assert.match(rendered.html, /R\$ 30,00/);
    assert.match(rendered.html, /Itens registrados − total oficial/);
    assert.match(rendered.html, /Relat.rio emitido/);
    assert.doesNotMatch(rendered.html, /<Produto>/);
  });

  it('não apresenta valores fictícios e deixa os filtros numéricos opcionais vazios', async () => {
    assert.match(reportHtml, /id="compras-report-count">—</);
    assert.match(reportHtml, /id="compras-report-total">—</);
    const page = criarPaginaRelatorio([]);
    page.context.loadRelatorioCompras();
    await aguardarConsulta();
    assert.equal(page.elements.get('compras-report-error').textContent, '', 'a consulta inicial deve concluir sem erro');
    assert.equal(page.elements.get('compras-report-purchase-id').value, '');
    assert.equal(page.elements.get('compras-report-invoice').value, '');
    assert.equal(page.elements.get('compras-report-count').textContent, '0');
    assert.equal(page.elements.get('compras-report-total').textContent, 'R$ 0,00');
    assert.equal(page.elements.get('compras-report-results').innerHTML.includes('Nenhuma compra encontrada'), true);
    assert.equal(new URL(page.requests[0], 'http://localhost').search, '');
    page.elements.get('compras-report-preview-open').dispatch('click');
    assert.match(page.elements.get('compras-report-preview-content').innerHTML, /Nenhuma compra encontrada/);
    assert.equal(reportUi.formatOptionalMoney(null), 'Não informado');
    assert.equal(reportUi.formatOptionalMoney(0), 'R$ 0,00');
  });

  it('prévia, filtros atuais, fechamento e impressão preservam a consulta e os valores oficiais', async () => {
    const compras = [
      {
        id: 71, data_compra: '2026-10-15', fornecedor: 'Fornecedor A', numero_nf: 'NF-A',
        status: 'concluida', total_oficial: 125, valor_produtos: 120, valor_desconto: 5,
        valor_frete: 10, valor_seguro: 0, valor_outras_despesas: 0, valor_ipi: 0, valor_icms_st: 0,
        itens: [{ descricao_produto: 'Item A', unidade: 'CX', quantidade: 2, preco_unitario: 50, subtotal: 100 }]
      },
      {
        id: 72, data_compra: '2026-10-14', fornecedor: 'Fornecedor B', numero_nf: 'NF-B',
        status: 'concluida', total_oficial: 40, valor_produtos: 40, valor_desconto: 0,
        valor_frete: 0, valor_seguro: 0, valor_outras_despesas: 0, valor_ipi: 0, valor_icms_st: 0,
        itens: [{ descricao_produto: 'Item B', unidade: 'UN', quantidade: 4, preco_unitario: 10, subtotal: 40 }]
      }
    ];
    const page = criarPaginaRelatorio(compras);
    page.context.loadRelatorioCompras();
    await aguardarConsulta();
    assert.equal(page.elements.get('compras-report-error').textContent, '', 'a consulta inicial deve concluir sem erro');

    const results = page.elements.get('compras-report-results');
    const preview = page.elements.get('compras-report-preview');
    const previewContent = page.elements.get('compras-report-preview-content');
    const printButton = page.elements.get('compras-report-preview-print');
    const pdfButton = page.elements.get('compras-report-preview-pdf');
    const closeButton = page.elements.get('compras-report-preview-close');
    page.elements.get('compras-report-supplier').value = 'Fornecedor';
    page.elements.get('compras-report-invoice').value = 'NF';
    page.elements.get('compras-report-purchase-id').value = '71';
    page.elements.get('compras-report-date-start').value = '2026-10-01';
    page.elements.get('compras-report-date-end').value = '2026-10-15';
    page.elements.get('compras-report-form').dispatch('submit');
    await aguardarConsulta();
    assert.equal(page.elements.get('compras-report-error').textContent, '');
    assert.equal(page.requests.length, 2);
    const query = new URL(page.requests[1], 'http://localhost').searchParams;
    assert.equal(query.get('fornecedor'), 'Fornecedor');
    assert.equal(query.get('numero_nf'), 'NF');
    assert.equal(query.get('compra_id'), '71');
    assert.equal(query.get('data_inicio'), '2026-10-01');
    assert.equal(query.get('data_fim'), '2026-10-15');

    page.elements.get('compras-report-preview-open').dispatch('click');
    assert.equal(preview.hidden, false);
    assert.equal(preview.attributes['aria-hidden'], 'false');
    assert.equal(page.focusedId, 'compras-report-preview-close');
    assert.equal(previewContent.innerHTML, results.innerHTML);
    assert.match(previewContent.innerHTML, /Item A/);
    assert.match(previewContent.innerHTML, /Item B/);
    assert.match(previewContent.innerHTML, /R\$ 125,00/);
    assert.match(previewContent.innerHTML, /Itens registrados − total oficial/);
    assert.match(previewContent.innerHTML, /Fornecedor: Fornecedor/);
    assert.match(reportCss, /\.compras-report-preview-paper \.compras-report-financial > div:not\(\.official-total\)\s*\{\s*display: none !important;/);

    printButton.dispatch('click');
    pdfButton.dispatch('click');
    await aguardarConsulta();
    assert.equal(page.printPayloads.length, 2, 'impressão e PDF devem usar a ponte IPC existente');
    assert.match(page.printPayloads[0].html, /QA|Fornecedor A/);
    assert.match(page.printPayloads[0].html, /Item A/);
    assert.match(page.printPayloads[0].html, /Total oficial da compra/);
    assert.match(page.printPayloads[0].html, /div:not\(\.official-total\)/);
    assert.match(page.printPayloads[0].html, /compras-report-purchase-meta \{ display: flex; gap: 0\.3rem 1rem; \}/);
    assert.match(page.printPayloads[0].html, /data-expected-purchases="2" data-expected-item-rows="2"/);
    assert.equal(page.elements.get('compras-report-preview').hidden, false, 'a prévia permanece aberta durante e após a impressão');
    assert.match(page.elements.get('compras-report-status').textContent, /Geração do PDF concluída|Impressão concluída/);
    closeButton.dispatch('click');
    assert.equal(preview.hidden, true);
    assert.equal(preview.attributes['aria-hidden'], 'true');
    assert.equal(page.focusedId, 'compras-report-preview-open');
    assert.equal(page.requests.length, 2, 'prévia e fechamento não fazem nova consulta');
    assert.deepEqual([
      page.elements.get('compras-report-supplier').value,
      page.elements.get('compras-report-invoice').value,
      page.elements.get('compras-report-purchase-id').value,
      page.elements.get('compras-report-date-start').value,
      page.elements.get('compras-report-date-end').value
    ], ['Fornecedor', 'NF', '71', '2026-10-01', '2026-10-15']);
  });

  it('mantém a prévia e comunica cancelamento ou falha retornados pelo Electron', async () => {
    const purchase = {
      id: 81,
      data_compra: '2026-10-15',
      fornecedor: 'Fornecedor QA',
      total_oficial: 20,
      itens: [{ descricao_produto: 'Item QA', unidade: 'UN', quantidade: 1, preco_unitario: 20, subtotal: 20 }]
    };
    for (const result of [
      { ok: false, cancelado: true },
      { ok: false, erro: 'Falha QA ao imprimir.' }
    ]) {
      const page = criarPaginaRelatorio([purchase], result);
      page.context.loadRelatorioCompras();
      await aguardarConsulta();
      page.elements.get('compras-report-preview-open').dispatch('click');
      page.elements.get('compras-report-preview-print').dispatch('click');
      await aguardarConsulta();

      assert.equal(page.elements.get('compras-report-preview').hidden, false);
      if (result.cancelado) {
        assert.match(page.elements.get('compras-report-preview-status').textContent, /Impressão cancelada/);
        assert.equal(page.elements.get('compras-report-preview-error').textContent, '');
      } else {
        assert.equal(page.elements.get('compras-report-preview-status').textContent, '');
        assert.equal(page.elements.get('compras-report-preview-error').textContent, result.erro);
      }
    }
  });

  it('abre o relatório pela navegação e usa impressão nativa para imprimir e salvar PDF', () => {
    const app = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/app.js'), 'utf8');
    const nav = fs.readFileSync(path.join(ROOT, 'frontend/erp/index.html'), 'utf8');
    const page = fs.readFileSync(path.join(ROOT, 'frontend/erp/pages/compras-relatorio.html'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'frontend/css/compras-relatorio.css'), 'utf8');
    const route = fs.readFileSync(path.join(ROOT, 'backend/rotas/compras.js'), 'utf8');
    const server = fs.readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'frontend/erp/js/compras-relatorio.js'), 'utf8');

    assert.match(nav, /data-page="compras-relatorio"[^>]*title="Relatório de Compras"/);
    assert.match(app, /'compras-relatorio': \['\/erp\/js\/compras-relatorio\.js'\]/);
    assert.match(app, /case 'compras-relatorio':/);
    assert.match(page, /id="compras-report-submit"/);
    assert.match(page, /id="compras-report-clear"/);
    assert.match(script, /compras-report-print-document/);
    assert.doesNotMatch(script, /body\s*\*\s*\{[^}]*visibility:\s*hidden/i);
    assert.match(page, /id="compras-report-preview-open"/);
    assert.match(page, /id="compras-report-preview-print"/);
    assert.match(page, /id="compras-report-preview-pdf"/);
    assert.match(page, /id="compras-report-preview-close"/);
    assert.match(route, /router\.get\('\/relatorio\/detalhado'/);
    assert.match(server, /app\.use\('\/api\/compras', verificarToken, comprasRoutes\)/);
    assert.match(script, /electronAPI\.imprimirRelatorioHtml/);
    assert.doesNotMatch(script, /noopener|root\.print\(\)|setTimeout\(fecharJanelaImpressao/);
    assert.match(script, /\.compras-report-purchase \{\s*overflow: visible !important;\s*break-inside: auto;\s*page-break-inside: auto;/s);
    assert.match(script, /\.compras-report-items-table tr \{\s*break-inside: avoid;\s*page-break-inside: avoid;/s);
    assert.match(script, /Gerando PDF do relatório|Impressão concluída/);
    assert.match(css, /#compras-report-preview,/);
    assert.match(css, /@page\s*\{\s*size: A4 portrait;/);
    assert.match(css, /@media print/);
    assert.match(css, /table-header-group/);
    assert.match(css, /break-inside: avoid/);
    assert.match(css, /\.compras-report-preview-paper \.compras-report-financial > div:not\(\.official-total\)\s*\{\s*display: none !important;/);
    assert.match(css, /\.compras-report-financial > div:not\(\.official-total\)\s*\{\s*display: none !important;/);
    assert.match(css, /\.compras-report-financial\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
    assert.match(css, /\.compras-report-financial\s*\{[^}]*gap: 0;/s);
  });

  it('executa a consulta somente leitura em conexão read-only', async () => {
    await closeDatabase(db);
    db = null;
    const readonlyDb = await openDatabase(sqlite3.OPEN_READONLY);
    try {
      const before = await listarComprasRelatorio(readonlyDb, {});
      assert.equal(before.compras.length, 3);
      await assert.rejects(
        new Promise((resolve, reject) => {
          readonlyDb.run('UPDATE compras SET total = 0 WHERE id = 1', (error) => {
            if (error) return reject(error);
            resolve();
          });
        }),
        /readonly/i
      );
      const afterRead = await listarComprasRelatorio(readonlyDb, {});
      assert.equal(afterRead.compras.find((purchase) => purchase.id === 1).total_oficial, 57);
    } finally {
      await closeDatabase(readonlyDb);
      db = null;
    }
  });
});
