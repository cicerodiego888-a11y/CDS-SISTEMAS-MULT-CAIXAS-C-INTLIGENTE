# Relatório de Homologação — RC3.4.5 MIRX × Ciência × SLEEP

**Sprint:** RC3.4.5  
**Data:** 2026-07-28  
**Base:** causa raiz RC3.4.4 (caso Wurth)  
**Restrições:** sem alteração de regras fiscais; Gate preservado; backoff intacto; sem aumento de consultas SEFAZ; sem timers extras.

---

## 1. Fluxo antes × depois

### Antes (bug RC3.4.4)

```
RES_NFE → MIRX scan → Gate 656 (outro doc) → SLEEP
                ↓
         Ciência aceita (135)
                ↓
    enfileirar(proximaEm NT) → DESCARTADO
                ↓
    DistDFe/consChNFe nunca programados
                ↓
    UI: "Aguardando disponibilidade da SEFAZ"  ← falso
```

### Depois (RC3.4.5)

```
RES_NFE → (sem Ciência) MIRX não DistDFe / não SLEEP
                ↓
         Ciência aceita (135)
                ↓
    _registrarAguardandoXml → enfileirar(NT)
                ↓
    Se SLEEP: proximaEm = max(atual, NT)
              + MIRX_AGENDAMENTO_ATUALIZADO
                ↓
    AGENDADO até proximaEm (não “bloqueado por SEFAZ sem XML”)
                ↓
    MIRX_WAKEUP → DistDFe → consChNFe? → Parser
                ↓
    MIRX_WAKEUP_EXECUTADO (método / resultado / tempo)
```

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Ciência com doc em SLEEP | agendamento perdido | `max(proximaEm)` + log |
| Pré-Ciência | Gate → SLEEP possível | remove da fila; zero SEFAZ |
| Janela NT | DistDFe podia antecipar | estado AGENDADO; sem SOAP |
| Label UI | “Aguardando disponibilidade da SEFAZ” | “Recuperação automática do XML agendada” |
| Consumo SEFAZ | — | **igual ou menor** |

---

## 2. Evidência de preservação do agendamento

Teste `testAgendamentoPreservadoEmSleep`:

1. Doc entra em SLEEP com `proximaEm = 01:37:51Z`  
2. Ciência enfileira `proximaEm = 02:03:33Z`  
3. Resultado:
   - `agendamentoPreservado: true`
   - estado permanece `SLEEP`
   - `proximaEm` atualizado para `02:03:33Z`
   - evento `MIRX_AGENDAMENTO_ATUALIZADO` com `proximaEmAnterior` / `proximaEmNova`

Código: `MirxService.enfileirar` — ramo SLEEP usa `_maxProximaEm`.

---

## 3. Logs obrigatórios

### MIRX_AGENDAMENTO_ATUALIZADO

Emitido quando:
- enqueue pós-ciência em SLEEP (alinhar ou confirmar preservação);
- enqueue com `proximaEm` (janela NT);
- `entrarSleep` já dormindo atrasa `proximaEm`;
- worker detecta janela NT futura.

Campos: `DocumentoId`, `proximaEmAnterior`, `proximaEmNova`, `Motivo`, `Origem`.

### MIRX_WAKEUP_EXECUTADO

Emitido após job com motivo `wakeup*` completar DistDFe/consChNFe (XML, reagendado ou 656).

Campos: `Metodo`, `Resultado`, `Tempo` (`tempoMs`).

Timeline amigável (RC3.4.5):

| Evento | Label UI |
|--------|----------|
| MANIFESTACAO_ACEITA | Manifestação aceita (evento Central) |
| MIRX_AGENDAMENTO_ATUALIZADO | Recuperação agendada |
| MIRX_SLEEP_START | Documento entrou em SLEEP |
| MIRX_WAKEUP | Documento despertou |
| MIRX_WAKEUP_EXECUTADO / CONSULTA_INICIO | Recuperação iniciada |
| MIRX_XML_RECUPERADO | XML recuperado |

---

## 4. Status da Central

- Badge/label: **Recuperação automática do XML agendada**  
- Explicação: **Próxima tentativa: DD/MM/AAAA HH:MM**  
- Chip: 🟡 AGENDADO (não mais “SEFAZ sem XML”)  
- Durante `CONSULTANDO_XML`: “Recuperando XML automaticamente”

Arquivos: `DocumentoFiscalStatus.js`, `centralDocumentalInteligente.js`, `central-entradas-ux.js`, `MirxEstados.resolverIndicadorVisual`.

---

## 5. Validação — sem aumento de SEFAZ

| Mudança | Efeito em SEFAZ |
|---------|-----------------|
| Alinhar `proximaEm` em SLEEP | 0 consultas (só estado) |
| Barreira pré-Ciência | **evita** Gate/DistDFe prematuros |
| Janela NT no worker | **adia** DistDFe (0 SOAP) |
| Labels / timeline | 0 consultas |
| `forcarConsulta` | permanece `false` |
| Backoff / Gate | inalterados |

---

## 6. Testes executados

```bash
node tests/central-entradas/rc345-mirx-ciencia-sleep.test.js
node tests/central-entradas/rc344-auditoria-xml.test.js
node tests/central-entradas/rc343-documental-inteligente.test.js
node tests/central-entradas/rc342-mirx-sleep.test.js
node tests/central-entradas/rc341-mirx.test.js
```

Critérios:

- ✔ SLEEP antes da Ciência + Ciência preserva agendamento  
- ✔ Wakeup no horário → DistDFe → XML + `MIRX_WAKEUP_EXECUTADO`  
- ✔ Sem Ciência → sem DistDFe/SLEEP  
- ✔ Janela NT = AGENDADO  
- ✔ Status sem “Aguardando disponibilidade da SEFAZ” quando só espera horário  
- ✔ Agendamento nunca perdido após SLEEP  

---

## 7. Arquivos alterados

| Arquivo | Funções |
|---------|---------|
| `mirx/MirxAuditoria.js` | `TIPOS_MIRX` + detalhe `proximaEm*` |
| `mirx/MirxService.js` | `enfileirar`, `entrarSleep`, `_maxProximaEm` |
| `mirx/MirxWorker.js` | NT → `MIRX_AGENDAMENTO_ATUALIZADO`; `_registrarWakeupExecutado` |
| `mirx/MirxEstados.js` | `resolverIndicadorVisual` |
| `core/DocumentoFiscalStatus.js` | `LABELS_UI` |
| `utils/centralDocumentalInteligente.js` | status / timeline labels |
| `frontend/.../central-entradas-ux.js` | status / chip / explicação |
| `frontend/.../central-entradas.js` | meta status |

---

## 8. Conclusão

RC3.4.5 fecha a sincronização Manifestação → NT → MIRX → SLEEP → recuperação automática: o agendamento **nunca é descartado** em SLEEP, o wakeup ocorre no `proximaEm` (max Gate/NT), a UI mostra **recuperação agendada** com horário, e os logs `MIRX_AGENDAMENTO_ATUALIZADO` / `MIRX_WAKEUP_EXECUTADO` comprovam o ciclo — **sem aumentar** o consumo da SEFAZ.
