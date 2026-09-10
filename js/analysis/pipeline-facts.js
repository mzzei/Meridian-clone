/* js/analysis/pipeline-facts.js — ESM (gather/verify + grounding)
 * Passos 2–4: competitions + state por import; host APIs em call-time via _h().
 */
import { expose } from '../expose.js';
import { host } from '../runtime.js';
import { state } from '../state.js';
import {
  compLabel,
  compSanity,
  compSeasonLabel,
} from '../comp/competitions.js';

/** Funções classic (espn/af/app) resolvidas só na chamada — após loadClassic. */
function _h(name) {
  const fn = host()[name];
  if (typeof fn === 'function') return fn;
  throw new Error('[pipeline-facts] host missing: ' + name);
}

// Regra de grounding temporal compartilhada (Fase 1 coleta + Fase 2 análise). Escrita UMA vez:
// princípio geral (qualquer fato volátil só dos dados) + verificação (dados vencem a memória) +
// completude (extrair tudo; "a confirmar" é último recurso). Cobre toda a classe de erro, não
// uma lista curta — impede técnico/escalação/ranking/clube/etc. desatualizados de memória.
const GROUNDING_RULE=`GROUNDING TEMPORAL (regra dura — o erro mais grave a evitar):
Seu conhecimento de treino está DESATUALIZADO para o futebol atual (clubes e seleções). Elencos, técnicos, placares e status de jogo mudam o tempo todo — inclusive no acréscimo.
• FATOS VOLÁTEIS — use SOMENTE o que vier dos dados coletados/buscas/blocos oficiais desta mensagem, NUNCA de memória de treino: placar e status de jogo (FT/LIVE/intervalo); minuto do gol; técnico atual; escalação; lesões/suspensões; forma recente; tabela/fase.
• PLACAR É SACRO (tolerância zero a alucinação): NUNCA invente, complete, arredonde ou "lembre" placar. Se existir "=== PLACARES VERIFICADOS ===", use EXATAMENTE status + placar dali (FT = placar oficial de término da fonte, não um parcial). Se não houver bloco, busque por identidade do jogo + "full time/resultado final" (sem presupor o placar na query) e cite a fonte. Proibido qualquer placar sem lastro nesta mensagem.
• CONHECIMENTO PRÓPRIO só para o que NÃO muda: leitura tática genérica, padrões históricos distantes, metodologia (xG, Poisson) — nunca para o resultado de um jogo "que acabou de acontecer".
• VERIFICAÇÃO: se memória divergir dos dados, os DADOS vencem. Se "lembra" e não está nos dados, NÃO afirme — busque.
• COMPLETUDE: extraia o máximo das fontes. Não se abstenha de informar por preguiça: se o fato é público (placar FT), a coleta deve encontrá-lo.
• NARRATIVA DE INCERTEZA: não invente o valor ausente; diga o que falta e busque.`;

// Regra de fontes: prioriza imprensa internacional de referência + stats; demais OK se necessário.
// Prompt-only (não allowed_domains — já quebrou o pipeline). Odds = insumo genérico, sem bookmaker.
const SOURCE_RULE=`FONTES E CITAÇÃO (regra obrigatória — priorize, não descarte o resto sem necessidade):

PRIORIDADE 1 (use primeiro; em conflito de fatos, prefira estas se forem mais recentes/oficiais):
• BBC Sport, The Guardian, Sky Sports, The Athletic, ESPN FC (internacional), Reuters Sport
• Provedores estatísticos: FBref/StatsBomb, Opta/The Analyst, Sofascore, FotMob, WhoScored, Understat
• Federações e sites oficiais de clubes/competições (FIFA, UEFA, CONMEBOL, CBF, Premier League, LaLiga, etc.)

PRIORIDADE 2 (use quando P1 não cobrir o fato, for a fonte mais local/atual, ou para cruzar):
• Transfermarkt, Goal.com, Marca, AS, L'Équipe, Gazzetta dello Sport, Kicker
• Imprensa BR quando o jogo/clube for sul-americano: GE/Globo Esporte, Lance, UOL Esporte, ESPN Brasil
• Fabrizio Romano (@FabrizioRomano) para transferências/lesões de última hora

• Cite a fonte no fundamento. Prefira rigor estatístico (FBref/Opta/Sofascore) a portal de opinião.
• NUNCA cite, no campo "fundamento", casas de apostas, agregadores de odds ou blogs de "dicas/tips" (bet365, betano, betfair, legalbet, etc.) — mesmo que apareçam na busca.
• Odds de mercado podem ser INSUMO analítico genérico ("probabilidade implícita de mercado") — NUNCA nomeie a casa.
• Se um dado só existir em fonte P2 (ou só em fonte de apostas como odds), use-o com atribuição correta; não invente por falta de P1. NÃO descarte uma fonte boa só porque não é BBC/Guardian — a regra é priorizar, não excluir.`;

// Disciplina de tickets + sanity por competição (faixas em COMP_SANITY).
function ticketRulesFor(id){
  const s=compSanity(id);
  const cl=compLabel(id);
  let band='';
  if(s.kind==='league'){
    band=`FORMATO DE ${cl}: ${s.format}.
• Jogos de LIGA por clube na temporada: exatamente ${s.leagueGames} rodadas possíveis (um clube joga ${s.leagueGames} jogos de liga se completar a temporada).
• Jogador: raramente ultrapassa ${s.maxPlayerLeagueGames} jogos SÓ de liga; com copas/continentais, teto plausível ~${s.maxPlayerAllComps} jogos no total — acima disso sem base nos dados = alucinação.
• Artilharia na liga: faixa típica de ponta ~${s.goalsTopMin}–${s.goalsTopMax} gols; ≥${s.goalsAbsurd} gols SÓ na liga sem fonte nos dados = descarte.
• NÃO ASSUMA PRORROGAÇÃO (liga = 90'+acréscimos).`;
  }else{
    band=`FORMATO DE ${cl}: ${s.format}.
• Jogos NESTA competição por clube: tipicamente bem abaixo de uma liga nacional; teto plausível por jogador no torneio ~${s.maxPlayerCompGames} jogos (fase de grupos/liga + mata-mata). Total em todas as competições na temporada ainda pode chegar a ~${s.maxPlayerAllComps}.
• Artilharia NESTE torneio: faixa típica de ponta ~${s.goalsTopMin}–${s.goalsTopMax} gols; ≥${s.goalsAbsurd} só no torneio sem fonte = descarte.
• NÃO aplique "38 rodadas de pontos corridos" a copas.
• Prorrogação/pênaltis: só se a fase for mata-mata e as regras do torneio pedirem (não invente tempo extra em fase de grupos).`;
  }
  return `DISCIPLINA DE TICKETS E APOSTAS (regra obrigatória — evita alucinação e jargão):
• TERMINOLOGIA: NÃO use a gíria "perna" sozinha — escreva "aposta", "mercado" ou "perna do bilhete". Explique jargão na 1ª ocorrência (ex.: "same game parlay = várias apostas do mesmo jogo num bilhete").
• NUNCA invente odd/cotação numérica — fale em PROBABILIDADE estimada (%). Sem bilhete de casa de apostas com cotação fechada.
• ESTATÍSTICAS DE JOGADOR / lesão / forma: SOMENTE dos DADOS COLETADOS/BUSCA. Nunca de memória. Se não veio, diga que não confirmou.
• SANITY-CHECK OBRIGATÓRIO (faixas EXATAS desta competição):
${band}
• QUALIDADE DOS MERCADOS: priorize resultado, totais de gols, BTTS, jogador finaliza/marca, handicap, cartões. Evite mercados obscuros (tiro de meta, laterais) sem lastro.
• COERÊNCIA: não misture contagens de liga vs copas vs continental sem explicar.`;
}

