# Auditoria do Fluxo Atual de Carga Toledo CDS

Data da Auditoria: 2026-08-17  
Objetivo: Rastrear e documentar o fluxo exato de sincronização de produtos para Toledo Prix IV Uno (90AX)  
Escopo: Código em produção, sem alterações  

---

## 1. Fluxo Encontrado

```
UI ("Sincronizar Tudo" / "Sincronizar Alterações")
  ↓
Frontend: central-equipamentos.js (centralEqSyncRodar)
  ↓
POST /equipamentos/sync/full  ou  /equipamentos/sync/incremental
  ↓
Backend Route: equipamentos.js (router.post)
  ↓
SyncController.syncV15()
  ↓
ToledoSyncService.sync(modo, {produtos, ultimaSync, ...})
  ↓
ToledoSyncPlanner.planFull()  ou  planIncremental()  ou  planDelta()
  ↓
ToledoBatchBuilder.buildFromCarga()
  ↓
ToledoSyncExecutor.executeBatches()
  ↓
Para cada item em cada lote:
  Toledo90AXEngine.execute(comando, item)
    ↓
    ToledoFrameBuilder.build()
    ↓
    TCP send via ConnectionManager
    ↓
    Aguarda resposta (ACK)
    ↓
    ToledoFrameParser.parse()
    ↓
    Retorna resultado
  ↓
ToledoSyncService._executarPlano()
  ↓
Persistir histórico e versão
  ↓
Retornar relatório à UI
```

---

## 2. Origem dos Produtos

### De Onde Vêm os Produtos?

**Origem**: Passados pelo cliente/UI via requisição HTTP POST.

**Arquivo Principal**: `backend/motores/equipamentos/drivers/toledo/sync/SyncController.js` (linhas 158-181)

```javascript
async function syncV15(req, res) {
  const alvo = await resolverAlvo(req);
  const modo = alvo.modo || 'incremental';
  const result = await toledoSyncService.sync(modo, {
    ...alvo,
    confirm: alvo.confirm === true || req.body?.confirm === true,
    produtos: alvo.produtos || alvo.cds || alvo.listaCds,
    ultimaSync: alvo.ultimaSync || alvo.balanca || alvo.snapshot,
    // ...
  });
}
```

**Campos esperados no corpo da requisição:**
- `produtos` (ou `cds` ou `listaCds`) — Array de produtos CDS
- `ultimaSync` (ou `balanca` ou `snapshot`) — Array de produtos da última sincronização bem-sucedida (snapshot)
- `host` — IP da balança
- `porta` — Porta TCP da balança

**Tabela não consultada**: O sistema NÃO faz query no banco de dados durante o sync. Os produtos são enviados pelo cliente já montados.

**Filtros aplicados**: NENHUM durante o sync. Todos os produtos passados são processados conforme o modo (full/incremental/delta).

**Resposta à pergunta**: Quando é solicitada sincronização de 1 produto, o sistema **carrega aquele 1 produto apenas**. O tamanho do conjunto dependee exclusivamente do que é enviado na requisição.

---

## 3. Carga Full

Quando "Sincronizar Tudo" é executado:

**Modo**: `full`  
**Planner**: `ToledoSyncPlanner.planFull(produtosCds, ultimaSyncOuBalanca)`

**O que faz**:
1. Ignora completamente o snapshot anterior (ultimaSync/balanca)
2. Marca TODOS os produtos CDS como `selecionado=true`
3. Compara cada um com o snapshot anterior apenas para marcar a situação:
   - Se não existe no snapshot → NOVO
   - Se existe e mudou → ALTERADO
   - Se existe e não mudou → IGUAL
