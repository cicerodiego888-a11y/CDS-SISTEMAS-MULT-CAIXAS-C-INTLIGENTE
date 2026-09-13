# RC14.15.7-AUDIT — Auditoria definitiva da identidade MGV6 e associação com balança

**Tipo:** SOMENTE LEITURA  
**Data:** 2026-08-10  
**Alterações de código:** **0**  
**Alterações de banco:** **0**  
**Alterações de TXITENS / TCP:** **0**

Esta auditoria documenta o estado **atual do repositório** (pós RC14.15.7 implementada) e compara com evidências do legado (`MGV6_0001` em `.\SQL_MGV7`), sem propor implementação nesta RC.

---

## 1. Status atual

| Item | Estado |
|------|--------|
| Bridge MGV6 | Presente em `backend/motores/equipamentos/mgv6/` |
| Identidade operacional (RC14.15.7) | Prioriza **PLU** → `codigo_balanca` → `codigo_mgv6` (legado) |
| Campo UI “Código MGV6” | **Removido na RC14.15.9** (dados DB `tipo=MGV6` preservados, ignorados no export) |
| Checkbox “Integrar com Balança” | Existe (`produtos.integrar_balanca` + UI); **conectado** ao filtro MGV6 |
| Associação Produto↔Balança (estilo `tbItemBalanca`) | **Não existe** no CDS |
| Pipelines TCP × MGV6 | Exclusivos via `modo_envio` (RC14.15.3) |
| Mensagem antiga “Produto não possui Código MGV6 configurado.” | **Não é mais emitida** pelo backend atual |
| Mensagem atual sem identidade | `Produto "…" marcado para balança, mas sem PLU configurado.` → `MGV6_PRODUCT_PLU_REQUIRED` |

**Veredito resumido:** o CDS deixou de **exigir** `tipo=MGV6`, mas ainda carrega a identidade artificial RC14.15.5 (campo + tipo + testes/fixtures). O legado comprovado usa **`ITN_CODIGO`** (não `ITN_INFO_PLU`) e associação **`tbItemBalanca`**. Há risco de semântica confusa (PLU CDS × ITN_CODIGO × “Gtin” UI) e de fixtures que misturam dois produtos Milho distintos.

---

## 2. Fluxo atual do CDS

```
PRODUTO CDS (cadastro)
  ├─ codigo (interno)          → produto_identificadores.tipo=INTERNO
  ├─ codigo_barras / EAN       → EAN8/EAN13/GTIN
  ├─ plu                       → produto_identificadores.tipo=PLU
  ├─ codigo_mgv6 (opcional)    → produto_identificadores.tipo=MGV6  [RC14.15.5]
  └─ integrar_balanca          → coluna produtos.integrar_balanca
        ↓
modo_envio = MGV6 ?
        ↓ sim
MGV6SyncService.carregarProdutos*
  → SQL: plu, codigo_balanca, codigo_mgv6, integrar_balanca
        ↓
MGV6IdentityResolver
  → filtro Integrar
  → código TX = PLU | codigo_balanca | codigo_mgv6
        ↓
MGV6FileBuilder / MGV6Validator
  → registro 320 chars (DD + bloco9 + preço9 + desc≤50 + pad)
        ↓
MGV6Exporter → TXITENS.TXT (WINDOWS-1252, CRLF fora dos 320)
        ↓
MGV6Launcher (opcional) → MGV6.exe
        ↓
[fora do CDS] importação/carga MGV6 → balança
```

**Não há** passo CDS que grave `tbItens` / `tbItemBalanca`.

---

## 3. Fluxo comprovado do legado

