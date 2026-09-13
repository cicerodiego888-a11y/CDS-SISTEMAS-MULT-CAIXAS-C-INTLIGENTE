# RC3.3.3 — Exceções de Fallback (Central Inteligente)

## Política oficial da Central

```text
Runtime (manifestacaoRuntime)
  → Plataforma Fiscal (FiscalWebServices)
    → Registry / UrlResolver
      → SoapTransport
        → SEFAZ
```

A Central **aceita** somente respostas com:

- `fallbackUtilizado === false`
- `source` diferente de `FALLBACK`

## O que a Plataforma Fiscal ainda possui (não alterado nesta sprint)

A Plataforma Fiscal mantém fallback interno para `manifestacaoLegado` (axios SOAP paralelo) quando resolve/transport falham. **Esta sprint não altera** Registry, UrlResolver, SoapTransport nem `manifestacaoRuntime`.

## Exceção documentada

| Camada | Comportamento | Ação da Central |
|--------|---------------|-----------------|
| `manifestacaoRuntime` | Pode retornar `fallbackUtilizado: true` | **Rejeita** o retorno e grava `MANIFESTACAO_REJEITADA` (`FALLBACK_REJEITADO`) |
| DistDFe (`distribuicaoDfeRuntime`) | Pode usar legado interno | Orquestração Central (`distribuicaoDFe.js`) preserva NSU e usa mutex; não altera o runtime |
| Diagnóstico SEFAZ | Probe DistNSU | Executa sob o **mesmo mutex** da sync; **não** persiste NSU |

## Por que o legado não foi removido da Plataforma

Restrição explícita da RC3.3.3: não alterar a Plataforma Fiscal. O bypass arquitetural foi eliminado **no perímetro da Central**, que é a dona do ciclo RES_NFE → Ciência → DistDFe.

## Remoção futura recomendada (fora desta sprint)

Uma sprint da Plataforma Fiscal pode remover `manifestacaoLegado` / `distribuicaoDfeLegado` após métricas de estabilidade do SoapTransport em produção.
