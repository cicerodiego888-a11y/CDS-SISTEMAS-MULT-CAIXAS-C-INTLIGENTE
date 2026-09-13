# RC14.15.7 — MGV6 Legacy Flow (atualizado RC14.15.8)

**Status:** SUPERSEDED em semântica por **RC14.15.8**  
Ver: `docs/build/rc14158-correcao-identidade-mgv6.md`

## Regra oficial (RC14.15.8)

```
Produto → PLU (código do item da balança / MGV6) → Integrar → TXITENS.TXT → MGV6
```

- **PLU CDS** = código do item (`ITN_CODIGO` / CCCCCC), **não** `ITN_INFO_PLU`, **não** EAN/GTIN.
- **39** e **12746** são itens MGV6 **distintos**.
- Código MGV6 (RC14.15.5) = **removido da UI** (RC14.15.9); dados DB podem existir e são ignorados no export.

## Caso Milho Grão Kg

| Campo | Valor |
|-------|-------|
| Código interno | 012841 |
| PLU | 39 |
| Integrar | SIM |
| Bloco TX | `000000039` |
| CCCCCC | `000039` |
