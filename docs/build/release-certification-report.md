# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 25253da
- Build: 2026-09-14T17:45:32.564Z
- Hash app.asar: `9be9d26b8bd4bbd351d23e42c4f868a24f834538a9f198598346720463731684`
- Origem: instalador-desatualizado
- Data: 2026-09-14T19:42:54.230Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 9be9d26b8bd4…
✔ Login
  - user=rc4320_1789414972630 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1789414968483-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=11
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
  - compras=0 fin=11 prod=342
✔ Performance
  - 5.7s | mem 31.5MB | sql=16

## Estatísticas

- Tempo total: 5.7s
- Memória máxima: 31.5 MB
- CPU user: 2703 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
