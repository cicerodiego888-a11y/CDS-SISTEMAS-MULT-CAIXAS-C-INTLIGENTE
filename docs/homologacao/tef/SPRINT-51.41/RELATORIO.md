# SPRINT 51.41 — Recuperação do ciclo TEF aprovado

**Data:** 2026-11-10  
**Escopo:** causa raiz do FINALIZE bloqueado após Destaxa 00 (TX id=3); correção de segurança; plano de recuperação **sem escrita** até autorização do PO.  
**Restrições cumpridas:** sem nova CRT; sem TX_START/CONTINUE/FINALIZE manual; sem novo permit; gate OFF; TX 2/3 e venda 66 **não alteradas** nesta sprint.

---

## 1. Causa raiz

No ciclo automático `autorizar` o `TefManager` sobe o NativeHost intent com:

`allowedOperations: ['TX_START', 'TX_CONTINUE', 'TX_FINALIZE']`

Cada operação transacional exige um **permit one-shot** emitido no bootstrap de segurança (`DestaxaNativeHostClient._sincronizarBootstrapSeguranca` → Host `_autorizarOperacaoTransacional`).

A sprint **51.20** liberou permit de `TX_CONTINUE` no ciclo automático **sem** `_continuidadeCrt` (`intentCicloAutomaticoContinue`).  
**`TX_FINALIZE` ficou de fora** de propósito na época — só era autorizado se `_continuidadeCrt` estivesse marcado.

No path in-cycle o Adapter **não** chama `_marcarContinuidadeCrt` (só `_persistirSolicitacao99` no path PDV `/tef/continuar`). Resultado na TX 3:

| Etapa | Permit | Resultado |
| --- | --- | --- |
| TX_START | emitido (`operation === TX_START`) | OK |
| TX_CONTINUE* | emitido (atalho 51.20) | OK → Destaxa **00** |
| Persistência evidências 00 | NSU/autorização/comprovantes | OK |
| **TX_FINALIZE** | **permit=null** (sem `_continuidadeCrt`, sem atalho) | **HOST_SECURITY_OPERATION_BLOCKED** |

Mensagem observada: `TX_FINALIZE sem bootstrap/permit de segurança válido`  
HTTP 422 · `DESTAXA_CICLO_INCONCLUSIVO` · `financialState=UNKNOWN` · `retryAllowed=false`.

**Não** foi perda de contexto entre NativeHost/bridge/adaptador, nem troca de `transactionId`. O Host **9260** (PPID **5700**) e o `transactionId=3` estavam corretos. O bootstrap rodou; o **documento de permit** para FINALIZE simplesmente não foi emitido pela regra 51.20.

---

## 2. Componentes envolvidos

| Componente | Papel |
| --- | --- |
| `TefManager._criarBootstrapSeguranca` | Decide se emite permit por operação |
| `TefManager.autorizar` → `_nativeHostIntent` | Intent completo START/CONTINUE/FINALIZE |
| `DestaxaNativeHostClient.enviar` | Exige `permitAuthorized` antes de IPC transacional |
| `DestaxaNativeHost._autorizarOperacaoTransacional` | Valida permit.operation + transactionId + uso único |
| `destaxaCrtCicloOrquestracao` | Após 00 + evidências, chama `TX_FINALIZE(0)` |
| `DestaxaHostBridge.finalizarTransacaoDestaxa` | Encaminha FINALIZE ao Client |

---

## 3. Correção aplicada (código)

Arquivo: `backend/services/tef/TefManager.js`

Novo atalho **`intentCicloAutomaticoFinalize`**: emite permit one-shot de `TX_FINALIZE` somente quando o intent contém **TX_START + TX_CONTINUE + TX_FINALIZE** (ciclo automático completo), com a mesma `transactionId` em execução.

**Preservado:**
- Path PDV (`allowedOperations` só CONTINUE/FINALIZE) **continua** exigindo `_continuidadeCrt`.
- Permit one-shot por operação (não reutiliza permit de START/CONTINUE).
- Gate financeiro global **OFF** / não afrouxado.
- Sem exceção genérica; sem nova CRT.

