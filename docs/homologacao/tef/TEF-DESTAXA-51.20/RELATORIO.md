# TEF-DESTAXA-51.20 — Correção mínima do bootstrap TX_CONTINUE

**Status:** CONCLUÍDA  
**Coleta:** 2026-11-09 ~17:56–17:59 America/Sao_Paulo  
**Autorização:** Product Owner — implementação técnica exclusiva desta sprint  
**Operação financeira:** **NÃO EXECUTADA**  
**Linha `tef_transacoes.id=1`:** **intacta**  
**Gate `DESTAXA_REAL_TRANSACTION_ENABLED`:** **não ativado**

---

## 1. Causa raiz herdada (51.19)

No ciclo automático `TX_START → 99 → TX_CONTINUE` (`display_ack`), `TefManager._criarBootstrapSeguranca` emitia permit para `TX_START`, mas **exigia `_continuidadeCrt`** para qualquer `TX_CONTINUE`.

`_continuidadeCrt` só é marcado em `_persistirSolicitacao99` (path PDV / pós-retorno). No ciclo in-adapter, o Adapter persiste o 99 direto e **não** marca `_continuidadeCrt` → `permit=null` → Client/Host devolvem **`HOST_SECURITY_OPERATION_BLOCKED`** (pré-DLL).

---

## 2. Arquivo e função alterados

| Item | Valor |
| --- | --- |
| Arquivo | `backend/services/tef/TefManager.js` |
| Função | `_criarBootstrapSeguranca` |
| Testes | `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` (ampliado 51.20) |

Nenhuma outra alteração de produção.

---

## 3. Descrição exata da correção

Foi introduzido o predicado `intentCicloAutomaticoContinue`:

- `operation === 'TX_CONTINUE'`
- `intent.allowedOperations` contém **`TX_START`**
- `intent.allowedOperations` contém **`TX_CONTINUE`**

`execucaoAutorizada` passa a ser verdadeira quando:

1. linha ativa + `_emExecucao` + `intent.transactionId` coincide + operação em `allowedOperations` (já existentes); **e**
2. `operation === 'TX_START'` **ou**
3. `continuidadeAtiva && operation ∈ {TX_CONTINUE, TX_FINALIZE}` **ou**
4. **`intentCicloAutomaticoContinue`** (novo atalho 51.20)

O permit emitido continua sendo **novo**, com `permitId` fresco, `operation` e `transactionId` específicos (one-shot no Host).

---

## 4. Comparação anterior × posterior

| Cenário | Antes (51.19) | Depois (51.20) |
| --- | --- | --- |
| Intent completo, `_continuidadeCrt=null`, `TX_START` | permit OK | permit OK |
| Intent completo, `_continuidadeCrt=null`, `TX_CONTINUE` | **permit null → BLOCKED** | **permit novo TX_CONTINUE** |
| Intent completo, `_continuidadeCrt=null`, `TX_FINALIZE` | permit null | **permit null** (inalterado) |
| Intent PDV só CONTINUE/FINALIZE, sem `_continuidadeCrt` | permit null | **permit null** |
| Intent PDV + `_continuidadeCrt` | permit OK | permit OK |
| Permit TX_START reutilizado em CONTINUE | Host BLOCKED | Host BLOCKED |
| Sem intent / tx divergente / fora de `_emExecucao` | permit null | permit null |

---

## 5. Testes executados e resultados

### Específicos 51.19/51.20

```text
node tests/tef/tef-destaxa-51-19-host-security-continue.test.js
→ 16 ok, 0 falhou
```

Cobertura obrigatória:

1. TX_START com intent completo → permit  
2. TX_CONTINUE ciclo automático → permit (legado negava)  
3. Sem intent válido → bloqueado  
4. `transactionId` diverge → bloqueado  
5. Fora de `allowedOperations` → bloqueado  
6. Path PDV sem `_continuidadeCrt` → bloqueado  
7. TX_FINALIZE sem atalho → bloqueado  
8. Permit START não reutilizável  
9. Permit CONTINUE individual / uso único  
10. Host: ausente / divergente / consumido  
11. Transações distintas sem compartilhar permit  
12. Contexto inválido / encerrado → sem permit  

