/**
 * Central de Revisão MIIP — Sprint 6B / RC7.5
 * Módulo independente do fluxo de Compras/Pedido.
 *
 * RC7.5 — "Confirmar Produto" apenas confirma, aprende e avança.
 * Nunca abre Pedido, Compra ou Cadastro a partir desse botão.
 *
 * Uso:
 *   MiipCentralRevisao.iniciar({ dadosImportacao, apiUrl, produtos, onConcluir, onCancelar, ... })
 */
(function initMiipCentralRevisao(global) {
  'use strict';

  const MOTOR_LABELS = {
    motor_gtin: 'Código de barras',
    motor_associacao_fornecedor: 'Histórico do fornecedor',
    motor_mubc: 'Busca universal (MUBC)',
    motor_similarity: 'Similaridade'
  };

  let estado = null;

  function intel() {
    return (typeof global !== 'undefined' && global.MiipRevisaoInteligente)
      || (typeof window !== 'undefined' && window.MiipRevisaoInteligente)
      || null;
  }

  function escapeHtml(texto) {
    return String(texto ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatarMoeda(valor) {
    const numero = Number(valor || 0);
    if (typeof formatCurrency === 'function') return formatCurrency(numero);
    return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatarTempo(ms) {
    const totalSeg = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const h = Math.floor(totalSeg / 3600);
    const m = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function calcularPrecisao(resumo, confirmadosManualmente) {
    const total = Number(resumo?.totalItens ?? 0);
    if (total <= 0) return 0;
    const auto = Number(resumo?.identificadosAutomaticamente ?? 0);
    const conf = Number(confirmadosManualmente ?? 0);
    return Math.round(((auto + conf) / total) * 100);
  }

  function extrairPendencias(resultados) {
    return (resultados || []).filter((r) => r.precisaConfirmacao || r.precisaCadastro);
  }

  function ordenarPendencias(pendencias) {
    return [...pendencias].sort((a, b) => {
      const semA = Boolean(a.precisaCadastro && !a.produtoEncontrado);
      const semB = Boolean(b.precisaCadastro && !b.produtoEncontrado);
      if (semA && !semB) return 1;
      if (!semA && semB) return -1;
      return Number(b.score ?? 0) - Number(a.score ?? 0);
    });
  }

  function extrairEvidencias(candidato, motor) {
    const lista = [];
    if (motor && MOTOR_LABELS[motor]) lista.push(MOTOR_LABELS[motor]);
    (candidato?.evidencias || []).forEach((ev) => {
      const t = ev?.descricao || ev?.tipo || ev?.valor;
      if (t && !lista.includes(t)) lista.push(String(t));
    });
    (candidato?.atributosExtraidos?.motivosRelevancia || []).forEach((m) => {
      const t = m?.rotulo || m?.tipo;
      if (t && !lista.includes(t)) lista.push(String(t));
    });
    if (candidato?.produto?.marca && !lista.includes('Marca')) lista.push('Marca');
    return lista;
  }

  function montarDivergencias(xml, produto) {
    if (!xml || !produto) return [];
    const diffs = [];
    const gtinXml = String(xml.codigo_barras || xml.gtin || '').replace(/\D/g, '');
    const gtinCad = String(produto.codigoBarras || produto.codigo_barras || '').replace(/\D/g, '');
    if (gtinXml && gtinCad && gtinXml !== gtinCad) {
      diffs.push({ campo: 'GTIN', xml: gtinXml, cds: gtinCad });
    }
    const descXml = String(xml.produto_nome || '').trim();
    const descCad = String(produto.nome || '').trim();
    if (descXml && descCad && descXml.toUpperCase() !== descCad.toUpperCase()) {
      diffs.push({ campo: 'Descrição', xml: descXml, cds: descCad });
    }
    const marcaXml = String(xml.marca || '').trim();
    const marcaCad = String(produto.marca || '').trim();
    if (marcaXml && marcaCad && marcaXml.toUpperCase() !== marcaCad.toUpperCase()) {
      diffs.push({ campo: 'Marca', xml: marcaXml, cds: marcaCad });
    }
    const ncmXml = String(xml.ncm || '').replace(/\D/g, '');
    const ncmCad = String(produto.ncm || '').replace(/\D/g, '');
    if (ncmXml && ncmCad && ncmXml !== ncmCad) {
      diffs.push({ campo: 'NCM', xml: ncmXml, cds: ncmCad });
    }
    const cestXml = String(xml.cest || '').replace(/\D/g, '');
    const cestCad = String(produto.cest || '').replace(/\D/g, '');
    if (cestXml && cestCad && cestXml !== cestCad) {
      diffs.push({ campo: 'CEST', xml: cestXml, cds: cestCad });
    }
    const uXml = String(xml.unidade || '').trim().toUpperCase();
    const uCad = String(produto.unidade || '').trim().toUpperCase();
    if (uXml && uCad && uXml !== uCad) {
      diffs.push({ campo: 'Unidade', xml: uXml, cds: uCad });
    }
    return diffs;
  }

  // —— RC9.4 UX — comparação visual XML × CDS (somente apresentação) ——

  function iconeStatusCmp(status) {
    const I = intel();
    const S = I?.COMP_STATUS || {};
    if (status === S.IGUAL || status === 'igual') {
      return '<i class="fas fa-check-circle miip-v2-status-icone" aria-hidden="true"></i>';
    }
    if (status === S.SEMELHANTE || status === 'semelhante') {
      return '<i class="fas fa-adjust miip-v2-status-icone" aria-hidden="true"></i>';
    }
    if (status === S.DIFERENTE || status === 'diferente') {
      return '<i class="fas fa-times-circle miip-v2-status-icone" aria-hidden="true"></i>';
    }
    return '<i class="fas fa-exclamation-triangle miip-v2-status-icone" aria-hidden="true"></i>';
  }

  function renderBarraConfianca(score) {
    const I = intel();
    const bar = I?.barraConfianca
      ? I.barraConfianca(score)
      : { score: Math.max(0, Math.min(100, Math.round(Number(score) || 0))), barra: '', tom: 'baixa' };
    return `
      <div class="miip-v2-confianca miip-v2-confianca--${escapeHtml(bar.tom)}" id="miipV2Comparacao">
        <div class="miip-v2-confianca-topo">
          <span>Confiança</span>
          <strong>${bar.score}%</strong>
        </div>
        <div class="miip-v2-confianca-barra" role="img" aria-label="Confiança ${bar.score}%">${escapeHtml(bar.barra)}</div>
      </div>
    `;
  }

  function renderLinhasComparacao(linhas) {
    if (!linhas || !linhas.length) {
      return '<p class="small text-muted mb-0">Sem campos para comparar.</p>';
    }
    return `
      <div class="miip-v2-linhas">
        ${linhas.map((l) => `
          <div class="miip-v2-linha miip-v2-status--${escapeHtml(l.status || 'ausente')}">
            <div class="miip-v2-linha-campo">${escapeHtml(l.campo)}</div>
            <div class="miip-v2-linha-status">
              ${iconeStatusCmp(l.status)}
              <span>${escapeHtml(l.rotulo || l.status || '—')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderJustificativa(pendencia) {
    const evidencias = extrairEvidencias(pendencia?.candidatoSelecionado, pendencia?.motor);
    if (!evidencias.length) {
      return `
        <div class="miip-v2-justificativa">
          <h6>Por que este candidato?</h6>
          <p class="small text-muted mb-0">Sem evidências detalhadas do motor.</p>
        </div>
      `;
    }
    return `
      <div class="miip-v2-justificativa">
        <h6>Por que este candidato?</h6>
        <ul>
          ${evidencias.map((ev) => `<li><i class="fas fa-check"></i> ${escapeHtml(ev)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  function renderPainelDivergencias(divergencias) {
    if (!divergencias || !divergencias.length) {
      return `
        <div class="miip-v2-divergencias miip-v2-divergencias--ok">
          <h6>Diferenças encontradas</h6>
          <p class="small mb-0">Nenhuma divergência relevante.</p>
        </div>
      `;
    }
    return `
      <div class="miip-v2-divergencias">
        <h6>Diferenças encontradas</h6>
        <ul>
          ${divergencias.map((d) => `
            <li class="miip-v2-status--${escapeHtml(d.status || 'diferente')}">
              <strong>${escapeHtml(d.campo)}</strong>
              <span class="miip-diff-xml">${escapeHtml(d.xml)}</span>
              <i class="fas fa-arrow-right mx-1" aria-hidden="true"></i>
              <span class="miip-diff-cds">${escapeHtml(d.cds)}</span>
              <em>${escapeHtml(d.rotulo || '')}</em>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  function renderTopCandidatosTabela(pendencia, produtosLista) {
    const I = intel();
    const candidatos = (pendencia?.candidatos || []).slice(0, 8);
    if (candidatos.length <= 1) return '';
    return `
      <div class="miip-v2-top-candidatos">
        <h6>Top candidatos</h6>
        <div class="table-responsive">
          <table class="table table-sm miip-v2-top-table">
            <thead>
              <tr>
                <th>Confiança</th>
                <th>Produto</th>
                <th>Marca</th>
                <th>GTIN</th>
                <th>PLU</th>
                <th>NCM</th>
                <th>Preço</th>
                <th>Último custo</th>
                <th>Estoque</th>
              </tr>
            </thead>
            <tbody>
              ${candidatos.map((c) => {
                const base = c.produto || { id: c.produtoId, nome: c.nome };
                const p = I?.enriquecerProdutoCds
                  ? I.enriquecerProdutoCds(base, produtosLista)
                  : base;
                return `
                  <tr>
                    <td><strong>${Number(c.score || 0)}%</strong></td>
                    <td>${escapeHtml(p?.nome || '—')}</td>
                    <td>${escapeHtml(p?.marca || '—')}</td>
                    <td>${escapeHtml(p?.codigoBarras || p?.codigo_barras || '—')}</td>
                    <td>${escapeHtml(p?.plu || '—')}</td>
                    <td>${escapeHtml(p?.ncm || '—')}</td>
                    <td>${p?.preco_venda != null ? formatarMoeda(p.preco_venda) : '—'}</td>
                    <td>${p?.preco_compra != null ? formatarMoeda(p.preco_compra) : '—'}</td>
                    <td>${p?.estoque != null ? escapeHtml(p.estoque) : '—'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderImagensLadoALado(xml, produto) {
    const imgCds = produto?.imagem_principal || produto?.imagem || null;
    const imgXml = xml?.imagem_url || xml?.imagem || null;
    if (!imgCds && !imgXml) return '';
    return `
      <div class="miip-v2-imagens">
        <h6>Imagens</h6>
        <div class="miip-v2-imagens-grid">
          <div class="miip-v2-imagem-col">
            <span>XML</span>
            ${imgXml
              ? `<img src="${escapeHtml(imgXml)}" alt="Imagem XML" loading="lazy">`
              : '<div class="miip-v2-imagem-vazio">Sem imagem</div>'}
          </div>
          <div class="miip-v2-imagem-seta" aria-hidden="true"><i class="fas fa-arrow-down"></i></div>
          <div class="miip-v2-imagem-col">
            <span>Cadastro</span>
            ${imgCds
              ? `<img src="${escapeHtml(imgCds)}" alt="Imagem CDS" loading="lazy">`
              : '<div class="miip-v2-imagem-vazio">Sem imagem</div>'}
          </div>
        </div>
      </div>
    `;
  }

  function renderRodapeMotores(pendencia, sessao) {
    const I = intel();
    const motores = I?.motoresUtilizados
      ? I.motoresUtilizados(pendencia)
      : (pendencia?.motor ? [pendencia.motor] : []);
    const labels = motores.map((m) => MOTOR_LABELS[m] || m);
    const tempo = formatarTempo(sessao?.resumo?.tempoProcessamento || 0);
    return `
      <div class="miip-v2-rodape-motores" data-miip-foco-ocultar>
        <div class="miip-v2-rodape-motores-grid">
          <span><strong>Motor utilizado:</strong> ${labels.length ? labels.map((l) => escapeHtml(l)).join(' · ') : '—'}</span>
          <span><strong>Tempo:</strong> ${escapeHtml(tempo)}</span>
          <span><strong>Versão:</strong> MIIP V2</span>
        </div>
      </div>
    `;
  }

  function renderMotivosSemCandidato(pendencia) {
    const I = intel();
    const diag = pendencia?.diagnosticoBusca
      || pendencia?.miip_resultado?._meta?.compatibilityDiagnostico
      || pendencia?.miip_resultado?._meta?.mubcDiagnostico
      || null;
    const motivos = I?.motivosSemCandidatoPadrao
      ? I.motivosSemCandidatoPadrao(diag)
      : (diag?.motivos || [
        'Nenhum produto CDS compatível encontrado.',
        'Cadastre um novo produto ou selecione manualmente no catálogo.'
      ]);
    return `
      <div class="miip-v2-sem-candidato">
        <h6>Sem candidato compatível</h6>
        <p class="mb-1"><strong>Motivos:</strong></p>
        <ul class="miip-central-motivos-vazio">
          ${motivos.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}
        </ul>
        <p class="small text-muted mb-0">Cadastre um novo produto (F3) ou escolha manualmente no catálogo (F2).</p>
      </div>
    `;
  }

  function renderPainelXml(xml, sessao, mie) {
    const qtd = xml.quantidade;
    const unit = Number(xml.preco_unitario ?? xml.valor_unitario ?? 0);
    const total = xml.valor_total != null
      ? Number(xml.valor_total)
      : (Number(qtd) || 0) * unit;
    const emb = mie && mie.compra_por_embalagem
      ? rotuloEmbalagemMie(mie)
      : (xml.embalagem || xml.mie_rotulo || xml.unidade || '—');
    return `
      <div class="miip-v2-col miip-v2-col--xml">
        <header class="miip-v2-col-header">Produto XML</header>
        <dl class="miip-v2-dl">
          <dt>Descrição</dt><dd>${escapeHtml(xml.produto_nome || xml.nome || '—')}</dd>
          <dt>GTIN / Código de Barras</dt><dd>${escapeHtml(xml.codigo_barras || xml.gtin || '—')}</dd>
          <dt>Código do fornecedor</dt><dd>${escapeHtml(xml.codigo_fornecedor || '—')}</dd>
          <dt>Fornecedor</dt><dd>${escapeHtml(sessao?.fornecedor || '—')}</dd>
          <dt>Marca</dt><dd>${escapeHtml(xml.marca || '—')}</dd>
          <dt>NCM</dt><dd>${escapeHtml(xml.ncm || '—')}</dd>
          <dt>CEST</dt><dd>${escapeHtml(xml.cest || '—')}</dd>
          <dt>Unidade</dt><dd>${escapeHtml(xml.unidade || '—')}</dd>
          <dt>Quantidade</dt><dd>${escapeHtml(qtd ?? '—')}</dd>
          <dt>Valor Unitário</dt><dd>${formatarMoeda(unit)}</dd>
          <dt>Valor Total</dt><dd>${formatarMoeda(total)}</dd>
          <dt>Embalagem</dt><dd>${escapeHtml(emb)}</dd>
        </dl>
      </div>
    `;
  }

  function renderPainelCds(produto, sessao) {
    if (!produto || !produto.id) {
      return `
        <div class="miip-v2-col miip-v2-col--cds">
          <header class="miip-v2-col-header">Produto CDS</header>
          <p class="small text-muted mb-0">Nenhum produto vinculado no cadastro.</p>
        </div>
      `;
    }
    return `
      <div class="miip-v2-col miip-v2-col--cds">
        <header class="miip-v2-col-header">Produto CDS</header>
        <p class="miip-v2-col-nome">${escapeHtml(produto.nome || '—')}</p>
        <dl class="miip-v2-dl">
          <dt>Descrição</dt><dd>${escapeHtml(produto.nome || '—')}</dd>
          <dt>Código Interno</dt><dd>${escapeHtml(produto.codigo || '—')}</dd>
          <dt>PLU</dt><dd>${escapeHtml(produto.plu || '—')}</dd>
          <dt>GTIN</dt><dd>${escapeHtml(produto.codigoBarras || produto.codigo_barras || '—')}</dd>
          <dt>Fornecedor Principal</dt><dd>${escapeHtml(produto.fornecedor || sessao?.fornecedor || '—')}</dd>
          <dt>Marca</dt><dd>${escapeHtml(produto.marca || '—')}</dd>
          <dt>Categoria</dt><dd>${escapeHtml(produto.categoria || '—')}</dd>
          <dt>Subcategoria</dt><dd>${escapeHtml(produto.subcategoria || '—')}</dd>
          <dt>NCM</dt><dd>${escapeHtml(produto.ncm || '—')}</dd>
          <dt>CEST</dt><dd>${escapeHtml(produto.cest || '—')}</dd>
          <dt>Unidade</dt><dd>${escapeHtml(produto.unidade || '—')}</dd>
          <dt>Preço de Venda</dt><dd>${produto.preco_venda != null ? formatarMoeda(produto.preco_venda) : '—'}</dd>
          <dt>Último Custo</dt><dd>${produto.preco_compra != null ? formatarMoeda(produto.preco_compra) : '—'}</dd>
          <dt>Saldo Estoque</dt><dd>${produto.estoque != null ? escapeHtml(produto.estoque) : '—'}</dd>
        </dl>
      </div>
    `;
  }

  function renderPainelCentro(pendencia, comparacao, produto) {
    const score = Number(pendencia?.score ?? 0);
    if (!produto || !produto.id) {
      return `
        <div class="miip-v2-col miip-v2-col--centro">
          <header class="miip-v2-col-header">Comparação Inteligente</header>
          ${renderMotivosSemCandidato(pendencia)}
        </div>
      `;
    }
    return `
      <div class="miip-v2-col miip-v2-col--centro">
        <header class="miip-v2-col-header">Comparação Inteligente</header>
        ${renderBarraConfianca(score)}
        ${pendencia.nivelCerteza ? `<p class="miip-v2-nivel small text-muted">${escapeHtml(pendencia.nivelCerteza)}</p>` : ''}
        ${renderLinhasComparacao(comparacao?.linhas || [])}
        ${renderJustificativa(pendencia)}
        ${renderPainelDivergencias(comparacao?.divergencias || [])}
      </div>
    `;
  }

  function renderPainelIdentificadores(pendencia, sessao) {
    const I = intel();
    const xml = pendencia.produtoXML || sessao?.itens?.[pendencia.indice] || {};
    const produtoBase = pendencia.produtoEncontrado
      || pendencia.candidatoSelecionado?.produto
      || {};
    const produto = I?.enriquecerProdutoCds
      ? (I.enriquecerProdutoCds(produtoBase, estado?.opcoes?.produtos || []) || produtoBase)
      : produtoBase;
    const expandido = I?.painelExpandido
      ? I.painelExpandido(obterPaineisUi(), 'identificadores')
      : true;

    return `
      <div class="miip-painel miip-central-identificadores miip-v2-identificadores${expandido ? '' : ' miip-painel--recolhido'}"
        data-miip-painel="identificadores" data-miip-painel-auxiliar id="miipV2Identificadores">
        <button type="button" class="miip-painel-toggle" data-miip-painel-toggle="identificadores"
          aria-expanded="${expandido ? 'true' : 'false'}">
          <h6 class="mb-0">Identificadores</h6>
          <span class="miip-painel-chevron" aria-hidden="true">${chevronPainel(expandido)}</span>
        </button>
        <div class="miip-painel-corpo">
          <div class="miip-id-grid">
            <div class="miip-id-col">
              <strong class="miip-id-titulo">XML</strong>
              <dl class="miip-central-dl miip-central-dl--grid">
                <dt>GTIN</dt><dd>${escapeHtml(xml.codigo_barras || xml.gtin || '—')}</dd>
                <dt>Código fornecedor</dt><dd>${escapeHtml(xml.codigo_fornecedor || '—')}</dd>
                <dt>NCM</dt><dd>${escapeHtml(xml.ncm || '—')}</dd>
                <dt>CEST</dt><dd>${escapeHtml(xml.cest || '—')}</dd>
              </dl>
            </div>
            <div class="miip-id-col">
              <strong class="miip-id-titulo">CDS</strong>
              <dl class="miip-central-dl miip-central-dl--grid">
                <dt>GTIN</dt><dd>${escapeHtml(produto.codigoBarras || produto.codigo_barras || '—')}</dd>
                <dt>PLU</dt><dd>${escapeHtml(produto.plu || '—')}</dd>
                <dt>Código interno</dt><dd>${escapeHtml(produto.codigo || '—')}</dd>
                <dt>NCM</dt><dd>${escapeHtml(produto.ncm || '—')}</dd>
                <dt>CEST</dt><dd>${escapeHtml(produto.cest || '—')}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /** Compat RC9.3 — mantido como alias fino para divergências V2. */
  function renderDivergencias(diffs) {
    return renderPainelDivergencias(diffs || []);
  }

  function focarSecaoMiip(seletor, painelId) {
    if (painelId) {
      const I = intel();
      const $painel = $(`[data-miip-painel="${painelId}"]`);
      if ($painel.length) {
        if (I && estado?.inteligencia) {
          const paineis = obterPaineisUi();
          if (I.painelExpandido && !I.painelExpandido(paineis, painelId)) {
            estado.inteligencia.paineis = I.alternarPainel
              ? I.alternarPainel(paineis, painelId)
              : { ...paineis, [painelId]: true };
            persistirPrefsUi();
            aplicarTogglePainelDom($painel, true);
          }
        }
        aplicarTogglePainelDom($painel, true);
      }
    }
    const el = document.querySelector(seletor);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderComparacaoV2(pendencia, sessao) {
    const I = intel();
    const xml = pendencia.produtoXML || sessao.itens[pendencia.indice] || {};
    const linha = obterLinhaIntel(pendencia.indice);
    const mie = obterMieDaPendencia(pendencia);
    const produtosLista = estado?.opcoes?.produtos || [];
    const produtoBase = pendencia.produtoEncontrado
      || pendencia.candidatoSelecionado?.produto
      || null;
    const produto = produtoBase && I?.enriquecerProdutoCds
      ? I.enriquecerProdutoCds(produtoBase, produtosLista)
      : produtoBase;

    const semanticXml = pendencia?.miip_resultado?._meta?.semanticProduct
      || pendencia?.semanticProduct
      || null;
    const tipoXml = (semanticXml?.tipo && (semanticXml.tipo.valor || semanticXml.tipo))
      || xml.tipo
      || xml.tipo_produto
      || '';
    const tipoCds = produto?.tipo
      || produto?.tipo_produto
      || (pendencia?.candidatoSelecionado?.atributosExtraidos?.tipo)
      || '';

    const comparacao = I?.montarComparacaoVisual
      ? I.montarComparacaoVisual(xml, produto || {}, {
        fornecedorXml: sessao.fornecedor,
        fornecedor: sessao.fornecedor,
        tipoXml,
        tipoCds
      })
      : { linhas: [], divergencias: [], iguais: 0, total: 0 };

    return `
      <div class="miip-v2-area">
        <div class="miip-v2-triplice">
          ${renderPainelXml(xml, sessao, mie)}
          ${renderPainelCentro(pendencia, comparacao, produto)}
          ${renderPainelCds(produto, sessao)}
        </div>
        ${renderImagensLadoALado(xml, produto)}
        ${renderTopCandidatosTabela(pendencia, produtosLista)}
        <div class="miip-v2-auxiliares">
          ${renderPainelIdentificadores(pendencia, sessao)}
          ${renderPainelSugestaoPreco(linha)}
          ${renderHistoricoComercial(pendencia)}
        </div>
        ${renderRodapeMotores(pendencia, sessao)}
      </div>
    `;
  }

  function montarSessao(dadosImportacao) {
    const miip = dadosImportacao?.miip_importacao || {};
    const resultados = miip.resultados || [];
    // RC8.4.0 — deep clone dos itens (estado independente por linha)
    let itens;
    try {
      itens = typeof structuredClone === 'function'
        ? structuredClone(dadosImportacao?.itens || [])
        : JSON.parse(JSON.stringify(dadosImportacao?.itens || []));
    } catch {
      itens = (dadosImportacao?.itens || []).map((item) => ({ ...item }));
    }

    return {
      dadosImportacao,
      operacaoId: miip.operacaoId || dadosImportacao?.chave_acesso || null,
      resumo: {
        totalItens: Number(miip.resumo?.totalItens ?? itens.length),
        identificadosAutomaticamente: Number(miip.resumo?.identificadosAutomaticamente ?? 0),
        precisamConfirmacao: Number(miip.resumo?.precisamConfirmacao ?? 0),
        precisamCadastro: Number(miip.resumo?.precisamCadastro ?? 0),
        tempoProcessamento: Number(miip.resumo?.tempoProcessamento ?? 0)
      },
      fornecedor: dadosImportacao?.fornecedor || '',
      fornecedorCnpj: dadosImportacao?.fornecedor_cnpj || '',
      pendencias: ordenarPendencias(extrairPendencias(resultados)),
      itens,
      indiceAtual: 0,
      resolvidas: [],
      ignoradas: [],
      aprendizados: 0,
      confirmadosManualmente: 0,
      fase: 'revisao'
    };
  }

  function pendenciaAberta(sessao, pendencia) {
    return !sessao.resolvidas.includes(pendencia.indice)
      && !sessao.ignoradas.includes(pendencia.indice);
  }

  function contarAbertas(sessao) {
    return sessao.pendencias.filter((p) => pendenciaAberta(sessao, p)).length;
  }

  function proximaAberta(sessao, direcao) {
    const total = sessao.pendencias.length;
    let idx = sessao.indiceAtual;
    for (let i = 0; i < total; i += 1) {
      idx = (idx + direcao + total) % total;
      if (pendenciaAberta(sessao, sessao.pendencias[idx])) {
        sessao.indiceAtual = idx;
        return;
      }
    }
  }

  function notificar(mensagem, tipo) {
    const container = document.getElementById('notification-container');
    if (container) {
      container.style.zIndex = '23000';
    }
    if (typeof showNotification === 'function') {
      showNotification(mensagem, tipo || 'info');
    }
  }

  function mostrarAprendizado() {
    const toast = document.getElementById('miipCentralAprendizadoToast');
    if (!toast) return;
    toast.classList.add('miip-central-toast--visivel');
    setTimeout(() => toast.classList.remove('miip-central-toast--visivel'), 4200);
  }

  function enviarAprendizado(pendencia, produtoId, produto) {
    const { opcoes, sessao } = estado;
    const item = sessao.itens[pendencia.indice] || pendencia.produtoXML || {};
    const usuario = opcoes.obterUsuario ? opcoes.obterUsuario() : null;
    const fornecedorCnpj = sessao.fornecedorCnpj;

    if (!fornecedorCnpj || !item.codigo_fornecedor) return Promise.resolve(false);

    return $.ajax({
      url: `${opcoes.apiUrl}/miip/feedback`,
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        confirmado: true,
        produtoId: Number(produtoId),
        fornecedorCnpj,
        codigoFornecedor: item.codigo_fornecedor,
        fornecedorNome: sessao.fornecedor,
        nomeItem: item.produto_nome,
        codigoBarras: item.codigo_barras,
        ncm: item.ncm,
        unidade: item.unidade,
        usuarioId: usuario?.id ?? null,
        operacaoId: pendencia.operacaoId || sessao.operacaoId,
        origem: 'Confirmacao Manual',
        origemDetalhe: 'central_revisao_miip',
        item
      })
    }).then(() => true).catch(() => false);
  }

  function renderDashboardImpacto() {
    const impacto = estado?.inteligencia?.impacto;
    if (!impacto) return '';

    if (!impacto.disponivel) {
      const expVazio = intel()?.painelExpandido
        ? intel().painelExpandido(obterPaineisUi(), 'dashboardComercial')
        : true;
      return `
        <div class="miip-painel miip-dash-impacto miip-dash-impacto--vazio${expVazio ? '' : ' miip-painel--recolhido'}"
          data-miip-painel="dashboardComercial" data-miip-painel-auxiliar>
          <button type="button" class="miip-painel-toggle" data-miip-painel-toggle="dashboardComercial"
            aria-expanded="${expVazio ? 'true' : 'false'}">
            <h6 class="mb-0">Dashboard Comercial</h6>
            <span class="miip-painel-chevron" aria-hidden="true">${chevronPainel(expVazio)}</span>
          </button>
          <div class="miip-painel-corpo">
            <p class="mb-0">${escapeHtml(impacto.mensagem || 'Histórico insuficiente para cálculo financeiro.')}</p>
          </div>
        </div>
      `;
    }

    const saldoClasse = Number(impacto.saldo) >= 0 ? 'positivo' : 'negativo';
    const fmtSinal = (v) => {
      const n = Number(v) || 0;
      const abs = formatarMoeda(Math.abs(n));
      return n > 0 ? `+${abs}` : (n < 0 ? `-${abs}` : abs);
    };

    const cardMaior = (titulo, item, tom) => {
      if (!item) {
        return `
          <div class="miip-dash-maior miip-dash-maior--${tom}">
            <span class="miip-dash-maior-titulo">${escapeHtml(titulo)}</span>
            <span class="text-muted">—</span>
          </div>`;
      }
      return `
        <div class="miip-dash-maior miip-dash-maior--${tom}"
          title="${escapeHtml(item.tooltip || '')}"
          data-bs-toggle="tooltip" data-bs-placement="top">
          <span class="miip-dash-maior-titulo">${escapeHtml(titulo)}</span>
          <strong class="miip-dash-maior-nome">${escapeHtml(item.nome)}</strong>
          <span class="miip-dash-maior-valor">${fmtSinal(item.impactoAbsoluto)}</span>
        </div>`;
    };

    const expandido = intel()?.painelExpandido
      ? intel().painelExpandido(obterPaineisUi(), 'dashboardComercial')
      : true;

    return `
      <div class="miip-painel miip-dash-impacto${expandido ? '' : ' miip-painel--recolhido'}"
        data-miip-painel="dashboardComercial" data-miip-painel-auxiliar
        aria-label="Dashboard de impacto comercial (somente leitura)">
        <button type="button" class="miip-painel-toggle" data-miip-painel-toggle="dashboardComercial"
          aria-expanded="${expandido ? 'true' : 'false'}">
          <h6 class="mb-0">Dashboard Comercial</h6>
          <span class="miip-painel-chevron" aria-hidden="true">${chevronPainel(expandido)}</span>
        </button>
        <div class="miip-painel-corpo">
          <div class="miip-dash-impacto-grid">
            <div class="miip-dash-card miip-dash-card--financeiro">
              <h6>Impacto Financeiro</h6>
              <div class="miip-dash-metricas">
                <div class="miip-dash-metrica miip-dash-metrica--aumento"
                  title="Soma dos aumentos de custo (NF-e − cadastro) × quantidade">
                  <span>▲ Aumento Total</span>
                  <strong>${formatarMoeda(impacto.aumentoTotal)}</strong>
                </div>
                <div class="miip-dash-metrica miip-dash-metrica--reducao"
                  title="Soma das reduções de custo (cadastro − NF-e) × quantidade">
                  <span>▼ Redução Total</span>
                  <strong>${formatarMoeda(impacto.reducaoTotal)}</strong>
                </div>
                <div class="miip-dash-metrica miip-dash-metrica--saldo-${saldoClasse}"
                  title="Saldo líquido = aumento total − redução total">
                  <span>Saldo da NF</span>
                  <strong>${fmtSinal(impacto.saldo)}</strong>
                </div>
              </div>
            </div>
            <div class="miip-dash-card miip-dash-card--resumo">
              <h6>Resumo Comercial</h6>
              <div class="miip-dash-metricas miip-dash-metricas--compact">
                <div class="miip-dash-metrica"><span>Produtos</span><strong>${impacto.produtos}</strong></div>
                <div class="miip-dash-metrica"><span>Produtos Alterados</span><strong>${impacto.produtosAlterados}</strong></div>
                <div class="miip-dash-metrica"><span>Produtos Novos</span><strong>${impacto.produtosNovos}</strong></div>
              </div>
              <div class="miip-dash-maiores">
                ${cardMaior('Maior aumento', impacto.maiorAumento, 'aumento')}
                ${cardMaior('Maior redução', impacto.maiorReducao, 'reducao')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderResumoTopo(sessao) {
    const precisao = calcularPrecisao(sessao.resumo, sessao.confirmadosManualmente);
    const ind = estado?.inteligencia?.indicadores;
    const blocoIntel = ind ? `
        <div class="miip-central-metrica"><span>Produtos</span><strong>${ind.produtos}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--info"><span>Produtos Novos</span><strong>${ind.produtosNovos}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--warn"><span>Custo Aumentou</span><strong>${ind.custoAumentou}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--ok"><span>Custo Reduziu</span><strong>${ind.custoReduziu}</strong></div>
        <div class="miip-central-metrica"><span>Sem Alteração</span><strong>${ind.semAlteracao}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--alert"><span>Sem Cadastro</span><strong>${ind.semCadastro}</strong></div>
    ` : '';
    return `
      ${renderDashboardImpacto()}
      <div class="miip-central-resumo-grid" data-miip-foco-ocultar>
        ${blocoIntel}
        <div class="miip-central-metrica"><span>Itens da Nota</span><strong>${sessao.resumo.totalItens}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--ok"><span>Associados automaticamente</span><strong>${sessao.resumo.identificadosAutomaticamente}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--warn"><span>Precisam confirmação</span><strong>${sessao.resumo.precisamConfirmacao}</strong></div>
        <div class="miip-central-metrica miip-central-metrica--alert"><span>Precisam cadastro</span><strong>${sessao.resumo.precisamCadastro}</strong></div>
        <div class="miip-central-metrica"><span>Precisão desta importação</span><strong>${precisao}%</strong></div>
        <div class="miip-central-metrica"><span>Tempo de processamento</span><strong>${formatarTempo(sessao.resumo.tempoProcessamento)}</strong></div>
      </div>
      <div data-miip-foco-ocultar>${renderFiltrosInteligencia()}</div>
      <div data-miip-foco-ocultar>${renderTabelaComparadorCustos()}</div>
    `;
  }

  function renderFiltrosInteligencia() {
    if (!estado?.inteligencia) return '';
    const I = intel();
    const ativo = estado.inteligencia.filtroAtivo || I?.FILTROS?.TODOS || 'todos';
    const filtros = [
      { id: 'todos', label: 'Todos' },
      { id: 'alterados', label: 'Alterados' },
      { id: 'novos', label: 'Novos' },
      { id: 'sem_cadastro', label: 'Sem Cadastro' },
      { id: 'divergentes', label: 'Divergentes' }
    ];
    return `
      <div class="miip-central-filtros" role="group" aria-label="Filtros rápidos (somente visual)">
        ${filtros.map((f) => `
          <button type="button" class="btn btn-sm ${ativo === f.id ? 'btn-primary' : 'btn-outline-secondary'}"
            data-miip-filtro="${f.id}">${escapeHtml(f.label)}</button>
        `).join('')}
        <span class="miip-central-filtros-hint">Somente leitura — nenhum preço é gravado</span>
      </div>
    `;
  }

  function renderTabelaComparadorCustos() {
    const I = intel();
    if (!estado?.inteligencia || !I) return '';
    const linhas = I.filtrarLinhas(estado.inteligencia, estado.inteligencia.filtroAtivo);
    if (!linhas.length) {
      return `<div class="miip-central-comparador"><p class="small text-muted mb-0">Nenhum item neste filtro.</p></div>`;
    }
    return `
      <div class="miip-central-comparador">
        <div class="miip-central-comparador-titulo">Comparador de custos <small>(somente leitura)</small></div>
        <div class="table-responsive">
          <table class="table table-sm miip-central-comparador-table mb-0">
            <thead>
              <tr>
                <th></th>
                <th>Produto</th>
                <th class="text-end">Custo Atual</th>
                <th class="text-end">Custo NF-e</th>
                <th class="text-end">Diferença %</th>
                <th>Situação</th>
                <th class="text-end">Preço Atual</th>
                <th class="text-end">Margem</th>
                <th class="text-end">Preço Sugerido</th>
              </tr>
            </thead>
            <tbody>
              ${linhas.map((l) => {
                const meta = I.metaSituacao(l.situacao);
                return `
                  <tr data-intel-indice="${l.indice}" class="miip-central-comparador-row miip-sit--${escapeHtml(meta.cor)}">
                    <td><i class="fas ${meta.icone} miip-sit-icone miip-sit-icone--${escapeHtml(meta.cor)}" title="${escapeHtml(meta.label)}"></i></td>
                    <td>${escapeHtml(l.nome)}</td>
                    <td class="text-end">${l.custoAtual != null ? formatarMoeda(l.custoAtual) : '—'}</td>
                    <td class="text-end">${formatarMoeda(l.custoNfe)}</td>
                    <td class="text-end">${escapeHtml(I.formatarDiffPct(l.diferencaPct))}</td>
                    <td><span class="miip-central-tag miip-central-tag--${escapeHtml(meta.tom)}">${escapeHtml(meta.label)}</span></td>
                    <td class="text-end">${l.precoAtual != null ? formatarMoeda(l.precoAtual) : '—'}</td>
                    <td class="text-end">${Number(l.margemAtual).toFixed(1)}%</td>
                    <td class="text-end">${formatarMoeda(l.precoSugerido)}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function obterLinhaIntel(indice) {
    return (estado?.inteligencia?.linhas || []).find((l) => Number(l.indice) === Number(indice)) || null;
  }

  function renderPainelSugestaoPreco(linha) {
    if (!linha) return '';
    return `
      <div class="miip-central-sugestao">
        <h6>Sugestão de preço <small class="text-muted">(não grava automaticamente)</small></h6>
        <dl class="miip-central-dl miip-central-dl--grid">
          <dt>Preço Atual</dt><dd>${linha.precoAtual != null ? formatarMoeda(linha.precoAtual) : '—'}</dd>
          <dt>Margem Atual</dt><dd>${Number(linha.margemAtual).toFixed(1)}%</dd>
          <dt>Novo Custo (NF-e)</dt><dd>${formatarMoeda(linha.novoCusto)}</dd>
          <dt>Preço Sugerido</dt><dd><strong>${formatarMoeda(linha.precoSugerido)}</strong></dd>
        </dl>
      </div>
    `;
  }

  function renderResumoFinalBar() {
    const ind = estado?.inteligencia?.indicadores;
    if (!ind) return '';
    return `
      <div class="miip-central-resumo-final">
        <div class="miip-central-resumo-final-grid">
          <span>Produtos: <strong>${ind.produtos}</strong></span>
          <span>Produtos Novos: <strong>${ind.produtosNovos}</strong></span>
          <span>Custo Alterado: <strong>${ind.custoAlterado}</strong></span>
          <span>Sem Cadastro: <strong>${ind.semCadastro}</strong></span>
        </div>
        <p class="miip-central-resumo-final-msg mb-0">${escapeHtml(estado.inteligencia.mensagemResumo || 'Nenhum preço será alterado automaticamente.')}</p>
      </div>
    `;
  }

  /**
   * Tela final da revisão: um único CTA — Finalizar Entrada → abre Compras.
   */
  function renderTelaFinalizarEntrada() {
    const { sessao } = estado;
    const ind = estado?.inteligencia?.indicadores;
    const total = sessao.pendencias.length || sessao.itens.length || 0;
    const resolvidas = sessao.resolvidas.length;
    const ignoradas = sessao.ignoradas.length;

    $('#miipCentralResumo').html(`
      <div class="miip-central-resumo miip-central-resumo--finalizar">
        <strong><i class="fas fa-check-circle text-success me-1"></i> Revisão concluída</strong>
        <span class="ms-2 text-muted">${resolvidas} confirmado(s) · ${ignoradas} ignorado(s) · ${total} item(ns)</span>
      </div>
    `);
    $('#miipCentralLista').html('');
    $('#miipCentralDetalhes').html(`
      <div class="p-4 text-center miip-central-finalizar-entrada">
        <h4 class="mb-2">Pronto para finalizar a entrada</h4>
        <p class="text-muted mb-4">
          As decisões foram salvas. Ao finalizar, a Compra será aberta automaticamente
          com os dados da NF-e para conferência. A compra <strong>não</strong> será gravada automaticamente.
        </p>
        ${ind ? `
          <div class="miip-central-resumo-final mb-4 d-inline-block text-start">
            <div class="miip-central-resumo-final-grid">
              <span>Produtos: <strong>${ind.produtos}</strong></span>
              <span>Produtos Novos: <strong>${ind.produtosNovos}</strong></span>
              <span>Custo Alterado: <strong>${ind.custoAlterado}</strong></span>
              <span>Sem Cadastro: <strong>${ind.semCadastro}</strong></span>
            </div>
          </div>
        ` : ''}
        <div>
          <button type="button" class="btn btn-success btn-lg" id="miipCentralBtnFinalizarEntrada">
            <i class="fas fa-check-double me-1"></i> Finalizar Entrada
          </button>
        </div>
        <p class="small text-muted mt-3 mb-0">Você será levado para Compras para conferir e salvar.</p>
      </div>
    `);
    $('#miipCentralCandidato').html('');
    $('#miipCentralResumoFinal').html('');
    $('#miipCentralContador').text('Revisão concluída');
    $('#miipCentralProgressoPersistente').html(
      '<span class="miip-central-progresso-label">Pronto</span><strong>Finalizar Entrada para abrir Compras</strong>'
    );

    $('#miipCentralBtnFinalizarEntrada').off('click.miipFinalizar').on('click.miipFinalizar', function () {
      const $btn = $(this);
      if ($btn.prop('disabled') || estado?._encerrando) return;
      $btn.prop('disabled', true);
      $btn.html('<i class="fas fa-spinner fa-spin me-1"></i> Finalizando entrada...');
      encerrarRevisaoAutomaticamente('finalizar_entrada_manual');
    });
  }

  function renderAcoesRapidasDocumento() {
    const doc = estado?.opcoes?.documento || {};
    const id = doc.id;
    if (!id) return '';
    return `
      <div class="miip-central-acoes-doc btn-group btn-group-sm" role="group" aria-label="Ações do documento">
        <button type="button" class="btn btn-outline-light" data-miip-acao="copiar-chave" title="Copiar Chave"><i class="fas fa-key"></i></button>
        <button type="button" class="btn btn-outline-light" data-miip-acao="ver-xml" title="Visualizar XML"><i class="fas fa-file-code"></i></button>
        <button type="button" class="btn btn-outline-light" data-miip-acao="reprocessar" title="Reprocessar XML"><i class="fas fa-redo"></i></button>
        <button type="button" class="btn btn-outline-light" data-miip-acao="historico" title="Histórico"><i class="fas fa-history"></i></button>
        ${doc.permiteImportarXml ? `<button type="button" class="btn btn-outline-warning" data-miip-acao="importar-xml" title="Importar XML"><i class="fas fa-file-upload"></i></button>` : ''}
      </div>
    `;
  }

  function obterPrefsUi() {
    const I = intel();
    const intelState = estado?.inteligencia || {};
    const paineis = I?.normalizarPaineis
      ? I.normalizarPaineis(intelState.paineis)
      : {
        dashboardComercial: true,
        historicoComercial: true,
        ultimasCompras: intelState.ultimasComprasExpandido !== false
      };
    return {
      ordenacao: intelState.ordenacao || I?.ORDENS?.NFE || 'nfe',
      filtro: intelState.filtroAtivo || I?.FILTROS?.TODOS || 'todos',
      fixarPrioritarios: intelState.fixarPrioritarios === true,
      paineis,
      ultimasComprasExpandido: paineis.ultimasCompras !== false,
      modoFoco: intelState.modoFoco === true
    };
  }

  function persistirPrefsUi() {
    const I = intel();
    if (!I || !estado?.inteligencia) return;
    const paineis = I.normalizarPaineis
      ? I.normalizarPaineis(estado.inteligencia.paineis)
      : { ultimasCompras: estado.inteligencia.ultimasComprasExpandido !== false };
    I.salvarPrefsLocal({
      ordenacao: estado.inteligencia.ordenacao || 'nfe',
      filtro: estado.inteligencia.filtroAtivo || 'todos',
      fixarPrioritarios: estado.inteligencia.fixarPrioritarios === true,
      paineis,
      ultimasComprasExpandido: paineis.ultimasCompras !== false,
      modoFoco: estado.inteligencia.modoFoco === true
    });
  }

  function obterPaineisUi() {
    const prefs = obterPrefsUi();
    return prefs.paineis;
  }

  function chevronPainel(expandido) {
    return expandido ? '▼' : '▶';
  }

  function aplicarTogglePainelDom($painel, expandido) {
    if (!$painel || !$painel.length) return;
    $painel.toggleClass('miip-painel--recolhido', !expandido);
    $painel.find('[data-miip-painel-toggle]').attr('aria-expanded', expandido ? 'true' : 'false');
    $painel.find('.miip-painel-chevron').text(chevronPainel(expandido));
  }

  function sincronizarPaineisDom() {
    const I = intel();
    const paineis = obterPaineisUi();
    $('#miipCentralCorpo [data-miip-painel]').each(function syncPainel() {
      const id = String($(this).data('miip-painel') || '');
      const expandido = I?.painelExpandido ? I.painelExpandido(paineis, id) : true;
      aplicarTogglePainelDom($(this), expandido);
    });
  }

  function aplicarModoFocoDom() {
    const on = estado?.inteligencia?.modoFoco === true;
    $('#miipCentralCorpo').toggleClass('miip-central--modo-foco', on);
    const $btn = $('#miipCentralBtnModoFoco');
    $btn.toggleClass('active miip-btn-foco--ativo', on);
    $btn.attr('aria-pressed', on ? 'true' : 'false');
    $btn.text(on ? 'Sair do Modo Foco' : 'Modo Foco');
  }

  function alternarModoFocoUi() {
    const I = intel();
    if (!I || !estado?.inteligencia) return;
    const atual = {
      modoFoco: estado.inteligencia.modoFoco === true,
      paineis: obterPaineisUi(),
      _focoSnapshot: estado.inteligencia._focoSnapshot || null
    };
    const proximo = I.aplicarModoFocoLayout(atual, !atual.modoFoco);
    estado.inteligencia.modoFoco = proximo.modoFoco;
    estado.inteligencia.paineis = proximo.paineis;
    estado.inteligencia._focoSnapshot = proximo._focoSnapshot;
    estado.inteligencia.ultimasComprasExpandido = proximo.paineis.ultimasCompras !== false;
    persistirPrefsUi();
    aplicarModoFocoDom();
    sincronizarPaineisDom();
  }

  function formatarDataCurta(valor) {
    if (!valor) return '—';
    const s = String(valor).trim();
    if (!s) return '—';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const mBr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mBr) return `${mBr[1].padStart(2, '0')}/${mBr[2].padStart(2, '0')}/${mBr[3]}`;
    try {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString('pt-BR');
      }
    } catch (_) { /* ignore */ }
    return s;
  }

  function obterProdutoIdPendencia(pendencia) {
    const linha = obterLinhaIntel(pendencia?.indice);
    return pendencia?.produtoEncontrado?.id
      || pendencia?.candidatoSelecionado?.produto?.id
      || linha?.produtoId
      || null;
  }

  function iniciarFetchUltimasCompras(produtoId) {
    const I = intel();
    if (!I || !estado?.inteligencia || !produtoId) return;
    if (!estado.inteligencia.cacheUltimasCompras) {
      estado.inteligencia.cacheUltimasCompras = {};
    }
    if (!estado.inteligencia._ultimasComprasInflight) {
      estado.inteligencia._ultimasComprasInflight = {};
    }
    const cache = estado.inteligencia.cacheUltimasCompras;
    const inflight = estado.inteligencia._ultimasComprasInflight;
    const key = String(produtoId);

    // RC3.7.6.4 Etapa 6 — 1 busca por produto_id; reentrada usa só o cache
    if (typeof I.precisaBuscarUltimasCompras === 'function') {
      if (!I.precisaBuscarUltimasCompras(cache, produtoId) || inflight[key]) return;
    } else if (cache[key] || inflight[key]) {
      return;
    }
    inflight[key] = true;
    I.gravarCacheUltimasCompras(cache, produtoId, { status: 'loading' });

    const apiUrl = estado.opcoes?.apiUrl || (typeof API_URL !== 'undefined' ? API_URL : '/api');
    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
    const limite = I.ULTIMAS_COMPRAS_LIMITE || 5;

    fetch(`${apiUrl}/produtos/${encodeURIComponent(produtoId)}/ultimas-compras?limite=${limite}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!estado?.inteligencia?.cacheUltimasCompras) return;
        const view = I.montarUltimasCompras(Array.isArray(rows) ? rows : [], limite);
        I.gravarCacheUltimasCompras(estado.inteligencia.cacheUltimasCompras, produtoId, { status: 'ok', view });
        refrescarCardUltimasComprasSeAtual(produtoId);
      })
      .catch(() => {
        if (!estado?.inteligencia?.cacheUltimasCompras) return;
        const view = I.montarUltimasCompras([], limite);
        I.gravarCacheUltimasCompras(estado.inteligencia.cacheUltimasCompras, produtoId, { status: 'ok', view });
        refrescarCardUltimasComprasSeAtual(produtoId);
      })
      .finally(() => {
        if (estado?.inteligencia?._ultimasComprasInflight) {
          delete estado.inteligencia._ultimasComprasInflight[key];
        }
      });
  }

  /** Libera cache de Últimas Compras ao encerrar a revisão. */
  function liberarCacheUltimasComprasRevisao() {
    const I = intel();
    if (!estado?.inteligencia) return;
    if (I && typeof I.liberarCacheUltimasCompras === 'function') {
      I.liberarCacheUltimasCompras(estado.inteligencia.cacheUltimasCompras);
    }
    estado.inteligencia.cacheUltimasCompras = null;
    estado.inteligencia._ultimasComprasInflight = null;
  }

  function refrescarCardUltimasComprasSeAtual(produtoId) {
    if (!estado?.sessao) return;
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    const atual = obterProdutoIdPendencia(pendencia);
    if (Number(atual) !== Number(produtoId)) return;
    const $host = $('#miipUltimasComprasHost');
    if ($host.length) {
      $host.html(renderUltimasCompras(pendencia));
    }
  }

  function renderUltimasCompras(pendencia) {
    const I = intel();
    if (!I || typeof I.montarUltimasCompras !== 'function') return '';

    const produtoId = obterProdutoIdPendencia(pendencia);
    const expandido = I.painelExpandido
      ? I.painelExpandido(obterPaineisUi(), I.PAINEIS?.ULTIMAS || 'ultimasCompras')
      : (estado?.inteligencia?.ultimasComprasExpandido !== false);

    const cabecalho = (extraBadge = '') => `
      <button type="button" class="miip-painel-toggle miip-uc-toggle" data-miip-painel-toggle="ultimasCompras"
        aria-expanded="${expandido ? 'true' : 'false'}"
        title="Recolher / expandir Últimas Compras">
        <h6 class="mb-0">Últimas Compras <small class="text-muted">(somente leitura)</small>${extraBadge}</h6>
        <span class="miip-painel-chevron" aria-hidden="true">${chevronPainel(expandido)}</span>
      </button>
    `;

    function montarCard(corpoHtml, badge = '') {
      return `
        <div class="miip-painel miip-ultimas-compras${expandido ? '' : ' miip-painel--recolhido'}"
          id="miipUltimasComprasCard" data-miip-painel="ultimasCompras" data-miip-painel-auxiliar>
          ${cabecalho(badge)}
          <div class="miip-painel-corpo miip-uc-body">${corpoHtml}</div>
        </div>
      `;
    }

    if (!produtoId) {
      return montarCard(
        `<p class="miip-uc-vazio mb-0">${escapeHtml(I.MSG_SEM_COMPRAS || 'Nenhuma compra anterior encontrada.')}</p>`
      );
    }

    if (!estado.inteligencia.cacheUltimasCompras) {
      estado.inteligencia.cacheUltimasCompras = {};
    }
    const cache = estado.inteligencia.cacheUltimasCompras;
    if (I.precisaBuscarUltimasCompras(cache, produtoId)) {
      iniciarFetchUltimasCompras(produtoId);
    }
    const entry = I.lerCacheUltimasCompras(cache, produtoId);

    if (!entry || entry.status === 'loading') {
      return montarCard('<p class="miip-uc-loading mb-0 text-muted">Carregando histórico…</p>');
    }

    const view = entry.view || I.montarUltimasCompras([]);
    if (!view.disponivel) {
      return montarCard(
        `<p class="miip-uc-vazio mb-0">${escapeHtml(view.mensagem || I.MSG_SEM_COMPRAS)}</p>`
      );
    }

    const linhas = (view.registros || []).map((r) => {
      const classes = ['miip-uc-row'];
      if (r.ehUltimaCompra) classes.push('miip-uc-row--ultima');
      if (r.ehMenorCusto) classes.push('miip-uc-row--menor');
      if (r.ehMaiorCusto) classes.push('miip-uc-row--maior');
      const badges = [];
      if (r.ehUltimaCompra) badges.push('<span class="miip-uc-badge miip-uc-badge--ultima">Última</span>');
      if (r.ehMenorCusto) badges.push('<span class="miip-uc-badge miip-uc-badge--menor">Menor custo</span>');
      if (r.ehMaiorCusto) badges.push('<span class="miip-uc-badge miip-uc-badge--maior">Maior custo</span>');
      return `
        <tr class="${classes.join(' ')}">
          <td>${escapeHtml(formatarDataCurta(r.data))}${badges.length ? `<div class="miip-uc-badges">${badges.join('')}</div>` : ''}</td>
          <td>${escapeHtml(r.fornecedor || '—')}</td>
          <td>${r.custo != null ? formatarMoeda(r.custo) : '—'}</td>
          <td>${r.quantidade != null ? escapeHtml(String(r.quantidade)) : '—'}</td>
          <td>${escapeHtml(r.nfe || '—')}</td>
        </tr>
      `;
    }).join('');

    const resumo = view.resumo || {};
    const corpo = `
      <div class="table-responsive">
        <table class="table table-sm mb-2 miip-uc-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Fornecedor</th>
              <th>Custo</th>
              <th>Quantidade</th>
              <th>NF-e</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <dl class="miip-uc-resumo miip-central-dl miip-central-dl--grid mb-0">
        <dt>Menor custo encontrado</dt>
        <dd>${resumo.menorCusto != null ? formatarMoeda(resumo.menorCusto) : '—'}</dd>
        <dt>Maior custo encontrado</dt>
        <dd>${resumo.maiorCusto != null ? formatarMoeda(resumo.maiorCusto) : '—'}</dd>
        <dt>Último custo</dt>
        <dd>${resumo.ultimoCusto != null ? formatarMoeda(resumo.ultimoCusto) : '—'}</dd>
        <dt>Compras analisadas</dt>
        <dd>${resumo.quantidadeAnalisadas != null ? resumo.quantidadeAnalisadas : 0}</dd>
      </dl>
    `;
    return montarCard(corpo, ` <span class="miip-uc-count">${resumo.quantidadeAnalisadas || 0}</span>`);
  }

  function renderToolbarOrdenacao(linhasVisiveis) {
    const I = intel();
    if (!I?.ORDENS) return '';
    const prefs = obterPrefsUi();
    const cont = I.contarPrioridades(linhasVisiveis || []);
    const opcoes = [
      { id: I.ORDENS.NFE, label: I.labelOrdem(I.ORDENS.NFE) },
      { id: I.ORDENS.AUMENTO, label: I.labelOrdem(I.ORDENS.AUMENTO) },
      { id: I.ORDENS.REDUCAO, label: I.labelOrdem(I.ORDENS.REDUCAO) },
      { id: I.ORDENS.NOVOS, label: I.labelOrdem(I.ORDENS.NOVOS) },
      { id: I.ORDENS.SEM_CADASTRO, label: I.labelOrdem(I.ORDENS.SEM_CADASTRO) },
      { id: I.ORDENS.VALOR, label: I.labelOrdem(I.ORDENS.VALOR) },
      { id: I.ORDENS.NOME, label: I.labelOrdem(I.ORDENS.NOME) }
    ];
    return `
      <div class="miip-central-ordenacao">
        <label class="miip-central-ordenacao-label" for="miipCentralOrdenarPor">Ordenar por</label>
        <select id="miipCentralOrdenarPor" class="form-select form-select-sm" aria-label="Ordenar lista de produtos">
          ${opcoes.map((o) => `
            <option value="${o.id}" ${prefs.ordenacao === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>
          `).join('')}
        </select>
        <div class="form-check miip-central-fixar">
          <input class="form-check-input" type="checkbox" id="miipCentralFixarPrioritarios"
            ${prefs.fixarPrioritarios ? 'checked' : ''}>
          <label class="form-check-label" for="miipCentralFixarPrioritarios">Mostrar primeiro os itens prioritários</label>
        </div>
        <div class="miip-central-prio-contadores" aria-live="polite">
          <span title="Prioridade alta">🔴 Alta: <strong>${cont.alta}</strong></span>
          <span title="Prioridade média">🟡 Média: <strong>${cont.media}</strong></span>
          <span title="Prioridade baixa">🟢 Baixa: <strong>${cont.baixa}</strong></span>
        </div>
        <div class="miip-central-ordenacao-ativa">
          Ordenando por: <strong>${escapeHtml(I.labelOrdem(prefs.ordenacao))}</strong>
        </div>
      </div>
    `;
  }

  function montarEntradasListaVisivel(sessao) {
    const I = intel();
    const prefs = obterPrefsUi();
    const entradas = [];
    sessao.pendencias.forEach((pendencia, listaIdx) => {
      if (!pendenciaAberta(sessao, pendencia)) return;
      const linha = obterLinhaIntel(pendencia.indice);
      if (I && linha && !I.linhaPassaFiltro(linha, prefs.filtro)) return;
      entradas.push({ listaIdx, linha: linha || { indice: pendencia.indice, nome: pendencia.produtoXML?.produto_nome } });
    });
    if (!I?.ordenarEntradasVisuais) return entradas;
    return I.ordenarEntradasVisuais(entradas, prefs.ordenacao, prefs.fixarPrioritarios);
  }

  function renderListaPendencias(sessao) {
    const I = intel();
    const entradas = montarEntradasListaVisivel(sessao);
    const linhasVisiveis = entradas.map((e) => e.linha).filter(Boolean);

    const itensHtml = entradas.map((entrada) => {
      const idx = entrada.listaIdx;
      const pendencia = sessao.pendencias[idx];
      if (!pendencia) return '';

      const ativo = idx === sessao.indiceAtual ? ' miip-central-lista-item--ativo' : '';
      const tipo = pendencia.precisaCadastro && !pendencia.produtoEncontrado ? 'cadastro' : 'confirmacao';
      const nome = pendencia.produtoXML?.produto_nome || 'Item sem nome';
      const score = Number(pendencia.score ?? 0);
      const mie = obterMieDaPendencia(pendencia);
      const linha = entrada.linha;
      const meta = linha && I ? I.metaSituacao(linha.situacao) : null;
      const prio = I?.classificarPrioridade ? I.classificarPrioridade(linha) : null;

      return `
        <button type="button" class="miip-central-lista-item${ativo}" data-lista-idx="${idx}">
          <div class="miip-central-lista-titulo">
            ${prio ? `<span class="miip-prio miip-prio--${escapeHtml(prio.nivel)}" title="Prioridade ${escapeHtml(prio.label)}">${prio.icone}</span>` : ''}
            ${meta ? `<i class="fas ${meta.icone} miip-sit-icone miip-sit-icone--${escapeHtml(meta.cor)} me-1"></i>` : ''}
            ${escapeHtml(nome)}
          </div>
          <div class="miip-central-lista-meta">
            <span class="miip-central-tag miip-central-tag--${tipo}">${tipo === 'cadastro' ? 'Cadastro' : 'Confirmação'}</span>
            <span>${score > 0 ? `${score}%` : 'Sem candidato'}</span>
            <span class="miip-central-tag miip-central-tag--embalagem" title="Embalagem (MIE)">${escapeHtml(rotuloEmbalagemMie(mie))}</span>
          </div>
        </button>
      `;
    }).join('');

    return `${renderToolbarOrdenacao(linhasVisiveis)}<div class="miip-central-lista-itens">${itensHtml}</div>`;
  }

  function renderDetalhes(pendencia, sessao) {
    return renderComparacaoV2(pendencia, sessao);
  }

  function renderHistoricoComercial(pendencia) {
    const I = intel();
    if (!I || typeof I.montarHistoricoComercial !== 'function') return '';

    const linha = obterLinhaIntel(pendencia?.indice);
    const produtoId = pendencia?.produtoEncontrado?.id
      || pendencia?.candidatoSelecionado?.produto?.id
      || linha?.produtoId
      || null;
    const custoNfe = linha?.custoNfe != null
      ? linha.custoNfe
      : I.custoNfeDoItem(pendencia?.produtoXML || {});

    const hist = I.montarHistoricoComercial({
      produtoId,
      produtos: estado?.opcoes?.produtos || [],
      custoNfe,
      linhaIntel: linha
    });

    if (!hist.disponivel) {
      const expNovo = I.painelExpandido
        ? I.painelExpandido(obterPaineisUi(), 'historicoComercial')
        : true;
      return `
        <div class="miip-painel miip-central-historico miip-central-historico--novo${expNovo ? '' : ' miip-painel--recolhido'}"
          data-miip-painel="historicoComercial" data-miip-painel-auxiliar>
          <button type="button" class="miip-painel-toggle" data-miip-painel-toggle="historicoComercial"
            aria-expanded="${expNovo ? 'true' : 'false'}">
            <h6 class="mb-0">Histórico Comercial</h6>
            <span class="miip-painel-chevron" aria-hidden="true">${chevronPainel(expNovo)}</span>
          </button>
          <div class="miip-painel-corpo">
            <p class="miip-central-historico-novo mb-0">
              <strong>Produto Novo</strong><br>
              Histórico Comercial indisponível.
            </p>
          </div>
        </div>
        <div id="miipUltimasComprasHost">${renderUltimasCompras(pendencia)}</div>
      `;
    }

    const faixa = hist.faixa || I.corFaixaDiferencaCusto(hist.diferencaPct);
    const diffTxt = I.formatarDiffPct(hist.diferencaPct);
    const expandido = I.painelExpandido
      ? I.painelExpandido(obterPaineisUi(), 'historicoComercial')
      : true;
    return `
      <div class="miip-painel miip-central-historico${expandido ? '' : ' miip-painel--recolhido'}"
        data-miip-painel="historicoComercial" data-miip-painel-auxiliar>
        <button type="button" class="miip-painel-toggle" data-miip-painel-toggle="historicoComercial"
          aria-expanded="${expandido ? 'true' : 'false'}">
          <h6 class="mb-0">Histórico Comercial <small class="text-muted">(somente leitura)</small></h6>
          <span class="miip-painel-chevron" aria-hidden="true">${chevronPainel(expandido)}</span>
        </button>
        <div class="miip-painel-corpo">
          <div class="miip-central-historico-fluxo">
            <span>Cadastro</span>
            <i class="fas fa-arrow-down"></i>
            <span>NF-e</span>
          </div>
          <dl class="miip-central-dl miip-central-dl--grid">
            <dt>Último Custo</dt>
            <dd>${hist.ultimoCusto != null ? formatarMoeda(hist.ultimoCusto) : '—'}</dd>
            <dt>Custo NF-e</dt>
            <dd>${hist.custoNfe != null ? formatarMoeda(hist.custoNfe) : '—'}</dd>
            <dt>Diferença</dt>
            <dd>
              <span class="miip-diff-custo miip-diff-custo--${escapeHtml(faixa.classe)}"
                title="${escapeHtml(hist.tooltip || '')}"
                data-bs-toggle="tooltip"
                data-bs-placement="top">${escapeHtml(diffTxt)}</span>
            </dd>
            <dt>Preço de Venda Atual</dt>
            <dd>${hist.precoVendaAtual != null ? formatarMoeda(hist.precoVendaAtual) : '—'}</dd>
            <dt>Margem Atual</dt>
            <dd>${hist.margemAtual != null ? `${Number(hist.margemAtual).toFixed(0)}%` : '—'}</dd>
          </dl>
        </div>
      </div>
      <div id="miipUltimasComprasHost">${renderUltimasCompras(pendencia)}</div>
    `;
  }

  function renderCandidato(_pendencia) {
    // RC9.4 — layout unificado em renderComparacaoV2 (detalhes).
    return '';
  }

  function renderTelaRevisao() {
    const { sessao } = estado;
    const abertas = contarAbertas(sessao);
    const I = intel();

    if (abertas === 0) {
      estado.sessao.fase = 'final';
      renderTelaFinalizarEntrada();
      return;
    }

    if (!pendenciaAberta(sessao, sessao.pendencias[sessao.indiceAtual])) {
      proximaAberta(sessao, 1);
    }

    // RC3.7.6 — se o item atual sumiu pelo filtro visual, avança para o próximo visível
    if (I && estado.inteligencia) {
      const filtro = estado.inteligencia.filtroAtivo || 'todos';
      let tentativas = 0;
      while (tentativas < sessao.pendencias.length) {
        const p = sessao.pendencias[sessao.indiceAtual];
        const linha = obterLinhaIntel(p?.indice);
        if (pendenciaAberta(sessao, p) && (!linha || I.linhaPassaFiltro(linha, filtro))) break;
        proximaAberta(sessao, 1);
        tentativas += 1;
      }
    }

    const pendencia = sessao.pendencias[sessao.indiceAtual];
    const totalPend = sessao.pendencias.length;
    const resolvidas = sessao.resolvidas.length + sessao.ignoradas.length;

    $('#miipCentralResumo').html(renderResumoTopo(sessao));
    $('#miipCentralLista').html(renderListaPendencias(sessao));
    $('#miipCentralDetalhes').html(renderDetalhes(pendencia, sessao));
    $('#miipCentralCandidato').html(renderCandidato(pendencia));
    $('#miipCentralResumoFinal').html(renderResumoFinalBar());
    $('#miipCentralContador').text(
      `${resolvidas + 1} / ${totalPend} · ${abertas} pendente${abertas === 1 ? '' : 's'}`
    );
    const prog = sessao.progressoPersistido;
    const concluidos = prog?.concluidos != null
      ? prog.concluidos
      : (sessao.resolvidas.length + sessao.ignoradas.length);
    const totalItens = prog?.total != null ? prog.total : (sessao.itens?.length || totalPend);
    const $prog = $('#miipCentralProgressoPersistente');
    if ($prog.length) {
      $prog.html(
        `<span class="miip-central-progresso-label">Revisão em andamento</span>`
        + `<strong>${concluidos} de ${totalItens} produtos revisados</strong>`
      );
    }
    aplicarModoFocoDom();
  }

  /**
   * Encerra a Central MIIP e devolve ao caller (Central), que chama finalizar-entrada
   * e navega automaticamente para Compras.
   */
  function encerrarRevisaoAutomaticamente(motivo) {
    if (!estado || estado._encerrando) return;
    estado._encerrando = true;
    estado.sessao.fase = 'final';
    notificar('Finalizando entrada… Abrindo compra…', 'success');
    concluirRevisao({ motivoEncerramento: motivo || 'auto' });
  }

  function renderModal() {
    const html = `
      <div class="modal fade miip-central-modal" id="miipCentralRevisaoModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-fullscreen">
          <div class="modal-content miip-central-content">
            <div class="modal-header miip-central-header">
              <div>
                <h5 class="modal-title"><i class="fas fa-robot"></i> Central de Revisão Inteligente <small class="fw-normal opacity-75">MIIP V2</small></h5>
                <small id="miipCentralContador" class="text-muted"></small>
                <div id="miipCentralProgressoPersistente" class="miip-central-progresso-persistente small"></div>
                <span id="miipCentralPersistenciaBadge" class="miip-central-persistencia-badge miip-central-persistencia-badge--neutro" aria-live="polite"></span>
              </div>
              <div class="d-flex align-items-center gap-2">
                ${renderAcoesRapidasDocumento()}
                <button type="button" class="btn btn-sm btn-outline-light" id="miipCentralBtnModoFoco"
                  title="Ocultar cards auxiliares e focar na revisão"
                  aria-pressed="false">Modo Foco</button>
                <button type="button" class="btn btn-sm btn-outline-light" id="miipCentralBtnCancelar" title="ESC — Pausar revisão (progresso salvo)">
                  <i class="fas fa-pause"></i> Pausar (ESC)
                </button>
              </div>
            </div>
            <div class="modal-body p-0" id="miipCentralCorpo">
              <div id="miipCentralResumo" class="miip-central-resumo"></div>
              <div class="miip-central-layout">
                <aside class="miip-central-lista" id="miipCentralLista"></aside>
                <section class="miip-central-painel">
                  <div id="miipCentralDetalhes"></div>
                  <div id="miipCentralCandidato"></div>
                  <div class="miip-central-acoes">
                    <button type="button" class="btn btn-success" id="miipCentralBtnConfirmar"><i class="fas fa-check"></i> Confirmar Produto <small>(Enter)</small></button>
                    <button type="button" class="btn btn-primary" id="miipCentralBtnEscolher"><i class="fas fa-search"></i> Escolher outro <small>(F2)</small></button>
                    <button type="button" class="btn btn-warning" id="miipCentralBtnCadastrar"><i class="fas fa-plus"></i> Cadastrar Novo <small>(F3)</small></button>
                    <button type="button" class="btn btn-outline-secondary" id="miipCentralBtnIgnorar"><i class="fas fa-ban"></i> Ignorar Item</button>
                  </div>
                  <div class="miip-central-atalhos">
                    <span><kbd>Enter</kbd> Confirmar</span>
                    <span><kbd>Tab</kbd> Próximo</span>
                    <span><kbd>Shift</kbd>+<kbd>Tab</kbd> Anterior</span>
                    <span><kbd>F2</kbd> Pesquisar</span>
                    <span><kbd>F3</kbd> Cadastrar</span>
                    <span><kbd>Ctrl</kbd>+<kbd>D</kbd> Comparação</span>
                    <span><kbd>Ctrl</kbd>+<kbd>H</kbd> Histórico</span>
                    <span><kbd>Ctrl</kbd>+<kbd>I</kbd> Identificadores</span>
                    <span><kbd>Esc</kbd> Pausar</span>
                  </div>
                </section>
              </div>
              <div id="miipCentralResumoFinal" class="miip-central-resumo-final-wrap"></div>
            </div>
          </div>
        </div>
      </div>
      <div id="miipCentralAprendizadoToast" class="miip-central-toast">
        <i class="fas fa-check"></i>
        <div>
          <strong>MIIP aprendeu esta associação.</strong>
          <span>Próximas importações serão automáticas.</span>
        </div>
      </div>
      <div class="modal fade" id="miipCentralBuscaModal" tabindex="-1">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Pesquisar produto (F2)</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
            <div class="modal-body">
              <input type="text" class="form-control mb-2" id="miipCentralBuscaInput" placeholder="Descrição, GTIN, código interno, PLU ou código fornecedor...">
              <div id="miipCentralBuscaResultados" class="miip-central-busca-lista"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    $('#miipCentralRevisaoRoot').remove();
    $('body').append(`<div id="miipCentralRevisaoRoot">${html}</div>`);
  }

  function abrirModal() {
    renderModal();
    const modal = new bootstrap.Modal(document.getElementById('miipCentralRevisaoModal'));
    estado.modal = modal;
    modal.show();
    bindEventos();
  }

  function fecharModal() {
    if (estado?.modal) estado.modal.hide();
    $('#miipCentralRevisaoRoot').remove();
    $(document).off('.miipCentral');
    $(document).off('.miipCentralCadastro');
  }

  /**
   * RC7.5 — "Confirmar Produto" só confirma/aprende/avança.
   * Nunca abre Pedido, Compra, Cadastro ou fluxo comercial.
   */
  function confirmarAtual() {
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    if (!pendencia || !pendenciaAberta(estado.sessao, pendencia)) return;

    const produtoId = pendencia.produtoEncontrado?.id;
    if (!produtoId) {
      notificar('Selecione um produto para continuar.', 'warning');
      return;
    }

    aplicarConfirmacao(pendencia, produtoId, pendencia.produtoEncontrado);
  }

  function atualizarIndicadoresAposResolucao(pendencia) {
    const resumo = estado.sessao.resumo;
    if (pendencia.precisaConfirmacao && Number(resumo.precisamConfirmacao) > 0) {
      resumo.precisamConfirmacao -= 1;
    }
    if (pendencia.precisaCadastro && Number(resumo.precisamCadastro) > 0) {
      resumo.precisamCadastro -= 1;
    }
  }

  function correlationIdRevisao() {
    if (!estado) return null;
    if (!estado.correlationId) {
      estado.correlationId = `miip-rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return estado.correlationId;
  }

  function atualizarBadgePersistencia(texto, tom) {
    const el = document.getElementById('miipCentralPersistenciaBadge');
    if (!el) return;
    el.textContent = texto || '';
    el.className = `miip-central-persistencia-badge miip-central-persistencia-badge--${tom || 'neutro'}`;
  }

  /**
   * Persiste decisão no backend antes de avançar (revisão retomável).
   * @returns {Promise<boolean>}
   */
  function persistirDecisaoItem(indice, decisao, produtoId, item) {
    const documentoId = estado?.opcoes?.documento?.id;
    const apiUrl = estado?.opcoes?.apiUrl || (typeof API_URL !== 'undefined' ? API_URL : '/api');
    if (!documentoId) {
      return Promise.resolve(true);
    }

    atualizarBadgePersistencia('Salvando…', 'salvando');
    const usuario = estado.opcoes.obterUsuario ? estado.opcoes.obterUsuario() : null;
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;

    return fetch(`${apiUrl}/central-entradas/${documentoId}/revisar/itens/${indice}/decisao`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        decisao,
        produto_id: produtoId != null ? Number(produtoId) : null,
        item: item || null,
        usuario_id: usuario?.id ?? null,
        correlation_id: correlationIdRevisao()
      })
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Erro HTTP ${response.status}`);
      }
      if (data.progresso) {
        estado.sessao.progressoPersistido = data.progresso;
      }
      atualizarBadgePersistencia('Salvo', 'ok');
      console.info('[MIIP] salvar decisão do item', { indice, decisao, documentoId, ok: true });
      return true;
    }).catch((error) => {
      atualizarBadgePersistencia('Falha ao salvar', 'erro');
      console.error('[MIIP] salvar decisão do item', { indice, decisao, documentoId, error: error.message });
      notificar('Não foi possível salvar esta decisão. Tente novamente.', 'danger');
      return false;
    });
  }

  function aplicarConfirmacao(pendencia, produtoId, produto, aprendeuExplicito) {
    if (!pendencia || !produtoId) {
      notificar('Selecione um produto para continuar.', 'warning');
      return;
    }
    if (estado._persistindoDecisao) return;

    const item = estado.sessao.itens[pendencia.indice];
    if (item) {
      item.produto_id = Number(produtoId);
      item.miip_revisao_status = 'confirmado';
      item.miip_revisao_origem = 'Confirmacao Manual';
      if (produto?.nome) item.produto_nome_associado = produto.nome;
      // CORREÇÃO-NF-MARGEM-01 — ao vincular produto, aplicar lucro_percentual do cadastro
      const lucroCadastro = produto?.lucro_percentual ?? produto?.margem_lucro ?? produto?.percentual_lucro;
      if (lucroCadastro !== undefined && lucroCadastro !== null && lucroCadastro !== ''
          && Number.isFinite(Number(lucroCadastro))) {
        item.margem_lucro = Number(Number(lucroCadastro).toFixed(2));
        item.margem_origem = 'cadastro';
        item.margem_editada_manual = 0;
      } else {
        item.margem_lucro = 35;
        item.margem_origem = 'fallback';
        item.margem_editada_manual = 0;
      }
      const custo = Number(item.preco_unitario || item.valor_unitario || 0);
      if (custo > 0 && Number(item.atualizar_preco_venda ?? 1) === 1) {
        item.preco_venda_sugerido = Number((custo * (1 + Number(item.margem_lucro) / 100)).toFixed(2));
      }
    }

    const decisao = aprendeuExplicito === false ? 'CADASTRAR' : 'CONFIRMAR';
    estado._persistindoDecisao = true;

    const promessaAprendizado = aprendeuExplicito === false
      ? Promise.resolve(false)
      : enviarAprendizado(pendencia, produtoId, produto).catch(() => false);

    Promise.all([
      persistirDecisaoItem(pendencia.indice, decisao, produtoId, item),
      promessaAprendizado
    ]).then(([salvo, aprendeu]) => {
      estado._persistindoDecisao = false;
      if (!salvo) return;

      if (!estado.sessao.resolvidas.includes(pendencia.indice)) {
        estado.sessao.resolvidas.push(pendencia.indice);
        estado.sessao.confirmadosManualmente += 1;
        atualizarIndicadoresAposResolucao(pendencia);
      }

      if (aprendeu) {
        estado.sessao.aprendizados += 1;
        mostrarAprendizado();
      }

      if (contarAbertas(estado.sessao) === 0) {
        estado.sessao.fase = 'final';
        renderTelaFinalizarEntrada();
        return;
      }

      proximaAberta(estado.sessao, 1);
      renderTelaRevisao();
    }).catch(() => {
      estado._persistindoDecisao = false;
    });
  }

  function ignorarAtual() {
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    if (!pendencia || !pendenciaAberta(estado.sessao, pendencia)) return;
    if (estado._persistindoDecisao) return;

    const item = estado.sessao.itens[pendencia.indice] || pendencia.produtoXML || {};
    estado._persistindoDecisao = true;

    persistirDecisaoItem(pendencia.indice, 'IGNORAR', null, {
      ...item,
      miip_revisao_status: 'ignorado'
    }).then((salvo) => {
      estado._persistindoDecisao = false;
      if (!salvo) return;

      if (!estado.sessao.ignoradas.includes(pendencia.indice)) {
        estado.sessao.ignoradas.push(pendencia.indice);
        atualizarIndicadoresAposResolucao(pendencia);
      }

      if (contarAbertas(estado.sessao) === 0) {
        estado.sessao.fase = 'final';
        renderTelaFinalizarEntrada();
        return;
      }

      proximaAberta(estado.sessao, 1);
      renderTelaRevisao();
    }).catch(() => {
      estado._persistindoDecisao = false;
    });
  }

  function abrirBuscaProduto() {
    const obterCatalogo = () => estado.opcoes.produtos || [];
    const modalEl = document.getElementById('miipCentralBuscaModal');
    if (!modalEl) return;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    elevarModalSobreMiip(modalEl);
    const renderBusca = (termo) => {
      const produtos = obterCatalogo();
      const I = intel();
      const filtrados = I?.filtrarProdutosBuscaManual
        ? I.filtrarProdutosBuscaManual(produtos, termo)
        : produtos.filter((p) => {
          const lower = String(termo || '').toLowerCase().trim();
          if (!lower) return true;
          return String(p.nome || '').toLowerCase().includes(lower)
            || String(p.codigo || '').includes(lower)
            || String(p.codigo_barras || '').includes(lower)
            || String(p.plu || '').includes(lower);
        }).slice(0, 40);

      $('#miipCentralBuscaResultados').html(filtrados.map((p) => `
        <button type="button" class="miip-central-busca-item" data-produto-id="${p.id}">
          <strong>${escapeHtml(p.nome)}</strong>
          <small>${escapeHtml(p.codigo_barras || p.codigo || p.plu || '')}</small>
        </button>
      `).join('') || '<p class="text-muted p-2">Nenhum produto encontrado.</p>');
    };

    $('#miipCentralBuscaInput').val('').off('input.miip').on('input.miip', function onBusca() {
      renderBusca(this.value);
    });
    $('#miipCentralBuscaResultados').off('click.miip').on('click.miip', '.miip-central-busca-item', function onSelect() {
      const produtoId = Number($(this).data('produto-id'));
      const produto = obterCatalogo().find((p) => Number(p.id) === produtoId);
      const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
      modal.hide();
      if (produto && pendencia) {
        aplicarConfirmacao(pendencia, produtoId, { id: produtoId, nome: produto.nome });
      }
    });

    renderBusca('');
    modal.show();
    setTimeout(() => $('#miipCentralBuscaInput').trigger('focus'), 200);
  }

  function elevarModalSobreMiip(modalEl) {
    if (!modalEl) return;

    // Garante que o modal não fique preso em stacking context da página.
    if (modalEl.parentElement !== document.body) {
      document.body.appendChild(modalEl);
    }

    modalEl.classList.add('produto-modal-sobre-miip');
    modalEl.style.zIndex = '22000';

    requestAnimationFrame(() => {
      const backdrops = document.querySelectorAll('.modal-backdrop');
      const last = backdrops[backdrops.length - 1];
      if (last) {
        last.classList.add('produto-modal-sobre-miip-backdrop');
        last.style.zIndex = '21990';
      }
    });
  }

  /**
   * RC8.5.3.1 / RC8.5.3.2 — encerra modal temporário (MIE / embalagem) por completo
   * antes de abrir o Cadastro: hide → dispose → remove DOM → limpa backdrop órfão.
   */
  function encerrarModalTemporarioCompleto(el) {
    return new Promise((resolve) => {
      if (!el || !document.body.contains(el)) {
        resolve();
        return;
      }

      let finalizado = false;
      const finalizar = () => {
        if (finalizado) return;
        finalizado = true;
        try {
          const inst = typeof bootstrap !== 'undefined' ? bootstrap.Modal.getInstance(el) : null;
          if (inst) inst.dispose();
        } catch (_) { /* ignore */ }
        try {
          $(el).off('.miipTempModal');
          if (el.parentNode) el.remove();
        } catch (_) { /* ignore */ }

        const abertos = document.querySelectorAll('.modal.show').length;
        const backs = Array.from(document.querySelectorAll('.modal-backdrop'));
        if (backs.length > abertos) {
          backs.slice(abertos).forEach((b) => b.remove());
        }
        if (abertos === 0) {
          document.body.classList.remove('modal-open');
          document.body.style.removeProperty('padding-right');
          document.body.style.removeProperty('overflow');
        } else {
          document.body.classList.add('modal-open');
        }
        resolve();
      };

      const estaVisivel = el.classList.contains('show') || el.classList.contains('showing');
      if (!estaVisivel) {
        // Orfão (nunca chegou a abrir) — remove sem esconder fluxo ativo
        finalizar();
        return;
      }

      $(el).one('hidden.bs.modal.miipTempModal', finalizar);
      try {
        const modal = bootstrap.Modal.getOrCreateInstance(el);
        modal.hide();
      } catch (_) {
        finalizar();
      }
      setTimeout(finalizar, 700);
    });
  }

  /** RC8.5.3.2 — MIE/pergunta acima da Central MIIP (fullscreen), sem empilhar no Cadastro. */
  function elevarModalTemporarioSobreMiip(modalEl) {
    if (!modalEl) return;
    if (modalEl.parentElement !== document.body) {
      document.body.appendChild(modalEl);
    }
    modalEl.classList.add('miip-temp-modal-sobre');
    modalEl.style.zIndex = '23050';
    requestAnimationFrame(() => {
      const backdrops = document.querySelectorAll('.modal-backdrop');
      const last = backdrops[backdrops.length - 1];
      if (last) {
        last.classList.add('miip-temp-modal-sobre-backdrop');
        last.style.zIndex = '23040';
      }
    });
  }

  function focarCampoCadastroAposMiip() {
    const cat = document.getElementById('categoria_id');
    if (cat && !String(cat.value || '').trim()) {
      cat.focus();
      return;
    }
    const marcaVisivel = document.querySelector(
      '#marca_smart_select_host input:not([type="hidden"]), #marca_smart_select_host button, #marca_smart_select_host [tabindex="0"]'
    );
    if (marcaVisivel) {
      marcaVisivel.focus();
      return;
    }
    const marca = document.getElementById('marca_id');
    if (marca) marca.focus();
  }

  /** Deriva ação MIE pelos limiares oficiais quando `acao` vier ausente. */
  function normalizarAcaoMie(mie) {
    if (!mie) return 'ignorar';
    if (mie.acao === 'auto_ativar' || mie.acao === 'sugerir' || mie.acao === 'ignorar') {
      return mie.acao;
    }
    const conf = Number(mie.confianca || 0);
    if (mie.compra_por_embalagem && conf > 95) return 'auto_ativar';
    if (mie.compra_por_embalagem && conf >= 70) return 'sugerir';
    return 'ignorar';
  }

  /**
   * Une produtoXML + item da nota + fornecedor da sessão (UI usa produtoXML).
   */
  function montarItemCadastroXml(pendencia) {
    const sessao = estado?.sessao || {};
    const doXml = pendencia?.produtoXML || {};
    const doItem = sessao.itens?.[pendencia?.indice] || {};
    const precoUnitario = primeiroNumero(
      doXml.preco_unitario, doXml.precoUnitario, doXml.valor_unitario, doXml.valorUnitario,
      doItem.preco_unitario, doItem.precoUnitario, doItem.valor_unitario, doItem.valorUnitario
    );
    const margem = primeiroNumero(
      doXml.margem_lucro, doXml.margemLucro,
      doItem.margem_lucro, doItem.margemLucro,
      30
    );
    const precoVenda = primeiroNumero(
      doXml.preco_venda_sugerido, doXml.precoVendaSugerido,
      doItem.preco_venda_sugerido, doItem.precoVendaSugerido,
      precoUnitario != null && margem != null ? precoUnitario * (1 + margem / 100) : null
    );
    const quantidade = primeiroNumero(
      doXml.quantidade, doXml.qtd, doItem.quantidade, doItem.qtd
    );
    const subtotal = primeiroNumero(
      doXml.subtotal, doXml.valor_total, doXml.valorTotal,
      doItem.subtotal, doItem.valor_total
    );

    return {
      ...doItem,
      ...doXml,
      produto_nome: doXml.produto_nome || doXml.produtoNome || doItem.produto_nome
        || doXml.descricao || doItem.descricao || doItem.nome || '',
      descricao: doXml.descricao || doXml.produto_nome || doXml.produtoNome
        || doItem.descricao || doItem.produto_nome || '',
      descricao_complementar: doXml.descricao_complementar || doXml.inf_ad_prod
        || doXml.infAdProd || doItem.descricao_complementar || '',
      codigo_fornecedor: doXml.codigo_fornecedor || doXml.codigoFornecedor
        || doItem.codigo_fornecedor || doItem.codigoFornecedor || '',
      codigo_barras: doXml.codigo_barras || doXml.codigoBarras || doXml.gtin
        || doItem.codigo_barras || doItem.codigoBarras || doItem.gtin || '',
      gtin: doXml.gtin || doItem.gtin || doXml.codigo_barras || doItem.codigo_barras || '',
      ncm: doXml.ncm || doItem.ncm || '',
      cest: doXml.cest || doItem.cest || '',
      cfop: doXml.cfop || doItem.cfop || '',
      csosn: doXml.csosn || doXml.cst || doItem.csosn || doItem.cst || '',
      cst: doXml.cst || doItem.cst || '',
      cst_pis: doXml.cst_pis || doItem.cst_pis || '',
      cst_cofins: doXml.cst_cofins || doItem.cst_cofins || '',
      cst_ipi: doXml.cst_ipi || doItem.cst_ipi || '',
      origem: doXml.origem != null ? doXml.origem : (doItem.origem != null ? doItem.origem : null),
      unidade: doXml.unidade || doXml.uCom || doItem.unidade || 'UN',
      unidade_tributavel: doXml.unidade_tributavel || doXml.uTrib || doItem.unidade_tributavel || '',
      quantidade,
      quantidade_tributavel: primeiroNumero(doXml.quantidade_tributavel, doXml.qTrib, doItem.quantidade_tributavel),
      preco_unitario: precoUnitario,
      valor_unitario: precoUnitario,
      subtotal,
      valor_total: subtotal,
      margem_lucro: margem,
      preco_venda_sugerido: precoVenda,
      peso_liquido: primeiroNumero(doXml.peso_liquido, doItem.peso_liquido),
      peso_bruto: primeiroNumero(doXml.peso_bruto, doItem.peso_bruto),
      fornecedor: sessao.fornecedor || doItem.fornecedor || doXml.fornecedor || '',
      marca: doXml.marca || doItem.marca || '',
      observacoes: doXml.descricao_complementar || doXml.inf_ad_prod || doItem.observacoes || '',
      mie: doXml.mie || doItem.mie || pendencia?.mie || null
    };
  }

  function primeiroNumero(...candidatos) {
    for (const c of candidatos) {
      if (c == null || c === '') continue;
      const n = Number(String(c).replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  /** Campos type=number do cadastro exigem ponto decimal (não vírgula). */
  function formatarPrecoCadastro(valor, casas = 4) {
    const n = Number(String(valor ?? '').replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return '';
    const fixed = n.toFixed(casas);
    return fixed.replace(/\.?0+$/, '') || '0';
  }

  function setCampoNumero($el, valor, casas = 4) {
    if (!$el || !$el.length) return false;
    const formatado = formatarPrecoCadastro(valor, casas);
    if (formatado === '') return false;
    $el.val(formatado);
    $el.trigger('input').trigger('change');
    return true;
  }

  function setCampoTexto(sel, valor) {
    if (valor == null || valor === '') return;
    const $el = $(sel);
    if (!$el.length) return;
    $el.val(String(valor).trim());
  }

  function normalizarUnidadeComercialMiip(uCom) {
    const raw = String(uCom || 'UN').trim().toUpperCase()
      .replace('²', '2').replace('³', '3').replace(/\s+/g, '');
    const mapa = {
      UN: 'UN', UND: 'UN', UNI: 'UN',
      PC: 'PACOTE', PCT: 'PACOTE', PACOTE: 'PACOTE',
      CX: 'CAIXA', CXA: 'CAIXA', CAIXA: 'CAIXA',
      FD: 'FARDO', FARDO: 'FARDO',
      SC: 'SACO', SACO: 'SACO',
      LT: 'LATA', LATA: 'LATA',
      BD: 'BALDE', BALDE: 'BALDE',
      RL: 'ROLO', ROLO: 'ROLO',
      BR: 'BARRA', BARRA: 'BARRA'
    };
    if (window.MotorUnidadesMedidaCliente && typeof window.MotorUnidadesMedidaCliente.identificarUnidadeDoXml === 'function') {
      try {
        return window.MotorUnidadesMedidaCliente.identificarUnidadeDoXml(raw);
      } catch (_e) { /* ignore */ }
    }
    return mapa[raw] || (['PACOTE', 'CAIXA', 'FARDO', 'SACO', 'LATA', 'BALDE', 'ROLO', 'BARRA'].includes(raw) ? raw : 'UN');
  }

  function unidadeXmlSugereEmbalagem(unidade) {
    const uc = normalizarUnidadeComercialMiip(unidade);
    return uc && uc !== 'UN';
  }

  function perguntarCompraPorEmbalagemMiip(item) {
    return new Promise((resolve) => {
      const uc = normalizarUnidadeComercialMiip(item.unidade || item.uCom);
      const valorEmb = primeiroNumero(item.preco_unitario, item.valor_unitario, item.subtotal);
      const html = `
        <div class="modal fade" id="miipPerguntaEmbalagemModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Produto adquirido por embalagem?</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
              </div>
              <div class="modal-body">
                <p class="mb-2">A NF-e informa unidade comercial <strong>${escapeHtml(uc)}</strong>.</p>
                <p class="text-muted small mb-3">Sugestão: ativar compra por embalagem e usar o valor unitário da NF como valor da embalagem${valorEmb != null ? ` (${formatarPrecoCadastro(valorEmb, 2)})` : ''}.</p>
                <div class="form-check mb-2">
                  <input class="form-check-input" type="radio" name="miipEmbOpcao" id="miipEmbSim" value="1" checked>
                  <label class="form-check-label" for="miipEmbSim">Sim — comprar por embalagem</label>
                </div>
                <div class="form-check">
                  <input class="form-check-input" type="radio" name="miipEmbOpcao" id="miipEmbNao" value="0">
                  <label class="form-check-label" for="miipEmbNao">Não — cadastro por unidade</label>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-primary" id="miipEmbConfirmar">Continuar</button>
              </div>
            </div>
          </div>
        </div>`;
      $('#miipPerguntaEmbalagemModal').remove();
      $('body').append(html);
      const el = document.getElementById('miipPerguntaEmbalagemModal');
      const modal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static', keyboard: true, focus: true });
      let resolvido = false;
      let jaExibido = false;
      const finalizar = async (sim) => {
        if (resolvido) return;
        resolvido = true;
        await encerrarModalTemporarioCompleto(el);
        resolve(sim);
      };
      $('#miipEmbConfirmar').off('click.miipEmb').on('click.miipEmb', () => {
        finalizar($('#miipEmbSim').is(':checked'));
      });
      $(el).off('shown.bs.modal.miipEmb').on('shown.bs.modal.miipEmb', () => {
        jaExibido = true;
        elevarModalTemporarioSobreMiip(el);
      });
      $(el).off('hidden.bs.modal.miipEmbUser').on('hidden.bs.modal.miipEmbUser', () => {
        if (!resolvido && jaExibido) finalizar(false);
      });
      elevarModalTemporarioSobreMiip(el);
      modal.show();
    });
  }

  function obterMieDaPendencia(pendencia) {
    return pendencia?.mie
      || pendencia?.produtoXML?.mie
      || null;
  }

  function rotuloEmbalagemMie(mie) {
    if (!mie || !mie.compra_por_embalagem) return '—';
    if (mie.rotulo) return mie.rotulo;
    if (mie.unidade_comercial && mie.quantidade_por_embalagem) {
      return `${mie.unidade_comercial} × ${mie.quantidade_por_embalagem}`;
    }
    return mie.unidade_comercial || '—';
  }

  function mapearUnidadeComercialCadastro(und) {
    const u = String(und || '').toUpperCase();
    if (u === 'DISPLAY') return 'CAIXA';
    if (u === 'KIT') return 'PACOTE';
    if (u === 'BANDEJA') return 'CAIXA';
    return u;
  }

  function marcarCampoAutofill(sel, origem) {
    const $el = $(sel);
    if (!$el.length) return;
    const $wrap = $el.closest('.col-md-3, .col-md-4, .col-md-6, .col-md-12, .col-12, .form-check, .mb-3');
    $el.addClass('mie-campo-autofill');
    $wrap.find('.mie-origem-hint').remove();
    if (origem) {
      $el.after(`<small class="mie-origem-hint text-primary d-block mt-1"><i class="fas fa-magic"></i> ${escapeHtml(origem)}</small>`);
    }
  }

  function aplicarDestaquesAutofillMiip(item, mie) {
    marcarCampoAutofill('#nome', 'Importado da NF-e');
    if (item.codigo_barras || item.gtin) marcarCampoAutofill('#codigo_barras', 'Importado da NF-e');
    if (item.ncm) marcarCampoAutofill('#ncm', 'Importado da NF-e');
    if (item.cest) marcarCampoAutofill('#cest', 'Importado da NF-e');
    const cfopEmpresa = (typeof window.obterCfopPadraoEmpresa === 'function')
      ? window.obterCfopPadraoEmpresa()
      : '';
    if (cfopEmpresa) {
      marcarCampoAutofill('#cfop', 'Padrão fiscal da empresa');
    } else if (item.cfop) {
      marcarCampoAutofill('#cfop', 'Importado da NF-e');
    }
    if (item.csosn || item.cst) marcarCampoAutofill('#csosn', 'Importado da NF-e');
    if (mie && mie.compra_por_embalagem) {
      marcarCampoAutofill('#compra_por_embalagem', 'Sugerido pelo Motor MIE');
      marcarCampoAutofill('#unidade_comercial', 'Identificada automaticamente');
      if (mie.quantidade_por_embalagem) {
        marcarCampoAutofill('#quantidade_por_embalagem', 'Calculada automaticamente');
      }
      if (mie.valor_compra_embalagem) {
        marcarCampoAutofill('#valor_compra_embalagem', 'Obtido da NF-e');
      }
    }
  }

  function aplicarModoEmbalagemCadastroProduto(item, mieOverride) {
    const mie = mieOverride || item.mie || null;
    const uc = mapearUnidadeComercialCadastro(
      (mie && mie.unidade_comercial)
        || normalizarUnidadeComercialMiip(item.unidade || item.uCom)
    );
    const valorEmb = primeiroNumero(
      mie?.valor_compra_embalagem,
      item.preco_unitario,
      item.valor_unitario
    );
    const qtdEmb = primeiroNumero(
      mie?.quantidade_por_embalagem,
      item.quantidade_por_embalagem,
      item.qtd_por_embalagem,
      item.fator_embalagem
    );

    $('#compra_por_embalagem').prop('checked', true);
    if ($('#unidade_comercial').length && uc && uc !== 'UN') {
      if ($('#unidade_comercial').find(`option[value="${uc}"]`).length) {
        $('#unidade_comercial').val(uc);
      } else {
        $('#unidade_comercial').val('PACOTE');
      }
    }
    if (valorEmb != null) setCampoNumero($('#valor_compra_embalagem'), valorEmb, 2);
    if (qtdEmb != null && qtdEmb > 0) setCampoNumero($('#quantidade_por_embalagem'), qtdEmb, 3);

    if (typeof atualizarVisibilidadeEmbalagemComercialCadastro === 'function') {
      atualizarVisibilidadeEmbalagemComercialCadastro();
    } else {
      $('#compra_por_embalagem').trigger('change');
    }
  }

  function perguntarSugestaoMie(mie, item) {
    return new Promise((resolve) => {
      const motivos = (mie.motivos || []).map((m) => `<li><i class="fas fa-check text-success"></i> ${escapeHtml(m)}</li>`).join('');
      const html = `
        <div class="modal fade" id="miipMieSugestaoModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Sugestão do Motor MIE</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
              </div>
              <div class="modal-body">
                <p>O CDS identificou que este produto provavelmente é comprado por embalagem.</p>
                <p class="mb-1"><strong>${escapeHtml(rotuloEmbalagemMie(mie))}</strong>
                  <span class="badge bg-info">${Number(mie.confianca || 0)}%</span></p>
                <p class="text-muted small">Origem: ${escapeHtml(mie.origem || '—')}</p>
                <ul class="small mb-0">${motivos || '<li>Padrões da NF-e</li>'}</ul>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary" id="miipMieAlterar">Alterar</button>
                <button type="button" class="btn btn-primary" id="miipMieConfirmar">Confirmar</button>
              </div>
            </div>
          </div>
        </div>`;
      $('#miipMieSugestaoModal').remove();
      $('body').append(html);
      const el = document.getElementById('miipMieSugestaoModal');
      const modal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static', keyboard: true, focus: true });
      let done = false;
      let jaExibido = false;
      const fin = async (ok) => {
        if (done) return;
        done = true;
        // RC8.5.3.1 — só resolve depois de fechar de verdade (sem modal atrás do Cadastro)
        await encerrarModalTemporarioCompleto(el);
        resolve(ok);
      };
      $('#miipMieConfirmar').off('click.miipMie').on('click.miipMie', () => fin(true));
      $('#miipMieAlterar').off('click.miipMie').on('click.miipMie', () => fin(false));
      $(el).off('shown.bs.modal.miipMie').on('shown.bs.modal.miipMie', () => {
        jaExibido = true;
        elevarModalTemporarioSobreMiip(el);
        const btn = document.getElementById('miipMieConfirmar');
        if (btn) btn.focus();
      });
      $(el).off('hidden.bs.modal.miipMieUser').on('hidden.bs.modal.miipMieUser', () => {
        // Só trata dismiss do usuário após o modal ter aparecido (evita fechar o fluxo no show)
        if (!done && jaExibido) fin(false);
      });
      elevarModalTemporarioSobreMiip(el);
      modal.show();
    });
  }

  async function registrarAprendizadoMie(item, unidade, quantidade) {
    try {
      const cnpj = estado?.sessao?.fornecedor_cnpj || estado?.sessao?.fornecedorCnpj || '';
      if (!cnpj || !unidade) return;
      await $.ajax({
        url: `${typeof API_URL !== 'undefined' ? API_URL : '/api'}/mie/aprendizado`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          fornecedor_cnpj: cnpj,
          unidade_comercial: unidade,
          quantidade_por_embalagem: quantidade || 0,
          padrao_chave: unidade,
          produto_nome: item.produto_nome || item.descricao || ''
        })
      });
    } catch (_e) { /* não bloqueia cadastro */ }
  }

  async function resolverEmbalagemComMie(item) {
    // RC8.5.3.2 — sempre executa análise no F3 (não pular o Motor)
    let mie = null;
    try {
      const resp = await $.ajax({
        url: `${typeof API_URL !== 'undefined' ? API_URL : '/api'}/mie/analisar`,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          item,
          fornecedor_cnpj: estado?.sessao?.fornecedor_cnpj || estado?.sessao?.fornecedorCnpj || ''
        })
      });
      mie = resp;
      item.mie = mie;
    } catch (_e) {
      mie = item.mie || null;
    }

    const acao = normalizarAcaoMie(mie);

    if (!mie || !mie.compra_por_embalagem || acao === 'ignorar') {
      if (unidadeXmlSugereEmbalagem(item.unidade || item.uCom)) {
        const sim = await perguntarCompraPorEmbalagemMiip(item);
        return { ativar: sim, mie: mie || null, aprendizado: sim };
      }
      return { ativar: false, mie: mie || null, aprendizado: false };
    }

    if (acao === 'auto_ativar') {
      return { ativar: true, mie, aprendizado: true };
    }
    if (acao === 'sugerir') {
      const ok = await perguntarSugestaoMie(mie, item);
      return { ativar: ok, mie, aprendizado: ok };
    }
    return { ativar: false, mie, aprendizado: false };
  }

  function aplicarCfopPadraoEmpresaNoCadastro(xml) {
    const cfopEmpresa = (typeof window.obterCfopPadraoEmpresa === 'function')
      ? window.obterCfopPadraoEmpresa()
      : '';
    if (cfopEmpresa) {
      setCampoTexto('#cfop', cfopEmpresa);
      if (typeof window.aplicarCfopPadraoEmpresaNoFormulario === 'function') {
        window.aplicarCfopPadraoEmpresaNoFormulario();
      }
      return;
    }
    if (typeof window.aplicarPadraoFiscalNovoProduto === 'function') {
      Promise.resolve(window.aplicarPadraoFiscalNovoProduto()).then(() => {
        const padrao = (typeof window.obterCfopPadraoEmpresa === 'function')
          ? window.obterCfopPadraoEmpresa()
          : '';
        if (padrao) setCampoTexto('#cfop', padrao);
      });
    }
  }

  function preencherCamposCadastroProduto(item) {
    const xml = item || {};
    const nome = String(xml.produto_nome || xml.descricao || xml.nome || '').trim();
    const $modal = $('#produtoModal');
    if (!$modal.length) return;

    if (nome && $('#nome').length) $('#nome').val(nome);

    const barras = String(xml.codigo_barras || xml.gtin || '').trim();
    if (barras && $('#codigo_barras').length) {
      $('#codigo_barras').val(barras).trigger('input.espelhoCodigo');
    }

    setCampoTexto('#ncm', xml.ncm);
    setCampoTexto('#cest', xml.cest);
    aplicarCfopPadraoEmpresaNoCadastro(xml);
    setCampoTexto('#csosn', xml.csosn || xml.cst);
    if (xml.origem != null && xml.origem !== '' && $('#origem').length) {
      $('#origem').val(Number(xml.origem) || 0);
    }

    const obs = String(xml.descricao_complementar || xml.inf_ad_prod || xml.observacoes || '').trim();
    if (obs && $('#produto_observacoes').length) {
      $('#produto_observacoes').val(obs);
    }

    if ($('#unidade').length) {
      const undRaw = String(xml.unidade || 'UN').trim().toLowerCase();
      const mapaBase = { un: 'un', und: 'un', kg: 'kg', g: 'g', l: 'l', ml: 'ml', mt: 'mt', m: 'mt', m2: 'm2', m3: 'm3' };
      const und = mapaBase[undRaw] || 'un';
      const $und = $('#unidade');
      if ($und.find(`option[value="${und}"]`).length) $und.val(und);
      else $und.val('un');
      $und.trigger('change');
    }

    const preco = xml.preco_unitario ?? xml.valor_unitario ?? xml.precoUnitario ?? xml.valorUnitario;
    const precoOk = setCampoNumero($('#preco_compra'), preco, 4);

    const margem = xml.margem_lucro ?? xml.margemLucro;
    if ($('#lucro_percentual').length && margem != null && margem !== '') {
      setCampoNumero($('#lucro_percentual'), margem, 2);
    } else if (precoOk && $('#lucro_percentual').length && String($('#lucro_percentual').val() || '').trim() === '') {
      setCampoNumero($('#lucro_percentual'), 30, 2);
    }

    const precoVenda = xml.preco_venda_sugerido ?? xml.precoVendaSugerido;
    if (precoVenda != null && precoVenda !== '') {
      setCampoNumero($('#preco_venda'), precoVenda, 2);
    }

    if (typeof sincronizarFormacaoPrecoProduto === 'function') {
      sincronizarFormacaoPrecoProduto(precoVenda != null ? 'venda' : 'compra');
    } else {
      $('#preco_compra').trigger('input.precoMotor').trigger('change.precoMotor');
    }

    if ($('#fornecedor').length && xml.fornecedor) {
      $('#fornecedor').val(String(xml.fornecedor).trim());
    }

    const codForn = String(xml.codigo_fornecedor || xml.codigoFornecedor || '').trim();
    if (codForn && $('#codigo').length) {
      const atual = String($('#codigo').val() || '').trim();
      const auto = String($modal.data('codigoAutoSugerido') || '').trim();
      if (!atual || (auto && atual === auto)) {
        $('#codigo').val(codForn);
      }
    }

    // Marca: tenta selecionar por nome se houver select
    const marcaNome = String(xml.marca || '').trim();
    if (marcaNome && $('#marca_id').length) {
      const $opt = $('#marca_id option').filter(function () {
        return String($(this).text() || '').trim().toLowerCase() === marcaNome.toLowerCase();
      }).first();
      if ($opt.length) $('#marca_id').val($opt.val());
    }

    $modal.data('miipPrefillXml', xml);
  }

  async function aplicarPrefillCompletoCadastroProduto(item) {
    preencherCamposCadastroProduto(item);
    if (unidadeXmlSugereEmbalagem(item.unidade || item.uCom)) {
      const sim = await perguntarCompraPorEmbalagemMiip(item);
      if (sim) aplicarModoEmbalagemCadastroProduto(item);
    }
  }

  function incluirProdutoNoCatalogoRevisao(produto) {
    if (!produto?.id || !estado?.opcoes) return;
    if (!Array.isArray(estado.opcoes.produtos)) estado.opcoes.produtos = [];
    const ja = estado.opcoes.produtos.some((p) => Number(p.id) === Number(produto.id));
    if (!ja) estado.opcoes.produtos.unshift(produto);
  }

  function normalizarProdutoRecemSalvo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const produto = raw.id ? raw : (raw.produto && raw.produto.id ? raw.produto : raw);
    return produto?.id ? produto : null;
  }

  async function resolverProdutoRecemCadastrado(nomeHint, extraHint) {
    try {
      const token = localStorage.getItem('token') || '';
      const resp = await fetch(`${estado.opcoes.apiUrl}/produtos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return null;
      const raw = await resp.json().catch(() => []);
      const lista = Array.isArray(raw) ? raw : (raw.itens || raw.produtos || []);
      if (!Array.isArray(lista) || !lista.length) return null;

      const hint = String(nomeHint || '').trim().toLowerCase();
      const gtin = String(extraHint?.codigo_barras || extraHint?.gtin || extraHint?.cean || '').replace(/\D/g, '');
      const codigo = String(extraHint?.codigo || extraHint?.cProd || '').trim().toLowerCase();

      if (gtin) {
        const porGtin = [...lista].reverse().find((p) =>
          String(p.codigo_barras || '').replace(/\D/g, '') === gtin
        );
        if (porGtin) return porGtin;
      }
      if (hint) {
        const porNome = [...lista].reverse().find((p) =>
          String(p.nome || '').trim().toLowerCase() === hint
        );
        if (porNome) return porNome;
      }
      if (codigo) {
        const porCodigo = [...lista].reverse().find((p) =>
          String(p.codigo || '').trim().toLowerCase() === codigo
        );
        if (porCodigo) return porCodigo;
      }

      return lista.reduce((a, b) => (Number(a?.id || 0) > Number(b?.id || 0) ? a : b));
    } catch (_) {
      return null;
    }
  }

  /**
   * Garante o script de cadastro de produtos (lazy) antes de abrir o modal.
   */
  async function garantirShowProdutoModal() {
    if (typeof showProdutoModal === 'function') return true;

    try {
      if (typeof window.CdsErpLazyLoader?.loadPageScripts === 'function') {
        await window.CdsErpLazyLoader.loadPageScripts('produtos');
      } else if (typeof window.CdsErpLazyLoader?.loadFeatureScript === 'function') {
        await window.CdsErpLazyLoader.loadFeatureScript('/erp/js/categorias.js').catch(() => {});
        await window.CdsErpLazyLoader.loadFeatureScript('/erp/js/subcategorias.js').catch(() => {});
        await window.CdsErpLazyLoader.loadFeatureScript('/shared/js/cds-stable-dropdown.js').catch(() => {});
        await window.CdsErpLazyLoader.loadFeatureScript('/erp/js/produtos.js');
      } else {
        const carregarScript = (src) => new Promise((resolve, reject) => {
          const el = document.createElement('script');
          el.src = src;
          el.async = false;
          el.onload = () => resolve();
          el.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
          document.head.appendChild(el);
        });
        await carregarScript('/erp/js/categorias.js').catch(() => {});
        await carregarScript('/erp/js/subcategorias.js').catch(() => {});
        await carregarScript('/shared/js/cds-stable-dropdown.js').catch(() => {});
        await carregarScript('/erp/js/produtos.js');
      }
      return typeof showProdutoModal === 'function';
    } catch (err) {
      console.warn('[MIIP] Não foi possível carregar produtos.js:', err);
      return false;
    }
  }

  /**
   * Abre o cadastro de produto na frente da Central MIIP (sem sair da revisão),
   * já com os dados do XML preenchidos.
   * RC8.5.3.1 / RC8.5.3.2 — decide MIE antes de abrir o Cadastro (um modal por vez).
   */
  async function abrirCadastroProdutoPadrao(item, callback) {
    if (estado?._abrindoCadastroProduto) {
      return;
    }
    estado._abrindoCadastroProduto = true;

    try {
      const ok = await garantirShowProdutoModal();
      if (!ok || typeof showProdutoModal !== 'function') {
        notificar('Módulo de Produtos indisponível. Atualize a página (Ctrl+F5) e tente novamente.', 'danger');
        if (typeof callback === 'function') callback(null);
        return;
      }

      // Resolve embalagem ANTES do Cadastro (MIE visível sobre a Central, não atrás)
      if (item._miipCompraPorEmbalagem == null) {
        const decisao = await resolverEmbalagemComMie(item);
        item._miipCompraPorEmbalagem = !!decisao.ativar;
        item.mie = decisao.mie || item.mie || null;
        item._miipMieAprendizado = !!decisao.aprendizado;
      }

      // Garante que o MIE não ficou residual
      await encerrarModalTemporarioCompleto(document.getElementById('miipMieSugestaoModal'));
      await encerrarModalTemporarioCompleto(document.getElementById('miipPerguntaEmbalagemModal'));

      showProdutoModal(null, { origem: 'MIIP' });

      if (typeof window.aplicarPadraoFiscalNovoProduto === 'function') {
        window.aplicarPadraoFiscalNovoProduto().catch(() => {});
      }

      const el = document.getElementById('produtoModal');
      if (!el) {
        notificar('Não foi possível abrir o cadastro de produto.', 'danger');
        if (typeof callback === 'function') callback(null);
        return;
      }

      elevarModalSobreMiip(el);

      try {
        bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, keyboard: true, focus: true }).show();
      } catch (_) {
        try { $(el).modal('show'); } catch (__) { /* ignore */ }
      }

      const aplicarPrefill = () => {
        elevarModalSobreMiip(el);
        preencherCamposCadastroProduto(item);
        if (item._miipCompraPorEmbalagem === true) {
          aplicarModoEmbalagemCadastroProduto(item, item.mie);
        }
        aplicarDestaquesAutofillMiip(item, item.mie);
      };

      const onShown = async () => {
        elevarModalSobreMiip(el);
        aplicarPrefill();

        if (item._miipCompraPorEmbalagem === true && item._miipMieAprendizado) {
          await registrarAprendizadoMie(
            item,
            $('#unidade_comercial').val() || item.mie?.unidade_comercial,
            parseFloat($('#quantidade_por_embalagem').val()) || item.mie?.quantidade_por_embalagem
          );
        }

        setTimeout(aplicarPrefill, 120);
        setTimeout(() => {
          aplicarPrefill();
          if (typeof window.aplicarCfopPadraoEmpresaNoFormulario === 'function') {
            window.aplicarCfopPadraoEmpresaNoFormulario();
          }
          focarCampoCadastroAposMiip();
        }, 350);
      };

      el.addEventListener('shown.bs.modal', onShown, { once: true });
      if (el.classList.contains('show')) onShown();
      else setTimeout(aplicarPrefill, 50);

      el.addEventListener('hidden.bs.modal', async () => {
        el.classList.remove('produto-modal-sobre-miip');
        document.querySelectorAll('.produto-modal-sobre-miip-backdrop').forEach((b) => {
          b.classList.remove('produto-modal-sobre-miip-backdrop');
        });

        const $modal = $('#produtoModal');
        const salvoDireto = normalizarProdutoRecemSalvo($modal.data('produtoRecemSalvo') || null);
        const salvouOk = $modal.data('produtoSalvoComSucesso') === true;
        $modal.removeData('produtoRecemSalvo');
        $modal.removeData('produtoSalvoComSucesso');

        // Cancelou sem salvar → não confirma pendência.
        if (!salvouOk && !salvoDireto?.id) {
          if (typeof callback === 'function') callback(null);
          return;
        }

        const nomeHint = item?.produto_nome || item?.descricao || item?.nome || '';
        let produto = salvoDireto && salvoDireto.id ? salvoDireto : null;
        if (!produto) {
          produto = await resolverProdutoRecemCadastrado(nomeHint, item);
        }

        incluirProdutoNoCatalogoRevisao(produto);

        if (typeof callback === 'function') callback(produto || null);
        if (!produto) {
          notificar('Produto salvo, mas não foi possível vinculá-lo automaticamente. Use F2 para selecioná-lo.', 'warning');
        } else {
          notificar('Produto cadastrado e vinculado ao item da NF.', 'success');
        }
      }, { once: true });
    } finally {
      if (estado) estado._abrindoCadastroProduto = false;
    }
  }

  async function cadastrarNovo() {
    const pendencia = estado.sessao.pendencias[estado.sessao.indiceAtual];
    if (!pendencia || !pendenciaAberta(estado.sessao, pendencia)) {
      notificar('Selecione um item pendente para cadastrar.', 'warning');
      return;
    }

    const item = montarItemCadastroXml(pendencia);
    const aoCadastrar = (produto) => {
      if (produto?.id) {
        aplicarConfirmacao(pendencia, produto.id, produto, false);
      }
    };

    // Sempre usa o fluxo empilhado sobre a Central (não abre a busca F2).
    await abrirCadastroProdutoPadrao(item, aoCadastrar);
  }

  function concluirRevisao(meta) {
    if (!estado) return;
    const { sessao, opcoes, inteligencia } = estado;
    const ind = inteligencia?.indicadores;
    if (ind) {
      notificar(
        `Resumo: ${ind.produtos} produtos · ${ind.produtosNovos} novos · ${ind.custoAlterado} custo alterado · ${ind.semCadastro} sem cadastro. Nenhum preço será alterado automaticamente.`,
        'info'
      );
    }
    const resultado = {
      itens: sessao.itens,
      estatisticas: {
        identificadosAutomaticamente: sessao.resumo.identificadosAutomaticamente,
        aprendeu: sessao.aprendizados,
        precisao: calcularPrecisao(sessao.resumo, sessao.confirmadosManualmente),
        confirmadosManualmente: sessao.confirmadosManualmente,
        // RC3.7.6 — espelho read-only (não altera conclusão)
        inteligenciaComercial: ind ? { ...ind } : null
      },
      // Caller (Central) chama finalizar-entrada e abre Compras automaticamente.
      navegacao: {
        abrirCompra: true,
        abrirPedido: false,
        permanecerNaCentral: false,
        proximaAcao: 'ABRIR_COMPRA',
        motivo: meta?.motivoEncerramento || 'manual'
      }
    };

    liberarCacheUltimasComprasRevisao();
    fecharModal();
    estado = null;
    if (typeof opcoes.onConcluir === 'function') opcoes.onConcluir(resultado);
  }

  function cancelarRevisao() {
    const cb = estado?.opcoes?.onCancelar;
    liberarCacheUltimasComprasRevisao();
    fecharModal();
    estado = null;
    // Sessão permanece EM_ANDAMENTO no backend — progresso não é apagado.
    if (typeof cb === 'function') cb({ pausada: true });
  }

  /**
   * Aplica decisões já persistidas na sessão local (retomada).
   */
  function aplicarDecisoesPersistidas(sessao, opcoesSessao) {
    const decisoes = opcoesSessao?.dadosImportacao?.decisoes
      || opcoesSessao?.decisoes
      || [];
    const itensParse = opcoesSessao?.dadosImportacao?.itensParse;
    if (Array.isArray(itensParse) && itensParse.length && Array.isArray(sessao.itens)) {
      itensParse.forEach((it, idx) => {
        if (sessao.itens[idx] && it && typeof it === 'object') {
          Object.assign(sessao.itens[idx], it);
        }
      });
    }

    (decisoes || []).forEach((d) => {
      const idx = Number(d.itemIndex);
      if (!Number.isInteger(idx) || idx < 0) return;
      const decisao = String(d.decisao || '').toUpperCase();
      if (decisao === 'IGNORAR' || decisao === 'IGNORADO') {
        if (!sessao.ignoradas.includes(idx)) sessao.ignoradas.push(idx);
        if (sessao.itens[idx]) {
          sessao.itens[idx].miip_revisao_status = 'ignorado';
          sessao.itens[idx].miip_revisao_decisao = 'IGNORAR';
        }
      } else {
        if (!sessao.resolvidas.includes(idx)) {
          sessao.resolvidas.push(idx);
          sessao.confirmadosManualmente += 1;
        }
        if (sessao.itens[idx]) {
          sessao.itens[idx].miip_revisao_status = 'confirmado';
          sessao.itens[idx].miip_revisao_decisao = decisao || 'CONFIRMAR';
          if (d.produtoDestinoId != null) {
            sessao.itens[idx].produto_id = Number(d.produtoDestinoId);
          }
        }
      }
    });

    // Também restaura a partir do parse (itens já mesclados no backend)
    (sessao.itens || []).forEach((item, idx) => {
      const st = String(item?.miip_revisao_status || item?.miip_revisao_decisao || '').toUpperCase();
      if (!st) return;
      if (st === 'IGNORAR' || st === 'IGNORADO') {
        if (!sessao.ignoradas.includes(idx)) sessao.ignoradas.push(idx);
      } else if (['CONFIRMAR', 'CONFIRMADO', 'CADASTRAR', 'ASSOCIAR', 'CONCLUIDO'].includes(st)) {
        if (!sessao.resolvidas.includes(idx) && !sessao.ignoradas.includes(idx)) {
          sessao.resolvidas.push(idx);
        }
      }
    });

    if (opcoesSessao?.progresso) {
      sessao.progressoPersistido = opcoesSessao.progresso;
    }

    // Posiciona no primeiro pendente
    const primeiro = opcoesSessao?.progresso?.primeiroPendente;
    if (primeiro != null && Number.isInteger(Number(primeiro))) {
      const alvo = Number(primeiro);
      const pos = sessao.pendencias.findIndex((p) => Number(p.indice) === alvo);
      if (pos >= 0) sessao.indiceAtual = pos;
    } else {
      proximaAberta(sessao, 0);
      // se índice atual já está aberto, ok; senão busca próximo
      if (!pendenciaAberta(sessao, sessao.pendencias[sessao.indiceAtual])) {
        proximaAberta(sessao, 1);
      }
    }
  }

  function iniciar(opcoes) {
    if (!opcoes?.dadosImportacao?.miip_importacao?.usarMiipImportacaoXML) {
      if (typeof opcoes.onConcluir === 'function') {
        opcoes.onConcluir({ itens: opcoes.dadosImportacao?.itens || [], estatisticas: {} });
      }
      return;
    }

    const sessao = montarSessao(opcoes.dadosImportacao);

    estado = {
      opcoes: {
        apiUrl: opcoes.apiUrl || (typeof API_URL !== 'undefined' ? API_URL : '/api'),
        produtos: opcoes.produtos || [],
        obterUsuario: opcoes.obterUsuario || (() => null),
        abrirCadastroProduto: opcoes.abrirCadastroProduto || null,
        onConcluir: opcoes.onConcluir,
        onCancelar: opcoes.onCancelar,
        documento: opcoes.documento || null,
        acoesDocumento: opcoes.acoesDocumento || null,
        sessaoPersistente: opcoes.sessaoPersistente || null
      },
      sessao,
      inteligencia: null,
      modal: null,
      _encerrando: false,
      _persistindoDecisao: false,
      correlationId: opcoes.correlationId || null
    };

    if (opcoes.sessaoPersistente) {
      aplicarDecisoesPersistidas(sessao, opcoes.sessaoPersistente);
    }

    estado.inteligencia = montarInteligenciaNaAbertura(
      { ...opcoes, dadosImportacao: opcoes.dadosImportacao, produtos: opcoes.produtos },
      sessao
    );

    // Sem pendências no XML: encerra e a Central abre Compras.
    // Com pendências já todas resolvidas: mostra CTA Finalizar Entrada.
    if (estado.sessao.pendencias.length === 0) {
      encerrarRevisaoAutomaticamente('xml_sem_pendencias');
      return;
    }
    if (contarAbertas(estado.sessao) === 0) {
      abrirModal();
      estado.sessao.fase = 'final';
      renderTelaFinalizarEntrada();
      return;
    }

    abrirModal();
    renderTelaRevisao();
    if (opcoes.sessaoPersistente?.recuperada) {
      notificar('Revisão retomada do ponto em que parou.', 'info');
      atualizarBadgePersistencia('Salvo', 'ok');
    }
  }

  function onKeydown(event) {
    if (!estado || !document.getElementById('miipCentralRevisaoModal')?.classList.contains('show')) return;

    // Cadastro de produto aberto na frente: não interceptar atalhos da revisão.
    if (document.getElementById('produtoModal')?.classList.contains('show')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelarRevisao();
      return;
    }

    if (estado.sessao.fase === 'final') return;

    if (event.key === 'Enter' && !$(event.target).is('input, textarea, select')) {
      event.preventDefault();
      confirmarAtual();
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      abrirBuscaProduto();
      return;
    }

    if (event.key === 'F3') {
      event.preventDefault();
      cadastrarNovo();
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      const k = String(event.key || '').toLowerCase();
      if (k === 'd') {
        event.preventDefault();
        focarSecaoMiip('#miipV2Comparacao, .miip-v2-col--centro');
        return;
      }
      if (k === 'h') {
        event.preventDefault();
        focarSecaoMiip('[data-miip-painel="historicoComercial"]', 'historicoComercial');
        return;
      }
      if (k === 'i') {
        event.preventDefault();
        focarSecaoMiip('#miipV2Identificadores, [data-miip-painel="identificadores"]', 'identificadores');
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      proximaAberta(estado.sessao, event.shiftKey ? -1 : 1);
      renderTelaRevisao();
    }
  }

  function bindEventos() {
    $(document).off('.miipCentral');
    $(document).off('.miipCentralCadastro');
    $(document).on('keydown.miipCentral', onKeydown);

    $('#miipCentralBtnConfirmar').on('click', confirmarAtual);
    $('#miipCentralBtnEscolher').on('click', abrirBuscaProduto);
    $(document).off('click.miipCentralCadastro').on('click.miipCentralCadastro', '#miipCentralBtnCadastrar', function (e) {
      e.preventDefault();
      cadastrarNovo();
    });
    $('#miipCentralBtnIgnorar').on('click', ignorarAtual);
    $('#miipCentralBtnCancelar').on('click', cancelarRevisao);

    $('#miipCentralLista').on('click', '.miip-central-lista-item', function onListaClick() {
      estado.sessao.indiceAtual = Number($(this).data('lista-idx'));
      renderTelaRevisao();
    });

    // RC3.7.6 — filtros visuais (não alteram dados/consulta)
    $('#miipCentralResumo').on('click', '[data-miip-filtro]', function onFiltroClick() {
      if (!estado?.inteligencia) return;
      estado.inteligencia.filtroAtivo = String($(this).data('miip-filtro') || 'todos');
      persistirPrefsUi();
      renderTelaRevisao();
    });

    // RC3.7.6.2 — ordenação / prioridade (somente visual)
    $('#miipCentralLista').on('change', '#miipCentralOrdenarPor', function onOrdenarChange() {
      if (!estado?.inteligencia) return;
      estado.inteligencia.ordenacao = String($(this).val() || 'nfe');
      persistirPrefsUi();
      renderTelaRevisao();
    });
    $('#miipCentralLista').on('change', '#miipCentralFixarPrioritarios', function onFixarChange() {
      if (!estado?.inteligencia) return;
      estado.inteligencia.fixarPrioritarios = Boolean($(this).is(':checked'));
      persistirPrefsUi();
      renderTelaRevisao();
    });

    // RC3.7.6.5 — painéis recolhíveis (não destruir DOM)
    $('#miipCentralCorpo').on('click', '[data-miip-painel-toggle]', function onPainelToggle(e) {
      e.preventDefault();
      e.stopPropagation();
      const I = intel();
      if (!I || !estado?.inteligencia) return;
      const id = String($(this).data('miip-painel-toggle') || '');
      if (!id) return;
      const atuais = obterPaineisUi();
      const proximos = I.alternarPainel(atuais, id);
      estado.inteligencia.paineis = proximos;
      estado.inteligencia.ultimasComprasExpandido = proximos.ultimasCompras !== false;
      persistirPrefsUi();
      aplicarTogglePainelDom($(this).closest('[data-miip-painel]'), I.painelExpandido(proximos, id));
    });

    $('#miipCentralBtnModoFoco').on('click', function onModoFocoClick(e) {
      e.preventDefault();
      alternarModoFocoUi();
    });

    // RC3.7.6 — ações rápidas reutilizam callbacks/APIs da Central
    $('.miip-central-header').on('click', '[data-miip-acao]', function onAcaoDocClick(e) {
      e.preventDefault();
      const acao = String($(this).data('miip-acao') || '');
      const cbs = estado?.opcoes?.acoesDocumento || {};
      const doc = estado?.opcoes?.documento || {};
      if (acao === 'copiar-chave' && typeof cbs.copiarChave === 'function') {
        cbs.copiarChave(doc.id, doc.chave);
        return;
      }
      if (acao === 'ver-xml' && typeof cbs.visualizarXml === 'function') {
        cbs.visualizarXml(doc.id);
        return;
      }
      if (acao === 'reprocessar' && typeof cbs.reprocessar === 'function') {
        cbs.reprocessar(doc.id);
        return;
      }
      if (acao === 'historico' && typeof cbs.historico === 'function') {
        cbs.historico(doc.id);
        return;
      }
      if (acao === 'importar-xml' && typeof cbs.importarXml === 'function') {
        cbs.importarXml(doc.id);
      }
    });

  }

  function montarInteligenciaNaAbertura(opcoes, sessao) {
    const I = intel();
    if (!I || typeof I.montarSnapshot !== 'function') return null;
    // RC3.7.6 — cálculo único na abertura (não a cada render)
    const snap = I.montarSnapshot({
      itens: sessao.itens,
      resultadosMiip: opcoes.dadosImportacao?.miip_importacao?.resultados || [],
      produtos: opcoes.produtos || []
    });
    // RC3.7.6.2 / 6.4 / 6.5 — restaurar preferências locais (nunca no banco)
    const prefs = typeof I.lerPrefsLocal === 'function' ? I.lerPrefsLocal() : null;
    const paineis = I.normalizarPaineis
      ? I.normalizarPaineis(prefs?.paineis)
      : { dashboardComercial: true, historicoComercial: true, ultimasCompras: true };
    if (prefs) {
      snap.filtroAtivo = prefs.filtro || snap.filtroAtivo;
      snap.ordenacao = prefs.ordenacao || 'nfe';
      snap.fixarPrioritarios = prefs.fixarPrioritarios === true;
      snap.paineis = paineis;
      snap.ultimasComprasExpandido = paineis.ultimasCompras !== false;
      snap.modoFoco = prefs.modoFoco === true;
    } else {
      snap.ordenacao = 'nfe';
      snap.fixarPrioritarios = false;
      snap.paineis = paineis;
      snap.ultimasComprasExpandido = true;
      snap.modoFoco = false;
    }
    snap._focoSnapshot = null;
    // RC3.7.6.4 — cache em memória só durante a revisão
    snap.cacheUltimasCompras = {};
    return snap;
  }

  global.MiipCentralRevisao = {
    iniciar,
    _test: {
      montarSessao,
      ordenarPendencias,
      extrairPendencias,
      calcularPrecisao,
      montarInteligenciaNaAbertura,
      /** RC7.5 — validação pura do botão Confirmar Produto */
      validarConfirmacao(pendencia) {
        const produtoId = pendencia?.produtoEncontrado?.id;
        if (!produtoId) {
          return { ok: false, mensagem: 'Selecione um produto para continuar.' };
        }
        return { ok: true, produtoId: Number(produtoId) };
      }
    }
  };
})(typeof window !== 'undefined' ? window : global);