4. **Todos** os produtos (NOVO + ALTERADO + IGUAL) ficam com `acao=ENVIAR`

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner.js` (linhas 62-95)

```javascript
function planFull(produtosCds = [], ultimaSyncOuBalanca = []) {
  const itens = (Array.isArray(produtosCds) ? produtosCds : []).map((p) => {
    const plu = String(p.plu != null ? p.plu : p.codigo || '');
    const prev = balMap.get(plu);
    const situacao = !prev ? SITUACAO.NOVO : (mudou(p, prev) ? SITUACAO.ALTERADO : SITUACAO.IGUAL);
    return {
      plu,
      situacao,
      acao: ACAO.ENVIAR,  // ← TODOS RECEBEM ENVIAR
      cds: p,
      selecionado: true,
      // ...
    };
  });
  return {
    modo: MODOS.FULL,
    itens,
    resumo: {
      total: itens.length,
      aExecutar: itens.length,  // ← TODOS VÃO EXECUTAR
      // ...
    },
    carga: {
      plus: itens.map((i) => i.cds),
      departamentos: extrairDepartamentos(itens.map((i) => i.cds)),
      precos: itens.map((i) => ({ plu: i.plu, preco: i.cds.preco, ... })),
      etiquetas: itens.filter(...).map(...)
    }
  };
}
```

**Exemplo com 102 produtos**:
- Produtos preparados: 102
- Departamentos únicos: ~5-10 (dependendo do cadastro)
- Preços: 102 (um por produto)
- Etiquetas: 102 (se definidas)

**Lotes (com tamanho padrão = 10)**:
- 1 lote de departamentos (~1 lote com 5-10 itens)
- 11 lotes de PLUs (11 × 10 produtos)
- 11 lotes de preços (11 × 10)
- 11 lotes de etiquetas (se aplicável)

**Frames aproximados para 102 produtos**:
- Departamentos: ~1 lote × ~5-10 items × 2 frames (TX+RX) = ~10-20 frames
- PLUs: 11 lotes × 10 items × 2 frames = 220 frames
- Preços: 11 lotes × 10 items × 2 frames = 220 frames
- Etiquetas: 11 lotes × 10 items × 2 frames = 220 frames (se houver)
- **Total: ~670-690 frames**

**Sequência 90AX utilizada**:
```
Para cada departamento:
  TX uploadDepartment → RX ACK

Para cada PLU:
  TX uploadPlu → RX ACK

Para cada preço:
  TX uploadPrice → RX ACK

Para cada etiqueta:
  TX uploadLabel → RX ACK
```

---

## 4. Carga Incremental / Delta

### Incremental

**Modo**: `incremental`  
**Planner**: `ToledoSyncPlanner.planIncremental(produtosCds, ultimaSyncOuBalanca)`

**O que faz**:
1. Chama `planFull()` internamente
2. Filtra itens para deixar apenas: `NOVO` e `ALTERADO`
3. Descarta produtos `IGUAL`

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner.js` (linhas 105-133)

```javascript
function planIncremental(produtosCds = [], ultimaSyncOuBalanca = []) {
  const full = planFull(produtosCds, ultimaSyncOuBalanca);
  const itens = full.itens
    .filter((i) => i.situacao === SITUACAO.NOVO || i.situacao === SITUACAO.ALTERADO)
    .map((i) => ({
      ...i,
      acao: i.situacao === SITUACAO.NOVO ? ACAO.ENVIAR : ACAO.ATUALIZAR
    }));

  return {
    modo: MODOS.INCREMENTAL,
    itens,  // ← APENAS novos + alterados
    resumo: {
      total: full.itens.length,  // total geral
      aExecutar: itens.length,   // apenas os que serão enviados
      // ...
    },
    carga: {
      plus: itens.map((i) => i.cds),  // ← APENAS novos + alterados
      departamentos: extrairDepartamentos(itens.map((i) => i.cds)),
      precos: itens.map((i) => ({ plu: i.plu, preco: i.cds.preco, ... })),
      etiquetas: itens.filter(...).map(...)
    }
  };
}
```

**Pergunta: Se somente 1 produto teve alteração de preço, quantos produtos o CDS prepara para transmissão?**

**Resposta**: APENAS 1 produto.

**Detalhamento**:
```
Se 102 produtos no CDS e apenas PLU '101' alterou:

planIncremental:
  resumo.total = 102
  resumo.aExecutar = 1
  itens = [
    {plu: '101', situacao: ALTERADO, acao: ATUALIZAR, cds: {...}, ...}
  ]

carga:
  plus = [1 produto]  ← APENAS o alterado
  departamentos = [1 departamento]  ← Só se diferente do anterior
  precos = [1 preço]  ← Apenas o preço do alterado
  etiquetas = [0-1 etiqueta]  ← Se houver

Lotes (tamanho 10):
  - 1 lote de departamentos (1 item)
  - 1 lote de PLUs (1 item)
  - 1 lote de preços (1 item)
  - [0-1 lote de etiquetas]

Frames:
  ~6-8 frames total (TX + RX para cada comando)
```

### Delta

