# RC4.3 — Consolidação da Configuração Oficial da Manifestação

**Status:** entregue  
**Escopo:** reorganização UX (sem nova funcionalidade fiscal)

## Fonte oficial (inalterada)

| Item | Valor |
|------|--------|
| Tabela | `central_entradas_config` |
| Chave | `manifestacao_destinatario_politica` |
| API | `GET/PUT /api/central-entradas/configuracao` |
| Campo | `politicaManifestacao` |

## UX

| Antes | Depois |
|-------|--------|
| Edição na Central → Config → SEFAZ (select) | Edição no **Centro de Configurações → Fiscal → Manifestação** |
| Usuário perdia a configuração | Botão **Abrir Configuração Fiscal** abre direto o card |
| Central editava política | Central **somente leitura** + painel de status |

## Persistência

A configuração **continua armazenada na Central** (`central_entradas_config`).  
Apenas a **interface de edição** foi movida para o Centro de Configurações.

## HotFix RC4.3.1

Endpoints SEFAZ na Central (incluindo **Consulta chave**) passaram a somente leitura, resolvidos pela Plataforma Fiscal. Nenhuma nova persistência. Ver [RC4.3.1_HOTFIX_ALINHAMENTO.md](./RC4.3.1_HOTFIX_ALINHAMENTO.md).
