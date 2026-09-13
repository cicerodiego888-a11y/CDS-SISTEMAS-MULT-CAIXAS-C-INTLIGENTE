# AUDITORIA FINAL DE CONGELAMENTO ARQUITETURAL

**Data:** 2026-07-16  
**Escopo:** somente leitura · sem implementação · sem correção  
**Contexto:** Plataforma Fiscal RC1.1 + Central RC4.3 + HotFix RC4.3.1

---

## Resumo Executivo

A arquitetura **V1** (Plataforma Fiscal + Central Inteligente) está **pronta para congelamento de produto**, com **ressalvas oficiais documentadas** que não abrem novas sprints nestes módulos — apenas HotFix crítico ou legislação.

Não há inconsistência que impeça homologação SEFAZ do ciclo DF-e da Central.  
Há dívida residual **fora do perímetro estrito “Registry-only absoluto”** (fallback legado de emissão, URLs NFC-e editáveis no Centro Fiscal, devolução NF-e compra, PATCH admin de status).

**Confidence Score:** **84 / 100**  
**Readiness de congelamento V1:** **APROVADO COM RESSALVAS OFICIAIS**

Smoke gate nesta auditoria: RC4.3.1 OK · RC3.3.3 6/6 · fiscal-platform 15/15.

---

## Respostas obrigatórias

### 1. A Plataforma Fiscal pode ser considerada oficialmente encerrada?

**SIM** — como entrega **RC1.1 / V1**, com ressalvas:

- Caminho oficial: `FiscalWebServices → Registry → UrlResolver → SoapTransport` cobrindo Status, DF-e, Manifestação, Consulta, Cancelamento, Autorização NFC-e.
- Fallback legado (`*Legado` / `soapClient`) é **decisão arquitetural explícita** de resiliência, não bypass oculto; a **Central rejeita** `fallbackUtilizado` no DistDFe/Manifestação.
- Ressalvas V1→V2: URLs SOAP ainda editáveis no Centro Fiscal (emissão NFC-e); `nfeDevolucaoCompra.js` ainda fora da plataforma; Health HTTP dedicado ausente.

### 2. A Central Inteligente pode ser considerada oficialmente encerrada?

**SIM** — como entrega **RC4.3 / V1**, com ressalvas:

- Ciclo DF-e: RES → Ciência → DistDFe → PROC → Parser → MIIP → Compra implementado e endurecido (RC3.3 / RC3.3.3).
- Fonte única Ambiente/Cert/CSC/Manifestação/Endpoints RO (RC3.1 / RC4.3 / RC4.3.1).
- Observabilidade: Monitor, Timeline, Logs, Diagnóstico, Homologação.
- Ressalvas: `PATCH /:id/status` privilegiado pode pular etapas (admin); seeds KV de URLs vazias/DEPRECATED; docs canônicas ainda simplificam o pipeline RES; `test:central-integridade` não inclui toda a suíte RC3.3+/RC4.x.

### 3. Existe pendência que impeça iniciar o CDS Design System V2?

**NÃO.**

DS V2 é evolução de UX/visual. Dívidas fiscais/Central listadas abaixo são backlog **pós-congelamento V1** ou HotFix — não bloqueiam Design System.

### 4. Existe alteração arquitetural recomendada antes do congelamento?

**NÃO** (para congelar **V1 com ressalvas**).

As melhorias abaixo são **pós-V1 / versão futura**, não pré-requisito de congelamento:

1. Tornar URLs SOAP NFC-e do Centro Fiscal somente leitura (Registry).  
2. Migrar `nfeDevolucaoCompra` para Autorização via plataforma.  
3. Restringir `PATCH /:id/status` no ciclo RES (admin).  
4. Remover seeds DEPRECATED `sefaz_url_*` (migração de schema).  
5. Atualizar fluxograma canônico RES_NFE na Arquitetura Oficial.  
6. Ampliar `test:central-integridade` com RC3.3+/RC4.x.

**Declaração:**

> **ARQUITETURA V1 CONGELADA COM RESSALVAS OFICIAIS.**  
> Nenhuma nova Sprint de Plataforma Fiscal ou Central Inteligente, salvo HotFix crítico ou mudança de legislação. Evoluções em novas versões do CDS Sistemas.

---

## Parte 1 — Arquitetura Fiscal

| Componente | Status |
|------------|--------|
| Registry | Coerente (catálogo oficial) |
| UrlResolver | OK |
| SoapTransport | OK |
| TransportEnablement | OK |
| FiscalWebServices | Porta oficial OK |
| Runtimes | Status/DF-e/Manif/Consulta/Cancel/Auth OK |
| Fallback | Intencional + testado |
| Métricas | Em memória OK |
| Health HTTP | Ausente (dívida) |

**Inconsistência arquitetural crítica no caminho Central?** Não.  
**Inconsistência no ecossistema emissão NFC-e/devolução?** Sim — ressalva V1.

---

## Parte 2 — Central Inteligente

| Área | Status |
|------|--------|
| Pipeline DF-e | Completo (padrão) |
| Manifestação | Completo |
| Parser / MIIP / Compra | Completo (compra sob revisão/operador) |
| Observabilidade | Completo |
| Bypass | **Admin PATCH status** (ressalva) |
| Fluxo incompleto operacional | Nenhum no caminho padrão |

---

## Parte 3 — Fonte única

| Item | Escrita oficial | Central |
|------|-----------------|---------|
| Ambiente / Cert / CSC | Centro Fiscal | RO |
| Manifestação política | Centro Fiscal | RO |
| Endpoints DF-e/Consulta/Manif | UrlResolver | RO |
| URLs NFC-e emissão | Centro Fiscal (ainda editáveis) | n/a |