**Modo**: `delta`  
**Engine**: `ToledoDeltaEngine.compute(atual, anterior)`

**O que faz**:
1. Cria snapshot hash do estado atual
2. Cria snapshot hash do estado anterior
3. Compara PLU por PLU via hash
4. Identifica: novos, alterados, removidos
5. Detecta tipo de mudança: preço, departamento, etiqueta, etc.

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/sync/ToledoDeltaEngine.js`

**Resultado**: Mesmo que incremental — apenas produtos com mudança.

---

## 5. Formação dos Lotes

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/sync/ToledoBatchBuilder.js`

**Processo**:
```javascript
function buildFromCarga(carga = {}, opcoes = {}) {
  const lotes = [];
  const push = (tipo, itens) => {
    if (!itens || !itens.length) return;
    lotes.push(...build(itens, { ...opcoes, tipo }));
  };
  push(TIPOS.DEPARTAMENTO, carga.departamentos);
  push(TIPOS.PLU, carga.plus || carga.produtos);
  push(TIPOS.PRECO, carga.precos);
  push(TIPOS.PROMOCAO, carga.promocoes);
  push(TIPOS.ETIQUETA, carga.etiquetas);
  return lotes;
}
```

**Sequência fixa**: DEPARTAMENTO → PLU → PRECO → PROMOCAO → ETIQUETA

**Tamanho do lote**: `tamanhoLote` (default 10, configurável)

**Agrupamento**: Produtos NÃO são enviados individualmente. Cada lote contém:
- `quantidade`: número de itens no lote
- `itens`: array de itens
- `tipo`: tipo do lote (PLU, PRECO, etc.)
- `comando`: comando 90AX a executar

**Ordem dos produtos**: Mantém a ordem do array de entrada.

**Frame de início/término**: Não existe frame de início ou término de lote explícito. O próprio TX+RX de cada item constitui a comunicação.

**Confirmação por lote**: Sim. Se todos os items de um lote forem bem-sucedidos, o lote é marcado `confirmed=true`.

---

## 6. Comandos 90AX Utilizados

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/protocol/commands/index.js`

**Comandos usados para sincronização**:

| Dados | Comando | Wire | Timeout | Retries | Aceita |
|-------|---------|------|---------|---------|--------|
| PLU/Produto | `uploadPlu` | 0x05 | 1500ms | 1 | AK |
| Preço | `uploadPrice` | 0x06 | 1500ms | 1 | AK |
| Departamento | `uploadDepartment` | (UD) | 1500ms | 1 | AK |
| Etiqueta | `uploadLabel` | (LB) | 1500ms | 1 | AK |

**Definição do comando**:
```javascript
const uploadPlu = def(OFFICIAL.UPLOAD_PLU.name, OFFICIAL.UPLOAD_PLU.wire, {
  timeoutMs: 1500,
  retries: 1,
  accept: ['AK'],
  buildPayload: (p) => p || {},
  describe: 'Upload PLU'
});
```

**Sequência real (TX ↔ RX)**:

```
Para cada item no lote:

  1. TX uploadPlu(item)
     Aguarda até 1500ms
  2. RX ACK
     [Se timeout → Retry até 1 vez]

  Se item tem preço:
  3. TX uploadPrice(item.plu, item.preco)
     Aguarda até 1500ms
  4. RX ACK

  Se item tem etiqueta:
  5. TX uploadLabel(item.plu, item.etiqueta)
     Aguarda até 1500ms
  6. RX ACK

  [Continua próximo item]
```

---

## 7. Comunicação TCP

**Arquivo**: `backend/motores/equipamentos/connection/ConnectionManager.js`

### Conexão

**Estratégia**:
- Uma conexão TCP por host:porta
- Reusada para TODOS os items do sync
- Não há abertura/fechamento por produto
- Não há abertura/fechamento por lote

**Garantia de conexão**: `ToledoSyncService._garantirConexao()` — assegura que a conexão existe antes de `executeBatches()`.

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncService.js` (linhas 95-109)

```javascript
async _garantirConexao(alvo) {
  const key = {
    equipamentoId: alvo.equipamentoId,
    host: alvo.host,
    porta: alvo.porta
  };
  if (!this.cm.isConnected?.(key)) {
    await this.cm.connect({ ...key, transporte: 'ethernet', persistir: alvo.persistir !== false });
  }
  this.engine.bind(key);
  return key;
}
```

### Envio e Resposta