```
ERP legado (cadastro)
  ├─ Código interno (ex.: 012841)
  ├─ “Gtin” na UI (ex.: 39)  ← rótulo UI; NÃO necessariamente GS1
  └─ ☑ Integrar com Balança
        ↓
[processo legado / MGV6 — fora do escopo CDS]
        ↓
SQL MGV6 (MGV6_0001)
  tbItens.ITN_CODIGO = identidade do item no MGV6
  tbItemBalanca: ITN_CODIGO ↔ BAL_CODIGO (+ ITB_ESTADO, ITB_MANUAL…)
  tbBalanca: IP, carga prog/atual, ativa…
        ↓
TXITENS.TXT (importação) e/ou carga TCP interna do MGV6
        ↓
Balança (ex.: 10.0.0.170)
```

**Comprovado no SQL do cliente (esta auditoria):**

| Campo | Milho Grão Kg | Milho Grao |
|-------|---------------|------------|
| `ITN_CODIGO` | **39** | **12746** |
| `ITN_DESCRITIVO` | Milho Grão Kg$#$ | Milho Grao$#$ |
| `ITN_PRECO` | 2,79 | 2,50 |
| `ITN_EAN` | NULL | (não destacado; query filtrava) |
| `ITN_INFO_PLU` | **NULL** | **NULL** |
| `ITN_INFO_PLU2` | **NULL** | **NULL** |
| `ITN_CODIGO_ESPECIAL` | **NULL** | **NULL** |
| Associação | `ITB`/`BAL` = 39 | `ITB`/`BAL` = 97 |
| IP balança | 10.0.0.170 | 10.0.0.170 |
| `BAL_PORTA_COMUNICACAO` | **0** | **0** |
| Carga prog/atual | 83 / 83 | 83 / 83 |

Conclusão forte: no MGV6, o número **39** / **12746** é **`ITN_CODIGO`**, não `ITN_INFO_PLU`. A UI legada “Gtin: 39” alinha com `ITN_CODIGO=39`.

---

## 4. Identidade atual do produto no CDS

### Respostas objetivas (§4 do briefing)

| # | Pergunta | Resposta (código atual) |
|---|----------|-------------------------|
| 1 | De onde vem o código do TXITENS? | `MGV6IdentityResolver.extrairCodigoItemTx` → PLU, senão `codigo_balanca`, senão `codigo_mgv6` |
| 2 | Prioridade | **PLU > codigo_balanca > Código MGV6**. **Não** usa código interno nem EAN |
| 3 | Fallback silencioso EAN/interno? | **Não** (explícito no resolver) |
| 4 | Bloqueia se `tipo=MGV6` ausente? | **Não** (desde RC14.15.7), se houver PLU/`codigo_balanca` |
| 5 | Onde aparece “Código MGV6 configurado”? | **String não encontrada** no backend/frontend atuais; código legado `MGV6_PRODUCT_IDENTITY_REQUIRED` ainda declarado em `MGV6Errors.js` mas **não lançado** pelo resolver |
| 6 | Esse bloqueio é necessário ao legado? | **Não** — legado não tem campo “Código MGV6” |
| 7 | PLU existe no CDS? | **Sim** — `produto_identificadores.tipo='PLU'` + campo UI `#plu` + MIP (`PluStrategy`, TCP upload) |
| 8 | Campos de pesagem/balança | PLU (MIP); tipos `BALANCA`/`CODIGO_BALANCA`/`SCALE` lidos no Sync SQL mas **sem UI dedicada** evidente; `codigo_mgv6` artificial |
| 9 | Checkbox conectado ao MGV6? | **Sim** — filtro em IdentityResolver + Sync SQL; UI em `produtos.js` / `enviar-produtos-balanca.js` |
| 10 | Pesável × Integrar × PLU × enviado MGV6 | Conceitos **distintos** (ver §9) |

### Classificação dos campos de cadastro

