# RC14.15.14-AUDIT — Auditoria do motor de busca/resolução de produto no PDV

**Status:** SOMENTE LEITURA — CONCLUÍDA  
**Alterações de código:** 0  
**Alterações de banco:** 0  
**Migration:** NÃO  

---

## 0. Veredito executivo

O PDV **não** concatena MIP + MIB na mesma lista quando o MIP encontra o produto. Uma resolução MIP bem-sucedida faz `resultados = [produto]` (um único item).

O fenômeno “Milho Grão vendido + Costela Bovina Código 3 na área de resultado” é explicado, em ordem de probabilidade, por:

1. **Tecla intermediária `"3"`** ao digitar PLU `39` (debounce 220 ms) — MIP resolve **Costela Bovina (PLU 3)** e pinta o dropdown; depois `"39"` resolve **Milho** e substitui a lista.  
2. **Confusão visual** entre dropdown `#listaProdutosPdv` e carrinho `#tabelaItensVendaPdv`.  
3. **Fallback MIB com `plu.includes(termo)`** quando MIP falha — termo `"3"` pode trazer vários PLUs que contêm `3` (3, 39, 103, 12746…).  
4. **Bug de Enter com `match_exato` stale** — Enter pode confirmar o produto ainda em `resultados` (ex.: Costela) mesmo com o campo já em `"39"`, se `ultimoMipBusca.termo` não bater com o termo atual.

**MIP não devolve dois produtos** numa única chamada. O “segundo produto” não nasce de um OR SQL único no identificar.

---

## 1. Fluxo completo (arquivos e funções)

```text
#buscaProdutoPdv (input)
        ↓ input / Enter / btnBuscar
PdvBuscaProduto.onInput / onKeyDown / confirmarEntrada
  (frontend/shared/js/pdvBuscaProduto.js)
        ↓ debounce 220 ms
buscarProdutos(termo)
        ↓
identificarViaMip(termo)
  POST /api/produtos/identificar
  → PdvProdutoIdentificacaoService.identificar
  → ProdutoIdentidadeService.resolve
  → DetectorTipoCodigo + strategies (INTERNO → PLU → …)
        ↓ se encontrado
resultados = [produtoDoMip]  → renderizarLista() → #listaProdutosPdv
        ↓ se NÃO encontrado
buscarConsultaNome(termo)
  GET /api/produtos/consulta-pdv/buscar?q=
  → SearchService / ProductProvider / SearchEngine
  → CatalogSnapshot.filtrar + QueryOptimizer
        ↓
resultados = out.produtos  → renderizarLista()
        ↓ clique / Enter
adicionarProdutoPorCodigo(termo) | adicionarProdutoConsultaPDV(id)
  (frontend/pdv/js/pdv.js)
        ↓
adicionarProdutoPorCodigoViaMip → carrinho (#tabelaItensVendaPdv)
        ↓
limparCampo / fecharLista → resultados = []
```

| Etapa | Arquivo | Função / elemento |
|--------|---------|-------------------|
| Entrada | `frontend/pdv/pages/pdv.html` | `#buscaProdutoPdv` |
| Dropdown resultados | idem | `#listaProdutosPdv` |
| Carrinho | idem | `#tabelaItensVendaPdv` |
| Bind | `frontend/pdv/js/pdv.js` | `bindEventosPDV` → `PdvBuscaProduto.inicializar()` |
| Busca UI | `frontend/shared/js/pdvBuscaProduto.js` | `onInput`, `buscarProdutos`, `identificarViaMip`, `buscarConsultaNome`, `confirmarEntrada`, `renderizarLista` |
| Identificar | `backend/rotas/produtos.js` | `POST /identificar` |
| Serviço MIP | `backend/motores/produto-identidade/services/PdvProdutoIdentificacaoService.js` | `identificar` |
| Detector | `…/core/DetectorTipoCodigo.js` | candidatos: INTERNO antes de PLU |
| PLU | `…/strategies/PluStrategy.js` | `produto_identificadores.tipo='PLU'` |
| Consulta lista | `backend/rotas/produtos.js` | `GET /consulta-pdv/buscar` |
| MIB filtro | `backend/motores/mib/catalog/CatalogSnapshot.js` | `filtrar` (`includes`) |
| MIB SQL | `backend/motores/mib/core/QueryOptimizer.js` | `porCodigo` / `porCodigoBarras` / `porPlu` (exatos, sequenciais) |
| Add carrinho | `frontend/pdv/js/pdv.js` | `adicionarProdutoPorCodigo` → `adicionarProdutoPorCodigoViaMip` |

