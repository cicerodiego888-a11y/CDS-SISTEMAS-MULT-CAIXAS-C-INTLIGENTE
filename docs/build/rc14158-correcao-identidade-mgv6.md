# RC14.15.8 — Correção definitiva da identidade MGV6 / PLU

**Status:** IMPLEMENTADO (UI Código MGV6 removida na **RC14.15.9**)  
**Banco alterado:** 0  
**Migration:** NÃO  
**TXITENS layout:** NÃO alterado  
**TCP:** NÃO alterado  

> RC14.15.9: o campo Código MGV6 foi removido da interface. O código do TXITENS é exclusivamente o PLU/código do item da balança. Ver `rc14159-remocao-codigo-mgv6.md`.

---

## Problema identificado

A RC14.15.5 introduziu “Código MGV6” (`tipo=MGV6`) como identidade artificial. Fixtures e docs trataram **PLU 39** e **código 12746** como dualidade do *mesmo* SKU. A auditoria RC14.15.7-AUDIT (SQL `MGV6_0001`) comprovou o contrário.

## Evidência SQL

| ITN_CODIGO | Descrição | Preço | INFO_PLU | BAL_CODIGO | IP |
|------------|-----------|-------|----------|------------|-----|
| **39** | Milho Grão Kg | 2,79 | NULL | 39 | 10.0.0.170 |
| **12746** | Milho Grao | 2,50 | NULL | 97 | 10.0.0.170 |

ERP legado (SKU CDS): interno **012841**, “Gtin” **39**, Integrar SIM → alinha a `ITN_CODIGO=39`.

## Alteração realizada

| Área | Mudança |
|------|---------|
| `MGV6IdentityResolver` | Semântica oficial: PLU = código do item; prioridade PLU > legado MGV6; sem EAN/interno |
| UI produto | Label `PLU / Código do item da balança`; Código MGV6 legado/opcional |
| Fixtures | 39 e 12746 separados; removida nota “PLU CDS 39 ≠ MGV6 12746” |
| Logs | “PLU (código do item da balança)” |
| Testes | `rc14158-mgv6-identidade-plu-v1.test.js` + compat atualizado |
| Docs | este arquivo + ponteiros em rc14155/rc14157 |

**Não criado:** novo campo, nova tabela, `tbItemBalanca` no CDS, migration.

## Comportamento antes × depois

| Cenário | Antes (hipótese RC14.15.5) | Depois (RC14.15.8) |
|---------|----------------------------|---------------------|
| Milho 012841 | Exigia Código MGV6 ou confundia com 12746 | PLU **39** → `000000039` |
| 12746 | “outro código do mesmo produto” | Item **independente** (PLU 12746) |
| Sem PLU + Integrar | Identity required / MGV6 | `MGV6_PRODUCT_PLU_REQUIRED` |
| EAN / interno | — | Nunca fallback |
| codigo_mgv6 | Primário | Só legado, nunca vence PLU |

## Caso 39

```
codigo: 012841
nome: Milho Grão Kg
plu: 39
integrar_balanca: 1
(sem codigo_mgv6)
→ identidade 39
→ CCCCCC 000039
→ bloco 000000039
→ TXITENS 320 chars
```

## Caso 12746

```
nome: Milho Grao
plu: 12746
integrar_balanca: 1
→ identidade 12746
→ bloco 000012746
```

## TX gerado (layout mantido)

- Arquivo: `TXITENS.TXT`
- Registro: 320 + CRLF externo
- Encoding: WINDOWS-1252
- Bloco posicional: TT+Z+CCCCCC (9 chars) — **não** entidade “código MGV6 de 9 dígitos”

## Testes

Ver execução na entrega da RC. Suites: MGV6 (legacy-compat, txitens, v1, operational, legacy-flow, identidade-plu) + TCP (driver-identity, adapter, connection, protocol, certification).

## Confirmação TCP

Nenhum arquivo do pipeline Toledo TCP (`ToledoPrixIVDriver`, `ConnectionManager`, protocol/90AX, `PluController`, Discovery, Fingerprint) foi modificado nesta RC.