| Campo | Classificação | Observação |
|-------|---------------|------------|
| Código interno | **LEGADO REAL / CDS** | `produtos.codigo` + tipo INTERNO |
| Código de barras / EAN | **LEGADO REAL / CDS** | MIP EAN/GTIN; **não** entra no TX MGV6 |
| PLU | **LEGADO REAL no CDS** (MIP); no SQL MGV6 `ITN_INFO_PLU` estava NULL | Usado pelo Bridge como código do item TX |
| codigo_balanca (tipos BALANCA…) | **INFERIDO / parcial** | Lido no Sync; sem fluxo UI completo auditado |
| Código MGV6 | **CRIADO PELO CDS (RC14.15.5)** | Redundante se PLU = ITN_CODIGO; fallback retrocompat |
| Integrar com Balança | **LEGADO REAL (conceito)** + coluna CDS `integrar_balanca` | Necessário operacionalmente; no legado implica associação |

---

## 5. Identidade comprovada no MGV6

| Conceito | Coluna / tabela | Evidência |
|----------|-----------------|-----------|
| Código do item | `tbItens.ITN_CODIGO` | 39 e 12746 |
| Descrição | `ITN_DESCRITIVO` | sufixo `$#$` observado |
| Preço | `ITN_PRECO` | 2,79 / 2,50 |
| PLU info MGV6 | `ITN_INFO_PLU` / `PLU2` | **NULL** nos dois Milhos |
| EAN MGV6 | `ITN_EAN` | NULL no item 39 |
| Associação à balança | `tbItemBalanca` | `ITN_CODIGO` → `BAL_CODIGO` |
| Balança | `tbBalanca` | IP 10.0.0.170; porta comunicação **0**; carga 83 |

**Inferido (forte):** o valor que a UI do ERP legado chama “Gtin” e que aparece em `CCCCCC` do TXITENS é o **código do item MGV6 (`ITN_CODIGO`)**, não GTIN GS1.

**Não comprovado nesta auditoria:** bytes exatos do TXITENS gerados pelo legado para o item 39 (só há fixtures CDS / amostras anteriores para 12746 etc.).

---

## 6. Caso real do Milho — código 39

| Camada | Valor |
|--------|-------|
| ERP legado UI | Código interno **012841**, “Gtin” **39**, Integrar **SIM**, nome **Milho Grão Kg** |
| SQL MGV6 | `ITN_CODIGO=39`, preço 2,79, `ITN_INFO_PLU=NULL`, associado `BAL_CODIGO=39`, IP 10.0.0.170 |
| CDS atual (capacidade) | Pode representar: `codigo=012841`, `plu=39`, `integrar_balanca=1`, **sem** `codigo_mgv6` |
| Código no builder | Com `plu=39` → bloco TX `000000039` (9 chars = TT+Z+CCCCCC) |
| Exige tipo=MGV6? | **Não** |

Teste automatizado: `tests/equipamentos/rc14157-mgv6-legacy-flow-v1.test.js` (Milho PLU 39).

---

## 7. Caso real do Milho — código 12746

| Camada | Valor |
|--------|-------|
| SQL MGV6 | `ITN_CODIGO=12746`, descrição **Milho Grao**, preço 2,50, associação `BAL_CODIGO=97`, mesmo IP |
| Fixture CDS RC14.15.5 | `codigo_mgv6=12746`, nota antiga “PLU CDS 39 ≠ MGV6 12746” |
| Realidade SQL | São **dois itens distintos** no MGV6 (39 e 12746), não o mesmo produto com dois códigos |

**Divergência documental:** fixtures/testes que tratam 39 e 12746 como o mesmo Milho com dualidade PLU×MGV6 estão **desatualizados frente à evidência SQL**.

CDS atual **consegue** representar dois produtos com PLUs/códigos distintos (dois registros `produto` + dois PLUs). **Não** modela `BAL_CODIGO` 39 vs 97.

---

## 8. Associação Produto → Balança

| Sistema | Modelo |
|---------|--------|
| Legado MGV6 | `Produto (ITN)` → `tbItemBalanca` → `tbBalanca` (estado, manual, carga, IP) |
| CDS | `Produto` → (elegível) → `TXITENS.TXT` → `MGV6.exe` → *(associação ocorre dentro do MGV6, se configurada)* |

No CDS existe apenas:

