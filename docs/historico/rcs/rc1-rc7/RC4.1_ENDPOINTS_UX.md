# RC4.1 — Refinamento UX dos Endpoints SEFAZ

**Status:** entregue  
**Escopo:** apresentação na aba SEFAZ da Central  
**Fora de escopo:** Plataforma Fiscal, Registry, UrlResolver, SoapTransport, Runtime, banco, regras fiscais

## Problema

1. Campos Manifestação Produção/Homologação apareciam vazios (KV legado), sugerindo erro de configuração.
2. Badges contraditórios: “Manifestação integrada” + “Manifestação desativada”.

## Solução

- Painel passa a exibir a URL **efetivamente resolvida** via `FiscalWebServices.resolve` (mesmo caminho Registry → UrlResolver usado em runtime), **somente leitura**.
- Se não houver resolução: texto `Endpoint não resolvido` + badge amarelo (nunca campo em branco).
- Um único badge de política: Automática / Manual / Solicitar Confirmação.
- Tooltip explicativo + card informativo da Plataforma Fiscal.

**RC4.3:** a edição da política saiu da aba SEFAZ da Central e passou ao Centro de Configurações → Fiscal. A Central apenas exibe o modo atual (somente leitura).

**RC4.3.1:** todos os endpoints SEFAZ na Central (DF-e, Consulta chave, Manifestação) são somente leitura; resolução exclusiva da Plataforma Fiscal (Registry → UrlResolver).

## Teste

```bash
npm run test:central-entradas-rc4
npm run test:central-entradas-rc4.1
npm run test:central-entradas-rc4.3.1
```