**Label da UI:** o campo ainda diz “Código de barras / Código interno / Nome” — **não menciona PLU**, embora o MIP trate PLU.

---

## 2. Busca por PLU — regras atuais

### Campo canônico de PLU

- Tabela: `produto_identificadores`
- Critério: `tipo = 'PLU'` + `codigo` (+ variantes com zeros via `variantesPlu`)
- `PluStrategy` **não** usa fallback em `produtos.plu` como fonte de verdade do resolve MIP
- Exibição no dropdown: `produto.plu || produto.codigo_barras || produto.codigo || produto.id`  
  → “Código: **3**” para Costela é, na prática, o **PLU 3** (ou o código interno se PLU ausente no objeto)

### PLU ≠ código interno ≠ EAN

| Identificador | Onde | Estratégia MIP |
|---------------|------|----------------|
| Código interno | `produtos.codigo` / id INTERNO | `InternoStrategy` (**antes** do PLU) |
| PLU | `produto_identificadores` tipo PLU | `PluStrategy` (1–6 dígitos) |
| Barras / EAN | `produtos.codigo_barras` / EAN* | estratégias EAN/GTIN |
| Nome | MIB | só se MIP falhar |

Detector para `"39"` (só dígitos curtos): **INTERNO → PLU → ID**.

### Buscas combinadas?

| Camada | Combinação |
|--------|------------|
| MIP identify | **Uma** resolução; strategies em sequência até achar **um** produto |
| MIB QueryOptimizer | Estratégias **sequenciais** (`codigo`, `barras`, `plu`, `referencia`, `nome_inicia`), merge em `Map` por id (dedup), **não** um único `WHERE OR` gigante |
| MIB CatalogSnapshot | `OR` lógico em memória: nome / codigo / barras / **plu.includes(termo)** / marca |

Prioridade prática no PDV instantâneo: **MIP primeiro; MIB só se MIP não encontrar**.

---

## 3. Casos críticos (conceitual)

| Entrada | Produto esperado (fixtures / docs MGV6) | Observação |
|---------|----------------------------------------|------------|
| PLU **39** | Milho Grão Kg (interno tipicamente 012841) | Distinto de 12746 |
| PLU **3** | Costela Bovina Kg | É o “Código 3” do dropdown |
| PLU **12746** | Milho Grao (SKU diferente do 39) | |
| PLU **99** | TESTE CDS SISTEMAS (fixture TX) | Pode não existir no DB oficial do PDV |

**Regra oficial:** PLU = código do item da balança — **não** EAN / barras / código interno.

Se o operador digita `39` caractere a caractere, o sistema **também** pode resolver `3` no meio do caminho (ver §4).

---

## 4. De onde vem a Costela Bovina (Código 3)?

| Hipótese | Avaliação |
|----------|-----------|
| **A)** SQL atual do identify devolve 2 linhas | **Improvável** — MIP retorna um produto |
| **B)** Resultado anterior | **Provável** — tecla `"3"` ou resposta MIB anterior |
| **C)** Estado frontend não limpo | **Parcial** — `resultados` é **substituído**, não concatenado; mas pode permanecer Costela até a resposta de `"39"` chegar |
| **D/E)** Autocomplete / sugestões | **Sim** — `#listaProdutosPdv` é autocomplete; não é o carrinho |
| **F)** Outra regra de identificação | **Sim para `"3"`** — INTERNO ou PLU 3 → Costela |
| **G)** Duplicado após add | **Não** como merge de arrays; limpeza chama `fecharLista` |
| **H)** Busca não limpa | Possível se add falhar antes de `limparCampo`, ou se o usuário ainda vê o dropdown aberto |

### Hipótese principal (recomendada)

Ao digitar **39**:

1. `3` → após 220 ms → `POST /identificar` com `"3"` → Costela (PLU/INTERNO 3) → dropdown mostra Costela.  
2. `9` → termo `"39"` → identify → Milho → `resultados = [Milho]` (substitui).  
3. Operador adiciona Milho (peso 0,207 kg) no carrinho.  
4. Visualmente: **carrinho = Milho**; **dropdown** pode ainda ter mostrado Costela momentos antes, ou ficar aberto com lixo se a limpeza não rodou / Enter stale.

