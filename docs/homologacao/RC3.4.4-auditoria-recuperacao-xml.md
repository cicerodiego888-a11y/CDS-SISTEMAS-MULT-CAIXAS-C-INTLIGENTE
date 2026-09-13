# Relatório RC3.4.4 — Auditoria cirúrgica da recuperação de XML (caso real)

**Sprint:** RC3.4.4  
**Data:** 2026-07-28  
**Chave:** `23260743648971005114550010003489061727587419`  
**Fornecedor:** WURTH DO BRASIL PEÇAS DE FIXAÇÃO LTDA  
**Valor:** R$ 3.187,52  
**documentoId:** 31  

**Restrições respeitadas:** sem alteração de regras fiscais; Gate preservado; MIRX preservado; backoff intacto; sem timers extras; sem retries adicionais; **sem aumento de consultas à SEFAZ**.

---

## 1. Linha do tempo completa (evidência SQLite)

| Quando (UTC / local BRT) | Etapa | Evidência |
|--------------------------|-------|-----------|
| 2026-07-27 20:50:33 (−03 → 17:50) | Documento localizado (RES_NFE) | `DOCUMENTO_RECEBIDO` → status `AGUARDANDO_XML_COMPLETO`; XML = resNFe **542 bytes** (não procNFe) |
| — | RES_NFE recebido | `tipo_documento=RES_NFE`, origem `dfe`, NSU `269` |
| 2026-07-28 00:26:12Z | MIRX inscrição (scan/boot) | estado MIRX `iniciadoEm`; **sem** `MIRX_ENFILEIRADO` em timeline (scan direto) |
| 2026-07-28 01:03:32Z (22:03 BRT) | Gate → SLEEP | `MIRX_SLEEP_START`; `distDfe:false`, `consChNFe:false`, `tentativas:0`; Gate 656 originado no **doc 23** (NSU 272), `bloqueadoAte=01:37:51Z` |
| 2026-07-28 01:03:33Z | Manifestação Ciência 210210 | `CIENCIA_ENVIADA` |
| 2026-07-28 01:03:33Z | Manifestação aceita | `MANIFESTACAO_ACEITA` cStat **135**; `proximaConsultaEm=02:03:33Z` (NT 2014.002 +1h) |
| 2026-07-28 01:03:33Z | DistDFe (programado) | evento `AGUARDANDO_NSU` / NT; **enqueue MIRX descartado** (`documento_em_sleep`) |
| — | DistDFe executado? | **NÃO** |
| — | consChNFe executado? | **NÃO** |
| — | Gate (para esta chave) | bloqueio global 656; doc entrou em SLEEP **sem** consulta própria |
| — | MIRX consulta | `ultimaConsultaEm=null`; WAKEUP **0** eventos |
| — | Parser | **NÃO** (`processado_em=null`) |
| — | Central / status final | permanece `AGUARDANDO_XML_COMPLETO` + label estático *“Aguardando disponibilidade da SEFAZ”* |

```
Documento localizado (20:50:33)
        ↓
RES_NFE recebido (resNFe 542 B)
        ↓
MIRX scan (00:26) — pré-Ciência
        ↓
Gate 656 (doc 23) → SLEEP (01:03:32)   [distDfe=false, consChNFe=false]
        ↓
Manifestação Ciência aceita (01:03:33)  [cStat 135]
        ↓
_registrarAguardandoXml → enfileirar(NT 02:03)
        ↓
DESCARTADO: documento_em_sleep          ← causa raiz
        ↓
DistDFe / consChNFe — nunca executados
        ↓
Parser — não executou
        ↓
Central — status parado em AGUARDANDO_XML_COMPLETO
        ↓
Label UI: "Aguardando disponibilidade da SEFAZ" (falso para o motivo real)
```

---

## 2. Respostas objetivas (ETAPAS 2–8)

### ETAPA 2 — WAKEUP
**O documento acordou após o horário programado?**  
**NÃO** — 0 eventos `MIRX_WAKEUP`; em auditoria (`NOW≈01:16Z`) ainda `SLEEP` com `proximaEm=01:37:51Z` (antes do horário).  
Motivo: cooldown Gate 656 ainda ativo; tick MIRX apenas ignora sleepers até `proximaEm`.

### ETAPA 3 — MIRX após WAKEUP
- DistDFe executado? **NÃO** (nunca, para esta chave)  
- consChNFe executado? **NÃO**  
- Retorno: inexistente (`ultimaConsultaEm=null`)

### ETAPA 4 — XML na SEFAZ vs CDS
- XML chegou ao CDS? **NÃO** (apenas resNFe)  
- Foi salvo? **NÃO** (procNFe)  
- Foi descartado? **NÃO** — **nunca foi baixado** pelo MIRX  
- Motivo: recuperação DistDFe/consChNFe não chegou a rodar; pós-ciência não reprogramou o SLEEP

### ETAPA 5 — Parser
- Parser executou? **NÃO**  
- Erro / exceção / retorno vazio? N/A (não entrou no pipeline)

### ETAPA 6 — Transição de estados
```
AGUARDANDO_XML_COMPLETO (RES_NFE)
        ↓  (ciência 135 — status inalterado)
AGUARDANDO_XML_COMPLETO
        ↓  (MIRX SLEEP interno)
AGUARDANDO_XML_COMPLETO + mirx.SLEEP
```
Bloqueio da cadeia `XML_RECUPERADO → PROCESSANDO_XML → PROCESSADO → FINALIZADO`:  
**nunca houve XML_RECUPERADO** porque DistDFe/consChNFe não rodaram.

