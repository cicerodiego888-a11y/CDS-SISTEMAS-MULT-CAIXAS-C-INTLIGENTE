/**
 * Central Inteligente de Entradas — Sprint 9 (UX Enterprise).
 * Helpers visuais: skeletons, empty states, gauge, tendências KPI, estados de serviço.
 * Sem regras de negócio — apenas apresentação.
 */
(function initCentralEntradasUx(global) {
    const STORAGE_KEY = 'central_entradas_kpi_snapshot_v1';

    /** RC3.6.H — flags de exposição (somente UI). */
    const _featureFlags = { recuperacaoPortalNacional: false };

    function setFeatureFlagsCentral(flags = {}) {
        if (flags.recuperacaoPortalNacional != null) {
            _featureFlags.recuperacaoPortalNacional = flags.recuperacaoPortalNacional === true;
        }
    }

    function recuperacaoPortalNacionalAtiva() {
        return _featureFlags.recuperacaoPortalNacional === true;
    }

    function documentoTemChaveValidaUx(doc = {}) {
        return String(doc.chave || '').replace(/\D/g, '').length === 44;
    }

    const EMPTY_PRESETS = {
        documentos: {
            icone: 'fa-inbox',
            titulo: 'Nenhum documento ainda',
            descricao: 'Sincronize com a SEFAZ para receber notas fiscais na Central.',
            acaoLabel: 'Sincronizar SEFAZ',
            acaoId: 'centralEmptySync'
        },
        pesquisa: {
            icone: 'fa-search',
            titulo: 'Nenhum resultado encontrado',
            descricao: 'Ajuste os filtros ou limpe a pesquisa para ver mais documentos.',
            acaoLabel: 'Limpar filtros',
            acaoId: 'centralEmptyLimparFiltros'
        },
        pesquisa_filtros: {
            icone: 'fa-filter',
            titulo: 'Nenhum documento encontrado',
            descricao: 'Existem filtros ativos que podem estar ocultando o resultado. O documento pode não aparecer devido aos filtros ativos.',
            acaoLabel: 'Limpar filtros e pesquisar novamente',
            acaoId: 'centralEmptyLimparFiltrosManterBusca'
        },
        alertas: {
            icone: 'fa-bell-slash',
            titulo: 'Sem alertas ativos',
            descricao: 'Não há situações que exijam atenção imediata no momento.'
        },
        pendencias: {
            icone: 'fa-check-circle',
            titulo: 'Sem pendências',
            descricao: 'Todas as notas estão em dia. Nenhuma ação pendente.'
        },
        notificacoes: {
            icone: 'fa-bell',
            titulo: 'Sem notificações',
            descricao: 'Você está em dia. Novos avisos aparecerão aqui.'
        },
        historico: {
            icone: 'fa-history',
            titulo: 'Sem eventos no histórico',
            descricao: 'As transições de status do documento serão registradas aqui.'
        },
        selecao: {
            icone: 'fa-hand-pointer',
            titulo: 'Selecione um documento',
            descricao: 'Clique em uma linha da grade para ver detalhes, itens e histórico.'
        }
    };

    function escapeUx(texto) {
        if (texto === null || texto === undefined) return '';
        return String(texto)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderEmptyStateCentral(tipo, overrides = {}) {
        const preset = { ...EMPTY_PRESETS[tipo], ...overrides };
        if (!preset.titulo) return '';

        const acao = preset.acaoLabel && preset.acaoId
            ? `<button type="button" class="btn btn-sm btn-outline-primary mt-2" id="${escapeUx(preset.acaoId)}">${escapeUx(preset.acaoLabel)}</button>`
            : '';

        return `
            <div class="central-ux-empty central-entradas-anim-in" role="status" aria-live="polite">
                <div class="central-ux-empty-icone" aria-hidden="true">
                    <i class="fas ${escapeUx(preset.icone || 'fa-inbox')}"></i>
                </div>
                <div class="central-ux-empty-titulo">${escapeUx(preset.titulo)}</div>
                <div class="central-ux-empty-descricao">${escapeUx(preset.descricao || '')}</div>
                ${acao}
            </div>`;
    }

    function renderSkeletonBlock(linhas = 1, classe = '') {
        const rows = Array.from({ length: linhas }, () => '<div class="central-ux-skeleton-line"></div>').join('');
        return `<div class="central-ux-skeleton ${classe}" aria-hidden="true">${rows}</div>`;
    }

    function renderSkeletonKpisCentral(qtd = 6) {
        return Array.from({ length: qtd }, () => `
            <div class="col-6 col-md-4 col-xl-2">
                <div class="central-entradas-kpi central-ux-skeleton-kpi" aria-busy="true" aria-label="Carregando indicadores">
                    <div class="central-ux-skeleton central-ux-skeleton-circle"></div>
                    <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--lg"></div>
                    <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--sm"></div>
                </div>
            </div>
        `).join('');
    }

    function renderSkeletonIndicadoresCentral() {
        return `
            <div class="central-entradas-indicadores central-ux-skeleton-indicadores" aria-busy="true" aria-label="Carregando monitoramento">
                ${Array.from({ length: 3 }, () => `
                    <div class="central-entradas-indicador">
                        <div class="central-ux-skeleton central-ux-skeleton-circle central-ux-skeleton-circle--sm"></div>
                        <div class="flex-grow-1">
                            <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--xs"></div>
                            <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--md mt-1"></div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    function renderSkeletonGridCentral(linhas = 6) {
        return Array.from({ length: linhas }, () => `
            <tr class="central-ux-skeleton-row" aria-hidden="true">
                <td><div class="central-ux-skeleton central-ux-skeleton-circle central-ux-skeleton-circle--xs"></div></td>
                <td><div class="central-ux-skeleton central-ux-skeleton-line"></div><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--xs mt-1"></div></td>
                <td><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--sm"></div></td>
                <td><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--xs"></div></td>
                <td><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--sm"></div></td>
                <td><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--xs"></div></td>
                <td><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--md"></div></td>
            </tr>
        `).join('');
    }

    function renderSkeletonPainelCentral() {
        return `
            <div class="card h-100 central-entradas-painel-card" aria-busy="true" aria-label="Carregando detalhe">
                <div class="card-header"><div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--md"></div></div>
                <div class="card-body">
                    <div class="d-flex justify-content-center mb-3">
                        <div class="central-ux-skeleton central-ux-skeleton-gauge"></div>
                    </div>
                    ${renderSkeletonBlock(4)}
                    <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--lg mt-3"></div>
                    <div class="central-ux-skeleton central-ux-skeleton-line mt-2"></div>
                </div>
            </div>`;
    }

    function renderSkeletonTimelineCentral() {
        return `
            <div class="central-entradas-timeline-enterprise" aria-busy="true" aria-label="Carregando histórico">
                ${Array.from({ length: 4 }, () => `
                    <div class="central-entradas-timeline-enterprise-item central-ux-skeleton-timeline-item">
                        <div class="central-ux-skeleton central-ux-skeleton-circle"></div>
                        <div class="flex-grow-1">
                            <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--md"></div>
                            <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--sm mt-1"></div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    function renderSkeletonPainelBlocoCentral() {
        return `
            <div class="py-2" aria-busy="true">
                ${renderSkeletonBlock(3)}
            </div>`;
    }

    function corScoreCentral(score) {
        const n = Number(score);
        if (Number.isNaN(n)) return '#94a3b8';
        if (n >= 80) return '#198754';
        if (n >= 60) return '#0d6efd';
        if (n >= 40) return '#fd7e14';
        return '#dc3545';
    }

    function descricaoScoreCentral(score) {
        const n = Number(score);
        if (Number.isNaN(n)) return 'Score indisponível';
        if (n >= 80) return 'Excelente — documento em ótima condição';
        if (n >= 60) return 'Bom — poucas pendências';
        if (n >= 40) return 'Atenção — revisar antes de lançar';
        return 'Crítico — ação necessária';
    }

    function renderGaugeScoreCentral(score, cor, opcoes = {}) {
        const n = score != null ? Math.max(0, Math.min(100, Number(score))) : null;
        const corFinal = cor || corScoreCentral(n);
        const tamanho = opcoes.tamanho || 96;
        const raio = (tamanho - 10) / 2;
        const circ = 2 * Math.PI * raio;
        const offset = n != null ? circ - (n / 100) * circ : circ;
        const descricao = opcoes.descricao || descricaoScoreCentral(n);
        const valorTexto = n != null ? `${Math.round(n)}%` : '—';

        return `
            <div class="central-ux-gauge central-entradas-anim-in"
                 style="--gauge-cor:${escapeUx(corFinal)}; --gauge-size:${tamanho}px"
                 role="img"
                 aria-label="Score geral ${valorTexto}. ${escapeUx(descricao)}"
                 title="${escapeUx(descricao)}">
                <svg class="central-ux-gauge-svg" viewBox="0 0 ${tamanho} ${tamanho}" aria-hidden="true">
                    <circle class="central-ux-gauge-track" cx="${tamanho / 2}" cy="${tamanho / 2}" r="${raio}"></circle>
                    <circle class="central-ux-gauge-fill" cx="${tamanho / 2}" cy="${tamanho / 2}" r="${raio}"
                        stroke-dasharray="${circ}" stroke-dashoffset="${offset}"></circle>
                </svg>
                <div class="central-ux-gauge-valor">${escapeUx(valorTexto)}</div>
                <div class="central-ux-gauge-label">Score</div>
            </div>
            ${opcoes.mostrarDescricao !== false
                ? `<div class="central-ux-gauge-descricao text-center small text-muted mt-1">${escapeUx(descricao)}</div>`
                : ''}`;
    }

    function calcularTendenciaKpiCentral(atual, anterior) {
        const a = Number(atual);
        const p = Number(anterior);
        if (Number.isNaN(a) || Number.isNaN(p)) {
            return { simbolo: '=', direcao: 'neutro', texto: 'Sem histórico', classe: 'central-ux-trend--neutro' };
        }
        const diff = a - p;
        if (diff === 0) {
            return { simbolo: '=', direcao: 'estavel', texto: 'Estável vs período anterior', classe: 'central-ux-trend--estavel' };
        }
        if (diff > 0) {
            return { simbolo: '▲', direcao: 'alta', texto: `+${diff} vs período anterior`, classe: 'central-ux-trend--alta' };
        }
        return { simbolo: '▼', direcao: 'baixa', texto: `${diff} vs período anterior`, classe: 'central-ux-trend--baixa' };
    }

    function renderTendenciaKpiCentral(atual, anterior, invertido = false) {
        let trend = calcularTendenciaKpiCentral(atual, anterior);
        if (invertido && trend.direcao === 'alta') trend = { ...trend, classe: 'central-ux-trend--baixa' };
        if (invertido && trend.direcao === 'baixa') trend = { ...trend, classe: 'central-ux-trend--alta' };

        return `
            <div class="central-ux-trend ${trend.classe}" title="${escapeUx(trend.texto)}" aria-label="${escapeUx(trend.texto)}">
                <span class="central-ux-trend-simbolo" aria-hidden="true">${trend.simbolo}</span>
                <span class="central-ux-trend-texto">${escapeUx(trend.texto)}</span>
            </div>`;
    }

    function obterSnapshotKpisCentral() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function salvarSnapshotKpisCentral(dashboard, operacional) {
        try {
            const snapshot = {
                savedAt: new Date().toISOString(),
                contadores: dashboard?.contadores || {},
                operacional: operacional || {}
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch { /* ignore quota */ }
    }

    /**
     * RC3.7.5.3 — cooldown 656 pós AUTO_SYNC_NSU (somente apresentação).
     * Ativo quando há espera SEFAZ (gate ou NSU) e evidência de recuperação NSU.
     */
    function nsuNumericoCentral(valor) {
        const digits = String(valor == null ? '' : valor).replace(/\D/g, '');
        if (!digits) return 0;
        return Number(digits.replace(/^0+(?=\d)/, '')) || 0;
    }

    function formatarHoraCurtaCentral(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatarMinutosRestantesCentral(restanteMs) {
        const ms = Math.max(0, Number(restanteMs) || 0);
        if (ms <= 0) return 'agora';
        const minutos = Math.max(1, Math.ceil(ms / 60000));
        return minutos === 1 ? '1 minuto' : `${minutos} minutos`;
    }

    function resolverCooldownSefaz656Ux(state = {}, agora = Date.now()) {
        const sefaz = state.sefazOperacional || {};
        const nsu = state.sincronizacaoNsu || state.sincronizacao || {};
        const ultimo = (state.servicoStatus || {}).ultimoResultado || {};
        const bloqueio = sefaz.bloqueio656 || null;
        const gateBloqueado = Boolean(
            bloqueio?.ativo
            || sefaz.estadoOperacional?.codigo === 'BLOCKED'
            || sefaz.consultaBloqueada
        );
        const cStat = String(
            sefaz.ultimoCStat
            || bloqueio?.cStat
            || nsu.ultimoCstat
            || ultimo.cStat
            || ''
        );
        const is656 = cStat === '656'
            || /656|Consumo Indevido|CONSUMO_INDEVIDO/i.test(String(ultimo.mensagem || ultimo.codigoErro || ''));

        const candidatos = [
            bloqueio?.bloqueadoAte,
            sefaz.proximaConsulta,
            nsu.cooldownAte
        ].filter(Boolean);
        let proximaTentativa = null;
        let restanteMs = 0;
        for (let i = 0; i < candidatos.length; i += 1) {
            const t = new Date(candidatos[i]).getTime();
            if (Number.isNaN(t)) continue;
            const rest = t - agora;
            if (rest > restanteMs) {
                restanteMs = rest;
                proximaTentativa = candidatos[i];
            }
        }
        // tempoRestanteMs do gate só reforça se ainda houver alvo futuro
        if (
            proximaTentativa
            && restanteMs > 0
            && sefaz.tempoRestanteMs != null
            && Number(sefaz.tempoRestanteMs) > restanteMs
        ) {
            restanteMs = Number(sefaz.tempoRestanteMs);
        }

        const cooldownNsuAtivo = Boolean(
            nsu.cooldownAte && new Date(nsu.cooldownAte).getTime() > agora
        );
        const cooldownAtivo = (gateBloqueado || cooldownNsuAtivo) && restanteMs > 0;
        const nsuLocal = nsuNumericoCentral(nsu.ultNsu);
        const autoSyncNsu = Boolean(
            nsuLocal > 0
            && (is656 || String(nsu.ultimoCstat || '') === '656')
            && (cooldownAtivo || cooldownNsuAtivo || gateBloqueado)
        );

        const ativo = Boolean(cooldownAtivo && (autoSyncNsu || (is656 && nsuLocal > 0)));

        return {
            ativo,
            autoSyncNsu,
            cStat: cStat || (ativo ? '656' : null),
            proximaTentativa,
            restanteMs: ativo ? restanteMs : 0,
            proximaLabel: ativo ? formatarHoraCurtaCentral(proximaTentativa) : '—',
            restanteLabel: ativo ? formatarMinutosRestantesCentral(restanteMs) : '—',
            indicador: '🟡',
            estado: 'AGUARDANDO_COOLDOWN_SEFAZ',
            label: 'AGUARDANDO COOLDOWN DA SEFAZ',
            descricao: 'Aguardando liberação da SEFAZ',
            tooltipSync: 'A SEFAZ bloqueia novas consultas durante o período de espera.'
        };
    }

    function resolverEstadoServicoCentral(state) {
        const s = state.servicoStatus || {};
        const executando = s.executando || state.sincronizando;
        const syncAuto = s.syncAutomaticaHabilitada || s.servicoAtivo;
        const ultimo = s.ultimoResultado || {};
        const erroRecente = ultimo.sucesso === false && !executando;
        const online = typeof navigator === 'undefined' ? true : navigator.onLine;
        const cooldown = resolverCooldownSefaz656Ux(state);

        if (!online) {
            return {
                codigo: 'offline',
                label: 'Offline',
                descricao: 'Sem conexão com a internet',
                icone: 'fa-wifi',
                classe: 'central-ux-servico--offline'
            };
        }
        if (executando) {
            return {
                codigo: 'sincronizando',
                label: 'Sincronizando',
                descricao: 'Buscando documentos na SEFAZ',
                icone: 'fa-sync-alt fa-spin',
                classe: 'central-ux-servico--sincronizando'
            };
        }
        // RC3.7.5.3 — 656 + AUTO_SYNC_NSU: não exibir como ERRO
        if (cooldown.ativo) {
            return {
                codigo: 'cooldown_656',
                label: cooldown.label,
                descricao: `${cooldown.indicador} ${cooldown.descricao} · Próxima tentativa: ${cooldown.proximaLabel} · Tempo restante: ${cooldown.restanteLabel}`,
                icone: 'fa-hourglass-half',
                classe: 'central-ux-servico--cooldown',
                cooldown
            };
        }
        if (erroRecente) {
            return {
                codigo: 'erro',
                label: 'Erro na última execução',
                descricao: ultimo.mensagem || 'Verifique o log operacional',
                icone: 'fa-exclamation-triangle',
                classe: 'central-ux-servico--erro'
            };
        }
        if (syncAuto) {
            return {
                codigo: 'monitorando',
                label: 'Monitorando',
                descricao: 'Serviço automático ativo',
                icone: 'fa-satellite-dish',
                classe: 'central-ux-servico--monitorando'
            };
        }
        return {
            codigo: 'aguardando',
            label: 'Aguardando',
            descricao: 'Sincronização manual — serviço em repouso',
            icone: 'fa-pause-circle',
            classe: 'central-ux-servico--aguardando'
        };
    }

    function formatarDataHoraSeparadoCentral(data) {
        if (!data) return { data: '—', hora: '—' };
        const texto = String(data).trim();
        // Data pura (YYYY-MM-DD): evita shift de fuso ao usar Date UTC.
        const soData = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (soData) {
            return { data: `${soData[3]}/${soData[2]}/${soData[1]}`, hora: '' };
        }
        const d = new Date(texto);
        if (Number.isNaN(d.getTime())) return { data: texto, hora: '' };
        return {
            data: d.toLocaleDateString('pt-BR'),
            hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        };
    }

    /**
     * RC3.4.9A — data de emissão reduzida (dd/MM/aa). Nunca inclui horário.
     * @param {string|null|undefined} data
     * @returns {string}
     */
    function formatarDataEmissaoCurtaCentral(data) {
        if (!data) return '—';
        const texto = String(data).trim();
        const soData = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (soData) {
            return `${soData[3]}/${soData[2]}/${soData[1].slice(-2)}`;
        }
        const d = new Date(texto);
        if (Number.isNaN(d.getTime())) return '—';
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = String(d.getFullYear()).slice(-2);
        return `${dia}/${mes}/${ano}`;
    }

    /**
     * RC3.4.9A — situação curta para linha da Saúde (NF • Emissão • Situação).
     * @param {Object} alerta
     * @returns {string}
     */
    function resolverSituacaoSaudeCurtaCentral(alerta = {}) {
        const status = alerta.status || '';
        const mapa = {
            XML_INDISPONIVEL: 'XML indisponível na SEFAZ',
            ERRO: 'Atenção',
            EM_COMPRA: 'Em Compra',
            AGUARDANDO_REVISAO: 'Em revisão',
            EM_PROCESSAMENTO: 'Processando',
            AGUARDANDO_XML_COMPLETO: 'Aguardando XML',
            SINCRONIZADA: 'Recebido',
            RECEBIDA: 'Recebido',
            REVISADA: 'Pronto para importar',
            PRONTA_PARA_COMPRA: 'Pronto para importar',
            GRAVADA: 'Importado',
            DUPLICADA: 'Duplicada',
            DESCARTADA: 'Encerrado',
            XML_IMPORTADO_MANUALMENTE: 'XML importado'
        };
        if (mapa[status]) return mapa[status];
        const diag = String(alerta.diagnostico || '').trim();
        if (/XML indisponível/i.test(diag)) return 'XML indisponível na SEFAZ';
        if (/parado na etapa EM_COMPRA/i.test(diag)) return 'Em Compra';
        if (/parado na etapa/i.test(diag)) {
            const m = diag.match(/etapa\s+([A-Z_]+)/i);
            if (m?.[1] && mapa[m[1]]) return mapa[m[1]];
        }
        return alerta.nivelLabel || diag || 'Atenção';
    }

    /**
     * RC3.4.9A — monta linha compacta: NF • Emissão • Situação
     * @param {Object} alerta
     * @returns {string}
     */
    function montarLinhaSaudeCompactaCentral(alerta = {}) {
        const nf = alerta.numero != null && String(alerta.numero).trim() !== ''
            ? String(alerta.numero).trim()
            : '—';
        const emissao = formatarDataEmissaoCurtaCentral(alerta.dataEmissao || alerta.data_emissao);
        const situacao = resolverSituacaoSaudeCurtaCentral(alerta);
        return `${nf} • ${emissao} • ${situacao}`;
    }

    function inferirOrigemTimelineCentral(item) {
        const detalhe = String(item.detalhe || '').toLowerCase();
        if (detalhe.includes('dfe') || detalhe.includes('sefaz')) return 'SEFAZ / DF-e';
        if (detalhe.includes('compra')) return 'Compras';
        if (detalhe.includes('miip') || detalhe.includes('revis')) return 'MIIP';
        if (detalhe.includes('upload') || detalhe.includes('manual')) return 'Upload manual';
        if (detalhe.includes('chave')) return 'Consulta por chave';
        if (item.usuarioId) return 'Usuário';
        return 'Pipeline automático';
    }

    function avatarFornecedorCentral(nome) {
        const texto = String(nome || '?').trim();
        const iniciais = texto.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
        let hash = 0;
        for (let i = 0; i < texto.length; i += 1) hash = texto.charCodeAt(i) + ((hash << 5) - hash);
        const cores = ['#0d6efd', '#6610f2', '#198754', '#fd7e14', '#20c997', '#6f42c1', '#0dcaf0'];
        const cor = cores[Math.abs(hash) % cores.length];
        return { iniciais, cor };
    }

    function badgeStatusUx1(status, label) {
        // RC4.0.0 / RC3.7.1 — linguagem operacional
        const mapa = {
            NOVA: { classe: 'central-ux1-badge--azul', texto: 'Nova' },
            RESUMO_RECEBIDO: { classe: 'central-ux1-badge--azul', texto: 'Resumo recebido' },
            XML_COMPLETO: { classe: 'central-ux1-badge--azul', texto: 'XML completo' },
            EM_REVISAO: { classe: 'central-ux1-badge--amarelo', texto: 'Em revisão' },
            PRONTA_IMPORTACAO: { classe: 'central-ux1-badge--verde', texto: 'Aguardando finalização' },
            EM_IMPORTACAO: { classe: 'central-ux1-badge--azul', texto: 'Em importação' },
            IMPORTADA: { classe: 'central-ux1-badge--cinza', texto: 'Importada' },
            FINALIZADA: { classe: 'central-ux1-badge--cinza', texto: 'Finalizada' },
            CANCELADA: { classe: 'central-ux1-badge--vermelho', texto: 'Cancelada' },
            DENEGADA: { classe: 'central-ux1-badge--vermelho', texto: 'Denegada' },
            INUTILIZADA: { classe: 'central-ux1-badge--cinza', texto: 'Inutilizada' },
            ERRO: { classe: 'central-ux1-badge--vermelho', texto: 'Erro' },
            XML_INDISPONIVEL: { classe: 'central-ux1-badge--vermelho', texto: 'XML indisponível' },
            RECEBIDA: { classe: 'central-ux1-badge--azul', texto: 'Recebido' },
            SINCRONIZADA: { classe: 'central-ux1-badge--azul', texto: 'Recebido' },
            AGUARDANDO_XML_COMPLETO: { classe: 'central-ux1-badge--azul', texto: 'Aguardando XML' },
            EM_PROCESSAMENTO: { classe: 'central-ux1-badge--azul', texto: 'Processando' },
            AGUARDANDO_REVISAO: { classe: 'central-ux1-badge--amarelo', texto: 'Em revisão' },
            REVISADA: { classe: 'central-ux1-badge--verde', texto: 'Aguardando finalização' },
            PRONTA_PARA_COMPRA: { classe: 'central-ux1-badge--verde', texto: 'Aguardando finalização' },
            EM_COMPRA: { classe: 'central-ux1-badge--azul', texto: 'Em importação' },
            GRAVADA: { classe: 'central-ux1-badge--cinza', texto: 'Importada' },
            DUPLICADA: { classe: 'central-ux1-badge--cinza', texto: 'Importada' },
            DESCARTADA: { classe: 'central-ux1-badge--cinza', texto: 'Finalizada' },
            XML_IMPORTADO_MANUALMENTE: { classe: 'central-ux1-badge--azul', texto: 'XML completo' }
        };
        const meta = mapa[status] || { classe: 'central-ux1-badge--cinza', texto: label || status || '—' };
        return `<span class="central-ux1-badge ${meta.classe}" title="${escapeUx(meta.texto)}">${escapeUx(meta.texto)}</span>`;
    }

    /**
     * RC4.0.0 / RC3.7.1 — próxima ação operacional (lista / painel).
     */
    function resolverProximaAcaoOperacional(doc = {}) {
        const status = doc.status || '';
        if (status === 'EM_REVISAO' || status === 'AGUARDANDO_REVISAO') {
            return { emoji: '🟡', label: 'Revisar Produtos', tom: 'revisao', acao: 'revisar' };
        }
        if (status === 'EM_IMPORTACAO' || status === 'EM_COMPRA') {
            return { emoji: '🔵', label: 'Retomar Importação', tom: 'processando', acao: 'retomar' };
        }
        if (status === 'PRONTA_IMPORTACAO' || status === 'PRONTA_PARA_COMPRA' || status === 'REVISADA') {
            return { emoji: '🟢', label: 'Finalizar Entrada', tom: 'pronto', acao: 'finalizar' };
        }
        if (status === 'RESUMO_RECEBIDO' || status === 'AGUARDANDO_XML_COMPLETO') {
            return { emoji: '🔵', label: 'Aguardando XML', tom: 'processando', acao: 'aguardar' };
        }
        if (status === 'XML_INDISPONIVEL' || status === 'ERRO') {
            if (recuperacaoPortalNacionalAtiva()) {
                return { emoji: '☁️', label: 'Portal Nacional', tom: 'atencao', acao: 'portal-nfe' };
            }
            if (status === 'XML_INDISPONIVEL' && documentoTemChaveValidaUx(doc)) {
                return { emoji: '📋', label: 'Copiar Chave', tom: 'atencao', acao: 'copiar-chave' };
            }
            if (status === 'ERRO') {
                return { emoji: '🔴', label: 'Ver Diagnóstico', tom: 'atencao', acao: 'diagnostico' };
            }
            return { emoji: '🔴', label: 'Atenção', tom: 'atencao', acao: null };
        }
        if (status === 'CANCELADA' || status === 'DENEGADA' || status === 'INUTILIZADA') {
            return { emoji: '⚫', label: status === 'CANCELADA' ? 'Cancelada' : status, tom: 'encerrado', acao: null };
        }
        if (status === 'IMPORTADA' || status === 'GRAVADA' || status === 'FINALIZADA' || status === 'DESCARTADA' || status === 'DUPLICADA') {
            return { emoji: '⚫', label: 'Importada', tom: 'encerrado', acao: null };
        }
        if ((status === 'XML_COMPLETO' || status === 'SINCRONIZADA') && doc.parseDisponivel) {
            return { emoji: '🔵', label: 'Processar', tom: 'processando', acao: 'processar' };
        }
        return { emoji: '🔵', label: 'Acompanhar', tom: 'processando', acao: null };
    }

    function labelStatusOperacionalCentral(status) {
        const mapa = {
            NOVA: 'Nova',
            RESUMO_RECEBIDO: 'Resumo recebido',
            XML_COMPLETO: 'XML completo',
            EM_REVISAO: 'Em revisão',
            PRONTA_IMPORTACAO: 'Aguardando finalização',
            EM_IMPORTACAO: 'Em importação',
            IMPORTADA: 'Importada',
            FINALIZADA: 'Finalizada',
            CANCELADA: 'Cancelada',
            DENEGADA: 'Denegada',
            INUTILIZADA: 'Inutilizada',
            ERRO: 'Erro',
            XML_INDISPONIVEL: 'XML indisponível',
            RECEBIDA: 'Recebido',
            SINCRONIZADA: 'Recebido',
            AGUARDANDO_XML_COMPLETO: 'Aguardando XML',
            EM_PROCESSAMENTO: 'Processando',
            AGUARDANDO_REVISAO: 'Em revisão',
            REVISADA: 'Aguardando finalização',
            PRONTA_PARA_COMPRA: 'Aguardando finalização',
            EM_COMPRA: 'Em importação',
            GRAVADA: 'Importada',
            DESCARTADA: 'Finalizada',
            DUPLICADA: 'Importada'
        };
        return mapa[status] || status || '—';
    }

    function renderPipelineTimelineUx1(doc, historico) {
        const status = doc?.status || 'RECEBIDA';
        const ordem = ['RECEBIDA', 'SINCRONIZADA', 'EM_PROCESSAMENTO', 'AGUARDANDO_REVISAO', 'REVISADA', 'PRONTA_PARA_COMPRA', 'EM_COMPRA', 'GRAVADA'];
        const idxAtual = Math.max(0, ordem.indexOf(status));
        const etapas = [
            { label: 'NF Recebida', icone: 'fa-inbox', minIdx: 0 },
            { label: 'Download XML', icone: 'fa-cloud-download-alt', minIdx: 1 },
            { label: 'Parser', icone: 'fa-file-code', minIdx: 2 },
            { label: 'MIIP', icone: 'fa-brain', minIdx: 2 },
            { label: 'Central Revisão', icone: 'fa-user-check', minIdx: 3 },
            { label: 'Compra', icone: 'fa-shopping-cart', minIdx: 5 },
            { label: 'Finalizado', icone: 'fa-check-circle', minIdx: 7 }
        ];

        const historicoPorStatus = {};
        (historico || []).forEach((h) => {
            if (h.statusNovo && !historicoPorStatus[h.statusNovo]) {
                historicoPorStatus[h.statusNovo] = h.createdAt;
            }
        });

        return `
            <div class="central-ux1-pipeline" role="list" aria-label="Pipeline do documento">
                ${etapas.map((etapa, i) => {
                    const concluida = idxAtual >= etapa.minIdx || status === 'GRAVADA';
                    const ativa = idxAtual === etapa.minIdx && status !== 'GRAVADA' && status !== 'ERRO';
                    const erro = status === 'ERRO' && i === etapas.length - 1;
                    const hora = historicoPorStatus[ordem[etapa.minIdx]]
                        ? formatarDataHoraSeparadoCentral(historicoPorStatus[ordem[etapa.minIdx]]).hora
                        : '—';
                    const classe = erro ? 'erro' : (concluida ? 'ok' : (ativa ? 'ativo' : 'pendente'));
                    return `
                        <div class="central-ux1-pipeline-item central-ux1-pipeline-item--${classe}" role="listitem">
                            ${i > 0 ? '<div class="central-ux1-pipeline-seta" aria-hidden="true">↓</div>' : ''}
                            <div class="central-ux1-pipeline-card">
                                <span class="central-ux1-pipeline-icone"><i class="fas ${etapa.icone}"></i></span>
                                <div class="central-ux1-pipeline-info">
                                    <strong>${escapeUx(etapa.label)}</strong>
                                    <small>${concluida ? 'Concluído' : (ativa ? 'Em andamento' : 'Aguardando')} · ${escapeUx(hora)}</small>
                                </div>
                            </div>
                        </div>`;
                }).join('')}
            </div>`;
    }

    function renderSkeletonListaDocumentosCentral(qtd = 6) {
        return Array.from({ length: qtd }, () => `
            <div class="central-ux1-doc-card central-ux1-doc-card--skeleton" aria-hidden="true">
                <div class="central-ux-skeleton central-ux-skeleton-circle"></div>
                <div class="flex-grow-1">
                    <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--md"></div>
                    <div class="central-ux-skeleton central-ux-skeleton-line central-ux-skeleton-line--sm mt-1"></div>
                </div>
            </div>
        `).join('');
    }

    function extrairDadosExecutivoCentral(doc, parse, miip, historico) {
        const itens = parse?.parse?.itens || parse?.itens || [];
        const r = miip?.miipResumo?.resumo || miip?.resumo;
        const precisaoMiip = r?.totalItens > 0
            ? Math.round(((r.identificadosAutomaticamente || 0) / r.totalItens) * 100)
            : null;

        let volumeUnidades = 0;
        itens.forEach((item) => { volumeUnidades += Number(item.quantidade || 0); });

        let tempoProcessamento = null;
        if (historico?.length) {
            const inicio = historico.find((h) => h.statusNovo === 'EM_PROCESSAMENTO');
            const fim = [...historico].reverse().find((h) =>
                ['PRONTA_PARA_COMPRA', 'AGUARDANDO_REVISAO', 'GRAVADA', 'ERRO'].includes(h.statusNovo)
            );
            if (inicio?.createdAt && fim?.createdAt) {
                const ms = new Date(fim.createdAt) - new Date(inicio.createdAt);
                if (ms > 0) tempoProcessamento = `${Math.max(1, Math.round(ms / 60000))} min`;
            }
        }

        const valorFrete = parse?.parse?.valor_frete ?? parse?.valor_frete ?? parse?.parse?.valorFrete ?? parse?.valorFrete;
        const transportadora = valorFrete > 0 ? `Frete ${Number(valorFrete).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : null;

        return {
            fornecedor: doc?.fornecedor || parse?.parse?.fornecedor || '—',
            cnpjFornecedor: doc?.cnpjFornecedor || parse?.parse?.fornecedor_cnpj || '',
            transportadora: transportadora || 'Não informado na NF-e',
            volumes: itens.length ? `${itens.length} item(ns) · ${volumeUnidades.toLocaleString('pt-BR')} un.` : '—',
            peso: '—',
            pagamento: parse?.parse?.observacao || parse?.observacao || 'A definir em Compras',
            valorTotal: doc?.valorTotal ?? parse?.parse?.valor_total_nota ?? parse?.valor_total_nota,
            qtdItens: itens.length || '—',
            precisaoMiip: precisaoMiip != null ? `${precisaoMiip}%` : '—',
            tempoProcessamento: tempoProcessamento || '—'
        };
    }

    /**
     * RC7.5 — Helpers operacionais (somente apresentação).
     */

    function formatarDuracaoHumanaCentral(ms, agora = Date.now()) {
        const n = Number(ms);
        if (n == null || Number.isNaN(n)) return '—';
        const seg = Math.max(0, Math.floor(n / 1000));
        if (seg < 60) return `${seg}s`;
        if (seg < 3600) {
            const m = Math.floor(seg / 60);
            return m === 1 ? '1 minuto' : `${m} minutos`;
        }
        if (seg < 86400) {
            const h = Math.floor(seg / 3600);
            return h === 1 ? '1 hora' : `${h} horas`;
        }
        const d = Math.floor(seg / 86400);
        return d === 1 ? '1 dia' : `${d} dias`;
    }

    function formatarCountdownCentral(alvoIso, agora = Date.now()) {
        if (!alvoIso) return { label: '—', faltam: '—', restanteMs: 0, esgotado: true };
        const alvo = new Date(alvoIso).getTime();
        if (Number.isNaN(alvo)) return { label: '—', faltam: '—', restanteMs: 0, esgotado: true };
        const restante = Math.max(0, alvo - agora);
        const totalSeg = Math.floor(restante / 1000);
        const h = Math.floor(totalSeg / 3600);
        const m = Math.floor((totalSeg % 3600) / 60);
        const s = totalSeg % 60;
        let faltam = '';
        if (h > 0) faltam = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
        else faltam = `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
        const hora = formatarDataHoraSeparadoCentral(alvoIso);
        return {
            label: hora.hora !== '—' ? hora.hora : formatarDataHoraSeparadoCentral(alvoIso).data,
            dataHora: `${hora.data} ${hora.hora}`.trim(),
            faltam: restante <= 0 ? 'agora' : faltam,
            restanteMs: restante,
            esgotado: restante <= 0
        };
    }

    function mensagemAmigavelCentral(chave, fallback) {
        const mapa = {
            AGUARDANDO_XML_COMPLETO: 'A SEFAZ ainda não disponibilizou o XML completo. A recuperação automática ocorrerá no horário programado.',
            ERRO: 'Consulta temporariamente indisponível.',
            CONSUMO_INDEVIDO: 'A SEFAZ solicitou um intervalo antes da próxima consulta.',
            '656': 'A SEFAZ solicitou um intervalo antes da próxima consulta.',
            MANIFESTACAO_ACEITA: 'Manifestação registrada com sucesso. O sistema continuará consultando automaticamente a SEFAZ.',
            '137': '137 — Nenhum documento localizado',
            '138': '138 — Documento localizado',
            '593': '593 — Configuração de certificado/CNPJ inválida'
        };
        return mapa[chave] || fallback || chave || '—';
    }

    /** RC3.4.5 — status reais (linguagem operacional). */
    function resolverStatusRealCentral(doc, wait = {}) {
        const w = wait || {};
        const status = doc?.status || '';
        if (status === 'AGUARDANDO_XML_COMPLETO') {
            if (w.estadoMirx === 'CONSULTANDO_XML') return 'Recuperando XML automaticamente';
            return 'Recuperação automática do XML agendada';
        }
        if (status === 'SINCRONIZADA' && doc?.tipoDocumento === 'RES_NFE') return 'Aguardando manifestação';
        if (status === 'EM_PROCESSAMENTO') return 'Identificando produtos';
        if (status === 'SINCRONIZADA' && ['PROC_NFE', 'NFE'].includes(doc?.tipoDocumento)) {
            return 'Processando XML';
        }
        if (status === 'AGUARDANDO_REVISAO') return 'Aguardando revisão MIIP';
        if (status === 'EM_COMPRA') return 'Importando compra';
        if (status === 'GRAVADA') return 'Finalizado';
        if (status === 'RECEBIDA') return 'Recebendo documento';
        if (status === 'PRONTA_PARA_COMPRA') return 'Pronto para importar compra';
        if (status === 'REVISADA') return 'Revisão MIIP concluída';
        return mensagemAmigavelCentral(status, status) || status || '—';
    }

    /** RC3.4.6.1 — documento encerrado (sem próximas tentativas). */
    function documentoEncerradoCentral(doc) {
        const status = doc?.status || '';
        return status === 'GRAVADA' || status === 'DESCARTADA' || status === 'DUPLICADA';
    }

    /** RC3.4.5 — explicação com próxima tentativa DD/MM/AAAA HH:MM. */
    function explicarStatusCentral(doc, wait = {}) {
        const w = wait || {};
        const status = doc?.status || '';

        if (documentoEncerradoCentral(doc)) {
            return 'Documento encerrado. Não existem próximas tentativas.';
        }

        const proxima = w.proximaTentativa || w.bloqueio656?.bloqueadoAte || null;
        let proximaLabel = null;
        if (proxima) {
            const d = new Date(proxima);
            if (!Number.isNaN(d.getTime())) {
                const pad = (n) => String(n).padStart(2, '0');
                proximaLabel = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            }
        }

        if (status === 'AGUARDANDO_XML_COMPLETO') {
            if (w.estadoMirx === 'CONSULTANDO_XML') {
                return 'O sistema está consultando a SEFAZ para recuperar o XML completo.';
            }
            return proximaLabel
                ? `Recuperação automática do XML agendada. Próxima tentativa: ${proximaLabel}.`
                : 'Recuperação automática do XML agendada. Nova tentativa no horário programado.';
        }
        if (status === 'EM_PROCESSAMENTO') {
            return 'O XML está sendo lido: itens, valores e tributos estão sendo extraídos.';
        }
        if (status === 'AGUARDANDO_REVISAO') {
            return 'O MIIP identificou os produtos. Confirme ou cadastre os itens pendentes na Central de Revisão.';
        }
        if (status === 'EM_COMPRA') {
            return 'A compra está sendo importada. Estoque e financeiro serão atualizados na conclusão.';
        }
        if (status === 'SINCRONIZADA' && doc?.tipoDocumento === 'RES_NFE') {
            return 'Resumo da NF-e recebido. Aguardando manifestação e disponibilização do XML completo.';
        }
        return resolverStatusRealCentral(doc, w);
    }

    function resolverDataDocumentoCentral(doc) {
        const emissao = doc?.dataEmissao || doc?.data_emissao || null;
        if (emissao) {
            return { valor: emissao, fonte: 'dataEmissao', ...formatarDataHoraSeparadoCentral(emissao) };
        }
        const dh = doc?.dhRecbto || doc?.dh_recbto || doc?.dataRecebimento || null;
        if (dh) {
            return { valor: dh, fonte: 'dhRecbto', ...formatarDataHoraSeparadoCentral(dh) };
        }
        return { valor: null, fonte: null, data: '—', hora: '' };
    }

    function resolverChipEtapaCentral(doc, wait) {
        const status = doc?.status || '';
        if (status === 'ERRO') {
            return { codigo: 'ERRO', label: 'Erro', indicador: '🔴', cor: '#dc3545' };
        }
        if (status === 'GRAVADA') {
            return { codigo: 'FINALIZADO', label: 'Finalizado', indicador: '🟢', cor: '#198754' };
        }
        if (status === 'EM_COMPRA') {
            return { codigo: 'COMPRA', label: 'Importando compra', indicador: '🟣', cor: '#6610f2' };
        }
        if (status === 'AGUARDANDO_REVISAO' || status === 'REVISADA' || status === 'PRONTA_PARA_COMPRA') {
            return { codigo: 'MIIP', label: resolverStatusRealCentral(doc, wait), indicador: '🟠', cor: '#fd7e14' };
        }
        if (status === 'EM_PROCESSAMENTO') {
            return { codigo: 'PARSER', label: 'Processando XML', indicador: '🟣', cor: '#6610f2' };
        }
        if (status === 'AGUARDANDO_XML_COMPLETO') {
            if (wait?.estadoMirx === 'CONSULTANDO_XML') {
                return { codigo: 'CONSULTANDO', label: 'Recuperando XML automaticamente', indicador: '🔵', cor: '#0d6efd' };
            }
            return {
                codigo: 'AGENDADO',
                label: 'Recuperação automática do XML agendada',
                indicador: '🟡',
                cor: '#f59e0b'
            };
        }
        if (['SINCRONIZADA', 'RECEBIDA'].includes(status) && (doc?.tipoDocumento === 'PROC_NFE' || doc?.tipoDocumento === 'NFE')) {
            return { codigo: 'XML_RECEBIDO', label: 'XML disponível', indicador: '🟢', cor: '#198754' };
        }
        if (status === 'SINCRONIZADA' && doc?.tipoDocumento === 'RES_NFE') {
            return { codigo: 'MANIFESTACAO', label: 'Aguardando manifestação', indicador: '🔵', cor: '#0dcaf0' };
        }
        return { codigo: 'RECEBIDO', label: 'Recebendo documento', indicador: '🟢', cor: '#0d6efd' };
    }

    function _buscarHistoricoStatus(historico, pred) {
        const lista = Array.isArray(historico) ? historico : [];
        for (let i = 0; i < lista.length; i += 1) {
            const h = lista[i];
            if (pred(h)) return h;
        }
        return null;
    }

    function montarEtapasOperacionaisCentral(doc, historico, wait, eventosMirx) {
        const hist = Array.isArray(historico) ? [...historico] : [];
        hist.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        const mirx = Array.isArray(eventosMirx) ? eventosMirx : [];

        const hRes = _buscarHistoricoStatus(hist, (h) =>
            h.statusNovo === 'SINCRONIZADA' || h.statusNovo === 'AGUARDANDO_XML_COMPLETO' || /RES_NFE|receb/i.test(h.detalhe || ''));
        const hManif = _buscarHistoricoStatus(hist, (h) =>
            /MANIFESTACAO_ACEITA|CIENCIA|manifest/i.test(String(h.detalhe || '') + String(h.tipo || ''))
            || (h.statusAnterior === 'AGUARDANDO_XML_COMPLETO' && h.statusNovo === 'AGUARDANDO_XML_COMPLETO'));
        const hXml = _buscarHistoricoStatus(hist, (h) =>
            h.statusNovo === 'SINCRONIZADA' && (doc?.tipoDocumento === 'PROC_NFE' || doc?.tipoDocumento === 'NFE'))
            || (doc?.tipoDocumento === 'PROC_NFE' || doc?.tipoDocumento === 'NFE'
                ? { createdAt: doc.processadoEm || doc.updatedAt } : null);
        const hParser = _buscarHistoricoStatus(hist, (h) =>
            h.statusNovo === 'EM_PROCESSAMENTO' || /PARSER/i.test(h.detalhe || ''));
        const hMiip = _buscarHistoricoStatus(hist, (h) =>
            ['AGUARDANDO_REVISAO', 'REVISADA', 'PRONTA_PARA_COMPRA'].includes(h.statusNovo) || /MIIP/i.test(h.detalhe || ''));
        const hCompra = _buscarHistoricoStatus(hist, (h) =>
            ['GRAVADA', 'EM_COMPRA'].includes(h.statusNovo));

        const status = doc?.status || '';
        const xmlCompleto = ['PROC_NFE', 'NFE'].includes(doc?.tipoDocumento)
            && status !== 'AGUARDANDO_XML_COMPLETO';
        const mirxEnfileirado = mirx.find((e) => e.tipoMirx === 'MIRX_ENFILEIRADO');
        const mirxXml = mirx.find((e) => e.tipoMirx === 'MIRX_XML_RECUPERADO');
        const posParser = ['AGUARDANDO_REVISAO', 'REVISADA', 'PRONTA_PARA_COMPRA', 'EM_COMPRA', 'GRAVADA'].includes(status);
        const posMiip = ['AGUARDANDO_REVISAO', 'REVISADA', 'PRONTA_PARA_COMPRA', 'EM_COMPRA', 'GRAVADA'].includes(status);
        const finalizado = status === 'GRAVADA';
        const emCompra = status === 'EM_COMPRA' || finalizado;

        const etapas = [
            {
                id: 'localizado',
                label: 'Documento localizado',
                detalhe: 'Documento encontrado na Central',
                icone: 'fa-search-location',
                em: doc?.createdAt || hRes?.createdAt || null,
                concluida: true,
                ativa: false
            },
            {
                id: 'res_nfe',
                label: 'RES_NFE recebido',
                detalhe: 'Resumo DF-e disponível',
                icone: 'fa-inbox',
                em: hRes?.createdAt || doc?.createdAt || null,
                concluida: true,
                ativa: false
            },
            {
                id: 'manif_enviada',
                label: 'Manifestação enviada',
                detalhe: 'Ciência / evento enviado à SEFAZ',
                icone: 'fa-paper-plane',
                em: hManif?.createdAt || null,
                concluida: Boolean(hManif) || status === 'AGUARDANDO_XML_COMPLETO' || xmlCompleto || posParser,
                ativa: status === 'SINCRONIZADA' && doc?.tipoDocumento === 'RES_NFE'
            },
            {
                id: 'manif_ok',
                label: 'Manifestação autorizada',
                detalhe: mensagemAmigavelCentral('MANIFESTACAO_ACEITA'),
                icone: 'fa-file-signature',
                em: hManif?.createdAt || null,
                concluida: Boolean(hManif) || status === 'AGUARDANDO_XML_COMPLETO' || xmlCompleto || posParser,
                ativa: false
            },
            {
                id: 'xml_solicitado',
                label: 'XML solicitado automaticamente',
                detalhe: 'MIRX acompanhou a recuperação do XML',
                icone: 'fa-robot',
                em: mirxEnfileirado?.createdAt || wait?.iniciadoEm || null,
                concluida: Boolean(mirxEnfileirado) || status === 'AGUARDANDO_XML_COMPLETO' || xmlCompleto || posParser,
                ativa: status === 'AGUARDANDO_XML_COMPLETO' && !xmlCompleto
            },
            {
                id: 'xml_sefaz',
                label: 'XML disponibilizado pela SEFAZ',
                detalhe: xmlCompleto ? 'PROC_NFE / NFe disponível' : 'Aguardando SEFAZ',
                icone: 'fa-cloud-download-alt',
                em: xmlCompleto ? (mirxXml?.createdAt || hXml?.createdAt || doc?.updatedAt) : null,
                concluida: xmlCompleto,
                ativa: status === 'AGUARDANDO_XML_COMPLETO'
            },
            {
                id: 'xml_baixado',
                label: 'XML baixado',
                detalhe: 'Arquivo persistido na Central',
                icone: 'fa-download',
                em: xmlCompleto ? (mirxXml?.createdAt || hXml?.createdAt) : null,
                concluida: xmlCompleto,
                ativa: false
            },
            {
                id: 'xml_validado',
                label: 'XML validado',
                detalhe: 'Estrutura fiscal validada',
                icone: 'fa-shield-alt',
                em: xmlCompleto ? (hXml?.createdAt || doc?.updatedAt) : null,
                concluida: xmlCompleto,
                ativa: false
            },
            {
                id: 'parser',
                label: 'Parser concluído',
                detalhe: 'Itens, valores e tributos extraídos',
                icone: 'fa-cogs',
                em: hParser?.createdAt || null,
                concluida: Boolean(hParser) || posParser,
                ativa: status === 'EM_PROCESSAMENTO'
            },
            {
                id: 'produtos',
                label: 'Produtos identificados',
                detalhe: 'Itens da NF-e reconhecidos',
                icone: 'fa-boxes',
                em: hMiip?.createdAt || hParser?.createdAt || null,
                concluida: posMiip,
                ativa: status === 'EM_PROCESSAMENTO'
            },
            {
                id: 'miip',
                label: 'MIIP executado',
                detalhe: 'Associação inteligente de produtos',
                icone: 'fa-brain',
                em: hMiip?.createdAt || null,
                concluida: posMiip,
                ativa: status === 'AGUARDANDO_REVISAO'
            },
            {
                id: 'compra',
                label: 'Compra criada',
                detalhe: 'Lançamento em Compras',
                icone: 'fa-shopping-cart',
                em: hCompra?.createdAt || null,
                concluida: emCompra,
                ativa: status === 'EM_COMPRA'
            },
            {
                id: 'estoque',
                label: 'Estoque atualizado',
                detalhe: 'Saldos atualizados na gravação',
                icone: 'fa-warehouse',
                em: finalizado ? (hCompra?.createdAt || doc?.updatedAt) : null,
                concluida: finalizado,
                ativa: false
            },
            {
                id: 'finalizado',
                label: 'Documento finalizado',
                detalhe: 'Fluxo documental concluído',
                icone: 'fa-flag-checkered',
                em: finalizado ? (doc?.updatedAt || hCompra?.createdAt) : null,
                concluida: finalizado,
                ativa: false
            }
        ];

        for (let i = 0; i < etapas.length; i += 1) {
            const atual = etapas[i].em ? new Date(etapas[i].em).getTime() : null;
            const prev = i > 0 && etapas[i - 1].em ? new Date(etapas[i - 1].em).getTime() : null;
            if (atual && prev && atual >= prev) {
                etapas[i].duracaoMs = atual - prev;
                etapas[i].duracaoLabel = formatarDuracaoHumanaCentral(atual - prev);
            } else {
                etapas[i].duracaoMs = null;
                etapas[i].duracaoLabel = null;
            }
            const dt = etapas[i].em ? formatarDataHoraSeparadoCentral(etapas[i].em) : { data: '—', hora: '—' };
            etapas[i].horaLabel = dt.hora;
            etapas[i].dataLabel = dt.data;
            etapas[i].statusLabel = etapas[i].concluida ? 'Concluído' : (etapas[i].ativa ? 'Em andamento' : 'Pendente');
        }

        const concluidas = etapas.filter((e) => e.concluida).length;
        const percentual = Math.round((concluidas / Math.max(etapas.length, 1)) * 100);
        return {
            etapas,
            progresso: concluidas / etapas.length,
            percentual,
            concluidas,
            total: etapas.length,
            statusReal: resolverStatusRealCentral(doc, wait),
            explicacao: explicarStatusCentral(doc, wait)
        };
    }

    function renderBarraProgressoOperacionalCentral(modelo) {
        const total = modelo?.total || 14;
        const ok = modelo?.concluidas || 0;
        const percentual = modelo?.percentual != null
            ? modelo.percentual
            : Math.round((ok / Math.max(total, 1)) * 100);
        const preenchidos = Math.round(percentual / 10);
        const blocos = Array.from({ length: 10 }, (_, i) => {
            const filled = i < preenchidos;
            return `<span class="central-rc75-progress-block ${filled ? 'is-on' : ''}" aria-hidden="true"></span>`;
        }).join('');
        return `
            <div class="central-rc75-progress central-rc343-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                 aria-valuenow="${percentual}" aria-label="Andamento do documento ${percentual}%">
                <div class="central-rc75-progress-head">
                    <span>Andamento do documento</span>
                    <strong class="central-rc343-pct">${percentual}%</strong>
                </div>
                <div class="central-rc75-progress-track">${blocos}</div>
                <div class="central-rc343-progress-text" aria-hidden="true">${'█'.repeat(Math.max(0, preenchidos))}${'░'.repeat(Math.max(0, 10 - preenchidos))} ${percentual}%</div>
                <div class="central-rc75-progress-labels">
                    <span class="is-on">${escapeUx(modelo?.statusReal || '')}</span>
                    <span>${ok}/${total} etapas</span>
                </div>
            </div>`;
    }

    function renderExplicacaoStatusCentral(doc, wait) {
        const texto = explicarStatusCentral(doc, wait);
        const statusReal = resolverStatusRealCentral(doc, wait);
        return `
            <div class="central-rc343-explica central-entradas-anim-in" title="${escapeUx(texto)}">
                <div class="central-rc343-explica__title">
                    <i class="fas fa-info-circle me-1" aria-hidden="true"></i>
                    ${escapeUx(statusReal)}
                </div>
                <p class="central-rc343-explica__txt mb-0">${escapeUx(texto)}</p>
            </div>`;
    }

    function renderEventosMirxCentral(eventosMirx) {
        const lista = Array.isArray(eventosMirx) ? eventosMirx.slice(0, 12) : [];
        if (!lista.length) {
            return `
                <div class="central-rc343-mirx">
                    <label class="central-entradas-label">Eventos MIRX</label>
                    <p class="small text-muted mb-0">Nenhum evento MIRX registrado ainda.</p>
                </div>`;
        }
        return `
            <div class="central-rc343-mirx">
                <label class="central-entradas-label">Eventos MIRX</label>
                <ul class="central-rc343-mirx-list">
                    ${lista.map((e) => {
                        const dt = formatarDataHoraSeparadoCentral(e.createdAt);
                        return `<li>
                            <span class="central-rc343-mirx-ico" style="color:${escapeUx(e.cor || '#64748b')}"><i class="fas ${escapeUx(e.icone || 'fa-robot')}"></i></span>
                            <div>
                                <strong>${escapeUx(e.label)}</strong>
                                <small class="text-muted d-block">${escapeUx(dt.data)} ${escapeUx(dt.hora)}${e.motivo ? ` · ${escapeUx(e.motivo)}` : ''}</small>
                            </div>
                        </li>`;
                    }).join('')}
                </ul>
            </div>`;
    }

    function renderAuditoriaDocumentalCentral(auditoria) {
        const a = auditoria || {};
        return `
            <div class="central-rc343-audit">
                <label class="central-entradas-label">Auditoria do documento</label>
                <div class="central-rc343-audit-grid">
                    <div><span class="central-rc75-k">Tempo total</span><span class="central-rc75-v">${escapeUx(a.tempoTotalLabel || '—')}</span></div>
                    <div><span class="central-rc75-k">Tentativas</span><span class="central-rc75-v">${escapeUx(String(a.quantidadeTentativas ?? 0))}</span></div>
                    <div><span class="central-rc75-k">Último método</span><span class="central-rc75-v">${escapeUx(a.ultimoMetodo || '—')}</span></div>
                    <div><span class="central-rc75-k">Último retorno SEFAZ</span><span class="central-rc75-v">${escapeUx(a.ultimoRetornoSefaz || '—')}</span></div>
                    <div><span class="central-rc75-k">Tempo até XML</span><span class="central-rc75-v">${escapeUx(a.tempoAteXmlLabel || '—')}</span></div>
                    <div><span class="central-rc75-k">Dormindo</span><span class="central-rc75-v">${escapeUx(a.dormindo ? 'Sim' : 'Não')}</span></div>
                </div>
            </div>`;
    }

    function renderTimelineOperacionalCentral(modelo) {
        const etapas = modelo?.etapas || [];
        if (!etapas.length) return '';
        return `
            <div class="central-rc75-timeline" role="list" aria-label="Linha do tempo do documento">
                ${etapas.map((e, i) => `
                    <div class="central-rc75-timeline-item central-rc75-timeline-item--${e.concluida ? 'ok' : (e.ativa ? 'ativo' : 'pendente')}" role="listitem"
                         title="${escapeUx(e.detalhe || e.label)}">
                        ${i > 0 ? `<div class="central-rc75-timeline-gap" aria-hidden="true">
                            <span>↓</span>
                            ${e.duracaoLabel ? `<small>(${escapeUx(e.duracaoLabel)})</small>` : ''}
                        </div>` : ''}
                        <div class="central-rc75-timeline-card">
                            <span class="central-rc75-timeline-icone">${e.concluida ? '✔' : (e.ativa ? '●' : '○')} <i class="fas ${e.icone}"></i></span>
                            <div class="central-rc75-timeline-body">
                                <strong>${escapeUx(e.label)}</strong>
                                <div class="central-rc75-timeline-meta">
                                    <span>${escapeUx(e.horaLabel || '—')}</span>
                                    <span class="central-rc75-pill">${escapeUx(e.statusLabel)}</span>
                                </div>
                                <small class="text-muted">${escapeUx(e.detalhe || '')}</small>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }

    function renderChipEtapaCentral(chip) {
        if (!chip) return '';
        return `<span class="central-rc75-chip" style="--chip-cor:${chip.cor || '#64748b'}" title="${escapeUx(chip.label)}">
            <span aria-hidden="true">${escapeUx(chip.indicador || '')}</span> ${escapeUx(chip.label)}
        </span>`;
    }

    function renderCardXmlWaitOperacionalCentral(doc, wait, opcoes = {}) {
        if (doc?.status !== 'AGUARDANDO_XML_COMPLETO') return '';
        const w = wait || {};
        const agora = opcoes.agora || Date.now();
        const proxima = w.proximaTentativa || w.bloqueio656?.bloqueadoAte || null;
        const cd = formatarCountdownCentral(proxima, agora);
        const tempoAguardando = w.tempoAguardandoMs != null
            ? formatarDuracaoHumanaCentral(w.tempoAguardandoMs)
            : (w.iniciadoEm
                ? formatarDuracaoHumanaCentral(agora - new Date(w.iniciadoEm).getTime())
                : (w.tempoAguardandoLabel || '—'));
        const backoff = w.backoff?.label
            || (w.bloqueio656?.intervaloMs
                ? formatarDuracaoHumanaCentral(w.bloqueio656.intervaloMs)
                : (opcoes.backoffLabel || '—'));
        const ultimoCstat = opcoes.ultimoCStat
            || w.ultimoCStat
            || w.bloqueio656?.cStat
            || w.estado593?.cStat
            || null;
        const ultimoRetorno = ultimoCstat
            ? mensagemAmigavelCentral(String(ultimoCstat), `${ultimoCstat}`)
            : (w.ultimoResultado || 'Aguardando retorno da SEFAZ');
        const metodo = w.metodoProgramado || w.ultimoMetodo || opcoes.metodo || 'DistDFe → consChNFe';
        const estadoMirx = w.estadoMirxLabel || w.estadoMirx || 'Recuperação MIRX';
        const dormindo = w.dormindo === true || w.estadoMirx === 'SLEEP';
        const statusGate = w.statusGate || (w.consultaBloqueada ? 'BLOCKED' : 'NORMAL');
        const visual = w.labelVisual
            ? `${w.indicadorVisual || ''} ${w.labelVisual}`.trim()
            : null;

        let statusMsg = visual || w.motivo || mensagemAmigavelCentral('AGUARDANDO_XML_COMPLETO');
        if (w.estado593?.ativo || w.configuracaoInvalida) {
            statusMsg = 'Configuração de certificado/CNPJ inválida. Consultas suspensas.';
        } else if (dormindo || w.bloqueio656?.ativo || w.consultaBloqueada) {
            statusMsg = '🔴 Consulta temporariamente bloqueada (656)';
        } else {
            statusMsg = visual || '🟡 Recuperação automática do XML agendada';
        }

        return `
            <div class="central-rc75-xml-card central-entradas-anim-in" id="centralRc75XmlCard" data-doc-id="${escapeUx(doc.id)}">
                <div class="central-rc75-xml-card__title">
                    <i class="fas fa-file-import me-1" aria-hidden="true"></i> XML Completo — MIRX
                    ${renderChipEtapaCentral(resolverChipEtapaCentral(doc, w))}
                </div>
                <div class="central-rc75-xml-grid">
                    <div><span class="central-rc75-k">Status</span><span class="central-rc75-v" data-central-live="status-msg">${escapeUx(statusMsg)}</span></div>
                    <div><span class="central-rc75-k">Estado MIRX</span><span class="central-rc75-v">${escapeUx(estadoMirx)}</span></div>
                    <div><span class="central-rc75-k">Dormindo</span><span class="central-rc75-v">${escapeUx(dormindo ? 'Sim' : (w.dormindoLabel || 'Não'))}</span></div>
                    <div><span class="central-rc75-k">Status do Gate</span><span class="central-rc75-v">${escapeUx(statusGate)}</span></div>
                    <div><span class="central-rc75-k">Motivo do bloqueio</span><span class="central-rc75-v">${escapeUx(w.motivoBloqueio || (dormindo ? (w.motivo || 'cStat 656') : '—'))}</span></div>
                    <div><span class="central-rc75-k">Última tentativa</span><span class="central-rc75-v" data-central-live="ultima-consulta">${escapeUx(w.ultimaConsulta ? formatarDataHoraSeparadoCentral(w.ultimaConsulta).data + ' ' + formatarDataHoraSeparadoCentral(w.ultimaConsulta).hora : '—')}</span></div>
                    <div><span class="central-rc75-k">Próxima tentativa</span><span class="central-rc75-v" data-central-live="proxima-consulta" data-central-target="${escapeUx(proxima || '')}">${escapeUx(cd.dataHora || '—')}</span></div>
                    <div><span class="central-rc75-k">Tempo restante</span><span class="central-rc75-v central-rc75-countdown" data-central-live="countdown" data-central-target="${escapeUx(proxima || '')}">${escapeUx(cd.faltam || w.tempoRestanteLabel || '—')}</span></div>
                    <div><span class="central-rc75-k">Backoff atual</span><span class="central-rc75-v">${escapeUx(backoff)}</span></div>
                    <div><span class="central-rc75-k">Método programado</span><span class="central-rc75-v">${escapeUx(metodo)}</span></div>
                    <div><span class="central-rc75-k">Nº tentativas</span><span class="central-rc75-v">${escapeUx(String(w.tentativas ?? 0))}</span></div>
                    <div><span class="central-rc75-k">Resposta SEFAZ</span><span class="central-rc75-v">${escapeUx(ultimoRetorno)}</span></div>
                </div>
                <p class="small text-muted mt-2 mb-0">Próxima tentativa automática: <strong data-central-live="proxima-consulta" data-central-target="${escapeUx(proxima || '')}">${escapeUx(cd.dataHora || 'agendada pelo MIRX')}</strong></p>
            </div>`;
    }

    function renderInfoTecnicasRecolhivelCentral(ctx = {}) {
        const doc = ctx.doc || {};
        const wait = ctx.wait || {};
        const sefaz = ctx.sefaz || {};
        const statusBg = ctx.statusBg || {};
        return `
            <details class="central-rc75-tech">
                <summary><i class="fas fa-microchip me-1"></i> Informações Técnicas</summary>
                <div class="central-rc75-tech-grid">
                    <div><span class="central-rc75-k">Documento</span><span class="central-rc75-v">${escapeUx(doc.id ?? '—')}</span></div>
                    <div><span class="central-rc75-k">NSU</span><span class="central-rc75-v">${escapeUx(doc.nsu || wait.nsu || '—')}</span></div>
                    <div><span class="central-rc75-k">Chave</span><span class="central-rc75-v text-break">${escapeUx(doc.chave || '—')}</span></div>
                    <div><span class="central-rc75-k">Último cStat</span><span class="central-rc75-v">${escapeUx(sefaz.ultimoCStat || wait.bloqueio656?.cStat || '—')}</span></div>
                    <div><span class="central-rc75-k">CorrelationId</span><span class="central-rc75-v text-break">${escapeUx(wait.correlationId || sefaz.ultimaRespostaSEFAZ?.correlationId || '—')}</span></div>
                    <div><span class="central-rc75-k">RequestId</span><span class="central-rc75-v text-break">${escapeUx(sefaz.ultimaRespostaSEFAZ?.requestId || '—')}</span></div>
                    <div><span class="central-rc75-k">Endpoint</span><span class="central-rc75-v text-break">${escapeUx(sefaz.ultimaRespostaSEFAZ?.endpoint || '—')}</span></div>
                    <div><span class="central-rc75-k">SOAP / Economia</span><span class="central-rc75-v">${escapeUx(String(sefaz.consultasSOAP ?? '—'))} / ${escapeUx(String(sefaz.economiaSOAP ?? sefaz.consultasEvitadas ?? '—'))}</span></div>
                    <div><span class="central-rc75-k">Tempo</span><span class="central-rc75-v">${escapeUx(sefaz.tempoMedio || '—')}</span></div>
                    <div><span class="central-rc75-k">XML Wait</span><span class="central-rc75-v">${escapeUx(statusBg.xmlWait?.ativo || wait.aguardandoXml ? 'ATIVO' : '—')}</span></div>
                    <div><span class="central-rc75-k">Gate</span><span class="central-rc75-v">${escapeUx(sefaz.estadoOperacional?.codigo || 'ATIVO')}</span></div>
                    <div><span class="central-rc75-k">Background</span><span class="central-rc75-v">${escapeUx(statusBg.servicoAtivo ? 'ATIVO' : (statusBg.background?.status || '—'))}</span></div>
                    <div><span class="central-rc75-k">Scheduler</span><span class="central-rc75-v">${escapeUx(statusBg.xmlWait?.ativo || statusBg.syncAutomaticaHabilitada ? 'ATIVO' : '—')}</span></div>
                </div>
            </details>`;
    }

    function renderPainelSaudeSefazCentral(sefaz, statusBg = {}) {
        const est = sefaz?.estadoOperacional || { indicador: '🟢', label: 'Operando normalmente', codigo: 'NORMAL' };
        const cooldown = resolverCooldownSefaz656Ux({
            sefazOperacional: sefaz,
            sincronizacaoNsu: statusBg.sincronizacaoNsu || statusBg.sincronizacao || null,
            servicoStatus: statusBg
        });
        let label = est.codigo === 'NORMAL' ? 'Operando normalmente' : (est.label || est.codigo);
        let indicador = est.indicador || '🟢';
        // RC3.7.5.3 — BLOCKED/656 pós recovery não é "Erro"
        if (cooldown.ativo) {
            label = cooldown.label;
            indicador = cooldown.indicador;
        } else if (est.codigo === 'BLOCKED' && String(sefaz?.ultimoCStat || '') === '656') {
            label = 'AGUARDANDO COOLDOWN DA SEFAZ';
            indicador = '🟡';
        }
        return `
            <div class="central-rc75-saude" id="centralRc75Saude" aria-label="SEFAZ Operacional">
                <div class="central-rc75-saude__head">
                    <strong>SEFAZ OPERACIONAL</strong>
                    <span>${escapeUx(indicador)} ${escapeUx(label)}</span>
                </div>
                ${cooldown.ativo ? `
                <div class="central-rc75-saude__cooldown" role="status">
                    <div><span class="central-rc75-k">Estado</span><span class="central-rc75-v">${escapeUx(cooldown.indicador)} ${escapeUx(cooldown.descricao)}</span></div>
                    <div><span class="central-rc75-k">Próxima tentativa</span><span class="central-rc75-v">${escapeUx(cooldown.proximaLabel)}</span></div>
                    <div><span class="central-rc75-k">Tempo restante</span><span class="central-rc75-v">${escapeUx(cooldown.restanteLabel)}</span></div>
                </div>` : ''}
                <div class="central-rc75-saude__grid">
                    <div><span class="central-rc75-k">Background</span><span class="central-rc75-v" data-central-live="bg-status">${escapeUx(statusBg.servicoAtivo ? 'ATIVO' : 'PARADO')}</span></div>
                    <div><span class="central-rc75-k">XML Wait</span><span class="central-rc75-v" data-central-live="xmlwait-status">${escapeUx(statusBg.xmlWait?.ativo ? 'ATIVO' : (statusBg.xmlWait?.telemetria?.schedulerAtivo ? 'ATIVO' : '—'))}</span></div>
                    <div><span class="central-rc75-k">Operational Gate</span><span class="central-rc75-v">ATIVO</span></div>
                    <div><span class="central-rc75-k">Última consulta</span><span class="central-rc75-v" data-central-live="saude-ultima">${escapeUx(sefaz?.ultimaConsulta ? formatarDataHoraSeparadoCentral(sefaz.ultimaConsulta).hora : '—')}</span></div>
                    <div><span class="central-rc75-k">Consultas realizadas</span><span class="central-rc75-v">${escapeUx(String(sefaz?.consultasSOAP ?? sefaz?.consultasRealizadas ?? '—'))}</span></div>
                    <div><span class="central-rc75-k">Consultas evitadas</span><span class="central-rc75-v">${escapeUx(String(sefaz?.consultasEvitadas ?? sefaz?.economiaSOAP ?? '—'))}</span></div>
                </div>
            </div>`;
    }

    /** RC3.4.6 — Saúde documental da Central. */
    function renderPainelSaudeDocumentalCentral(saude, opcoes = {}) {
        // RC3.4.6.1 — null-safe: painel nunca lança se saúde ainda não calculada
        if (!saude) {
            return `
            <div class="central-health-panel central-entradas-anim-in" aria-label="Saúde da Central">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <strong>Saúde da Central</strong>
                </div>
                <div class="small text-muted">Saúde ainda não calculada</div>
            </div>`;
        }

        const c = saude.contadores || {};
        const est = saude.estatisticas || {};
        const filtro = opcoes.filtroNivel || null;
        let alertas = Array.isArray(saude.alertas) ? saude.alertas : [];
        if (filtro) alertas = alertas.filter((a) => a?.nivel === filtro);

        const chips = [
            { nivel: 'SAUDAVEL', emoji: '🟢', label: 'Saudáveis', valor: c.saudaveis ?? 0, cor: '#198754' },
            { nivel: 'ATENCAO', emoji: '🟡', label: 'Atenção', valor: c.atencao ?? 0, cor: '#f59e0b' },
            { nivel: 'CRITICO', emoji: '🔴', label: 'Críticos', valor: c.criticos ?? 0, cor: '#dc3545' },
            { nivel: 'BLOQUEADO', emoji: '⚫', label: 'Bloqueados', valor: c.bloqueados ?? 0, cor: '#6c757d' }
        ];

        const listaHtml = alertas.length
            ? `<div class="central-health-alertas mt-2">
                ${alertas.slice(0, 12).map((a) => {
                    const linha = montarLinhaSaudeCompactaCentral(a || {});
                    const tempo = a?.tempoParadoLabel || '';
                    return `
                    <button type="button" class="central-health-alerta" data-health-doc="${escapeUx(a?.documentoId ?? '')}"
                        title="${escapeUx(a?.diagnostico || linha)}">
                        <span>${escapeUx(a?.indicador || '🟡')}</span>
                        <span class="flex-grow-1 text-start min-w-0">
                            <strong class="central-health-alerta-fornecedor">${escapeUx(a?.fornecedor || a?.chave || (a?.documentoId != null ? `#${a.documentoId}` : 'Documento'))}</strong>
                            <small class="d-block text-muted text-truncate central-health-alerta-linha">${escapeUx(linha)}</small>
                        </span>
                        <small class="text-muted central-health-alerta-tempo">${escapeUx(tempo)}</small>
                    </button>`;
                }).join('')}
               </div>`
            : (filtro
                ? '<div class="small text-muted mt-2">Nenhum documento neste nível.</div>'
                : '<div class="small text-muted mt-2">Nenhum alerta ativo.</div>');

        const statsHtml = `
            <div class="central-health-stats small text-muted mt-2">
                <span title="Tempo médio até XML">XML: ${escapeUx(est.tempoMedioAteXmlMin != null ? `${est.tempoMedioAteXmlMin} min` : '—')}</span>
                <span class="mx-1">·</span>
                <span title="Tempo médio até Compra">Compra: ${escapeUx(est.tempoMedioAteCompraMin != null ? `${est.tempoMedioAteCompraMin} min` : '—')}</span>
                <span class="mx-1">·</span>
                <span title="Tempo médio MIIP">MIIP: ${escapeUx(est.tempoMedioMiipMin != null ? `${est.tempoMedioMiipMin} min` : '—')}</span>
                <span class="mx-1">·</span>
                <span title="Taxa sucesso MIRX">MIRX: ${escapeUx(est.taxaSucessoMirx != null ? `${est.taxaSucessoMirx}%` : '—')}</span>
                <span class="mx-1">·</span>
                <span>Auto: ${escapeUx(String(est.recuperadosAutomaticamente ?? 0))} / Manual: ${escapeUx(String(est.recuperadosManualmente ?? 0))}</span>
            </div>`;

        return `
            <div class="central-health-panel central-entradas-anim-in" aria-label="Saúde da Central">
                <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
                    <strong>Saúde da Central</strong>
                    <small class="text-muted">${escapeUx(saude.geradoEm ? formatarDataHoraSeparadoCentral(saude.geradoEm).hora : '')}</small>
                    <button type="button" class="btn btn-outline-secondary btn-sm ms-auto" id="centralBtnSaudeAnalisar" title="Analisar agora (sem SEFAZ)">
                        <i class="fas fa-heartbeat me-1"></i> Analisar
                    </button>
                </div>
                <div class="central-health-chips">
                    ${chips.map((ch) => `
                        <button type="button" class="central-health-chip ${filtro === ch.nivel ? 'ativa' : ''}"
                            data-health-nivel="${ch.nivel}"
                            style="--health-cor:${ch.cor}"
                            title="Filtrar ${ch.label}">
                            ${ch.emoji} ${escapeUx(ch.label)}: <strong>${escapeUx(ch.valor)}</strong>
                        </button>
                    `).join('')}
                    ${filtro ? '<button type="button" class="btn btn-link btn-sm" data-health-nivel="">Limpar filtro</button>' : ''}
                </div>
                ${statsHtml}
                ${listaHtml}
            </div>`;
    }

    /**
     * RC3.4.6 / RC3.4.6.1 — card de saúde no detalhe do documento.
     * Null-safe: nunca lança se saude/campos forem null.
     */
    function renderCardSaudeDocumentoCentral(saude, doc = null) {
        const encerrado = documentoEncerradoCentral(doc) || documentoEncerradoCentral(saude);

        if (!saude || !saude.nivel) {
            const msg = encerrado
                ? 'Documento encerrado. Não existem próximas tentativas.'
                : 'Saúde ainda não calculada. Documento sem diagnóstico disponível.';
            return `
            <div class="central-health-doc mb-3" style="border-left:3px solid #94a3b8; padding-left:.75rem">
                <label class="central-entradas-label">Saúde do documento</label>
                <div class="small text-muted">${escapeUx(msg)}</div>
            </div>`;
        }

        const cor = saude.cor || '#64748b';
        const diagnostico = saude.diagnostico
            || (encerrado
                ? 'Documento encerrado. Não existem próximas tentativas.'
                : 'Documento sem diagnóstico disponível');
        const regra = saude.regra || null;
        const nivel = saude.nivelLabel || saude.nivel || '—';
        const tempoParado = saude.tempoParadoLabel || null;
        const ultimaAtualizacao = saude.ultimaAtualizacaoDoc || null;
        const motivo = saude.motivo || saude.mirx?.motivo || null;
        const proximaTentativa = saude.mirx?.proximaTentativa || null;

        let metaLinha = '';
        if (encerrado) {
            const em = formatarDataHoraSeparadoCentral(saude.dataEmissao || doc?.dataEmissao);
            const enc = formatarDataHoraSeparadoCentral(
                saude.dataEncerramento || saude.ultimaAtualizacaoDoc || doc?.updatedAt
            );
            const partesEnc = ['Documento encerrado. Não existem próximas tentativas.'];
            if (saude.dataEmissao || doc?.dataEmissao) {
                partesEnc.push(`Emissão: ${escapeUx(em.data)}`);
            }
            if (saude.dataEncerramento || saude.ultimaAtualizacaoDoc || doc?.updatedAt) {
                partesEnc.push(`Encerrado: ${escapeUx(enc.data)}${enc.hora ? ` ${escapeUx(enc.hora)}` : ''}`);
            }
            metaLinha = partesEnc.join(' · ');
        } else {
            const partes = [];
            if (saude.dataEmissao || doc?.dataEmissao) {
                const em = formatarDataHoraSeparadoCentral(saude.dataEmissao || doc?.dataEmissao);
                partes.push(`Emissão: ${escapeUx(em.data)}`);
            }
            if (tempoParado) partes.push(`Tempo parado: ${escapeUx(tempoParado)}`);
            if (saude.detectadoEm) {
                partes.push(`Detecção: ${escapeUx(formatarDataHoraSeparadoCentral(saude.detectadoEm).hora)}`);
            }
            if (ultimaAtualizacao) {
                partes.push(`Atualização: ${escapeUx(formatarDataHoraSeparadoCentral(ultimaAtualizacao).hora)}`);
            }
            if (proximaTentativa) {
                const cd = formatarCountdownCentral(proximaTentativa);
                partes.push(`Próxima tentativa: ${escapeUx(cd.dataHora || '—')}`);
            }
            if (motivo) partes.push(`Motivo: ${escapeUx(motivo)}`);
            metaLinha = partes.join(' · ');
        }

        return `
            <div class="central-health-doc mb-3" style="border-left:3px solid ${escapeUx(cor)}; padding-left:.75rem">
                <label class="central-entradas-label">Saúde do documento</label>
                <div class="d-flex align-items-center gap-2 mb-1">
                    <span>${escapeUx(saude.indicador || '🟢')}</span>
                    <strong>${escapeUx(nivel)}</strong>
                    ${regra ? `<span class="badge bg-light text-dark">${escapeUx(regra)}</span>` : ''}
                </div>
                <div class="small">${escapeUx(diagnostico)}</div>
                ${saude.recomendacao ? `<div class="small text-muted mt-1"><i class="fas fa-lightbulb me-1"></i>${escapeUx(saude.recomendacao)}</div>` : ''}
                ${metaLinha ? `<div class="small text-muted mt-1">${metaLinha}</div>` : ''}
            </div>`;
    }

    function renderLoadingEtapasCentral(fase = 'preparando') {
        const etapas = [
            { id: 'preparando', label: 'Preparando dados...' },
            { id: 'recebendo', label: 'Recebendo documentos...' },
            { id: 'consultando', label: 'Consultando fornecedores...' },
            { id: 'atualizando', label: 'Atualizando painel...' },
            { id: 'concluido', label: 'Concluído.' }
        ];
        const idx = Math.max(0, etapas.findIndex((e) => e.id === fase));
        return `
            <div class="central-rc75-loading" role="status" aria-live="polite">
                <div class="spinner-border spinner-border-sm text-primary me-2" aria-hidden="true"></div>
                <div>
                    ${etapas.map((e, i) => `
                        <div class="central-rc75-loading-step ${i < idx ? 'is-done' : ''} ${i === idx ? 'is-active' : ''}">
                            ${i < idx ? '✓' : (i === idx ? '…' : '○')} ${escapeUx(e.label)}
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    function atualizarLiveRegionsCentral(root, agora = Date.now()) {
        if (!root || !root.querySelectorAll) return 0;
        let n = 0;
        root.querySelectorAll('[data-central-live="countdown"]').forEach((el) => {
            const alvo = el.getAttribute('data-central-target');
            const cd = formatarCountdownCentral(alvo, agora);
            if (el.textContent !== cd.faltam) {
                el.textContent = cd.faltam;
                n += 1;
            }
        });
        root.querySelectorAll('[data-central-live="tempo-aguardando"]').forEach((el) => {
            const inicio = el.getAttribute('data-central-inicio');
            if (!inicio) return;
            const label = formatarDuracaoHumanaCentral(agora - new Date(inicio).getTime());
            if (el.textContent !== label) {
                el.textContent = label;
                n += 1;
            }
        });
        root.querySelectorAll('[data-central-live="proxima-consulta"]').forEach((el) => {
            const alvo = el.getAttribute('data-central-target');
            if (!alvo) return;
            const cd = formatarCountdownCentral(alvo, agora);
            if (el.textContent !== (cd.dataHora || '—')) {
                el.textContent = cd.dataHora || '—';
                n += 1;
            }
        });
        return n;
    }

    const api = {
        EMPTY_PRESETS,
        escapeUx,
        renderEmptyStateCentral,
        renderSkeletonBlock,
        renderSkeletonKpisCentral,
        renderSkeletonIndicadoresCentral,
        renderSkeletonGridCentral,
        renderSkeletonPainelCentral,
        renderSkeletonTimelineCentral,
        renderSkeletonPainelBlocoCentral,
        corScoreCentral,
        descricaoScoreCentral,
        renderGaugeScoreCentral,
        calcularTendenciaKpiCentral,
        renderTendenciaKpiCentral,
        obterSnapshotKpisCentral,
        salvarSnapshotKpisCentral,
        resolverCooldownSefaz656Ux,
        resolverEstadoServicoCentral,
        formatarDataHoraSeparadoCentral,
        formatarDataEmissaoCurtaCentral,
        resolverSituacaoSaudeCurtaCentral,
        montarLinhaSaudeCompactaCentral,
        inferirOrigemTimelineCentral,
        extrairDadosExecutivoCentral,
        avatarFornecedorCentral,
        badgeStatusUx1,
        setFeatureFlagsCentral,
        recuperacaoPortalNacionalAtiva,
        resolverProximaAcaoOperacional,
        labelStatusOperacionalCentral,
        renderPipelineTimelineUx1,
        renderSkeletonListaDocumentosCentral,
        // RC7.5
        formatarDuracaoHumanaCentral,
        formatarCountdownCentral,
        mensagemAmigavelCentral,
        resolverStatusRealCentral,
        explicarStatusCentral,
        documentoEncerradoCentral,
        resolverDataDocumentoCentral,
        resolverChipEtapaCentral,
        montarEtapasOperacionaisCentral,
        renderBarraProgressoOperacionalCentral,
        renderTimelineOperacionalCentral,
        renderExplicacaoStatusCentral,
        renderEventosMirxCentral,
        renderAuditoriaDocumentalCentral,
        renderChipEtapaCentral,
        renderCardXmlWaitOperacionalCentral,
        renderInfoTecnicasRecolhivelCentral,
        renderPainelSaudeSefazCentral,
        renderPainelSaudeDocumentalCentral,
        renderCardSaudeDocumentoCentral,
        renderLoadingEtapasCentral,
        atualizarLiveRegionsCentral
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (global) {
        global.CentralEntradasUX = api;
    }
})(typeof window !== 'undefined' ? window : global);