**Arquivo**: `backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine.js`

**Fluxo por item**:
1. `engine.execute(comando, payload, opcoes)` — enqueue na OperationQueue (FIFO por host:porta)
2. `_executeOnce()` — executa sequencialmente
3. `frameBuilder.build()` — monta frame TX com STX, comando, payload, checksum, ETX
4. `_enviar(buf)` — send via TCP (ConnectionManager)
5. `_receberFrame(timeoutMs)` — read até timeout (RxBuffer acumula chunks)
6. `frameParser.parse()` — extrai comando, payload, checksum
7. `ackRouter.complete()` — valida ACK
8. Retorna resultado

**Retry**:
- Configurável: `ToledoRetryPolicy` (default 3 tentativas)
- Backoff exponencial: 0ms, 0ms, 0ms (padrão)
- Por item, não por lote

**Timeout**:
- Por comando: 1500ms (padrão)
- Se timeout → throw TimeoutError → Retry
- Após esgotar retries → Marca como erro e continua próximo item

**Reconexão**:
- ConnectionManager: 3 tentativas com backoff [2s, 4s, 8s]
- Se reconexão falhar → erro no sync

---

## 8. Quantidade de Produtos Transmitidos

### Carga Completa (Full)

**Entrada**: 102 produtos CDS

```
planFull(102 produtos, snapshot anterior)
  ↓
resumo.aExecutar = 102
resumo.total = 102

buildFromCarga
  ↓
Lotes:
  - DEPARTAMENTO: 1 lote de ~5-10 deps
  - PLU: 11 lotes de 10 produtos cada = 102 produtos
  - PRECO: 11 lotes de 10 preços = 102 preços
  - ETIQUETA: 11 lotes (se houver etiquetas)
  ↓
Execução:
  - 102 + 102 + 102 + [102 etiquetas] = 306-408 items executados
  - Cada item = 1 execute() = TX + RX
  - Frames: ~612-816 frames (TX + RX)
```

### Carga de 1 Alteração

**Entrada**: 102 produtos CDS, apenas PLU '101' alterou

```
planIncremental(102 produtos, snapshot anterior)
  ↓
resumo.aExecutar = 1
resumo.total = 102
itens.length = 1

buildFromCarga
  ↓
Lotes:
  - DEPARTAMENTO: 1 lote com departamento de '101' (0-1 item)
  - PLU: 1 lote com 1 produto
  - PRECO: 1 lote com 1 preço
  - ETIQUETA: 1 lote (0-1 item)
  ↓
Execução:
  - ~3-5 items executados (PRECO + PLU + [ETIQUETA])
  - Frames: ~6-10 frames (TX + RX)
```

---

## 9. Resposta à Questão Principal

### FLUXO ATUAL DO CDS

```
CDS (interface "Sincronizar Tudo" / "Sincronizar Alterações")
  ↓
SyncController.syncV15()
  ↓
ToledoSyncService.sync(modo, {produtos, ultimaSync, ...})
  ↓
ToledoSyncPlanner (planFull | planIncremental | planDelta)
  ↓
ToledoBatchBuilder.buildFromCarga()
  ↓
ToledoSyncExecutor.executeBatches()
  ↓
Para cada item:
  Toledo90AXEngine.execute()
    ↓
    FrameBuilder + TCP send
    ↓
    Aguarda ACK
    ↓
    FrameParser
    ↓
  ↓
ConnectionManager (reusa conexão TCP)
  ↓
Balança Toledo 90AX
```

### CARGA COMPLETA ("Sincronizar Tudo")

Quando executamos "Sincronizar Tudo" com 102 produtos:

- **Produtos preparados**: 102
- **Lotes totais**: ~34 (11 PLU + 11 PRECO + 11 ETIQUETA + 1 DEPARTAMENTO)
- **Produtos por lote**: 10 (padrão)
- **Comandos por produto**: 2-3 (PLU + PRECO + [ETIQUETA])
- **Frames aproximados**: 612-816 (cada comando = TX + RX)

### CARGA DE 1 ALTERAÇÃO

Quando apenas 1 produto é alterado (ex: preço):

- **Produtos preparados**: 1
- **Lotes totais**: 3-4 (1 PLU + 1 PRECO + 0-1 ETIQUETA + [DEPARTAMENTO])
- **Produtos transmitidos**: 1
- **Frames**: 6-10 (TX + RX para cada comando)

---

