# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 8083dc0
- Build: 2026-10-27T18:55:26.594Z
- Hash app.asar: `83453e0153a9eda24b846b7418240c8290a7eb7aca7529ef78940ffee3d9ebee`
- Origem: instalador-desatualizado
- Data: 2026-10-29T18:34:59.010Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 83453e0153a9…
✔ Login
  - user=rc4320_1793298898138 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1793298895727-P
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
  - compras=0 fin=0 prod=0
✔ Performance
  - 3.3s | mem 28.8MB | sql=16

## Estatísticas

- Tempo total: 3.3s
- Memória máxima: 28.8 MB
- CPU user: 1375 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
