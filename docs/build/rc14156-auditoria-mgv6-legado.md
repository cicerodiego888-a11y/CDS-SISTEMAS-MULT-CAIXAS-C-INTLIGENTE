# RC14.15.6-AUDIT — Investigação Profunda MGV6 Legado × Bridge CDS

**Tipo:** SOMENTE LEITURA  
**Data:** 2026-08-10  
**Alterações de código / banco / TXITENS / TCP:** **NENHUMA**

---

## Limitações do ambiente de auditoria

| Recurso | Estado neste ambiente |
|---------|------------------------|
| Instância `.\SQL_MGV6` / serviço `MSSQL$SQL_MGV6` | **NÃO EXISTE** aqui (`Error Locating Server/Instance`) |
| Banco `MGV6_0001` (dados reais do cliente) | **NÃO ACESSÍVEL** |
| Serviço SQL encontrado | `MSSQL$SQL_MGV7` (Running) |
| Bancos em SQL_MGV7 | `MGV7_CENTRAL`, `LOJA_TESTE`, … |
| `LOJA_TESTE.tbItens` / `tbItemBalanca` / `tbBalanca` | **Schema presente, 0 linhas** (vazio) |
| `TBR.MGV6.Negocio.dll` / `.config` / `MGV6.SQL` | **NÃO LOCALIZADOS** no disco deste ambiente |
| Pasta `C:\Program Files (x86)\Toledo do Brasil\MGV6\` | **AUSENTE** |
| TXITENS real do cliente no disco | **AUSENTE** (apenas amostras/fixtures/RCs) |

**Declaração obrigatória:**  
Banco legado real (`.\SQL_MGV6` / `MGV6_0001`) **identificado pelo cliente, mas não acessível pelo ambiente de desenvolvimento**.  
DLLs `TBR.MGV6.*` **não disponíveis neste ambiente**.  
A auditoria continua com: schema Toledo em `LOJA_TESTE`, procedures de associação, documentação oficial MGV6, layout TXITENS da indústria (ControlP), amostras TX do cliente nas RCs anteriores, e código atual do Bridge CDS.

---

## 1. Origem do código 12746

### Resposta (níveis de prova)

**12746 no arquivo TXITENS ocupa o campo “Código do Item” (CCCCCC, 6 dígitos → `012746`).**

Isso é **provado pelos bytes** do registro legado citado nas RCs:

```text
01000012746000250000Milho Grao…
```

Releitura pelo layout TXITENS da indústria (não pelo naming do CDS):

| Pos | Campo layout TXITENS | Valor Milho |
|-----|----------------------|-------------|
| 0–1 | DD departamento | `01` |
| 2–3 | TT tipo etiqueta | `00` |
| 4 | Z tipo preço | `0` |
| 5–10 | **CCCCCC código do item** | **`012746` → 12746** |
| 11–16 | PPPPPP preço | `002500` (= R$ 2,50) |
| 17–19 | VVV validade (dias) | `000` |
| 20+ | D1 descritivo (até 50) | `Milho Grao`… |

**Não é GTIN/EAN comercial** no sentido GS1: no schema Toledo (`LOJA_TESTE.tbItens`), `ITN_EAN` é `varchar(12)` **separado** de `ITN_CODIGO` (`int`).

### O que ainda NÃO está provado sem `MGV6_0001` + DLL

Não foi possível executar no banco real:

```sql
SELECT ITN_CODIGO, ITN_EAN, ITN_CODIGO_ESPECIAL, ITN_INFO_PLU, ITN_INFO_PLU2, ITN_DESCRITIVO
FROM tbItens WHERE ITN_DESCRITIVO LIKE '%Milho%';
```

Portanto **não há prova SQL** de que a coluna física seja exatamente `ITN_CODIGO` vs outro espelho.

### Evidência convergente (forte, mas não SQL-row)

Lista do cliente:

```text
012746 - Gtin: 12746 | Milho Grao
```

- Para Milho, o número à esquerda (6 dígitos) **coincide** com o “Gtin”.
- Para Frango: `010623 - Gtin: 1` — **não coincidem**, portanto o rótulo UI “Gtin” **não é** o código interno formatado genérico; é o **código do item na balança** (o que vai em CCCCCC).
- Schema: PK natural do item é `ITN_CODIGO` (int). Hipótese mais forte: **UI “Gtin” = `ITN_CODIGO`**.
- Alternativas **não descartadas sem row real**: `ITN_CODIGO_ESPECIAL`, `ITN_INFO_PLU` (existem no schema).

### Evidência CDS (contraste)

No CDS atual, 12746 só entra no TX se existir `produto_identificadores.tipo='MGV6'` / campo **Código MGV6** (`MGV6IdentityResolver.js`).  
Isso **não** foi encontrado no UX legado (“Integrar com Balança”).

**Conclusão da pergunta 1:**

> **12746 vem do campo “código do item” do layout TXITENS (CCCCCC).**  
> **Evidência:** bytes do TX + layout TXITENS (ControlP / prática PDV→MGV6).  
> **Origem de coluna SQL (`ITN_CODIGO`?):** **não provada neste ambiente** — hipótese forte, aguarda query em `MGV6_0001`.  
> **Não é EAN/GTIN comercial GS1** (schema separa `ITN_EAN`).

---

## 2. Integrar com Balança

### O que o legado mostra na tela

Apenas:

- ☑ **Integrar com Balança**

**Não** existe campo “Código MGV6” na tela mostrada ao cliente.

### O que o schema/procedures comprovam (Toledo / LOJA_TESTE)

Associação item↔balança é modelo de dados de **primeiro nível**:

```text
tbItens (ITN_CODIGO, …)
    ↓ spAssociaitem / spAssociaitens / spAssociaDadosBalancas