// ─── Phase 1: fact gathering (Haiku + web_search) ────────────────────────
async function gatherFacts(query,apiKey,signal,onUpdate,maxSearches){
  // Coleta estruturada unificada (cascata AF→FD→ESPN + free registry + memória por times).
  // Orquestração em phase1-context.js — aqui só consome o resultado.
  const _compId=state.activeCompId||'brsa';
  let _ctx={fdCtx:'',hasFd:false,teams:[],apiText:'',memoryText:'',statusHuman:'',sources:null};
  try{_ctx=await _h('collectPhase1Context')(_compId,query);}catch(e){
    // fallback mínimo se phase1-context falhar no load
    try{
      const[standings,scoreboard]=await Promise.all([_h('getEspnStandings')(),_h('getEspnScoreboard')()]);
      const t=_h('formatEspnContext')(standings,scoreboard);
      _ctx={fdCtx:t,hasFd:!!t,teams:[],apiText:t,memoryText:'',statusHuman:t?'Fontes: ESPN':'',sources:null};
    }catch{_ctx={fdCtx:'',hasFd:false,teams:[],apiText:'',memoryText:'',statusHuman:'',sources:null};}
  }
  // Anti-fantasma + cobertura A/B/C na UI
  try{
    const st=_ctx.statusHuman||'';
    if(st&&onUpdate)onUpdate({status:st,phase:1,inTokens:0,outTokens:0});
    if(_ctx.coverage&&typeof _h('renderCoverageBadge')==='function')_h('renderCoverageBadge')(_ctx.coverage);
  }catch{}
  const fdCtx=_ctx.fdCtx||'';
  const hasFd=!!_ctx.hasFd;
  const _teams=Array.isArray(_ctx.teams)?_ctx.teams:[];
  const _activeIds=(_ctx.sources&&Array.isArray(_ctx.sources.active))?_ctx.sources.active.map(a=>a.id||a.label).filter(Boolean):[];
  const _cov=_ctx.coverage||null;
  let _covOut=_cov; // pode ser substituída pela cobertura pós-busca
  // jogadores_chave é uma LISTA DE OBJETOS estruturados (um por jogador citado) com o
  // conjunto fundamental de stats da competição — assim os mercados de jogador ficam cobertos
  // já na coleta e o portão de completude consegue checar campo a campo depois.
  const _pStat='{"nome":"","posicao":"","jogos":null,"minutos":null,"gols":null,"assistencias":null,"finalizacoes_por_jogo":null,"finalizacoes_no_gol_por_jogo":null,"grandes_chances_ou_passes_decisivos_por_jogo":null,"cartoes_amarelos":null,"cartoes_vermelhos":null,"a_um_amarelo_da_suspensao":null,"faltas_cometidas_por_jogo":null,"faltas_sofridas_por_jogo":null,"desarmes_por_jogo":null,"cobra_penaltis_ou_faltas":"","rating_medio":null,"observacao":""}';
  const _teamTpl='{"nome":"","tecnico":"","ranking_fifa":"","resultados_recentes":[],"xg_marcado":null,"xg_sofrido":null,"escanteios_por_jogo":null,"escanteios_sofridos_por_jogo":null,"desfalques":[],"escalacao_provavel":"","formacao":"","onze_provavel":[{"nome":"","posicao":""}],"banco":[],"jogadores_chave":['+_pStat+'],"estilo_ofensivo":"","vulnerabilidades_defensivas":[]}';
  const SCHEMA='{"mandante":'+_teamTpl+',"visitante":'+_teamTpl+',"contexto_fase":"","grupo_classificacao":"","lacunas":[]}';
  // web_search: tópicos enxugados só se AMBOS os times do jogo tiverem dim fresca (fail-safe).
  const _cl=compLabel(state.activeCompId);
  const _season=typeof compSeasonLabel==='function'?compSeasonLabel(state.activeCompId):'';
  let topics=hasFd?[
    `"[Mandante] [Visitante] ${_cl} técnico atual posição tabela lesões suspensões escalação provável xG estilo tático" — Sofascore, FotMob, Transfermarkt, fbref`,
    `"[Mandante] desfalques e [Visitante] vulnerabilidades defensivas ${_cl} esquema tático treinador" — imprensa esportiva, Sofascore`,
    `"[Mandante] [Visitante] ${_cl} fbref xG expected goals estatísticas avançadas" — fbref, Sofascore`
  ]:[
    `"[Mandante] [Visitante] ${_cl} técnico atual forma recente resultados lesões escalação provável" — ESPN, Sofascore, Transfermarkt`,
    `"[Mandante] [Visitante] ${_cl} xG estilo tático vulnerabilidades defensivas treinador" — fbref, Sofascore`,
    `"${_cl} ${_season} classificação tabela estatísticas" — ESPN, fbref, imprensa`
  ];
  let _skipNote='';
  try{
    // passa o TEXTO estruturado (não o booleano) — a cobertura por dimensão só
    // pula a busca do que realmente veio. Texto vazio → nada coberto → busca tudo (fail-safe).
    const filtered=_h('phase1FilterTopics')(topics,_compId,(_ctx.apiText||''),_teams);
    if(filtered&&Array.isArray(filtered.topics)&&filtered.topics.length){
      topics=filtered.topics;
      _skipNote=filtered.skipNote||'';
    }
  }catch{}
  let _maxUses=Math.max(1,Math.min(maxSearches??topics.length,topics.length));
  // Floor de buscas: perfil pede 1 busca (Haiku) mas a cobertura
  // B ou C está baixa pré-busca → sobe para 2 SÓ na F1 (não reativa UI de esforço).
  try{
    const _lvl=x=>String((x&&x.level)||'').toLowerCase();
    const _bcLow=!_cov||_lvl(_cov.B)!=='high'||_lvl(_cov.C)!=='high';
    if(_maxUses<2&&topics.length>=2&&_bcLow)_maxUses=2;
  }catch{}
  const _dir=topics.slice(0,_maxUses).map((s,i)=>`${'①②③④'[i]} ${s}`).join('\n');
  // Fontes hiperconfiáveis: TEXTO-GUIA no prompt (orienta o modelo a buscar/priorizar nelas).
  // NÃO usar como allowed_domains — a allowlist por domínio já degradou a coleta e quebrou o
  // formato estruturado 2x (ver worldcupagent-web-search-regression). Aqui é só dica, não filtro.
  // Só ativos + cobertura A/B/C (orienta busca com benefício; sem lacunas fantasma)
  const _activeNote=_activeIds.length
    ?('REPERTOIRE DESTA COLETA (ativos): '+_activeIds.join(', ')+'. Use o bloco REPERTOIRE; não invente dados de fonte ausente.\n')
    :'';
  const _covNote=_cov
    ?('COBERTURA A/B/C: A='+(_cov.A&&_cov.A.level)+' B='+(_cov.B&&_cov.B.level)+' C='+(_cov.C&&_cov.C.level)+' (ver bloco COBERTURA DE DADOS). Busque o que estiver baixa.\n')
    :'';
  const _srcNote='FONTES WEB (PRIORIZE P1; use P2 se necessário): '
    +'P1 imprensa: BBC Sport, The Guardian, Sky Sports, The Athletic, ESPN FC, Reuters. '
    +'P1 stats: Sofascore, FotMob, FBref/StatsBomb, Opta/The Analyst, WhoScored, Understat. '
    +'P1 oficiais: federações e sites de clubes/competições. '
    +'P2: Transfermarkt, Goal, Marca, AS, L\'Équipe, Gazzetta, Kicker, GE/Lance/UOL (BR/CONMEBOL), Fabrizio Romano. '
    +'Em conflito, prevalece a mais recente e oficial. '
    +'NÃO trate como lacuna uma fonte estruturada ausente do REPERTOIRE — busque só o que a COBERTURA marcar como baixa e o schema ainda pedir.';
  const _coverNote='IMPORTANTE: preencha o schema a partir dos DADOS DA API + buscas. Posição na tabela de '+_cl+': use blocos se A alta.\n'
    +'PLACARES: números exatos dos blocos ativos. Nunca "resultado inferido".\n'
    +'MEMÓRIA LOCAL (se no repertoire): reutilize técnico/xG do MESMO time; não é memória de treino.\n'
    +'PRIORIDADE DE BUSCA: o que a cobertura C/B marcar como baixa — tipicamente xG, métricas, desfalques, escalação se B não for alta.\n'
    +'ESCALAÇÃO — PRIORIDADE MÁXIMA (paridade V1): tecnico + formacao + onze_provavel (11 {nome,posicao}) + banco + desfalques DOS DOIS TIMES. '
    +'Deixar esses campos vazios = FALHA DE BUSCA (a imprensa publica provável escalação na véspera — refaça a busca focada no time faltante), não lacuna legítima. '
    +'PROIBIDO inventar nome: só o que dados/busca trouxerem; jogador incerto = "A confirmar" na posição. '
    +'FORMAÇÃO por time SEPARADA: NUNCA copie a mesma formação (ex.: 4-2-3-1) para os dois só porque é comum — cada "formacao" precisa de lastro na busca DAQUELE time; se só um time tem formação com fonte, deixe a do outro VAZIA ("") em vez de espelhar.\n'
    +'MÉTRICAS DE JOGADOR: 3–5 titulares com números reais de '+_cl+' — inclua cartoes_amarelos e faltas_cometidas_por_jogo (mercado disciplinar depende).\n'
    +'RESULTADOS RECENTES: SEMPRE com placar exato e mando — "V 2x1 Vasco (fora)", nunca só "V". Sem placar = busca incompleta.\n'
    +'xG e ESCANTEIOS/JOGO (a favor e sofridos): números públicos (Sofascore/FBref) — deixar null com busca disponível = falha de busca, não lacuna.\n'
    +'VALORES LIMPOS: NUNCA copie tags de citação da busca (<cite…>) para os valores do JSON — só texto/número puro.\n'
    +'VALIDAÇÃO CRUZADA: 2+ fontes ativas → cite juntas; conflito real → "lacunas" (não "fonte X ausente").\n'
    +_activeNote+_covNote+_skipNote+_srcNote+'\n'+SOURCE_RULE+'\n'+GROUNDING_RULE;
  const SP=hasFd
    ?`Você é um agente de pesquisa de futebol (${compLabel(state.activeCompId)}). Data: ${_h('currentDateFull')()}.
O bloco REPERTOIRE ESTRUTURADO ATIVO + DADOS DA API abaixo já trazem classificação/resultados/forma quando listados — NÃO re-busque o que eles cobrem.
Faça NO MÁXIMO ${_maxUses} busca(s) só para complementar o que falta:
${_dir}
${_coverNote}
Retorne APENAS JSON válido:
${SCHEMA}`
    :`Você é um agente de pesquisa de futebol (${compLabel(state.activeCompId)}). Data: ${_h('currentDateFull')()}.
Faça NO MÁXIMO ${_maxUses} busca(s) (uma por linha) e retorne APENAS JSON válido:
${SCHEMA}
BUSCAS:
${_dir}
${_coverNote}
Extraia placares, classificação de ${compLabel(state.activeCompId)}, xG e estilo das páginas. RESPONDA APENAS COM O JSON.`;
  const msgs=[{role:'user',content:hasFd?`${query}\n\nDADOS DA API:\n${fdCtx}`:query}];
  let accIn=0,accOut=0; // acumula uso por todas as iterações (busca + resposta)
  // Evidência de busca em TEXTO-CLARO (títulos + URLs dos resultados). O CORPO das páginas
  // vem cifrado/opaco no web_search (usado só p/ citação), então guardamos o que é legível —
  // serve de corpus para o portão anti-alucinação cruzar nomes de jogadores antes de renderizar.
  const _evi=[];
  // Fase 1 sempre no Haiku + web_search básico (caminho provado).
  let _useModel='claude-haiku-4-5-20251001';
  let _useTool='web_search_20250305';
  // Structured outputs na coleta: JSON garantido pela API (testado ao vivo com
  // Haiku 4.5 e Sonnet 4.6 + web_search). Auto-cura: 400 → desliga e repete.
  let _soP1=true;
  for(let i=0;i<5;i++){
    if(signal.aborted)throw new Error('cancelled');
    // 5000 (era 3000): schema com onze+banco+métricas truncava no teto → rawFacts nulo
    const mkBody=()=>JSON.stringify({model:_useModel,max_tokens:5000,system:SP,messages:msgs,tools:[{type:_useTool,name:'web_search',max_uses:_maxUses}],...(_soP1?{output_config:{format:{type:'json_schema',schema:FACTS_SCHEMA}}}:{})});
    let res=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body:mkBody(),signal});
    // Auto-cura em 400: desliga structured outputs (flag local) e repete no caminho provado.
    if(res.status===400&&_soP1){
      _soP1=false; // structured outputs não suportado neste acesso/combinação → caminho provado
      res=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body:mkBody(),signal});
    }
    _h('parseRateLimitHeaders')(res);if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error?.message||`Erro ${res.status}`);}
    const data=await res.json();
    const u=data.usage||{};accIn+=u.input_tokens||0;accOut+=u.output_tokens||0;
    // Colhe títulos/URLs dos resultados de busca desta iteração (texto-claro).
    try{(data.content||[]).forEach(b=>{
      if(b&&b.type==='web_search_tool_result'&&Array.isArray(b.content))
        b.content.forEach(r=>{if(r&&r.title)_evi.push(r.title);if(r&&r.url)_evi.push(r.url);});
    });}catch(_){}
    onUpdate({inTokens:accIn,outTokens:accOut,status:'Pesquisando dados…',phase:1});
    // HARDENING: max_tokens (truncou no teto) também é terminal — antes caía no
    // `break` e jogava fora um JSON quase completo; agora tenta salvar via repairJson.
    if(data.stop_reason==='end_turn'||data.stop_reason==='max_tokens'){
      const txt=data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
      // Parse ROBUSTO (mesmo caminho da F2): strip de cercas markdown + repairJson p/
      // truncamento — o match/JSON.parse ingênuo era causa direta de fase1-parse.
      let rawFacts=parseAnalysisJson(txt);
      if(!rawFacts&&!signal.aborted){
        // RETRY DE FORMA (1 chamada, Haiku SEM tools, prefill '{' — Haiku aceita prefill,
        // inv. 30): reescreve a resposta anterior como JSON puro. Espelha o retry da F2.
        onUpdate({inTokens:accIn,outTokens:accOut,status:'Reformatando coleta…',phase:1});
        const r2=await _p1JsonRescue(txt,SP,apiKey,signal).catch(()=>null);
        if(r2){accIn+=r2.inTokens;accOut+=r2.outTokens;if(r2.rawFacts)rawFacts=r2.rawFacts;}
      }
      // Diagnóstico Fase 1: coleta terminou sem JSON → registra amostra
      // (a análise segue "direto do modelo" e a aba Escalação fica sem mapa).
      if(!rawFacts){try{globalThis._lastAnalysisFail={ts:Date.now(),stage:'fase1-parse',model:_useModel,sample:'[stop='+data.stop_reason+', retry de forma falhou] '+String(txt||'').slice(0,360)};console.warn('[analysis-fail] fase1-parse',globalThis._lastAnalysisFail);}catch{}}
      // Anexa o corpus de evidência (dados da API + títulos/URLs de busca), minúsculo, p/ o
      // portão anti-alucinação. Não-enumerável: não polui o JSON exibido nem a persistência.
      if(rawFacts&&typeof rawFacts==='object'){
        try{Object.defineProperty(rawFacts,'_evidence',{value:((hasFd?fdCtx:'')+'\n'+_evi.join('\n')).toLowerCase(),enumerable:false,configurable:true});}catch(_){}
        // PLAUSIBILIDADE ANTES DA MEMÓRIA: descarta stats absurdas AQUI —
        // depois deste ponto o valor entra no facts-memory e RE-SERVE análises futuras
        // (caso real: "10.5 escanteios a favor/jogo" reapareceu diversas vezes).
        _sanitizeCollectedStats(rawFacts);
        // Grava fatos básicos na memória local → próximas análises skipam web_search repetido.
        try{_h('factsMemIngestRawFacts')(_compId,rawFacts);}catch{}
        // Cobertura pós-busca: o que a busca trouxe (xG/métricas → C; técnico/onze → B)
        // sobe o score (nunca rebaixa) e re-pinta o badge — a UI mostra a cobertura REAL.
        try{
          const cov2=_h('updateCoverageAfterSearch')(rawFacts);
          if(cov2){_covOut=cov2;if(cov2.summaryHuman&&onUpdate)onUpdate({status:cov2.summaryHuman,phase:1,inTokens:accIn,outTokens:accOut});}
        }catch{}
      }
      return{rawFacts,inTokens:accIn,outTokens:accOut,sources:_ctx.sources||null,statusHuman:_ctx.statusHuman||'',coverage:_covOut};
    }
    if(data.stop_reason==='tool_use'){
      msgs.push({role:'assistant',content:data.content});
      msgs.push({role:'user',content:data.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});
    }else if(data.stop_reason==='pause_turn'){
      msgs.push({role:'assistant',content:data.content}); // retoma a busca server-side
    }else break;
  }
  // Loop esgotado (5 iterações sem end_turn) — também é falha de Fase 1
  try{globalThis._lastAnalysisFail={ts:Date.now(),stage:'fase1-loop',model:_useModel,msg:'coleta não convergiu em 5 iterações (tool_use/pause sem end_turn)'};console.warn('[analysis-fail] fase1-loop');}catch{}
  return{rawFacts:null,inTokens:accIn,outTokens:accOut,sources:_ctx.sources||null,statusHuman:_ctx.statusHuman||'',coverage:_covOut};
}
// RETRY DE FORMA da Fase 1: a coleta terminou em prosa/JSON quebrado →
// 1 chamada Haiku SEM tools com prefill '{' (Haiku aceita prefill; NUNCA usar em
// Sonnet 5 — inv. 30) reescrevendo a resposta anterior como JSON puro do schema.
async function _p1JsonRescue(prevText,SP,apiKey,signal){
  const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:5000,system:SP,
    messages:[
      {role:'user',content:'Sua resposta anterior NÃO veio como JSON válido. Reescreva-a agora APENAS como o objeto JSON do schema pedido, começando com { e terminando com }, sem markdown e sem texto fora do objeto. Use somente as informações da resposta anterior; campos sem informação ficam vazios/"" (não invente).\n\nRESPOSTA ANTERIOR:\n'+String(prevText||'').slice(0,6000)},
      {role:'assistant',content:'{'}
    ]});
  const res=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body,signal});
  if(!res.ok)return null;
  const data=await res.json();
  const u=data.usage||{};
  const txt='{'+(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  return{rawFacts:parseAnalysisJson(txt),inTokens:u.input_tokens||0,outTokens:u.output_tokens||0};
}
// Fecha chaves/colchetes pendentes e aspas abertas → recupera JSON cortado no max_tokens.
function repairJson(s){
  let t=s.replace(/,\s*$/,'');
  let inStr=false,esc=false;const stack=[];
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(esc){esc=false;continue;}
    if(c==='\\'){esc=true;continue;}
    if(c==='"'){inStr=!inStr;continue;}
    if(inStr)continue;
    if(c==='{'||c==='[')stack.push(c);
    else if(c==='}'||c===']')stack.pop();
  }
  if(inStr)t+='"';
  t=t.replace(/,\s*$/,'');
  while(stack.length)t+=(stack.pop()==='{'?'}':']');
  return t;
}
// Extrai o objeto JSON da resposta do modelo, tolerando markdown e truncamento.
// ── Tags de citação do web_search vazando em VALORES ───────────
// Caso real (Grêmio × Fluminense): gols:'<cite index="2-5">10</cite>' e
// observações inteiras embrulhadas em <cite> renderizavam como texto literal.
// O modelo copia os spans citados da busca para dentro do JSON. Regra de
// arquitetura: TODO JSON de LLM passa por parseAnalysisJson (invariante 33) —
// então o strip aqui cobre TODAS as features estruturadas, atuais e futuras,
// por construção. Mantém o conteúdo interno; remove só a marcação.
const _CITE_TAG_RE=/<\/?(?:cite|citation|source|ref|antml[a-z]*)\b[^>]*>/gi;
function stripCites(s){return String(s).replace(_CITE_TAG_RE,'');}
function stripCiteDeep(x){
  if(typeof x==='string')return _CITE_TAG_RE.test(x)?stripCites(x):x;
  if(Array.isArray(x))return x.map(stripCiteDeep);
  if(x&&typeof x==='object'){for(const k of Object.keys(x))x[k]=stripCiteDeep(x[k]);return x;}
  return x;
}
function parseAnalysisJson(raw){
  const clean=(raw||'').replace(/```(?:json)?\s*/gi,'').replace(/```/g,'');
  const start=clean.indexOf('{');if(start<0)return null;
  const lastClose=clean.lastIndexOf('}');
  if(lastClose>start){
    const cand=clean.slice(start,lastClose+1);
    try{return stripCiteDeep(JSON.parse(cand));}catch{}
    try{return stripCiteDeep(JSON.parse(repairJson(cand)));}catch{}
  }
  // Truncado no max_tokens (sem } final): repara do primeiro { até o fim.
  try{return stripCiteDeep(JSON.parse(repairJson(clean.slice(start))));}catch{}
  return null;
}
function buildEnrichedQuery(query,rawFacts,ctx){
  const parts=[query];
  if(rawFacts){parts.push('\nDADOS PRÉ-COLETADOS (não pesquise, calcule com base nisto):');parts.push(JSON.stringify(rawFacts,null,2));}
  if(ctx){parts.push('\nCONTEXTO DO TORNEIO (standings e resultados recentes):');parts.push(ctx);}
  return parts.join('\n');
}

