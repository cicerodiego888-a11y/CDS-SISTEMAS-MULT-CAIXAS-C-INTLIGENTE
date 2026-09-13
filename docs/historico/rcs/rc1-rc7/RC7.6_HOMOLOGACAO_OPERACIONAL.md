# RC7.6 — Homologação Operacional Enterprise

**Versão:** CDS Sistemas V1.0  
**Modo:** HOMOLOGAÇÃO OPERACIONAL (somente validação)  
**Data da auditoria:** 2026-07-19  
**Ambiente inspecionado:** `C:\ProgramData\MercantilFiscal\dados\mercadao.db`  
**Escopo:** Central de Entradas — documentos e eventos reais  

**Restrição cumprida:** nenhuma alteração em DistDFe, Manifestação, Parser, MIIP, Compras, Registry, UrlResolver, SOAP, Scheduler, Gate Operacional ou XML Wait.  
Evidências: snapshot read-only `tests/central-entradas/rc76-audit-snapshot.json` + regressão RC7.4.x / RC7.5.

---

## Resumo executivo

A Central avançou de forma material em relação ao RC7.0: houve **sincronização DistDFe real com 26 notas**, **manifestação 210210 aceita e rejeitada**, **1 PROC_NFE** processado até Parser/MIIP/revisão, e o **Gate operacional reagiu a Consumo Indevido (656)** com bloqueio e consulta evitada.

A homologação **não está completa para go-live contínuo**. Faltam evidências de Upload XML, download manual, nota recém emitida / poucas horas, cStat 593 em SEFAZ real, e há **anomalia de persistência de NSU** (`ult_nsu`/`max_nsu` zerados após sync com documentos NSU 011–027). Além disso, **25/26 documentos permanecem em `AGUARDANDO_XML_COMPLETO`** (RES sem PROC), com rejeições 596 (prazo > 10 dias) em manifestações recentes do scheduler.

**Veredito:** homologação operacional **PARCIAL — APROVADA COM RESSALVAS**.

---

## Matriz de casos obrigatórios

| Caso | Status | Evidência |
|------|--------|-----------|
| Nota recém emitida (&lt; ~2,4 h) | **NÃO OBSERVADO** | Faixas de idade por `data_emissao`: sem `recem_&lt;2.4h` |
| Nota emitida há algumas horas | **NÃO OBSERVADO** | Sem faixa `algumas_horas` |
| Nota emitida há alguns dias | **OK** | 3 documentos (emissão ~2026-07-13…16) |
| Nota mais antiga (&gt; 7 dias) | **OK** | 23 documentos |
| Nota recebida automaticamente | **OK** | 26 docs `origem=dfe` |
| Nota via Upload XML | **NÃO OBSERVADO** | `upload=0` |
| RES_NFE | **OK** | 25 documentos |
| PROC_NFE | **OK** | 1 documento (id 21 → `AGUARDANDO_REVISAO`) |
| Download automático | **PARCIAL** | Sync trouxe 26 notas; pós-manifestação majoritariamente `AGUARDANDO_NSU` / 656 |
| Download manual | **NÃO OBSERVADO** | Sem eventos claros de download/solicitar XML manual |
| Manifestação 210210 | **OK** | 16× `CIENCIA_ENVIADA` |
| Ciência aceita | **OK** | 8× `MANIFESTACAO_ACEITA` (amostra com cStat **135**) |
| Ciência rejeitada | **OK** | 8× `MANIFESTACAO_REJEITADA` (predominância **596** prazo) |
| XML Wait | **OK** | 25 docs no estado; `iniciados=25` |
| Scheduler | **OK** | Estado `xml_wait_scheduler_state`; `tentativasTotais=10` |
| Background | **OK** | Sync + XmlWait ativos no período 18–19/07 |
| Reinício do servidor | **PARCIAL** | Estado Gate/Wait persistido em config; boot coberto em testes RC7.4; reinício de produção não instrumentado nesta sessão |
| Consumo Indevido (656) | **OK** | `SYNC_ERRO` 656 + Gate `bloqueios656=1`, histórico `SKIPPED`/`BLOCKED` |
| Configuração inválida (593) | **NÃO OBSERVADO** | `erros593=0` (coberto só por testes unitários RC7.4.2/7.4.3) |
| Gate Operacional | **OK** | `estadoOperacional=NORMAL` após ciclo BLOCKED→RECOVERING; telemetria presente |
| Dashboard | **PARCIAL** | DTO/painel validados em RC7.4.3/RC7.5 (código+teste); sem captura de UI nesta sessão |
| Timeline | **PARCIAL** | Histórico de documentos + eventos no banco; UX timeline em RC7.5 |
| Telemetria | **OK** | `telemetria` / `gateMetricas` no estado persistido |