Duplicidade operacional de Manifestação/Ambiente: **não**.  
Config editável em local incorreto (Central endpoints): **não** (pós RC4.3.1).

---

## Parte 4 — Endpoints

| Pergunta | Resposta |
|----------|----------|
| Endpoint editável na Central que deveria ser RO? | **Não** |
| Endpoint hardcoded? | Sim — legado + `nfeDevolucaoCompra` + Registry constantes (fonte do catálogo) |
| Endpoint fora do Registry em uso ativo? | Devolução compra + fallback legado |

---

## Parte 5 — Legado

| Item | Classificação |
|------|----------------|
| soapClient / *Legado / axios SOAP | **Decisão arquitetural** (fallback) |
| Central rejeita FALLBACK no DF-e/Manif | Hardening intencional |
| nfeDevolucaoCompra | Dívida V2 |
| notas_recebidas* | Compatibilidade / migração |

---

## Parte 6 — Documentação

| Divergência | Severidade |
|-------------|------------|
| Pipeline oficial omite detalhe RES→Ciência→PROC | Importante (docs) |
| AUDITORIA_FINAL parcial com estado pré/pós RC4.3.1 | Cosmética/docs |
| CHANGELOG / RC4.3.1 | Alinhados |

---

## Parte 7 — Banco

| Item | Resposta |
|------|----------|
| Duplicidade de config operacional Manifestação | Não |
| Chaves antigas sem uso operacional | `sefaz_url_*` seed DEPRECATED (vazio) |
| Tabelas obsoletas | `notas_recebidas*` ainda usadas como fallback contábil |

---

## Parte 8 — Código morto

Não há TODO/FIXME que quebre a arquitetura V1.  
`CentralConfigService` @deprecated (compat).  
`fallbackUtilizado` é contrato vivo, não morto.

---

## Parte 9 — HotFix RC4.3.1

| Objetivo | Cumprido? |
|----------|-----------|
| Consulta chave RO + UrlResolver | SIM |
| Notification unificada (perímetro) | SIM |
| Nomenclatura Centro | SIM |
| Endpoints RO | SIM |

Auditoria automática: **PASSOU**.

---

## Parte 10 — Testes (amostra gate)

| Suite | Resultado |
|-------|-----------|
| RC4.3.1 | OK |
| RC3.3.3 | 6/6 |
| fiscal-platform | 15/15 |
| test:fiscal (histórico recente) | 138 asserts / 0 fail (auditoria plataforma) |

Regressão detectada nesta auditoria: **não**.  
Gate `test:central-integridade` incompleto para RC3.3+/RC4.x: **recomendado pós-V1**.

---

## Parte 11 — Mapa arquitetural final

```
ERP / PDV
    ↓
Centro de Configurações (fonte oficial fiscal + política Manifestação)
    ↓
Central Inteligente (inbox · sync · ciclo DF-e · RO endpoints · observabilidade)
    ↓
Plataforma Fiscal (FiscalWebServices)
    ↓
Registry → UrlResolver → SoapTransport
    ↓
SEFAZ
```

Fallback legado (fora do caminho Central obrigatório):

```
Runtime PLATFORM falha → *Legado / soapClient → SEFAZ
(Central DistDFe/Manif: rejeita FALLBACK)
```

---

## Parte 12 — Classificação

### Pendências críticas (impedem congelar?)
**Nenhuma** para congelamento V1 com ressalvas.

### Importantes (não impedem; V2 / HotFix)
1. URLs SOAP NFC-e editáveis no Centro Fiscal  
2. `nfeDevolucaoCompra` fora da plataforma  
3. PATCH admin de status no ciclo RES  
4. Docs canônicas do pipeline RES  

### Recomendadas
1. Remover seeds `sefaz_url_*`  
2. Ampliar gate de testes de integridade  
3. Health HTTP da plataforma  

### Cosméticas
1. Design System único ERP  
2. alert() em Financeiro/Cadastros  
3. Limpeza texto histórico RC4.2  

**Impede congelar?** **NÃO** (com ressalvas oficiais).

---

## Checklists

### Arquitetural
- [x] Porta única FiscalWebServices  
- [x] Central porta única de entradas DF-e  
- [x] Fonte única Ambiente/Cert/CSC/Manifestação  
- [x] Endpoints Central RO  
- [x] Ressalvas documentadas  

### Fiscal / Plataforma / Central / Banco / APIs / Docs / Testes  
Ver seções 1–10. Resumo: **APROVADO COM RESSALVAS**.

---

## Arquivos auditados (principais)

- `backend/services/fiscal/core/*`  
- `backend/services/fiscal/*Runtime.js`, `*Legado.js`, `soapClient.js`, `nfeDevolucaoCompra.js`  
- `backend/motores/central-entradas/**`  
- `frontend/erp/js/central-entradas.js`, `cds-centro-configuracoes.js`, `fiscal.js`  
- `docs/ARQUITETURA_OFICIAL_CDS_V1.md`, `CENTRAL_ENTRADAS_ARQUITETURA.md`, `RC4.3.1_*`, `CHANGELOG_*`, `AUDITORIA_FINAL_*`  
- `package.json` (scripts de teste)

---

## Declaração final

**ARQUITETURA V1 CONGELADA COM RESSALVAS OFICIAIS.**

Próximas evoluções: novos versionamentos do CDS Sistemas (ex.: Design System V2, Plataforma Fiscal V2).  
Sem novas Sprints de Plataforma Fiscal ou Central Inteligente, salvo HotFix crítico ou legislação.
