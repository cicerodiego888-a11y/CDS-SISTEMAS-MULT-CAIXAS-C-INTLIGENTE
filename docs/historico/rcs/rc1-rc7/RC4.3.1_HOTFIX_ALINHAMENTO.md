# HotFix RC4.3.1 — Alinhamento Arquitetural Final

**Status:** entregue  
**Escopo:** eliminar divergências doc × implementação (sem novas regras fiscais)

## O que mudou

1. **Consulta por chave** — somente leitura; URL via Registry → UrlResolver (igual DF-e/Manifestação).
2. **PUT `/configuracao`** — ignora persistência de endpoints SOAP (consulta/manif/dfe).
3. **Feedback** — `mostrarToastCentral` = alias de `showNotification`; removidos `alert()` no perímetro Central/Centro/Homologação/Fiscal config.
4. **Nomenclatura** — textos de UI usam **Centro de Configurações** (alias interno `configuracoes-avancadas` permanece).

## Persistência

Inalterada: tabela/chave de política, timeouts, sync.  
Endpoints SOAP **não** são mais gravados pela Central.

## Teste

```bash
npm run test:central-entradas-rc4.3.1
npm run test:central-entradas-rc4
npm run test:central-entradas-rc4.1
```
