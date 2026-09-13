/**
 * RC4.32.0 — Camada Oficial de Certificação Funcional do CDS ERP
 * @module certification/ReleaseCertificationService
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ReleaseCertificationMetrics } = require('./ReleaseCertificationMetrics');
const { escreverRelatorios } = require('./ReleaseCertificationReporter');

const TAG = '[RC4.32.0]';

function promisifyDb(db, method, sql, params = []) {
  return new Promise((resolve, reject) => {
    db[method](sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(db, sql, params = []) {
  return promisifyDb(db, 'run', sql, params);
}

function dbGet(db, sql, params = []) {
  return promisifyDb(db, 'get', sql, params);
}

function dbAll(db, sql, params = []) {
  return promisifyDb(db, 'all', sql, params);
}

class ReleaseCertificationService {
  constructor(opcoes = {}) {
    this.rootDir = opcoes.rootDir || path.join(__dirname, '..', '..');
    this.opcoes = opcoes;
    this.metrics = new ReleaseCertificationMetrics();
    this.modulos = {};
    this._ctx = {};
    this._prefix = `RC4320-${Date.now()}`;
  }

  async _executarModulo(chave, titulo, fn) {
    const ctx = this.metrics.iniciarEtapa(chave);
    try {
      const detalhe = await fn();
      this.metrics.finalizarEtapa(ctx, 'OK', detalhe);
      this.modulos[chave] = { ok: true, titulo, detalhe };
      console.log(`${TAG} ✔ ${titulo}`);
      return true;
    } catch (err) {
      this.metrics.registrarExcecao(chave, err);
      this.metrics.finalizarEtapa(ctx, 'FALHA', err.message);
      this.modulos[chave] = { ok: false, titulo, detalhe: err.message };
      console.error(`${TAG} ✘ ${titulo}: ${err.message}`);
      return false;
    }
  }

  async _obterAmbiente() {
    const pkg = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8'));
    let buildManifest = null;
    let hashAppAsar = null;
    try {
      const integrity = require(path.join(this.rootDir, 'electron-integrity'));
      buildManifest = integrity.lerManifestoBuild(this.rootDir);
      hashAppAsar = buildManifest.hashAppAsar;
    } catch (_) {
      try {
        const integrity = require(path.join(this.rootDir, 'electron-integrity'));
        const asar = integrity.resolverAsarPathErp(this.rootDir);
        if (asar) hashAppAsar = integrity.hashAsarCompleto(asar);
      } catch (__) { /* ignore */ }
    }
    return {
      versao: pkg.version,
      commit: buildManifest?.commit || 'local',
      build: buildManifest?.build || new Date().toISOString(),
      hashAppAsar,
      origem: this._ctx.pacote?.origem || 'fonte'
    };
  }

  /** ETAPA 1 — Inicialização */
  async etapaInicializacao() {
    return this._executarModulo('inicializacao', 'Inicialização do ERP', async () => {
      const db = require(path.join(this.rootDir, 'backend/database'));
      await new Promise((resolve, reject) => {
        db.whenReady((err) => (err ? reject(err) : resolve()));
      });
      this._ctx.db = db;
      this.metrics.incrementarSql(1);

      const { validarPacoteInstalado } = require(path.join(
        this.rootDir,
        'tests/e2e/release-certification/helpers/asarValidator'
      ));
      this._ctx.pacote = validarPacoteInstalado(this.rootDir);

      const tabelas = await dbGet(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='produtos'");
      if (!tabelas) throw new Error('Banco não inicializado — tabela produtos ausente');

      return `DB ok | pacote: ${this._ctx.pacote.origem} | asar: ${this._ctx.pacote.hashAppAsar?.slice(0, 12) || 'N/A'}…`;
    });
  }

  /** ETAPA 2 — Login */
  async etapaLogin() {
    return this._executarModulo('login', 'Login', async () => {
      const express = require('express');
      const bodyParser = require('body-parser');
      const http = require('http');
      const { router: authRouter } = require(path.join(this.rootDir, 'backend/rotas/auth'));
      const { login, request } = require(path.join(
        this.rootDir,
        'tests/e2e/release-certification/helpers/apiClient'
      ));

      const app = express();
      app.use(bodyParser.json());
      app.get('/ping', (_req, res) => res.json({ status: 'ok' }));
      app.use('/api/auth', authRouter);

      const server = http.createServer(app);
      await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
      });
      const porta = server.address().port;
      const baseUrl = `http://127.0.0.1:${porta}/api`;

      const db = this._ctx.db;
      const bcrypt = require('bcryptjs');
      const userCert = `rc4320_${Date.now()}`;
      const passCert = 'rc4320-cert-pass';
      const hash = bcrypt.hashSync(passCert, 10);
      await dbRun(db, `INSERT INTO usuarios (username, password_hash, role, nome, perfil, ativo, troca_senha_obrigatoria)
        VALUES (?, ?, 'admin', 'Release Cert', 'SUPER_ADMIN', 1, 0)`, [userCert, hash]);

      try {
        const sessao = await login(baseUrl, userCert, passCert);
        if (!sessao.user?.id) throw new Error('Usuário não retornado');
        if (!sessao.token) throw new Error('Token JWT ausente');
        this._ctx.token = sessao.token;
        this._ctx.user = sessao.user;

        const ping = await request('GET', `${baseUrl.replace('/api', '')}/ping`);
        if (ping.status !== 200) throw new Error(`Ping falhou: ${ping.status}`);

        return `user=${sessao.user.username} perfil=${sessao.user.perfil || sessao.user.role}`;
      } finally {
        try {
          const u = await dbGet(db, 'SELECT id FROM usuarios WHERE username = ?', [userCert]);
          if (u?.id) {
            await dbRun(db, 'DELETE FROM usuario_permissoes WHERE usuario_id = ?', [u.id]).catch(() => {});
            await dbRun(db, 'DELETE FROM usuarios WHERE id = ?', [u.id]);
          }
        } catch (_) { /* cleanup best-effort */ }
        server.close();
      }
    });
  }

  /** ETAPA 3 — Produtos */
  async etapaProdutos() {
    return this._executarModulo('produtos', 'Cadastro de Produtos', async () => {
      const db = this._ctx.db;
      const codigo = `${this._prefix}-P`;
      const nome = `Produto Cert ${this._prefix}`;

      await dbRun(db, `INSERT INTO produtos (
        codigo, nome, unidade, preco_compra, lucro_percentual, preco_venda,
        estoque_atual, estoque_minimo, codigo_barras, unidade_comercial,
        quantidade_por_embalagem, compra_por_embalagem, ativo
      ) VALUES (?, ?, 'UN', 10, 30, 13, 0, 0, ?, 'UN', 1, 0, 1)`, [
        codigo, nome, `789${String(Date.now()).slice(-10)}`
      ]);
      this.metrics.incrementarSql(1);

      const prod = await dbGet(db, 'SELECT id, codigo, nome FROM produtos WHERE codigo = ?', [codigo]);
      if (!prod?.id) throw new Error('Produto não persistido');

      await dbRun(db, `UPDATE produtos SET nome = ?, preco_venda = ? WHERE id = ?`, [
        `${nome} Editado`, 15, prod.id
      ]);
      this.metrics.incrementarSql(1);

      const { garantirSchemaProdutoEmbalagens } = require(path.join(
        this.rootDir,
        'backend/services/produto-embalagem/produtoEmbalagensSchema'
      ));
      await new Promise((resolve, reject) => {
        garantirSchemaProdutoEmbalagens(db, (err) => (err ? reject(err) : resolve()));
      });

      await dbRun(db, 'DELETE FROM produto_embalagens WHERE produto_id = ?', [prod.id]);
      await dbRun(db, `INSERT INTO produto_embalagens (produto_id, tipo, quantidade, principal, ativa)
        VALUES (?, 'CX', 12, 1, 1)`, [prod.id]);
      this.metrics.incrementarSql(1);

      const emb = await dbGet(db, 'SELECT tipo, quantidade FROM produto_embalagens WHERE produto_id = ? AND tipo = ?', [prod.id, 'CX']);
      if (!emb || Number(emb.quantidade) !== 12) {
        throw new Error(`Embalagem não persistida (tipo=${emb?.tipo} qtd=${emb?.quantidade})`);
      }

      await dbRun(db, 'DELETE FROM produto_embalagens WHERE produto_id = ?', [prod.id]);
      await dbRun(db, 'DELETE FROM produtos WHERE id = ?', [prod.id]);
      this.metrics.incrementarSql(2);

      this._ctx.produtoTesteId = prod.id;
      return `CRUD ok | embalagem CX×12 | codigo=${codigo}`;
    });
  }

  /** ETAPA 4 — Compras + ETAPA 7 MIIP + ETAPA 8 Central */
  async etapaComprasCentralMiip() {
    const okCompras = await this._executarModulo('compras', 'Compras', async () => {
      return this._fluxoCentralCompras();
    });
    await this._executarModulo('miip', 'MIIP', async () => {
      const { obterMuc } = require(path.join(this.rootDir, 'backend/motores/muc/public'));
      const muc = obterMuc(this._ctx.db);
      const sim = muc.simular({
        quantidadeCompra: 10,
        quantidadePorApresentacao: 12,
        valorTotal: 120
      });
      if (!sim || Number(sim.quantidadeEstoque) !== 120) {
        throw new Error(`MUC simulação inválida: estoque=${sim?.quantidadeEstoque}`);
      }
      return `MUC 10×12 → ${sim.quantidadeEstoque} UN (${sim.tipoConversao || 'MULTIPLICADOR'})`;
    });
    await this._executarModulo('central', 'Central Inteligente', async () => {
      if (!this._ctx.chaveNfe) return 'delegado ao fluxo compras';
      return `documento ${this._ctx.chaveNfe.slice(-6)} processado`;
    });
    return okCompras;
  }

  async _fluxoCentralCompras() {
    const fsLocal = require('fs');
    const fixDir = path.join(this.rootDir, 'tests/central-entradas/fixtures');
    const CHAVE = '35260112345678000199550010000000641000000064';

    const CentralDfePersistenciaService = require(path.join(
      this.rootDir,
      'backend/motores/central-entradas/services/CentralDfePersistenciaService'
    ));
    const CentralProcessamentoService = require(path.join(
      this.rootDir,
      'backend/motores/central-entradas/services/CentralProcessamentoService'
    ));
    const CentralDocumentosRepository = require(path.join(
      this.rootDir,
      'backend/motores/central-entradas/repositories/CentralDocumentosRepository'
    ));
    const CentralHistoricoRepository = require(path.join(
      this.rootDir,
      'backend/motores/central-entradas/repositories/CentralHistoricoRepository'
    ));
    const DocumentoTransitionService = require(path.join(
      this.rootDir,
      'backend/motores/central-entradas/services/DocumentoTransitionService'
    ));
    const { DocumentoFiscalStatus } = require(path.join(
      this.rootDir,
      'backend/motores/central-entradas/core/DocumentoFiscalStatus'
    ));

    const documentosRepository = new CentralDocumentosRepository();
    const historicoRepository = new CentralHistoricoRepository();
    const transitionService = new DocumentoTransitionService({ documentosRepository, historicoRepository });
    const persistencia = new CentralDfePersistenciaService({
      documentosRepository, historicoRepository, transitionService
    });
    persistencia.existeCompraComChave = async () => false;

    const processamento = new CentralProcessamentoService({
      documentosRepository, historicoRepository, transitionService
    });

    await documentosRepository._obterSql().whenReady();

    const existente = await documentosRepository.buscarPorChave(CHAVE);
    if (existente) {
      // sqlite3 db.run NÃO retorna Promise — usar dbRun para aguardar o DELETE
      // antes do remover (FK: historico/revisao/eventos → documentos.id).
      await dbRun(
        this._ctx.db,
        'DELETE FROM central_entradas_revisao_itens WHERE documento_id = ?',
        [existente.id]
      ).catch(() => {});
      await dbRun(
        this._ctx.db,
        'DELETE FROM central_entradas_revisao_sessoes WHERE documento_id = ?',
        [existente.id]
      ).catch(() => {});
      await dbRun(
        this._ctx.db,
        'DELETE FROM central_entradas_historico WHERE documento_id = ?',
        [existente.id]
      );
      await dbRun(
        this._ctx.db,
        'DELETE FROM central_entradas_eventos WHERE documento_id = ?',
        [existente.id]
      ).catch(() => {});
      await dbRun(
        this._ctx.db,
        'DELETE FROM central_entradas_notificacoes WHERE documento_id = ?',
        [existente.id]
      ).catch(() => {});
      await documentosRepository.remover(existente.id);
    }

    const ler = (nome) => fsLocal.readFileSync(path.join(fixDir, nome), 'utf8');

    const r1 = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-res-nfe.xml'),
      nsu: 'RC4320-1',
      origem: 'release-cert'
    });
    if (!r1.documento?.id) throw new Error('RES_NFE não persistido');

    const r2 = await persistencia.persistirDocumentoDfe({
      xml: ler('rc64-proc-nfe.xml'),
      nsu: 'RC4320-2',
      origem: 'release-cert'
    });
    if (!r2.documento?.id) throw new Error('PROC_NFE não persistido');

    this._ctx.chaveNfe = CHAVE;
    const proc = await processamento.processar(r2.documento.id);
    if (!proc.sucesso) throw new Error(proc.mensagem || 'Processamento Central falhou');

    const doc = await documentosRepository.buscarPorId(r2.documento.id);
    const statusOk = [
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.EM_PROCESSAMENTO
    ].includes(doc.status);
    if (!statusOk) throw new Error(`Status inesperado: ${doc.status}`);

    this.metrics.incrementarSql(3);
    return `NF-e …${CHAVE.slice(-8)} | status=${doc.status}`;
  }

  /** ETAPA 5 — Financeiro */
  async etapaFinanceiro() {
    return this._executarModulo('financeiro', 'Financeiro', async () => {
      const { montarImportacaoFinanceiraNfe } = require(path.join(
        this.rootDir,
        'backend/services/compras/ImportacaoFinanceiraNfe'
      ));
      const fin = montarImportacaoFinanceiraNfe({
        pag: { detPag: { tPag: '15', vPag: '500.00', indPag: '1' } },
        cobr: { dup: { nDup: '001', dVenc: '2026-12-31', vDup: '500.00' } },
        icmsTot: { vProd: '500', vNF: '500', vIPI: '0' }
      });
      if (fin.parcelas_detalhe.length !== 1) throw new Error('Parcelas não extraídas do XML');
      if (fin.parcelas_detalhe[0].valor !== 500) throw new Error('Valor parcela divergente');

      const db = this._ctx.db;
      const rows = await dbAll(db, 'SELECT COUNT(*) AS n FROM financeiro LIMIT 1');
      this.metrics.incrementarSql(1);
      return `parser financeiro OK | parcela R$500 | registros financeiro=${rows[0]?.n || 0}`;
    });
  }

  /** ETAPA 6 — Estoque */
  async etapaEstoque() {
    return this._executarModulo('estoque', 'Estoque', async () => {
      const db = this._ctx.db;
      const codigo = `${this._prefix}-E`;
      await dbRun(db, `INSERT INTO produtos (codigo, nome, unidade, preco_compra, preco_venda,
        estoque_atual, saldo_fiscal, saldo_nao_fiscal, ativo)
        VALUES (?, 'Estoque Cert', 'UN', 5, 8, 10, 6, 4, 1)`, [codigo]);
      this.metrics.incrementarSql(1);

      const p = await dbGet(db, 'SELECT id, estoque_atual, saldo_fiscal, saldo_nao_fiscal FROM produtos WHERE codigo = ?', [codigo]);
      if (Number(p.estoque_atual) !== 10) throw new Error('Estoque inicial incorreto');
      if (Number(p.saldo_fiscal) !== 6) throw new Error('Saldo fiscal incorreto');

      await dbRun(db, 'UPDATE produtos SET estoque_atual = estoque_atual + 5, saldo_fiscal = saldo_fiscal + 3 WHERE id = ?', [p.id]);
      this.metrics.incrementarSql(1);

      const p2 = await dbGet(db, 'SELECT estoque_atual, saldo_fiscal FROM produtos WHERE id = ?', [p.id]);
      if (Number(p2.estoque_atual) !== 15) throw new Error('Entrada estoque não aplicada');

      await dbRun(db, 'DELETE FROM produtos WHERE id = ?', [p.id]);
      this.metrics.incrementarSql(1);

      return `fiscal=6+3 | total=15 UN`;
    });
  }

  /** ETAPA 9 — NFC-e */
  async etapaNfce() {
    return this._executarModulo('nfce', 'NFC-e', async () => {
      const { NOME_DEST_HOMOLOGACAO, resolverNomeDestinatarioNfe } = require(path.join(
        this.rootDir,
        'backend/services/fiscal/nfeRetornoAutorizacao'
      ));
      const nome = resolverNomeDestinatarioNfe(2, 'CLIENTE TESTE');
      if (nome !== NOME_DEST_HOMOLOGACAO) throw new Error('Regra homologação NFC-e/NFe inválida');

      const emissorPath = path.join(this.rootDir, 'backend/services/fiscal/emissor.js');
      if (!fs.existsSync(emissorPath)) throw new Error('emissor.js ausente');
      const src = fs.readFileSync(emissorPath, 'utf8');
      if (!/nfce|NFC/i.test(src)) throw new Error('Módulo emissor sem referência NFC-e');

      return 'homologação dest.xNome + módulo emissor presente';
    });
  }

  /** ETAPA 10 — NF-e */
  async etapaNfe() {
    return this._executarModulo('nfe', 'NF-e', async () => {
      const { parseRetornoAutorizacaoNfe } = require(path.join(
        this.rootDir,
        'backend/services/fiscal/nfeRetornoAutorizacao'
      ));
      const xml100 = `<?xml version="1.0"?><retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe"><cStat>104</cStat><protNFe><infProt><cStat>100</cStat><nProt>123</nProt><chNFe>35260112345678000199550010000000011000000001</chNFe></infProt></protNFe></retEnviNFe>`;
      const r = parseRetornoAutorizacaoNfe(xml100);
      if (r.status !== 'autorizada' && !r.sucesso) throw new Error('Parser autorização NF-e falhou');
      if (r.cStat !== '100') throw new Error(`cStat esperado 100, obtido ${r.cStat}`);
      return `autorização cStat=100 | protocolo=${r.nProt}`;
    });
  }

  /** ETAPA 11 — Relatórios */
  async etapaRelatorios() {
    return this._executarModulo('relatorios', 'Relatórios', async () => {
      const db = this._ctx.db;
      const compras = await dbGet(db, 'SELECT COUNT(*) AS n FROM compras');
      const fin = await dbGet(db, 'SELECT COUNT(*) AS n FROM financeiro');
      const prod = await dbGet(db, 'SELECT COUNT(*) AS n FROM produtos');
      this.metrics.incrementarSql(3);

      const rotas = ['backend/rotas/compras.js', 'backend/rotas/financeiro.js', 'backend/rotas/produtos.js'];
      rotas.forEach((rel) => {
        const src = fs.readFileSync(path.join(this.rootDir, rel), 'utf8');
        if (!/relatorio/i.test(src)) throw new Error(`Rota ${rel} sem endpoint de relatório`);
      });

      return `compras=${compras?.n || 0} fin=${fin?.n || 0} prod=${prod?.n || 0}`;
    });
  }

  /** ETAPA 12 — Performance */
  async etapaPerformance() {
    return this._executarModulo('performance', 'Performance', async () => {
      const s = this.metrics.resumo();
      if (s.tempoTotalMs <= 0) throw new Error('Métricas de tempo inválidas');
      return `${s.tempoTotalSeg}s | mem ${s.memoriaMaxMb}MB | sql=${s.quantidadeConsultasSql}`;
    });
  }

  async executar() {
    console.log(`\n${TAG} === Certificação Funcional de Release ===\n`);

    await this.etapaInicializacao();
    await this.etapaLogin();
    await this.etapaProdutos();
    await this.etapaComprasCentralMiip();
    await this.etapaFinanceiro();
    await this.etapaEstoque();
    await this.etapaNfce();
    await this.etapaNfe();
    await this.etapaRelatorios();
    await this.etapaPerformance();

    const modulosOk = Object.values(this.modulos).filter((m) => m.ok).length;
    const modulosTotal = Object.keys(this.modulos).length;
    const cobertura = modulosTotal ? Math.round((modulosOk / modulosTotal) * 100) : 0;
    const aprovado = modulosOk === modulosTotal && this.metrics.excecoes.length === 0;

    const relatorio = {
      schema: 'cds-release-certification/v1',
      sprint: 'RC4.32.0',
      status: aprovado ? 'APROVADA' : 'REPROVADA',
      geradoEm: new Date().toISOString(),
      ambiente: await this._obterAmbiente(),
      modulos: this.modulos,
      estatisticas: this.metrics.resumo(),
      metricas: this.metrics.exportar(),
      excecoes: this.metrics.excecoes,
      coberturaFuncional: cobertura
    };

    const paths = escreverRelatorios(this.rootDir, relatorio, this.opcoes);
    relatorio.relatorios = {
      json: path.relative(this.rootDir, paths.jsonPath),
      md: path.relative(this.rootDir, paths.mdPath),
      pdf: path.relative(this.rootDir, paths.pdfPath)
    };

    console.log(`\n${TAG} Status: ${relatorio.status}`);
    console.log(`${TAG} Cobertura: ${cobertura}% (${modulosOk}/${modulosTotal})`);
    console.log(`${TAG} Relatórios:`);
    console.log(`  - ${paths.jsonPath}`);
    console.log(`  - ${paths.mdPath}`);
    console.log(`  - ${paths.pdfPath}`);

    return relatorio;
  }
}

module.exports = { ReleaseCertificationService };
