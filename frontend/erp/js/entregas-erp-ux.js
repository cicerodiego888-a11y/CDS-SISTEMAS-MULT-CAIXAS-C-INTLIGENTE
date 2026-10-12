(function (global) {
    'use strict';

    let observer = null;

    function normalizarBusca(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('pt-BR')
            .trim();
    }

    function aplicarBusca(root) {
        const input = root.querySelector('#buscaPedidosEntrega');
        const resultado = root.querySelector('#resultadoBuscaEntrega');
        const conteudo = root.querySelector('#conteudoEntregas');
        if (!input || !resultado || !conteudo) return;

        const termo = normalizarBusca(input.value);
        const cards = Array.from(conteudo.querySelectorAll('.ent-pedido'));
        let visiveis = 0;

        cards.forEach((card) => {
            const corresponde = !termo || normalizarBusca(card.textContent).includes(termo);
            card.hidden = !corresponde;
            if (corresponde) visiveis += 1;
        });

        conteudo.querySelectorAll('.ent-grupo').forEach((grupo) => {
            const temPedidoVisivel = Array.from(grupo.querySelectorAll('.ent-pedido'))
                .some((card) => !card.hidden);
            grupo.hidden = cards.length > 0 && !temPedidoVisivel;
        });

        resultado.textContent = termo && cards.length
            ? `${visiveis} pedido(s) encontrado(s)`
            : '';
        resultado.hidden = !termo || cards.length === 0;
    }

    function prepararInterface(root) {
        const iconesIndicadores = {
            entregas_hoje: 'fa-truck',
            aguardando_entrega: 'fa-hourglass-half',
            em_entrega: 'fa-motorcycle',
            prestacao_pendente: 'fa-clipboard-check',
            concluidas_hoje: 'fa-circle-check',
            canceladas: 'fa-ban'
        };
        Object.entries(iconesIndicadores).forEach(([indicador, icone]) => {
            const valor = root.querySelector(`[data-dash="${indicador}"]`);
            const rotulo = valor && valor.parentElement.querySelector('span');
            if (!rotulo || rotulo.querySelector('.ent-kpi__icone')) return;
            const elemento = document.createElement('i');
            elemento.className = `fas ${icone} ent-kpi__icone`;
            elemento.setAttribute('aria-hidden', 'true');
            rotulo.prepend(elemento);
        });

        const titulo = root.querySelector('.ent-topo h4');
        if (titulo) {
            titulo.innerHTML = '<i class="fas fa-motorcycle me-2" aria-hidden="true"></i>Entregas';
        }
        const subtitulo = root.querySelector('.ent-topo small');
        if (subtitulo) {
            subtitulo.textContent = 'Acompanhe pedidos em preparação, entrega e finalização.';
        }

        const topo = root.querySelector('.ent-topo');
        if (topo && !root.querySelector('#buscaPedidosEntrega')) {
            const busca = document.createElement('div');
            busca.className = 'ent-busca';
            busca.innerHTML = `
                <label class="visually-hidden" for="buscaPedidosEntrega">Buscar pedido ou cliente</label>
                <span class="ent-busca__icone" aria-hidden="true"><i class="fas fa-search"></i></span>
                <input id="buscaPedidosEntrega" type="search" class="form-control"
                    placeholder="Buscar pedido ou cliente..." autocomplete="off">
                <button type="button" class="btn btn-outline-secondary" id="limparBuscaPedidosEntrega"
                    aria-label="Limpar busca" title="Limpar busca">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            `;
            topo.insertAdjacentElement('afterend', busca);

            const resultado = document.createElement('div');
            resultado.id = 'resultadoBuscaEntrega';
            resultado.className = 'ent-busca__resultado small text-muted';
            resultado.hidden = true;
            busca.insertAdjacentElement('afterend', resultado);

            const input = busca.querySelector('#buscaPedidosEntrega');
            input.addEventListener('input', () => aplicarBusca(root));
            busca.querySelector('#limparBuscaPedidosEntrega').addEventListener('click', () => {
                input.value = '';
                aplicarBusca(root);
                input.focus();
            });
        }

        root.querySelectorAll('#filtrosStatusEntrega button').forEach((button) => {
            button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false');
            if (button.dataset.erpFilterA11yBound === 'true') return;
            button.dataset.erpFilterA11yBound = 'true';
            button.addEventListener('click', () => {
                root.querySelectorAll('#filtrosStatusEntrega button').forEach((filter) => {
                    filter.setAttribute('aria-pressed', filter === button ? 'true' : 'false');
                });
            });
        });
    }

    async function loadEntregasErp() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (typeof global.loadEntregas !== 'function') {
            if (typeof global.showNotification === 'function') {
                global.showNotification('A tela de Entregas não foi carregada corretamente.', 'danger');
            } else {
                document.getElementById('page-content').innerHTML =
                    '<div class="alert alert-danger">A tela de Entregas não foi carregada corretamente.</div>';
            }
            return;
        }

        await global.loadEntregas();
        const root = document.getElementById('telaEntregasOperacional');
        if (!root) return;

        prepararInterface(root);
        const conteudo = root.querySelector('#conteudoEntregas');
        if (conteudo) {
            observer = new MutationObserver(() => {
                prepararInterface(root);
                aplicarBusca(root);
            });
            observer.observe(conteudo, { childList: true, subtree: true });
            aplicarBusca(root);
        }
    }

    global.loadEntregasErp = loadEntregasErp;
})(window);
