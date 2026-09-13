# AUDITORIA UX 2.0 — REDESENHO DA NAVEGAÇÃO DO CDS SISTEMAS

**Produto:** CDS Sistemas V1  
**Escopo:** ERP (+ referência PDV) — **somente navegação / UX**  
**Data:** 2026-07-11  
**Tipo:** Auditoria — **sem implementação**, sem alteração de backend/APIs/banco/regras  
**Base:** inventário atual (`frontend/erp/index.html`) + evolução pós Central Inteligente (RC6.x)  
**Antecessor:** [AUDITORIA_UX_NAVEGACAO_CDS_V1.md](./AUDITORIA_UX_NAVEGACAO_CDS_V1.md)

---

## 1. Resumo executivo

A navegação do ERP permanece **flat** (~20 itens no menu lateral), sem agrupamento operacional, com **alias duplicado** (Estoque = Produtos), nomenclaturas ambíguas (“Relatórios / Vendas”) e **vazamento de termos técnicos** (MIIP, Parser, SOAP, DF-e, UrlResolver) para o operador.

A arquitetura oficial já consolidou a **Central Inteligente** como porta de entrada fiscal de documentos recebidos; a UI ainda trata Diagnóstico Central, Compras e Fiscal como irmãos no mesmo nível, sem hierarquia clara.

| Dimensão | Nota (0–100) |
|---|---|
| Agrupamento operacional | 30 |
| Nomenclatura amigável | 42 |
| Separação operador × admin | 35 |
| Consistência de cabeçalho/toolbar | 45 |
| Breadcrumb / deep-link | 15 |
| Alinhamento com arquitetura V1 | 40 |
| **Consistência geral** | **≈ 35%** |

**Parecer:** a navegação **não reflete** a arquitetura pós-Central. Redesign de menu e linguagem é **Crítico** antes de novas features de UI.

---

## 2. Mapa da navegação atual

### 2.1 Fonte de verdade

| Papel | Arquivo |
|---|---|
| Menu HTML | `frontend/erp/index.html` |
| Router SPA | `frontend/erp/js/app.js` + `frontend/shared/js/core.js` |
| ACL | `frontend/shared/js/access-control.js` |

- Sem JSON de menu; sem hash/URL; `data-page` → `loadPage()`.
- Sem submenus no sidebar (tudo no mesmo nível).

### 2.2 Árvore atual (ordem real)

```
CDS ERP
├─ Dashboard
├─ Produtos
├─ Categorias
├─ Estoque                    → mesmo data-page que Produtos (alias)
├─ Compras
├─ Central Inteligente de Entradas   [fiscal]
├─ Diagnóstico Central               [fiscal] [admin]
├─ Clientes
├─ Fornecedores
├─ Financeiro
│   └─ (abas) Dashboard · Receber · Dívidas · Pagar · Histórico · Relatórios
├─ Relatórios / Vendas        → histórico de vendas (não hub de relatórios)
├─ Fiscal                     [fiscal] → NFC-e emitidas / emissão manual
├─ Configurações
│   └─ (links internos) Equipamentos · Lab
├─ Usuários
├─ Lab. Equipamentos
├─ Licença
├─ Auditoria
├─ Fechamento de Caixa
├─ Config. Avançadas          [SUPER_ADMIN]
├─ Gerenciar Caixas           [multiCaixa]
└─ Abrir PDV                  → /pdv
```

### 2.3 Wireframe textual — sidebar atual

```
┌─────────────────────┐
│ CDS · ERP           │
├─────────────────────┤
│ Dashboard           │
│ Produtos            │
│ Categorias          │
│ Estoque ⚠ alias     │
│ Compras             │
│ Central Inteligente │
│ Diagnóstico Central │ ← técnico no topo
│ Clientes            │
│ Fornecedores        │
│ Financeiro          │
│ Relatórios / Vendas │ ← nome enganoso
│ Fiscal              │
│ Configurações       │
│ Usuários            │
│ Lab. Equipamentos   │ ← técnico
│ Licença             │
│ Auditoria           │
│ Fechamento Caixa    │
│ Config. Avançadas   │
│ Gerenciar Caixas    │
│ Abrir PDV           │
├─────────────────────┤
│ usuário · Sair      │
└─────────────────────┘
```

