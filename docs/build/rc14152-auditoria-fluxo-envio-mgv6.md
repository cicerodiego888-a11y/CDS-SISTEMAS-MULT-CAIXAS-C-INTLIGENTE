# RC14.15.2 — Auditoria profunda do fluxo de envio para balança

**Tipo:** Sprint de auditoria — somente leitura  
**Data:** 2026-08-10  
**Status:** CONCLUÍDA  
**Escopo:** descobrir o pipeline real do botão operacional vs Bridge MGV6 (RC14.15.1)

> Nenhum código de produção (Driver / Connection / Protocol / PLU TCP / MGV6) foi alterado nesta RC.  
> Este documento é o único artefato criado.

---

## 1. Resumo executivo

Quando o usuário clica em **Enviar Selecionados** na tela **Enviar Produtos para Balança**, o CDS executa **exclusivamente o pipeline TCP Toledo (90AX)**:

```
UI epbEnviarSelecionados
 → POST /api/equipamentos/:id/upload-plus
 → PluController.uploadPlus
 → ConnectionManager.connect (TCP)
 → ToledoPluEngine.uploadMany
 → ToledoOperationEngine._ensureDriver
 → ToledoPrixIVDriver.connect
 → handshake() (90AX)
 → UploadPluOperation (só se handshake OK)
```

O log observado:

```
Iniciando envio de 1 produto(s) pesável(is)…
⏳ TESTE CDS SISTEMAS enviada
❌ Produto não enviado
• Timeout aguardando resposta de handshake
Finalizado
```

**casa byte a byte** com strings do frontend TCP (`enviar-produtos-balanca.js`) e com a mensagem gerada no Driver/Motor 90AX — **não** com o Bridge MGV6.

### Respostas objetivas

| Pergunta | Resposta |
|----------|----------|
| Qual pipeline o botão usa? | **TCP / ToledoPrixIVDriver / handshake** |
| `MGV6SyncService` participa? | **NÃO** |
| Por que o timeout de handshake? | Driver pediu ACK de handshake via TCP e a balança **não respondeu** no timeout (5s) |
| MGV6 está na UI operacional de envio? | **NÃO** — só na seção de cadastro em `equipamentos.js` |

**Veredito:** **A + B** — UI operacional ainda ligada ao TCP; MGV6 existe como API/infraestrutura, mas **não está conectado** à ação “Enviar produto para balança”.

---

## 2. Fluxo real do botão

### Tela / botão

| Item | Evidência |
|------|-----------|
| Página | `frontend/erp/js/enviar-produtos-balanca.js` |
| Título | “Enviar Produtos para Balança” (L445) |
| Botão | `#epbBtnEnviar` — “Enviar Selecionados” (L493) |
| Evento | `click` → `epbEnviarSelecionados()` (L537) |
| Comentário oficial | L1–4: chama `POST /api/equipamentos/:id/upload-plus` via `ToledoPluEngine` |

### Strings do log do usuário (prova de UI)

| Log | Arquivo | Linha | Função |
|-----|---------|-------|--------|
| `N produto(s) pesável(is) carregado(s).` | `enviar-produtos-balanca.js` | 335 | `epbCarregarProdutos` |
| `Iniciando envio de N produto(s)…` | idem | 354 | `epbEnviarSelecionados` |
| `⏳ NOME enviada` | idem | 366 | loop de envio |
| `❌ Produto não enviado` | idem | 392 / 407 | tratamento de erro |
| `Finalizado` | idem | 412 | fim do loop |

**Referência a MGV6 neste arquivo:** **0** (grep sem matches).

### Cadeia completa (botão atual)

| # | Etapa | Arquivo | Linha | Função | Entrada | Saída / próxima |
|---|-------|---------|-------|--------|---------|-----------------|
| 1 | Click | `enviar-produtos-balanca.js` | 537 | listener | — | `epbEnviarSelecionados` |
| 2 | Conectar | idem | 299–313 | `epbGarantirConexao` | equipamento selecionado | `POST /equipamentos/connect` |
| 3 | Upload | idem | 373–377 | fetch | `{ plus:[plu], operacao }` | `POST /equipamentos/:id/upload-plus` |
| 4 | Rota | `backend/rotas/equipamentos.js` | 84 | router | — | `PluController.uploadPlus` |
| 5 | Controller | `plu/PluController.js` | 227–324 | `uploadPlus` | plus[], equipamentoId | `connectionManager` + `toledoPluEngine.uploadMany` |
| 6 | TCP prévio | idem | 263–271 | `connectionManager.connect` | host/porta | sessão TCP |
| 7 | Engine PLU | `plu/ToledoPluEngine.js` | 94–225 | `upload` / `uploadMany` | produto | `OperationEngine` + `UploadPluOperation` |
| 8 | Ensure driver | `operations/ToledoOperationEngine.js` | 78–126 | `_ensureDriver` | host/porta | `driver.connect` |
| 9 | Driver | `ToledoPrixIVDriver.js` | 195–309 | `connect` | host/porta | TCP + `handshake()` |
| 10 | Handshake | idem + `Toledo90AXEngine.js` | ~128–132 / ~232 | `handshake` / timeout | frame HS | ACK ou **Timeout** |
| 11 | Upload frame | `UploadPluOperation.js` | — | `execute` | frame EP | **só se handshake OK** |

