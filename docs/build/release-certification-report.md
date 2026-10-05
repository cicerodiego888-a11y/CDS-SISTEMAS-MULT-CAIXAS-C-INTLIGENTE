# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 129ecc0
- Build: 2026-10-05T11:54:25.802Z
- Hash app.asar: `f8b37ed545ec822ab66e7dc4c4f1f031fff1469089d18fb77235afc49b08be07`
- Origem: instalador-desatualizado
- Data: 2026-10-05T20:42:09.015Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: f8b37ed545ec…
✔ Login
  - user=rc4320_1791232928496 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1791232926728-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=0
✔ Estoque
  - fiscal=6+3 | total=15 UN
✔ MIIP
  - MUC 10×12 → 120 UN (MULTIPLICADOR)
✔ Central Inteligente
  - documento 000064 processado
✔ NFC-e
  - homologação dest.xNome + módulo emissor presente
✔ NF-e
  - autorização cStat=100 | protocolo=123
✔ Relatórios
  - compras=1 fin=0 prod=0
✔ Performance
  - 2.3s | mem 28.7MB | sql=16

## Estatísticas

- Tempo total: 2.3s
- Memória máxima: 28.7 MB
- CPU user: 890 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