---

## 3. Problemas identificados

### 3.1 Redundantes

| Item | Problema | Prioridade |
|---|---|---|
| Estoque × Produtos | Mesmo `data-page="produtos"` | **Crítica** |
| Diagnóstico Central × aba Diagnóstico na Central | Dois caminhos admin para saúde do módulo | **Alta** |
| MIIP em Compras × aba MIIP / Revisão na Central | Inteligência duplicada na superfície | **Alta** |
| Ícone `fa-cash-register` | Caixa e Abrir PDV iguais | **Baixa** |

### 3.2 Obsoletos / órfãos pós-Central

| Item | Avaliação | Prioridade |
|---|---|---|
| Importação XML como fluxo primário em Compras | Já redireciona/CTA para Central; UI residual confunde | **Alta** |
| Expectativa de “Notas Recebidas” fora da Central | Não há menu legado; ok — mas Fiscal (saída) compete visualmente | **Média** |
| Lab. Equipamentos no menu raiz | Ferramenta técnica; deveria ser Administração | **Alta** |
| Config. Avançadas / Licença / Usuários soltos | Fragmentam Administração | **Alta** |

### 3.3 Menus técnicos visíveis ao operador

| Termo | Onde aparece | Destino sugerido |
|---|---|---|
| MIIP | KPIs, abas, modal “Central de Revisão MIIP”, Compras | Operador: “Identificação de produtos” / “Revisão”; Admin: MIIP |
| Parser | Pipeline, Diagnóstico | Só Administração / Diagnóstico |
| SOAP / UrlResolver | Config SEFAZ, Diagnóstico | Só Administração |
| DF-e | Labels de sync/config | Operador: “Notas da SEFAZ” / “Sincronizar notas” |
| Orchestrator / Background Service | Diagnóstico | Só Administração |
| Diagnóstico Central | Menu raiz | Administração → Saúde da Central |

### 3.4 Padrão visual inconsistente

| Elemento | Situação | Prioridade |
|---|---|---|
| Título + subtítulo | Ad hoc por módulo | **Alta** |
| Toolbar / filtros | Central e Financeiro avançados; outros básicos | **Alta** |
| Grid + painel lateral | Central UX1; demais não | **Média** |
| KPIs | Dashboard, Central, Financeiro; ausentes em Compras/Fiscal/Produtos | **Média** |
| Breadcrumb | Quase inexistente (só Equipamentos) | **Alta** |
| Deep-link URL | Ausente | **Média** |

---

## 4. Mapa da navegação proposta (áreas operacionais)

Alinhado ao pedido (Painel · Comercial · Estoque · Fiscal · Financeiro · Cadastros · Relatórios · Administração), adaptado à arquitetura CDS V1.

### 4.1 Árvore proposta

```
CDS ERP
│
├─ Painel
│   └─ Dashboard
│
├─ Comercial
│   ├─ Abrir PDV                    (ação destacada)
│   ├─ Histórico de Vendas          (hoje: Relatórios / Vendas)
│   └─ Fechamento de Caixa
│
├─ Estoque
│   ├─ Produtos                     (remove alias “Estoque” duplicado)
│   ├─ Categorias
│   └─ Compras                      (lançamento / pedidos de compra)
│
├─ Fiscal
│   ├─ Central de Entradas          (nome amigável; inbox NF-e recebidas)
│   │   └─ (interno) Revisão de produtos · Configuração · Log
│   └─ NFC-e Emitidas               (hoje: Fiscal — saída)
│
├─ Financeiro
│   ├─ Visão geral
│   ├─ Contas a Receber
│   ├─ Contas a Pagar
│   ├─ Gerenciar Caixas             [multiCaixa]
│   └─ Relatórios financeiros       (aba já existente)
│
├─ Cadastros
│   ├─ Clientes
│   └─ Fornecedores
│
├─ Relatórios
│   ├─ Vendas
│   ├─ Financeiros                  (atalho)
│   └─ Fiscais                      (futuro / atalho NFC-e)
│
└─ Administração                    (perfil admin / suporte)
    ├─ Configurações gerais
    ├─ Usuários
    ├─ Licença
    ├─ Equipamentos / Laboratório
    ├─ Configurações avançadas
    ├─ Auditoria
    └─ Saúde da Central             (hoje: Diagnóstico Central)
```