Impedimento técnico:
- arquivo: `backend/motores/central-entradas/mirx/MirxService.js`
- classe: `MirxService`
- função: `enfileirar`
- trecho: retorno antecipado `documento_em_sleep` **sem** atualizar `proximaEm` da janela NT pós-ciência

Contribuinte:
- arquivo: `MirxWorker.js` — processava RES_NFE **antes** de `MANIFESTACAO_ACEITA`, podendo cair em SLEEP por Gate alheio

### ETAPA 7 — Central
- Banco atualizado (procNFe/status)? **NÃO**  
- Tela atualizada? mostra status antigo / label enganoso  
- Soft Refresh / evento XML? **NÃO** (XML não recuperado)

### ETAPA 8 — Inconsistências
| Sintoma | Achado |
|---------|--------|
| XML “existe na SEFAZ” (manual) | CDS só tem resNFe |
| Status antigo | `AGUARDANDO_XML_COMPLETO` correto no enum, label errado |
| Timeline parada | sem DistDFe/consChNFe/Parser |
| Produtos vazios | esperado sem parse |
| Label “SEFAZ não disponibilizou” | **falso** — motivo real = Gate SLEEP + schedule pós-ciência perdido |

---

## 3. Causa raiz

**Causa raiz:** após Ciência aceita, `_registrarAguardandoXml` chamava `enfileirarRecuperacao` com `proximaEm` da NT 2014.002, mas `MirxService.enfileirar` descartava a inscrição se o documento já estivesse em `SLEEP` (Gate 656 de **outro** documento), **sem alinhar `proximaEm`**. Resultado: DistDFe/consChNFe jamais programados corretamente; a Central exibia *“Aguardando disponibilidade da SEFAZ”* como se o XML não existisse, enquanto o portal manual já podia baixar o procNFe.

**Contribuintes:**
1. Scan/boot do MIRX inscvia RES_NFE **pré-Ciência** → Gate → SLEEP prematuro.  
2. Label estático de `AGUARDANDO_XML_COMPLETO` ignorava estado MIRX/SLEEP.

---

## 4. Correção (somente causa raiz)

| Arquivo | Função | Mudança |
|---------|--------|---------|
| `mirx/MirxService.js` | `enfileirar` | Em SLEEP: alinha `proximaEm = max(atual, meta.proximaEm)`; não acorda; não consulta SEFAZ |
| `mirx/MirxService.js` | `entrarSleep` | Em já-dormindo: só atrasa wakeup (max); retorna `proximaEm` atualizado |
| `mirx/MirxWorker.js` | `processar` + `_temCienciaAceita` | Sem Ciência: remove da fila **sem** Gate/DistDFe/SLEEP |
| `mirx/MirxWorker.js` | `_obterJanelaPosCiencia` | Dentro da NT: reagenda **sem** SOAP |
| `utils/centralEntradasMapper.js` | `obterLabelDocumento` / lista | Label contextual via `resolverStatusReal` + `xmlWait` |
| `CentralEntradasOrchestrator.js` | `obterDocumentoDetalhe` | `statusLabel` coerente com SLEEP/Gate |
| `utils/centralDocumentalInteligente.js` | `resolverStatusReal` | Inclui `AGUARDANDO_JANELA_SEFAZ` |
| `frontend/.../central-entradas-ux.js` | `resolverStatusRealCentral` | Idem |

**Não alterado:** regras fiscais, Gate, MIRX (preservado), backoff, frequência SEFAZ, timers extras.

---

## 5. Antes × Depois

| | Antes | Depois |
|--|-------|--------|
| Ciência com doc em SLEEP | enqueue ignorado; `proximaEm` fica no Gate | `proximaEm` alinhado à NT (max); continua SLEEP |
| Scan pré-Ciência | Gate → SLEEP indevido | worker remove (`AGUARDANDO_CIENCIA`); zero SEFAZ |
| Wakeup antes da NT | DistDFe podia disparar cedo | reagenda NT sem SOAP |
| Label lista/detalhe | “Aguardando disponibilidade da SEFAZ” em SLEEP | “Recuperando XML automaticamente” |
| Consumo SEFAZ | — | **igual ou menor** (evita DistDFe precoce / Gate inútil) |

---

## 6. Evidência da correção (testes)

```bash
node tests/central-entradas/rc344-auditoria-xml.test.js
node tests/central-entradas/rc342-mirx-sleep.test.js
node tests/central-entradas/rc341-mirx.test.js
```

Cenários cobertos:
- ✔ Pós-ciência em SLEEP alinha janela NT  
- ✔ Sem Ciência → sem Gate/DistDFe/SLEEP  
- ✔ Dentro da NT → sem DistDFe  
- ✔ Após NT → XML recuperado  
- ✔ Label SLEEP ≠ “SEFAZ sem XML”  
- ✔ WAKEUP após SLEEP alinhado  

---

## 7. Confirmação: sem aumento de consumo SEFAZ

A correção **só adianta/alinha schedules em memória/SQLite de estado MIRX** e **bloqueia** consultas prematuras. Nenhuma nova chamada DistDFe/consChNFe foi adicionada; nenhuma alteração de backoff/Gate; `forcarConsulta` permanece `false`.

---

## 8. Conclusão

O documento Wurth **não** ficou preso porque a SEFAZ “não tinha XML”. Ficou preso porque:

1. entrou em **SLEEP por Gate 656 de outro documento** sem nunca consultar a chave;  
2. a **Ciência tentou programar a recuperação e o MIRX descartou o agendamento**;  
3. a UI rotulava isso como **indisponibilidade na SEFAZ**.

Com o alinhamento de janela em SLEEP + barreira pré-Ciência + respeito NT sem SOAP + label contextual, a Central deixa de divergir da realidade e a recuperação automática ocorre na janela correta **sem aumentar** o consumo da SEFAZ.