tbItemBalanca (ITB_CODIGO, BAL_CODIGO, ITN_CODIGO, ITB_ESTADO, ITB_MANUAL, ITB_DATA)
    ↓
tbBalanca (BAL_CODIGO, IP, porta, carga, ativa, …)
```

Trecho real de `spAssociaitem` (lido via `OBJECT_DEFINITION` em `LOJA_TESTE`):

- parâmetros: `@balanca`, `@espacoLivre`, `@tipoAssociacaoAutomatica`, `@itensManual`
- atualiza `tbItemBalanca.ITB_MANUAL`
- lê flags de `tbConfiguracao` (`CFG_SALVAR_ASSOCIACAO_REALIZACA_MANUALMENTE`, `CFG_DESATIVA_ITEM`)
- distingue associação automática vs manual

`spAssociaDadosBalancas` com `@tipoDado = 3` (Tipo Item) chama `spAssociaItens`.

### O que NÃO foi localizado neste ambiente

- Evento de checkbox do **ERP do cliente** (não-Toledo) que grava “Integrar com Balança”
- Mapeamento exato checkbox ERP → `INSERT tbItens` / `spAssociaitem`
- String UI “Gtin” no binário (DLL ausente)

### Interpretação prudente

No ecossistema MGV6 Toledo, “estar na balança” = **estar em `tbItemBalanca` ligado a `tbBalanca`**, não um campo solto “Código MGV6”.

No ERP do cliente, o checkbox provavelmente significa: **marcar o produto para integração / associação / exportação** — a cadeia exata ERP→MGV6 **não foi lida em código** aqui.

---

## 3. Relação produto × balança

### Modelo comprovado (schema + SPs)

```text
tbItens
  ITN_CODIGO (int) ………… identidade do item no MGV6
  ITN_PRECO, ITN_DESCRITIVO
  ITN_EAN (varchar 12) …… campo EAN separado
  ITN_CODIGO_ESPECIAL
  ITN_INFO_PLU / ITN_INFO_PLU2
  DPT_CODIGO (departamento)
       │
       ▼
