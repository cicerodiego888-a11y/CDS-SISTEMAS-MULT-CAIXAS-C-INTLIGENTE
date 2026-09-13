# RC14.15.5 — Compatibilidade MGV6 Legado V1.0

**Status:** IMPLEMENTADO — COMPATIBILIDADE INICIAL  
**Não declarar:** MGV6 HOMOLOGADO (sem teste físico comprovado)

## Objetivo

Reproduzir no CDS a lógica do sistema antigo do cliente para alimentar o MGV6 / balança Toledo **sem reinventar** o protocolo e **sem alterar TCP**.

```
CDS → Identidade MGV6 → TXITENS.TXT → MGV6 → Balança Toledo
```

## Descoberta fundamental

O código usado no `TXITENS.TXT` legado **não** é automaticamente:

- EAN / GTIN comercial
- código interno CDS
- código de barras
- PLU atual do CDS

Exemplo comprovado:

| Produto | Legado (Gtin MGV6) | CDS PLU | TX correto | TX errado (PLU) |
|---------|--------------------|---------|------------|-----------------|
| Milho Grão Kg | 39 (PLU / ITN_CODIGO) | — | `000000039` | item distinto de 12746 |
| Milho Grao | 12746 (PLU / ITN_CODIGO) | — | `000012746` | item distinto de 39 |

## Identidade MGV6

Autoridade: `MGV6IdentityResolver`  
Persistência: `produto_identificadores.tipo = 'MGV6'`  
UI: campo **Código MGV6** no cadastro do produto (não substitui PLU/EAN/código).

Prioridade do builder:

1. Código MGV6 explícito
2. Sem fallback silencioso para PLU / codigo / EAN
3. Erro `MGV6_PRODUCT_IDENTITY_REQUIRED` se ausente
4. Erro `MGV6_CODE_OVERFLOW` se > 9 dígitos

Padding (9 posições, sem truncar):

- `1` → `000000001`
- `12746` → `000012746`
- `13007` → `000013007`

## Produtos comprovados (fixtures)

Fonte: amostras / auditoria do TXITENS real. **Não** migrar os 101 automaticamente.

| Nome | Código MGV6 |
|------|-------------|
| Frango Do Dia Kg | 1 |
| Picadinho Kg | 2 |
| Costela Bovina Kg | 3 |
| Carne De Charque Kg | 103 |
| Batata Inglesa . | 150 |
| Milho Grao | 12746 |
| Pêra Unidade | 12780 |
| Carne Congelada… | 13007 |

Produtos sem correspondência comprovada: **pendentes** — configurar Código MGV6 manualmente.

## TXITENS.TXT

- Registro: **exatamente 320** caracteres
- CRLF: **fora** dos 320
- Encoding: **WINDOWS-1252**
- Layout: `01` + código(9) + preço(9) + descrição + espaços
- Preço (inalterado): R$ 11,50 → `001150000`
- Descrição: truncamento legado por **caracteres** (máx. **50**), ex.:
  - `Carne Congelada De Bovino Sem Osso Maminha Da Alcatra - Qtde`
  - → `Carne Congelada De Bovino Sem Osso Maminha Da Alca`

## Separação de responsabilidade

| Módulo | Papel |
|--------|--------|
| `MGV6IdentityResolver` | resolve código MGV6 |
| `MGV6FileBuilder` | monta registro 320 |
| `MGV6Exporter` | grava arquivo |
| `MGV6SyncService` | carrega → resolve → exporta |
| `MGV6Launcher` | inicia MGV6.exe (não prova envio à balança) |

## Modos

- `modo_envio = MGV6` → só pipeline TXT (sem TCP)
- `modo_envio = TCP` → pipeline Toledo intacto (sem MGV6)

## export-all

Somente produtos **ativos + pesáveis** (`produto_fracionado = 1`), alinhado à UI operacional.  
Sem identidade MGV6 → erro controlado (não inventa código).

## Testes

```bash
npm run test:mgv6-v1
npm run test:mgv6-operational-v1
npm run test:mgv6-txitens-v1
npm run test:mgv6-txitens-real-v1
npm run test:mgv6-legacy-compat-v1
```

**RC14.15.8 / RC14.15.9:** PLU = código do item. Campo **Código MGV6 removido da UI**.  
Milho Grão Kg usa **PLU 39** → `000000039`. Ver `rc14159-remocao-codigo-mgv6.md`.

## Teste físico (checklist)

1. Configurar equipamento + pasta + MGV6.exe + modo MGV6  
2. Configurar **PLU** no produto (ex.: Milho Grão Kg = 39)  
3. Exportar → verificar `TXITENS.TXT`  
4. Abrir MGV6 → importar → enviar → verificar balança  

**Homologação física:** pendente até evidência no ambiente do cliente.

## Limitações

- Compatibilidade inicial; não homologação oficial MGV6
- Iniciar `MGV6.exe` ≠ produto na balança
- Não preencher automaticamente os 101 mapeamentos sem evidência produto↔legado
- Histórico `equipamentos_mgv6_exports` mantém metadados de arquivo (sem TXT completo); códigos MGV6 ficam no log/resposta da exportação

## Arquivos principais

- `backend/motores/equipamentos/mgv6/MGV6IdentityResolver.js`
- `backend/motores/equipamentos/mgv6/MGV6FileBuilder.js`
- `backend/motores/equipamentos/mgv6/MGV6SyncService.js`
- `backend/motores/equipamentos/mgv6/MGV6Validator.js`
- `docs/build/rc14155-auditoria-mgv6-txitens-real.md` (auditoria prévia)