## 10. Conclusão

**Escolha que se aplica:**

✅ **Opção 3: O CDS detecta alterações, mas transmite carga completa.**

**Justificativa**:

1. **Em modo FULL**: Transmite 100% dos produtos, independentemente de mudanças
2. **Em modo INCREMENTAL**: Transmite APENAS produtos alterados + novos
3. **Em modo DELTA**: Usa hash para detectar mudanças, transmite apenas diferentes

**Comportamento atual**:
- "Sincronizar Tudo" → `modo='full'` → Todos os 102 produtos
- "Sincronizar Alterações" → `modo='incremental'` → Apenas alterados/novos

**Observação importante**: O modo é escolhido pela UI/Cliente, não automaticamente pelo CDS. O CDS oferece as 3 opções e executa conforme solicitado.

---

## 11. Pontos Que Ainda Precisam Ser Confirmados

### Não Determinado Pelo Código

1. **Comportamento do MGV6**: 
   - Como o MGV6 escolhe entre FULL e INCREMENTAL?
   - Qual é o "Item → Completa" que foi observado nos logs?
   - O MGV6 usa a mesma API ou tem implementação própria?

2. **Handshake e Keep-Alive**:
   - Não encontrada chamada explícita a `handshake()` antes da sync
   - Não encontrada chamada a `keepAlive()` durante a sync
   - A conexão é aberta previamente por ConnectionManager, mas verificar se há polling/heartbeat

3. **Serialização de Campos**:
   - Como exatamente PLU, preço, departamento, etiqueta são serializados no frame TX?
   - Qual é o comprimento de cada campo?
   - Existe padding ou alinhamento?

4. **Validação de Resposta**:
   - O ACK retorna algum dado ou apenas confirma sucesso?
   - Como é diferenciado um "ACK de sucesso" de um "ACK de erro"?

5. **Tratamento de Erro de Comunicação**:
   - Se um item falha após 3 retries, continua para o próximo ou interrompe todo o sync?
   - Atual: Continua (code checks `if (this._cancelled)`)

6. **Limite de Produtos**:
   - Existe limite de quantidade de produtos que podem ser sincronizados em uma única requisição?
   - Existe limite de tamanho de batch?
   - Código não impõe limite explícito

7. **Confirmação da Balança**:
   - A balança confirma recebimento dos produtos de forma persistente?
   - Ou apenas o ACK de cada frame?

### Compatibilidade com Observação MGV6

**Observado**: MGV6 exportava 102 produtos com modo "Completa"

**Análise**:
- ✅ Compatível: CDS pode enviar todos os 102 quando modo='full'
- ✅ Compatível: "Completa" = planFull (todos)
- ⚠️ Diferença: MGV6 parece usar "Item" (individual?) mas modo "Completa" — contraditório no MGV6?

**Conclusão**: Não é possível comparar ainda sem entender como MGV6 gera a label "Item → Completa".

---

## Apêndice: Arquivos Consultados

| Componente | Arquivo | Linhas | Função |
|-----------|---------|--------|--------|
| **UI** | `frontend/erp/js/central-equipamentos.js` | 2135-2175 | `centralEqSyncRodar()` |
| **Route** | `backend/rotas/equipamentos.js` | 89, 103 | POST `/sync` |
| **Controller** | `backend/motores/equipamentos/drivers/toledo/sync/SyncController.js` | 158-181 | `syncV15()` |
| **Service** | `backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncService.js` | 116-180 | `plan()`, `sync()` |
| **Planner** | `backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncPlanner.js` | 62-133 | `planFull()`, `planIncremental()` |
| **Batch** | `backend/motores/equipamentos/drivers/toledo/sync/ToledoBatchBuilder.js` | 1-80 | `buildFromCarga()` |
| **Executor** | `backend/motores/equipamentos/drivers/toledo/sync/ToledoSyncExecutor.js` | 190-390 | `executeBatches()` |
| **Engine** | `backend/motores/equipamentos/drivers/toledo/protocol/Toledo90AXEngine.js` | 150-300 | `execute()`, `_executeOnce()` |
| **Commands** | `backend/motores/equipamentos/drivers/toledo/protocol/commands/index.js` | 1-150 | Definição de comandos |
| **Connection** | `backend/motores/equipamentos/connection/ConnectionManager.js` | 1-150 | Gerenciamento de TCP |

---

**FIM DA AUDITORIA**
