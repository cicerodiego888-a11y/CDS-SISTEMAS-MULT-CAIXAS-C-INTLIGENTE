# RC3.2 — Centro de Configurações do CDS Sistemas

**Data:** 2026-07-14  
**Tipo:** UX / organização / padronização visual  
**Escopo:** Sem alteração de regras fiscais, MIIP, Plataforma Fiscal, SOAP, XML, emissão, banco ou comportamento de APIs.

## Objetivo

Transformar **Configurações Avançadas** no **Centro de Configurações do CDS Sistemas**, alinhado ao Design System da Central Inteligente, Dashboard e Diagnóstico.

## Arquitetura de configuração (inalterada na lógica)

```
Configurações Avançadas / Centro → Fiscal (fonte oficial)
        ↓
getFiscalConfig()  → fiscal_ambiente
        ↓
Central Inteligente (somente leitura) / Emissão / DF-e / Plataforma (parâmetro)
```

RC3.1 permanece: **existe apenas uma configuração fiscal**.

**RC4.3:** a política `manifestacao_destinatario_politica` (persistida em `central_entradas_config`)
passa a ser **editada** em Fiscal → Manifestação do Destinatário; a Central apenas consome (somente leitura).

## Fluxo da interface

```
Hero institucional (versão · empresa · usuário · ações · busca)
        ↓
Painel executivo (KPIs: Empresa · Ambiente · SEFAZ · Cert · MIIP · Plataforma · Central · Serviços)
        ↓
Shell: menu lateral + painéis por categoria
        ↓
Fiscal (cards editáveis) | Plataforma (RO) | Central (RO + atalho) | …
```

## Categorias

Geral · Empresa · Fiscal · Plataforma Fiscal · Central Inteligente · Equipamentos · Integrações · Segurança · Performance · Backup · Aparência · Avançado

## Antes × Depois

| Antes | Depois |
|---|---|
| Formulário único vertical | Menu lateral + painéis |
| Título “Configurações Avançadas” | “Configurações do CDS Sistemas” |
| Fiscal embutido em lista plana | Cards (Ambiente, Emitente, Cert/CSC, URLs) |
| Sem painel de saúde | Painel executivo com KPIs |
| Sem busca | Pesquisa global por categoria/campo |
| Central editava ambiente (pré-RC3.1) | Central RO + botão “Abrir Configuração Fiscal” |

## Arquivos

| Arquivo | Papel |
|---|---|
| `frontend/css/cds-centro-configuracoes.css` | Design System do Centro |
| `frontend/erp/js/cds-centro-configuracoes.js` | Shell UX (header, KPIs, nav, busca) |
| `frontend/erp/js/configuracoes.js` | Delega render ao Centro |
| `frontend/erp/js/fiscal.js` | Layout em cards no embed do Centro |
| `frontend/erp/js/central-entradas.js` | Botão UX “Abrir Configuração Fiscal” |
| `frontend/erp/index.html` | CSS/JS + rótulo do menu |

## Critérios / Readiness

| Critério | Status |
|---|---|
| Visual alinhado ao DS CDS | OK |
| Fonte fiscal única (RC3.1) | OK |
| Central apenas consome | OK |
| Layout cards + grid | OK |
| Pesquisa global | OK |
| Painel executivo | OK |
| Sem novas regras / APIs / banco | OK |
| Plataforma Fiscal intacta | OK |

## Manual rápido

1. Menu **Centro de Configurações** (SUPER_ADMIN).
2. Use a busca: `certificado`, `CSC`, `homologação`, `TEF`, `MIIP`, etc.
3. Edite Ambiente/UF/Cert/CSC apenas em **Fiscal**.
4. Na Central, use **Abrir Configuração Fiscal** para ir direto à fonte oficial.

**Aguardar aprovação formal antes da próxima Sprint.**
