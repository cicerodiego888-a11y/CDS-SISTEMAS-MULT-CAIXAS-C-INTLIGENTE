# RC4.2 — Auditoria da Configuração da Manifestação

**Data:** 2026-07-15  
**Escopo:** somente código (sem implementação nesta etapa)  
**Veredito:** a funcionalidade **já existe**

## Resposta obrigatória

**A funcionalidade já existia?** **SIM**

Não se aplica: *"A política da Manifestação ainda não possui implementação oficial."*

**Implementação da Parte 7 (novo card no Centro de Configurações):** **não executada nesta etapa** — haveria duplicidade de fonte. A UI editável já existe na Central.

---

## Parte 1 — Persistência

**SIM.** Valores oficiais:

| Código | Label UI |
|--------|----------|
| `MANUAL` | Manual |
| `AUTOMATICA_CIENCIA` | Automática (Ciência da Emissão) |
| `CONFIRMAR_OPERADOR` | Solicitar confirmação do operador |

---

## Parte 2 — Onde (código)

| Item | Valor |
|------|--------|
| Arquivo (persistência) | `backend/motores/central-entradas/repositories/CentralConfiguracaoRepository.js` |
| Linha DEFAULT | **33** — `manifestacao_destinatario_politica`, default `MANUAL` |
| Tabela | `central_entradas_config` |
| Campo | `chave` = `manifestacao_destinatario_politica` / `valor` string |
| Classe serviço | `CentralConfiguracaoService` |
| Método lê | `obterPoliticaManifestacao()` (~388–394) |
| Método painel | `obterPainelCompleto()` (~113–155) |
| Método grava | `atualizar()` — mapa `politicaManifestacao` → chave (~315, 335–336) |
| API GET | `GET /api/central-entradas/configuracao` |
| API PUT | `PUT /api/central-entradas/configuracao` |
| Controller | `CentralConfiguracaoController.obter` / `.atualizar` |
| Quem grava | UI Central (`salvarConfigCentral` → PUT) + `ensureDefaults` (seed) |
| Quem lê | `CentralConfiguracaoService` |
| Quem consome | `CentralManifestacaoDfeService.processarCandidatos` / `processarDocumento` (~165–167, ~254) |

---

## Parte 3

Não aplicável (existência confirmada).

---

## Parte 4 — Varredura de termos

| Termo | Uso real |
|-------|----------|
| `politicaManifestacao` / `manifestacao_destinatario_politica` | Fonte oficial (config + UI + consumo) |
| `manifestacaoAtiva` | Derivado: `true` só se `AUTOMATICA_CIENCIA` (compat RC4) |
| `manifestacaoPreparada` | **Hardcoded `true`** no painel — não é política; flag de “módulo preparado” |
| `manifestacaoAutomatica` / `manifestacaoModo` / `modoManifestacao` | **Não encontrados** como campos oficiais |
| `210210` / CIENCIA | Evento enviado por `CentralManifestacaoDfeService` + Registry/runtime F7 |
| URLs `sefaz_url_manifestacao_*` | KV **legado/stub** (default vazio); RC4.1 resolve via UrlResolver no painel |

**Código morto / stub:** chaves `sefaz_url_manifestacao_producao/homologacao` ainda semeadas vazias (“preparação futura”) — não são a fonte SOAP.

**TODO específico de política:** não encontrado.

---

## Parte 5 — Hardcodes

| Local | Valor | Natureza |
|-------|-------|----------|
| `CentralConfiguracaoRepository.js:33` | `'MANUAL'` | Default de seed |
| `obterPoliticaManifestacao` fallback | `'MANUAL'` | Valor inválido → Manual |
| `obterPainelCompleto` | `manifestacaoPreparada: true` | Flag estática |
| `central-entradas.js` coletarPayload | `\|\| 'MANUAL'` | Fallback do select |
| Testes | mocks `AUTOMATICA_CIENCIA` / `MANUAL` | Isolamento de testes |

Não há hardcode que force a política operacional ignorando o banco em produção.

---

## Parte 6 — Interface

**SIM** — existe tela para alterar a política.

| Item | Valor |
|------|--------|
| Tela | Central Inteligente → Configuração (engrenagem) → aba **SEFAZ** → card Comunicação |
| Arquivo | `frontend/erp/js/central-entradas.js` |
| Componente | `#cfgPoliticaManifestacao` (select) em `renderAbaSefazCfg` (~1375–1379) |
| Persistência UI | `coletarPayloadConfigCentral()` → `politicaManifestacao` (~1755) → `PUT /configuracao` |
| Rota página | ERP `data-page` Central Entradas (não é Centro de Configurações) |

**Centro de Configurações → Fiscal:** **NÃO** edita esta política (`configuracoes.js` / `cds-centro-configuracoes.js` sem ocorrências).

---

## Parte 7 — Implementação

**Não implementada** (critério: evitar duplicidade; fonte única já existe).

Causa raiz da “não achar”: política está na **Central**, não no **Centro de Configurações Fiscal** que o botão “Abrir Configuração Fiscal” abre.

---

## Readiness auditoria

| Item | Status |
|------|--------|
| Persistência oficial | Confirmada |
| Consumo no ciclo DF-e | Confirmado |
| UI editável | Confirmada (Central/SEFAZ) **à época da auditoria** |
| Duplicar no Centro | **Não recomendado sem migração UX** |
| Código alterado nesta etapa | **Nenhum** |

> **Atualização RC4.3:** a interface oficial de edição foi consolidada em  
> **Centro de Configurações → Fiscal → Manifestação do Destinatário**.  
> A Central passou a somente leitura. Persistência/API inalteradas.  
> Ver [RC4.3_CONSOLIDACAO_MANIFESTACAO.md](./RC4.3_CONSOLIDACAO_MANIFESTACAO.md).