---

## Problemas encontrados

1. **NSU zerado após sync bem-sucedido**  
   - Documentos possuem NSU `000000000000011`…`027`.  
   - Tabela `central_entradas_nsu`: `ultNsu=000000000000000`, `maxNsu=000000000000000` (atualizado em 2026-07-18 23:54:08, após `SYNC_CONCLUIDA` “nenhuma nota nova”).  
   - Risco: reconsulta a partir de NSU 0 → pressão SEFAZ / novo 656.

2. **Divergência de ambiente**  
   - `configuracoes.fiscal_ambiente = 1` (produção).  
   - `central_entradas_nsu.ambiente = 2` (homologação).  
   - Homologação RC7.0 já apontava ambiente 2; config global foi corrigida, mas a linha NSU permanece inconsistente.

3. **Fila XML Wait estagnada**  
   - 25 RES em `AGUARDANDO_XML_COMPLETO`, `documentosRecuperados=0`.  
   - Consultas pós-manifestação retornaram espera de XML / 656; 1 PROC concluído o ciclo Parser→MIIP.

4. **Manifestação fora do prazo (596)**  
   - Scheduler/ciência em documentos antigos (&gt; 10 dias) → rejeição SEFAZ esperada.  
   - Não é bug fiscal de contrato; é gap operacional de priorização/idade.

5. **Rajada de consultas antes do Gate estabilizar**  
   - Vários `CONSULTA_DFE_POS_MANIFESTACAO` com resultado `656` entre ~00:35–01:15.  
   - Gate registrou 1 bloqueio + 1 consulta evitada (`SKIPPED` em 01:25:57).  
   - Indica que o controle passou a atuar, mas houve janela com múltiplas tentativas SOAP.

6. **Casos obrigatórios sem evidência real**  
   - Upload XML, download manual, nota recém emitida / poucas horas, cStat 593.

7. **Memória/CPU do processo de produção**  
   - Não medidos no servidor em execução (apenas processo do auditor). Métricas de tempo vêm dos eventos.

---

## Problemas corrigidos

*(já endereçados em sprints anteriores; evidência operacional nesta base)*

| Item | Situação RC7.0 | Situação RC7.6 |
|------|----------------|----------------|
| Sync DistDFe bloqueado (CNPJ × certificado) | Falha sistêmica | Sync OK com CNPJ `65.957.340/0001-50` — 26 notas |
| `fiscal_ambiente` | `2` (homologação) | `1` (produção) nas Configurações |
| Sem manifesto real | 0 eventos | Aceita (135) e rejeitada (596) |
| Sem Gate 656 | N/A | Bloqueio 10 min + `consultasEvitadas=1` + desbloqueio `janela_656_expirada` |
| Sem XmlWait/Scheduler | N/A | Estado persistido; 25 docs monitorados |
| UX / Dashboard SEFAZ | Parcial | RC7.5 + painel operacional (testes OK) |

---

## Problemas pendentes

| Prioridade | Item | Ação sugerida (fora do escopo RC7.6) |
|------------|------|--------------------------------------|
| P0 | Persistência / consistência de `ult_nsu`/`max_nsu` | Auditar gravação pós-DistDFe e pós-656 (sem mudar regra fiscal nesta sprint) |
| P0 | Alinhar `central_entradas_nsu.ambiente` com `fiscal_ambiente` | Evitar consulta no endpoint errado |
| P1 | Recuperar PROC para RES em wait | Aguardar janela SEFAZ + Gate; validar download pós-135 em notas dentro do prazo |
| P1 | Homologar Upload XML + download manual | Executar script de casos com 1 upload e 1 “Solicitar XML” |
| P2 | Homologar 593 | Simular cert/CNPJ inválido em ambiente controlado (já coberto em unitário) |
| P2 | Priorizar ciência por idade (&lt; 10 dias) | Reduzir 596 no XmlWait |
| P2 | Instrumentar memória/CPU do Node em produção | Expor no Diagnóstico / telemetria |

---

## Performance

Fontes: `central_entradas_eventos.duracao_ms` + telemetria Gate/XmlWait (snapshot 2026-07-19T01:30Z).

