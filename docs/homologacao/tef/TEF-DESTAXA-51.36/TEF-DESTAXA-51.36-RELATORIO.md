# TEF-DESTAXA-51.36 — Auditoria do fluxo real de pagamento

**Data:** 2026-11-10 ~15:58 BRT  
**Tipo:** auditoria estática + snapshot de processos (sem TX, sem venda, sem COM4, sem gate).  
**Objetivo:** preparar a 1ª venda real de homologação sem executá-la.

---

## 1. Preservação do ambiente

| PID | Processo | PPID | Papel | Estado |
| --- | --- | --- | --- | --- |
| **10292** | Electron PDV (`electron-pdv.js --cds-forcar-local`) | 16152 | CDS PDV + backend `:3001` | **UP** |
| **15164** | Electron runner 51.35 | 19100 | Mantém Host de inspeção | **UP** (não encerrado) |
| **2176** | Electron utility `node.mojom.NodeService` | **15164** | NativeHost Destaxa (LOAD+INIT 51.35) | **UP** (não encerrado) |
| **20760** | VSPagueClient | 18536 | Automação Destaxa | **UP** (não reiniciado) |

| Checagem | Resultado |
| --- | --- |
| `:3001` | LISTENING → **10292**; `/login` **200** |
| `:60603` / `:60906` | LISTENING → **20760** |
| Gate | **OFF** (`unset`) |
| Filhos TEF sob PDV 10292 | gpu / network / renderer — **sem** NativeHost TEF |
| Filhos sob runner 15164 | **2176** = NativeHost TEF |

**Nenhum** processo alvo foi encerrado ou reiniciado nesta sprint.

---

## 2. Integração PDV ↔ NativeHost

### Como o PDV obtém o NativeHost

1. `TefManager` constrói `_nativeHostClient = obterClienteCompartilhado()` (`DestaxaNativeHostClient.js`).  
2. Singleton **`compartilhado` é por processo Node/Electron** (“um host TEF por aplicação”).  
3. `DestaxaRealAdapter` (modo padrão) usa `DestaxaHostBridge` → mesmo cliente compartilhado.  
4. No primeiro `enviar` com Host não READY, `DestaxaNativeHostClient.iniciar()` faz `utilityProcess.fork(DestaxaNativeHost.js)` **no processo pai atual**.

### A instância 2176 é a do PDV?

| Pergunta | Resposta |
| --- | --- |
| 2176 é filho do PDV 10292? | **Não** — PPID **15164** (runner 51.35) |
| PDV compartilha IPC/bootstrap com 2176? | **Não** — processos distintos, heaps/`compartilhado` separados |
| PDV usaria 2176 no fluxo normal? | **Não** — criaria **outro** NativeHost sob 10292 |
| Existe bridge cross-process para anexar 2176 ao PDV? | **Não** no código atual |

### Incompatibilidade runner 51.35 × fluxo normal do PDV

| Risco | Detalhe |
| --- | --- |
| Duplicação de NativeHost | Venda no PDV → novo utilityProcess + novo LOAD/INIT, **enquanto 2176 permanece vivo** |
| Dupla sessão DLL/Client vs 60906 | Dois Hosts podem competir pelo mesmo V$Pague (comportamento não homologado) |
| Bootstrap/sessão | `hostSessionId` / permits do 2176 **não** transferem ao PDV |
| Keep-alive 51.35 | Útil para inspeção; **não** é a integração do caminho de venda do PDV |

**Conclusão §2:** a integração “já inicializada” (51.35) **não** é a que o fluxo normal do PDV utilizará. Para a 1ª venda, o PDV precisará inicializar **seu próprio** NativeHost (LOAD+INIT) sob 10292 — idealmente **após** encerrar o keep-alive 15164/2176 (em sprint autorizada), para evitar duplicidade.

---

## 3. Mapa do fluxo de pagamento (sem execução)

