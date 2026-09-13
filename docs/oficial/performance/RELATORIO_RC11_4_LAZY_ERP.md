# RELATÓRIO RC11.4 — ERP LAZY LOADER

**Data:** 2026-07-26  
**Status:** Implementação controlada  
**Confidence:** 1.00  

---

## 1. Resumo executivo

O ERP deixou de executar globalmente os scripts de todos os módulos durante o
boot. O novo loader em `frontend/erp/js/app.js` carrega os arquivos em ordem,
na primeira abertura da página, e reutiliza uma `Promise` única por URL.

Resultados:

- **45 scripts** retirados da execução do boot;
- **1.801,8 KB** adiados;
- boot obrigatório reduzido para **20 scripts / 357,4 KB**;
- abertura inicial (Grupo A + Dashboard) limitada a **23 scripts / 598,5 KB**;
- redução de aproximadamente **72%** do payload JavaScript da abertura inicial
  contra o cenário eager anterior (~2.159 KB);
- Homologação da Central e Configuração TEF são Grupo C real: carregam apenas
  quando a funcionalidade é acionada;
- referências continuam no `index.html` como `application/cds-lazy`, preservando
  o manifesto e a integridade do pacote Electron.

Não houve alteração de regras de negócio, APIs, banco ou código Electron.

---

## 2. Fase 1 — Inventário

### 2.1 Grupo A — obrigatório no boot

| Script | KB | Dependência / motivo | Momento | Lazy |
|---|---:|---|---|---|
| `vendor/jquery/jquery.min.js` | 87,4 | Base dos módulos legados | Boot | Não |
| `vendor/bootstrap/js/bootstrap.bundle.min.js` | 76,3 | Modais/componentes globais | Boot | Não |
| `shared/js/brand-service.js` | 3,4 | Identidade visual | Boot | Não |
| `shared/js/validarMotivo.js` | 4,8 | Validação compartilhada | Boot | Não |
| `shared/js/modalDevolucaoVenda.js` | 9,3 | Contrato global de modal | Boot | Não (safe) |
| `shared/js/access-control.js` | 9,4 | Permissões | Antes da navegação | Não |
| `shared/js/caixaPermissoes.js` | 5,4 | Gates de caixa | Antes da navegação | Não |
| `shared/js/cds-page-shell.js` | 6,0 | Cabeçalho das páginas | Boot | Não |
| `shared/js/cds-smart-select.js` | 9,7 | Componente compartilhado | Boot | Não (safe) |
| `shared/js/core.js` | 41,0 | Auth, API, shell e navegação | Boot | Não |
| `shared/js/cds-nomenclatura.js` | 3,3 | Nomenclatura global | Boot | Não |
| `shared/js/modoFiscalHelpers.js` | 4,1 | Estado fiscal global | Boot | Não |
| `shared/js/cds-formas-pagamento.js` | 8,2 | Contrato compartilhado | Boot | Não |
| `AdaptiveLabelRegistry.js` | 8,8 | Design System | Boot | Não |
| `AdaptiveLabelContext.js` | 2,3 | Design System | Boot | Não |
| `AdaptiveLabelService.js` | 4,9 | Design System | Boot | Não |
| `AdaptiveLabelProvider.js` | 2,3 | Design System | Boot | Não |
| `cds-ui-foundation.bundle.js` | 49,5 | Componentes base | Boot | Não |
| `erp/js/app.js` | 16,7 | Roteador + lazy loader | Boot | Não |
| `shared/js/cds-plataforma-status.js` | 4,5 | Rodapé/saúde global | Boot | Não |

**Total Grupo A:** 20 scripts, aproximadamente 357,4 KB.

### 2.2 Grupos B e C — inventário lazy