- cadastro de **equipamento** (IP/porta para modo TCP; config pasta/exe para MGV6);
- log `produto_balanca_sync_log` (histórico de sync TCP/envio — **não** é `tbItemBalanca`).

**Declaração explícita:** o CDS **não** possui equivalente funcional a `tbItemBalanca` / associação persistente produto↔balança para o fluxo MGV6.

---

## 9. Checkbox Integrar com Balança

| Etapa | Situação |
|-------|----------|
| UI | `frontend/erp/js/produtos.js` — `#integrar_balanca` |
| Payload | `integrar_balanca: 0|1` no save |
| Banco | `ALTER TABLE produtos ADD COLUMN integrar_balanca` em `database.js` |
| Rota | Não está em `CAMPOS_PRODUTO_IGNORADOS` → pode persistir na coluna `produtos` |
| Leitura MGV6 | `MGV6SyncService` SQL + `produtoIntegraBalanca` |
| Filtro export | `integrar_balanca=0` → excluído; `1` → exige PLU; `NULL`+pesável → elegível (retrocompat) |
| TCP | Upload TCP usa PLU/pesável; checkbox **não** é a mesma barreira do `garantirModoTcp` |

**Resposta:** o checkbox **controla** a elegibilidade do export MGV6 (não é só visual).  
**Lacuna vs legado:** marcar Integrar no legado implica associação em `tbItemBalanca`; no CDS implica “pode ir no TXT”, **sem** gravar associação SQL MGV6.

### Diferenças conceituais no CDS

| Conceito | Critério atual |
|----------|----------------|
| Produto pesável | `produto_fracionado` / flags peso |
| Integrado com balança | `integrar_balanca=1` (ou NULL+pesável) |
| Com PLU | registro MIP `tipo=PLU` |
| Enviado ao MGV6 | Integrar OK + PLU/código resolvido + `modo_envio=MGV6` + export |

---

## 10. TXITENS.TXT

| Propriedade | Valor atual CDS |
|-------------|-----------------|
| Nome | `TXITENS.TXT` (normaliza `CDS.TXT` → TXITENS) |
| Encoding | WINDOWS-1252 (default) |
| Terminador | CRLF **fora** dos 320 |
| Registro | 320 caracteres |
| Layout documentado | `DD(2) TT(2) Z(1) CCCCCC(6) PPPPPP(6) VVV(3) D1(≤50) + pad` |
| Representação builder | `tipoRegistro(2)` + **código 9** + **preço 9** + desc — byte-compatível; semântica = TT+Z+CCCCCC |
| Código no arquivo | Zero-pad 9 dígitos do código resolvido (ex.: 39 → `000000039` ⇒ CCCCCC=`000039`) |
| Preço | Centavos no bloco 9 (`0`+5 digitos+`000` validade) |
| Descrição | Truncada a **50** chars |
| Padding | Espaços até 320 |

**Semântica:** o “código MGV6 de 9 dígitos” do CDS **não** é entidade do protocolo Toledo TCP; é o bloco posicional `TT+Z+CCCCCC` do layout TXITENS. O código de item real no layout indústria é **CCCCCC (6)**.

---

## 11. Pipeline MGV6

Arquivos: `MGV6Controller` → `MGV6SyncService` → Identity → Builder → Exporter → Launcher.  
Config: pasta TXT, `TXITENS.TXT`, path `MGV6.exe`, `autoLaunch`.  
Log diferencia arquivo gerado / MGV6 iniciado / aguardando carga.  
**Não** chama `/connect`, `upload-plus`, `ConnectionManager`, handshake 90AX.

---

## 12. Pipeline TCP

```
Produto + PLU → PluController → garantirModoTcp → Driver Toledo → ConnectionManager → TCP → balança
```

Bloqueado quando `modo_envio=MGV6`.  
**Não auditado para mudança** — permanece intacto. Suites TCP executadas nesta auditoria: todas **pass**.

---

## 13. Origem do erro “Código MGV6 não configurado”

### Estado histórico (RC14.15.5)

