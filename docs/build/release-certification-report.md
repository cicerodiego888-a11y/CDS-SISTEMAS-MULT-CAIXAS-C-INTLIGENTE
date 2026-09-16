# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 925bf82
- Build: 2026-09-16T15:19:04.245Z
- Hash app.asar: `968fe7386f46900f037b4faa4c1365b3b8f08cc030f1e3efbb097b51d868dcf5`
- Origem: instalador-desatualizado
- Data: 2026-09-16T15:47:50.536Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 968fe7386f46…
✔ Login
  - user=rc4320_1789573668863 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1789573666344-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=18
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
  - compras=0 fin=18 prod=342
✔ Performance
  - 4.2s | mem 32.3MB | sql=16

## Estatísticas

- Tempo total: 4.2s
- Memória máxima: 32.3 MB
- CPU user: 2594 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