| Métrica | Valor |
|---------|-------|
| Tempo médio Sync (`SYNC_CONCLUIDA`/`SYNC_ERRO`) | **920,2 ms** (n=10; min 78; max 4090) |
| Sync sucesso | 2 (26 notas + “nenhuma nova”) |
| Sync erro | 8 (CNPJ, cert ausente, 656) |
| Tempo médio Parser | **6,2 ms** (n=6) |
| Tempo médio MIIP | **34,2 ms** (n=6) |
| Tempo médio Manifestação | **473,9 ms** (n=22) |
| Tempo médio XML Wait (eventos tipados) | **N/D** (n=0 com `duracao_ms`) |
| Tentativas XmlWait | 10 totais / 25 docs iniciados |
| Docs recuperados XmlWait | 0 |
| Consultas SOAP (Gate) | **5** |
| Consultas evitadas (Gate) | **1** |
| Bloqueios 656 | **1** (janela **600.000 ms** = 10 min) |
| Intervalos entre consultas Gate | ~61 s (série) + 1 intervalo ~656 s |
| Memória / CPU servidor produção | **Não medido** nesta sessão |
| Memória processo auditor | ~RSS/heap do snapshot local (irrelevante para produção) |

**Leitura:** Parser/MIIP estão rápidos. O gargalo operacional é SEFAZ (656 / espera de PROC) e a fila RES, não CPU de parsing.

---

## Telemetria

Estado persistido em `central_entradas_config.xml_wait_scheduler_state` (compartilhado Gate + XmlWait):

| Campo | Valor observado |
|-------|-----------------|
| `estadoOperacional` | `NORMAL` |
| `contador656` | `0` (reset após sucesso/desbloqueio) |
| `telemetria.consultasSOAP` | 5 |
| `telemetria.consultasEvitadas` | 1 |
| `telemetria.bloqueios656` | 1 |
| `telemetria.erros593` | 0 |
| `telemetria.contagemCStat.656` | 1 |
| `ultimaRespostaSEFAZ.cStat` | `596` (manifestação fora do prazo) |
| Histórico Gate | 6 eventos (inclui `BLOCKED`/`SKIPPED` 656 e `RECOVERING`/`NORMAL` 596) |
| Desbloqueio | `janela_656_expirada` em 2026-07-19T01:26:27.719Z |

Regressão automatizada (esta sessão):

```
RC7.4.3 operational gate OK
RC7.4.2 inteligência operacional SEFAZ OK
RC7.4.1 consumo indevido 656 OK (exit 0)
RC7.4 xml-wait scheduler OK
RC7.5 UX Central OK
```

---

## Conclusão

A Central de Entradas **demonstrou ciclo operacional real** DistDFe → RES → Ciência 210210 → (aceite/rejeição) → tentativa de XML → Gate 656 → Parser/MIIP em pelo menos 1 PROC, com telemetria e scheduler ativos.

**Não** se declara homologação enterprise plena enquanto:

1. NSU persistido permanecer inconsistente;  
2. Upload / download manual / notas recentes / 593 não forem evidenciados;  
3. A maioria dos RES continuar sem PROC.

**Recomendação:** manter Gate/XmlWait ativos; **não** forçar DistDFe sob 656; priorizar notas dentro do prazo de ciência; abrir sprint de auditoria **somente NSU/ambiente** (sem mudar regras fiscais) antes de go-live contínuo.

---

## Confidence Score

| Dimensão | Score | Nota |
|----------|------:|------|
| Evidência SEFAZ real | 0,85 | Sync, 656, 135, 596 observados |
| Cobertura da matriz RC7.6 | 0,62 | Vários casos obrigatórios sem evidência |
| Estabilidade operacional (Gate/Wait) | 0,80 | Bloqueio/evitação 656 OK; fila ainda estagnada |
| Consistência de estado (NSU/ambiente) | 0,45 | Anomalia crítica de NSU |
| Performance mensurada | 0,75 | Tempos de evento OK; mem/CPU produção ausente |
| Regressão automatizada | 0,90 | RC7.4.x / RC7.5 verdes |

**Confidence Score global: 0,72 (72%)** — homologação parcial com confiança moderada-alta nos mecanismos operacionais, e confiança reduzida na completude do ciclo e na persistência de NSU.

---

## Anexo — Totais do snapshot

| Indicador | Valor |
|-----------|------:|
| Documentos | 26 |
| RES_NFE | 25 |
| PROC_NFE | 1 |
| `AGUARDANDO_XML_COMPLETO` | 25 |
| Upload | 0 |
| Origem DFe | 26 |
| CNPJ operacional | 65.957.340/0001-50 |
| `fiscal_ambiente` (config) | 1 |
| Ambiente na tabela NSU | 2 |

*Gerado em modo somente leitura. Segredos (senha de certificado / tokens) foram omitidos deste documento.*
