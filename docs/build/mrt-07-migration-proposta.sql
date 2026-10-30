-- MRT-07 — Migration PROPOSTA (NÃO aplicar ao banco oficial nesta sprint)
-- Objetivo: journal opcional de leases de ocupação para sobreviver a encerramentos abruptos.
-- NÃO substitui tef_transacoes / TEF-14. NÃO autoriza, cancela ou repete pagamento.
-- Fonte da verdade financeira permanece: tef_transacoes.status = 'pendente'.

CREATE TABLE IF NOT EXISTS tef_terminal_leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id TEXT NOT NULL UNIQUE,
  terminal_tef_id TEXT NOT NULL,
  runtime_key TEXT,
  pdv_id TEXT,
  provedor TEXT,
  adquirido_em DATETIME NOT NULL,
  expira_em DATETIME,
  resultado_financeiro_inconclusivo INTEGER NOT NULL DEFAULT 0,
  liberado INTEGER NOT NULL DEFAULT 0,
  liberado_em DATETIME,
  motivo_liberacao TEXT,
  hold_recuperacao INTEGER NOT NULL DEFAULT 0,
  transacao_id INTEGER,                 -- FK lógica → tef_transacoes.id (quando conhecida)
  idempotency_key TEXT,                 -- correlação TEF-13 (não altera regra)
  venda_id INTEGER,                     -- correlação TEF-15 (nullable = sem venda)
  meta_json TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tef_terminal_leases_terminal
  ON tef_terminal_leases(terminal_tef_id, liberado);

CREATE INDEX IF NOT EXISTS idx_tef_terminal_leases_runtime
  ON tef_terminal_leases(runtime_key, liberado);

CREATE INDEX IF NOT EXISTS idx_tef_terminal_leases_transacao
  ON tef_terminal_leases(transacao_id);

CREATE INDEX IF NOT EXISTS idx_tef_terminal_leases_inconclusivo
  ON tef_terminal_leases(resultado_financeiro_inconclusivo, liberado);

-- NOTAS DE APLICAÇÃO FUTURA:
-- 1) Aplicar somente em sprint dedicada de persistência (após validar MRT-07 em memória).
-- 2) No startup: ler leases não liberados + cruzar com tef_transacoes.pendente.
-- 3) Se transação já tiver desfecho definitivo → marcar lease liberado (sem novo pagamento).
-- 4) Se transação ainda pendente → recriar hold EM_RECUPERACAO / INCONCLUSIVO (sem retry).
-- 5) NÃO usar esta tabela para aprovar/cancelar automaticamente.
-- 6) payload_retorno.roteamento (MRT-07) já permite correlação sem esta tabela no curto prazo.
-- 7) NÃO executar este script no banco oficial sem sprint dedicada.