// ─── Portão de completude por jogador (garantia por CÓDIGO, não por prompt) ───
// Depois da coleta, checa se os titulares citados têm os stats-chave preenchidos.
// Se faltar, dispara UMA busca-alvo (Haiku + web_search) só para os campos vazios e
// funde o resultado no rawFacts. Custo ZERO quando a coleta já veio completa (só
// inspeciona o JSON em memória — nenhuma chamada de API).
// faltas_cometidas_por_jogo: auditoria real apontou "dados de cartões e
// faltas escassos para a maioria dos jogadores" — o mercado disciplinar depende disso.
// Custo: zero chamadas extras (entra na MESMA passagem de gap já existente).
const _PLAYER_CRITICAL=['gols','finalizacoes_no_gol_por_jogo','cartoes_amarelos','faltas_cometidas_por_jogo','rating_medio'];
const _PLAYER_FIELDS=['posicao','jogos','minutos','gols','assistencias','finalizacoes_por_jogo','finalizacoes_no_gol_por_jogo','grandes_chances_ou_passes_decisivos_por_jogo','cartoes_amarelos','cartoes_vermelhos','a_um_amarelo_da_suspensao','faltas_cometidas_por_jogo','faltas_sofridas_por_jogo','desarmes_por_jogo','cobra_penaltis_ou_faltas','rating_medio','observacao'];
// Fatos de TIME públicos e estáveis que NUNCA devem virar lacuna — o portão os
// busca deterministicamente se a coleta vier vazia (mesmo racional do ranking na regra).
// xG e escanteios entram aqui — a auditoria real pegou a F2 "estimando"
// xG que a coleta não trouxe (grave: número central sem lastro) e escanteios sem
// estatística. Sofascore/FBref publicam ambos; vazio = falha de busca, não lacuna.
const _TEAM_CRITICAL=['ranking_fifa','xg_marcado','xg_sofrido','escanteios_por_jogo','escanteios_sofridos_por_jogo'];
// resultados_recentes SEM PLACAR EXATO: "V, V, D" qualitativo deixa a F2
// sem margem de vitória (auditoria: "placar exato da rodada 18 não fornecido").
// Conta como gap quando a lista está vazia OU nenhuma entrada tem dígitos de placar.
// ── Plausibilidade de stats coletadas ──────────────────────────
// A busca às vezes traz o número ERRADO (caso real: "10.5 escanteios a favor/jogo"
// — isso é o total do JOGO, não a média de UM time; nenhum time tem essa média).
// Valor implausível é DESCARTADO (null) + lacuna declarada — e isso PRECISA rodar
// antes do facts-memory, senão o lixo é memorizado e re-servido por dias.
// Faixas por TIME/jogo: escanteios 1–9.9 · xG 0.1–4.5. Fora disso = coleta errada.
const _STAT_RANGES={escanteios_por_jogo:[1,9.9],escanteios_sofridos_por_jogo:[1,9.9],xg_marcado:[0.1,4.5],xg_sofrido:[0.1,4.5]};
function _sanitizeCollectedStats(rawFacts){
  if(!rawFacts||typeof rawFacts!=='object')return rawFacts;
  if(!Array.isArray(rawFacts.lacunas))rawFacts.lacunas=[];
  for(const side of ['mandante','visitante']){
    const tm=rawFacts[side];
    if(!tm||typeof tm!=='object')continue;
    for(const[f,[lo,hi]]of Object.entries(_STAT_RANGES)){
      const v=tm[f];
      if(v==null||v==='')continue;
      const n=Number(v);
      if(!isFinite(n)||n<lo||n>hi){
        tm[f]=null;
        rawFacts.lacunas.push(`${f} de ${tm.nome||side} descartado por implausibilidade (veio ${v}; faixa aceita ${lo}–${hi} por time/jogo) — provável dado do jogo inteiro ou de outra métrica`);
      }
    }
  }
  return rawFacts;
}
function _teamResultsNeedScores(tm){
  if(!tm||!tm.nome)return false;
  const rr=Array.isArray(tm.resultados_recentes)?tm.resultados_recentes:[];
  if(!rr.length)return true;
  return !rr.some(r=>/\d\s*[xX×–—:-]\s*\d/.test(String(r||'')));
}
// Campos de ESCALAÇÃO do time: técnico/formação/onze/banco vazios
// disparam a passagem de gap — no V1 esses campos vinham no caminho AF; no Free multi-liga
// a busca dirigida é quem os garante. Arrays vazios também contam como faltantes.
const _TEAM_LINEUP_FILL=['tecnico','formacao','onze_provavel','banco'];
function _pgEmpty(v){return v===null||v===undefined||v===''||(Array.isArray(v)&&v.length===0);}
function _pgNorm(s){return String(s||'').trim().toLowerCase();}
function _mergePlayerPatch(rawFacts,patchArr){
  const byName={};patchArr.forEach(p=>{if(p&&p.nome)byName[_pgNorm(p.nome)]=p;});
  [rawFacts.mandante,rawFacts.visitante].filter(Boolean).forEach(tm=>{
    (Array.isArray(tm.jogadores_chave)?tm.jogadores_chave:[]).forEach(p=>{
      if(!p||typeof p!=='object')return;
      const src=byName[_pgNorm(p.nome)];if(!src)return;
      _PLAYER_FIELDS.forEach(f=>{if(_pgEmpty(p[f])&&!_pgEmpty(src[f]))p[f]=src[f];});
    });
  });
}
function _mergeTeamPatch(rawFacts,timesArr){
  if(!Array.isArray(timesArr))return;
  const byName={};timesArr.forEach(t=>{if(t&&t.nome)byName[_pgNorm(t.nome)]=t;});
  [rawFacts.mandante,rawFacts.visitante].filter(Boolean).forEach(tm=>{
    if(!tm||!tm.nome)return;
    const src=byName[_pgNorm(tm.nome)];if(!src)return;
    _TEAM_CRITICAL.forEach(f=>{if(_pgEmpty(tm[f])&&!_pgEmpty(src[f]))tm[f]=src[f];});
    // Escalação: completa técnico/formação/onze/banco vindos da passagem de gap
    _TEAM_LINEUP_FILL.forEach(f=>{if(_pgEmpty(tm[f])&&!_pgEmpty(src[f]))tm[f]=src[f];});
    // resultados_recentes: caso especial — o campo pode vir PREENCHIDO mas
    // sem placar ("V, V, D"); se o patch trouxe ao menos uma entrada COM placar exato,
    // a versão com números substitui a qualitativa. Nunca o contrário (não regride).
    if(_teamResultsNeedScores(tm)&&Array.isArray(src.resultados_recentes)
      &&src.resultados_recentes.some(r=>/\d\s*[xX×–—:-]\s*\d/.test(String(r||''))))
      tm.resultados_recentes=src.resultados_recentes;
  });
}
// Um time tem escalação "completa" p/ o portão? tecnico + formacao + onze com 11.
function _teamLineupGaps(tm){
  if(!tm||!tm.nome)return null;
  const faltando=[];
  if(_pgEmpty(tm.tecnico))faltando.push('tecnico');
  if(_pgEmpty(tm.formacao))faltando.push('formacao');
  const onze=Array.isArray(tm.onze_provavel)?tm.onze_provavel.filter(p=>p&&(typeof p==='string'?p:p.nome)):[];
  if(onze.length<11)faltando.push('onze_provavel (faltam '+(11-onze.length)+' de 11)');
  if(_pgEmpty(tm.banco))faltando.push('banco');
  return faltando.length?{nome:tm.nome,faltando}:null;
}
async function fillDataGaps(rawFacts,apiKey,signal,onUpdate){
  try{
    if(!rawFacts)return{inTokens:0,outTokens:0};
    const gaps=[];
    [rawFacts.mandante,rawFacts.visitante].filter(Boolean).forEach(tm=>{
      (Array.isArray(tm.jogadores_chave)?tm.jogadores_chave:[]).forEach(p=>{
        if(!p||typeof p!=='object'||!p.nome)return;
        const missing=_PLAYER_CRITICAL.filter(f=>_pgEmpty(p[f]));
        if(missing.length)gaps.push({nome:p.nome,faltando:missing});
      });
    });
    // Fatos de TIME faltantes (posição na tabela): público — não pode virar lacuna.
    const teamGaps=[];
    [rawFacts.mandante,rawFacts.visitante].filter(Boolean).forEach(tm=>{
      if(!tm||!tm.nome)return;
      const missing=_TEAM_CRITICAL.filter(f=>_pgEmpty(tm[f]));
      // placar exato dos últimos jogos: forma "V,V,D" sem números = gap
      if(_teamResultsNeedScores(tm))missing.push('resultados_recentes (últimos 5 COM placar exato, ex. "V 2x1 Vasco (fora)")');
      if(missing.length)teamGaps.push({nome:tm.nome,faltando:missing});
    });
    // Escalação faltante: técnico vazio OU onze<11 em QUALQUER
    // time dispara a passagem — no V1 isso vinha da AF; aqui a busca dirigida garante.
    const luGaps=[rawFacts.mandante,rawFacts.visitante].map(_teamLineupGaps).filter(Boolean);
    if(!gaps.length&&!teamGaps.length&&!luGaps.length)return{inTokens:0,outTokens:0}; // completo → custo zero
    onUpdate&&onUpdate({status:'Completando dados faltantes…',phase:1});
    const partes=[];
    const _clGap=compLabel(state.activeCompId);
    if(luGaps.length)partes.push('ESCALAÇÕES (PRIORIDADE MÁXIMA — a imprensa publica provável escalação na véspera; busque "[time] escalação provável" na imprensa/Sofascore; NUNCA invente nome — sem fonte, deixe vazio; FORMAÇÃO de cada time precisa de lastro próprio, NÃO espelhe a mesma nos dois):\n'+luGaps.map(g=>`- ${g.nome}: faltam ${g.faltando.join(', ')}`).join('\n'));
    if(teamGaps.length)partes.push('CLUBES (dados públicos de '+_clGap+' — tabela ex. "5º · 28 pts"; xG e escanteios/jogo no Sofascore/FBref; resultados SEMPRE com placar exato):\n'+teamGaps.map(g=>`- ${g.nome}: faltam ${g.faltando.join(', ')}`).join('\n'));
    if(gaps.length)partes.push('JOGADORES:\n'+gaps.map(g=>`- ${g.nome}: faltam ${g.faltando.join(', ')}`).join('\n'));
    const SP=`Você preenche dados FALTANTES de ${_clGap} buscando na web (escalação provável/tabela · Sofascore/FotMob/FBref/imprensa). Retorne APENAS JSON válido: {"times":[{"nome":"","ranking_fifa":"","tecnico":"","formacao":"","xg_marcado":null,"xg_sofrido":null,"escanteios_por_jogo":null,"escanteios_sofridos_por_jogo":null,"resultados_recentes":[],"onze_provavel":[{"nome":"","posicao":""}],"banco":[]}],"jogadores":[{"nome":"","posicao":"","jogos":null,"minutos":null,"gols":null,"assistencias":null,"finalizacoes_por_jogo":null,"finalizacoes_no_gol_por_jogo":null,"grandes_chances_ou_passes_decisivos_por_jogo":null,"cartoes_amarelos":null,"cartoes_vermelhos":null,"a_um_amarelo_da_suspensao":null,"faltas_cometidas_por_jogo":null,"faltas_sofridas_por_jogo":null,"desarmes_por_jogo":null,"cobra_penaltis_ou_faltas":"","rating_medio":null,"observacao":""}]}. Preencha ao menos os campos pedidos. Use null/""/[] quando a busca não trouxer; NUNCA invente de memória; descarte implausíveis (totais absurdos de jogos/gols na temporada).`;
    const msgs=[{role:'user',content:`DATA: ${_h('currentDateFull')()}. Busque e preencha os dados faltantes em ${_clGap}:\n${partes.join('\n\n')}`}];
    let accIn=0,accOut=0;
    for(let i=0;i<3;i++){
      if(signal.aborted)break;
      const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:2500,system:SP,messages:msgs,tools:[{type:'web_search_20250305',name:'web_search',max_uses:2}]});
      const res=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body,signal});
      if(!res.ok)break;
      const data=await res.json();const u=data.usage||{};accIn+=u.input_tokens||0;accOut+=u.output_tokens||0;
      if(data.stop_reason==='end_turn'){
        const txt=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        const patch=parseAnalysisJson(txt); // robusto: fences + repairJson
        if(patch){if(Array.isArray(patch.jogadores))_mergePlayerPatch(rawFacts,patch.jogadores);if(Array.isArray(patch.times))_mergeTeamPatch(rawFacts,patch.times);}
        _sanitizeCollectedStats(rawFacts); // o patch de gap também pode trazer número implausível
        break;
      }
      if(data.stop_reason==='tool_use'){
        msgs.push({role:'assistant',content:data.content});
        msgs.push({role:'user',content:data.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});
      }else if(data.stop_reason==='pause_turn'){msgs.push({role:'assistant',content:data.content});}
      else break;
    }
    // ── RESGATE DE TÉCNICO ────────────────────────────────────
    // Caso real: card saiu com "Técnico atual do Vitória não confirmado na coleta".
    // Técnico de clube de 1ª divisão é dado PÚBLICO (Wikipedia/GE/ESPN sempre têm) —
    // se após a passagem de gaps ainda estiver vazio, UMA busca dedicada por lado
    // faltante (Haiku, 1 web_search, teto 400 tokens). Vazio de verdade só se até
    // a busca focada falhar — aí a lacuna declarada é legítima.
    for(const side of ['mandante','visitante']){
      const tm=rawFacts[side];
      if(!tm||!tm.nome||!_pgEmpty(tm.tecnico))continue;
      if(signal.aborted)break;
      onUpdate&&onUpdate({status:'Confirmando técnico de '+tm.nome+'…',phase:1});
      try{
        const _cReq={model:'claude-haiku-4-5-20251001',max_tokens:400,
          system:'Responda APENAS JSON {"tecnico":""}. Busque o técnico ATUAL (hoje) do clube. É informação pública — Wikipedia/GE/ESPN sempre têm. Só devolva "" se a busca realmente não confirmar. NUNCA invente nem devolva técnico antigo: confirme que é o atual.',
          messages:[{role:'user',content:'DATA: '+_h('currentDateFull')()+'. Quem é o técnico atual do '+tm.nome+' ('+_clGap+')?'}],
          tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}]};
        let data2=null;
        for(let k=0;k<3;k++){
          const r2=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body:JSON.stringify(_cReq),signal});
          if(!r2.ok)break;
          data2=await r2.json();const u2=data2.usage||{};accIn+=u2.input_tokens||0;accOut+=u2.output_tokens||0;
          if(data2.stop_reason==='tool_use'){
            _cReq.messages.push({role:'assistant',content:data2.content});
            _cReq.messages.push({role:'user',content:data2.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});
            continue;
          }
          if(data2.stop_reason==='pause_turn'){_cReq.messages.push({role:'assistant',content:data2.content});continue;}
          break;
        }
        if(data2&&data2.stop_reason==='end_turn'){
          const txt2=(data2.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
          const p2=parseAnalysisJson(txt2);
          if(p2&&typeof p2.tecnico==='string'&&p2.tecnico.trim().length>2)tm.tecnico=p2.tecnico.trim();
        }
      }catch(e2){if(e2&&(e2.name==='AbortError'||e2.message==='cancelled'))throw e2;}
    }
    return{inTokens:accIn,outTokens:accOut};
  }catch(e){if(e&&(e.name==='AbortError'||e.message==='cancelled'))throw e;return{inTokens:0,outTokens:0};}
}

