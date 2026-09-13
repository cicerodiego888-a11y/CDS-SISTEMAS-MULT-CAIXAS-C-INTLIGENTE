# RC7.5 — Refinamento de UX da Central de Entradas

**VERSÃO:** CDS Sistemas V1.0  
**MODO:** IMPLEMENTAÇÃO UX  
**Data:** 2026-07-19  

## Objetivo

Melhorar a experiência operacional da Central **somente na apresentação**. Sem alteração de DistDFe, Manifestação, Parser, MIIP, Compras, Gate, Scheduler, SOAP, banco ou APIs.

---

## Entregas (evidências de código)

| Etapa | Evidência |
|-------|-----------|
| Card XML operacional | `renderCardXmlWaitOperacionalCentral` em `central-entradas-ux.js` |
| Timeline + duração | `montarEtapasOperacionaisCentral` + `renderTimelineOperacionalCentral` |
| Barra progresso | `renderBarraProgressoOperacionalCentral` |
| Mensagens amigáveis | `mensagemAmigavelCentral` |
| Contador / countdown | `formatarDuracaoHumanaCentral` + `formatarCountdownCentral` + `data-central-live` |
| Chips de estado | `resolverChipEtapaCentral` / `renderChipEtapaCentral` |
| Info técnicas | `renderInfoTecnicasRecolhivelCentral` (`<details>` fechado) |
| Saúde SEFAZ | `#centralRc75SaudeWrap` + `renderPainelSaudeSefazCentral` |
| Loading etapas | `renderLoadingEtapasCentral` em `carregarDocumentosCentral` |
| Datas | `resolverDataDocumentoCentral` / `obterDataExibicaoDocumentoCentral` (dataEmissao → dhRecbto; sem created_at) |
| Auto-refresh parcial | `tickLiveUxCentral` (1s) + `softRefreshDocumentoSelecionadoCentral` (20s, sem reload da tabela) |
| CSS responsivo | `central-entradas-ux1.css` (1366 / 1600 / 992) |

Arquivos principais:

- `frontend/erp/js/central-entradas-ux.js`
- `frontend/erp/js/central-entradas.js`
- `frontend/css/central-entradas-ux1.css`

---

## Testes

```bash
node tests/central-entradas/rc75-ux.test.js
```

---

## Critérios

✓ Usuário vê etapa, próxima consulta e tempo aguardando  
✓ Timeline e barra de progresso  
✓ Loading sem spinner infinito  
✓ Datas corretas  
✓ Atualizações parciais (live regions + soft refresh do doc)  
✓ Sem alteração fiscal  
