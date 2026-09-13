# RC14.15.11 — Alinhamento definitivo do fluxo MGV6 legado (manual)

**Status:** IMPLEMENTADO  
**TCP:** 0 alterações  
**SQL MGV6:** não utilizado pelo CDS  
**Carga:** MANUAL no MGV6  

---

## 1. Fluxo comprovado do sistema legado

```text
Sistema / CDS
  → gera arquivo
  → inicia MGV6
  → OPERADOR: Carga → Solicitar Carga das Balanças → seleciona balanças → Enviar
  → BALANÇA
```

## 2. Responsabilidade do CDS

1. Selecionar produtos com Integrar com Balança  
2. Resolver PLU (código do item)  
3. Gerar `TXITENS.TXT` (320 / WINDOWS-1252 / CRLF)  
4. Validar arquivo em disco  
5. Iniciar `MGV6.exe` (se autoLaunch)  
6. Orientar o operador sobre a carga manual  

## 3. Responsabilidade do MGV6

- Importar/disponibilizar produtos  
- Gerenciar carga e seleção de balanças  
- Transmitir quando o operador clicar em **Enviar**  

## 4. Responsabilidade do operador

No MGV6:

**Carga → Solicitar Carga das Balanças → Enviar**

## 5. TXITENS

Layout **inalterado**: 320 chars, WINDOWS-1252, CRLF externo.  
PLU 39 → `000000039` · 99 → `000000099` · 12746 → `000012746`.

## 6. PLU

Única identidade operacional do Bridge.  
Sem EAN, código interno ou `codigo_mgv6`.

## 7. Processo manual de carga

O CDS **não** automatiza a carga.  
Mensagens deixam claro: produtos **preparados**, não **transmitidos**.

## 8. Correção `modo is not defined`

Em `enviar-produtos-balanca.js` / `epbEnviarSelecionados`:  
`modo` → `__epbModoEnvio`.

## 9. Ausência de SQL MGV6

Sem INSERT/UPDATE/EXEC em `tbItens`, `tbItemBalanca`, carga, etc.

## 10. Ausência de alteração TCP

Pipeline Toledo TCP permanece intacto.

## Validação pré-launch (RC14.15.11)

Antes de `spawn(MGV6.exe)`:

- arquivo existe  
- tamanho correto  
- N registros × 320 + CRLF  
- bloco PLU coerente  

Falha → **não** inicia MGV6 → `MGV6_FILE_INVALID` / `MGV6_RECORD_SIZE_INVALID`.
