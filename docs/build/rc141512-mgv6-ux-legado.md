# RC14.15.12 — MGV6 — UX de inicialização alinhado ao sistema legado

**Status:** IMPLEMENTADA  
**TCP:** 0 alterações  
**Layout TXITENS:** inalterado (320 / WINDOWS-1252 / CRLF)  
**SQL MGV6:** não utilizado  
**Carga:** MANUAL no MGV6  

---

## 1. Objetivo

Simplificar o fluxo de exportação MGV6 para ficar visual e operacionalmente alinhado ao legado:

1. Gerar `TXITENS.TXT`  
2. Validar `TXITENS.TXT`  
3. Localizar `MGV6.exe`  
4. Perguntar: **Deseja iniciar o software da balança?**  
5. **Sim** → iniciar o EXE encontrado  
6. **Não** → não iniciar  

O CDS **não** executa carga, TCP, SQL MGV6 nem afirma envio para a balança.

---

## 2. Fluxo oficial

```text
CDS
 ↓
Exportar produto
 ↓
Gerar TXITENS.TXT
 ↓
Validar TXITENS.TXT
 ↓
Localizar MGV6.exe
 ↓
PERGUNTA: "Deseja iniciar o software da balança?"
 ├── SIM → spawn(MGV6.exe) → "✔ MGV6 iniciado"
 └── NÃO → "MGV6 não iniciado pelo usuário."
 ↓
Finalizar
```

Se o EXE **não** for encontrado: **não** abre a pergunta; informa  
`Software MGV6 não encontrado neste computador.`  
O TXITENS permanece gerado/validado.

---

## 3. Diálogo (legado)

| Campo | Valor |
|--------|--------|
| Título | Aviso |
| Mensagem | Deseja iniciar o software da balança? |
| Botões | Sim / Não |

**Não** exibir no diálogo: caminho do EXE, PID, SQL, “Solicitar Carga…”, TCP/ACK.

---

## 4. Alterações técnicas

### Backend

- `MGV6SyncService`: após validar TXITENS, resolve o EXE; `autoLaunch` efetivo controla spawn; resposta inclui `mgv6.encontrado`, `mgv6.aguardandoUsuario`.
- `iniciarMgv6(equipamentoId)`: spawn sob demanda (confirmação do usuário).
- `MGV6Controller` / `MGV6Routes`: `POST /api/equipamentos/mgv6/launch`; export HTTP **default** `autoLaunch=false` (só inicia se `iniciarMgv6`/`autoLaunch=true` explícito).
- `MGV6Launcher`: log `✔ MGV6 iniciado` + PID real quando disponível (sem `PID: ?`).

### Frontend

- `enviar-produtos-balanca.js`: export com `autoLaunch: false` → diálogo → `POST /launch` se Sim.
- `produtos.js`: mesmo fluxo no envio unitário MGV6.
- Mensagens: `ℹ A carga da balança é realizada manualmente no MGV6.`  
  Removidas afirmações de “produto enviado” / “carga enviada” e o spam imediato de “Solicitar Carga → Enviar” após o spawn.

---

## 5. Log esperado

```text
Iniciando envio de 1 produto(s)...
Modo: MGV6
...
✔ TXITENS.TXT gerado
✔ TXITENS validado
✔ MGV6 encontrado
Aguardando decisão do usuário para iniciar MGV6...
✔ MGV6 iniciado
ℹ A carga da balança é realizada manualmente no MGV6.
Finalizado
```

---

## 6. O que NÃO foi alterado

- PLU / identidade MGV6  
- Layout TXITENS (320, encoding, CRLF)  
- Builder / validator de registro  
- TCP / ToledoPrixIVDriver / ConnectionManager / protocolo / ACK  
- Discovery / fingerprint  
- Regra Integrar com Balança  

---

## 7. Testes

```bash
npm run test:mgv6-ux-legado-v1
npm run test:mgv6-legado-manual-v1
npm run test:mgv6-operational-v1
npm run test:mgv6-identidade-plu-v1
npm run test:driver-identity
npm run test:connection-unification
npm run test:protocol-unification
```

Cobertura RC14.15.12: PLU 99/39/12746, Integrar SIM/NÃO, usuário Sim/Não, EXE encontrado/inexistente, TXITENS válido/inválido, barreiras TCP/layout.

---

## 8. Critério de aceite

1. Export gera TXITENS normalmente  
2. Validação existente permanece  
3. CDS localiza MGV6.exe via config/descoberta existente  
4. Usuário vê apenas a pergunta legado  
5. Sim abre MGV6; Não não abre  
6. CDS não afirma envio à balança  
7. CDS não executa carga  
8. Operador continua: MGV6 → Carga → Solicitar Carga das Balanças → Enviar  
9. Sem alteração TCP / layout / SQL MGV6  
