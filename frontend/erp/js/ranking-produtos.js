function formatarRankingProdutosQuantidade(valor, unidade) {
    const numero = Number(valor || 0);
    if (!Number.isFinite(numero)) return '0';
    const texto = Number.isInteger(numero) ? String(numero) : numero.toString();
    return `${texto} ${unidade || ''}`.trim();
}

function loadRankingProdutos() {
    const hoje = new Date();
    const dataInicioPadrao = new Date(hoje);
    dataInicioPadrao.setDate(hoje.getDate() - 6);
    const formatarData = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const html = `
        <div class="card">
            <div class="card-header">
                <strong><i class="fas fa-award"></i> Ranking de Produtos</strong>
            </div>
            <div class="card-body">
                <div class="row g-3 align-items-end">
                    <div class="col-md-3">
                        <label class="form-label">Data inicial</label>
                        <input type="date" id="rankingDataInicio" class="form-control" value="${formatarData(dataInicioPadrao)}">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label">Data final</label>
                        <input type="date" id="rankingDataFim" class="form-control" value="${formatarData(hoje)}">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label">Ordenar por</label>
                        <select id="rankingOrdenarPor" class="form-select">
                            <option value="faturamento">Maior faturamento</option>
                            <option value="quantidade">Maior quantidade vendida</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <button class="btn btn-primary w-100" onclick="gerarRankingProdutos()">
                            <i class="fas fa-chart-bar"></i> Gerar Ranking
                        </button>
                    </div>
                </div>
                <div id="rankingProdutosResultado" class="mt-4"></div>
            </div>
        </div>
    `;

    $('#page-content').html(html);
    gerarRankingProdutos();
}

function gerarRankingProdutos() {
    const dataInicio = $('#rankingDataInicio').val();
    const dataFim = $('#rankingDataFim').val();
    const ordenarPor = $('#rankingOrdenarPor').val() || 'faturamento';

    if (!dataInicio || !dataFim) {
        $('#rankingProdutosResultado').html('<div class="alert alert-warning">Informe as datas para gerar o ranking.</div>');
        return;
    }

    const url = `${API_URL}/vendas/relatorio/produtos-mais-vendidos?data_inicio=${encodeURIComponent(dataInicio)}&data_fim=${encodeURIComponent(dataFim)}&ordenar_por=${encodeURIComponent(ordenarPor)}&limite=50`;

    $('#rankingProdutosResultado').html('<div class="text-center p-4"><div class="spinner-border text-primary"></div></div>');

    $.ajax({ url, method: 'GET' })
        .done(function (res) {
            const produtos = res && Array.isArray(res.produtos) ? res.produtos : [];
            const linhas = produtos.map((p, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(p.nome || '-')}</td>
                    <td>${formatarRankingProdutosQuantidade(p.quantidade_vendida, p.unidade)}</td>
                    <td>${escapeHtml((p.unidade || '').toLowerCase() || '-')}</td>
                    <td>${formatCurrency(p.total_vendido || 0)}</td>
                </tr>
            `).join('') || '<tr><td colspan="5" class="text-center">Nenhum produto encontrado.</td></tr>';

            $('#rankingProdutosResultado').html(`
                <div class="table-responsive">
                    <table class="table table-striped table-hover">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Produto</th>
                                <th>Quantidade</th>
                                <th>Unidade</th>
                                <th>Faturamento</th>
                            </tr>
                        </thead>
                        <tbody>${linhas}</tbody>
                    </table>
                </div>
            `);
        })
        .fail(function () {
            $('#rankingProdutosResultado').html('<div class="alert alert-danger">Erro ao carregar o ranking de produtos.</div>');
        });
}

window.loadRankingProdutos = loadRankingProdutos;
window.gerarRankingProdutos = gerarRankingProdutos;