### Hipótese MIB (quando MIP falha)

`CatalogSnapshot.filtrar`:

```text
plu.includes(termo) || codigo.includes(termo) || ...
```

Termo `"3"` casa PLUs **3, 39, 103, 12746…** → lista com Costela **e** Milho no **mesmo** dropdown.  
Termo `"39"` **não** casa PLU `"3"` via `includes` (direção errada).

---

## 5. Estado do frontend

Estado em `pdvBuscaProduto.js` (módulo IIFE):

| Variável | Papel |
|----------|--------|
| `resultados` | Lista do dropdown |
| `indiceSelecionado` | Item destacado |
| `timerBusca` | Debounce 220 ms |
| `requisicaoAtual` | Descarta paint stale (MIP/MIB) |
| `abortBuscaAtual` | Abort **só** no fetch MIB |
| `ultimoMipBusca` | `{ termo, resultado }` do último MIP da busca |
| `dropdownAberto` | UI |

**Preenchimento:** `buscarProdutos` → MIP → `resultados = [produto]` **ou** MIB → `resultados = out.produtos`.  
**Limpeza:** `fecharLista` / `limparCampo` zeram `resultados` e `ultimoMipBusca`.  
**Replace vs concat:** sempre **substitui**.  
**Add produto:** em geral limpa campo + lista.  
**MIP identify:** **não** é abortado ao digitar de novo (só MIB).

---

## 6. SQL / backend (resumo)

### Identify (MIP)

- Endpoint: `POST /api/produtos/identificar` body `{ codigo, contexto }`
- PLU: lookup em `produto_identificadores` (`tipo='PLU'`, variantes zero-pad)
- **Não** é `WHERE plu=? OR codigo=? OR barras=? OR nome LIKE ?` numa query única do identify

### Consulta PDV (MIB)

- Endpoint: `GET /api/produtos/consulta-pdv/buscar?q=`
- SQL Optimizer: matches **exatos** em sequência (`codigo`, `codigo_barras`, `plu` via JOIN identificadores, prefixo codigo, prefixo nome)
- Contém / `includes`: catálogo em memória (`CatalogSnapshot.filtrar`)

Para busca **explícita por PLU**, o caminho correto é MIP/`PluStrategy` (exato). O MIB genérico **não** deve ser o caminho preferencial de PLU curto.

---

## 7. Duplicidade / race

| Mecanismo | Risco |
|-----------|--------|
| Concat de arrays | Não na lista MIP |
| Merge MIB Map | Dedup por id (ok) |
| Debounce 220 ms | Dispara busca em tecla intermediária |
| `requisicaoAtual` | Evita paint MIB/MIP antigo na lista |
| AbortController | Só MIB — MIP antigo pode ainda completar; paint filtrado por `reqId` |
| Enter + `match_exato` | **Pode confirmar produto stale** se `ultimoMipBusca.termo !== termo` e ainda houver item `match_exato` em `resultados` |
| `inicializar()` sem removeListener | Risco de handlers duplicados se `bindEventosPDV` reexecutar |

Trecho crítico (`confirmarEntrada`):

```text
se ultimoMipBusca.termo === termo → adicionarProdutoPorCodigo(termo)  // correto
senão se resultados tem match_exato → adicionarProdutoSelecionado(exatoApi)  // STALE RISK
```

---

## 8. Eventos ao digitar `39`

| Evento | Handler | Efeito |
|--------|---------|--------|
| `input` (tecla `3`) | `onInput` | agenda `buscarProdutos("3")` em 220 ms |
| `input` (tecla `9`) | `onInput` | cancela timer; agenda `buscarProdutos("39")` |
| Se pausa após `3` | debounce | MIP(+MIB) para `"3"` → Costela |
| `Enter` | `confirmarEntrada` | add via MIP termo ou `match_exato` / seleção |
| Clique item | `onListaClick` | add por termo MIP ou id |
| Botão Buscar | `confirmarEntrada` | idem Enter |

Não há duas buscas “PLU + geral” em paralelo no mesmo `buscarProdutos`: é **MIP depois MIB**.  
Há **múltiplas buscas no tempo** conforme a digitação (3, depois 39).

---

## 9. Resultado da busca × carrinho (fundamental)

| Área | DOM | Papel |
|------|-----|--------|
| Resultados | `#listaProdutosPdv` | Autocomplete / sugestões |
| Carrinho | `#tabelaItensVendaPdv` | Itens da venda |

