# Relatório de Homologação — RC3.4.2 MIRX Inteligente + XML Automático

**Sprint:** RC3.4.2  
**Data:** 2026-07-27  
**Escopo:** MIRX (SLEEP/WAKEUP), Gate SEFAZ, botão Solicitar XML, painel Central  
**Restrições respeitadas:** sem alteração de regras fiscais; Gate preservado; MIRX preservado; sem aumento de frequência de consultas  

---

## 1. Objetivo

Eliminar a necessidade de solicitação manual do XML na rotina e, em cStat 656, colocar o documento em **SLEEP** (sem fila, sem tick útil, sem Gate/logs repetitivos), despertando apenas em `proximaTentativa`.

---

## 2. Arquitetura RC3.4.2

```
RES_NFE → MIRX acompanha → (XML na SEFAZ) → Worker → Parser/MIIP → Central atualiza
                ↓ cStat 656
              SLEEP (fora da fila)
                ↓ proximaTentativa
              WAKEUP → fila → nova tentativa
```

| Componente | Mudança |
|------------|---------|
| `MirxEstados.SLEEP` | Estado dorminhoco |
| `entrarSleep` / `despertar` | API de ciclo de vida |
| `_executarTick` | Ignora SLEEP; scan a cada 5 ticks; delay até próximo wakeup |
| `solicitarXmlManual` | Botão excepcional com Gate |
| `POST /:id/solicitar-xml-completo` | Endpoint manual |
| Painel UX | Dormindo, Gate, motivo, método programado |

---

## 3. Consumo antes / depois (estrutural)

| Métrica | Antes (RC3.4.1) | Depois (RC3.4.2) |
|---------|-----------------|------------------|
| **CPU (docs em 656)** | Tick 60s processava/reenfileirava + Gate auth | Tick só agenda wakeup; sleepers fora da fila; delay até `proximaEm` (até 30 min) |
| **Logs por minuto em 656** | `MIRX_SKIP_GATE` / reenqueue a cada tick | **1×** `MIRX_SLEEP_START`; depois silêncio até `MIRX_WAKEUP` |
| **Consultas ao Gate em SLEEP** | A cada job reenfileirado | **0** até wakeup ou solicitação manual |
| **Consultas SEFAZ** | Sem aumento (já sem `forcarConsulta`) | Sem aumento; manual bloqueada não chama SEFAZ |

Evidência de teste: `ticksIgnoradosSleep`, `sleepStarts` estável em 5 ticks, `MIRX_SKIP_GATE === 0` durante SLEEP.

---

## 4. Critérios de aceite

| Critério | Status |
|----------|--------|
| RES_NFE acompanhado pelo MIRX automaticamente | ✔ `recuperarPendentes` + enqueue pós-ciência |
| XML disponibilizado → recuperação automática | ✔ Worker → `XML_RECUPERADO` |
| cStat 656 → SLEEP | ✔ |
| Wake-up após cooldown | ✔ `_despertarDevidos` |
| Sem ticks/logs repetitivos em SLEEP | ✔ |
| Sem aumento de consumo SEFAZ | ✔ |
| Central atualiza após XML (soft refresh) | ✔ notifica + reload ao mudar status |
| Botão Solicitar XML respeita Gate | ✔ `naoEnfileirado` + mensagem com próxima tentativa |

---

## 5. Botão "Solicitar XML Completo"

- Passa a ser **exceção manual** (`(manual)` no label).
- Endpoint: `POST /api/central-entradas/:id/solicitar-xml-completo`
- Gate bloqueado: **não** consulta, **não** enfileira; exibe:

```
Consulta temporariamente bloqueada pela SEFAZ (cStat 656).

Próxima tentativa automática: DD/MM/AAAA HH:MM

Nenhuma ação é necessária. O MIRX fará uma nova tentativa automaticamente.
```

---

## 6. Indicadores visuais

| Situação | Indicador |
|----------|-----------|
| Aguardando SEFAZ | 🟡 Aguardando disponibilidade da SEFAZ |
| SLEEP / 656 | 🔴 Consulta temporariamente bloqueada (656) |
| XML recuperado | 🟢 XML recuperado automaticamente |

Painel: Última/Próxima tentativa, Tempo restante, Status Gate, Motivo, Método programado, Backoff, **Dormindo Sim/Não**.

---

## 7. Testes

```bash
node tests/central-entradas/rc342-mirx-sleep.test.js
node tests/central-entradas/rc341-mirx.test.js
```

---

## 8. Conclusão

RC3.4.2 homologado: XML automático na rotina; SLEEP inteligente em 656; wakeup pontual; botão manual sem consultas indevidas nem bloqueios adicionais.
