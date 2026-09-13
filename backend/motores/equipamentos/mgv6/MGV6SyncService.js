/**
 * Sprint 14.15.1 / RC14.15.7 / RC14.15.11 / RC14.15.12 — MGV6SyncService
 * Orquestra: carregar → Integrar+PLU → TXITENS → validar → localizar EXE → (opcional) launch.
 * Carga física = MANUAL no MGV6. NÃO usa ToledoPrixIVDriver / TCP / SQL MGV6.
 */

'use strict';

const repo = require('./MGV6Repository');
const { exportarProdutos } = require('./MGV6Exporter');
const { launch } = require('./MGV6Launcher');
const { validarArquivoTxitensGerado } = require('./MGV6FileAudit');
const {
  validarConfiguracao,
  validarPastaExportacao,
  validarNomeArquivo,
  validarExecutavel
} = require('./MGV6Validator');
const identity = require('./MGV6IdentityResolver');
const { MGV6Error, CODES } = require('./MGV6Errors');
const modoEnvio = require('./MGV6ModoEnvio');

const AVISO_CARGA_MANUAL =
  'A carga da balança é realizada manualmente no MGV6.';
const AVISO_MGV6_NAO_ENCONTRADO =
  'Software MGV6 não encontrado neste computador.';

function getDb() {
  return require('../../../database');
}

function all(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

/**
 * @param {object} row
 * @returns {object}
 */
function mapRowProduto(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    descricao: row.nome,
    preco_venda: row.preco_venda,
    preco: row.preco_venda,
    unidade: row.unidade,
    produto_fracionado: row.produto_fracionado,
    integrar_balanca: row.integrar_balanca,
    ativo: row.ativo,
    plu: row.plu || null,
    codigo_balanca: row.codigo_balanca || null,
    codigo_barras: row.codigo_barras || null
  };
}

const SQL_BASE = `
  SELECT
    p.id,
    p.codigo,
    p.nome,
    p.preco_venda,
    p.unidade,
    p.codigo_barras,
    COALESCE(p.produto_fracionado, 0) AS produto_fracionado,
    p.integrar_balanca AS integrar_balanca,
    COALESCE(p.ativo, 1) AS ativo,
    (
      SELECT pi.codigo FROM produto_identificadores pi
      WHERE pi.produto_id = p.id
        AND pi.tipo = 'PLU'
        AND COALESCE(pi.ativo, 1) = 1
      ORDER BY COALESCE(pi.principal, 0) DESC, pi.id DESC
      LIMIT 1
    ) AS plu,
    (
      SELECT pi.codigo FROM produto_identificadores pi
      WHERE pi.produto_id = p.id
        AND UPPER(pi.tipo) IN ('BALANCA', 'CODIGO_BALANCA', 'SCALE')
        AND COALESCE(pi.ativo, 1) = 1
      ORDER BY COALESCE(pi.principal, 0) DESC, pi.id DESC
      LIMIT 1
    ) AS codigo_balanca
  FROM produtos p
`;

/**
 * @param {number[]} produtoIds
 * @returns {Promise<object[]>}
 */