---

## 3. Stack TCP

```
POST /api/equipamentos/connect
  → ConnectionController.connect
  → connection/ConnectionManager.connect
  → TcpConnection / EthernetTransport
  → socket TCP (porta padrão 9000)

POST /api/equipamentos/:id/upload-plus
  → PluController.uploadPlus
  → ConnectionManager (garante CONNECTED)
  → ToledoPluEngine.uploadMany
  → ToledoOperationEngine._ensureDriver
  → ToledoPrixIVDriver.connect
       → CM.connect (TCP)
       → handshake() via Toledo90AXEngine.execute('handshake')
  → UploadPluOperation (EP)  [não chegou neste caso]
```

**Driver:** `TOLEDO_PRIX4_UNO` / `ToledoPrixIVDriver`  
**ConnectionManager:** `backend/motores/equipamentos/connection/ConnectionManager.js`  
**Socket:** `TcpConnection` (via CM)  
**Timeout handshake:** `ToledoTimeouts.HANDSHAKE = 5000` ms (`ToledoTimeouts.js` L8–9)

---

## 4. Stack MGV6 (RC14.15.1)

```
CDS
 → MGV6SyncService
 → MGV6FileBuilder
 → MGV6Exporter (TXT.tmp → rename)
 → [opcional] MGV6Launcher (autoLaunch)
 → MGV6.exe
 → Balança
```

**Pacote:** `backend/motores/equipamentos/mgv6/`

| Módulo | Papel | Ativo? |
|--------|-------|--------|
| MGV6Configuration | defaults / normalização | infraestrutura |
| MGV6Validator | path / produto / exe | infraestrutura |
| MGV6FileBuilder | produto → registro TXT | infraestrutura |
| MGV6Encoding | WINDOWS-1252 / UTF-8 | infraestrutura |
| MGV6Exporter | gravação atômica | infraestrutura |
| MGV6Launcher | spawn se autoLaunch | infraestrutura (default off) |
| MGV6Repository | config + histórico | infraestrutura |
| MGV6SyncService | orquestração | **só se API chamada** |
| MGV6Controller / Routes | HTTP | montado em `/api/equipamentos/mgv6` |

**Handshake TCP:** inexistente neste stack.  
**Participação no botão “Enviar Selecionados”:** **NÃO**.

---

## 5. Origem do handshake / timeout

### Mensagem exata

`Timeout aguardando resposta de handshake`

### Onde nasce

1. **Motor 90AX** — `Toledo90AXEngine.js` ~L232/238:
   - `Timeout aguardando resposta de ${def.name}`  
   - Para comando handshake → texto efetivo: *Timeout aguardando resposta de handshake*
2. **Driver** — `ToledoPrixIVDriver.js` L297–301:
   - no `catch` do handshake pós-TCP, registra no `UploadPipelineAudit` e propaga o erro (fallback da mesma frase).

### Quem chama handshake neste fluxo

```
ToledoOperationEngine._ensureDriver (L91–104)
  → ToledoPrixIVDriver.connect
    → this.handshake() (L289)
      → engine.execute('handshake')
```

Comentário no código (L91): *“Driver.connect sempre dispara handshake após TCP”*.

### Por que aparece no log da UI

1. Handshake falha / timeout.  
2. Erro sobe até `uploadPlus` / `uploadMany`.  
3. UI em L392–399 imprime `❌ Produto não enviado` e `• ${msg}`.  
4. Intervalo ~11:09:38 → 11:09:58 (~20s) é compatível com connect + handshake(s)/retries/timeouts em cascata (não prova multi-retry; prova falha pós-“enviada”).

**Classificação:**  
**CONFIRMADO — o botão atual utiliza pipeline TCP e não MGV6.**

---

## 6. Endpoint utilizado (botão)

| Campo | Valor |
|-------|-------|
| Método | `POST` |
| Path | `/api/equipamentos/:id/upload-plus` |
| Payload | `{ plus: [plu], operacao: 'ENVIAR_LOTE' \| 'ENVIAR_TODOS' }` |
| Pré-chamada | `POST /api/equipamentos/connect` (`epbGarantirConexao`) |

**Não chama:** `/api/equipamentos/mgv6/export` nem `export-all`.