```
PDV (pdv.js processarPagamentoTEF)
  → POST /api/tef/pagar  (rotas/tef.js)
    → tefFiscalContextService.autorizarPagamentoFiscal
      → tefService.iniciarPagamento → TefManager.autorizar
        → Router/lease + seleção DestaxaRealAdapter (executionMode native-host)
        → DestaxaRealAdapter.prepararAutorizacao
            (valor R$1,00 · débito · PinPad detectado · V$Pague UP · LOAD/INIT se preciso)
        → INSERT tef_transacoes (pendente)  [antes da DLL]
        → DestaxaRealAdapter.autorizarPagamento
            → bridge.habilitarTransacaoReal  [exige gate=1 OU permit excepcional]
            → executarCicloCrt
                → TX_START → (99 → TX_CONTINUE)* → evidências 00
                → CONFIRMAR_PERSISTENCIA (NSU/autorização/comprovantes)
                → TX_FINALIZE(0)
        → DestaxaHostBridge → NativeHost (utilityProcess do PDV)
            → DestaxaNativeBridge → DLL 1.83 → V$Pague :60906 → PinPad
  ← JSON resultado → PDV (continuidade /tef/continuar se COLETA/OPCAO)
```

### Onde cada preocupação ocorre

| Tema | Onde |
| --- | --- |
| **Valor** | PDV envia `valor` em `/tef/pagar`; Adapter exige **100 centavos** (`VALOR_HOMOLOGACAO_CENTAVOS`) em homologação real |
| **Modalidade débito** | PDV `tipo` → `cartao_debito`/`debito`; `mapearTipoCartaoCrt` / `buildCrtInput` no Adapter; CRT na DLL |
| **Terminal** | `tefRouterIntegration.resolverRotaAutorizacao` + Terminal Registry / lease (`terminalTefId`, `pdv_id`) |
| **COM4** | CDS **não** abre serial no ciclo; `prepararAutorizacao` só **detecta** PPC-920/930 na porta configurada (ex. COM4). Abertura efetiva é do **V$Pague/DLL** no fluxo de coleta |
| **TX_START / CONTINUE / FINALIZE** | `destaxaCrtCicloOrquestracao.executarCicloCrt` via Host ops; intent TefManager permite as três no ciclo automático; CONTINUE PDV via `/tef/continuar` |
| **NSU / autorização / comprovantes** | Extraídos no retorno **00**; `_persistirEvidenciasRetorno00` **antes** de FINALIZE(0); evento `CONFIRMAR_PERSISTENCIA` |
| **Retorno ao PDV** | Resposta HTTP de `/tef/pagar` (+ continuidade); impressão TEF opcional; vínculo `venda_id` |

### Gate (bloqueio atual para venda)

Com `DESTAXA_REAL_TRANSACTION_ENABLED` **OFF**, `autorizarPagamento` bloqueia em `habilitarTransacaoReal` / gate **salvo** consumo de **autorização excepcional** one-shot (51.02).  
**1ª venda real** exige autorização PO para ligar o gate **ou** emitir permit excepcional — **fora** desta sprint.

---

## 4. Segurança (cumprida)

Não executado: TX_*, CRT, venda com pagamento, COM4, cartão, gate ON, alteração de banco, fiscal/SEFAZ, PDV Universal, encerramento de 15164/2176/20760/10292.

---

## 5. Bloqueios para READY_FOR_FIRST_REAL_SALE

1. **NativeHost 2176 não é o Host do PDV** — venda normal **duplicaria** Host se o keep-alive permanecer.  
2. **Gate financeiro OFF** — TX real bloqueada no caminho padrão.  
3. **INIT no processo PDV ainda não comprovado** nesta janela (só no runner).  
4. Fluxo fiscal/venda (`contextoFiscal`, `venda_id`) precisa estar válido no momento da venda — mapeado, não exercitado.

---

## 6. Classificação

| Dimensão | Status |
| --- | --- |
| Ambiente preservado | OK |
| Mapa do fluxo PDV→…→V$Pague | OK |
| PDV usa integração 51.35 (2176) sem duplicar | **Não** |
| Pronto para 1ª venda no caminho normal | **Não** |

### **Classificação final: PARTIAL**

Auditoria completa e ambiente intacto; **não** há comprovação de que o fluxo normal do PDV reutilizará o NativeHost 2176 sem duplicação. Próximo passo operacional (nova autorização): encerrar keep-alive 51.35 de forma controlada → sob PDV, NativeHost+LOAD+INIT → autorizar gate/permit → só então 1ª venda R$1,00 débito.

**Não declarar READY_FOR_FIRST_REAL_SALE.**

FIM DO RELATÓRIO TEF-DESTAXA-51.36.
