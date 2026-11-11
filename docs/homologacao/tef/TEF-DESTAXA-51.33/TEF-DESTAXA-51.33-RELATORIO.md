# TEF-DESTAXA-51.33 — Recuperação controlada do CDS

**Data:** 2026-11-10 ~15:42–15:43 BRT  
**Tipo:** inicialização + diagnóstico (sem operação financeira)  
**Objetivo:** backend + PDV ativos; ambiente preparado para futura comunicação Destaxa (NativeHost **não** iniciado).

---

## 1. Etapa 1 — Pré-verificação (estado inicial)

| Item | Resultado |
| --- | --- |
| Timestamp | 2026-11-10T15:42:20-03:00 |
| V$PagueClient | **UP** — PID **20760**, StartTime 15:36:59 |
| Porta **60603** | LISTENING → PID 20760 |
| Porta **60906** | LISTENING → PID 20760 |
| Porta **3001** | **Livre** (sem LISTENING) |
| Electron/PDV | Ausente |
| Gate | `DESTAXA_REAL_TRANSACTION_ENABLED` **unset** |
| Ação sobre V$Pague | **Nenhuma** (não reiniciado) |

---

## 2. Etapa 2 — Inicialização do backend

### Comando oficial identificado

No CDS homologado, o backend HTTP **não** possui script npm separado de “somente backend” para o PDV. O caminho oficial do workspace é:

`.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local`

Internamente (`electron-common.js` → `iniciarBackendLocal`):

1. `--cds-forcar-local` força modo local porta **3001**  
2. Provisiona chave TEF via `safeStorage` Electron  
3. `require('./backend/server')` → HTTP LISTENING  
4. Em seguida abre a janela PDV em `/login`

**Não** foi usado `node backend/server.js` isolado (não é o fluxo oficial do PDV; depende do contexto Electron/TEF).

### Resultado backend

| Item | Valor |
| --- | --- |
| Backend | **Iniciado** |
| PID listener `:3001` | **10292** (processo Electron principal) |
| Boot | `{"tag":"BOOT","evento":"HTTP LISTENING","ms":581,"port":3001}` |
| `GET http://127.0.0.1:3001/login` | **HTTP 200** (body ~7177 bytes) |
| `GET http://127.0.0.1:3001/` (follow) | **HTTP 200** → `/login` |
| Config produção | **Não** alterada |

---

## 3. Etapa 3 — Inicialização do PDV

| Item | Valor |
| --- | --- |
| Comando | `.\node_modules\.bin\electron.cmd electron-pdv.js --cds-forcar-local` |
| Electron | **Iniciado** — PID **10292** |
| CommandLine | `...\electron\dist\electron.exe electron-pdv.js --cds-forcar-local` |
| Modo | `Modo local forçado via argumento --cds-forcar-local` |
| loadURL | `http://127.0.0.1:3001/login?modulo=pdv&estacao_hostname=DESKTOP-4B8AMM3` |
| Tela de login | **Disponível** (HTTP 200 + loadURL `/login`) |
| Comunicação PDV↔backend | **OK** (mesmo host `127.0.0.1:3001`) |
| Venda / pagamento | **Não** iniciados |

---

## 4. Estado Destaxa (preservado)

| Item | Estado |
| --- | --- |
| V$PagueClient | PID **20760** (inalterado desde 15:36:59) |
| 60603 | LISTENING → **20760** |
| 60906 | LISTENING → **20760** |
| NativeHost | **NONE** (não iniciado) |
| Gate financeiro | **OFF** (unset) |

---

## 5. Bloqueios encontrados

| Bloqueio | Severidade |
| --- | --- |
| Nenhum bloqueio à recuperação CDS nesta sprint | — |
| NativeHost / handshake Destaxa | **Fora de escopo** (aguarda autorização PO futura) |
| CRT / TX / COM4 | **Proibidos** — não executados |

Observação arquitetural (não bloqueio): Etapa 2 “somente backend” e Etapa 3 “PDV” compartilham o **mesmo** processo Electron oficial; não há entrypoint homologado de backend PDV sem Electron.

---

## 6. Classificação da entrega

| Item | Status |
| --- | --- |
| Backend | **Iniciado** |
| HTTP `:3001` /login | **200** |
| PDV | **Iniciado** |
| Comunicação PDV/backend | **OK** |
| V$PagueClient | **UP** (20760) |
| Portas 60603 / 60906 | **LISTENING** (20760) |
| NativeHost | Não iniciado |
| CRT | Não executado |

### **Classificação final: READY**

CDS (backend + PDV) recuperado e respondendo; Client Destaxa preservado com Background/60906. Ambiente pronto para sprint futura de handshake (com autorização PO), **sem** operação financeira nesta entrega.

---

## 7. Proibições cumpridas

Não executado: NativeHost; `iniciaClientDestaxa`; `TX_*`; CRT; COM4; PIX/débito/crédito; habilitar gate; alteração de banco nesta sprint; eventos fiscais/SEFAZ; reinício/encerramento do V$PagueClient; alteração `.conf` Destaxa; alterações no PDV Universal.

FIM DO RELATÓRIO TEF-DESTAXA-51.33.