// ─── Portão anti-alucinação de nome (garantia por CÓDIGO, não por prompt) ──────
// A instrução de prompt (GROUNDING_RULE) já pedia para não inventar jogador, e mesmo assim
// escapou (ex.: Di María "convocado" mesmo já fora do clube). Aqui o CÓDIGO cruza cada
// nome da escalação contra uma verificação com busca fresca — e ESCOVA os comprovadamente
// fora do elenco atual ANTES da Fase 2 usar o nome. Só marca inválido quem a busca confirma
// que NÃO está no elenco (aposentado/cortado/inexistente); "não achei nada" NÃO invalida
// (evita falso-positivo que apagaria titular real). Mesmo racional/estrutura do fillDataGaps.
function _lvKey(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function _lvCollectNames(tm){
  if(!tm)return[];
  const out=[],push=n=>{const c=_h('_cleanName')(n);if(c&&c.length>1&&!/^a confirmar$/i.test(c))out.push(c);};
  (Array.isArray(tm.onze_provavel)?tm.onze_provavel:[]).forEach(p=>push(typeof p==='string'?p:(p&&p.nome)));
  (Array.isArray(tm.banco)?tm.banco:[]).forEach(push);
  const rows=_h('_lineupRowsFromText')(tm.escalacao_provavel||'',tm.formacao||'');
  if(rows)rows.flat().forEach(p=>push(p.nome));
  const seen=new Set(),ded=[];
  out.forEach(n=>{const k=_lvKey(n);if(k&&!seen.has(k)){seen.add(k);ded.push(n);}});
  return ded;
}
// Escova um time: onze_provavel inválido → "A confirmar" (mantém posição p/ não desalinhar o
// mapa); banco inválido → removido; escalacao_provavel → nome trocado por "a confirmar".
function _lvScrubTeam(tm,invalidKeys){
  if(!tm||!invalidKeys.size)return[];
  const removed=[];
  if(Array.isArray(tm.onze_provavel))tm.onze_provavel.forEach(p=>{
    const nm=typeof p==='string'?p:(p&&p.nome);if(!nm)return;
    if(invalidKeys.has(_lvKey(nm))){removed.push(nm);if(typeof p==='object')p.nome='A confirmar';}
  });
  if(Array.isArray(tm.onze_provavel))tm.onze_provavel=tm.onze_provavel.map(p=>typeof p==='string'&&invalidKeys.has(_lvKey(p))?{nome:'A confirmar',posicao:''}:p);
  if(Array.isArray(tm.banco))tm.banco=tm.banco.filter(n=>{const bad=invalidKeys.has(_lvKey(n));if(bad)removed.push(n);return!bad;});
  if(tm.escalacao_provavel&&removed.length){
    removed.forEach(nm=>{const re=new RegExp(nm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');tm.escalacao_provavel=tm.escalacao_provavel.replace(re,'a confirmar');});
  }
  return[...new Set(removed)];
}
async function verifyLineupNames(rawFacts,apiKey,signal,onUpdate){
  try{
    if(!rawFacts)return{inTokens:0,outTokens:0};
    const mNames=_lvCollectNames(rawFacts.mandante),vNames=_lvCollectNames(rawFacts.visitante);
    if(!mNames.length&&!vNames.length)return{inTokens:0,outTokens:0}; // sem escalação → nada a checar
    const cap=a=>a.slice(0,16); // teto de nomes por time (mantém a chamada barata)
    const mN=cap(mNames),vN=cap(vNames);
    const mNome=(rawFacts.mandante&&rawFacts.mandante.nome)||'mandante',vNome=(rawFacts.visitante&&rawFacts.visitante.nome)||'visitante';
    onUpdate&&onUpdate({status:'Verificando escalações…',phase:1});
    const evi=(rawFacts._evidence||'').slice(0,3000);
    const _clLv=compLabel(state.activeCompId);
    const SP=`Você VERIFICA elencos de ${_clLv} com busca na web. Para CADA jogador listado, confirme se ele está ATUALMENTE no clube indicado e disponível (no elenco) para ${_clLv}. Responda APENAS JSON: {"jogadores":[{"nome":"","time":"mandante|visitante","no_elenco":true|false|null}]}. `
      +'no_elenco=false SOMENTE se a busca mostrar que ele NÃO está no elenco atual (aposentado do clube, cortado, ou nome que não corresponde a jogador real desse clube). no_elenco=true se achar o jogador no elenco/escalação atual. no_elenco=null se não achar evidência suficiente — NUNCA invalide por falta de evidência, só com evidência de ausência. Não invente jogadores nem substitutos.';
    const lista=[...mN.map(n=>`- ${n} (${mNome})`),...vN.map(n=>`- ${n} (${vNome})`)].join('\n');
    const msgs=[{role:'user',content:`DATA: ${_h('currentDateFull')()}. Jogo: ${mNome} x ${vNome}. Verifique no elenco atual (${_clLv}):\n${lista}${evi?`\n\nEVIDÊNCIA JÁ COLETADA (títulos/links de busca — use como pista, confirme com nova busca):\n${evi}`:''}`}];
    let accIn=0,accOut=0,verif=null;
    for(let i=0;i<3;i++){
      if(signal.aborted)break;
      const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1200,system:SP,messages:msgs,tools:[{type:'web_search_20250305',name:'web_search',max_uses:3}]});
      const res=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body,signal});
      if(!res.ok)break;
      const data=await res.json();const u=data.usage||{};accIn+=u.input_tokens||0;accOut+=u.output_tokens||0;
      if(data.stop_reason==='end_turn'){
        const txt=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        verif=parseAnalysisJson(txt); // robusto: fences + repairJson
        break;
      }
      if(data.stop_reason==='tool_use'){
        msgs.push({role:'assistant',content:data.content});
        msgs.push({role:'user',content:data.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});
      }else if(data.stop_reason==='pause_turn'){msgs.push({role:'assistant',content:data.content});}
      else break;
    }
    if(verif&&Array.isArray(verif.jogadores)){
      const invalid=new Set(verif.jogadores.filter(j=>j&&j.no_elenco===false&&j.nome).map(j=>_lvKey(j.nome)));
      if(invalid.size){
        const rm=[..._lvScrubTeam(rawFacts.mandante,invalid),..._lvScrubTeam(rawFacts.visitante,invalid)];
        if(rm.length){
          rawFacts.lacunas=Array.isArray(rawFacts.lacunas)?rawFacts.lacunas:[];
          rawFacts.lacunas.push(`Nome(s) retirado(s) da escalação por não constarem no elenco atual de ${compLabel(state.activeCompId)} (verificação automática): ${rm.join(', ')}.`);
        }
      }
    }
    return{inTokens:accIn,outTokens:accOut};
  }catch(e){if(e&&(e.name==='AbortError'||e.message==='cancelled'))throw e;return{inTokens:0,outTokens:0};}
}