- Código: `MGV6_PRODUCT_IDENTITY_REQUIRED`
- Mensagem típica: ausência de `codigo_mgv6` / `tipo=MGV6`
- Origem: `MGV6IdentityResolver` (versão RC14.15.5)

### Estado atual (pós RC14.15.7) — inspeção de código

| Item | Valor |
|------|-------|
| Arquivo | `backend/motores/equipamentos/mgv6/MGV6IdentityResolver.js` |
| Função | `resolverIdentidade` |
| Condição | Integrar OK **e** `extrairPluBalanca` vazio **e** `extrairCodigoMgv6Legado` vazio |
| Erro lançado | `MGV6_PRODUCT_PLU_REQUIRED` |
| Mensagem | `Produto "{nome}" marcado para balança, mas sem PLU configurado.` |
| UI | `enviar-produtos-balanca.js` loga `Produto marcado para balança sem PLU configurado` se code contém `PLU_REQUIRED` |

**Busca literal** por `Produto não possui Código MGV6 configurado.` no repositório: **0 ocorrências** em `.js` (apenas docs antigos / constante residual).

Se o usuário ainda vê a mensagem antiga em runtime, trata-se de **build/UI desatualizada** ou cache — **não** do backend atual deste workspace.

`PRODUCT_IDENTITY_REQUIRED` permanece em `MGV6Errors.js` e como branch morta em `MGV6FileBuilder` — **resíduo**, não gate ativo.

---

## 14. Testes existentes

Executados nesta auditoria (somente leitura; **sem alteração**):

| Suite | Resultado | Classificação |
|-------|-----------|---------------|
| `test:mgv6-legacy-compat-v1` | 23/23 pass | **Misto**: fixtures 1/2/3/…/12746 = evidência TX; regra “PLU vence 12746” e nota “39≠12746 mesmo produto” = **HIPÓTESE CDS** (SQL mostra 2 itens) |
| `test:mgv6-txitens-v1` | 16/16 | **EVIDÊNCIA LEGADA** (320, CRLF, nome, exclusividade) |
| `test:mgv6-v1` | 21/21 | **Misto** (layout + prioridade PLU = hipótese operacional CDS pós-14.15.7) |
| `test:mgv6-operational-v1` | 19/19 | **EVIDÊNCIA** exclusividade modo + export |
| `test:mgv6-legacy-flow-v1` *(não pedido, existe)* | — | **HIPÓTESE CDS alinhada à UI ERP** (Milho PLU 39) |
| `test:driver-identity` | 11/11 | TCP |
| `test:driver-adapter` | 8/8 | TCP |
| `test:connection-unification` | 13/13 | TCP |
| `test:protocol-unification` | 20/20 | TCP |
| `test:certification-v2` | 10/10 | TCP |

Marcações importantes:

- Fixture `produtos-comprovados.json` nota *“PLU CDS 39 ≠ MGV6 12746”* → **TESTE/DOC BASEADO EM HIPÓTESE CDS** (desmentida como “mesmo produto” pela query SQL).
- Testes que exigem CCCCCC=`012746` a partir só de `codigo_mgv6` → compatibilidade TX **EVIDÊNCIA** de arquivo; semântica de campo UI **HIPÓTESE**.

---

## 15. Divergências CDS × Legado

| Área | CDS atual | Legado comprovado | Divergência |
|------|-----------|-------------------|-------------|
| Identidade | PLU (MIP) priorizado; MGV6 opcional | `ITN_CODIGO`; UI “Gtin” | CDS usa nome “PLU”; MGV6 usa `ITN_CODIGO` (`INFO_PLU` NULL) |
| PLU | Campo/tipo PLU obrigatório se Integrar | `ITN_INFO_PLU` NULL nos Milhos | Rótulo CDS ≠ coluna MGV6; valor 39 coincide com `ITN_CODIGO` |
| Produto | Um SKU CDS com vários identificadores | Dois `ITN_CODIGO` (39 e 12746) para nomes parecidos | Fixtures misturam os dois |
| Balança | Equipamento CDS (IP/porta 9000 TCP) | `tbBalanca` IP 10.0.0.170, porta **0** | Porta MGV6 SQL ≠ porta TCP CDS |
| Associação | Ausente | `tbItemBalanca` | **Maior lacuna estrutural** |
| TXITENS | Gera arquivo 320 | Importa / usa layout CCCCCC | Semântica de 9 dígitos ainda “CDS-named” |
| Exportação | Bridge + autoLaunch | Processo MGV6 + carga | CDS não confirma carga |
| MGV6 | Não escreve SQL MGV6 | Dono de `tbItens`/associação | Correto delimitar responsabilidade |
| Checkbox | Filtra export TXT | Integra + associa | CDS só filtra |

