# RC7.4.3 — Gate Operacional Enterprise + Circuit Breaker + Inteligência SEFAZ

**VERSÃO:** CDS Sistemas V1.0  
**MODO:** IMPLEMENTAÇÃO ENTERPRISE  
**Data:** 2026-07-19  

## Objetivo

Evoluir o `CentralSefazOperationalGate` (RC7.4.2) para nível Enterprise: Circuit Breaker, cooldown progressivo 656, histórico circular, categorias de erro e telemetria avançada — **sem** alterar DistDFe, Manifestação, Parser, MIIP, Compras, Registry, UrlResolver, SOAP, schema ou Máquina de Estados.

---

## Auditoria prévia (evidências)

| Item | Evidência no código |
|------|---------------------|
| Gate já existia | `services/CentralSefazOperationalGate.js` (RC7.4.2) |
| Sync usa Gate | `CentralSyncExecucaoService.executar` → `autorizarConsultaDistDfe` / `processarRespostaSefaz` |
| Orchestrator usa Gate | `processarCicloDfeDocumento` |
| XmlWait usa Gate | `_processarDocumento` + singleton compartilhado |
| Diagnóstico usa Gate | `testarConexaoSefaz` |
| Persistência única | chave `xml_wait_scheduler_state` |

Nenhum segundo gate foi criado. Evolução in-place do mesmo módulo.

---

## Circuit Breaker

| Estado | Indicador | Quando |
|--------|-----------|--------|
| `NORMAL` | 🟢 | Operação saudável / sucesso 138 |
| `WARNING` | 🟡 | 137/108/109 ou waits pendentes |
| `BLOCKED` | 🟠 | Cooldown 656 ativo |
| `RECOVERING` | 🔵 | Após expirar 656, até 1ª resposta OK |
| `CONFIG_ERROR` | 🔴 | cStat 593 |

Fluxo: `NORMAL → WARNING → BLOCKED → RECOVERING → NORMAL` (+ atalho `CONFIG_ERROR ↔ NORMAL` via fingerprint).

---

## Cooldown progressivo 656

| Ocorrência | Minutos |
|------------|---------|
| 1ª | 10 |
| 2ª | 20 |
| 3ª | 40 |
| 4ª | 60 |
| 5ª+ | 120 |

Após resposta bem-sucedida (ex.: 138/137): **zera** `contador656`.  
`INTERVALO_BLOQUEIO_656_MS` exportado = teto 120 min (compat).  
Cálculo: `calcularCooldown656Ms(contador)`.

---

## cStat 593

Estado `CONFIG_ERROR`. Persiste: CNPJ XML/Certificado, path, serial, thumbprint, validade, fingerprint.  
Troca de fingerprint → `SEFAZ_GATE_CONFIG_FIXED` → `NORMAL`.

---

## Categorias de erro

- **Operacionais SEFAZ:** 137, 138, 593, 656, 108, 109  
- **Internos CDS:** Timeout, SOAP, XML, Runtime, Banco, Upload, Parser, MIIP (`processarErroInterno`)

Dashboard/Diagnóstico exibe as duas categorias.

---

## Histórico circular

Buffer de **100** eventos (`HISTORICO_MAX`). Campos: timestamp, endpoint, cStat, tempo, tempoSoap, resultado, CorrelationId, RequestId, Documento, NSU, Chave. Descarta o mais antigo automaticamente.

---

## Logs SEFAZ_GATE_*

`START` · `ALLOW` · `BLOCK` · `UNLOCK` · `RECOVER` · `CONFIG_ERROR` · `CONFIG_FIXED` · `RESPONSE` · `RETRY` · `TIMEOUT`  

Canal `XML_WAIT_*` mantido para compatibilidade RC7.4.x.

---

## Persistência (`xml_wait_scheduler_state`)

`estadoOperacional`, `contador656`, `backoffAtual`, `bloqueio656`, `estado593`, `fingerprint`, `historico`, `telemetria` / `gateMetricas`.

---

## Testes

```bash
node tests/central-entradas/rc743-operational-gate.test.js
node tests/central-entradas/rc742-inteligencia-operacional-sefaz.test.js
node tests/central-entradas/rc741-consumo-indevido-656.test.js
node tests/central-entradas/rc74-xml-wait-scheduler.test.js
```

---

## Critérios de aceitação

| Critério | Status |
|----------|--------|
| Um único Gate | ✓ |
| Módulos via Gate | ✓ |
| Cooldown progressivo | ✓ |
| Circuit Breaker | ✓ |
| Dashboard SEFAZ OPERACIONAL | ✓ |
| Histórico circular 100 | ✓ |
| Telemetria | ✓ |
| Recuperação pós-reinício | ✓ |
| Sem regressão fiscal/parser/miip/compras/soap/estados | ✓ (camada operacional apenas) |

---

## Auditoria final (pós-implementação)

Ver `docs/RC7.4.3_AUDITORIA_FINAL.md` com evidências de código e resultados de teste.
