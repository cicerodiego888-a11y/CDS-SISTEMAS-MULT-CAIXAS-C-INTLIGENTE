# MIB-AUDIT-01 — Busca do Cadastro de Produtos

**Pergunta: A busca do Cadastro de Produtos já utiliza o MIB?**

# **NÃO**

Gerado em: 2026-10-03T22:19:22.605Z

> Auditoria somente leitura. Nenhum comportamento do sistema foi alterado.

---

## Etapa 1 — JavaScript da pesquisa

| Item | Valor |
|------|--------|
| Arquivo que inicia | `frontend/erp/js/produtos.js` |
| Evento | jQuery `input` / `change` em `#buscaProduto` (linhas ~1620–1622) |
| Debounce | **Não** |
| fetch/axios/websocket por tecla | **Não** |
| AJAX | Apenas na **carga inicial** `loadProdutos()` → `GET /api/produtos` (~215–228) |

Funções: `aplicarFiltrosProdutos` → `filtrarListaProdutosUI` → `produtoCorrespondeBuscaInteligente` (~1032–1115).

---

## Etapa 2 — Rota

| Contexto | Rota |
|----------|------|
| Digitação na lista | **Nenhuma** (filtro local) |
| Carga da tela | `GET /api/produtos` — `backend/rotas/produtos.js` `router.get('/')` (~554–593) |
| Esperado (MIB) | `GET /api/search` → SearchService → ProductProvider → MIB |

**Contraste PDV (já migrado):** `GET /api/produtos/consulta-pdv/buscar` via `frontend/shared/js/pdvBuscaProduto.js` → SearchService → MIB.

---

## Etapa 3 — Fluxo

### Atual (desvio)

```
loadProdutos → GET /api/produtos (SQL listagem)
→ window.produtosCache
→ #buscaProduto (input)
→ Array.filter (produtoCorrespondeBuscaInteligente)
→ árvore/lista
```

### Esperado

```
Frontend → SearchSDK → SearchService → ProductProvider → MIB → MemoryCatalog/HotCache → Resultado
```

---

## Etapa 4 — SQL legado

**Busca tipada:** não executa SQL.

**Carga inicial** (`GET /api/produtos`):

- `SELECT p.*` + joins — **SIM** usa `SELECT *` (p.*)
- `ORDER BY p.id DESC` — SIM (listagem)
- `LIKE '%texto%'` / `LOWER()` / `REPLACE()` — **NÃO** nesta query
- Impacto da busca: filtro browser `includes` ≈ LIKE %texto% sobre **todos** os produtos já carregados

---

## Etapa 5 — Componentes MIB na busca do cadastro

| Componente | Usa? |
|------------|------|
| MemoryCatalog | NÃO |
| HotCache | NÃO |
| RankingEngine | NÃO |
| LearningEngine | NÃO |
| SearchContext | NÃO |
| SearchSDK | NÃO |
| ProductProvider | NÃO |
| SearchService | NÃO |

---

## Etapa 6 — Campos pesquisados

| Campo | Usa? | Estratégia |
|-------|------|------------|
| Código | SIM | includes |
| Código barras | SIM | includes / dígitos |
| PLU | SIM | includes / dígitos |
| Nome | SIM | normalize + includes |
| NomeBusca | **NÃO** | — |
| Categoria | SIM | includes + select filtro |
| Marca | **NÃO** | — |

---

## Etapa 7 — Benchmark (simulação do filtro client-side, 10k itens × 100)

- **A**: média 5.0368 ms · max 9.6082 · min 4.7362 · origem=`client_side_Array.filter` · cacheHit=false · MIB/HotCache=false
- **AR**: média 5.0149 ms · max 5.4413 · min 4.8581 · origem=`client_side_Array.filter` · cacheHit=false · MIB/HotCache=false
- **ARR**: média 6.3546 ms · max 7.2017 · min 6.1712 · origem=`client_side_Array.filter` · cacheHit=false · MIB/HotCache=false
- **ARRO**: média 6.2838 ms · max 6.5215 · min 6.1168 · origem=`client_side_Array.filter` · cacheHit=false · MIB/HotCache=false
- **ARROZ**: média 6.2383 ms · max 6.537 · min 6.0824 · origem=`client_side_Array.filter` · cacheHit=false · MIB/HotCache=false

Nota: A tela real não chama API a cada tecla; filtra window.produtosCache carregado via GET /api/produtos

---

## Etapa 8 — Consumo por tecla

- Requisições HTTP: **0**
- Consultas SQL: **0**
- Debounce: **não**
- Cancelamento: **não**
- Carga inicial: **1×** `GET /api/produtos` (catálogo completo no browser)

---

## Etapa 9 — Busca antiga / migração (sem implementar)

1. **`frontend/erp/js/produtos.js`** (~1620, 1032–1115)  
   Motivo: filtro client-side. Impacto: alto em catálogo grande; inconsistente com PDV.  
   Migrar: debounce → `CdsSearchSDK.search({ entity: 'produto', query })` → render hits.

2. **`backend/rotas/produtos.js`** (~554–593)  
   Motivo: `SELECT p.*` alimenta o cache local.  
   Migrar busca tipada para `/api/search` (manter listagem se necessário).

Rotas sugeridas: `GET /api/search?entity=produto` **ou** reutilizar `/produtos/consulta-pdv/buscar` com origem ERP.

Estimativa: **impacto médio**, complexidade **média** (1–2 dias).

---

## Etapa 10 — Conclusão

### A busca do Cadastro de Produtos já utiliza o MIB?

# NÃO

Arquivos a alterar: `frontend/erp/js/produtos.js` (+ consumo de `SearchSDK.js` já existente).  
Rotas: passar digitação para `/api/search` (ou consulta PDV MIB).  
SQL a remover da *busca*: nenhum LIKE legado na digitação; o problema é o filtro local + listagem `SELECT p.*`.  
Impacto: médio — alinha ERP Cadastro ao PDV/MIB.

---

*Relatório JSON:* `docs/build/auditoria-busca-cadastro-produtos.json`
