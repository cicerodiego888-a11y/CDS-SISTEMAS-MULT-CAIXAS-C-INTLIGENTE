'use strict';

(function inicializarConfirmacaoConversao(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.CdsComprasConfirmacaoConversao = api;
})(typeof window !== 'undefined' ? window : globalThis, function criarConfirmacaoConversao() {
    const codigosPendenciaRespondiveis = new Set([
        'QTRIB_UNIDADE_ESTOQUE',
        'DIVERGENCIA_QTRIB_FATOR',
        'FATOR_CONVERSAO_AUSENTE'
    ]);

    function gerarChaveItem(item = {}, indiceVisual = 0) {
        const nItem = item.nItem ?? item.nitem ?? item.linha_xml;
        if (nItem !== undefined && nItem !== null && String(nItem).trim() !== '') {
            return `linha:${String(nItem).trim()}`;
        }
        const explicita = [item.item_key, item.itemKey, item.linha_id, item.linhaId]
            .find((valor) => valor !== undefined && valor !== null && String(valor).trim() !== '');
        if (explicita !== undefined) {
            const chave = String(explicita).trim();
            return /^(item|linha|produto|idx):/.test(chave) ? chave : `linha:${chave}`;
        }
        const produtoId = item.produto_id ?? item.produtoId;
        if (produtoId !== undefined && produtoId !== null && String(produtoId).trim() !== '') {
            return `produto:${String(produtoId)}:idx:${indiceVisual}`;
        }
        return `idx:${indiceVisual}`;
    }

    function construirPayloadConfirmado(payloadOriginal, pendencias, decisoes, documentoIdAtual) {
        const docIdBase = payloadOriginal?.central_documento_id || documentoIdAtual || null;
        const chaveAcesso = payloadOriginal?.chave_acesso || null;
        const confirmacoes = pendencias.map((pendencia, indiceVisual) => {
            const itemKey = String(pendencia.item_key || pendencia.itemKey || gerarChaveItem(pendencia, indiceVisual));
            const decisao = decisoes.get(itemKey);
            if (decisao !== true && decisao !== false && decisao !== 'sem-conversao') {
                throw new Error('Escolha uma opção para cada linha pendente.');
            }
            const indiceOriginal = pendencia.central_item_indice ?? pendencia.indice;
            return {
                item_key: itemKey,
                indice: indiceOriginal ?? null,
                central_item_indice: indiceOriginal ?? null,
                nItem: pendencia.nItem ?? pendencia.nitem ?? null,
                documento_id: pendencia.documento_id ?? docIdBase,
                chave_acesso: pendencia.chave_acesso || chaveAcesso,
                confirmacao: decisao === true,
                continuar_sem_conversao: decisao === 'sem-conversao',
                selo_conversao: pendencia.selo_conversao || null
            };
        });

        const documentoId = docIdBase == null ? null : String(docIdBase);
        const confirmaMesmoItem = (anterior) => {
            if (!anterior || typeof anterior !== 'object') return false;
            const docAnterior = anterior.documento_id ?? anterior.central_documento_id ?? anterior.documentoId;
            if (documentoId && docAnterior != null && String(docAnterior) !== documentoId) return false;
            return confirmacoes.some((nova) => (
                (nova.item_key && String(nova.item_key) === String(anterior.item_key || anterior.itemKey || ''))
                || (nova.nItem != null && String(nova.nItem) === String(anterior.nItem ?? anterior.nitem ?? ''))
            ));
        };

        const anteriores = Array.isArray(payloadOriginal?.confirmacoes_conversao)
            ? payloadOriginal.confirmacoes_conversao.filter((anterior) => !confirmaMesmoItem(anterior))
            : [];
        return {
            ...payloadOriginal,
            confirmacoes_conversao: [...anteriores, ...confirmacoes]
        };
    }

    function classificarResposta422(payload = {}) {
        const pendencias = Array.isArray(payload.pendencias)
            ? payload.pendencias
            : (Array.isArray(payload.linhas) ? payload.linhas : []);
        const codigos = pendencias.map((item) => String(item?.codigo || ''));
        const reabrirModal = payload.code === 'PENDENCIAS_CONVERSAO'
            && pendencias.length > 0
            && pendencias.every((item, indice) => (
                item?.estado_decisao === 'PENDENTE'
                && codigosPendenciaRespondiveis.has(codigos[indice])
            ));
        const orientacoes = {
            DECISAO_NOTA_INCORRETA: 'A decisão pertence a outra nota. Confira o documento de origem e tente novamente.',
            DECISAO_LINHA_INCORRETA: 'A decisão não corresponde à linha original da NF-e. Revise a linha na Central.',
            CONFIRMACAO_CONVERSAO_SEM_SELO: 'A confirmação não possui o selo do servidor. Inicie novamente a confirmação da conversão.',
            CONFIRMACAO_CONVERSAO_DESATUALIZADA: 'A linha, o produto ou a conversão mudou. Revise os dados e confirme novamente.',
            CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA: 'A conversão foi recusada e não há quantidade segura para lançar no estoque. Corrija a unidade ou associação antes de tentar novamente.',
            DIVERGENCIA_QTRIB_FATOR: 'A quantidade tributável da NF-e diverge do fator cadastrado para o produto. Confira a unidade e a associação antes de confirmar.',
            FATOR_CONVERSAO_AUSENTE: 'Não há fator de conversão validado para esta unidade. Corrija ou confirme a associação do produto na Central.',
            CONVERSAO_EFETIVA_DIVERGENTE: 'A conversão calculada durante a gravação divergiu da conversão validada. Nada foi gravado; revise a unidade ou associação na Central.'
        };
        const detalhes = [...new Set(codigos.map((codigo) => orientacoes[codigo]).filter(Boolean))];
        const mensagemApi = String(payload.error || 'Não foi possível gravar a compra.');
        return {
            reabrirModal,
            mensagem: [mensagemApi, ...detalhes.filter((texto) => texto !== mensagemApi)].join(' ')
        };
    }

    return { gerarChaveItem, construirPayloadConfirmado, classificarResposta422 };
});
