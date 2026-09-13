const db = require('../../database');

async function executarConciliacao(dataInicio, dataFim) {
  try {
    // Buscar vendas no período
    const vendas = await buscarVendasPeriodo(dataInicio, dataFim);
    
    // Buscar transações TEF no período
    const transacoesTef = await buscarTransacoesTefPeriodo(dataInicio, dataFim);
    
    // Buscar NFC-e no período
    const nfces = await buscarNfcePeriodo(dataInicio, dataFim);
    
    // Realizar conciliação
    const resultado = {
      periodo: { inicio: dataInicio, fim: dataFim },
      vendas: vendas.length,
      transacoes_tef: transacoesTef.length,
      nfces: nfces.length,
      conciliadas: [],
      divergencias: [],
      vendas_sem_tef: [],
      tef_sem_venda: [],
      nfces_sem_vinculo: []
    };
    
    // Conciliar vendas com TEF
    for (const venda of vendas) {
      const tefVinculado = transacoesTef.find(t => t.venda_id === venda.id);
      
      if (tefVinculado) {
        // Verificar se tem NFC-e vinculada
        if (tefVinculado.nfce_numero) {
          resultado.conciliadas.push({
            venda_id: venda.id,
            venda_codigo: venda.codigo,
            tef_id: tefVinculado.id,
            nfce_numero: tefVinculado.nfce_numero,
            status: 'conciliado'
          });
        } else {
          resultado.divergencias.push({
            venda_id: venda.id,
            venda_codigo: venda.codigo,
            tef_id: tefVinculado.id,
            problema: 'TEF aprovado mas sem NFC-e vinculada',
            status: 'divergencia'
          });
        }
      } else {
        // Verificar se venda tem pagamento TEF
        const pagamentos = await buscarPagamentosVenda(venda.id);
        const temPagamentoTef = pagamentos.some(p => 
          p.forma_pagamento === 'cartao_debito' || 
          p.forma_pagamento === 'cartao_credito' ||
          p.forma_pagamento === 'cartao'
        );
        
        if (temPagamentoTef) {
          resultado.vendas_sem_tef.push({
            venda_id: venda.id,
            venda_codigo: venda.codigo,
            problema: 'Venda com pagamento TEF mas sem transação TEF registrada',
            status: 'divergencia'
          });
        }
      }
    }
    
    // Verificar TEF sem venda
    for (const tef of transacoesTef) {
      if (!tef.venda_id) {
        resultado.tef_sem_venda.push({
          tef_id: tef.id,
          problema: 'Transação TEF sem venda vinculada',
          status: 'divergencia'
        });
      }
    }
    
    // Verificar NFC-e sem vinculo TEF
    for (const nfce of nfces) {
      const venda = vendas.find(v => v.id === nfce.venda_id);
      if (venda) {
        const pagamentos = await buscarPagamentosVenda(venda.id);
        const temPagamentoTef = pagamentos.some(p => 
          p.forma_pagamento === 'cartao_debito' || 
          p.forma_pagamento === 'cartao_credito' ||
          p.forma_pagamento === 'cartao'
        );
        
        if (temPagamentoTef) {
          const tefVinculado = transacoesTef.find(t => t.venda_id === venda.id);
          if (!tefVinculado || !tefVinculado.nfce_numero) {
            resultado.nfces_sem_vinculo.push({
              nfce_numero: nfce.numero,
              nfce_chave: nfce.chave,
              venda_id: venda.id,
              venda_codigo: venda.codigo,
              problema: 'NFC-e emitida para venda com TEF mas sem vinculo',
              status: 'divergencia'
            });
          }
        }
      }
    }
    
    return resultado;
  } catch (error) {
    console.error('Erro ao executar conciliação TEF:', error);
    throw error;
  }
}

async function buscarVendasPeriodo(dataInicio, dataFim) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, codigo, total, data_venda, status
      FROM vendas
      WHERE data_venda BETWEEN ? AND ?
      AND status = 'concluida'
      ORDER BY data_venda DESC
    `, [dataInicio, dataFim], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function buscarTransacoesTefPeriodo(dataInicio, dataFim) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, venda_id, tipo, valor, status, nfce_numero, nfce_chave, criado_em
      FROM tef_transacoes
      WHERE date(criado_em) BETWEEN ? AND ?
      ORDER BY criado_em DESC
    `, [dataInicio, dataFim], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function buscarNfcePeriodo(dataInicio, dataFim) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT venda_id, numero, chave, status, data_emissao
      FROM notas_fiscais
      WHERE date(data_emissao) BETWEEN ? AND ?
      ORDER BY data_emissao DESC
    `, [dataInicio, dataFim], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function buscarPagamentosVenda(vendaId) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT forma_pagamento, valor
      FROM venda_pagamentos
      WHERE venda_id = ?
    `, [vendaId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function conciliarAutomaticamenteHoje() {
  const hoje = new Date().toISOString().split('T')[0];
  return await executarConciliacao(hoje, hoje);
}

module.exports = {
  executarConciliacao,
  conciliarAutomaticamenteHoje
};