---

## 7. Driver / ConnectionManager / socket

| Item | Valor |
|------|-------|
| Driver runtime | `ToledoPrixIVDriver` |
| Código canônico | `TOLEDO_PRIX4_UNO` |
| Protocolo | 90AX (`Toledo90AXEngine`) |
| ConnectionManager | `connection/ConnectionManager` |
| Transporte | Ethernet TCP |
| Porta padrão | `9000` (`ToledoProtocol.PORTA_PADRAO`) |
| Frame de upload | `EP` (`UPLOAD_PLU`) — **não executado** neste incidente (falhou antes) |

---

## 8. Configuração da balança (snapshot do banco oficial)

Consulta read-only em `C:\ProgramData\MercantilFiscal\dados\mercadao.db` no momento da auditoria:

| Consulta | Resultado |
|----------|-----------|
| `SELECT * FROM equipamentos` | **0 linhas** |
| `equipamentos_configuracoes` com `mgv6.config` | **nenhuma** |
| `equipamentos_mgv6_exports` | 1 registro de **teste unitário** (`equipamento_id=999001`, pasta TEMP) |

**Consequência:** não foi possível ler do CDS, neste snapshot, IP/porta/driver reais do equipamento usado às 11:09 nem paths:

- `C:\Program Files (x86)\Toledo do Brasil\MGV6\TXT\`
- `C:\Program Files (x86)\Toledo do Brasil\MGV6\MGV6.exe`

Esses caminhos **não estão registrados** no banco auditado. Podem existir no filesystem / intenção do cliente, mas **não constam** como `mgv6.config` persistido.

### Campos de modo (TCP vs MGV6)

Busca por `modo_comunicacao`, `modo_envio`, `tipo_envio`, `protocolo` (seleção), `transport_mode`, `mgv6_enabled` (coluna): **0 hits**.

**Não existe seletor de modo** no fluxo operacional de envio. Há apenas:

- botão único TCP na tela de envio;
- seção MGV6 **separada** no cadastro da balança (`equipamentos.js`).

---

## 9. Rotas MGV6

Montagem: `backend/rotas/equipamentos.js` L152 → `router.use('/mgv6', MGV6Routes())`.

| Método | Rota | Controller | Service |
|--------|------|------------|---------|
| POST | `/api/equipamentos/mgv6/export` | `MGV6Controller.exportar` | `MGV6SyncService.exportarPorIds` |
| POST | `/api/equipamentos/mgv6/export-all` | `exportarTodos` | `exportarTodos` |
| GET | `/api/equipamentos/mgv6/history` | `historico` | `MGV6Repository.listarHistorico` |
| GET | `/api/equipamentos/mgv6/config/:equipamentoId` | `obterConfig` | `obterConfig` |
| PUT | `/api/equipamentos/mgv6/config/:equipamentoId` | `salvarConfig` | `salvarConfig` |
| POST | `/api/equipamentos/mgv6/test-folder` | `testarPasta` | `testarPasta` |

`autoLaunch` default: **false** → exportação cria TXT; **não** executa `MGV6.exe` salvo configuração explícita.

---

## 10. Integração MGV6 ↔ UI

| UI | Chama MGV6? | Chama TCP upload? |
|----|-------------|------------------|
| `enviar-produtos-balanca.js` | **NÃO** | **SIM** (`upload-plus`) |
| `produtos.js` (envio individual) | **NÃO** | **SIM** (`upload-produto`) |
| `central-equipamentos.js` | **NÃO** (sem refs mgv6) | PLU TCP / sync |
| `equipamentos.js` (cadastro) | **SIM** (config / test-folder / export-all / history) | cadastro + layout |

### O botão “Enviar produto para balança” chama `MGV6SyncService`?

**NÃO.**

O fluxo desvia para TCP em `epbEnviarSelecionados` → `fetch(.../upload-plus)` (L373), que é `PluController.uploadPlus` → `ToledoPluEngine`.

---

## 11. Dois modos? Duplo pipeline?

| Existência | Situação |
|------------|----------|
| Modo TCP oficial | **SIM** — único caminho do botão operacional |
| Modo MGV6 | **SIM** — API + UI de cadastro, **paralelo e desconectado** do botão de envio |
| Seleção TCP vs MGV6 no envio | **NÃO** |
| Clique gera TCP **e** MGV6 juntos | **NÃO** (sem chamada MGV6 no botão) |

**Risco P0 de duplo pipeline no mesmo clique:** **não confirmado**.  
**Risco operacional:** operador espera MGV6, mas o botão usa TCP → handshake timeout (este incidente).

---

## 12. Comparação BOTÃO ATUAL × MGV6

| ITEM | BOTÃO ATUAL | MGV6 |
|------|-------------|------|
| Endpoint | `POST .../upload-plus` | `POST .../mgv6/export` |
| Controller | `PluController.uploadPlus` | `MGV6Controller` |
| Service | `ToledoPluEngine` | `MGV6SyncService` |
| Engine | Operation Engine + 90AX | FileBuilder / Exporter |
| Driver | `ToledoPrixIVDriver` | nenhum |
| ConnectionManager | **SIM** | não |
| TCP | **SIM** | não |
| Handshake | **SIM** (falhou) | não |
| TXT | não | sim |
| MGV6SyncService | **NÃO** | sim |
| MGV6.exe | não | só se `autoLaunch=true` |
| Resultado no incidente | Timeout handshake | **não executado** |

---

## 13. Evidências (checklist)

- [x] Strings do log = `enviar-produtos-balanca.js`
- [x] Endpoint = `upload-plus` (não `mgv6/*`)
- [x] Controller = `PluController.uploadPlus`
- [x] Engine = `ToledoPluEngine` (JSON `engine: 'ToledoPluEngine'`)
- [x] Handshake = `ToledoPrixIVDriver.connect` + `Toledo90AXEngine`
- [x] Mensagem timeout = 90AX / Driver
- [x] Zero referências MGV6 em `enviar-produtos-balanca.js`
- [x] UI MGV6 só em `equipamentos.js` (cadastro)
- [x] Sem campo `modo_envio` / seletor no envio
- [x] Banco oficial sem `mgv6.config` no snapshot

---

## 14. Causa raiz

**Causa raiz do sintoma (timeout):**  
O envio operacional usa o **pipeline TCP**. Após conectar o socket, o `ToledoPrixIVDriver` exige **handshake 90AX**. A balança **não devolveu ACK** dentro do timeout → erro propagado → UI “Produto não enviado”.

**Causa raiz do desalinhamento com a expectativa MGV6:**  
O Bridge MGV6 da RC14.15.1 **não foi ligado** à tela/botão “Enviar Produtos para Balança”. É infraestrutura + API + seção de cadastro; o fluxo que o usuário operou permanece o da RC15.1 (`upload-plus`).

---

## 15. Veredito (categorias)

| Código | Descrição | Aplica? |
|--------|-----------|---------|
| **A** | UI ainda ligada ao TCP | **SIM** |
| **B** | MGV6 implementado sem integração operacional no botão de envio | **SIM** |
| C | Configuração não seleciona MGV6 | Parcial — **não há seletor**; default = TCP |
| D | Dois pipelines no mesmo clique | **NÃO** |
| E | Outro | — |

**Classificação principal: A + B.**

---

## 16. Testes controlados

### A — Botão atual

Não reexecutado contra balança física nesta auditoria (evitar novo handshake/timeout e não alterar estado).  
**Prova por código + strings idênticas ao log 11:09.**

### B — Rota MGV6 direta

Não executada contra pasta de produção: snapshot do banco **sem equipamento** e **sem `mgv6.config`**.  
Histórico MGV6 existente = apenas fixture de teste unitário.

### Testes automatizados

Não foram necessários para comprovar o fluxo; nenhuma suíte foi alterada.

---

## 17. Recomendação para a próxima sprint

1. **Definir produto:** o botão operacional deve (a) continuar TCP, (b) passar a MGV6, ou (c) oferecer seletor explícito TCP | MGV6.  
2. Se a necessidade do cliente é o fluxo legado: **integrar** `enviar-produtos-balanca.js` (e opcionalmente `produtos.js`) a `MGV6SyncService` / `POST .../mgv6/export`, **sem** misturar handshake TCP no mesmo clique.  
3. Persistir no CDS os paths reais do cliente (`TXT` + `MGV6.exe`) em `mgv6.config` por equipamento.  
4. Manter Driver/Connection/Protocol **intocados** até decisão de produto; o timeout de handshake é problema do pipeline TCP, **fora do escopo de “só plugar MGV6”**.  
5. Documentar na UI: “Enviar Selecionados = TCP oficial” vs “Compatibilidade MGV6 = exportação de arquivo”.

---

## 18. Respostas finais (critério de aceite)

**Quando clico em Enviar produto para balança, o CDS executa qual pipeline?**  
→ **Pipeline TCP:** `upload-plus` → `ToledoPluEngine` → `ToledoPrixIVDriver` → `ConnectionManager` → handshake 90AX → (upload EP se OK).

**O MGV6SyncService está ou não conectado a essa ação?**  
→ **NÃO está conectado.**

**Por que aparece “Timeout aguardando resposta de handshake”?**  
→ Porque esse pipeline **exige handshake TCP**; a balança não respondeu a tempo. A mensagem vem do Motor 90AX / Driver — **não** do Bridge MGV6.