(+ S1/S2 fonte, display_ack, mensagem Host)

### Continuidade mock 51.05

```text
node tests/tef/tef-destaxa-51-05-continuidade-99.test.js
→ 13 ok / 0 falhas
```

---

## 6. Testes de regressão (bootstrap)

### MRT-49 (`mrt-49-bootstrap-seguro-nativehost.test.js`)

| Resultado | Testes |
| --- | --- |
| PASSOU | 1–13, 17–20 (17 testes) |
| FALHOU | 14, 15, 16 — erro **`Chave TEF indisponível`** ao inserir pendência via `tefRepository`/CryptoService |

**Controle:** os mesmos testes 14–16 **falham sem a correção 51.20** (stash do `TefManager.js` + reexecução). Falha **pré-existente** de ambiente criptográfico do harness, **não** regressão do atalho CONTINUE.

Proteções de bootstrap/permit exercitadas (1–13, 17–20) permaneceram PASSOU, incluindo bloqueio de TX_START/CONTINUE/FINALIZE sem permit e sem chamar driver.

### MRT-50 IPC / continuidade 50.7

`mrt-50-child-process-ipc.test.js` e `mrt-50-7-continuidade-99.test.js` interrompem com o mesmo **`Chave TEF indisponível`** no setup de pendências — ambiente, fora do escopo da alteração de `_criarBootstrapSeguranca`.

---

## 7. Hashes SHA256

| Arquivo | SHA256 |
| --- | --- |
| `backend/services/tef/TefManager.js` | `F969747342BECA01E93F4694CF71768F2CF99B8A65B4E86BCB5FFA26EB5A427C` |
| `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` | `F2868D6C7F3C73A7026B69A3E69B1C1C2BB6F82B75BE3B6354B62486A839028A` |

---

## 8. Preservação do fluxo independente do PDV

Confirmado por teste **6** e pela condição: intent com apenas `TX_CONTINUE`/`TX_FINALIZE` **sem** `_continuidadeCrt` → **sem permit**. `continuarAutorizacao` permanece dependente de `_marcarContinuidadeCrt`.

---

## 9. TX_FINALIZE fora do atalho

Confirmado por teste **7**: no intent completo **sem** `_continuidadeCrt`, `TX_FINALIZE` → **permit null**. Somente `TX_CONTINUE` usa `intentCicloAutomaticoContinue`.

---

## 10. Nenhuma operação financeira

Expressamente **não** executados: CRT, TX_* reais, DLL, NativeHost real, COM4, V$Pague, retry, emissão/consumo de autorização excepcional, `DESTAXA_REAL_TRANSACTION_ENABLED=1`.

---

## 11. `tef_transacoes.id=1` intacta

Sem SELECT operacional desta sprint além do herdado; **sem** UPDATE/DELETE/liberação artificial. Status UNKNOWN / PENDING_WITH_EVIDENCE e bloqueio de nova autorização por pendente **não** alterados.

---

## 12. Critérios de conclusão

| Critério | Status |
| --- | --- |
| TX_CONTINUE recebe permit no ciclo automático válido | **OK** |
| Path PDV protegido sem `_continuidadeCrt` | **OK** |
| TX_FINALIZE fora do atalho | **OK** |
| Permits individuais / uso único | **OK** |
| Testes específicos 51.19/51.20 | **16/16** |
| Regressão proteções bootstrap (MRT-49 1–13, 17–20) | **OK** |
| MRT-49 14–16 / MRT-50 crypto harness | Pré-existente — documentado |
| Sem operação financeira / sem escrita id=1 | **OK** |

---

## 13. Conclusão

Corrigida a falha de autorização interna do CDS que bloqueava a continuidade automática Destaxa (`HOST_SECURITY_OPERATION_BLOCKED` por permit ausente de `TX_CONTINUE`), sem liberar `TX_FINALIZE` pelo atalho e sem enfraquecer o path PDV nem o modelo one-shot de permits.

**Próximos passos (exigem nova decisão expressa):** validação operacional controlada / reconciliação de id=1 / eventual CRT — **não** autorizados nesta sprint.
