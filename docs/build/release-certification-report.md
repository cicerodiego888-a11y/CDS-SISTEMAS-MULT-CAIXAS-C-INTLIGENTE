# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 8620fe6
- Build: 2026-09-17T20:39:59.249Z
- Hash app.asar: `74777d3f2e696df8dcc24b50541c702e6894d64fa03657ab39f7067166cb6d51`
- Origem: instalador-desatualizado
- Data: 2026-09-17T20:52:05.955Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 74777d3f2e69…
✔ Login
  - user=rc4320_1789678324021 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1789678320511-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=43
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
  - compras=1 fin=43 prod=785
✔ Performance
  - 5.4s | mem 28.8MB | sql=16

## Estatísticas

- Tempo total: 5.4s
- Memória máxima: 28.8 MB
- CPU user: 2813 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