---

## 16. O que precisa ser corrigido (para RC14.15.8 — não implementar aqui)

### COMPROVADO

1. No SQL MGV6, **39** e **12746** são `ITN_CODIGO` de **itens distintos**; `ITN_INFO_PLU` NULL.
2. Associação legado = `tbItemBalanca` + `tbBalanca` (IP 10.0.0.170).
3. CDS **não** modela essa associação.
4. Campo/UI **Código MGV6** / `tipo=MGV6` foi **criado pelo CDS** (RC14.15.5); não existe no cadastro legado mostrado.
5. Após RC14.15.7, o gate ativo é **PLU**, não Código MGV6; mensagem antiga do Código MGV6 **não** está no código atual.
6. Layout TXITENS: item em **CCCCCC (6)**; builder usa pad 9 (TT+Z+CCCCCC).
7. Pipelines TCP e MGV6 permanecem exclusivos; TCP intacto nos testes.

### INFERIDO

1. UI ERP “Gtin: 39” ≡ `ITN_CODIGO` / CCCCCC (não GS1).
2. Para o SKU CDS 012841 / Milho Grão Kg, o valor a exportar no TX é **39** (não 12746).
3. `BAL_CODIGO` 39 vs 97 com mesmo IP: duas linhas de associação/config no MGV6 (detalhe interno MGV6).
4. Checkbox legado “Integrar” ⇒ cria/atualiza associação item-balança **dentro** do ecossistema MGV6/ERP antigo.

### NÃO COMPROVADO

1. Bytes TXITENS gerados pelo legado especificamente para `ITN_CODIGO=39` (preço 2,79).
2. Se o ERP legado gravava o “Gtin” da tela em coluna própria antes de virar `ITN_CODIGO`.
3. Como o MGV6 escolhe `BAL_CODIGO` 39 vs 97.
4. Se `BAL_PORTA_COMUNICACAO=0` implica só carga por arquivo / outro canal.

---

## 17. Plano recomendado para RC14.15.8

**Objetivo:** alinhar semântica CDS ↔ evidência `ITN_CODIGO` + Integrar, **sem tocar TCP**.

### Menor correção necessária

1. **Documentar e padronizar nomenclatura operacional**  
   - O valor exportado no TX = **código do item da balança / MGV6 (`ITN_CODIGO`)**  
   - No CDS, a fonte preferencial continua sendo o identificador já existente **PLU** (campo que o cliente preenche como 39), **desde que** fique claro na UI que esse número é o código do item na balança (não EAN).

2. **Tratar Código MGV6 como legado/redundante**  
   - Manter dados existentes.  
   - Não exigir.  
   - Evitar prioridade invertida.  
   - Atualizar logs/aliases que ainda dizem “Código MGV6” quando a origem é PLU.

3. **Corrigir fixtures/docs que unificam Milho 39 e 12746**  
   - Dois produtos MGV6 distintos.  
   - Caso CDS 012841 → TX **000000039**.  
   - Caso TX histórico 12746 → outro item (“Milho Grao” 2,50).

4. **Integrar com Balança**  
   - Manter como gate de export.  
   - Documentar limite: CDS **não** escreve `tbItemBalanca`; associação permanece responsabilidade do MGV6 após importação.

