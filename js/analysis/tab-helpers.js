import { expose } from '../expose.js';

/* js/analysis/tab-helpers.js — empty states e registry de abas da análise padrão */

/** Mensagem de aba vazia: (1) recurso existia, (2) coleta rodou. */
function _abaVaziaMsg(temRecurso, coletaOk, preRecurso, coletaFalhou, semDado) {
  if (!temRecurso) return preRecurso;
  if (coletaOk === false) return coletaFalhou;
  return semDado;
}

function emptyTabMessage(featKey, coletaOk, labels) {
  // labels: { pre, fail, empty }
  return _abaVaziaMsg(featKey, coletaOk, labels.pre, labels.fail, labels.empty);
}

/** Registry canônico das 7 abas (ordem = PDF / v1). MESMAS 7 abas nos dois modos
 * (invariante 14); no pós-jogo só os RÓTULOS re-semantizam — a estrutura não muda. */
const ANALYSIS_TAB_ORDER = [
  { id:'resumo', label:'Resumo' },
  { id:'tatica', label:'Tática' },
  { id:'individual', label:'Desempenho' },
  { id:'cartoes', label:'Cartões & Faltas' },
  { id:'escanteios', label:'Escanteios' },
  { id:'escalacao', label:'Escalação' },
  { id:'avancado', label:'Dados Avançados' }
];
const ANALYSIS_TAB_LABELS_POS = {
  resumo:'Resumo do Jogo',
  tatica:'Leitura Tática',
  individual:'Números do Jogo',
  cartoes:'Disciplina',
  escanteios:'Escanteios',            // nunca sai (invariante)
  escalacao:'Escalações Utilizadas',
  avancado:'Pós-Jogo & Mercados'
};

function renderAnalysisTabShell(id, tabsHtml, mode){
  // tabsHtml: { resumo, tatica, individual, cartoes, escanteios, escalacao, avancado }
  const _lbl = (t)=>(mode==='pos_jogo'&&ANALYSIS_TAB_LABELS_POS[t.id])||t.label;
  const buttons = ANALYSIS_TAB_ORDER.map((t,i)=>
    `<button class="a-tab${i===0?' active':''}" data-tab="${t.id}" onclick="showTab(${id},'${t.id}')">${_lbl(t)}</button>`
  ).join('');
  const panels = ANALYSIS_TAB_ORDER.map((t,i)=>
    `<div id="at-${t.id}-${id}" class="a-tc"${i===0?'':' style="display:none"'}>
${tabsHtml[t.id]||''}</div>`
  ).join('\n    ');
  return { buttons, panels };
}

function featureEmptyHtml(featFlag, coletaOk, kind, extraHtml){
  const map = {
    cartoes: {
      pre: 'Análise disciplinar não disponível — esta análise foi gerada antes do recurso. Rode uma nova análise para obtê-la.',
      fail: 'A pesquisa de dados desta partida não pôde ser concluída — a análise saiu direto do modelo. Rode novamente para tentar coletar cartões e faltas.',
      empty: 'Dados de cartões e faltas não encontrados na coleta desta partida — pode ser um confronto com pouca cobertura de imprensa. Rode uma nova análise para tentar novamente.'
    },
    escanteios: {
      pre: 'Análise de escanteios não disponível — esta análise foi gerada antes do recurso. Rode uma nova análise para obtê-la.',
      fail: 'A pesquisa de dados desta partida não pôde ser concluída — a análise saiu direto do modelo. Rode novamente para tentar coletar escanteios.',
      empty: 'Dados de escanteios não encontrados na coleta desta partida — pode ser um confronto com pouca cobertura de imprensa. Rode uma nova análise para tentar novamente.'
    },
    lineups: {
      pre: 'Escalações não disponíveis — esta análise foi gerada antes do recurso. Rode uma nova análise para obtê-las.',
      fail: 'A pesquisa de dados desta partida não pôde ser concluída — a análise saiu direto do modelo. Rode novamente para tentar coletar as escalações.',
      empty: 'Dados de escalação não encontrados na coleta desta partida — pode ser um confronto com pouca cobertura de imprensa. Rode uma nova análise para tentar novamente.'
    }
  };
  const L = map[kind] || map.cartoes;
  const msg = emptyTabMessage(featFlag, coletaOk, L);
  return `<div class="tab-s"><p class="tab-body" style="color:var(--muted)">${msg}</p></div>${extraHtml||''}`;
}

expose({
  _abaVaziaMsg,
  emptyTabMessage,
  ANALYSIS_TAB_ORDER,
  ANALYSIS_TAB_LABELS_POS,
  renderAnalysisTabShell,
  featureEmptyHtml,
});
export {
  _abaVaziaMsg,
  emptyTabMessage,
  ANALYSIS_TAB_ORDER,
  ANALYSIS_TAB_LABELS_POS,
  renderAnalysisTabShell,
  featureEmptyHtml,
};