Testes atualizados:
- `tests/tef/tef-destaxa-51-19-host-security-continue.test.js` — **18/18 OK**
- `tests/tef/tef-destaxa-51-24-auditoria-fluxo.test.js` — **14/14 OK**

---

## 4. Estado preservado (TX 3) — sem alteração

| Campo | Valor atual |
| --- | --- |
| id | **3** |
| venda_id | **66** |
| valor / tipo | 1,00 / cartao_debito |
| NSU | **2338** |
| autorização | **211139** |
| comprovantes | persistidos (cliente/loja) |
| status | **`pendente`** |
| financialState (resposta) | **UNKNOWN** |
| permit excepcional | `cff48150…` **CONSUMED** |
| gate | **OFF** |
| TX id=2 | intacta (`negado`) |

Payload criptografado em disco; colunas claras já carregam NSU/autorização/comprovantes.

---

## 5. Proposta de recuperação da TX 3 (aguarda GO do PO)

**Nada foi escrito na TX 3 nesta sprint.**

### Evidências da aprovação Destaxa (já existentes)

- Retorno HTTP da CRT: `codigoDestaxa=00`, `estado=SUCCESS`, mensagem “Transacao aprovada”.
- NSU **2338**, autorização **211139**, NSU rede 241255, comprovantes 1ª/2ª via.
- Colunas `tef_transacoes` id=3 já contêm NSU/autorização/comprovantes.
- Logs: CICLO_CRT → RETORNO FINALIZE bloqueado → `TEF_CONFIRMED_SUCCESS_NO_RETRY` → lease inconclusivo.

### Garantias de idempotência

- `idempotency_key=tef-segunda-tentativa-bd6a8809bc64abb7` única.
- `retryAllowed=false` — **proibido** nova CRT / novo permit / TX_START.
- Recuperação deve ser **só status/vínculo**, sem automação Destaxa.

### Fluxo oficial proposto (após autorização explícita)

1. **Não** chamar FINALIZE/DLL/NativeHost.  
2. Reconciliação explícita operador (`POST /api/tef/transacao/3/reconciliar`) **somente se** existir trava de resultado tardio compatível; caso contrário, procedimento administrativo dedicado que:
   - confirme `CONFIRMED_SUCCESS` a partir das evidências já persistidas (NSU/autorização/comprovantes);
   - atualize `status` → `aprovado`;
   - registre auditoria com usuário + observação + `confirmacao_explicita`;
   - vincule `vendas.tef_transacao_id = 3` **sem** alterar totais/pagamento da venda 66;
   - libere lease inconclusivo se ainda ativo no runtime.
3. Validar re-leitura: status aprovado, NSU/autorização inalterados, comprovantes intactos.

### Impacto na venda 66

- Venda já `concluida`/`quitada` com `valor_fiscal=1`.
- `tef_transacao_id` ainda **null** — recuperação deve apenas **vincular** id=3, sem novo recebimento e sem reemitir fiscal.

### Alterações propostas (banco / protocolo) — **pendentes de GO**

| Alvo | Mudança proposta |
| --- | --- |
| `tef_transacoes.id=3` | `status: pendente → aprovado` (+ payload reconciliacao) |
| `vendas.id=66` | `tef_transacao_id = 3` |
| Protocolo Destaxa | **nenhuma** chamada nativa |
| Permit / gate | **nenhuma** emissão; gate permanece OFF |

---

## 6. Entrega desta sprint

| Item | Status |
| --- | --- |
| Causa raiz | Documentada |
| Correção preventiva FINALIZE (ciclo automático) | **Aplicada no código** |
| Testes de segurança | Passando |
| Recuperação TX 3 | **Aguardando autorização específica do PO** |
| Nova cobrança | **Não executada** |

Arquivos alterados:
- `backend/services/tef/TefManager.js`
- `tests/tef/tef-destaxa-51-19-host-security-continue.test.js`
- `tests/tef/tef-destaxa-51-24-auditoria-fluxo.test.js`
- este relatório
