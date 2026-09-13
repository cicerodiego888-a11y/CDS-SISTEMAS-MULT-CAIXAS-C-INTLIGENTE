# RC14.15.15 — Correção definitiva da busca por PLU no PDV

**Status:** IMPLEMENTADA  
**Banco:** 0 alterações · **Migration:** NÃO  
**MGV6 / TCP / Motor Comercial / Estoque / Fiscal:** intocados  

---

## Causa corrigida

1. Debounce podia resolver tecla intermediária (`3`) e deixar estado confirmável (`match_exato` / `ultimoMipBusca`).  
2. Enter/clique podiam confirmar resultado de termo antigo.  
3. MIB (`CatalogSnapshot` / `HotCache`) usava `includes` em PLU/código para termos numéricos.

## Correção

- **Termo atual = autoridade** (`termoDosResultados`, `_termoOrigem`, `respostaAindaValida`).  
- Invalidação imediata ao mudar o input.  
- Confirmação só se origem === termo atual e identificador **exato**.  
- MIB: termo só dígitos → match numérico exato (sem substring).  
- Label/placeholder do PDV incluem PLU.

## Arquivos

- `frontend/shared/js/pdvBuscaProduto.js`
- `frontend/pdv/pages/pdv.html`
- `backend/motores/mib/catalog/CatalogSnapshot.js`
- `backend/motores/mib/cache/HotCache.js`
- `tests/pdv/rc141515-busca-plu-exata-v1.test.js`