async function carregarProdutosPorIds(produtoIds) {
  const ids = (Array.isArray(produtoIds) ? produtoIds : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await all(
    `${SQL_BASE} WHERE p.id IN (${placeholders}) ORDER BY p.id ASC`,
    ids
  );
  return rows.map(mapRowProduto);
}

/**
 * Elegíveis: ativos + (integrar_balanca=1 OU pesável sem flag explícita 0).
 * @returns {Promise<object[]>}
 */
async function carregarProdutosElegiveis() {
  const rows = await all(
    `${SQL_BASE}
     WHERE COALESCE(p.ativo, 1) = 1
       AND (
         p.integrar_balanca = 1
         OR (
           (p.integrar_balanca IS NULL)
           AND COALESCE(p.produto_fracionado, 0) = 1
         )
       )
     ORDER BY p.id ASC
     LIMIT 20000`
  );
  return rows.map(mapRowProduto).filter((p) => identity.produtoIntegraBalanca(p));
}

/**
 * Resolve PLU; por padrão falha se Integrar sem PLU; ignora não-integrados em lote.
 * Em export-all (`falharSemPlu: false`) omite os sem PLU e segue com os válidos.
 * @param {object[]} produtos
 * @param {{ exigirIntegrados?: boolean, falharSemPlu?: boolean }} [opcoes]
 * @returns {{ resolvidos: object[], pendentes: object[], excluidos: object[], avisoOmitidos: string|null }}
 */
function prepararProdutosComIdentidade(produtos, opcoes = {}) {
  const exigirIntegrados = opcoes.exigirIntegrados !== false;
  const falharSemPlu = opcoes.falharSemPlu !== false;
  const { resolvidos, pendentes, excluidos } = identity.resolverLista(produtos);

  if (excluidos.length) {
    // eslint-disable-next-line no-console
    console.log(
      `[MGV6] ${excluidos.length} produto(s) excluído(s) (Integrar com Balança = NÃO):`,
      excluidos.map((e) => e.details?.nome || e.details?.produtoId)
    );
  }

  let avisoOmitidos = null;
  if (pendentes.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[MGV6] ${pendentes.length} produto(s) sem PLU:`,
      pendentes.map((p) => ({
        produtoId: p.details?.produtoId,
        codigo: p.details?.codigo,
        plu: p.details?.plu,
        nome: p.details?.nome
      }))
    );
    if (falharSemPlu) {
      throw MGV6Error.fromCode(
        CODES.PRODUCT_PLU_REQUIRED,
        pendentes.length === 1
          ? pendentes[0].message
          : `${pendentes.length} produtos sem PLU (Integrar com Balança).`,
        {
          statusCode: 400,
          pendentes: pendentes.map((p) => p.details),
          quantidadePendentes: pendentes.length
        }
      );
    }
    const nomes = pendentes
      .map((p) => p.details?.nome || p.details?.produtoId || '?')
      .slice(0, 5);
    const extra = pendentes.length > 5 ? ` (+${pendentes.length - 5})` : '';
    avisoOmitidos =
      `${pendentes.length} produto(s) omitido(s) sem PLU: ${nomes.join(', ')}${extra}. ` +
      'Cadastre o PLU ou desmarque "Integrar com Balança".';
    // eslint-disable-next-line no-console
    console.warn(`[MGV6] ${avisoOmitidos}`);
  }

  if (!resolvidos.length) {
    if (pendentes.length && !falharSemPlu) {
      throw MGV6Error.fromCode(
        CODES.PRODUCT_PLU_REQUIRED,
        pendentes.length === 1
          ? pendentes[0].message
          : `${pendentes.length} produtos sem PLU (Integrar com Balança). Nenhum produto válido para exportar.`,
        {
          statusCode: 400,
          pendentes: pendentes.map((p) => p.details),
          quantidadePendentes: pendentes.length
        }
      );
    }
    if (exigirIntegrados && excluidos.length && !pendentes.length) {
      throw MGV6Error.fromCode(
        CODES.PRODUCT_NOT_INTEGRATED,
        'Nenhum produto marcado para Integrar com Balança.',
        { statusCode: 400, excluidos: excluidos.map((e) => e.details) }
      );
    }
    throw MGV6Error.fromCode(CODES.EMPTY_LIST, 'Nenhum produto elegível para exportação MGV6');
  }

  return { resolvidos, pendentes, excluidos, avisoOmitidos };
}

/**
 * @param {number} equipamentoId
 * @param {object[]} produtos
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
async function syncProdutos(equipamentoId, produtos, deps = {}) {
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'equipamentoId inválido');
  }

  const obterModo = typeof deps.obterModoEnvio === 'function'
    ? deps.obterModoEnvio
    : modoEnvio.obterModoEnvio;
  const modo = await obterModo(id);
  modoEnvio.assertPermitidoExportMgv6(modo);

  if (!deps.pularChecagemEquipamento) {
    const eq = await get(`SELECT id, nome FROM equipamentos WHERE id = ? LIMIT 1`, [id]);
    if (!eq) {
      throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'Equipamento não encontrado', { statusCode: 404 });
    }
  }

  const cfg = typeof deps.obterConfig === 'function'
    ? await deps.obterConfig(id)
    : await repo.obterConfig(id);
  validarConfiguracao(cfg, { requireEnabled: false, requireFolder: true });

  const lista = Array.isArray(produtos) ? produtos : [];
  if (!lista.length) {
    throw MGV6Error.fromCode(CODES.EMPTY_LIST, 'Nenhum produto para exportar');
  }

  const preparado = prepararProdutosComIdentidade(lista, {
    falharSemPlu: deps.falharSemPlu !== false
  });
  const comIdentidade = preparado.resolvidos;
  const avisoOmitidosSemPlu = preparado.avisoOmitidos;
  const omitidosSemPlu = (preparado.pendentes || []).map((p) => p.details).filter(Boolean);

  // eslint-disable-next-line no-console
  console.log(`[MGV6] Iniciando envio de ${comIdentidade.length} produto(s)...`);
  // eslint-disable-next-line no-console
  console.log('[MGV6] Modo: MGV6');
  for (const p of comIdentidade) {
    // eslint-disable-next-line no-console
    console.log(
      `[MGV6] Produto: ${p.nome || p.descricao}\n` +
      `Código interno: ${p.codigo || '-'}\n` +
      `PLU (código do item da balança): ${p.plu || p.codigoItem}\n` +
      `Integrar com balança: SIM\n` +
      `Origem: ${p.identidadeOrigem || 'PLU'}\n` +
      `Bloco TX (TT+Z+CCCCCC): ${String(p.codigoItem || p.plu).padStart(9, '0')}`
    );
  }
  // eslint-disable-next-line no-console
  console.log('[MGV6] Exportando TXITENS.TXT...');

  const exportFn = typeof deps.exportarProdutos === 'function' ? deps.exportarProdutos : exportarProdutos;
  const launchFn = typeof deps.launch === 'function' ? deps.launch : launch;

  let exportResult;
  try {
    exportResult = await exportFn(comIdentidade, cfg);
  } catch (err) {
    await repo.registrarExport({
      equipamento_id: id,
      arquivo: cfg.fileName,
      pasta: cfg.exportFolder,
      quantidade_produtos: comIdentidade.length,
      status: 'ERRO',
      erro: err.message,
      mgv6_iniciado: false
    });
    throw err;
  }

  // eslint-disable-next-line no-console
  console.log('[MGV6] ✔ Arquivo gerado');
  // eslint-disable-next-line no-console
  console.log(`[MGV6] ✔ Registro: ${exportResult.registroLength || 320} caracteres`);
  // eslint-disable-next-line no-console
  console.log(`[MGV6] Pasta: ${exportResult.caminho}`);

  const plusLista = comIdentidade.map((p) => p.plu || p.codigoItem);
  let audit;
  try {
    audit = validarArquivoTxitensGerado(exportResult.caminho, {
      quantidadeEsperada: comIdentidade.length,
      plusEsperados: plusLista,
      registroLength: exportResult.registroLength || 320
    });
  } catch (err) {
    await repo.registrarExport({
      equipamento_id: id,
      arquivo: exportResult.arquivo,
      pasta: exportResult.pasta,
      quantidade_produtos: comIdentidade.length,
      status: 'ERRO_VALIDACAO',
      tamanho_bytes: exportResult.tamanho_bytes,
      hash_arquivo: exportResult.hash_arquivo,
      erro: err.message,
      mgv6_iniciado: false
    });
    throw err;
  }

  for (const cccccc of audit.plusExportados) {
    // eslint-disable-next-line no-console
    console.log(`[MGV6] PLU exportado: ${cccccc}`);
  }
  // eslint-disable-next-line no-console
  console.log('[MGV6] ✔ TXITENS validado');

  let exePath = null;
  let exeEncontrado = false;
  let exeErro = null;
  try {
    exePath = validarExecutavel(cfg.mgv6Executable);
    exeEncontrado = true;
    // eslint-disable-next-line no-console
    console.log('[MGV6] ✔ MGV6 encontrado');
  } catch (err) {
    exeErro = err.message || String(err);
  }

  const autoLaunchEfetivo = deps.autoLaunch !== undefined
    ? Boolean(deps.autoLaunch)
    : Boolean(cfg.autoLaunch);

  let launchResult = {
    iniciado: false,
    motivo: autoLaunchEfetivo
      ? (exeEncontrado ? null : 'EXE_NAO_ENCONTRADO')
      : 'AGUARDANDO_USUARIO',
    pid: null,
    path: exePath
  };

  if (!autoLaunchEfetivo) {
    // eslint-disable-next-line no-console
    console.log('[MGV6] Aguardando decisão do usuário para iniciar MGV6...');
  } else if (!exeEncontrado) {
    // eslint-disable-next-line no-console
    console.log(`[MGV6] ⚠ ${AVISO_MGV6_NAO_ENCONTRADO}`);
    if (exeErro) {
      // eslint-disable-next-line no-console
      console.log(`[MGV6] Detalhe técnico: ${exeErro}`);
    }
  } else {
    try {
      // RC14.15.19 — ShellExecute (Electron); spawn não é o launcher primário
      launchResult = await launchFn({ ...cfg, autoLaunch: true, mgv6Executable: exePath }, {
        openPath: deps.openPath
      });
      if (launchResult.iniciado) {
        // eslint-disable-next-line no-console
        console.log('[MGV6] ✔ MGV6 aberto pelo Windows');
        // eslint-disable-next-line no-console
        console.log(`[MGV6] ℹ ${AVISO_CARGA_MANUAL}`);
      }
    } catch (err) {
      await repo.registrarExport({
        equipamento_id: id,
        arquivo: exportResult.arquivo,
        pasta: exportResult.pasta,
        quantidade_produtos: exportResult.quantidade,
        status: 'EXPORTADO_LAUNCH_ERRO',
        tamanho_bytes: exportResult.tamanho_bytes,
        hash_arquivo: exportResult.hash_arquivo,
        erro: err.message,
        mgv6_iniciado: false
      });
      // eslint-disable-next-line no-console
      console.log('[MGV6] ⚠ TXITENS validado, mas falha ao iniciar MGV6');
      // eslint-disable-next-line no-console
      console.log(`[MGV6] ℹ ${AVISO_CARGA_MANUAL}`);
      return {
        sucesso: true,
        arquivo: exportResult.arquivo,
        pasta: exportResult.pasta,
        caminho: exportResult.caminho,
        quantidade: exportResult.quantidade,
        registroLength: exportResult.registroLength || 320,
        status: 'EXPORTADO_LAUNCH_ERRO',
        hash_arquivo: exportResult.hash_arquivo,
        tamanho_bytes: exportResult.tamanho_bytes,
        plus: plusLista,
        plusResolvidos: plusLista,
        plusExportados: audit.plusExportados,
        blocos9: audit.blocos9,
        validacao: audit,
        mgv6: {
          iniciado: false,
          encontrado: exeEncontrado,
          path: exePath,
          erro: err.message
        },
        omitidosSemPlu,
        quantidadeOmitidosSemPlu: omitidosSemPlu.length,
        aviso: [
          `Arquivo validado. Falha ao iniciar MGV6 (${err.message}). ${AVISO_CARGA_MANUAL}`,
          avisoOmitidosSemPlu
        ].filter(Boolean).join(' '),
        orientacaoOperador: AVISO_CARGA_MANUAL,
        transmitidoBalanca: false
      };
    }
  }

  const histId = await repo.registrarExport({
    equipamento_id: id,
    arquivo: exportResult.arquivo,
    pasta: exportResult.pasta,
    quantidade_produtos: exportResult.quantidade,
    status: 'EXPORTADO',
    tamanho_bytes: exportResult.tamanho_bytes,
    hash_arquivo: exportResult.hash_arquivo,
    erro: exeEncontrado ? null : (exeErro || AVISO_MGV6_NAO_ENCONTRADO),
    mgv6_iniciado: Boolean(launchResult.iniciado),
    mgv6_pid: launchResult.pid
  });

  const avisoBase = exeEncontrado ? AVISO_CARGA_MANUAL : AVISO_MGV6_NAO_ENCONTRADO;

  return {
    sucesso: true,
    arquivo: exportResult.arquivo,
    pasta: exportResult.pasta,
    caminho: exportResult.caminho,
    quantidade: exportResult.quantidade,
    registroLength: exportResult.registroLength || 320,
    registros_count: exportResult.registros_count || exportResult.quantidade,
    layout: exportResult.layout || 'MGV6-REAL-CLIENT-V1',
    status: 'EXPORTADO',
    hash_arquivo: exportResult.hash_arquivo,
    tamanho_bytes: exportResult.tamanho_bytes,
    historicoId: histId,
    plus: plusLista,
    plusResolvidos: plusLista,
    plusExportados: audit.plusExportados,
    blocos9: audit.blocos9,
    validacao: {
      ok: true,
      registros: audit.registros,
      registroLength: audit.registroLength,
      encoding: audit.encoding,
      lineEnding: audit.lineEnding
    },
    /** @deprecated alias de plus */
    codigosMgv6: exportResult.codigosItem || exportResult.codigosMgv6 || plusLista,
    mgv6: {
      iniciado: Boolean(launchResult.iniciado),
      encontrado: exeEncontrado,
      pid: launchResult.pid || null,
      path: exePath || launchResult.path || null,
      motivo: launchResult.motivo || null,
      erro: exeEncontrado ? null : (exeErro || AVISO_MGV6_NAO_ENCONTRADO),
      aguardandoUsuario: !autoLaunchEfetivo && exeEncontrado
    },
    omitidosSemPlu,
    quantidadeOmitidosSemPlu: omitidosSemPlu.length,
    aviso: [avisoBase, avisoOmitidosSemPlu].filter(Boolean).join(' '),
    orientacaoOperador: avisoBase,
    transmitidoBalanca: false
  };
}

/**
 * RC14.15.12 — inicia MGV6.exe após confirmação do usuário (sem carga/TCP/SQL).
 * @param {number} equipamentoId
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
async function iniciarMgv6(equipamentoId, deps = {}) {
  const id = Number(equipamentoId);
  if (!Number.isFinite(id) || id <= 0) {
    throw MGV6Error.fromCode(CODES.EQUIPAMENTO_INVALID, 'equipamentoId inválido');
  }

  const cfg = typeof deps.obterConfig === 'function'
    ? await deps.obterConfig(id)
    : await repo.obterConfig(id);

  const launchFn = typeof deps.launch === 'function' ? deps.launch : launch;
  const exeAbs = validarExecutavel(cfg.mgv6Executable);
  // eslint-disable-next-line no-console
  console.log('[MGV6] ✔ MGV6 encontrado');
  // eslint-disable-next-line no-console
  console.log('[MGV6] Iniciando MGV6...');

  let launchResult;
  try {
    launchResult = await launchFn(
      { ...cfg, autoLaunch: true, mgv6Executable: exeAbs },
      { openPath: deps.openPath, spawn: deps.spawn }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`[MGV6] ❌ Não foi possível abrir o MGV6: ${err.message}`);
    if (err.code || err.details?.code) {
      // eslint-disable-next-line no-console
      console.log(`[MGV6] Código: ${err.code || err.details?.code}`);
    }
    const falha = new Error(err.message || 'Não foi possível abrir o MGV6');
    falha.statusCode = err.statusCode || 500;
    falha.code = err.code || CODES.LAUNCH_FAILED;
    falha.codigo = falha.code;
    falha.details = {
      iniciado: false,
      pid: null,
      path: exeAbs,
      motivo: err.message,
      metodo: err.details?.metodo || 'shell-execute',
      ...(err.details || {})
    };
    throw falha;
  }

  // RC14.15.19 — ShellExecute: sucesso = Windows aceitou a abertura (sem exigir PID)
  const ok = Boolean(launchResult.iniciado || launchResult.sucesso);

  if (!ok) {
    // eslint-disable-next-line no-console
    console.log('[MGV6] ❌ Não foi possível abrir o MGV6');
    return {
      sucesso: false,
      iniciado: false,
      pid: null,
      path: launchResult.path || exeAbs,
      cwd: launchResult.cwd || null,
      metodo: launchResult.metodo || 'shell-execute',
      motivo: launchResult.motivo || 'Falha ao abrir MGV6',
      aviso: AVISO_CARGA_MANUAL,
      transmitidoBalanca: false
    };
  }

  // eslint-disable-next-line no-console
  console.log('[MGV6] ✔ MGV6 aberto pelo Windows');
  // eslint-disable-next-line no-console
  console.log(`[MGV6] ℹ ${AVISO_CARGA_MANUAL}`);

  return {
    sucesso: true,
    iniciado: true,
    metodo: launchResult.metodo || 'shell-execute',
    pid: null,
    path: launchResult.path || exeAbs,
    cwd: launchResult.cwd || null,
    motivo: null,
    aviso: AVISO_CARGA_MANUAL,
    transmitidoBalanca: false
  };
}

async function exportarPorIds(equipamentoId, produtoIds, deps = {}) {
  const produtos = await carregarProdutosPorIds(produtoIds);
  if (!produtos.length) {
    throw MGV6Error.fromCode(CODES.EMPTY_LIST, 'Nenhum produto encontrado para os IDs informados', {
      statusCode: 404
    });
  }
  return syncProdutos(equipamentoId, produtos, deps);
}

async function exportarTodos(equipamentoId, deps = {}) {
  const produtos = await carregarProdutosElegiveis();
  if (!produtos.length) {
    throw MGV6Error.fromCode(
      CODES.EMPTY_LIST,
      'Nenhum produto elegível (Integrar com Balança) para exportação MGV6'
    );
  }
  // Catálogo completo: omite itens sem PLU em vez de abortar o arquivo inteiro.
  return syncProdutos(equipamentoId, produtos, { ...deps, falharSemPlu: false });
}

async function testarPasta(equipamentoId, override = {}) {
  const cfg = await repo.obterConfig(equipamentoId);
  const folder = override.exportFolder != null ? String(override.exportFolder).trim() : cfg.exportFolder;
  const fileName = override.fileName != null ? String(override.fileName).trim() : cfg.fileName;
  const abs = validarPastaExportacao(folder, { requireWritable: true });
  const safeName = validarNomeArquivo(fileName || 'TXITENS.TXT');
  return {
    sucesso: true,
    pasta: abs,
    arquivo: safeName,
    gravavel: true
  };
}

module.exports = {
  syncProdutos,
  exportarPorIds,
  exportarTodos,
  iniciarMgv6,
  carregarProdutosPorIds,
  carregarProdutosElegiveis,
  prepararProdutosComIdentidade,
  testarPasta,
  AVISO_CARGA_MANUAL,
  AVISO_MGV6_NAO_ENCONTRADO
};
