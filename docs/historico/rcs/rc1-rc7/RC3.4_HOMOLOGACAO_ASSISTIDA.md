# RC3.4 — Homologação Assistida da Central Inteligente

**Status:** entregue  
**Escopo:** observabilidade operacional do ciclo DF-e (somente leitura)  
**Fora de escopo:** regras fiscais, Plataforma Fiscal, Parser, MIIP, emissão, alterações estruturais de banco

## Objetivo

Permitir acompanhar, em tempo real, cada etapa do ciclo DF-e durante a homologação oficial junto à SEFAZ.

## APIs (somente leitura)

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/central-entradas/homologacao/painel` | Monitor + health + diagnóstico SEFAZ + métricas + checklist |
| GET | `/api/central-entradas/homologacao/metricas` | Tempos médios entre etapas |
| GET | `/api/central-entradas/homologacao/:id/inspecionar` | Inspeção completa do documento |
| GET | `/api/central-entradas/homologacao/:id/exportar?formato=json\|txt` | Relatório técnico |

`GET /eventos` aceita `documento_id` para filtrar por documento.

## UI

Nova view **Monitor de Ciclo DF-e** (ícone project-diagram no header da Central):

1. Monitor (NSU, chave, fornecedor, tipo, estado, tempos, última SEFAZ, health)
2. Diagnóstico SEFAZ (137, 656, sucesso, timeout, manifestação, PROC_NFE)
3. Métricas (médias RES→Ciência→PROC→Parser→MIIP→Compra)
4. Checklist de homologação
5. Modal **Inspecionar Documento** (schema, XML preview, timeline, eventos, exportação)

## Health

| Indicador | Significado |
|-----------|-------------|
| 🟢 | Fluxo saudável |
| 🟡 | Aguardando PROC_NFE |
| 🟠 | Cooldown ativo |
| 🔴 | Erro |

## Fontes de dados

Agrega `central_entradas_documentos`, `central_entradas_eventos`, `central_entradas_historico` e `central_entradas_nsu` — **sem novas tabelas** e sem colunas novas nesta sprint (telemetria já presente em eventos / NSU pós-RC3.3.3).

## Teste

```bash
npm run test:central-entradas-rc3.4
```

## Critérios de aceite

- [x] Nenhuma alteração em regras fiscais
- [x] Nenhuma alteração na Plataforma Fiscal / Parser / MIIP / emissão
- [x] Observabilidade completa (monitor + timeline + telemetria + diag SEFAZ)
- [x] Exportação JSON/TXT
- [x] Checklist na interface
- [x] Pronto para homologação assistida com SEFAZ