### 4.2 Wireframe textual — sidebar proposta

```
┌──────────────────────────┐
│ CDS · ERP                │
├──────────────────────────┤
│ PAINEL                   │
│   Dashboard              │
│ COMERCIAL                │
│   Abrir PDV              │
│   Histórico de Vendas    │
│   Fechamento de Caixa    │
│ ESTOQUE                  │
│   Produtos               │
│   Categorias             │
│   Compras                │
│ FISCAL                   │
│   Central de Entradas    │
│   NFC-e Emitidas         │
│ FINANCEIRO               │
│   Visão geral            │
│   Contas a Receber       │
│   Contas a Pagar         │
│   Gerenciar Caixas       │
│ CADASTROS                │
│   Clientes               │
│   Fornecedores           │
│ RELATÓRIOS               │
│   …                      │
│ ADMINISTRAÇÃO            │  ← só perfis elevados
│   Configurações          │
│   Saúde da Central       │
│   …                      │
├──────────────────────────┤
│ usuário · Sair           │
└──────────────────────────┘
```

### 4.3 Renomes amigáveis (operador)

| Atual | Proposto (operador) |
|---|---|
| Central Inteligente de Entradas | Central de Entradas |
| Diagnóstico Central | Saúde da Central (só Admin) |
| Relatórios / Vendas | Histórico de Vendas |
| Fiscal | NFC-e Emitidas (ou “Notas emitidas”) |
| Central de Revisão MIIP | Revisão de produtos |
| Precisão MIIP | Precisão da identificação |
| Sincronização DF-e | Buscar notas na SEFAZ |
| Parser / SOAP / UrlResolver | ocultar do operador |

---

## 5. Fluxograma da experiência do usuário

### 5.1 Fluxo atual (problema)

```
Operador abre ERP
  → Menu flat (20 itens)
  → Pode clicar Estoque ou Produtos (mesmo destino)
  → Pode ir a Compras esperando importar XML
  → Ou Central Inteligente
  → Ou Diagnóstico (técnico) no mesmo nível
  → Fiscal = saída NFC-e (confusão com entradas)
  → Sem breadcrumb / sem URL
```

### 5.2 Fluxo proposto — documento fiscal de entrada

```
Operador
  → Fiscal → Central de Entradas
  → Lista / KPIs (linguagem amigável)
  → Abre documento
  → Se resumo: “Aguardando XML completo”
  → Se completo: processa → revisão de produtos (se necessário) → Compras
Admin
  → Administração → Saúde da Central
  → Vê Parser / SOAP / serviços (termos técnicos OK aqui)
```

### 5.3 Fluxo proposto — venda

```
Operador
  → Comercial → Abrir PDV
  → (PDV) vende
  → ERP: Comercial → Histórico de Vendas / Fechamento de Caixa
```

---

## 6. Lista de telas impactadas (somente UI/navegação)

| Tela / `data-page` | Impacto na UX 2.0 |
|---|---|
| `dashboard` | Grupo Painel |
| `produtos` | Grupo Estoque; remover alias Estoque |
| `categorias` | Grupo Estoque |
| `compras` | Grupo Estoque; limpar CTAs/linguagem vs Central |
| `central-entradas` | Grupo Fiscal; renome; esconder jargão no inbox |
| `central-diagnostico` | Mover para Administração |
| `clientes` / `fornecedores` | Grupo Cadastros |
| `financeiro` | Grupo Financeiro (abas já ok) |
| `vendas` | Renome + grupo Comercial/Relatórios |
| `fiscal` | Renome NFC-e + grupo Fiscal |
| `configuracoes` | Administração |
| `usuarios` / `licenca` / `configuracoes-avancadas` | Administração |
| `laboratorio-equipamentos` / `equipamentos` | Administração |
| `auditoria` | Administração |
| `caixa` / `caixas` | Comercial / Financeiro |
| PDV (`/pdv`) | Ação Comercial; revisar itens fantasmas (V1) |

