# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 817c81c
- Build: 2026-09-11T17:50:17.439Z
- Hash app.asar: `3858d842dd428c834ffce0b68b6d6a96977bbf6a2f28058e6405aa528cf088e7`
- Origem: instalador-desatualizado
- Data: 2026-09-11T20:14:21.299Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 3858d842dd42…
✔ Login
  - user=rc4320_1789157658460 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1789157656652-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=121
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
  - compras=4 fin=121 prod=1637
✔ Performance
  - 4.6s | mem 30.7MB | sql=16

## Estatísticas

- Tempo total: 4.6s
- Memória máxima: 30.7 MB
- CPU user: 3594 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
