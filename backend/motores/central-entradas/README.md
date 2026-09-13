# Central Inteligente de Entradas

**Versão:** `1.0.0-rc6.5` · Migração legados RC6.5 · Config Enterprise RC4  
**Módulo:** Caixa de Entrada Fiscal — **única porta oficial** de documentos fiscais  
**Status:** Congelada (Arquitetura CDS V1)

### RC6.1 — Classificador DF-e (preparação)

`DocumentoDfeClassifier` identifica a raiz do XML (`RES_NFE`, `PROC_NFE`, `NFE`, `PROC_EVENTO_NFE`, `RES_EVENTO`, `DESCONHECIDO`) na persistência DF-e **apenas com log**. Não altera status, pipeline, Parser, MIIP nem Compras.

### RC6.2 — RES_NFE inteligente

`RES_NFE` → status `AGUARDANDO_XML_COMPLETO` (sem Parser/MIIP/ERRO).  
`PROC_NFE` / `NFE` → pipeline oficial inalterado.

```
SEFAZ
  ↓
Classificador (RC6.1)
  ├─ RES_NFE → AGUARDANDO_XML_COMPLETO (aguarda XML completo)
  └─ PROC_NFE / NFE → SINCRONIZADA → Pipeline (Parser → MIIP → …)
```

### RC6.3 — XML completo no mesmo documento

`CentralDocumentoAtualizacaoService` atualiza o registro existente (mesma chave/id):

```
AGUARDANDO_XML_COMPLETO + PROC_NFE/NFE
  ↓
Atualiza XML/metadados (mesmo id)
  ↓
Histórico: "XML completo recebido." / "Documento atualizado."
  ↓
SINCRONIZADA → Pipeline oficial (único)
```

Nunca cria segundo documento para a mesma NF-e.

### RC6.5 — Migração de Documentos Legados

**Motivo:** documentos criados antes da RC6.2 ficaram com `tipo_documento = NULL`, `status = SINCRONIZADA` (ou `ERRO` após Parser) e XML `<resNFe>`, entrando indevidamente no Parser (`NFE_INVALIDA`).

**Critérios (todos):**
- `tipo_documento` nulo
- `status` ∈ `SINCRONIZADA` | `ERRO` (ERRO = mesmo legado já processado)
- XML classificado como `RES_NFE` (ou raiz `<resNFe`)

**Nunca migra:** `NFE`, `PROC_NFE`, `PROC_EVENTO_NFE`, `RES_EVENTO`, `GRAVADA`, `EM_COMPRA`, `DESCARTADA`, etc.

**Efeito:** `tipo_documento = RES_NFE`, `status = AGUARDANDO_XML_COMPLETO` (mesmo id/XML/chave/NSU/origem). Histórico + evento `DOCUMENTO_MIGRADO` (`MIGRACAO_RC65`). Sem Parser/MIIP/Compras.

**Idempotência:** segunda execução não altera os já migrados (`analisados/migrados = 0`).

```
POST /api/central-entradas/admin/migrar-legado
→ { analisados, migrados, ignorados, erros }
```

## Pipeline oficial

```
SEFAZ (DF-e) / Upload XML / Consulta chave
    ↓
DocumentoDfeClassifier
    ├─ RES_NFE → AGUARDANDO_XML_COMPLETO  (aguarda PROC_NFE/NFE)
    │                 ↓ (RC6.3 mesmo id)
    │            SINCRONIZADA
    └─ PROC_NFE / NFE → SINCRONIZADA
    ↓
CentralProcessamentoService (Parser Oficial → MIIP)  ← só NFE/PROC_NFE
    ↓
Revisão MIIP (somente se houver pendências)
    ↓
POST /:id/finalizar-entrada  (caso de uso único)
    ├─ conclui revisão se EM_REVISAO
    ├─ PRONTA_IMPORTACAO (estado interno)
    └─ EM_IMPORTACAO + payload Bridge → abre Compras
    ↓
Usuário confere e Salva Compra (Motor de Compras)
    ↓
Orchestrator.vincularCompra → IMPORTADA/GRAVADA
    ↓
ERP

[RC6.5] Legados RES_NFE (tipo NULL + SINCRONIZADA|ERRO)
    → AGUARDANDO_XML_COMPLETO (sem Parser)
```

Documentos em `EM_IMPORTACAO` interrompidos (tela fechada sem salvar) reaparecem na Central com **Retomar Importação** — sem duplicar compra.
## Configuração Enterprise (RC4)

Provider oficial único: **`CentralConfiguracaoService`**.

```
Tela Configuração (6 abas)
    ↓
GET/PUT /api/central-entradas/configuracao
    ↓
CentralConfiguracaoService
    ↓
central_entradas_config
    ↓
Sync DF-e (contextoCentral)
```

`CentralConfigService` é **adapter interno de sync** — não deve ser usado fora de `CentralConfiguracaoService`.

## Estrutura

```
motores/central-entradas/
├── CentralEntradasService.js           # Facade
├── CentralEntradasOrchestrator.js      # Orchestrator único (1.0.0-rc4)
├── controllers/CentralConfiguracaoController.js
├── config/
├── contracts/
├── core/                               # Estados + máquina
├── repositories/                       # + CentralConfiguracaoRepository
├── services/                           # Config, Sync, Processamento, Diagnóstico…
└── utils/                              # eventos, logs, mappers
```

## API consolidada (RC4)

| Método | Rota | Descrição |
|---|---|---|
| GET/PUT | `/configuracao` | Painel Enterprise (6 módulos) |
| POST | `/configuracao/testar-sefaz` | Teste SEFAZ via Fiscal Platform |
| POST | `/configuracao/testar-certificado` | Teste certificado |
| POST | `/configuracao/health` | Health check |
| POST | `/configuracao/limpar-cache` | Limpar cache diagnóstico |
| GET | `/inteligencia` | Alertas + operacional + pendências + atenção (1 cálculo) |
| GET | `/operacional` | KPIs operacionais |
| GET | `/alertas` | Alertas |
| GET | `/pendencias` | Pendências |
| GET | `/atencao` | Itens de atenção |

## Testes

```bash
npm run test:central-integridade
npm run test:central-entradas-rc4
```

Documentação: [`docs/fiscal/CENTRAL_ENTRADAS_ARQUITETURA.md`](../../../docs/fiscal/CENTRAL_ENTRADAS_ARQUITETURA.md) · [`docs/arquitetura/ARQUITETURA_OFICIAL_CDS_V1.md`](../../../docs/arquitetura/ARQUITETURA_OFICIAL_CDS_V1.md)
