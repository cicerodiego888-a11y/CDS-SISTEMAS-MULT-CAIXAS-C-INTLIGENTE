/**
 * UX do Fechamento de Caixa V2 — conferência ≠ retirada.
 * Sprint UX 1.0: hierarquia visual. Sem alteração de regra financeira.
 */
(function (global) {
  'use strict';

  function dinheiro(v) {
    if (typeof formatCurrency === 'function') return formatCurrency(Number(v || 0));
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function parseMoeda(valor) {
    if (global.CdsPoliticaMonetaria && typeof global.CdsPoliticaMonetaria.parseMoedaBr === 'function') {
      return global.CdsPoliticaMonetaria.parseMoedaBr(valor);
    }
    return Number(String(valor || '0').replace(/\./g, '').replace(',', '.')) || 0;
  }

  function arred2(v) {
    return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
  }

  function formatarMoedaCampo(v) {
    return Number(v || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseDataLocal(texto) {
    if (!texto) return null;
    const raw = String(texto).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const d = new Date(raw + 'T12:00:00');
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  function formatarHoraCurta(texto) {
    const d = parseDataLocal(texto);
    if (!d) {
      const s = String(texto || '');
      return s.slice(11, 16) || '--:--';
    }
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function formatarDataLabel(texto) {
    if (!texto) return '';
    const d = parseDataLocal(texto) || parseDataLocal(String(texto) + 'T12:00:00');
    if (!d) return escapeHtml(String(texto));
    const hoje = new Date();
    const same = d.getFullYear() === hoje.getFullYear()
      && d.getMonth() === hoje.getMonth()
      && d.getDate() === hoje.getDate();
    const data = d.toLocaleDateString('pt-BR');
    return same ? `Hoje, ${data}` : data;
  }

  function formatarDuracaoSessao(abertoEm) {
    const start = parseDataLocal(abertoEm);
    if (!start) return '—';
    const min = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${String(m).padStart(2, '0')}min`;
  }

  function obterResumoV2(resumo) {
    const c = (resumo && resumo.consolidacao) || {};
    const vendas = c.vendas || {};
    const rec = c.reconciliacao || {};
    return {
      totalVendido: vendas.total_vendido != null ? vendas.total_vendido : ((resumo && resumo.total_vendido) || 0),
      totalRecebido: vendas.total_recebido != null ? vendas.total_recebido : ((resumo && resumo.total_recebido) || 0),
      totalPendente: vendas.total_pendente != null ? vendas.total_pendente : ((resumo && resumo.total_pendente) || 0),
      pagamentos: c.pagamentos || {
        dinheiro: resumo && resumo.dinheiro && resumo.dinheiro.vendas_dinheiro,
        pix: resumo && resumo.digital && resumo.digital.pix,
        debito: resumo && resumo.digital && resumo.digital.cartao_debito,
        credito: resumo && resumo.digital && resumo.digital.cartao_credito,
        tef: resumo && resumo.tef,
        prazo: resumo && resumo.prazo,
        outros: resumo && resumo.outras_formas
      },
      esperado: (c.caixa_fisico && c.caixa_fisico.dinheiro_esperado)
        || (resumo && resumo.dinheiro && resumo.dinheiro.dinheiro_esperado)
        || 0,
      saldoFisico: resumo && resumo.saldo_fisico != null
        ? resumo.saldo_fisico
        : ((resumo && resumo.dinheiro && resumo.dinheiro.dinheiro_esperado) || 0),
      totalFinanceiro: totalFinanceiroSessao(resumo, vendas),
      reconciliacao: rec,
      inconsistentes: (rec.vendas || []).filter((v) =>
        v.status_reconciliacao === 'INCONSISTENTE' || v.status_reconciliacao === 'EXCEDENTE'
      )
    };
  }

  function totalFinanceiroSessao(resumo, vendas) {
    const c = (resumo && resumo.consolidacao) || {};
    const totais = c.totais || {};
    if (resumo && resumo.total_financeiro_sessao != null) return resumo.total_financeiro_sessao;
    if (totais.vendido != null) return totais.vendido;
    if (vendas && vendas.total_vendido != null) return vendas.total_vendido;
    if (resumo && resumo.total_vendido != null) return resumo.total_vendido;
    if (totais.recebido != null) return totais.recebido;
    if (resumo && resumo.total_recebido != null) return resumo.total_recebido;
    return 0;
  }

  function fiscalMaisNf(v) {
    if (v && v.fiscal_mais_nao_fiscal != null) return arred2(v.fiscal_mais_nao_fiscal);
    return arred2(Number(v && v.valor_fiscal || 0) + Number(v && v.valor_nao_fiscal || 0));
  }

  function divergenciaItem(v) {
    if (v && v.divergencia != null && Number.isFinite(Number(v.divergencia))) return arred2(v.divergencia);
    if (v && v.identidade_ok === false) return arred2(fiscalMaisNf(v) - arred2(v.total_oficial));
    return arred2(Number(v && v.recebido_total || 0) - arred2(v && v.total_oficial));
  }

  function resumirInconsistenciasUi(lista) {
    const detalhes = (lista || []).map((v) => ({
      venda_id: v.venda_id,
      oficial: arred2(v.total_oficial),
      fiscal_mais_nao_fiscal: fiscalMaisNf(v),
      divergencia: divergenciaItem(v),
      status: v.status_reconciliacao
    }));
    const saldoLiquido = arred2(detalhes.reduce((acc, item) => acc + item.divergencia, 0));
    return {
      quantidade: detalhes.length,
      valorDivergencia: arred2(Math.abs(saldoLiquido)),
      saldoLiquido,
      detalhes
    };
  }

  function formatarDivergencia(v) {
    const n = arred2(v);
    if (Math.abs(n) < 0.005) return dinheiro(0);
    return n > 0 ? `+${dinheiro(n)}` : dinheiro(n);
  }

  function obterMetaSessao(resumo) {
    const caixa = (resumo && resumo.caixa) || {};
    const sessao = (resumo && resumo.sessao) || {};
    const cons = (resumo && resumo.consolidacao) || {};
    let user = {};
    try {
      if (typeof global.obterUsuarioLogado === 'function') user = global.obterUsuarioLogado() || {};
    } catch (_) { /* ignore */ }
    const operador = cons.operador || {};
    const terminal = cons.terminal || {};
    const caixaId = caixa.id != null ? caixa.id : (cons.caixa && cons.caixa.id);
    return {
      data: caixa.data || (cons.periodo && cons.periodo.data) || '',
      abertoEm: caixa.aberto_em || (cons.periodo && cons.periodo.aberto_em) || (cons.abertura && cons.abertura.em) || '',
      caixaId,
      caixaLabel: caixa.nome || (caixaId != null ? `Caixa ${String(caixaId).padStart(3, '0')}` : ''),
      terminal: terminal.nome || sessao.terminal_id || caixa.terminal_id || terminal.id || '',
      operador: operador.abertura_nome || operador.nome || user.nome || user.username || ''
    };
  }

  function permissoesUsuarioAtual() {
    try {
      const user = typeof global.obterUsuarioLogado === 'function'
        ? global.obterUsuarioLogado()
        : (global.usuarioLogado || {});
      if (typeof global.normalizarPermissoes === 'function') {
        return global.normalizarPermissoes(user && user.permissoes) || [];
      }
      if (Array.isArray(user && user.permissoes)) return user.permissoes.slice();
      return String((user && user.permissoes) || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function usuarioAtual() {
    try {
      if (typeof global.obterUsuarioLogado === 'function') return global.obterUsuarioLogado() || {};
    } catch (_) { /* ignore */ }
    return global.usuarioLogado || {};
  }

  function usuarioPodeAutorizarDivergencia() {
    const perms = permissoesUsuarioAtual();
    if (perms.includes('fechar_caixa_com_divergencia')) return true;
    if (perms.length) return false;
    const user = usuarioAtual();
    const role = String(user && user.role || '').toLowerCase();
    const perfil = String(user && user.perfil || '').toUpperCase();
    return role === 'admin' || ['SUPER_ADMIN', 'ADMIN'].includes(perfil);
  }

  function usuarioPodeFecharComDivergencia() {
    return usuarioPodeAutorizarDivergencia();
  }

  function htmlListaInconsistencias(lista) {
    if (!lista.length) return '';
    return `
      <div class="alert alert-danger mb-0" id="caixa-v2-inconsistencias">
        <strong>⚠ Existem inconsistências nas vendas.</strong>
        <div class="table-responsive mt-2">
          <table class="table table-sm table-bordered bg-white mb-0">
            <thead>
              <tr>
                <th>Venda</th>
                <th>Oficial</th>
                <th>Fiscal + NF</th>
                <th>Divergência</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${lista.map((v) => {
                const div = divergenciaItem(v);
                const cls = div > 0.004 ? 'is-plus' : (div < -0.004 ? 'is-minus' : '');
                return `
                <tr>
                  <td>#${escapeHtml(v.venda_id)}</td>
                  <td>${dinheiro(v.total_oficial)}</td>
                  <td>${dinheiro(fiscalMaisNf(v))}</td>
                  <td class="cds-ui-fc-div-val ${cls}">${formatarDivergencia(div)}</td>
                  <td>${escapeHtml(v.status_reconciliacao || '')}${v.mensagem ? `<br><small>${escapeHtml(v.mensagem)}</small>` : ''}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function htmlLinha(label, valor, id) {
    return `
      <div class="cds-ui-fc-row">
        <span>${label}</span>
        <strong${id ? ` id="${id}"` : ''}>${dinheiro(valor)}</strong>
      </div>
    `;
  }

  function htmlMetaSessao(resumo, opcoes) {
    const meta = obterMetaSessao(resumo);
    const chips = [];
    if (meta.data) chips.push(formatarDataLabel(meta.data));
    if (meta.abertoEm) chips.push(`Sessão: ${formatarHoraCurta(meta.abertoEm)}`);
    if (meta.caixaLabel) chips.push(meta.caixaLabel);
    if (meta.terminal) chips.push(`Terminal ${escapeHtml(String(meta.terminal))}`);
    if (meta.operador) chips.push(`Operador ${escapeHtml(String(meta.operador))}`);
    const metaHtml = chips.length
      ? `<div class="cds-ui-fc-meta">${chips.map((c) => `<span class="cds-ui-fc-chip">${c}</span>`).join('')}</div>`
      : '';
    if (opcoes && opcoes.incluirTitulo) {
      return `
        <header class="cds-ui-fc-header" id="caixa-v2-header">
          <div class="cds-ui-fc-header__text">
            <div class="cds-ui-fc-brand">CDS SISTEMAS</div>
            <h2 class="cds-ui-fc-title">Fechamento de Caixa</h2>
            <p class="cds-ui-fc-sub">Confira os valores da sessão e finalize o caixa</p>
          </div>
          ${metaHtml}
        </header>
      `;
    }
    return `
      <div class="cds-ui-fc-meta-bar" id="caixa-v2-header">
        <span class="cds-ui-fc-brand">CDS SISTEMAS</span>
        ${metaHtml}
      </div>
    `;
  }

  function htmlStatus(resumo) {
    const meta = obterMetaSessao(resumo);
    return `
      <div class="cds-ui-fc-status" id="caixa-v2-status" role="status">
        <div class="cds-ui-fc-status__left">
          <span class="cds-ui-fc-status__icon" aria-hidden="true">✓</span>
          <div>
            <strong>Caixa Aberto</strong>
            <div class="cds-ui-fc-status__hint">Iniciado às ${formatarHoraCurta(meta.abertoEm)}</div>
          </div>
        </div>
        <div class="cds-ui-fc-status__right">
          <span class="cds-ui-fc-status__hint">Tempo de sessão</span>
          <strong id="caixa-v2-tempo-sessao">${formatarDuracaoSessao(meta.abertoEm)}</strong>
        </div>
      </div>
    `;
  }

  function htmlTresCards(resumo) {
    const d = (resumo && resumo.dinheiro) || {};
    const digital = (resumo && resumo.digital) || {};
    const r = obterResumoV2(resumo);
    const p = r.pagamentos || {};
    const extrasDigitais = [];
    if (Number(p.tef)) extrasDigitais.push(['TEF', p.tef]);
    if (Number(p.outros)) extrasDigitais.push(['Outras digitais', p.outros]);
    Object.keys(digital || {}).forEach((chave) => {
      if (['pix', 'cartao_credito', 'cartao_debito', 'total_digital'].includes(chave)) return;
      const valor = digital[chave];
      if (typeof valor === 'number' && Number(valor)) {
        extrasDigitais.push([chave.replace(/_/g, ' '), valor]);
      }
    });

    return `
      <div class="cds-ui-fc-cards" id="caixa-v2-cards">
        <article class="cds-ui-fc-card cds-ui-fc-card--fisico" id="caixa-v2-card-fisico">
          <header class="cds-ui-fc-card__head">
            <span><i class="fas fa-money-bill-wave" aria-hidden="true"></i> Dinheiro Físico</span>
          </header>
          <div class="cds-ui-fc-card__body">
            ${htmlLinha('Valor Inicial', d.valor_inicial, 'caixa-v2-val-inicial')}
            ${htmlLinha('Vendas em Dinheiro', d.vendas_dinheiro, 'caixa-v2-val-vendas-dinheiro')}
            ${htmlLinha('Suprimentos (+)', d.suprimentos, 'caixa-v2-val-suprimentos')}
            ${htmlLinha('Sangrias (−)', d.sangrias, 'caixa-v2-val-sangrias')}
          </div>
          <footer class="cds-ui-fc-destaque">
            <span>Dinheiro Esperado</span>
            <strong id="caixa-v2-card-esperado">${dinheiro(d.dinheiro_esperado)}</strong>
          </footer>
        </article>

        <article class="cds-ui-fc-card cds-ui-fc-card--digital" id="caixa-v2-card-digital">
          <header class="cds-ui-fc-card__head">
            <span><i class="fas fa-credit-card" aria-hidden="true"></i> Recebimentos Digitais</span>
            ${extrasDigitais.length ? `
              <details class="cds-ui-fc-mini-details">
                <summary>Ver detalhes</summary>
                <div class="cds-ui-fc-mini-details__body">
                  ${extrasDigitais.map(([label, valor]) => htmlLinha(escapeHtml(label), valor)).join('')}
                </div>
              </details>
            ` : ''}
          </header>
          <div class="cds-ui-fc-card__body">
            ${htmlLinha('PIX', digital.pix, 'caixa-v2-val-pix')}
            ${htmlLinha('Cartão Crédito', digital.cartao_credito, 'caixa-v2-val-credito')}
            ${htmlLinha('Cartão Débito', digital.cartao_debito, 'caixa-v2-val-debito')}
          </div>
          <footer class="cds-ui-fc-destaque cds-ui-fc-destaque--digital">
            <span>Total Digital</span>
            <strong id="caixa-v2-val-digital">${dinheiro(digital.total_digital)}</strong>
          </footer>
        </article>

        <article class="cds-ui-fc-card cds-ui-fc-card--resumo" id="caixa-v2-card-resumo">
          <header class="cds-ui-fc-card__head">
            <span><i class="fas fa-chart-pie" aria-hidden="true"></i> Resumo Geral</span>
            <details class="cds-ui-fc-mini-details">
              <summary>Ver detalhes</summary>
              <div class="cds-ui-fc-mini-details__body">
                ${htmlLinha('Total financeiro da sessão', r.totalFinanceiro, 'caixa-v2-val-financeiro-detalhe')}
              </div>
            </details>
          </header>
          <div class="cds-ui-fc-card__body">
            ${htmlLinha('Total vendido', resumo.total_vendido, 'caixa-v2-val-vendido')}
            ${htmlLinha('Total recebido', resumo.total_recebido != null ? resumo.total_recebido : resumo.total_vendido, 'caixa-v2-val-recebido')}
            ${htmlLinha('Pendente', resumo.total_pendente || 0, 'caixa-v2-val-pendente')}
            ${htmlLinha('Vendas a Prazo', resumo.prazo, 'caixa-v2-val-prazo')}
            ${htmlLinha('TEF', resumo.tef || 0, 'caixa-v2-val-tef')}
            ${htmlLinha('Outras Formas', resumo.outras_formas, 'caixa-v2-val-outras')}
            ${htmlLinha('Entregas pendentes', resumo.entregas_pendentes || 0, 'caixa-v2-val-entregas')}
          </div>
          <footer class="cds-ui-fc-destaque cds-ui-fc-destaque--resumo">
            <span>Total financeiro da sessão</span>
            <strong id="caixa-v2-val-financeiro">${dinheiro(r.totalFinanceiro)}</strong>
          </footer>
        </article>
      </div>
    `;
  }

  function htmlConferencia(r) {
    return `
      <section class="cds-ui-fc-step cds-ui-fc-step--conf" id="caixa-v2-conferencia">
        <header class="cds-ui-fc-step__head">
          <span class="cds-ui-fc-step__num">3</span>
          <div>
            <h3 class="cds-ui-fc-step__title">Conferência do dinheiro</h3>
            <p class="cds-ui-fc-step__hint">Compare o dinheiro esperado com o valor contado na gaveta</p>
          </div>
        </header>
        <div class="cds-ui-fc-conf">
          <div class="cds-ui-fc-conf__col">
            <span class="cds-ui-fc-label">Dinheiro esperado</span>
            <strong class="cds-ui-fc-conf__valor" id="caixa-v2-esperado">${dinheiro(r.esperado)}</strong>
          </div>
          <div class="cds-ui-fc-conf__col cds-ui-fc-conf__col--input">
            <label class="cds-ui-fc-label" for="valor-fechamento">Quanto você contou?</label>
            <input type="text" inputmode="decimal" id="valor-fechamento" class="form-control cds-ui-fc-input-destaque" placeholder="R$ 0,00" value="" autocomplete="off">
          </div>
          <div class="cds-ui-fc-conf__col">
            <span class="cds-ui-fc-label">Diferença física</span>
            <div class="cds-ui-fc-diff is-ok" id="caixa-v2-diferenca-box">
              <strong class="cds-ui-fc-diff__val" id="caixa-v2-diferenca">${dinheiro(0)}</strong>
              <span class="cds-ui-fc-diff__msg" id="caixa-v2-diferenca-msg">✓ Dinheiro conferido</span>
            </div>
          </div>
          <button type="button" class="cds-ui-fc-atalho" id="caixa-v2-usar-esperado">
            <i class="fas fa-calculator" aria-hidden="true"></i>
            <span>Usar valor esperado</span>
            <strong id="caixa-v2-atalho-esperado">${dinheiro(r.esperado)}</strong>
          </button>
        </div>
      </section>
    `;
  }

  function htmlRetirada(r) {
    return `
      <section class="cds-ui-fc-step" id="caixa-v2-retirada">
        <header class="cds-ui-fc-step__head">
          <span class="cds-ui-fc-step__num cds-ui-fc-step__num--info">4</span>
          <div>
            <h3 class="cds-ui-fc-step__title">Retirada no fechamento</h3>
            <p class="cds-ui-fc-step__hint">Defina quanto será retirado do caixa</p>
          </div>
        </header>
        <div class="cds-ui-fc-ret">
          <div class="cds-ui-fc-ret-grid">
            <label class="cds-ui-fc-ret-card" for="caixa-v2-ret-nao">
              <input class="form-check-input" type="radio" name="caixa-v2-retirada" id="caixa-v2-ret-nao" value="nenhuma" checked>
              <span class="cds-ui-fc-ret-card__title">Não retirar</span>
              <span class="cds-ui-fc-ret-card__sub">Deixar tudo no caixa</span>
            </label>
            <label class="cds-ui-fc-ret-card" for="caixa-v2-ret-tudo">
              <input class="form-check-input" type="radio" name="caixa-v2-retirada" id="caixa-v2-ret-tudo" value="total">
              <span class="cds-ui-fc-ret-card__title">Retirar tudo</span>
              <span class="cds-ui-fc-ret-card__sub">Zerar o caixa</span>
            </label>
            <label class="cds-ui-fc-ret-card" for="caixa-v2-ret-valor">
              <input class="form-check-input" type="radio" name="caixa-v2-retirada" id="caixa-v2-ret-valor" value="valor">
              <span class="cds-ui-fc-ret-card__title">Informar valor</span>
              <span class="cds-ui-fc-ret-card__sub">Definir quanto vai retirar</span>
            </label>
          </div>
          <div class="cds-ui-fc-ret-side">
            <div class="cds-ui-fc-retirada-campo d-none" id="caixa-v2-retirada-campo">
              <label class="cds-ui-fc-label" for="caixa-v2-retirada-valor">Quanto vai retirar?</label>
              <input type="text" inputmode="decimal" id="caixa-v2-retirada-valor" class="form-control" placeholder="R$ 0,00" disabled autocomplete="off">
            </div>
            <div class="cds-ui-fc-saldo" id="caixa-v2-saldo-box">
              <span class="cds-ui-fc-label">Saldo que ficará no caixa</span>
              <strong id="caixa-v2-saldo-final">${dinheiro(0)}</strong>
              <small class="cds-ui-fc-status__hint">Após a retirada</small>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function htmlMovimentacoes() {
    return `
      <section class="cds-ui-fc-step" id="caixa-v2-movimentacoes">
        <header class="cds-ui-fc-step__head">
          <span class="cds-ui-fc-step__icon" aria-hidden="true">↔</span>
          <div>
            <h3 class="cds-ui-fc-step__title">Movimentações do Caixa</h3>
            <p class="cds-ui-fc-step__hint">Registre sangria ou suprimento sem sair desta tela</p>
          </div>
        </header>
        <div class="cds-ui-fc-mov">
          <div class="cds-ui-fc-mov__row">
            <div>
              <label class="cds-ui-fc-label" for="valor-sangria">Valor da Sangria</label>
              <input type="text" inputmode="decimal" id="valor-sangria" class="form-control" placeholder="Ex: 50,00" autocomplete="off">
            </div>
            <div class="cds-ui-fc-mov__motivo">
              <label class="cds-ui-fc-label" for="motivo-sangria">Motivo</label>
              <input type="text" id="motivo-sangria" class="form-control" placeholder="Ex: retirada para pagamento" autocomplete="off">
            </div>
            <div class="cds-ui-fc-mov__acao">
              <button type="button" class="btn cds-ui-fc-btn-sangria" onclick="registrarSangria()">
                − Registrar Sangria
              </button>
            </div>
          </div>
          <div class="cds-ui-fc-mov__row">
            <div>
              <label class="cds-ui-fc-label" for="valor-suprimento">Valor do Suprimento</label>
              <input type="text" inputmode="decimal" id="valor-suprimento" class="form-control" placeholder="Ex: 100,00" autocomplete="off">
            </div>
            <div class="cds-ui-fc-mov__motivo">
              <label class="cds-ui-fc-label" for="motivo-suprimento">Motivo</label>
              <input type="text" id="motivo-suprimento" class="form-control" placeholder="Ex: reforço de troco" autocomplete="off">
            </div>
            <div class="cds-ui-fc-mov__acao">
              <button type="button" class="btn cds-ui-fc-btn-suprimento" onclick="registrarSuprimento()">
                + Registrar Suprimento
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function htmlReconciliacao(r) {
    const rec = r.reconciliacao || {};
    const tot = resumirInconsistenciasUi(r.inconsistentes);
    const ok = tot.quantidade === 0
      && !(rec.vendas_inconsistentes)
      && !(rec.vendas_excedentes);
    return `
      <section class="cds-ui-fc-recon ${ok ? 'is-ok' : 'is-alert'}" id="caixa-v2-reconciliacao">
        <div class="cds-ui-fc-recon__resumo">
          ${ok
            ? '<span>✓ Vendas conferidas</span><span>✓ Nenhuma inconsistência</span>'
            : `<span>⚠ Reconciliação precisa de atenção</span>
               <span id="caixa-v2-rec-qtd">${tot.quantidade} venda(s) inconsistente(s)</span>
               <span>Diferença total: <strong id="caixa-v2-rec-diff-total">${dinheiro(tot.valorDivergencia)}</strong></span>
               <span>Saldo líquido: <strong id="caixa-v2-rec-saldo-liquido">${formatarDivergencia(tot.saldoLiquido)}</strong></span>`}
        </div>
        <div class="cds-ui-fc-recon-block d-none" id="caixa-v2-recon-bloqueio">
          <div class="cds-ui-fc-recon-block__fisico d-none" id="caixa-v2-recon-dinheiro-ok">
            <strong>✓ Dinheiro conferido</strong>
            <span id="caixa-v2-recon-dinheiro-ok-val">${dinheiro(r.esperado)}</span>
          </div>
          <div>
            <strong>⚠ Existem <span id="caixa-v2-recon-block-qtd">${tot.quantidade}</span> vendas inconsistentes</strong>
          </div>
          <div>Diferença encontrada: <strong id="caixa-v2-recon-block-diff">${dinheiro(tot.valorDivergencia)}</strong></div>
          <p id="caixa-v2-recon-block-msg">O fechamento com esta divergência exige autorização.</p>
          <button type="button" class="btn btn-outline-danger btn-sm" id="caixa-v2-ver-inconsistencias">
            Ver inconsistências
          </button>
        </div>
        <details id="caixa-v2-recon-detalhes">
          <summary>Ver detalhes da reconciliação</summary>
          <div class="cds-ui-fc-recon__detalhes">
            Vendas OK: <strong id="caixa-v2-rec-ok">${rec.vendas_ok || 0}</strong> ·
            Parciais: <strong id="caixa-v2-rec-parciais">${rec.vendas_parciais || 0}</strong> ·
            Pendentes: <strong id="caixa-v2-rec-pendentes">${rec.vendas_pendentes || 0}</strong> ·
            Inconsistentes: <strong id="caixa-v2-rec-inconsistentes">${rec.vendas_inconsistentes || 0}</strong>
            ${htmlListaInconsistencias(r.inconsistentes)}
          </div>
        </details>
      </section>
    `;
  }

  function htmlObservacao() {
    return `
      <section class="cds-ui-fc-obs" id="caixa-v2-obs">
        <details>
          <summary>Observação (opcional)</summary>
          <textarea id="observacao-fechamento" class="form-control mt-2" rows="2" placeholder="Anotação do fechamento"></textarea>
        </details>
        <div class="cds-ui-fc-just d-none" id="caixa-v2-justificativa-wrap">
          <label class="cds-ui-fc-label" for="caixa-v2-justificativa">Justificativa da divergência</label>
          <textarea id="caixa-v2-justificativa" class="form-control" rows="2" placeholder="Obrigatória para fechar com diferença"></textarea>
        </div>
        <p class="cds-ui-fc-div-msg d-none" id="caixa-v2-div-msg">
          Existe uma diferença no caixa. O fechamento precisa ser autorizado por um administrador.
        </p>
      </section>
    `;
  }

  function htmlAcoes() {
    return `
      <div class="cds-ui-fc-actions" id="caixa-v2-acoes">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <button type="button" class="btn btn-outline-secondary" id="btn-caixa-v2-cancelar">
            ✕ Cancelar
          </button>
          <button type="button" class="btn btn-outline-dark btn-sm" id="btn-caixa-v2-ver-anteriores"
            onclick="(function(){var el=document.getElementById('caixa-consulta-anteriores');if(el){el.scrollIntoView({behavior:'smooth',block:'start'});}})()">
            <i class="fas fa-calendar-alt"></i> Caixas anteriores
          </button>
        </div>
        <div class="cds-ui-fc-actions__right">
          <button type="button" class="btn btn-outline-warning d-none" id="btn-fechar-caixa-div-v2" onclick="fecharCaixaComDivergencia()">
            Fechar com divergência
          </button>
          <button type="button" class="btn cds-ui-fc-btn-primary" id="btn-fechar-caixa-v2" onclick="fecharCaixa()">
            ✓ Finalizar Fechamento →
          </button>
        </div>
      </div>
    `;
  }

  function montarHtmlTelaAberta(resumo, opcoes) {
    const r = obterResumoV2(resumo || {});
    return `
      <div class="cds-ui cds-ui-fc" id="caixa-v2-tela">
        <div class="cds-ui-fc-scroll">
          ${htmlMetaSessao(resumo || {}, opcoes)}
          ${htmlStatus(resumo || {})}
          ${htmlTresCards(resumo || {})}
          ${htmlConferencia(r)}
          ${htmlRetirada(r)}
          ${htmlMovimentacoes()}
          ${htmlReconciliacao(r)}
          ${htmlObservacao()}
        </div>
        ${htmlAcoes()}
      </div>
    `;
  }

  function montarHtmlFechamento(resumo) {
    return montarHtmlTelaAberta(resumo, { incluirTitulo: false });
  }

  function capturarEstadoOperacional() {
    const campo = typeof document !== 'undefined' ? document.getElementById('valor-fechamento') : null;
    if (!campo) return { existe: false };
    const checked = (typeof document !== 'undefined'
      && document.querySelector('input[name="caixa-v2-retirada"]:checked'))
      || null;
    return {
      existe: true,
      valorContado: campo.value || '',
      modo: checked ? checked.value : 'nenhuma',
      retiradaValor: (document.getElementById('caixa-v2-retirada-valor') || {}).value || '',
      observacao: (document.getElementById('observacao-fechamento') || {}).value || '',
      justificativa: (document.getElementById('caixa-v2-justificativa') || {}).value || '',
      reconAberto: !!(document.getElementById('caixa-v2-recon-detalhes')
        && document.getElementById('caixa-v2-recon-detalhes').open),
      editing: !!(global.UIFocusManager
        && global.UIFocusManager.isEditing(document.getElementById('caixa-area') || document.getElementById('caixa-v2-tela')))
        || (typeof document !== 'undefined' && document.activeElement && document.activeElement.id === 'valor-fechamento')
    };
  }

  function restaurarEstadoOperacional(estado) {
    if (!estado || !estado.existe || typeof document === 'undefined') return;
    const campo = document.getElementById('valor-fechamento');
    if (campo) campo.value = estado.valorContado || '';
    const radio = document.getElementById(
      estado.modo === 'total' ? 'caixa-v2-ret-tudo'
        : estado.modo === 'valor' ? 'caixa-v2-ret-valor'
          : 'caixa-v2-ret-nao'
    );
    if (radio) radio.checked = true;
    const ret = document.getElementById('caixa-v2-retirada-valor');
    if (ret && estado.modo === 'valor') ret.value = estado.retiradaValor || '';
    const obs = document.getElementById('observacao-fechamento');
    if (obs) obs.value = estado.observacao || '';
    const just = document.getElementById('caixa-v2-justificativa');
    if (just) just.value = estado.justificativa || '';
    const recon = document.getElementById('caixa-v2-recon-detalhes');
    if (recon && estado.reconAberto) recon.open = true;
  }

  function aplicarVisualDiferenca(diferenca) {
    const box = document.getElementById('caixa-v2-diferenca-box');
    const msg = document.getElementById('caixa-v2-diferenca-msg');
    const val = document.getElementById('caixa-v2-diferenca');
    const zero = Math.abs(diferenca) < 0.005;
    if (val) {
      if (zero) val.textContent = dinheiro(0);
      else if (diferenca > 0) val.textContent = `+${dinheiro(diferenca)}`;
      else val.textContent = dinheiro(diferenca);
    }
    if (box) {
      box.classList.remove('is-ok', 'is-warn');
      box.classList.add(zero ? 'is-ok' : 'is-warn');
    }
    if (msg) msg.textContent = zero ? '✓ Dinheiro conferido' : (diferenca < 0 ? 'Falta dinheiro' : 'Sobra de dinheiro');
    const tela = typeof document !== 'undefined' ? document.getElementById('caixa-v2-tela') : null;
    if (tela) tela._cdsDiferencaFisica = diferenca;
    return zero;
  }

  function avaliarDivergenciaTela() {
    const tot = obterInconsistenciasTela();
    const tela = typeof document !== 'undefined' ? document.getElementById('caixa-v2-tela') : null;
    const diferenca = tela && tela._cdsDiferencaFisica != null
      ? Number(tela._cdsDiferencaFisica)
      : 0;
    const temFisica = Math.abs(diferenca) >= 0.005;
    const temRecon = tot.quantidade > 0;
    return {
      exige_autorizacao: temRecon || temFisica,
      temFisica,
      temRecon,
      quantidade: tot.quantidade,
      valor_divergencia: temRecon ? tot.valorDivergencia : Math.abs(diferenca),
      saldo_liquido: tot.saldoLiquido,
      diferenca_fisica: diferenca
    };
  }

  function obterInconsistenciasTela() {
    const tela = typeof document !== 'undefined' ? document.getElementById('caixa-v2-tela') : null;
    const lista = tela && tela._cdsInconsistentes ? tela._cdsInconsistentes : [];
    return resumirInconsistenciasUi(lista);
  }

  function abrirInconsistencias() {
    const recon = typeof document !== 'undefined' ? document.getElementById('caixa-v2-recon-detalhes') : null;
    if (recon) {
      recon.open = true;
      if (typeof recon.scrollIntoView === 'function') {
        recon.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function podeFinalizarFechamento() {
    return { ok: true, avaliacao: avaliarDivergenciaTela() };
  }

  function aplicarVisualDivergencia(zero) {
    const $ = global.$;
    if (typeof $ !== 'function') return;
    const tot = obterInconsistenciasTela();
    const temInconsistencias = tot.quantidade > 0;
    const autorizado = usuarioPodeFecharComDivergencia();
    const $divBtn = $('#btn-fechar-caixa-div-v2');
    const $msg = $('#caixa-v2-div-msg');
    const $just = $('#caixa-v2-justificativa-wrap');
    const $btn = $('#btn-fechar-caixa-v2');
    const $block = $('#caixa-v2-recon-bloqueio');
    const $dinOk = $('#caixa-v2-recon-dinheiro-ok');

    if (temInconsistencias) {
      $block.removeClass('d-none');
      $('#caixa-v2-recon-block-qtd').text(String(tot.quantidade));
      $('#caixa-v2-recon-block-diff').text(dinheiro(tot.valorDivergencia));
      if (zero) $dinOk.removeClass('d-none');
      else $dinOk.addClass('d-none');
      $btn.prop('disabled', false).removeAttr('aria-disabled').removeClass('is-blocked');
      $divBtn.addClass('d-none').prop('disabled', true);
      if (zero) {
        $just.addClass('d-none');
        $msg.addClass('d-none');
      } else {
        $just.toggleClass('d-none', !autorizado);
        $msg.toggleClass('d-none', autorizado);
      }
      return;
    }

    $block.addClass('d-none');
    $btn.prop('disabled', false).removeAttr('aria-disabled').removeClass('is-blocked');
    $divBtn.prop('disabled', false);
    if (zero) {
      $divBtn.addClass('d-none');
      $msg.addClass('d-none');
      $just.addClass('d-none');
      return;
    }
    $just.removeClass('d-none');
    if (autorizado) {
      $divBtn.removeClass('d-none');
      $msg.addClass('d-none');
    } else {
      $divBtn.addClass('d-none');
      $msg.removeClass('d-none');
      $btn.prop('disabled', false).removeAttr('aria-disabled').removeClass('is-blocked');
    }
  }

  function ligarCalculos(esperado) {
    const esperadoN = arred2(esperado);
    const $ = global.$;
    if (typeof $ !== 'function') return;

    const atualizar = () => {
      const conferido = parseMoeda($('#valor-fechamento').val());
      const modo = $('input[name="caixa-v2-retirada"]:checked').val() || 'nenhuma';
      const $campoRet = $('#caixa-v2-retirada-valor');
      const $wrapRet = $('#caixa-v2-retirada-campo');
      let retirada = 0;
      if (modo === 'nenhuma') {
        $wrapRet.addClass('d-none');
        $campoRet.prop('disabled', true);
        retirada = 0;
      } else if (modo === 'total') {
        $wrapRet.addClass('d-none');
        $campoRet.prop('disabled', true);
        retirada = conferido;
      } else {
        $wrapRet.removeClass('d-none');
        $campoRet.prop('disabled', false);
        retirada = parseMoeda($campoRet.val());
      }
      const diferenca = arred2(conferido - esperadoN);
      const saldo = arred2(conferido - retirada);
      const zero = aplicarVisualDiferenca(diferenca);
      $('#caixa-v2-saldo-final').text(dinheiro(saldo));
      aplicarVisualDivergencia(zero);
    };

    $(document).off('input.caixaV2 change.caixaV2 click.caixaV2esperado click.caixaV2cancel click.caixaV2recon');
    $(document).on('input.caixaV2 change.caixaV2', '#valor-fechamento, #caixa-v2-retirada-valor, input[name="caixa-v2-retirada"]', atualizar);
    $(document).on('click.caixaV2recon', '#caixa-v2-ver-inconsistencias', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      abrirInconsistencias();
    });
    $(document).on('click.caixaV2esperado', '#caixa-v2-usar-esperado', function () {
      const campo = document.getElementById('valor-fechamento');
      if (!campo) return;
      campo.value = formatarMoedaCampo(esperadoN);
      atualizar();
    });
    $(document).on('click.caixaV2cancel', '#btn-caixa-v2-cancelar', function () {
      const campo = document.getElementById('valor-fechamento');
      if (campo) campo.value = '';
      const nao = document.getElementById('caixa-v2-ret-nao');
      if (nao) nao.checked = true;
      const ret = document.getElementById('caixa-v2-retirada-valor');
      if (ret) ret.value = '';
      const obs = document.getElementById('observacao-fechamento');
      if (obs) obs.value = '';
      const just = document.getElementById('caixa-v2-justificativa');
      if (just) just.value = '';
      atualizar();
    });
    atualizar();
  }

  function coletarPayload(fecharComDivergencia) {
    const $ = global.$;
    const conferido = parseMoeda($('#valor-fechamento').val());
    const modo = $('input[name="caixa-v2-retirada"]:checked').val() || 'nenhuma';
    let retirada = 0;
    if (modo === 'total') retirada = conferido;
    else if (modo === 'valor') retirada = parseMoeda($('#caixa-v2-retirada-valor').val());
    return {
      valor_informado: conferido,
      dinheiro_conferido: conferido,
      modo_retirada: modo,
      retirada_fechamento: retirada,
      observacao: $('#observacao-fechamento').val() || '',
      justificativa_divergencia: $('#caixa-v2-justificativa').val() || '',
      fechar_com_divergencia: fecharComDivergencia === true
    };
  }

  function removerDialogoFechamento() {
    const atual = typeof document !== 'undefined'
      ? document.getElementById('caixa-v2-dialogo')
      : null;
    if (atual && atual.parentNode) atual.parentNode.removeChild(atual);
  }

  function htmlConfirmacaoDivergencia(valor) {
    return `
      <div class="cds-ui-fc-dialog__card" role="dialog" aria-labelledby="caixa-v2-dlg-titulo">
        <h3 id="caixa-v2-dlg-titulo">⚠ Divergência no fechamento</h3>
        <p>Foi identificada uma divergência de ${dinheiro(valor)}.</p>
        <p>Deseja fechar o caixa mesmo assim?</p>
        <div class="cds-ui-fc-dialog__actions">
          <button type="button" class="btn btn-outline-secondary" id="caixa-v2-dlg-nao">NÃO</button>
          <button type="button" class="btn cds-ui-fc-btn-primary" id="caixa-v2-dlg-sim">SIM</button>
        </div>
      </div>
    `;
  }

  function htmlAutorizacaoAdmin() {
    return `
      <div class="cds-ui-fc-dialog__card" role="dialog" aria-labelledby="caixa-v2-auth-titulo">
        <h3 id="caixa-v2-auth-titulo">🔐 Autorização de administrador</h3>
        <label class="cds-ui-fc-label" for="caixa-v2-auth-usuario">Usuário</label>
        <input type="text" id="caixa-v2-auth-usuario" class="form-control" autocomplete="username">
        <label class="cds-ui-fc-label mt-2" for="caixa-v2-auth-senha">Senha</label>
        <input type="password" id="caixa-v2-auth-senha" class="form-control" autocomplete="current-password">
        <div class="cds-ui-fc-dialog__actions">
          <button type="button" class="btn btn-outline-secondary" id="caixa-v2-auth-cancelar">CANCELAR</button>
          <button type="button" class="btn cds-ui-fc-btn-primary" id="caixa-v2-auth-ok">AUTORIZAR E FECHAR</button>
        </div>
      </div>
    `;
  }

  function montarDialogo(html) {
    removerDialogoFechamento();
    const tela = typeof document !== 'undefined' ? document.getElementById('caixa-v2-tela') : null;
    const host = tela || (typeof document !== 'undefined' ? document.body : null);
    if (!host) return null;
    const wrap = document.createElement('div');
    wrap.id = 'caixa-v2-dialogo';
    wrap.className = 'cds-ui-fc-dialog';
    wrap.innerHTML = html;
    host.appendChild(wrap);
    return wrap;
  }

  function confirmarDivergenciaFechamento(valor, hook) {
    if (typeof hook === 'function') return Promise.resolve(hook(valor));
    if (typeof document === 'undefined') return Promise.resolve(false);
    return new Promise((resolve) => {
      const wrap = montarDialogo(htmlConfirmacaoDivergencia(valor));
      if (!wrap) return resolve(false);
      const fechar = (sim) => {
        removerDialogoFechamento();
        resolve(sim === true);
      };
      wrap.querySelector('#caixa-v2-dlg-sim').addEventListener('click', () => fechar(true));
      wrap.querySelector('#caixa-v2-dlg-nao').addEventListener('click', () => fechar(false));
    });
  }

  function solicitarAutorizacaoAdminFechamento(hook) {
    if (typeof hook === 'function') return Promise.resolve(hook());
    if (typeof document === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const wrap = montarDialogo(htmlAutorizacaoAdmin());
      if (!wrap) return resolve(null);
      const usuarioEl = wrap.querySelector('#caixa-v2-auth-usuario');
      const senhaEl = wrap.querySelector('#caixa-v2-auth-senha');
      const fechar = (cred) => {
        removerDialogoFechamento();
        resolve(cred || null);
      };
      wrap.querySelector('#caixa-v2-auth-cancelar').addEventListener('click', () => fechar(null));
      wrap.querySelector('#caixa-v2-auth-ok').addEventListener('click', () => {
        const usuario = String(usuarioEl && usuarioEl.value || '').trim();
        const senha = String(senhaEl && senhaEl.value || '');
        if (!usuario || !senha) return;
        fechar({ usuario, senha });
      });
      if (usuarioEl && typeof usuarioEl.focus === 'function') usuarioEl.focus();
    });
  }

  function prepararFechamento(fecharComDivergencia, deps) {
    const opcoes = deps || {};
    const notify = typeof opcoes.notify === 'function' ? opcoes.notify : function () {};
    const confirmSimples = typeof opcoes.confirmSimples === 'function'
      ? opcoes.confirmSimples
      : function (msg) {
        return Promise.resolve(typeof global.confirm === 'function' ? !!global.confirm(msg) : true);
      };
    const confirmDiv = typeof opcoes.confirmDivergencia === 'function'
      ? opcoes.confirmDivergencia
      : confirmarDivergenciaFechamento;
    const pedirAuth = typeof opcoes.pedirAutorizacao === 'function'
      ? opcoes.pedirAutorizacao
      : solicitarAutorizacaoAdminFechamento;

    const avaliacao = opcoes.avaliacao || avaliarDivergenciaTela();
    const payload = typeof opcoes.coletarPayload === 'function'
      ? opcoes.coletarPayload(fecharComDivergencia === true)
      : coletarPayload(fecharComDivergencia === true);
    const podeAutorizar = typeof opcoes.usuarioPodeAutorizar === 'function'
      ? !!opcoes.usuarioPodeAutorizar()
      : usuarioPodeAutorizarDivergencia();

    if (!avaliacao.exige_autorizacao) {
      payload.fechar_com_divergencia = false;
      return Promise.resolve(confirmSimples('Tem certeza que deseja fechar o caixa?')).then((ok) => {
        if (!ok) return { ok: false, cancelado: true, avaliacao };
        return { ok: true, payload, avaliacao };
      });
    }

    if (avaliacao.temFisica && !String(payload.justificativa_divergencia || '').trim()) {
      return Promise.resolve({
        ok: false,
        erro: 'Informe a justificativa para fechar com divergência.',
        avaliacao
      });
    }

    return Promise.resolve(confirmDiv(avaliacao.valor_divergencia)).then((sim) => {
      if (!sim) return { ok: false, cancelado: true, avaliacao };
      payload.fechar_com_divergencia = true;
      if (podeAutorizar) {
        notify('Fechamento autorizado.', 'success');
        return { ok: true, payload, avaliacao, autorizadoLocal: true };
      }
      notify('É necessária autorização de um administrador.', 'warning');
      return Promise.resolve(pedirAuth()).then((cred) => {
        if (!cred || !cred.usuario || !cred.senha) {
          return { ok: false, cancelado: true, avaliacao };
        }
        payload.usuario_admin = cred.usuario;
        payload.senha_admin = cred.senha;
        notify('Autorização concedida.', 'success');
        return { ok: true, payload, avaliacao, autorizadoAdmin: true };
      });
    });
  }

  function atualizarValoresResumo(resumo) {
    const tela = typeof document !== 'undefined' ? document.getElementById('caixa-v2-tela') : null;
    if (!tela || !resumo) return false;
    const d = resumo.dinheiro || {};
    const digital = resumo.digital || {};
    const r = obterResumoV2(resumo);
    const patch = (id, text) => {
      if (global.UISoftRefresh && typeof global.UISoftRefresh.patchText === 'function') {
        global.UISoftRefresh.patchText('#' + id, text);
        return;
      }
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    patch('caixa-v2-val-inicial', dinheiro(d.valor_inicial));
    patch('caixa-v2-val-vendas-dinheiro', dinheiro(d.vendas_dinheiro));
    patch('caixa-v2-val-suprimentos', dinheiro(d.suprimentos));
    patch('caixa-v2-val-sangrias', dinheiro(d.sangrias));
    patch('caixa-v2-card-esperado', dinheiro(d.dinheiro_esperado));
    patch('caixa-v2-esperado', dinheiro(r.esperado));
    patch('caixa-v2-atalho-esperado', dinheiro(r.esperado));
    patch('caixa-v2-val-pix', dinheiro(digital.pix));
    patch('caixa-v2-val-credito', dinheiro(digital.cartao_credito));
    patch('caixa-v2-val-debito', dinheiro(digital.cartao_debito));
    patch('caixa-v2-val-digital', dinheiro(digital.total_digital));
    patch('caixa-v2-val-vendido', dinheiro(resumo.total_vendido));
    patch('caixa-v2-val-recebido', dinheiro(resumo.total_recebido != null ? resumo.total_recebido : resumo.total_vendido));
    patch('caixa-v2-val-pendente', dinheiro(resumo.total_pendente || 0));
    patch('caixa-v2-val-prazo', dinheiro(resumo.prazo));
    patch('caixa-v2-val-tef', dinheiro(resumo.tef || 0));
    patch('caixa-v2-val-outras', dinheiro(resumo.outras_formas));
    patch('caixa-v2-val-entregas', dinheiro(resumo.entregas_pendentes || 0));
    patch('caixa-v2-val-financeiro', dinheiro(r.totalFinanceiro));
    patch('caixa-v2-val-financeiro-detalhe', dinheiro(r.totalFinanceiro));
    const rec = r.reconciliacao || {};
    patch('caixa-v2-rec-ok', String(rec.vendas_ok || 0));
    patch('caixa-v2-rec-parciais', String(rec.vendas_parciais || 0));
    patch('caixa-v2-rec-pendentes', String(rec.vendas_pendentes || 0));
    patch('caixa-v2-rec-inconsistentes', String(rec.vendas_inconsistentes || 0));
    const tot = resumirInconsistenciasUi(r.inconsistentes);
    patch('caixa-v2-rec-qtd', `${tot.quantidade} venda(s) inconsistente(s)`);
    patch('caixa-v2-rec-diff-total', dinheiro(tot.valorDivergencia));
    patch('caixa-v2-rec-saldo-liquido', formatarDivergencia(tot.saldoLiquido));
    tela._cdsInconsistentes = r.inconsistentes;
    const meta = obterMetaSessao(resumo);
    patch('caixa-v2-tempo-sessao', formatarDuracaoSessao(meta.abertoEm));
    ligarCalculos(r.esperado);
    return true;
  }

  function aplicarTelaAberta(container, resumo, opcoes) {
    const html = montarHtmlTelaAberta(resumo, opcoes);
    const estado = capturarEstadoOperacional();
    const el = container && container.jquery ? container[0] : container;
    const Focus = global.UIFocusManager;
    const Soft = global.UISoftRefresh;

    if (el && Focus && Focus.isEditing(el) && estado.existe) {
      if (typeof atualizarValoresResumo === 'function') {
        atualizarValoresResumo(resumo);
        return true;
      }
    }

    if (el && Soft && typeof Soft.replaceHtml === 'function') {
      Soft.replaceHtml(el, html, { skipIfEditing: false });
    } else if (el) {
      if (Focus && Focus.withPreservedFocus) {
        Focus.withPreservedFocus(el, () => { el.innerHTML = html; }, { restoreValue: true });
      } else {
        el.innerHTML = html;
      }
    } else if (global.$) {
      global.$('#caixa-area').html(html);
    }
    restaurarEstadoOperacional(estado);
    const r = obterResumoV2(resumo || {});
    const tela = typeof document !== 'undefined' ? document.getElementById('caixa-v2-tela') : null;
    if (tela) tela._cdsInconsistentes = r.inconsistentes;
    const esperado = (resumo && resumo.dinheiro && resumo.dinheiro.dinheiro_esperado) || r.esperado;
    ligarCalculos(esperado);
    if (!estado.existe) {
      const campo = typeof document !== 'undefined' ? document.getElementById('valor-fechamento') : null;
      const jaEditando = Focus && Focus.isEditing(document.body);
      if (campo && !jaEditando) {
        campo.focus();
      }
    }
    if (global.electronAPI && global.electronAPI.forcarReflow) {
      global.electronAPI.forcarReflow();
    }
    return true;
  }

  const api = {
    obterResumoV2,
    totalFinanceiroSessao,
    montarHtmlFechamento,
    montarHtmlTelaAberta,
    aplicarTelaAberta,
    atualizarValoresResumo,
    ligarCalculos,
    coletarPayload,
    parseMoeda,
    resumirInconsistenciasUi,
    formatarDivergencia,
    podeFinalizarFechamento,
    abrirInconsistencias,
    avaliarDivergenciaTela,
    usuarioPodeAutorizarDivergencia,
    htmlConfirmacaoDivergencia,
    htmlAutorizacaoAdmin,
    confirmarDivergenciaFechamento,
    solicitarAutorizacaoAdminFechamento,
    prepararFechamento
  };

  global.FechamentoCaixaV2Ui = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