**Não impacta:** APIs, banco, Parser, MIIP core, Fiscal Platform, regras de negócio.

---

## 7. Melhorias sugeridas (classificadas)

### Crítica
1. Remover item de menu **Estoque** alias (ou torná-lo visão real distinta — fora do escopo desta auditoria: só remover duplicata).
2. Introduzir **grupos** no sidebar (áreas operacionais).
3. Tirar **Diagnóstico Central** do menu do operador → Administração.
4. Renomear **Relatórios / Vendas** → Histórico de Vendas.

### Alta
5. Agrupar Configurações / Usuários / Licença / Lab / Avançadas / Auditoria sob **Administração**.
6. Separar visualmente **entradas** (Central) e **saídas** (NFC-e).
7. Glossário operador: substituir MIIP/Parser/DF-e/SOAP em telas operacionais.
8. Cabeçalho padrão: Título + Subtítulo + Toolbar em todos os módulos.
9. Breadcrumb mínimo: Grupo › Tela › Detalhe.

### Média
10. Hub **Relatórios** (atalhos para vendas/financeiro/fiscal).
11. KPIs leves em Compras e Fiscal (saída).
12. Deep-link `#page=` (sem mudar APIs).
13. Unificar CTAs Compras ↔ Central (só linguagem/posição).
14. Ícones únicos por ação (Caixa ≠ PDV).

### Baixa
15. Encurtar “Central Inteligente de Entradas” → “Central de Entradas”.
16. Revisar ordem de abas internas Financeiro vs proposta.
17. Documentar menu em JSON (preparação; implementação futura).

---

## 8. Plano de implementação em sprints (somente UI)

> Nenhuma sprint abaixo altera backend/APIs/banco.

### Sprint UX-A — Higiene crítica (3–5 dias)
- Remover alias Estoque do menu.
- Renomear Relatórios / Vendas.
- Mover Diagnóstico para área admin (mesmo `data-page`, só posição/ACL visual).
- Ajustar labels amigáveis na Central (inbox).

### Sprint UX-B — Menu agrupado (1 sprint)
- Implementar seções no sidebar (HTML ou config JS).
- Reordenar itens conforme mapa §4.
- Destacar Abrir PDV em Comercial.
- Esconder Administração para perfis sem permissão.

### Sprint UX-C — Shell de tela (1 sprint)
- Componente/padrão: Título, Subtítulo, Toolbar, Filtros.
- Breadcrumb compartilhado.
- Aplicar em Dashboard, Compras, Central, Fiscal, Financeiro.

### Sprint UX-D — Linguagem & Relatórios (1 sprint)
- Glossário operador × admin.
- Hub Relatórios (navegação).
- Limpeza de CTAs Compras × Central.
- Ícones e microcopy.

### Sprint UX-E — Deep-link & polish (opcional)
- Sync URL ↔ `data-page`.
- KPIs Compras/Fiscal.
- Menu declarativo (JSON) se desejado.

---

## 9. Critérios de aceite da futura implementação (referência)

- Operador não vê SOAP / Parser / UrlResolver / Orchestrator no menu nem no inbox.
- Um único caminho para notas recebidas: **Fiscal → Central de Entradas**.
- Nenhum alias duplicado no menu.
- Administração concentrada e filtrada por perfil.
- Toda tela principal com Título + Toolbar mínimos.
- Zero mudança de contrato de API.

---

## 10. Entregáveis desta auditoria

| Entregável | Local |
|---|---|
| Relatório completo | este arquivo |
| Canvas interativo | canvas `ux-navegacao-cds-v2` (IDE) |
| Mapa atual / proposto | §§2 e 4 |
| Redundantes / obsoletos | §3 |
| Prioridades | §7 |
| Telas impactadas | §6 |
| Plano de sprints | §8 |

**Nenhuma alteração funcional foi realizada nesta auditoria.**