No exemplo observado:

| | Esperado no diagnóstico |
|--|-------------------------|
| **RESULTADO DA BUSCA** | Após `"39"` estável + MIP OK: **1** produto (Milho). Após `"3"`: **1** (Costela) ou **N** se caiu no MIB `includes`. |
| **CARRINHO** | Tipicamente **1** item vendido (Milho 0,207 kg). Costela **não** precisa ter sido adicionada para aparecer no dropdown. |

**Não confundir** linha do dropdown com item vendido.

---

## 10. Reprodução recomendada (manual / DevTools)

1. Abrir PDV.  
2. Digitar `3`, pausar >220 ms → Network: `identificar` `"3"` → dropdown Costela.  
3. Digitar `9` → `identificar` `"39"` → dropdown só Milho.  
4. Confirmar / pesar → carrinho = Milho.  
5. Observar se Costela ainda aparece no dropdown (não deveria após paint de 39 + limpeza).  
6. Limpar busca; repetir digitando `39` sem pausa.  
7. Repetir com Enter logo após `3`.  
8. Se MIP falhar para 39: observar `consulta-pdv/buscar?q=3` e lista multi-hit.

---

## 11. Respostas objetivas (aceite da auditoria)

1. **Qual função recebe o PLU?**  
   `PdvBuscaProduto.onInput` / `buscarProdutos` / `confirmarEntrada` → `identificarViaMip` / `adicionarProdutoPorCodigo`.

2. **Qual função consulta o produto?**  
   Backend: `PdvProdutoIdentificacaoService.identificar` → `ProdutoIdentidadeService.resolve` (`PluStrategy` / `InternoStrategy`). Fallback: MIB `SearchService.search` via `/consulta-pdv/buscar`.

3. **Qual consulta SQL?**  
   Identify: lookup tipado em `produto_identificadores` (PLU/INTERNO/…).  
   MIB lista: `QueryOptimizer.porPlu` = `JOIN produto_identificadores … pi.codigo = ?` (exato), além de codigo/barras/nome; filtro `includes` no catálogo em memória.

4. **Quais critérios?**  
   MIP: INTERNO → PLU (curto) → …; um produto.  
   MIB: exatos + prefixos SQL + `includes` em memória.

5. **Por que o segundo produto aparece?**  
   Quase certamente **Costela PLU 3** via tecla intermediária `"3"` e/ou MIB substring `"3"`, e/ou confusão dropdown×carrinho — **não** porque identify de `"39"` devolva dois SKUs.

6. **Backend ou frontend?**  
   Ambos: backend resolve `"3"` corretamente como Costela; frontend **agenda** essa busca no debounce e **exibe** no autocomplete.

7. **Resultado antigo?**  
   Pode ser paint intermediário ou `match_exato` stale no Enter — não merge permanente de arrays.

8. **Duplicado?**  
   Não no sentido de concat MIP+MIB no sucesso MIP.

9. **Busca concorrente?**  
   Sequencial no tempo (debounce); race residual no Enter/`match_exato` e MIP sem abort.

10. **Entra no carrinho?**  
    **Não necessariamente.** No exemplo típico Costela está no **resultado/dropdown**; Milho no **carrinho**. Validar sempre as duas áreas.

11. **Correção mínima necessária (não implementar nesta RC):**  
    - Em busca numérica curta (PLU/código): **somente match exato** de identificador; não usar `plu.includes` / `codigo.includes` para termo só dígitos.  
    - Invalidar `match_exato` / `resultados` quando `termo` atual ≠ termo que gerou a lista; Enter não deve confirmar stale.  
    - Opcional UX: debounce maior / não buscar até Enter para códigos curtos / limpar dropdown ao mudar dígitos.  
    - Abortar ou ignorar identify em voo quando o termo do input mudar (além do `reqId` de paint).  
    - Ajustar label do campo para incluir PLU.  

    **Não criar** novo identificador, campo, tabela ou resolver paralelo.

---

## 12. O que NÃO foi alterado

- Código de produção: **0**  
- Banco / schema / migrations: **0**  
- Motor Comercial, Preços, estoque, fiscal, balança, MGV6, TCP: **intocados**  

---

## 13. Entrega

**RC14.15.14-AUDIT — SOMENTE LEITURA**

Documento: `docs/build/rc141514-auditoria-busca-plu-pdv.md`