| Script | KB | Dependência principal | Uso real | Grupo |
|---|---:|---|---|---|
| `vendor/chart.js/chart.min.js` | 203,6 | Dashboard | Primeira abertura Dashboard | B |
| `dashboard-command.js` | 17,9 | Core/UI | Dashboard | B |
| `dashboard.js` | 19,5 | Chart.js | Dashboard | B |
| `produtos.js` | 232,4 | jQuery/Core/SmartSelect | Produtos | B |
| `subcategorias.js` | 1,3 | Produtos/Categorias | Produtos ou Categorias | B |
| `clientes.js` | 20,2 | Core | Clientes | B |
| `fornecedores.js` | 12,8 | Core | Fornecedores | B |
| `miip-central-revisao.js` | 26,4 | Bootstrap/Core | Compras ou Central | B |
| `compras.js` | 116,3 | MIIP revisão/Core | Compras | B |
| `central-entradas-ux.js` | 47,2 | Core/UI | Central de Entradas | B |
| `central-entradas.js` | 210,5 | UX/MIIP/Core | Central de Entradas | B |
| `central-homologacao.js` | 18,1 | Central | Clique “Ciclo DF-e” | **C** |
| `central-diagnostico.js` | 18,2 | Core | Saúde da Central | B |
| `fiscalImpressao.js` | 12,1 | Core | Vendas/Config/Fiscal/NF-e | B compartilhado |
| `vendasHistoricoUi.js` | 8,8 | Fiscal impressão | Histórico de Vendas | B |
| `vendas.js` | 19,6 | Histórico/UI | Histórico de Vendas | B |
| `pdv/js/entregas.js` | 18,6 | Core | Entregas no ERP | B |
| `faturamento.js` | 57,2 | Core | Expedição | B |
| `central-faturamento.js` | 44,2 | Core | Central Faturamento | B |
| `pedidos.js` | 51,8 | Core | Pedidos | B |
| `financeiro-dashboard.js` | 9,7 | Financeiro | Financeiro | B |
| `financeiro-receber.js` | 38,8 | Financeiro | Financeiro | B |
| `financeiro-pagar.js` | 42,8 | Financeiro | Financeiro | B |
| `financeiro-historico.js` | 4,0 | Financeiro | Financeiro | B |
| `financeiro-relatorios.js` | 18,7 | Financeiro | Financeiro | B |
| `financeiro.js` | 24,5 | Cinco submódulos acima | Financeiro | B |
| `configuracaoRede.js` | 16,3 | Core | Configurações | B compartilhado |
| `configuracoes.js` | 55,4 | Rede/Fiscal impressão | Configurações | B |
| `cds-centro-configuracoes.js` | 50,7 | Configurações | Centro de Configurações | B |
| `configuracao_tef.js` | 47,1 | Centro de Configurações | Clique “Configuração TEF” | **C** |
| `cds-monitoring-engine.js` | 35,7 | Core | Monitoramento | B |
| `usuarios.js` | 31,4 | Core | Usuários | B |
| `equipamentos.js` | 55,1 | Core | Equipamentos | B |
| `central-equipamentos.js` | 17,6 | Core | Central Equipamentos | B |
| `laboratorio-equipamentos.js` | 23,7 | Core/Bootstrap | Laboratório | B |
| `categorias.js` | 4,3 | Subcategorias | Categorias | B |
| `fiscal.js` | 37,9 | Fiscal impressão | NFC-e emitidas | B |
| `nfe-central.js` | 38,9 | Fiscal impressão | NF-e emitidas | B |
| `central-contabil.js` | 7,2 | Core | Central Contábil | B |
| `nfe-avulsa.js` | 19,4 | Core | Nova NF-e | B |
| `nfe-operacional.js` | 12,9 | Core | Monitor/Fila/Diagnóstico NF-e | B compartilhado |
| `caixa.js` | 24,3 | Core | Fechamento de Caixa | B |
| `licenca.js` | 6,2 | Core | Assinatura | B |
| `auditoria.js` | 5,2 | Core | Auditoria | B |
| `caixas.js` | 16,4 | Core | Gerenciar Caixas | B |

**Total lazy:** 45 arquivos únicos, 1.801,8 KB.

---

## 3. Fase 2 — Classificação

### Grupo A

Framework, autenticação, controle de acesso, shell, design system, estado fiscal,
roteador e status da plataforma.

### Grupo B

Scripts declarados em `CDS_ERP_PAGE_SCRIPTS`. São carregados na primeira
abertura do módulo e reutilizados nas demais navegações.

### Grupo C

- `central-homologacao.js`: somente ao abrir a visão `ciclo-dfe`;
- `configuracao_tef.js`: somente ao clicar em Configuração TEF.

---

## 4. Fase 3 — Implementação

### Cache e concorrência

O loader mantém:

- `Map<url, { promise, reuses, loadMs }>`;
- uma única `Promise` por URL;
- remoção do cache após erro para permitir retry;
- execução sequencial para preservar a ordem histórica;
- descarte de render atrasado quando o usuário muda de página durante a carga.

### Compatibilidade

`window.loadPage(page)` permanece como API pública. Agora retorna uma `Promise`,
sem alterar os chamadores existentes.

Os marcadores:

```html
<script type="application/cds-lazy" src="/erp/js/produtos.js"></script>
```

