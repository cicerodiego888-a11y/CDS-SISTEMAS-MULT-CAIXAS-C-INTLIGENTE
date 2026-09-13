# HOTFIX MIB-4.0.1 — Migração da busca do Cadastro de Produtos

**Resultado:** Busca tipada do Cadastro de Produtos migrada para SearchSDK → SearchService → ProductProvider → MIB.

Gerado em: 2026-08-04

---

## Antes

```
#buscaProduto (input)
→ aplicarFiltrosProdutos
→ Array.filter (produtoCorrespondeBuscaInteligente)
→ árvore filtrada
```

- Sem debounce
- Sem cancelamento
- Sem SearchSDK / MIB / HotCache / Ranking
- Filtro O(n) no browser sobre `window.produtosCache`
- `GET /api/produtos` apenas na carga (inalterado)

## Depois

```
#buscaProduto (input)
→ debounce 300 ms
→ AbortController (cancela anterior)
→ CdsSearchSDK.search({ entity: 'produto', query })
→ POST /api/search
→ SearchService → ProductProvider → MIB
→ enriquecer hits com cache local (estoque/UI)
→ renderizarArvoreListagemProdutos
```

Ao limpar o campo:

```
restaurarArvoreProdutosOriginal()
→ window.produtosCache (sem reload)
```

Fallback: se SDK/serviço falhar → filtro local + `console.warn`.

---

## O que NÃO mudou

- `loadProdutos()` / `GET /api/produtos`
- Árvore, categorias, subcategorias
- Cadastro / edição / exclusão
- Estoque, validade, promoções
- Zoom / layout visual

---

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `frontend/erp/js/produtos.js` | Busca MIB + debounce + fallback |
| `frontend/shared/js/SearchSDK.js` | Suporte a `AbortSignal` |
| `frontend/erp/js/app.js` | Lazy-load SearchSDK na página produtos |

---

## Evidências de aceitação

| Critério | Status |
|----------|--------|
| Cadastro igual | ✔ |
| Árvore igual (sem texto) | ✔ |
| Apenas busca mudou | ✔ |
| SearchSDK | ✔ |
| SearchService / ProductProvider / MIB | ✔ |
| Debounce 300 ms | ✔ |
| Cancelamento | ✔ |
| Fallback | ✔ |
| Testes `npm run test:mib-produtos` | ✔ |

MemoryCatalog / HotCache / Ranking: ativados no caminho MIB do ProductProvider (mesmo do PDV).

---

## Teste

```bash
npm run test:mib-produtos
```

---

## Origem / Cache

- Origem enviada: `erp-cadastro-produtos`
- Fontes possíveis de resposta MIB: `hotcache`, `cache`, `memoria`, `fuzzy`, `sql` (fallback interno do motor)
