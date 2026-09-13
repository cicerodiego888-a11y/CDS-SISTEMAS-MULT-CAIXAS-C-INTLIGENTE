/**
 * Helpers de data compartilhados do Monitoring Engine (somente leitura).
 */

function dataHojeBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function periodoMes(hoje) {
  return { inicio: `${hoje.slice(0, 7)}-01`, fim: hoje };
}

function periodoAno(hoje) {
  return { inicio: `${hoje.slice(0, 4)}-01-01`, fim: hoje };
}

function ultimoDiaMes(ano, mes) {
  return new Date(Number(ano), Number(mes), 0).getDate();
}

/**
 * Período completo de uma competência mensal (ano + mês).
 * @param {number} ano
 * @param {number} mes — 1..12
 */
function periodoCompetencia(ano, mes) {
  const anoNum = Number(ano);
  const mesNum = Number(mes);
  const mesStr = String(mesNum).padStart(2, '0');
  const diaFim = String(ultimoDiaMes(anoNum, mesNum)).padStart(2, '0');
  return {
    ano: anoNum,
    mes: mesNum,
    competencia: `${anoNum}-${mesStr}`,
    label: `${mesStr}/${anoNum}`,
    inicio: `${anoNum}-${mesStr}-01`,
    fim: `${anoNum}-${mesStr}-${diaFim}`
  };
}

/**
 * Resolve competência a partir de query/contexto.
 * Aceita competencia=YYYY-MM, ou ano+mes, ou padrão = mês corrente (Brasil).
 * @param {Object} [input]
 */
function resolverCompetencia(input = {}) {
  const hoje = dataHojeBrasil();
  const [anoPadrao, mesPadrao] = hoje.slice(0, 7).split('-').map(Number);

  const rawCompetencia = input.competencia ?? input.competenciaMes ?? null;
  if (rawCompetencia) {
    const match = String(rawCompetencia).trim().match(/^(\d{4})-(\d{1,2})$/);
    if (match) {
      const mes = Number(match[2]);
      if (mes >= 1 && mes <= 12) return periodoCompetencia(Number(match[1]), mes);
    }
  }

  const ano = input.ano != null && input.ano !== '' ? Number(input.ano) : anoPadrao;
  const mes = input.mes != null && input.mes !== '' ? Number(input.mes) : mesPadrao;

  if (!Number.isFinite(ano) || !Number.isFinite(mes) || mes < 1 || mes > 12) {
    return periodoCompetencia(anoPadrao, mesPadrao);
  }
  return periodoCompetencia(ano, mes);
}

/** Período do dia corrente (Brasil). */
function periodoHoje() {
  const hoje = dataHojeBrasil();
  return { inicio: hoje, fim: hoje };
}

/** Ano civil completo da competência selecionada. */
function periodoAnoCompetencia(ano) {
  const anoNum = Number(ano);
  return {
    inicio: `${anoNum}-01-01`,
    fim: `${anoNum}-12-31`
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function montarBlocoPeriodo(hoje, mes, ano, extras = {}) {
  return {
    valor: hoje.valor,
    quantidade: hoje.quantidade,
    hoje,
    mes,
    ano,
    ...extras
  };
}

function percentual(parte, total) {
  const t = num(total);
  if (t <= 0) return 0;
  return Math.round((num(parte) / t) * 1000) / 10;
}

function dbGetFactory(db) {
  return function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || {})));
    });
  };
}

module.exports = {
  dataHojeBrasil,
  periodoMes,
  periodoAno,
  periodoCompetencia,
  resolverCompetencia,
  periodoHoje,
  periodoAnoCompetencia,
  num,
  montarBlocoPeriodo,
  percentual,
  dbGetFactory
};