tbItemBalanca
  ITB_CODIGO
  BAL_CODIGO  → tbBalanca
  ITN_CODIGO  → tbItens
  ITB_ESTADO
  ITB_MANUAL  (manual vs automática)
  ITB_DATA
       │
       ▼
tbBalanca
  BAL_CODIGO
  TPB_CODIGO (tipo balança)
  BAL_ENDERECO_IP
  BAL_PORTA_COMUNICACAO
  BAL_ATIVA
  BAL_NUMERO_CARGA_ATUAL / BAL_NUMERO_CARGA_PROG
  DPT_CODIGO
  …
```

### Dados reais Milho nesta máquina

**Indisponíveis** (`tbItens` count = 0 em `LOJA_TESTE`).  
Não foi possível demonstrar a linha Milho → `tbItemBalanca` → `tbBalanca` com dados.

### CDS

Não modela `tbItemBalanca`. Exporta lista plana de produtos CDS → um TXT, sem associação multi-balança / departamento / número de carga.

---

## 4. TXITENS — como o legado (indústria) gera / interpreta

### Dois formatos distintos (não confundir)

| Formato | Origem | Uso |
|--------|--------|-----|
| **Itensmgv.txt** | Documentação oficial Toledo MGV6 | Layout nativo de cadastro MGV6 (DD T CCCCCC PPPPPP …) — **diferente** do TXITENS do cliente |
| **TXITENS.TXT** | Padrão de PDVs brasileiros → importação MGV6 | Layout fixo usado pelo cliente / samples |

Fonte oficial Itensmgv: [help.toledobrasil.com — Arquivos de Cadastro](https://help.toledobrasil.com/mgv6/v1_6_/Html_Pages/arquivos_de_cadastro.html).

Fonte layout TXITENS (indústria PDV): fórum ControlP/AtendeSmart — campos:

```text
DD(2) TT(2) Z(1) CCCCCC(6) PPPPPP(6) VVV(3) D1(50) D2(50) + extras → linha tipicamente 320 c/ padding
```

Fluxo operacional típico comprovado na indústria (não no DLL local):

1. ERP/PDV exporta `TXITENS.TXT` para pasta
2. MGV6 configurado com padrão de arquivo = `TXITENS.TXT`
3. Usuário (ou automação) **Importa Itens** no MGV6
4. MGV6 grava em seu SQL / associa balanças
5. MGV6 **transmite carga** à balança (TCP/protocolo próprio — ver tabelas `tbSituacaoCargaTCP`, `tbLogCargaRemotaTCP` no schema)

### Como o CDS interpreta (inferido)

CDS (`MGV6FileBuilder` / docs RC14.15.x):

```text
tipoRegistro(2)=01 + codigo(9) + preco(9)=0ccccc000 + descricao + espaços = 320
```

**Byte-compatível** com o layout TXITENS da indústria **quando**:

- departamento = 01  
- tipo etiqueta = 00  
- tipo preço = 0  
- validade = 000  

mas os **nomes semânticos do CDS estão inferidos** (reparse):

| Bytes | CDS chama | Layout TXITENS indústria |
|-------|-----------|---------------------------|
| `01` | tipoRegistro | DD departamento |
| `000012746` | código MGV6 9 dígitos | TT+Z+CCCCCC |
| `000250000` | preço 0ccccc000 | PPPPPP+VVV |
| desc ≤50 | truncamento legado | D1 (50) |

### Classe/método legado que gera TXITENS

**NÃO LOCALIZADO** (DLL/`MGV6.SQL` ausentes).  
Referências pedidas (`PREPARAR_TX_ITEM_COMPLETO`, `LayoutArquivoItemITENSMGV2/3`, `LayoutArquivoBalancaMGV6`) — **sem evidência em disco aqui**.

---

## 5. Comunicação após o arquivo

### Comprovado no schema Toledo

Existem artefatos de **carga TCP / carga remota**:

- `tbSituacaoCargaTCP`
- `tbLogCargaRemotaTCP`
- `tbHorariosCargaRemota`
- `tbCancelaCarga`
- `BAL_NUMERO_CARGA_ATUAL` / `BAL_NUMERO_CARGA_PROG`

Isso prova que o MGV6 **não termina** em “ler TXT”: há pipeline de transmissão/carga.

### Comprovado no CDS

`MGV6Launcher.launch`:

- `spawn(exe, [], { shell:false, detached:true })`
- **sem argumentos**
- **sem** comando de importação
- **sem** confirmação de carga
- documentado: iniciar exe ≠ produto na balança

### Fluxo real (síntese honestidade)

```text
ERP → TXITENS.TXT → [Importação MGV6] → SQL MGV6 + associações
                 → [Transmissão/Carga TCP do MGV6] → Balança
