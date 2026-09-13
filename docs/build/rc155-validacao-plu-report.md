# RC15.5 — Auditoria Completa da Validação do Upload PLU

## Objetivo

Eliminar o erro genérico `VALIDATION_ERROR` sem detalhes. Toda falha gera um **ValidationReport**.

## ValidationReport

```json
{
  "success": false,
  "errors": [
    { "campo": "departamento", "valor": null, "motivo": "Departamento obrigatório." },
    { "campo": "preco", "valor": 0, "motivo": "Preço deve ser maior que zero." }
  ],
  "checks": [
    { "campo": "ativo", "label": "Produto ativo", "ok": true },
    { "campo": "departamento", "label": "Departamento", "ok": false, "motivo": "..." }
  ]
}
```

## Fluxo

1. `ToledoPluValidator.buildReport` / `assertValid`
2. Log no terminal (`===== VALIDAÇÃO DO PLU =====`)
3. `UploadPluOperation` registra checklist ✔/✖
4. API devolve `validationReport`, `errors`, `motivos`
5. Front: **Produto não enviado** + lista de motivos

## Critério

Nunca retornar apenas `VALIDATION_ERROR` sem indicar campo, regra e valor.

## Teste

```
npm run test:validacao-plu-report
npm run test:plu-upload-v1
```
