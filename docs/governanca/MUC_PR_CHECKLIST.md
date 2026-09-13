# MUC — Checklist Obrigatório de Pull Request

Todo PR que toque `backend/motores/muc/` **deve** incluir este checklist no corpo do PR.

---

## Checklist de Governança MUC

Marque cada item antes de solicitar revisão:

- [ ] **Alterou API pública?**  
  Se sim: atualizou `docs/contratos/MUC_PUBLIC_API.md` e bump de versão (minor/major).

- [ ] **Alterou DTO público?**  
  Se sim: atualizou factories, documentação e `tests/muc/muc-public-contract.test.js`. Major version.

- [ ] **Alterou Evento?**  
  Se sim: atualizou payload documentado e versão de eventos.

- [ ] **Alterou Contrato?**  
  Se sim: revisão arquitetural obrigatória.

- [ ] **Alterou Pipeline interno?**  
  Se sim: executou `muc-rc2-certificacao.test.js` — zero regressão RC1.

- [ ] **Quebrou Compatibilidade?**  
  Se sim: **bloqueado** — requer RC major (RC3+) com plano de migração.

- [ ] **Atualizou documentação?**  
  Contrato, arquitetura congelada ou RC doc conforme escopo.

- [ ] **Testes de contrato passando?**  
  ```bash
  node tests/muc/muc-public-contract.test.js
  node tests/muc/muc-rc1-certificacao.test.js
  node tests/muc/muc-rc2-certificacao.test.js
  ```

---

## Regras de aprovação

1. Nenhum módulo externo pode importar `core/`, `pipeline/`, `repositorios/`, `cache/`, `auditoria/`.
2. Toda conversão de produção passa por `obterMuc(db)`.
3. PR sem checklist completo **não será aprovado**.

---

## Referências

- [Contrato Público](../contratos/MUC_PUBLIC_API.md)
- [Arquitetura Congelada](../arquitetura/MUC_ARQUITETURA_CONGELADA.md)
