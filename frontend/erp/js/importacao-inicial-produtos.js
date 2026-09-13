/**
 * Configurações → Avançadas → Implantação → Importação Inicial de Produtos (V1.0.18)
 * Modos: CADASTRO_INICIAL | ATUALIZAR_QUANTIDADES + modo_fiscal_importacao
 */
'use strict';

const ImportacaoEstadoApi = (typeof window !== 'undefined' && window.ImportacaoInicialEstado)
  ? window.ImportacaoInicialEstado
  : null;

const MODO_CADASTRO = 'CADASTRO_INICIAL';
const MODO_QUANTIDADES = 'ATUALIZAR_QUANTIDADES';
const MODO_FISCAL = 'FISCAL';
const MODO_NAO_FISCAL = 'NAO_FISCAL';

function criarEstadoVazioImportacao(modo) {
  if (ImportacaoEstadoApi) return ImportacaoEstadoApi.criarEstadoVazioImportacao(modo);
  return {
    modo: modo || MODO_CADASTRO,
    modo_fiscal_importacao: null,
    arquivoNome: null,
    sessaoId: null,
    resumo: null,
    linhas: [],
    resultado: null,
    politica_pendentes: null,
    pode_importar: false
  };
}

function rotuloModoFiscalImportacaoUi(modoFiscal) {
  if (ImportacaoEstadoApi?.rotuloModoFiscal) {
    return ImportacaoEstadoApi.rotuloModoFiscal(modoFiscal);
  }
  return modoFiscal === MODO_NAO_FISCAL
    ? 'NÃO FISCAL — SEM NF'
    : 'FISCAL — COM NF';
}

function obterModoFiscalSelecionadoUi() {
  const marcado = document.querySelector('input[name="modoFiscalImportacao"]:checked');
  return marcado ? String(marcado.value || '').toUpperCase() : null;
}

function resetarEstadoImportacaoInicial(estadoAnterior) {
  if (ImportacaoEstadoApi) return ImportacaoEstadoApi.resetarEstadoImportacaoInicial(estadoAnterior);
  return {
    estado: criarEstadoVazioImportacao(estadoAnterior?.modo || MODO_CADASTRO),
    sessaoAnterior: estadoAnterior?.sessaoId || null
  };
}

function trocarModoImportacao(estadoAnterior, novoModo) {
  if (ImportacaoEstadoApi) return ImportacaoEstadoApi.trocarModoImportacao(estadoAnterior, novoModo);
  return {
    estado: criarEstadoVazioImportacao(novoModo),
    sessaoAnterior: estadoAnterior?.sessaoId || null,
    modoAnterior: estadoAnterior?.modo || MODO_CADASTRO
  };
}

let importacaoInicialState = criarEstadoVazioImportacao();

function isModoQuantidades() {
  return importacaoInicialState.modo === MODO_QUANTIDADES;
}

