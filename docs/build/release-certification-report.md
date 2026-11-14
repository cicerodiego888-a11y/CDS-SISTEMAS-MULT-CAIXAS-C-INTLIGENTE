# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: 3176ac0
- Build: 2026-11-13T19:32:31.451Z
- Hash app.asar: `8746ff2753f315b87b026a73aba4c3371f1dce6d7d08b3bbf5f1c9dbf071f5fd`
- Origem: instalador-desatualizado
- Data: 2026-11-13T20:48:40.421Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: 8746ff2753f3…
✔ Login
  - user=rc4320_1794602919949 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1794602918783-P
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
  - 1.6s | mem 28.9MB | sql=16

## Estatísticas

- Tempo total: 1.6s
- Memória máxima: 28.9 MB
- CPU user: 781 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
