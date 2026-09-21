# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 8620fe6
- Build: 2026-09-17T20:52:07.442Z
- Hash app.asar: `daa3c88b1ef4c3f520c31cb5af34f6dc7e929b66ec037087cfc859eec0c524a1`
- Origem: instalador-desatualizado
- Data: 2026-09-21T18:07:29.631Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: daa3c88b1ef4…
✔ Login
  - user=rc4320_1790014048504 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1790014044929-P
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
  - compras=0 fin=0 prod=5
✔ Performance
  - 4.7s | mem 28MB | sql=16

## Estatísticas

- Tempo total: 4.7s
- Memória máxima: 28 MB
- CPU user: 1547 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