function escapeHtmlImport(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function headersImportacao() {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function moedaImport(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  if (typeof formatCurrency === 'function') return formatCurrency(n);
  return `R$ ${n.toFixed(4).replace('.', ',')}`;
}

function moedaImport2(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function htmlCampoMoedaExistente(prev, tipo) {
  if (!prev) return '—';
  const altera = tipo === 'custo' ? prev.alterar_custo === true : prev.alterar_preco === true;
  const exibicao = tipo === 'custo' ? prev.custo_exibicao : prev.preco_exibicao;
  const atual = tipo === 'custo' ? prev.custo_atual : prev.preco_atual;
  const novo = tipo === 'custo' ? prev.novo_custo : prev.novo_preco;
  const texto = exibicao
    || (altera ? `${moedaImport2(atual)} → ${moedaImport2(novo)}` : moedaImport2(atual));
  const hint = altera ? '' : '<div class="text-muted small">sem alteração</div>';
  return `${escapeHtmlImport(texto)}${hint}`;
}

function badgeStatusImport(status) {
  const mapa = {
    PRONTO: '<span class="badge bg-success">NOVO</span>',
    OK: '<span class="badge bg-success">OK</span>',
    ATENCAO: '<span class="badge bg-warning text-dark">ATENÇÃO</span>',
    ERRO: '<span class="badge bg-danger">ERRO</span>',
    CODIGO_DUPLICADO_ARQUIVO: '<span class="badge bg-danger">CÓDIGO DUPLICADO NO ARQUIVO</span>',
    EXISTENTE: '<span class="badge bg-info text-dark">EXISTENTE</span>',
    EXISTENTE_APRESENTACAO_NOVA: '<span class="badge bg-primary">EXISTENTE — APRESENTAÇÃO NOVA</span>',
    EXISTENTE_ATUALIZAR: '<span class="badge bg-warning text-dark">EXISTENTE — ATUALIZAR</span>',
    PENDENTE_CLASSIFICACAO: '<span class="badge bg-warning text-dark">PENDENTE</span>',
    CATEGORIA_NAO_ENCONTRADA: '<span class="badge bg-danger">CATEGORIA NÃO ENCONTRADA</span>',
    SUBCATEGORIA_INCOMPATIVEL: '<span class="badge bg-danger">SUBCATEGORIA INCOMPATÍVEL</span>',
    NAO_ENCONTRADO: '<span class="badge bg-danger">PRODUTO NÃO ENCONTRADO</span>',
    APRESENTACAO_NAO_ENCONTRADA: '<span class="badge bg-danger">APRESENTAÇÃO NÃO ENCONTRADA</span>',
    JA_PROCESSADO: '<span class="badge bg-secondary">JÁ PROCESSADO</span>'
  };
  return mapa[status] || `<span class="badge bg-secondary">${escapeHtmlImport(status)}</span>`;
}

function rotuloClassificacaoImport(l) {
  const cl = l && l.classificacao ? l.classificacao : null;
  if (l && (l.status === 'PENDENTE_CLASSIFICACAO' || (cl && cl.status === 'PENDENTE_CLASSIFICACAO'))) {
    return 'REVISÃO NECESSÁRIA';
  }
  if (!cl) return '—';
  if (cl.origem === 'BANCO') return 'BANCO';
  if (cl.origem === 'XLSX') return `XLSX — ${cl.confianca || ''}`.trim();
  if (cl.origem === 'AUTOMATICA') return `AUTOMÁTICA — ${cl.confianca || ''}`.trim();
  if (cl.origem === 'SUGESTAO_IMPORTADOR') return `SUGESTÃO DO IMPORTADOR — ${cl.confianca || ''}`.trim();
  if (cl.origem === 'NOVA_CATEGORIA') return `NOVA CATEGORIA — SERÁ CRIADA — ${cl.confianca || ''}`.trim();
  if (cl.origem === 'NOVA_SUBCATEGORIA') return `NOVA SUBCATEGORIA — SERÁ CRIADA — ${cl.confianca || ''}`.trim();
  return cl.status || '—';
}

function rotuloOrigemClassificacao(origem) {
  if (origem === 'SUGESTAO_IMPORTADOR') return 'SUGESTÃO DO IMPORTADOR';
  if (origem === 'AUTOMATICA') return 'AUTOMÁTICA';
  if (origem === 'NOVA_CATEGORIA') return 'NOVA CATEGORIA — SERÁ CRIADA';
  if (origem === 'NOVA_SUBCATEGORIA') return 'NOVA SUBCATEGORIA — SERÁ CRIADA';
  return origem || '—';
}

function textoCategoriaSugeridaDetalhe(cl) {
  if (!cl || cl.origem === 'BANCO') return '—';
  const nome = cl.categoria_sugerida_nome || cl.categoria_nome || '';
  if (!nome) return cl.criar_categoria ? 'NOVA → será criada' : '—';
  if (cl.criar_categoria) return `${nome} — NOVA → será criada`;
  return nome;
}

function textoSubcategoriaSugeridaDetalhe(cl) {
  if (!cl || (cl.origem === 'BANCO' && !cl.alterar_subcategoria && !cl.criar_subcategoria)) return '—';
  const nome = cl.subcategoria_sugerida_nome || cl.subcategoria_nome || '';
  if (!nome) return cl.criar_subcategoria ? 'NOVA → será criada' : '—';
  if (cl.criar_subcategoria) return `${nome} — NOVA → será criada`;
  return nome;
}

function nomeCategoriaPreview(l) {
  const cl = (l && l.classificacao) || {};
  if (cl.alterar_categoria && cl.categoria_sugerida_nome) return cl.categoria_sugerida_nome;
  return cl.categoria_nome || cl.categoria_atual_nome || (l.produto && l.produto.categoria) || '—';
}

function nomeSubcategoriaPreview(l) {
  const cl = (l && l.classificacao) || {};
  if (cl.alterar_subcategoria && cl.subcategoria_sugerida_nome) return cl.subcategoria_sugerida_nome;
  return cl.subcategoria_nome || cl.subcategoria_atual_nome || (l.produto && l.produto.subcategoria) || '—';
}

function textoBotaoAcaoPrincipal(disabledHint) {
  if (isModoQuantidades()) {
    return disabledHint ? 'Registrar Quantidades' : 'Registrar Quantidades';
  }
  return disabledHint ? 'Importar produtos' : 'Importar produtos';
}

const POLITICA_IGNORAR = 'IGNORAR';
const POLITICA_IMPORTAR_SEM = 'IMPORTAR_SEM_CLASSIFICACAO';

function obterPoliticaPendentesUi() {
  const marcado = document.querySelector('input[name="politicaPendentesImportacao"]:checked');
  return marcado ? String(marcado.value || '').toUpperCase() : null;
}

function linhaPendenteClassificacaoUi(l) {
  if (!l) return false;
  if (l.status === 'PENDENTE_CLASSIFICACAO') return true;
  const cl = l.classificacao || {};
  return l.status === 'ATENCAO' && cl.status === 'PENDENTE_CLASSIFICACAO';
}

function classificacaoAtualPreview(l) {
  const cl = (l && l.classificacao) || {};
  const cat = cl.categoria_atual_nome || '';
  const sub = cl.subcategoria_atual_nome || '';
  if (!cat && !sub) return '—';
  return sub ? `${cat} / ${sub}` : cat;
}

function classificacaoSugeridaPreview(l) {
  const cl = (l && l.classificacao) || {};
  if (linhaPendenteClassificacaoUi(l)) return '—';
  const cat = cl.categoria_sugerida_nome || (cl.alterar_categoria ? cl.categoria_nome : '') || '';
  const sub = cl.subcategoria_sugerida_nome || (cl.alterar_subcategoria ? cl.subcategoria_nome : '') || '';
  if (cl.alterar_categoria || cl.alterar_subcategoria || cl.origem === 'SUGESTAO_IMPORTADOR'
    || cl.origem === 'AUTOMATICA' || cl.origem === 'NOVA_CATEGORIA' || cl.origem === 'NOVA_SUBCATEGORIA') {
    if (!cat && !sub) return '—';
    return sub ? `${cat} / ${sub}` : cat;
  }
  return '—';
}

function acaoLinhaImportacao(l, politica) {
  if (!l) return '—';
  if (l.status === 'ERRO' || l.status === 'CODIGO_DUPLICADO_ARQUIVO'
    || l.status === 'CATEGORIA_NAO_ENCONTRADA' || l.status === 'SUBCATEGORIA_INCOMPATIVEL') {
    return 'ERRO — NÃO IMPORTAR';
  }
  if (linhaPendenteClassificacaoUi(l)) {
    if (politica === POLITICA_IGNORAR) return 'NÃO SERÁ IMPORTADO';
    if (politica === POLITICA_IMPORTAR_SEM) return 'IMPORTAR SEM CLASSIFICAÇÃO';
    return 'PENDENTE';
  }
  const cl = l.classificacao || {};
  if (cl.alterar_categoria || cl.alterar_subcategoria) return 'SERÁ CLASSIFICADO';
  if (cl.origem === 'BANCO' || cl.status === 'PRESERVADO') return 'PRESERVAR CLASSIFICAÇÃO';
  if (l.status === 'PRONTO') return 'SERÁ CLASSIFICADO';
  if (l.status === 'EXISTENTE') return 'SEM ALTERAÇÃO';
  return 'SERÁ IMPORTADO';
}

function aplicarLimpezaUiImportacaoInicial() {
  const input = document.getElementById('arquivoImportacaoProdutos');
  if (input) input.value = '';

  $('input[name="modoFiscalImportacao"]').prop('checked', false);
  $('#avisoModoFiscalImportacao').addClass('d-none').text('');

  $('#btnValidarImportacaoProdutos')
    .prop('disabled', true)
    .html('<i class="fas fa-check-double"></i> Validar Importação');

  renderResumoVazioImportacao();
  renderCabecalhoPreviewImportacao();
  $('#cardPreviewImportacao').removeClass('d-none');
  const cols = isModoQuantidades() ? 8 : 17;
  $('#tbodyPreviewImportacao').html(
    `<tr><td colspan="${cols}" class="text-center text-muted py-4">Nenhuma linha</td></tr>`
  );
  $('#btnImportarProdutosFinal')
    .prop('disabled', true)
    .text(textoBotaoAcaoPrincipal(true));

  $('#cardResultadoImportacao').addClass('d-none');
  $('#corpoResultadoImportacao').empty();
  $('#blocoPoliticaPendentes').addClass('d-none');
  $('input[name="politicaPendentesImportacao"]').prop('checked', false);
  atualizarTextosModoImportacao();
}

function renderResumoVazioImportacao() {
  if (isModoQuantidades()) {
    $('#resumoValidacaoImportacao').removeClass('d-none').html(`
      <div class="alert alert-light border mb-0">
        <div><strong>Arquivo:</strong> Nenhum arquivo selecionado</div>
        <div class="row g-2 mt-2">
          <div class="col-md-3"><strong>Produtos no arquivo:</strong> 0</div>
          <div class="col-md-3"><strong>Encontrados:</strong> 0</div>
          <div class="col-md-3"><strong>Não encontrados:</strong> 0</div>
          <div class="col-md-3"><strong>Quantidade a lançar:</strong> 0 UN</div>
        </div>
      </div>
    `);
    return;
  }
  $('#resumoValidacaoImportacao').removeClass('d-none').html(`
    <div class="alert alert-light border mb-0">
      <div><strong>Arquivo:</strong> Nenhum arquivo selecionado</div>
      <div class="row g-2 mt-2">
        <div class="col-md-3"><strong>Produtos encontrados:</strong> 0</div>
        <div class="col-md-3"><strong>Produtos válidos:</strong> 0</div>
        <div class="col-md-3"><strong>Com erro:</strong> 0</div>
        <div class="col-md-3"><strong>Possíveis duplicados:</strong> 0</div>
        <div class="col-md-3"><strong>Estoque inicial:</strong> 0 UN</div>
      </div>
    </div>
  `);
}

function renderCabecalhoPreviewImportacao() {
  const $thead = $('#theadPreviewImportacao');
  if (!$thead.length) return;
  if (isModoQuantidades()) {
    $thead.html(`
      <tr>
        <th>Status</th>
        <th>Código</th>
        <th>Produto</th>
        <th>Qtd origem</th>
        <th>Conversão</th>
        <th>Quantidade a lançar</th>
        <th>Custo</th>
        <th>Venda</th>
      </tr>
    `);
  } else {
    $thead.html(`
      <tr>
        <th>Status</th>
        <th>Produto</th>
        <th>Marca</th>
        <th>Unidade</th>
        <th>Custo</th>
        <th>Markup</th>
        <th>Venda</th>
        <th>Apresentação</th>
        <th>Controla</th>
        <th>Est. Fiscal</th>
        <th>Est. Não Fiscal</th>
        <th>Est. Total</th>
        <th>NCM</th>
        <th>CFOP</th>
        <th>CSOSN</th>
        <th>Categoria</th>
        <th>Subcategoria</th>
        <th>Classificação</th>
        <th>Ação</th>
        <th>item_fiscal</th>
        <th></th>
      </tr>
    `);
  }
}

function atualizarTextosModoImportacao() {
  const qtd = isModoQuantidades();
  $('#badgeModoImportacao').text(qtd ? 'ATUALIZAÇÃO DE QUANTIDADES' : 'CADASTRO INICIAL');
  $('#subtituloImportacaoProdutos').text(
    qtd
      ? 'Atualize somente as quantidades dos produtos já cadastrados.'
      : 'Importe uma base de produtos para implantação inicial do cliente. Formato V1: XLSX. Importa produtos e registra o estoque inicial informado no arquivo.'
  );
  $('#avisoModoQuantidades').toggleClass('d-none', !qtd);
  atualizarVisibilidadeTratamentoFiscal();
  $('#hintArquivoImportacao').text(
    qtd
      ? 'Ex.: CDS_Atualizacao_Quantidades_PRIMEIRA_IMPORTACAO.xlsx (aba QUANTIDADES)'
      : 'Ex.: CDS_Importacao_Produtos_PRODUTOS_FISCAL.xlsx'
  );

  $('#btnModoCadastroInicial')
    .toggleClass('btn-primary', !qtd)
    .toggleClass('btn-outline-primary', qtd);
  $('#btnModoAtualizarQuantidades')
    .toggleClass('btn-primary', qtd)
    .toggleClass('btn-outline-primary', !qtd);

  $('#btnImportarProdutosFinal').text(textoBotaoAcaoPrincipal(true));
}

function confirmarLimparImportacaoInicial() {
  const temDados = !!(
    importacaoInicialState.arquivoNome
    || importacaoInicialState.sessaoId
    || (importacaoInicialState.linhas || []).length
    || importacaoInicialState.resultado
    || (document.getElementById('arquivoImportacaoProdutos')?.files?.length)
  );

  if (!temDados) {
    const modo = importacaoInicialState.modo;
    importacaoInicialState = criarEstadoVazioImportacao(modo);
    aplicarLimpezaUiImportacaoInicial();
    showNotification('Importação limpa. Você pode selecionar um novo arquivo.', 'info');
    return;
  }

  $('#modal-container').html(`
    <div class="modal fade" id="modalLimparImportacao" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Limpar importação?</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>
          <div class="modal-body">
            <p class="mb-2">Os dados carregados nesta tela serão removidos.</p>
            <p class="mb-0">Nenhum produto já cadastrado no banco será excluído.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-danger" id="btnConfirmarLimparImportacao">
              <i class="fas fa-eraser"></i> Limpar
            </button>
          </div>
        </div>
      </div>
    </div>
  `);

  const modalEl = document.getElementById('modalLimparImportacao');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  $('#btnConfirmarLimparImportacao').off('click').on('click', () => {
    modal.hide();
    executarLimpezaImportacaoInicial();
  });
}

function executarLimpezaImportacaoInicial() {
  const { estado } = resetarEstadoImportacaoInicial(importacaoInicialState);
  importacaoInicialState = estado;
  aplicarLimpezaUiImportacaoInicial();
  showNotification('Importação limpa. Você pode selecionar um novo arquivo.', 'success');
}

function solicitarTrocaModoImportacao(novoModo) {
  if (importacaoInicialState.modo === novoModo) return;

  const temDados = !!(
    importacaoInicialState.arquivoNome
    || importacaoInicialState.sessaoId
    || (importacaoInicialState.linhas || []).length
    || importacaoInicialState.resultado
    || (document.getElementById('arquivoImportacaoProdutos')?.files?.length)
  );

  const aplicarTroca = () => {
    const { estado } = trocarModoImportacao(importacaoInicialState, novoModo);
    importacaoInicialState = estado;
    aplicarLimpezaUiImportacaoInicial();
    atualizarVisibilidadeTratamentoFiscal();
    showNotification(
      novoModo === MODO_QUANTIDADES
        ? 'Modo: Atualizar Quantidades'
        : 'Modo: Cadastro Inicial',
      'info'
    );
  };

  if (!temDados) {
    aplicarTroca();
    return;
  }

  $('#modal-container').html(`
    <div class="modal fade" id="modalTrocarModoImportacao" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Trocar o modo de importação?</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="mb-0">Os dados carregados atualmente serão descartados.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-primary" id="btnConfirmarTrocarModo">Trocar modo</button>
          </div>
        </div>
      </div>
    </div>
  `);
  const modalEl = document.getElementById('modalTrocarModoImportacao');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  $('#btnConfirmarTrocarModo').off('click').on('click', () => {
    modal.hide();
    aplicarTroca();
  });
}

function loadImportacaoInicialProdutos() {
  importacaoInicialState = criarEstadoVazioImportacao(MODO_CADASTRO);

  $('#page-content').html(`
    <div class="card mb-3 border-0 shadow-sm">
      <div class="card-body py-3">
        <nav aria-label="breadcrumb" class="mb-2">
          <ol class="breadcrumb mb-0 small">
            <li class="breadcrumb-item"><a href="#" onclick="loadPage('configuracoes'); return false;">Configurações</a></li>
            <li class="breadcrumb-item"><a href="#" onclick="loadPage('configuracoes-avancadas'); return false;">Avançadas</a></li>
            <li class="breadcrumb-item">Implantação</li>
            <li class="breadcrumb-item active" aria-current="page">Importação Inicial de Produtos</li>
          </ol>
        </nav>
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <h4 class="mb-0"><i class="fas fa-file-excel text-success"></i> Importação Inicial de Produtos</h4>
          <span class="badge bg-dark" id="badgeModoImportacao">CADASTRO INICIAL</span>
        </div>
        <p class="text-muted small mb-3" id="subtituloImportacaoProdutos">
          Importe uma base de produtos para implantação inicial do cliente. Formato V1: XLSX. Importa produtos e registra o estoque inicial informado no arquivo.
        </p>
        <div class="btn-group" role="group" aria-label="Modo de importação">
          <button type="button" class="btn btn-primary" id="btnModoCadastroInicial">Cadastro Inicial</button>
          <button type="button" class="btn btn-outline-primary" id="btnModoAtualizarQuantidades">Atualizar Quantidades</button>
        </div>
      </div>
    </div>

    <div class="alert alert-warning border d-none" id="avisoModoQuantidades" role="alert">
      <strong>Atenção:</strong> Este modo NÃO cadastra produtos e NÃO altera dados cadastrais.
      Ele somente registra as quantidades dos produtos já existentes.
    </div>

    <div class="card mb-3" id="cardTratamentoFiscalImportacao">
      <div class="card-header"><i class="fas fa-balance-scale"></i> Estoque fiscal na planilha (V2)</div>
      <div class="card-body">
        <p class="text-muted small mb-2">
          A distribuição do estoque vem das colunas <strong>Estoque Fiscal</strong> e
          <strong>Estoque Não Fiscal</strong> de cada linha. Não é obrigatório escolher Fiscal/Não Fiscal globalmente.
        </p>
        <p class="text-muted small mb-3">
          Opção legado (somente produtos NOVOS sem colunas F/NF): se informar abaixo, o estoque legado (Qtd. Origem × Conversão) vai para o bucket escolhido.
        </p>
        <div class="form-check mb-2">
          <input class="form-check-input" type="radio" name="modoFiscalImportacao" id="modoFiscalImportacaoFiscal" value="FISCAL">
          <label class="form-check-label" for="modoFiscalImportacaoFiscal">Legado: FISCAL — COM NF</label>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" name="modoFiscalImportacao" id="modoFiscalImportacaoNaoFiscal" value="NAO_FISCAL">
          <label class="form-check-label" for="modoFiscalImportacaoNaoFiscal">Legado: NÃO FISCAL — SEM NF</label>
        </div>
        <div class="text-muted small mt-2" id="avisoModoFiscalImportacao"></div>
      </div>
    </div>

    <div class="card mb-3">
      <div class="card-header"><i class="fas fa-upload"></i> 1. Selecionar arquivo</div>
      <div class="card-body">
        <div class="row g-3 align-items-end">
          <div class="col-md-6">
            <label class="form-label fw-semibold" for="arquivoImportacaoProdutos">Arquivo XLSX</label>
            <input type="file" class="form-control" id="arquivoImportacaoProdutos" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
            <small class="text-muted" id="hintArquivoImportacao">Ex.: CDS_Importacao_Produtos_PRODUTOS_FISCAL.xlsx</small>
          </div>
          <div class="col-md-3">
            <button type="button" class="btn btn-primary w-100" id="btnValidarImportacaoProdutos" disabled>
              <i class="fas fa-check-double"></i> Validar Importação
            </button>
          </div>
          <div class="col-md-3">
            <button type="button" class="btn btn-outline-secondary w-100" id="btnLimparImportacaoProdutos">
              <i class="fas fa-eraser"></i> Limpar Importação
            </button>
          </div>
        </div>
        <div id="resumoValidacaoImportacao" class="mt-3 d-none"></div>
      </div>
    </div>

    <div class="card mb-3 d-none" id="cardPreviewImportacao">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span><i class="fas fa-table"></i> 2. Pré-visualização</span>
        <button type="button" class="btn btn-success btn-sm" id="btnImportarProdutosFinal" disabled>
          Importar produtos
        </button>
      </div>
      <div id="blocoPoliticaPendentes" class="d-none border-bottom bg-light p-3">
        <h6 class="mb-2">PRODUTOS SEM CLASSIFICAÇÃO</h6>
        <p class="mb-2" id="textoPoliticaPendentes">Nenhum produto pendente.</p>
        <p class="mb-2 small text-muted">O que deseja fazer?</p>
        <div class="form-check mb-2">
          <input class="form-check-input" type="radio" name="politicaPendentesImportacao" id="politicaPendentesIgnorar" value="IGNORAR">
          <label class="form-check-label" for="politicaPendentesIgnorar">
            <strong>Não importar esses produtos</strong><br>
            <span class="text-muted small">Importar somente os produtos classificados.</span>
          </label>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" name="politicaPendentesImportacao" id="politicaPendentesImportar" value="IMPORTAR_SEM_CLASSIFICACAO">
          <label class="form-check-label" for="politicaPendentesImportar">
            <strong>Importar mesmo assim</strong><br>
            <span class="text-muted small">Os produtos serão importados sem categoria/subcategoria e poderão ser classificados posteriormente no cadastro.</span>
          </label>
        </div>
      </div>
      <div class="card-body p-0">
        <div class="table-responsive" style="max-height: 420px;">
          <table class="table table-sm table-hover mb-0 align-middle">
            <thead class="table-light sticky-top" id="theadPreviewImportacao">
              <tr>
                <th>Status</th>
                <th>Produto</th>
                <th>Marca</th>
                <th>Unidade</th>
                <th>Custo</th>
                <th>Markup</th>
                <th>Venda</th>
                <th>Apresentação</th>
                <th>Controla</th>
                <th>Est. Fiscal</th>
                <th>Est. Não Fiscal</th>
                <th>Est. Total</th>
                <th>NCM</th>
                <th>CFOP</th>
                <th>CSOSN</th>
                <th>Categoria</th>
                <th>Subcategoria</th>
                <th>Classificação</th>
                <th>Ação</th>
                <th>item_fiscal</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="tbodyPreviewImportacao"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card mb-3 d-none" id="cardResultadoImportacao">
      <div class="card-header bg-success text-white"><i class="fas fa-flag-checkered"></i> Operação concluída</div>
      <div class="card-body" id="corpoResultadoImportacao"></div>
    </div>
  `);

  atualizarTextosModoImportacao();

  $('#btnModoCadastroInicial').on('click', () => solicitarTrocaModoImportacao(MODO_CADASTRO));
  $('#btnModoAtualizarQuantidades').on('click', () => solicitarTrocaModoImportacao(MODO_QUANTIDADES));

  $('input[name="modoFiscalImportacao"]').on('change', function onModoFiscalChange() {
    importacaoInicialState.modo_fiscal_importacao = obterModoFiscalSelecionadoUi();
    $('#avisoModoFiscalImportacao').addClass('d-none').text('');
  });

  $('#arquivoImportacaoProdutos').on('change', function onFileChange() {
    const file = this.files && this.files[0];
    importacaoInicialState.arquivoNome = file ? file.name : null;
    importacaoInicialState.sessaoId = null;
    importacaoInicialState.linhas = [];
    importacaoInicialState.resumo = null;
    importacaoInicialState.resultado = null;
    $('#btnValidarImportacaoProdutos').prop('disabled', !file);
    $('#btnImportarProdutosFinal').prop('disabled', true).text(textoBotaoAcaoPrincipal(true));
    $('#resumoValidacaoImportacao').addClass('d-none').empty();
    $('#cardPreviewImportacao').addClass('d-none');
    $('#cardResultadoImportacao').addClass('d-none');
    $('#blocoPoliticaPendentes').addClass('d-none');
    $('input[name="politicaPendentesImportacao"]').prop('checked', false);
  });

  $('#btnValidarImportacaoProdutos').on('click', validarArquivoImportacaoInicial);
  $('#btnImportarProdutosFinal').on('click', confirmarImportacaoInicialProdutos);
  $('#btnLimparImportacaoProdutos').on('click', confirmarLimparImportacaoInicial);
  $(document).off('change.politicaPendentes').on('change.politicaPendentes', 'input[name="politicaPendentesImportacao"]', function onPoliticaPendentesChange() {
    importacaoInicialState.politica_pendentes = obterPoliticaPendentesUi();
    renderPreviewImportacaoInicial();
    atualizarResumoDestinoPendentes();
    atualizarBotaoImportarCadastro();
  });
  atualizarVisibilidadeTratamentoFiscal();
}

function renderPoliticaPendentesImportacao() {
  const qtdPend = Number((importacaoInicialState.resumo || {}).pendentes_classificacao || 0);
  const $bloco = $('#blocoPoliticaPendentes');
  if (isModoQuantidades() || qtdPend <= 0) {
    $bloco.addClass('d-none');
    return;
  }
  $('#textoPoliticaPendentes').text(
    `${qtdPend} produto${qtdPend === 1 ? '' : 's'} não possuem categoria/subcategoria compatível.`
  );
  $bloco.removeClass('d-none');
}

function contagemDestinoPendentes() {
  const r = importacaoInicialState.resumo || {};
  const classificados = Number(r.produtos_classificados || 0);
  const pendentes = Number(r.pendentes_classificacao || 0);
  const politica = obterPoliticaPendentesUi();
  if (politica === POLITICA_IMPORTAR_SEM) {
    return { importados: classificados + pendentes, ignorados: 0 };
  }
  if (politica === POLITICA_IGNORAR) {
    return { importados: classificados, ignorados: pendentes };
  }
  return { importados: classificados, ignorados: pendentes };
}

function atualizarResumoDestinoPendentes() {
  const d = contagemDestinoPendentes();
  $('#resumoSeraoImportados').html(`<strong>Serão importados:</strong> ${d.importados}`);
  $('#resumoSeraoIgnorados').html(`<strong>Serão ignorados:</strong> ${d.ignorados}`);
}

function atualizarBotaoImportarCadastro() {
  const $btn = $('#btnImportarProdutosFinal');
  const r = importacaoInicialState.resumo || {};
  if (isModoQuantidades()) {
    const pode = importacaoInicialState.pode_importar && Number(r.prontos || 0) > 0;
    $btn.prop('disabled', !pode).text('Registrar Quantidades');
    return;
  }
  const temErro = Number(r.com_erro || 0) > 0;
  const classificados = Number(r.produtos_classificados || 0);
  const qtdPend = Number(r.pendentes_classificacao || 0);
  const politica = obterPoliticaPendentesUi();
  const precisaPolitica = qtdPend > 0;
  const dest = contagemDestinoPendentes();
  const pode = importacaoInicialState.pode_importar
    && !temErro
    && dest.importados > 0
    && (!precisaPolitica || Boolean(politica));
  if (pode) {
    $btn.prop('disabled', false).text(
      `Importar ${dest.importados} produto${dest.importados === 1 ? '' : 's'}`
    );
  } else {
    $btn.prop('disabled', true).text('Importar produtos');
  }
}

function atualizarVisibilidadeTratamentoFiscal() {
  const qtd = isModoQuantidades();
  $('#cardTratamentoFiscalImportacao').toggleClass('d-none', qtd);
}

async function validarArquivoImportacaoInicial() {
  const input = document.getElementById('arquivoImportacaoProdutos');
  const file = input?.files?.[0];
  if (!file) {
    showNotification('Selecione um arquivo XLSX.', 'warning');
    return;
  }

  let modoFiscal = null;
  if (!isModoQuantidades()) {
    modoFiscal = obterModoFiscalSelecionadoUi();
    if (modoFiscal && modoFiscal !== MODO_FISCAL && modoFiscal !== MODO_NAO_FISCAL) {
      modoFiscal = null;
    }
    importacaoInicialState.modo_fiscal_importacao = modoFiscal;
  }

  const form = new FormData();
  form.append('arquivo', file);
  form.append('modo', importacaoInicialState.modo || MODO_CADASTRO);
  if (modoFiscal) {
    form.append('modo_fiscal_importacao', modoFiscal);
  }

  $('#btnValidarImportacaoProdutos').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Validando...');
  try {
    const resp = await fetch(`${API_URL}/produtos/importacao-inicial/validar`, {
      method: 'POST',
      headers: headersImportacao(),
      body: form
    });
    const data = await resp.json();
    if (!resp.ok || !data.sucesso) {
      throw new Error(data.error || 'Falha na validação');
    }

    importacaoInicialState.sessaoId = data.sessao_id;
    importacaoInicialState.resumo = data.resumo;
    importacaoInicialState.linhas = data.linhas || [];
    if (data.modo) importacaoInicialState.modo = data.modo;
    if (data.modo_fiscal_importacao) {
      importacaoInicialState.modo_fiscal_importacao = data.modo_fiscal_importacao;
    }

    renderResumoValidacaoImportacao(data, file.name);
    atualizarResumoDestinoPendentes();
    renderCabecalhoPreviewImportacao();
    importacaoInicialState.politica_pendentes = null;
    importacaoInicialState.pode_importar = data.pode_importar === true;
    $('input[name="politicaPendentesImportacao"]').prop('checked', false);
    renderPoliticaPendentesImportacao();
    renderPreviewImportacaoInicial();
    $('#cardPreviewImportacao').removeClass('d-none');
    atualizarBotaoImportarCadastro();

    const qtdP = Number((data.resumo || {}).pendentes_classificacao || 0);
    if (qtdP > 0) {
      showNotification(`Existem produtos sem classificação segura. ${qtdP} produto${qtdP === 1 ? '' : 's'}.`, 'warning');
    } else {
      showNotification('Validação concluída.', 'success');
    }
  } catch (err) {
    showNotification(err.message || 'Erro ao validar', 'danger');
  } finally {
    $('#btnValidarImportacaoProdutos').prop('disabled', false).html('<i class="fas fa-check-double"></i> Validar Importação');
  }
}

function renderResumoValidacaoImportacao(data, nomeArquivo) {
  const r = data.resumo || {};
  if (isModoQuantidades()) {
    $('#resumoValidacaoImportacao').removeClass('d-none').html(`
      <div class="alert alert-light border mb-0">
        <div><strong>Arquivo:</strong> ${escapeHtmlImport(data.arquivo || nomeArquivo)}</div>
        <div class="row g-2 mt-2">
          <div class="col-md-3"><strong>Produtos no arquivo:</strong> ${r.produtos_no_arquivo || 0}</div>
          <div class="col-md-3"><strong>Encontrados:</strong> ${r.produtos_encontrados || 0}</div>
          <div class="col-md-3"><strong>Não encontrados:</strong> ${r.produtos_nao_encontrados || 0}</div>
          <div class="col-md-3"><strong>Quantidade a lançar:</strong> ${r.quantidade_total_a_lancar || 0} ${escapeHtmlImport(r.quantidade_unidade || 'UN')}</div>
        </div>
      </div>
    `);
    return;
  }

  const estoqueTotal = Number(r.estoque_inicial_total || 0);
  const unEstoque = escapeHtmlImport(r.estoque_inicial_unidade || 'UN');
  const enriquecimentos = Number(r.enriquecimentos || 0);
  const aprNovas = Number(r.apresentacoes_novas || 0);
  const modoFiscal = data.modo_fiscal_importacao
    || r.modo_fiscal_importacao
    || importacaoInicialState.modo_fiscal_importacao;
  const tratamento = escapeHtmlImport(
    data.tratamento_fiscal || r.tratamento_fiscal || rotuloModoFiscalImportacaoUi(modoFiscal)
  );
  $('#resumoValidacaoImportacao').removeClass('d-none').html(`
    <div class="alert alert-light border mb-0">
      <div><strong>Arquivo:</strong> ${escapeHtmlImport(data.arquivo || nomeArquivo)}</div>
      <div class="mt-2"><strong>TRATAMENTO FISCAL:</strong> ${tratamento}</div>
      <div class="row g-2 mt-2">
        <div class="col-md-3"><strong>Produtos encontrados:</strong> ${r.produtos_encontrados || 0}</div>
        <div class="col-md-3"><strong>Produtos novos:</strong> ${r.produtos_novos != null ? r.produtos_novos : (r.prontos || 0)}</div>
        <div class="col-md-3"><strong>Produtos existentes:</strong> ${r.produtos_existentes != null ? r.produtos_existentes : ((r.existentes || 0) + enriquecimentos + Number(r.atualizacoes || 0))}</div>
        <div class="col-md-3"><strong>Produtos a atualizar:</strong> ${Number(r.produtos_a_atualizar != null ? r.produtos_a_atualizar : r.atualizacoes || 0)}</div>
        <div class="col-md-3"><strong>Atualizações de custo:</strong> ${Number(r.atualizacoes_custo || 0)}</div>
        <div class="col-md-3"><strong>Atualizações de preço de venda:</strong> ${Number(r.atualizacoes_preco_venda || 0)}</div>
        <div class="col-md-3"><strong>Produtos sem alteração:</strong> ${Number(r.produtos_sem_alteracao != null ? r.produtos_sem_alteracao : r.existentes || 0)}</div>
        <div class="col-md-3"><strong>Pendentes de classificação:</strong> ${Number(r.pendentes_classificacao || 0)}</div>
        <div class="col-md-3"><strong>Produtos classificados:</strong> ${Number(r.produtos_classificados != null ? r.produtos_classificados : ((r.prontos || 0) + enriquecimentos + Number(r.atualizacoes || 0) + Number(r.atencao_importaveis || 0)))}</div>
        <div class="col-md-3" id="resumoSeraoImportados"><strong>Serão importados:</strong> ${Number(r.produtos_classificados || 0)}</div>
        <div class="col-md-3" id="resumoSeraoIgnorados"><strong>Serão ignorados:</strong> ${Number(r.pendentes_classificacao || 0)}</div>
        <div class="col-md-3"><strong>Categorias novas:</strong> ${Number(r.categorias_novas || 0)}</div>
        <div class="col-md-3"><strong>Subcategorias novas:</strong> ${Number(r.subcategorias_novas || 0)}</div>
        <div class="col-md-3"><strong>Quantidade na planilha:</strong> ${Number(r.quantidade_planilha_total != null ? r.quantidade_planilha_total : estoqueTotal)} ${unEstoque}</div>
        <div class="col-md-3"><strong>Estoque a lançar:</strong> ${estoqueTotal} ${unEstoque}</div>
        <div class="col-md-3"><strong>Apresentações novas:</strong> ${aprNovas}</div>
        <div class="col-md-3"><strong>Possíveis duplicados:</strong> ${r.possiveis_duplicados || 0}</div>
        <div class="col-md-3"><strong>Erros:</strong> ${r.com_erro || 0}</div>
        <div class="col-md-3"><strong>Produtos fiscais novos:</strong> ${r.produtos_fiscais_novos || 0}</div>
        <div class="col-md-3"><strong>Produtos não fiscais novos:</strong> ${r.produtos_nao_fiscais_novos || 0}</div>
        <div class="col-md-3"><strong>Existentes a enriquecer:</strong> ${enriquecimentos}</div>
      </div>
    </div>
  `);
}

function renderPreviewImportacaoInicial() {
  const linhas = importacaoInicialState.linhas || [];

  if (isModoQuantidades()) {
    const html = linhas.map((l) => {
      const p = l.produto || {};
      const q = l.quantidade || {};
      const prev = l.preview_atualizacao || {};
      const custoLabel = prev.novo_custo_label != null
        ? (typeof prev.novo_custo_label === 'number' ? moedaImport(prev.novo_custo_label) : escapeHtmlImport(prev.novo_custo_label))
        : '—';
      const vendaLabel = prev.novo_preco_label != null
        ? (typeof prev.novo_preco_label === 'number' ? moedaImport(prev.novo_preco_label) : escapeHtmlImport(prev.novo_preco_label))
        : '—';
      return `<tr>
        <td>${badgeStatusImport(l.status)}</td>
        <td>${escapeHtmlImport(p.codigo_origem || '—')}</td>
        <td>${escapeHtmlImport(p.nome || '—')}</td>
        <td>${escapeHtmlImport(q.qtd_origem_label || '—')}</td>
        <td>${escapeHtmlImport(q.conversao_label || '—')}</td>
        <td>${escapeHtmlImport(q.quantidade_label || '—')}</td>
        <td>${custoLabel}</td>
        <td>${vendaLabel}</td>
      </tr>`;
    }).join('');
    $('#tbodyPreviewImportacao').html(html || '<tr><td colspan="8" class="text-center text-muted py-4">Nenhuma linha</td></tr>');
    return;
  }

  const html = linhas.map((l, idx) => {
    const p = l.produto || {};
    const e = l.estoque || {};
    const isFiscal = Number(p.item_fiscal) !== 0;
    const badgeFiscal = isFiscal
      ? '<span class="badge bg-primary">item_fiscal=1</span>'
      : '<span class="badge bg-secondary">item_fiscal=0</span>';
    const controla = Number(p.controla_estoque) !== 0
      ? '<span class="badge bg-success">SIM</span>'
      : '<span class="badge bg-dark">NÃO</span>';
    const divs = Array.isArray(l.divergencias_fiscais) ? l.divergencias_fiscais : [];
    const avisoDiv = divs.length
      ? `<div class="small text-warning mt-1">⚠ ${divs.map((d) => escapeHtmlImport(d.label || d.campo)).join(', ')} divergente</div>`
      : '';
    const isExistente = l.status === 'EXISTENTE' || l.status === 'EXISTENTE_ATUALIZAR';
    const prev = l.preview_atualizacao || {};
    const custoCel = isExistente && prev
      ? htmlCampoMoedaExistente(prev, 'custo')
      : moedaImport(p.custo_unitario);
    const vendaCel = isExistente && prev
      ? htmlCampoMoedaExistente(prev, 'venda')
      : moedaImport(p.preco_venda);
    return `<tr>
      <td>${badgeStatusImport(l.status)}</td>
      <td>${escapeHtmlImport(p.nome)}${avisoDiv}</td>
      <td>${escapeHtmlImport(p.marca || '—')}</td>
      <td>${escapeHtmlImport(p.unidade_base || 'UN')}</td>
      <td>${custoCel}</td>
      <td>${Number(p.markup || 0).toFixed(2).replace('.', ',')}%</td>
      <td>${vendaCel}</td>
      <td>${escapeHtmlImport(l.apresentacao_label || '—')}</td>
      <td>${controla}</td>
      <td>${escapeHtmlImport(e.estoque_fiscal_label || String(e.estoque_fiscal ?? '—'))}</td>
      <td>${escapeHtmlImport(e.estoque_nao_fiscal_label || String(e.estoque_nao_fiscal ?? '—'))}</td>
      <td>${escapeHtmlImport(e.estoque_total_label || e.estoque_inicial_label || '—')}</td>
      <td>${escapeHtmlImport(p.ncm || '—')}</td>
      <td>${escapeHtmlImport(p.cfop || '—')}</td>
      <td>${escapeHtmlImport(p.csosn || '—')}</td>
      <td>${escapeHtmlImport(nomeCategoriaPreview(l))}</td>
      <td>${escapeHtmlImport(nomeSubcategoriaPreview(l) === '—' ? '—' : nomeSubcategoriaPreview(l))}</td>
      <td>${escapeHtmlImport(rotuloClassificacaoImport(l))}</td>
      <td>${escapeHtmlImport(acaoLinhaImportacao(l, obterPoliticaPendentesUi()))}</td>
      <td>${badgeFiscal}</td>
      <td><button type="button" class="btn btn-outline-secondary btn-sm" data-idx="${idx}" onclick="verDetalheImportacaoInicial(${idx})">Ver detalhes</button></td>
    </tr>`;
  }).join('');
  $('#tbodyPreviewImportacao').html(html || '<tr><td colspan="21" class="text-center text-muted py-4">Nenhuma linha</td></tr>');
}

function verDetalheImportacaoInicial(idx) {
  const l = importacaoInicialState.linhas[idx];
  if (!l) return;
  const p = l.produto || {};
  const enr = l.enriquecimento || null;
  const apr = (l.apresentacoes || []).map((a) =>
    `<li>${escapeHtmlImport(a.tipo)} — ${a.quantidade} ${escapeHtmlImport(a.unidade)} | Custo ${moedaImport(a.custo ?? a.valor_compra)} | Venda ${moedaImport(a.preco)}</li>`
  ).join('') || '<li class="text-muted">Sem apresentações</li>';

  const blocoEnriquecimento = (l.status === 'EXISTENTE_APRESENTACAO_NOVA' && enr)
    ? `
      <hr>
      <h6>Enriquecimento de produto existente</h6>
      <dl class="row mb-0">
        <dt class="col-sm-4">Produto</dt><dd class="col-sm-8">EXISTENTE</dd>
        <dt class="col-sm-4">Apresentação</dt><dd class="col-sm-8">${Number(enr.apresentacoes_novas || 0) > 0 ? 'NOVA' : 'EXISTENTE (sincronizar)'}</dd>
        <dt class="col-sm-4">Tipo</dt><dd class="col-sm-8">${escapeHtmlImport((l.apresentacoes && l.apresentacoes[0] && l.apresentacoes[0].tipo) || '—')}</dd>
        <dt class="col-sm-4">Conversão</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && l.estoque.conversao_label) || '—')}</dd>
        <dt class="col-sm-4">Valor</dt><dd class="col-sm-8">${moedaImport((l.apresentacoes && l.apresentacoes[0] && (l.apresentacoes[0].valor_compra ?? l.apresentacoes[0].custo)) || null)}</dd>
        <dt class="col-sm-4">Estoque</dt><dd class="col-sm-8">${enr.precisa_estoque ? `+${escapeHtmlImport((l.estoque && l.estoque.estoque_inicial_label) || '')}` : 'sem novo lançamento'}</dd>
        <dt class="col-sm-4">Unidade base</dt><dd class="col-sm-8">${enr.corrigir_unidade_base
          ? `${escapeHtmlImport(enr.unidade_atual || '—')} → ${escapeHtmlImport(enr.unidade_arquivo || p.unidade_base || '—')}`
          : escapeHtmlImport(p.unidade_base || '—')}</dd>
      </dl>
    `
    : '';

  const prev = l.preview_atualizacao || null;
  const blocoNovo = (l.status === 'PRONTO')
    ? `
      <hr>
      <h6>Cadastro novo</h6>
      <dl class="row mb-0">
        <dt class="col-sm-4">Status</dt><dd class="col-sm-8">NOVO</dd>
        <dt class="col-sm-4">Categoria</dt><dd class="col-sm-8">${escapeHtmlImport(p.categoria || '—')}</dd>
        <dt class="col-sm-4">Subcategoria</dt><dd class="col-sm-8">${escapeHtmlImport(p.subcategoria || '—')}</dd>
        <dt class="col-sm-4">Quantidade</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && l.estoque.estoque_inicial_label) || '—')}</dd>
        <dt class="col-sm-4">Custo</dt><dd class="col-sm-8">${moedaImport(p.custo_unitario)}</dd>
        <dt class="col-sm-4">Preço venda</dt><dd class="col-sm-8">${moedaImport(p.preco_venda)}</dd>
      </dl>
    `
    : '';
  const blocoAtualizar = ((l.status === 'EXISTENTE_ATUALIZAR' || l.status === 'EXISTENTE') && prev)
    ? `
      <hr>
      <h6>${l.status === 'EXISTENTE_ATUALIZAR' ? 'Atualização de produto existente' : 'Produto existente'}</h6>
      <dl class="row mb-0">
        <dt class="col-sm-4">Status</dt><dd class="col-sm-8">${l.status === 'EXISTENTE_ATUALIZAR' ? 'EXISTENTE — ATUALIZAR' : 'EXISTENTE'}</dd>
        <dt class="col-sm-4">Estoque atual</dt><dd class="col-sm-8">${escapeHtmlImport(String(prev.estoque_atual ?? '—'))}</dd>
        <dt class="col-sm-4">Qtd. a lançar</dt><dd class="col-sm-8">${Number(prev.alterar_estoque) === true
          ? `+${escapeHtmlImport(String(prev.quantidade_importada ?? 0))} UN`
          : (Number(prev.quantidade_arquivo || 0) > 0
            ? `0 UN (já lançado — ${escapeHtmlImport(String(prev.quantidade_arquivo))} UN na planilha)`
            : '— não alterar —')}</dd>
        <dt class="col-sm-4">= Estoque final</dt><dd class="col-sm-8">${escapeHtmlImport(String(prev.estoque_final ?? '—'))}</dd>
        <dt class="col-sm-4">Custo</dt><dd class="col-sm-8">${htmlCampoMoedaExistente(prev, 'custo')}</dd>
        <dt class="col-sm-4">Venda</dt><dd class="col-sm-8">${htmlCampoMoedaExistente(prev, 'venda')}</dd>
        <dt class="col-sm-4">Categoria</dt><dd class="col-sm-8">${prev.alterar_categoria
          ? 'a classificar (cadastro sem categoria)'
          : `preservada${prev.categoria_preservada ? ` (${escapeHtmlImport(prev.categoria_preservada)})` : ''}`}</dd>
        <dt class="col-sm-4">Subcategoria</dt><dd class="col-sm-8">${prev.alterar_subcategoria
          ? 'a classificar (cadastro sem subcategoria)'
          : `preservada${prev.subcategoria_preservada ? ` (${escapeHtmlImport(prev.subcategoria_preservada)})` : ''}`}</dd>
        <dt class="col-sm-4">Fiscal</dt><dd class="col-sm-8">preservado</dd>
      </dl>
    `
    : '';

  const dup = l.duplicidade_arquivo || null;
  const blocoDuplicidade = (l.status === 'CODIGO_DUPLICADO_ARQUIVO' && dup)
    ? `
      <hr>
      <h6>Código duplicado no arquivo</h6>
      <dl class="row mb-0">
        <dt class="col-sm-4">Código</dt><dd class="col-sm-8">${escapeHtmlImport(dup.codigo || p.codigo_origem || '—')}</dd>
        <dt class="col-sm-4">Ocorrências</dt><dd class="col-sm-8">${Number(dup.ocorrencias || 0)}</dd>
        <dt class="col-sm-4">Linhas</dt><dd class="col-sm-8">${escapeHtmlImport((dup.linhas || []).join(' e '))}</dd>
        <dt class="col-sm-4">Nome</dt><dd class="col-sm-8">${escapeHtmlImport((dup.nomes && dup.nomes[0]) || p.nome || '—')}</dd>
      </dl>
    `
    : '';

  $('#modal-container').html(`
    <div class="modal fade" id="modalDetalheImportacao" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Detalhes do produto</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <dl class="row mb-0">
              <dt class="col-sm-4">Produto</dt><dd class="col-sm-8">${escapeHtmlImport(p.nome)}</dd>
              <dt class="col-sm-4">Marca</dt><dd class="col-sm-8">${escapeHtmlImport(p.marca || '—')}</dd>
              <dt class="col-sm-4">Classificação atual</dt><dd class="col-sm-8">${escapeHtmlImport(classificacaoAtualPreview(l))}</dd>
              <dt class="col-sm-4">Classificação sugerida</dt><dd class="col-sm-8">${escapeHtmlImport(classificacaoSugeridaPreview(l))}</dd>
              <dt class="col-sm-4">Ação</dt><dd class="col-sm-8">${escapeHtmlImport(acaoLinhaImportacao(l, obterPoliticaPendentesUi()))}</dd>
              <dt class="col-sm-4">Categoria atual</dt><dd class="col-sm-8">${escapeHtmlImport((l.classificacao && l.classificacao.categoria_atual_nome) || '—')}</dd>
              <dt class="col-sm-4">Categoria sugerida</dt><dd class="col-sm-8">${escapeHtmlImport(textoCategoriaSugeridaDetalhe(l.classificacao))}</dd>
              <dt class="col-sm-4">Subcategoria atual</dt><dd class="col-sm-8">${escapeHtmlImport((l.classificacao && l.classificacao.subcategoria_atual_nome) || '—')}</dd>
              <dt class="col-sm-4">Subcategoria sugerida</dt><dd class="col-sm-8">${escapeHtmlImport(textoSubcategoriaSugeridaDetalhe(l.classificacao))}</dd>
              <dt class="col-sm-4">Confiança</dt><dd class="col-sm-8">${escapeHtmlImport((l.classificacao && l.classificacao.confianca) || '—')}</dd>
              <dt class="col-sm-4">Origem</dt><dd class="col-sm-8">${escapeHtmlImport(rotuloOrigemClassificacao(l.classificacao && l.classificacao.origem))}</dd>
              <dt class="col-sm-4">Categoria informada</dt><dd class="col-sm-8">${escapeHtmlImport(p.categoria || '—')}</dd>
              <dt class="col-sm-4">Subcategoria informada</dt><dd class="col-sm-8">${escapeHtmlImport(p.subcategoria || '—')}</dd>
              <dt class="col-sm-4">Unidade base</dt><dd class="col-sm-8">${escapeHtmlImport(p.unidade_base || 'UN')}</dd>
              <dt class="col-sm-4">Qtd. origem</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && l.estoque.qtd_origem_label) || '—')}</dd>
              <dt class="col-sm-4">Conversão</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && l.estoque.conversao_label) || '—')}</dd>
              <dt class="col-sm-4">Estoque fiscal</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && l.estoque.estoque_fiscal_label) || '—')}</dd>
              <dt class="col-sm-4">Estoque não fiscal</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && l.estoque.estoque_nao_fiscal_label) || '—')}</dd>
              <dt class="col-sm-4">Estoque total</dt><dd class="col-sm-8">${escapeHtmlImport((l.estoque && (l.estoque.estoque_total_label || l.estoque.estoque_inicial_label)) || '—')}</dd>
              <dt class="col-sm-4">Controla estoque</dt><dd class="col-sm-8">${Number(p.controla_estoque) !== 0 ? 'SIM' : 'NÃO'}</dd>
              <dt class="col-sm-4">NCM</dt><dd class="col-sm-8">${escapeHtmlImport(p.ncm || '—')}</dd>
              <dt class="col-sm-4">CFOP</dt><dd class="col-sm-8">${escapeHtmlImport(p.cfop || '—')}</dd>
              <dt class="col-sm-4">CSOSN</dt><dd class="col-sm-8">${escapeHtmlImport(p.csosn || '—')}</dd>
              <dt class="col-sm-4">Custo</dt><dd class="col-sm-8">${moedaImport(p.custo_unitario)}</dd>
              <dt class="col-sm-4">Markup</dt><dd class="col-sm-8">${Number(p.markup || 0).toFixed(2)}%</dd>
              <dt class="col-sm-4">Preço</dt><dd class="col-sm-8">${moedaImport(p.preco_venda)}</dd>
              <dt class="col-sm-4">item_fiscal</dt><dd class="col-sm-8">${Number(p.item_fiscal) === 0
                ? '0 (não fiscal)'
                : '1 (fiscal)'}${p.fiscal_fonte === 'EXISTENTE'
                ? ' — classificação do banco'
                : ' — heurística da planilha'}</dd>
              <dt class="col-sm-4">Referência</dt><dd class="col-sm-8">${escapeHtmlImport(p.referencia_fabricante || '—')}</dd>
              <dt class="col-sm-4">Código origem</dt><dd class="col-sm-8">${escapeHtmlImport(p.codigo_origem || '—')}</dd>
              <dt class="col-sm-4">Observações</dt><dd class="col-sm-8">${escapeHtmlImport(p.observacoes || '—')}</dd>
              <dt class="col-sm-4">Status</dt><dd class="col-sm-8">${badgeStatusImport(l.status)} ${(l.mensagens || []).map(escapeHtmlImport).join('; ')}</dd>
            </dl>
            ${blocoDuplicidade}
            ${blocoNovo}
            ${blocoAtualizar}
            ${blocoEnriquecimento}
            ${(Array.isArray(l.divergencias_fiscais) && l.divergencias_fiscais.length)
              ? `<hr><h6 class="text-warning">⚠ Classificação fiscal divergente</h6>
                 <p class="small text-muted">Cadastro existente será preservado.</p>
                 <ul>${l.divergencias_fiscais.map((d) =>
                   `<li><strong>${escapeHtmlImport(d.label || d.campo)}</strong>
                    — Cadastro: ${escapeHtmlImport(d.cadastro)} | Planilha: ${escapeHtmlImport(d.planilha)}</li>`
                 ).join('')}</ul>`
              : ''}
            <hr>
            <h6>Apresentações / conversões</h6>
            <ul>${apr}</ul>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  `);
  const modal = new bootstrap.Modal(document.getElementById('modalDetalheImportacao'));
  modal.show();
}

function confirmarImportacaoInicialProdutos() {
  if (!importacaoInicialState.sessaoId) return;
  if (Number(importacaoInicialState.resumo?.com_erro || 0) > 0) {
    showNotification('Existem erros de validação. Corrija o arquivo e valide novamente.', 'warning');
    return;
  }
  const qtdPendClass = Number(importacaoInicialState.resumo?.pendentes_classificacao || 0);
  const politica = obterPoliticaPendentesUi();
  if (!isModoQuantidades() && qtdPendClass > 0 && !politica) {
    showNotification('Selecione o destino dos produtos sem classificação.', 'warning');
    return;
  }

  if (isModoQuantidades()) {
    const r = importacaoInicialState.resumo || {};
    const qtd = Number(r.prontos || 0);
    if (qtd <= 0) return;
    const totalArquivo = Number(r.produtos_no_arquivo || 0);
    const qtdLancar = Number(r.quantidade_total_a_lancar || 0);

    $('#modal-container').html(`
      <div class="modal fade" id="modalConfirmarImportacao" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Registrar quantidades?</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <p class="mb-2">Esta operação não criará produtos.
              Somará as quantidades dos produtos existentes e atualizará custo/preço somente quando informados na planilha.</p>
              <ul class="mb-2">
                <li>Produtos: <strong>${totalArquivo}</strong></li>
                <li>Quantidade total: <strong>${qtdLancar}</strong></li>
              </ul>
              <p class="text-muted small mb-0">Será criado um backup automático antes da gravação.</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-success" id="btnConfirmarImportacaoExec">Confirmar</button>
            </div>
          </div>
        </div>
      </div>
    `);
  } else {
    const r = importacaoInicialState.resumo || {};
    const dest = contagemDestinoPendentes();
    const qtd = dest.importados;
    if (qtd <= 0) return;
    const existentes = Number(r.existentes || 0);
    const total = Number(r.produtos_encontrados || 0);
    const estoque = Number(r.estoque_inicial_total || 0);
    const un = escapeHtmlImport(r.estoque_inicial_unidade || 'UN');
    const aprNovas = Number(r.apresentacoes_novas || 0);
    const enriquecimentos = Number(r.enriquecimentos || 0);
    const atualizacoes = Number(r.atualizacoes || 0);
    const qtdPend = Number(r.pendentes_classificacao || 0);
    const politica = obterPoliticaPendentesUi();
    const modoFiscal = importacaoInicialState.modo_fiscal_importacao
      || r.modo_fiscal_importacao
      || null;
    const tratamento = modoFiscal
      ? rotuloModoFiscalImportacaoUi(modoFiscal)
      : 'POR LINHA (Estoque Fiscal / Não Fiscal)';
    const avisoFiscal = `<div class="alert alert-light border py-2">
           <p class="mb-1"><strong>Distribuição de estoque:</strong> colunas Estoque Fiscal / Estoque Não Fiscal da planilha.</p>
           <p class="mb-0"><strong>Modo legado (opcional):</strong> ${escapeHtmlImport(tratamento)}</p>
         </div>`;
    const avisoEnriquecimento = enriquecimentos > 0
      ? `<p class="mb-2 text-primary">Existem produtos já cadastrados que receberão apresentações comerciais novas.</p>
         <ul class="mb-2">
           <li>Produtos existentes a enriquecer: <strong>${enriquecimentos}</strong></li>
           <li>Apresentações novas: <strong>${aprNovas}</strong></li>
           <li>Estoque a registrar: <strong>${estoque}</strong> ${un}</li>
         </ul>`
      : '';
    const avisoAtualizacao = atualizacoes > 0
      ? `<p class="mb-2 text-warning">Existem produtos já cadastrados que receberão soma de estoque e/ou atualização de custo/preço.</p>
         <ul class="mb-2">
           <li>Produtos existentes a atualizar: <strong>${atualizacoes}</strong></li>
         </ul>`
      : '';

    const avisoPendentes = qtdPend > 0
      ? (politica === POLITICA_IGNORAR
        ? `<p class="mb-2"><strong>Pendentes:</strong> ${qtdPend} produto${qtdPend === 1 ? '' : 's'} <strong>não serão importados</strong>.</p>`
        : `<p class="mb-2"><strong>Pendentes:</strong> ${qtdPend} produto${qtdPend === 1 ? '' : 's'} serão importados <strong>sem categoria/subcategoria</strong>.</p>`)
      : '';

    $('#modal-container').html(`
      <div class="modal fade" id="modalConfirmarImportacao" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Importar produtos e registrar estoque inicial?</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              ${avisoFiscal}
              ${avisoEnriquecimento}
              ${avisoAtualizacao}
              ${avisoPendentes}
              <ul class="mb-2">
                <li>Produtos: <strong>${total}</strong></li>
                <li>Serão importados: <strong>${dest.importados}</strong></li>
                <li>Serão ignorados: <strong>${dest.ignorados}</strong></li>
                <li>Produtos existentes (sem alteração): <strong>${existentes}</strong></li>
                <li>Estoque inicial: <strong>${estoque}</strong> na unidade base (${un})</li>
                <li>Movimentações de estoque: <strong>serão criadas quando aplicável</strong></li>
              </ul>
              <p class="mb-1">Esta operação cadastrará produtos novos e poderá enriquecer existentes com apresentações do arquivo.</p>
              <p class="mb-0">Cadastro existente (nome, marca, categoria, fiscal) <strong>não será sobrescrito</strong>.</p>
              <p class="text-muted small mt-2 mb-0">Será criado um backup automático antes da gravação.</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-success" id="btnConfirmarImportacaoExec">Confirmar Importação</button>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  const modalEl = document.getElementById('modalConfirmarImportacao');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  $('#btnConfirmarImportacaoExec').on('click', async () => {
    modal.hide();
    await executarImportacaoInicialProdutos();
  });
}

async function executarImportacaoInicialProdutos() {
  const $btn = $('#btnImportarProdutosFinal');
  const modoQtd = isModoQuantidades();
  $btn.prop('disabled', true).html(
    modoQtd
      ? '<i class="fas fa-spinner fa-spin"></i> Registrando...'
      : '<i class="fas fa-spinner fa-spin"></i> Importando...'
  );
  try {
    const payload = { sessao_id: importacaoInicialState.sessaoId };
    if (!modoQtd) {
      const politica = obterPoliticaPendentesUi();
      if (politica) payload.politica_pendentes = politica;
    }
    const resp = await fetch(`${API_URL}/produtos/importacao-inicial/importar`, {
      method: 'POST',
      headers: { ...headersImportacao(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || !data.sucesso) {
      throw new Error(data.error || 'Falha na operação');
    }
    importacaoInicialState.resultado = data;
    const r = data.relatorio || {};
    $('#cardResultadoImportacao').removeClass('d-none');

    if (modoQtd) {
      $('#corpoResultadoImportacao').html(`
        <h5 class="text-success">QUANTIDADES REGISTRADAS</h5>
        <ul class="mb-2">
          <li>Produtos processados: <strong>${r.produtos_processados || 0}</strong></li>
          <li>Produtos criados: <strong>0</strong></li>
          <li>Cadastro alterado: <strong>${r.cadastro_alterado || 0}</strong></li>
          <li>Estoque lançado: <strong>${r.estoque_lancado || 0}</strong> UN</li>
          <li>Movimentações: <strong>${r.movimentacoes_estoque || 0}</strong></li>
          <li>Já processados (ignorados): <strong>${r.ignorados_ja_processados || 0}</strong></li>
        </ul>
        ${data.backup ? `<p class="small text-muted mb-0">Backup: ${escapeHtmlImport(data.backup.arquivo || data.backup.caminho || '')}</p>` : ''}
      `);
      $btn.text('Quantidades registradas');
      showNotification('Quantidades registradas com sucesso.', 'success');
    } else {
      $('#corpoResultadoImportacao').html(`
        <h5 class="text-success">IMPORTAÇÃO CONCLUÍDA</h5>
        <ul class="mb-2">
          <li>Importados: <strong>${r.importados != null ? r.importados : (r.criados || 0) + (r.atualizados || 0)}</strong></li>
          <li>Ignorados: <strong>${r.ignorados || 0}</strong></li>
          <li>Classificados: <strong>${r.classificados != null ? r.classificados : 0}</strong></li>
          <li>Sem classificação: <strong>${r.sem_classificacao || 0}</strong></li>
          <li>Criados: <strong>${r.criados || 0}</strong></li>
          <li>Existentes: <strong>${r.existentes || 0}</strong></li>
          <li>Enriquecidos: <strong>${r.enriquecidos || r.atualizados || 0}</strong></li>
          <li>Apresentações novas: <strong>${r.apresentacoes_novas || 0}</strong></li>
          <li>Com atenção: <strong>${r.com_atencao || 0}</strong></li>
          <li>Erros: <strong>${r.erros || 0}</strong></li>
          <li>Estoque inicial lançado: <strong>${r.estoque_lancado || 0}</strong></li>
          <li>Movimentações de estoque: <strong>${r.movimentacoes_estoque || 0}</strong></li>
        </ul>
        ${data.backup ? `<p class="small text-muted mb-0">Backup: ${escapeHtmlImport(data.backup.arquivo || data.backup.caminho || '')}</p>` : ''}
      `);
      $btn.text('Importação concluída');
      showNotification('Importação concluída com sucesso.', 'success');
    }

    // V1.0.13 — após sucesso, atualiza snapshot da Lista de Produtos (GET /produtos).
    if (typeof loadProdutos === 'function') {
      const refresh = loadProdutos();
      if (refresh && typeof refresh.then === 'function') {
        await refresh;
      }
    }
  } catch (err) {
    showNotification(err.message || 'Erro ao processar', 'danger');
    const qtd = Number(importacaoInicialState.resumo?.prontos || 0)
      + Number(importacaoInicialState.resumo?.enriquecimentos || 0);
    if (modoQtd) {
      $btn.prop('disabled', false).text('Registrar Quantidades');
    } else {
      $btn.prop('disabled', false).text(`Importar ${qtd} produto${qtd === 1 ? '' : 's'}`);
    }
  }
}

window.loadImportacaoInicialProdutos = loadImportacaoInicialProdutos;
window.verDetalheImportacaoInicial = verDetalheImportacaoInicial;
window.confirmarLimparImportacaoInicial = confirmarLimparImportacaoInicial;
window.criarEstadoVazioImportacao = criarEstadoVazioImportacao;
window.resetarEstadoImportacaoInicial = resetarEstadoImportacaoInicial;
window.trocarModoImportacao = trocarModoImportacao;