não executam no parser HTML, mas continuam detectáveis pelo gerador de manifesto
Electron. O teste RC3.16.5 confirmou que todos os arquivos seguem presentes no
build.

### Acoplamento corrigido

`minimizarModal`, usado por Produtos, Compras, Pedidos e Faturamento, foi movido
de `produtos.js` para `app.js`. Isso evita carregar 232,4 KB de Produtos apenas
para disponibilizar um helper compartilhado. O comportamento foi preservado.

---

## 5. Fase 4 — Métricas

| Métrica | Resultado |
|---|---:|
| Scripts retirados da execução do boot | **45** |
| Payload adiado | **1.801,8 KB** |
| Grupo A obrigatório | **20 scripts / 357,4 KB** |
| Primeira tela Dashboard | **3 scripts / 241,1 KB** |
| Total abertura inicial | **23 scripts / 598,5 KB** |
| Redução de payload inicial | **~72%** |
| Compilação eager cold evitada (V8 local) | **~18,0 ms** |
| Compilação cold do pacote Dashboard | **~0,04 ms** |
| Reutilização média do pacote (1.000 hits) | **~0,0033 ms** |
| Novas tags na segunda abertura | **0** |

Os tempos de rede/disco do navegador variam por instalação. O loader registra
o tempo real em `CdsErpLazyLoader.getPageStats(page)` e nos logs
`[ERP LAZY] MODULE CREATED/REUSED`.

---

## 6. Fase 5 — Validação

### Aprovados

| Área | Validação | Resultado |
|---|---|---|
| ERP Lazy | `node tests/rc11-4-lazy-erp.test.js` | **OK** |
| ERP scripts | `node --check` em 41 scripts ERP + Entregas | **OK** |
| ERP/Faturamento | Sprint 3.1 | 8/8 |
| ERP/NF-e | Sprint 3.3 | 8/8 |
| Central Faturamento | RC4.0.1 | 8/8 |
| Central | `test:central-entradas-sprint5` | 7/7 |
| Compras | `test:mip-sprint07` | 9/9 |
| PDV | `test:mip-sprint09` | 8/8 |
| Fiscal QR Code | `test:fiscal-qrcode` | 9/9 |
| Fiscal V4 | `rc410-congelamento-v4` | 6/6 |
| Electron | `test:rc3165-electron` | OK |
| Electron integral | `test:rc3166-electron` | OK |

Financeiro não possui suíte dedicada no repositório. Foram validados o manifesto,
a ordem das seis dependências, a sintaxe e o contrato `initFinanceiro`.

### Falhas de baseline não relacionadas

As suítes agregadas também foram executadas e expuseram três expectativas
anteriores, todas fora dos arquivos alterados pela RC11.4:

1. `test:fiscal-platform`: espera 24 operações, implementação atual retorna 26;
2. `test:central-integridade`: espera o texto `Configurações Avançadas` no JS;
3. `sprint35-pedidos-ui`: procura `page === 'pedidos'` em `core.js`, embora o
   roteamento atual esteja em `erp/js/app.js`.

Essas falhas foram registradas e não corrigidas para respeitar a proibição de
alterar regras, APIs e módulos fora do escopo. Os testes diretamente impactados
pela RC11.4 estão aprovados.

---

## 7. Critérios de sucesso

| Critério | Status |
|---|---|
| Boot do ERP significativamente menor | ✓ 72% menos payload inicial |
| Scripts carregados somente quando necessários | ✓ Grupos B e C |
| Primeira abertura cria; demais reutilizam | ✓ |
| Nenhuma regressão nos testes impactados | ✓ |
| APIs, banco e Electron inalterados | ✓ |
| Todas as suítes agregadas do repositório verdes | ⚠ 3 falhas de baseline documentadas |

---

## 8. Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `frontend/erp/index.html` | scripts opcionais viraram marcadores lazy |
| `frontend/erp/js/app.js` | manifesto, loader, cache, métricas e helper global |
| `frontend/erp/js/produtos.js` | remoção do helper compartilhado duplicado |
| `frontend/erp/js/central-entradas.js` | Grupo C Homologação |
| `frontend/erp/js/cds-centro-configuracoes.js` | Grupo C TEF |
| `tests/rc11-4-lazy-erp.test.js` | regressão e métricas RC11.4 |
| `docs/oficial/performance/RELATORIO_RC11_4_LAZY_ERP.md` | este relatório |

*Fim do RELATORIO_RC11_4_LAZY_ERP.md*