5. **Não inventar**  
   - Sem EAN→código item.  
   - Sem código interno→código item sem regra explícita.  
   - Sem TCP no fluxo MGV6.  
   - Sem declarar “enviado à balança” só com TXT gerado.

6. **Opcional (fora do mínimo)**  
   - Remover/ocultar UI Código MGV6 só após migração de dados e homologação.  
   - Futuro: espelho de associação produto↔equipamento **somente se** houver requisito de produto; não é necessário para gerar TXITENS.

### Como corrigir sem tocar no TCP

- Alterar apenas `mgv6/*`, UI de produto/envio MGV6, fixtures/docs MGV6.  
- Não modificar `ToledoPrixIVDriver`, `ConnectionManager`, protocolo 90AX, Discovery, Fingerprint, Monitor.

---

## Respostas do critério de sucesso (§17 briefing)

| # | Resposta |
|---|----------|
| 1 | Campo CDS do “PLU real” operacional = `produto_identificadores.tipo='PLU'` (UI `#plu`). No SQL MGV6 o valor 39 está em **`ITN_CODIGO`**, não em `ITN_INFO_PLU`. |
| 2 | Se ausente no cadastro, obter do mesmo número que a UI legada chama “Gtin” / código do item — **não** inventar a partir de EAN/interno. |
| 3 | CDS exigia Código MGV6 por decisão RC14.15.5 (`MGV6IdentityResolver` + tipo MGV6). **Hoje não exige mais**; resíduos de API/UI/constante permanecem. |
| 4 | Legado: item `ITN_CODIGO=39` associado via `tbItemBalanca`; TX usaria CCCCCC=`000039` (inferido pelo layout). |
| 5 | `tbItemBalanca` liga `ITN_CODIGO` a `BAL_CODIGO` (item 39 → bal 39; item 12746 → bal 97), ambos IP 10.0.0.170. |
| 6 | Checkbox marca elegibilidade; no legado implica integração/associação; no CDS só filtra export TXT. |
| 7 | Para Milho Grão Kg (012841 / Gtin 39): **39** no CCCCCC (`000000039` no bloco 9). **Não** 12746. |
| 8 | Errado/residual: identidade artificial MGV6 como conceito obrigatório; fixtures que colapsam 39≠12746 no mesmo SKU; ausência de modelo de associação; nomenclatura PLU vs ITN_CODIGO. |
| 9 | Menor correção: consolidar **um** código de item (PLU CDS = ITN_CODIGO), Integrar como gate, TX 39 para o Milho do cliente, limpar semântica/fixtures — sem TCP. |
| 10 | Isolar mudanças no Bridge/UI/docs MGV6; manter `modo_envio` e `garantirModoTcp`. |

---

## Mapa de dependências (pesquisa repositório)

| Termo | Papel principal |
|-------|-----------------|
| `MGV6IdentityResolver` | Resolve código TX + Integrar |
| `tipo='MGV6'` / `codigo_mgv6` | Identidade artificial RC14.15.5 (fallback) |
| `tipo='PLU'` / `plu` | Identidade operacional atual + TCP/MIP |
| `integrar_balanca` | Gate export MGV6 |
| `MGV6_PRODUCT_IDENTITY_REQUIRED` | Constante residual |
| `MGV6_PRODUCT_PLU_REQUIRED` | Gate atual |
| `TXITENS.TXT` / `CDS.TXT` | Arquivo export (CDS.TXT normalizado) |
| `upload-plus` / TCP | Pipeline **separado**; bloqueado em modo MGV6 |
| `produto_identificadores` | Catálogo MIP (INTERNO, EAN, PLU, MGV6, …) |
| `ProdutoIdentificadoresService` | Dual-write plu + codigo_mgv6 |

---

## Entrega

**RC14.15.7-AUDIT — CONCLUÍDA**

**Relatório:** `docs/build/rc14157-auditoria-identidade-mgv6.md`

**Alterações de código:** 0  
**Alterações de banco:** 0