```

O Bridge CDS cobre **só a primeira seta** (gerar arquivo + opcionalmente abrir exe).  
WCF/WebService citados pelo cliente **não foram inspecionados** (binários ausentes).

---

## 6. Comparação Legado × CDS

| Componente | Legado (evidência) | CDS atual | Igual? |
|------------|-------------------|-----------|--------|
| Identidade | Código do item (`ITN_CODIGO` hipotético / CCCCCC no TX); UI “Gtin” ≠ GS1 | Campo artificial **Código MGV6** (`tipo=MGV6`) | **Não** (modelo diferente) |
| Produto | `tbItens` + deptos + flags | `produtos` + MIP | Parcial |
| Associação balança | `tbItemBalanca` + SPs | Inexistente | **Não** |
| Código no TX | CCCCCC (6) dentro de TT+Z+CCCCCC | “9 dígitos MGV6” (reparse) | Bytes sim / semântica **não** |
| TXITENS | Layout indústria DD/TT/Z/…; nome TXITENS.TXT | Gera TXITENS 320 | Estrutura **parcialmente** |
| Preço | PPPPPP centavos + VVV | `0`+5dig+`000` (equiv. se VVV=000) | Bytes sim / naming inferido |
| Descrição | D1 ~50 chars (indústria + amostra Carne…) | Truncamento 50 | **Compatível** (evidência amostral) |
| Exportação | Importação explícita no MGV6 | Escreve pasta + autoLaunch | **Não** equivalente |
| MGV6 | App + SQL + carga | Só consumidor externo | Parcial |
| Comunicação | Carga TCP/remote no MGV6 | Não faz; TCP CDS é pipeline paralelo | **Não** (de propósito) |
| UX | ☑ Integrar com Balança | Código MGV6 + modo_envio | **Não** |

---

## 7. Tabela: comprovado × inferido × específico CDS

| Regra | Origem | Evidência |
|-------|--------|-----------|
| Nome `TXITENS.TXT` | **Comprovado** (amostras + prática PDV→MGV6) | RCs / fórum ControlP / config MGV6 “padrão de arquivos” |
| 320 caracteres/registro | **Comprovado** (amostras cliente nas RCs) | Fixtures + auditoria 14.15.5 |
| Prefixo `01` | **Comprovado em bytes**; **semântica inferida** no CDS como “tipoRegistro” | Bytes; indústria = departamento |
| “Código 9 dígitos” | **Inferido** (reparse TT+Z+CCCCCC) | Layout TXITENS indústria = 2+1+6 |
| Preço `0ccccc000` | **Inferido** (reparse PPPPPP+VVV com VVV=000) | Amostras alinhadas; naming CDS |
| WINDOWS-1252 | **Comprovado parcialmente** (acentos Pêra nas amostras) | Fixture + encoding CDS |
| CRLF fora dos 320 | **Comprovado** (amostras/fixtures) | RC14.15.4 |
| Truncamento 50 | **Comprovado** (Carne…Alca) + layout D1=50 indústria | Amostra + fórum |
| Campo **Código MGV6** | **Criado para o CDS** (inferência de identidade) | UX legado só “Integrar Balança” |
| `tipo='MGV6'` em `produto_identificadores` | **Criado para o CDS** | RC14.15.5 |
| `MGV6IdentityResolver` | **Criado para o CDS** | RC14.15.5 |
| PLU→código TX (RC antiga) | **Inferido e incorreto** para Milho | PLU 39 ≠ 12746 |
| autoLaunch MGV6.exe = envio | **Inferido / incompleto** | Launcher sem import/carga |
| Separação modo TCP×MGV6 | **Específico CDS** (correto arquiteturalmente) | RC14.15.3 |
| Layout = Itensmgv oficial Toledo | **Não usado pelo Bridge** | Doc oficial ≠ TXITENS cliente |

---

## 8. CONCLUSÃO

### A implementação MGV6 atual do CDS é:

# **PARCIALMENTE COMPATÍVEL**

- **Compatível em bytes** com as amostras TXITENS do cliente (quando departamento=01, etiqueta=00, preço-tipo=0, validade=000, código item e preço corretos, desc ≤50).
- **Incompatível em modelo de identidade/UX** com o legado (campo “Código MGV6” inventado; legado usa código do item + associação balança).
- **Incompleta operacionalmente** (não importa no MGV6 nem transmite carga; só gera arquivo / abre exe).

### O que das RC14.15.x foi inferido vs comprovado

**Comprovado (amostras / indústria):**  
nome TXITENS.TXT, 320+CRLF, WINDOWS-1252, preço centavos alinhado, truncamento ~50, exclusividade TCP×arquivo.

**Inferido (e parcialmente enganoso):**  
“tipoRegistro”, “código MGV6 de 9 dígitos”, “preço 0ccccc000” como campos atômicos; identidade separada obrigatória; autoLaunch ≈ envio.

**Criado só para o CDS:**  
`MGV6IdentityResolver`, `produto_identificadores.tipo=MGV6`, UI Código MGV6, `modo_envio`.

---

## 9. RECOMENDAÇÃO (sem implementar)

**Próxima RC sugerida (após esta auditoria):**

### RC14.15.7 — Homologação com evidência dura (pré-implementação)

1. No **PC do cliente** (com `.\SQL_MGV6` / `MGV6_0001` e DLLs):
   - Query Milho em `tbItens` (todos os campos de código)
   - Join `tbItemBalanca` / `tbBalanca`
   - Localizar no ERP a coluna/flag de “Integrar com Balança”
   - Descompilar/inspecionar `TBR.MGV6.Negocio` por `TXITENS` / `LayoutArquivo*` / `Gtin`
2. Só então decidir se o CDS deve:
   - **A)** mapear `ITN_CODIGO`/código item (não “Código MGV6” separado), ou  
   - **B)** manter identidade explícita só como espelho operacional, alinhada ao checkbox legado
3. Reavaliar semântica do builder (DD/TT/Z/CCCCCC/PPPPPP/VVV/D1) vs naming atual
4. Separar claramente: **exportar TXT** ≠ **importar MGV6** ≠ **transmitir carga**

**Não implementar correção nesta RC.**  
**Não remover ainda** `MGV6IdentityResolver` / Código MGV6 — aguardar evidência SQL+DLL do cliente.

---

## Apêndice A — Comandos executados (somente leitura)

```text
sqlcmd -S .\SQL_MGV6 …     → falha (instância inexistente)
Get-Service *SQL*          → MSSQL$SQL_MGV7 Running
sqlcmd -S .\SQL_MGV7 -E -Q "SELECT name FROM sys.databases"
sqlcmd … -d LOJA_TESTE     → schema tbItens/tbItemBalanca/tbBalanca; COUNT=0
OBJECT_DEFINITION(spAssociaitem|spAssociaitens|spAssociaDadosBalancas)
Busca TBR.MGV6.Negocio.dll / pasta MGV6 → não encontrada
```

## Apêndice B — Fontes externas consultadas (leitura)

- Toledo Help: Arquivos de Cadastro (Itensmgv.txt)
- ControlP/AtendeSmart: layout TXITENS e fluxo importação MGV6
- Docs CDS: `rc14151` … `rc14155*` (estado do Bridge)