// ─── Fase 3 · Verificador (auditor pré-render) ────────────────────────────
// Papel novo no pipeline: um crítico BARATO (Haiku, sem web_search) que recebe os
// fatos coletados + a análise pronta e aponta problemas OBJETIVOS antes de renderizar.
// Ele NUNCA reescreve a análise (modelo barato reescrevendo o analista degradaria o
// resultado): devolve ressalvas, e a fusão é feita por CÓDIGO — anota em "incerteza",
// rebaixa confiança mal calibrada e carimba o selo de auditoria no card.
// ── Backstop de convergência ──────────────────────────────────
// A review anterior mostrou o AUDITOR (Haiku) como fonte de "grave": ele acusou
// uma probabilidade de erro CHUTANDO a conta (0.58 vs 0.53 correto) — e o _applyAudit
// empurrava essa acusação falsa pro card como "Auditoria (grave)". O prompt do 109 pediu
// que ele "refaça a conta", mas Haiku erra aritmética. Fix por CÓDIGO (filosofia do
// projeto: código calcula probabilidade, o modelo não audita a conta): ressalva que ataca
// um valor que o CÓDIGO já decidiu/carimbou (Poisson/dupla chance/confiança/desfalque×onze)
// é DESCARTADA — código é a autoridade sobre esses valores; o auditor não.
function _auditStampBlob(parsed){
  try{return JSON.stringify(parsed).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');}catch{return '';}
}
function _auditIsCodeFalsePositive(parsed,r,stampBlob){
  const txt=(String(r.problema||'')+' '+String(r.onde||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const blob=stampBlob!==undefined?stampBlob:_auditStampBlob(parsed);
  // (1) aritmética/probabilidade: código reconcilia por Poisson (105) e dupla chance (103).
  //     O caso real: auditor acusou 0.53 de "erro" — código é a autoridade sobre o Poisson.
  if(/incompat|nao bate|inconsist|arit|\bsoma|\bprob|lambda|poisson|\d\s*%|\d\.\d/.test(txt)
     &&/recalculada por poisson|reconciliada por codigo|recalculada por codigo/.test(blob))return true;
  // (2) confiança "alta demais": código já rebaixou/calibrou por ticket (108).
  if(/confianc|confidence|calibrad|otimist|superestim|alto demais|elevad/.test(txt)
     &&/confianca rebaixada por codigo/.test(blob))return true;
  // (3) jogador em desfalques E no onze: código já reconciliou (109). Exige a
  //     CO-OCORRÊNCIA (a contradição real) — "desfalque" solto marcaria por engano uma
  //     alucinação legítima sobre um desfalque (falha pega no teste).
  if((( /desfalque|ausenc|fora/.test(txt)&&/\bonze\b|escala|titular/.test(txt) )||/duas listas|nas duas|ambas as listas/.test(txt))
     &&/a confirmar \(era .* listado como desfalque/.test(blob))return true;
  // (4) RISCO de suspensão por acúmulo de amarelos ("pendurado") tratado como AUSÊNCIA do
  //     jogo ATUAL: um jogador a um amarelo da suspensão está DISPONÍVEL agora — o risco é
  //     de jogo FUTURO — e fica legitimamente no onze. O modelo de dados já separa isso
  //     (campo a_um_amarelo_da_suspensao ≠ desfalque; o reconcile do 109 manteve o jogador
  //     no onze). Caso real (Coritiba, Robson): auditor chamou de "contradição interna" o
  //     onze incluir um pendurado. Gated: só descarta se os DADOS têm mesmo um pendurado
  //     (senão uma acusação de suspensão CONFIRMADA no onze — que seria legítima — passa).
  if(/onze|escala|titular|disponibil|contradi|suspens/.test(txt)
     &&/risco de suspens|a um amarelo|pendurad|3\D{0,4}(amarelo|cartao)|pode (estar|ficar)\s+(de\s+)?(fora|suspenso)|acumul\w*\s+\w*\s*(amarelo|cartao)/.test(txt)
     &&/a_um_amarelo_da_suspensao["':\s]+true|risco de suspens|pendurad|a um amarelo/.test(blob))return true;
  return false;
}
function _applyAudit(parsed,v){
  if(!parsed||!v)return 0;
  let rs=Array.isArray(v.ressalvas)?v.ressalvas.filter(r=>r&&r.problema):[];
  const nBefore=rs.length;
  const blob=_auditStampBlob(parsed);
  rs=rs.filter(r=>!_auditIsCodeFalsePositive(parsed,r,blob)); // descarta falso positivo de código
  const dropped=nBefore-rs.length;
  rs=rs.slice(0,4);
  if(rs.length){
    parsed.incerteza=Array.isArray(parsed.incerteza)?parsed.incerteza:[];
    rs.forEach(r=>parsed.incerteza.push({fator:`Auditoria (${r.gravidade==='alta'?'grave':'atenção'}): ${r.problema}`,impacto:r.onde||'apontado na verificação automática pré-entrega'}));
  }
  // Rebaixar só se sobrou ressalva LEGÍTIMA: se o auditor só trouxe falso positivo de
  // código (todas descartadas), rebaixar a confiança pela "opinião" dele seria o mesmo
  // falso positivo por outra via.
  const allDroppedAsFP=nBefore>0&&rs.length===0;
  if(v.rebaixar_confianca===true&&!allDroppedAsFP&&parsed.confianca_geral==='alto')parsed.confianca_geral='medio';
  parsed._audit={veredito:rs.length?'com_ressalvas':'aprovada',n:rs.length,dropped};
  return rs.length;
}
async function verifyAnalysis(parsed,rawFacts,apiKey,signal,onUpdate){
  try{
    if(!parsed)return null;
    onUpdate&&onUpdate({status:'Auditando análise…',phase:2});
    const SP=`Você é um AUDITOR de análises de futebol multi-campeonato (foco: ${compLabel(state.activeCompId)}). Recebe (A) FATOS COLETADOS e (B) a ANÁLISE final. NÃO refaça a análise; aponte apenas problemas OBJETIVOS e verificáveis nos dois blocos. `
      +'VALORES DECIDIDOS POR CÓDIGO (shell 110) — NÃO AUDITE: as probabilidades, os mercados de gols, a coerência da dupla chance, a calibração da confiança e a reconciliação desfalque×onze são CALCULADOS E DECIDIDOS POR CÓDIGO (Poisson dos lambdas), não pelo modelo. Qualquer valor ou texto que carregue um carimbo entre colchetes — "[prob. recalculada por Poisson…]", "[prob. reconciliada por código…]", "[confiança rebaixada por código…]" — ou a marca "A confirmar (era … listado como desfalque)" é DECISÃO FINAL do código: NÃO o acuse de inconsistência numérica, confiança mal calibrada nem contradição interna. Você NÃO é a autoridade sobre a aritmética desses valores (caso real do shell 109: o auditor "corrigiu" 0.53→0.58 de cabeça; 0.53 estava certo para λ=2.8). RISCO DE SUSPENSÃO ≠ AUSÊNCIA (shell 111): um jogador "pendurado"/"a um amarelo da suspensão"/"risco de suspensão (3º amarelo)" está DISPONÍVEL para ESTE jogo — o risco vale para o jogo SEGUINTE. Incluí-lo normalmente no onze é CORRETO; NÃO é contradição interna nem exige cenário de ausência nos tickets. Só é ausência a suspensão CUMPRIDA neste jogo (expulso/suspenso já confirmado), que apareceria em desfalques. '
      +'1) INCONSISTÊNCIA NUMÉRICA — aponte APENAS violação de FAIXA, nunca "a conta deu diferente": 1X2 que não soma ~90–110%, ou um número claramente fora dos limites do critério 4. Aritmética de probabilidade (ticket vs lambdas, múltipla vs produto das pernas) é do CÓDIGO — não a recalcule nem a acuse. '
      +'2) FALTA DE LASTRO — afirmação factual central de (B) apresentada como MEDIDA/oficial que NÃO aparece em (A) (possível alucinação). Se (A) estiver vazio, pule este critério. NÃO é falta de lastro um valor rotulado como ESTIMADO (ex.: "xG estimado ~1.6 · de finalizações/grandes chances") derivado de proxies presentes em (A) — estimar é função legítima do analista; só marque se a estimativa NÃO tiver proxy nenhum em (A) ou for vendida como valor oficial. '
      +'3) CONFIANÇA MAL CALIBRADA — "alto"/"alta" apoiada em fonte única ou convivendo com lacunas graves declaradas. '
      +'4) VALOR IMPLAUSÍVEL — xG fora de 0–4, mais de ~45 jogos de liga para um jogador na temporada (sem copas), rating fora de 4–10, probabilidade fora de 1–95%. '
      +'5) CONTRADIÇÃO INTERNA entre seções de (B). '
      +'Seja conservador: só aponte o que é objetivo; NADA de opinião tática. Máximo 4 ressalvas, as mais graves primeiro. '
      +'Responda APENAS JSON: {"veredito":"aprovada|com_ressalvas","rebaixar_confianca":true|false,"ressalvas":[{"gravidade":"alta|media","problema":"","onde":""}]}';
    const body=JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:800,system:SP,
      messages:[{role:'user',content:`(A) FATOS COLETADOS:\n${JSON.stringify(rawFacts||{})}\n\n(B) ANÁLISE FINAL:\n${JSON.stringify(parsed)}`}]});
    const res=await fetch(_h('getApiBase')()+'/v1/messages',{method:'POST',headers:_h('getReqHeaders')(apiKey),body,signal});
    if(!res.ok)return null;
    const data=await res.json();const u=data.usage||{};
    const txt=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    const v=parseAnalysisJson(txt); // robusto: fences + repairJson
    if(v)_applyAudit(parsed,v);
    return{inTokens:u.input_tokens||0,outTokens:u.output_tokens||0};
  }catch(e){if(e&&(e.name==='AbortError'||e.message==='cancelled'))throw e;return null;}
}
// ─── Structured Outputs (output_config.format · json_schema) — FASE 1 ────
// Garante JSON 100% válido direto da API na COLETA. Testado AO VIVO via Worker
// (07/2026): Haiku 4.5 e Sonnet 4.6, com thinking budget_tokens, web_search e
// stream — todos aceitam. NÃO confundir com output_config.effort (que causou
// 400 no passado); aqui é o campo "format", validado. Restrições do recurso:
// additionalProperties:false obrigatório; sem min/max; anuláveis via anyOf.
const _soStr={type:'string'};
const _soStrArr={type:'array',items:{type:'string'}};
const _soNullable=t=>({anyOf:[{type:t},{type:'null'}]});
function _soObj(props){return{type:'object',properties:props,required:Object.keys(props),additionalProperties:false};}
// Fase 1 (coleta): espelho do SCHEMA textual do gatherFacts.
// jogadores_chave agora é uma lista de objetos estruturados (15 stats fundamentais + nome/posição/observação).
const _soN=()=>_soNullable('number');
const _soPlayer=()=>_soObj({nome:_soStr,posicao:_soStr,jogos:_soN(),minutos:_soN(),gols:_soN(),assistencias:_soN(),finalizacoes_por_jogo:_soN(),finalizacoes_no_gol_por_jogo:_soN(),grandes_chances_ou_passes_decisivos_por_jogo:_soN(),cartoes_amarelos:_soN(),cartoes_vermelhos:_soN(),a_um_amarelo_da_suspensao:_soNullable('boolean'),faltas_cometidas_por_jogo:_soN(),faltas_sofridas_por_jogo:_soN(),desarmes_por_jogo:_soN(),cobra_penaltis_ou_faltas:_soStr,rating_medio:_soN(),observacao:_soStr});
// escanteios_por_jogo/sofridos: o template TEXTUAL (_teamTpl) já pedia os
// dois e normalize/facts-memory já os consomem, mas este schema os OMITIA — com
// additionalProperties:false o modelo ficava PROIBIDO de devolvê-los no caminho SO.
// Era a causa raiz da lacuna "estatísticas de escanteios não fornecidas" na auditoria.
const _soTeamP1=()=>_soObj({nome:_soStr,tecnico:_soStr,ranking_fifa:_soStr,resultados_recentes:_soStrArr,xg_marcado:_soNullable('number'),xg_sofrido:_soNullable('number'),escanteios_por_jogo:_soNullable('number'),escanteios_sofridos_por_jogo:_soNullable('number'),desfalques:_soStrArr,escalacao_provavel:_soStr,formacao:_soStr,onze_provavel:{type:'array',items:_soObj({nome:_soStr,posicao:_soStr})},banco:_soStrArr,jogadores_chave:{type:'array',items:_soPlayer()},estilo_ofensivo:_soStr,vulnerabilidades_defensivas:_soStrArr});
const FACTS_SCHEMA=_soObj({mandante:_soTeamP1(),visitante:_soTeamP1(),contexto_fase:_soStr,grupo_classificacao:_soStr,lacunas:_soStrArr});
// ─── Thinking/structured outputs na FASE 2: REMOVIDOS ───
// Histórico (93→97): opt-in de thinking exigia JSON por gramática (F2_SCHEMA), e o
// o acesso de API usado recusou TODAS as variantes com "The compiled grammar is too large"
// — schema ingênuo, compacto, $defs/$ref (96) e agrupado com topo de 5 props (97).
// O recurso foi aposentado por decisão de produto; podar campos nunca foi opção (com
// additionalProperties:false o modelo ficaria PROIBIDO de emitir a seção podada e a
// aba sumiria da UI). NÃO reintroduzir sem a API elevar o limite de gramática.
// (FACTS_SCHEMA da FASE 1 acima é feature independente e continua em uso.)

/* prompts: getSystemPromptPhase2 → js/analysis/prompts.js */

function _chatNeedsLiveData(q,hasAtts){
  if(hasAtts)return true;
  const s=String(q||'');
  return /\b(resultado|placar|ganh|venc|perd|empat|gol|classifica|tabela|como foi|encerr|termin|acab|quanto foi|vencedor|eliminad|avan[cç]|pr[oó]xim|quando joga|agenda|calend|ao vivo|jogou|marcou|sofreu|saldo|l[ií]der|ponto|opini[aã]o|achou|jogo|partida|amistoso|sele[cç][aã]o|acr[eé]scimo|acr[eé]scimos|hoje|ontem|agora|final|ft\b|live)/i.test(s)
    || /\b(argentina|brasil|fran[cç]a|alemanha|inglaterra|espanha|portugal|uruguai|colombia|m[eé]xico|eua|estados unidos)\b/i.test(s);
}
/** Pedido que exige PLACAR verificado (tolerância zero a alucinação). */
function _chatNeedsScoreVerification(q){
  const s=String(q||'');
  return /\b(resultado|placar|ganh|venc|perd|empat|gol|como foi|encerr|termin|acab|quanto foi|vencedor|amistoso|acr[eé]scimo|hoje|ontem|jogo da|jogo do|partida|opini[aã]o.*jogo|jogo.*opini[aã]o)/i.test(s)
    || (/\bjogo\b/i.test(s)&&/\b(argentina|brasil|fran[cç]a|alemanha|inglaterra|espanha|sele[cç])/i.test(s));
}

// ── Identidade do jogo: NUNCA o modelo pode "chutar" qual partida é "o jogo de hoje" ──
const _KNOWN_SIDES=/\b(flamengo|palmeiras|corinthians|s[aã]o\s*paulo|santos|vasco|fluminense|botafogo|gremio|gr[eê]mio|internacional|cruzeiro|atl[eé]tico[\s-]?mg|athletico|bahia|fortaleza|bragantino|mirassol|vit[oó]ria|juventude|sport|cuiab[aá]|argentina|brasil|fran[cç]a|alemanha|inglaterra|espanha|portugal|uruguai|col[oô]mbia|m[eé]xico|holanda|pa[ií]ses\s*baixos|it[aá]lia|eua|estados\s*unidos|marrocos|jap[aã]o|cro[aá]cia|b[eé]lgica|chile|equador|peru|paraguai|real\s*madrid|barcelona|manchester|liverpool|chelsea|arsenal|psg|bayern|juventus|milan|inter\b|napoli|dortmund|ajax)\b/i;

/** Tem âncora explícita de partida (Time A x Time B, ou time + competição/data clara)? */
function hasExplicitMatchAnchor(q){
  const s=String(q||'').trim();
  if(!s)return false;
  // "Flamengo x Botafogo", "Brasil vs Argentina", "Time A × Time B"
  if(/\b[\wÀ-ÿ][\wÀ-ÿ.'-]{1,28}(?:\s+[\wÀ-ÿ.'-]{1,28}){0,3}\s+(?:x|vs\.?|versus|×|contra)\s+[\wÀ-ÿ][\wÀ-ÿ.'-]{1,28}(?:\s+[\wÀ-ÿ.'-]{1,28}){0,3}\b/i.test(s))return true;
  // um time conhecido + (hoje|ontem|placar|resultado|amistoso|copa|liga)
  const sideHits=(s.match(new RegExp(_KNOWN_SIDES.source,'gi'))||[]);
  if(sideHits.length>=2)return true;
  if(sideHits.length===1&&/\b(hoje|ontem|agora|placar|resultado|amistoso|final|semi|copa|libertadores|brasileir|premier|champions|euro|mundial)\b/i.test(s))return true;
  // contexto da conversa já nomeou o jogo
  const ctx=_h('getChatContext')();
  if(ctx&&/\b(?:x|vs\.?|versus|×)\b/i.test(ctx)&&ctx.length>8)return true;
  return false;
}

/**
 * Pergunta ambígua do tipo "opinião sobre o jogo de hoje" — SEM times.
 * Nesses casos o app DEVE abrir popup ANTES de chamar o modelo (zero suposição).
 */
function isVagueMatchQuery(q){
  const s=String(q||'').trim();
  if(!s||s.length>280)return false;
  if(hasExplicitMatchAnchor(s))return false;
  // anexos / contexto longo com âncora já resolvem
  if(_h('getChatContext')()&&hasExplicitMatchAnchor(_h('getChatContext')()))return false;
  const aboutMatch=/\b(jogo|partida|confronto|placar|resultado)\b/i.test(s)
    ||/\b(opini[aã]o|achou|acha|an[aá]lise|analisa|comenta|como\s+foi|que\s+achou)\b/i.test(s);
  const vagueWhen=/\b(hoje|ontem|agora|desse?\s+jogo|do\s+jogo|da\s+partida|o\s+jogo|a\s+partida|esse\s+jogo|essa\s+partida)\b/i.test(s)
    ||/^(qual|quais|e\s+a[ií]|me\s+fala|me\s+d[aá]|sua)\b/i.test(s);
  // "qual sua opinião sobre o jogo de hoje?" → true
  if(aboutMatch&&vagueWhen)return true;
  if(/\b(opini[aã]o|an[aá]lise|analisa|comenta).{0,40}\b(jogo|partida)\b/i.test(s)&&!hasExplicitMatchAnchor(s))return true;
  if(/\b(jogo|partida)\s+(de\s+)?(hoje|ontem)\b/i.test(s)&&!hasExplicitMatchAnchor(s))return true;
  return false;
}

/* ESPN chat helpers → js/data/espn.js */

/**
 * Verificação de placar via Haiku + web_search.
 * Procedimento por IDENTIDADE DO JOGO + STATUS OFICIAL (FT/LIVE), sem presupor placar.
 * Retorna bloco para o chat — o modelo principal não deve inventar placar.
 */
async function fetchVerifiedMatchFacts(query,apiKey,signal,espnHint){
  if(!apiKey&&!_h('getWorkerUrl')())return'';
  const today=_h('currentDateFull')();
  const isoToday=new Date().toISOString().slice(0,10);
  const isoYday=new Date(Date.now()-864e5).toISOString().slice(0,10);
  const hintBlock=(espnHint&&String(espnHint).trim())
    ? `\n\nDADOS ESTRUTURADOS ESPN (pista, não verdade absoluta — confirme se status/placar batem com fontes oficiais):\n${String(espnHint).slice(0,3500)}\n`
    : '';

  const SP=`Você é o VERIFICADOR DE RESULTADOS do Meridian (camada de fatos, não opinião).
Tolerância ZERO a placar inventado. Você NÃO chuta placares; você RESOLVE o jogo e LÊ o resultado em fontes.

REFERÊNCIA TEMPORAL: ${today} | ISO hoje=${isoToday} | ontem=${isoYday}
Interprete "acabou de acontecer", "hoje", "agora", "ontem" com esta âncora.

════════════════════════════════════════
PROCEDIMENTO (nesta ordem — não pule etapas)
════════════════════════════════════════

A) IDENTIFICAR O JOGO (antes de qualquer placar)
   Extraia da pergunta: time(s)/seleção(ões), adversário se houver, competição se houver, âncora temporal.
   Monte a hipótese de jogo: "X vs Y · competição · data provável".
   Se houver vários candidatos, escolha o mais recente compatível com a âncora (hoje/ontem/LIVE).
   NÃO coloque placar na query de busca. Queries com placar (ex.: "Time 2-1") enviesam a coleta e são PROIBIDAS.

B) BUSCAR POR IDENTIDADE + STATUS, NÃO POR NÚMERO
   Faça 2–3 buscas (P1 primeiro). Modelos de query (adapte aos nomes reais):
   • "[Time A] vs [Time B] full time" / "resultado final" / "FT"
   • "[Time] latest match result [hoje|yesterday|ISO date]"
   • "[Time] [competição] scoreboard" ou site oficial da competição
   • Se só um time: "[Time] most recent result" / "último jogo placar"
   Fontes P1: site oficial da competição/federação, Reuters, BBC Sport, ESPN, Sky, Guardian, Sofascore, FotMob.
   Fontes P2 só se P1 não fechar: GE, Marca, etc.

C) CLASSIFICAR O ESTADO DO JOGO (crítico)
   Decida status com evidência explícita da fonte:
   • FT  = Full Time / Final / Encerrado / Resultado final (placar oficial de fim de jogo)
   • LIVE = em andamento (use placar + minuto/relógio da fonte)
   • HT   = intervalo
   • NS   = não iniciado
   • UNKNOWN = fonte ambígua
   Regra: só marque FT se a fonte indicar fim de jogo. Não invente FT a partir de um placar "congelado" sem status.
   O placar de FT é o placar OFICIAL de término — o que a fonte publica como final (não reconstrua minuto a minuto; não use placar parcial de "aos 89'" como se fosse FT).

D) CONFIRMAR (impecável ≠ lento: seja preciso)
   Ideal: 2 fontes independentes com o MESMO placar e status FT (ou mesma LIVE).
   Aceitável com 1 fonte P1 clara + status FT explícito (confidence medium).
   Se divergência (ex. 1-1 vs 2-1): NÃO invente o meio. Liste conflito, prefira fonte oficial/mais recente com status FT, confidence low.
   Se não achar: status UNKNOWN, scores null — NUNCA preencha placar "provável".

E) SAÍDA
   JSON apenas. "notes" = como resolveu (ex.: "FT em ESPN + BBC; mesma marcação"). Sem narrativa tática.

PROIBIDO:
• Inventar placar ou status
• Usar memória de treino como placar
• Buscar já assumindo um placar ("Time 1-0", "Time 2-1…")
• Tratar LIVE como FT
• Preencher score quando status=UNKNOWN

JSON:
{"matches":[{"home":"","away":"","score_home":null,"score_away":null,"status":"FT|LIVE|HT|NS|UNKNOWN","minute":"","competition":"","date":"YYYY-MM-DD","confidence":"high|medium|low","resolved_how":"","sources":["…"],"notes":""}],"summary_pt":"1–2 frases: jogo identificado + placar/status + fontes"}`;

  const msgs=[{role:'user',content:
    `Pergunta do usuário:\n"""${query}"""\n${hintBlock}\n`+
    `Execute o procedimento A→E. Identifique o jogo, busque por identidade+status (sem presupor placar), devolva só o JSON.`}];
  try{
    let acc='';
    for(let i=0;i<5;i++){
      if(signal&&signal.aborted)break;
      const res=await fetch(_h('getApiBase')()+'/v1/messages',{
        method:'POST',
        headers:_h('getReqHeaders')(apiKey),
        body:JSON.stringify({
          model:'claude-haiku-4-5-20251001',
          max_tokens:1400,
          system:SP,
          messages:msgs,
          tools:[{type:'web_search_20250305',name:'web_search',max_uses:3}]
        }),
        signal
      });
      if(!res.ok)break;
      const data=await res.json();
      if(data.stop_reason==='end_turn'){
        acc=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        break;
      }
      if(data.stop_reason==='tool_use'){
        msgs.push({role:'assistant',content:data.content});
        msgs.push({role:'user',content:data.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});
      }else if(data.stop_reason==='pause_turn'){
        msgs.push({role:'assistant',content:data.content});
      }else break;
    }
    if(!acc)return'';
    // (review local): era JSON.parse CRU — violação do invariante 33 justo no
    // caminho alimentado por web_search, que é DE ONDE vêm as tags <cite>. Sem o strip, os
    // nomes de time/competição entravam citados no bloco de PLACARES que vai ao prompt da F2.
    // parseAnalysisJson ainda ganha cerca-de-código e reparo de JSON truncado de brinde.
    const parsed=parseAnalysisJson(acc);
    if(parsed&&Array.isArray(parsed.matches)&&parsed.matches.length){
      const lines=parsed.matches.map(x=>{
        const st=String(x.status||'UNKNOWN').toUpperCase();
        const hasSc=x.score_home!=null&&x.score_away!=null&&st!=='UNKNOWN'&&st!=='NS';
        const score=hasSc?`${x.score_home}-${x.score_away}`:'—';
        const conf=x.confidence||'?';
        const how=x.resolved_how||x.notes||'';
        return `• ${x.home||'?'} ${score} ${x.away||'?'} | status=${st}${x.minute?' · '+x.minute:''} | conf=${conf} | ${x.competition||''} | ${x.date||''} | fontes: ${(x.sources||[]).join(', ')||'—'} | ${how}`;
      });
      return `=== PLACARES VERIFICADOS (coleta por identidade do jogo + status FT/LIVE · autoridade máxima) ===\n${parsed.summary_pt?parsed.summary_pt+'\n':''}${lines.join('\n')}\n=== FIM PLACARES VERIFICADOS ===\nRegra: use status e placar deste bloco. Se status=UNKNOWN ou score=—, não invente número — busque ou declare não confirmado.`;
    }
    return `=== PLACARES VERIFICADOS (texto bruto · não invente além disto) ===\n${acc.slice(0,2000)}\n=== FIM ===`;
  }catch(e){
    if(e&&(e.name==='AbortError'||e.message==='cancelled'))throw e;
    return'';
  }
}

export {
  GROUNDING_RULE,
  SOURCE_RULE,
  ticketRulesFor,
  gatherFacts,
  repairJson,
  parseAnalysisJson,
  stripCites,
  stripCiteDeep,
  buildEnrichedQuery,
  fillDataGaps,
  FACTS_SCHEMA,
  verifyLineupNames,
  verifyAnalysis,
  hasExplicitMatchAnchor,
  isVagueMatchQuery,
  _chatNeedsLiveData,
  _chatNeedsScoreVerification,
  fetchVerifiedMatchFacts
};

expose({
  GROUNDING_RULE,
  SOURCE_RULE,
  ticketRulesFor,
  gatherFacts,
  repairJson,
  parseAnalysisJson,
  buildEnrichedQuery,
  fillDataGaps,
  verifyLineupNames,
  verifyAnalysis,
  hasExplicitMatchAnchor,
  isVagueMatchQuery,
  _chatNeedsLiveData,
  _chatNeedsScoreVerification,
  fetchVerifiedMatchFacts
});
