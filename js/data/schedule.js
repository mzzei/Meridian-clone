/* js/data/schedule.js — cache de agenda multi-liga + contexto de torneio */
function _loadSchedCache(){
  try{const raw=localStorage.getItem(SCHED_STORE);if(!raw)return null;const c=JSON.parse(raw);return(c&&Array.isArray(c.jogos))?c:null;}catch{return null;}
}
function _saveSchedCache(jogos){
  try{localStorage.setItem(SCHED_STORE,JSON.stringify({fetched_at:Date.now(),jogos}));}catch(e){}
}
// Jogos confirmados que as fontes dinâmicas (ESPN/IA) às vezes omitem — garantidos no calendário
const KNOWN_FIXTURES=[]; // fixtures extras opcionais (vazio = só APIs)
function _tagComp(jogos,compId){
  return(Array.isArray(jogos)?jogos:[]).map(j=>({...j,comp_id:j.comp_id||compId,fase:j.fase||compLabel(compId)}));
}
function _saveCompSched(compId,jogos){
  _schedByComp[compId]=_tagComp(jogos,compId);
  try{
    const raw=JSON.parse(localStorage.getItem(COMP_SCHED_STORE)||'{}');
    raw[compId]={fetched_at:Date.now(),jogos:_schedByComp[compId]};
    localStorage.setItem(COMP_SCHED_STORE,JSON.stringify(raw));
  }catch{}
}
function _loadAllCompSchedCache(){
  try{
    const raw=JSON.parse(localStorage.getItem(COMP_SCHED_STORE)||'{}');
    Object.keys(raw||{}).forEach(id=>{
      if(COMPETITIONS[id]&&Array.isArray(raw[id]?.jogos))_schedByComp[id]=raw[id].jogos;
    });
  }catch{}
}
function _rebuildUnionSchedule(){
  // União de TODOS os campeonatos (sem priorizar liga ativa) — chips usam os + próximos no tempo
  const all=[];
  COMP_ORDER.forEach(id=>{
    (_schedByComp[id]||[]).forEach(j=>all.push({...j,comp_id:j.comp_id||id}));
  });
  // ordena por kickoff real (data + hora BRT), não só data civil / ordem de liga
  all.sort((a,b)=>{
    const da=_kickMs(a),db=_kickMs(b);
    if(da!==db)return da-db;
    return (a.data_iso||'').localeCompare(b.data_iso||'')||(a.hora_brt||'').localeCompare(b.hora_brt||'');
  });
  _schedule=all;
  try{localStorage.setItem(SCHED_STORE,JSON.stringify({fetched_at:Date.now(),jogos:all}));}catch{}
  return all;
}
/** Âncora de jogo REAL para a análise padrão (gate de contexto).
 * Procura o confronto na agenda-união (todas as ligas) e no scoreboard ESPN da
 * competição. Retorna {src,line,comp_id} ou null (→ popup de contexto antes do LLM). */
async function findScheduledMatchForAnalysis(teams,compId){
  if(!Array.isArray(teams)||teams.length<2)return null;
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const t0=norm(teams[0]),t1=norm(teams[1]);
  const hit=(x,y)=>x&&y&&(x.includes(y)||y.includes(x));
  const pair=(a,b)=>{a=norm(a);b=norm(b);return (hit(a,t0)&&hit(b,t1))||(hit(a,t1)&&hit(b,t0));};
  try{
    const j=(_schedule||[]).find(x=>x&&pair(x.mandante,x.visitante));
    if(j){
      const _lbl=compLabel(j.comp_id||compId);
      const _fase=j.fase&&j.fase!==_lbl?' · '+j.fase:''; // fase==liga → não duplicar
      return{src:'agenda',comp_id:j.comp_id||compId,
        line:`${j.mandante} x ${j.visitante} · ${_lbl}${_fase} · ${j.data_iso||''}${j.hora_brt?' '+j.hora_brt:''}`.trim()};
    }
  }catch{}
  try{
    const sb=await getEspnScoreboard(compId);
    const ev=(sb&&sb.events||[]).find(e=>{
      const c=e&&e.competitions&&e.competitions[0];const cs=(c&&c.competitors)||[];
      if(cs.length<2)return false;
      const n=i=>cs[i]&&cs[i].team&&(cs[i].team.displayName||cs[i].team.shortDisplayName||cs[i].team.name);
      return pair(n(0),n(1));
    });
    if(ev)return{src:'espn',comp_id:compId,
      line:`${ev.name||ev.shortName||(teams[0]+' x '+teams[1])} · ${compLabel(compId)} · ${(ev.date||'').slice(0,10)}`};
  }catch{}
  return null;
}
function _compLogo(id){
  const c=getComp(id);
  return c.logo?`<img class="lib-comp-logo" src="${c.logo}" alt="${esc(c.name)}" loading="lazy" onerror="this.style.visibility='hidden'">`:'<span style="font-size:28px">🏆</span>';
}

function _mergeKnownFixtures(jogos){
  jogos=Array.isArray(jogos)?jogos.slice():[];
  const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  const key=j=>[norm(j.mandante),norm(j.visitante)].sort().join('|')+'@'+(j.data_iso||'');
  const seen=new Set(jogos.map(key));
  KNOWN_FIXTURES.forEach(f=>{if(!seen.has(key(f))){jogos.push({...f});seen.add(key(f));}});
  return jogos;
}
function loadSchedule(force){
  // Multi-campeonato: carrega TODAS as ligas em paralelo via ESPN (grátis).
  // AF/FD (se chave) enriquecem o campeonato ativo.
  _loadAllCompSchedCache();
  if(!force&&Object.keys(_schedByComp).length){
    _rebuildUnionSchedule();
    renderScheduleChips(_schedule);
    if(_currentView==='library')renderLibrary();
    scheduleFeaturedPaint();
  }
  loadAllCompetitions(!!force);
  if(getAfKey()){
    // (review local): as chaves antigas eram MORTAS (nada mais grava nelas) —
    // o cache real de fixtures AF é 'meridian_af_fx_'+comp (football-apis.js getAfFixtures),
    // então o refresh forçado não refrescava nada: agenda velha sobrevivia por todo o TTL.
    if(force){try{localStorage.removeItem('meridian_af_fx_'+_activeCompId);}catch{}}
    loadAfData();
  }else if(getFdKey()){
    loadFdData();
  }
}
async function loadAllCompetitions(force){
  const espnEl=document.getElementById('espn-status');
  if(espnEl){espnEl.textContent='verificando…';espnEl.className='ds-status';}
  COMP_ORDER.forEach(id=>_setCompStatus(id,{loading:true}));
  // Verifica automaticamente a disponibilidade de jogos de TODOS os campeonatos
  const results=await Promise.all(COMP_ORDER.map(id=>loadEspnComp(id,force).catch(e=>{
    _setCompStatus(id,{loading:false,checked:true,error:String(e&&e.message||'falha'),soon:false});
    return{id,ok:false,err:e};
  })));
  const okN=results.filter(r=>r&&r.ok).length;
  const soonN=results.filter(r=>r&&r.soon).length;
  if(espnEl){
    espnEl.textContent=okN?`ativo · ${okN}/${COMP_ORDER.length}${soonN?` · ${soonN} em breve`:''}`:(soonN===COMP_ORDER.length?'em breve':(_espnLastError||'indisponível'));
    espnEl.className='ds-status '+(okN||soonN?'ok':'err');
  }
  _rebuildUnionSchedule();
  renderScheduleChips(_schedule);
  if(_currentView==='library')renderLibrary();
  scheduleFeaturedPaint();
}
function _countUpcoming(jogos){
  const today=new Date();today.setHours(0,0,0,0);
  return(Array.isArray(jogos)?jogos:[]).filter(j=>{
    if(!j)return false;
    const st=(typeof _matchState==='function')?_matchState(j).state:null;
    if(st==='live'||st==='upcoming')return true;
    if(!j.data_iso)return true;
    return new Date(j.data_iso+'T12:00:00')>=today;
  }).length;
}
function _setCompStatus(compId,patch){
  _compStatus[compId]=Object.assign({loading:false,checked:false,upcoming:0,total:0,soon:false,error:''},_compStatus[compId]||{},patch);
}
async function loadEspnComp(compId,force){
  const c=getComp(compId);
  if(!c||!c.espn){_setCompStatus(compId,{checked:true,soon:true,error:'sem fonte'});return{id:compId,ok:false};}
  _setCompStatus(compId,{loading:true,error:''});
  // cache fresco?
  if(!force){
    try{
      const raw=JSON.parse(localStorage.getItem(COMP_SCHED_STORE)||'{}');
      const ent=raw[compId];
      if(ent&&Array.isArray(ent.jogos)&&ent.fetched_at&&Date.now()-ent.fetched_at<ESPN_TTL){
        _schedByComp[compId]=ent.jogos;
        const up=_countUpcoming(ent.jogos);
        // soon só se já verificamos e não há NENHUM jogo no cache
        _setCompStatus(compId,{loading:false,checked:true,upcoming:up,total:ent.jogos.length,soon:!ent.jogos.length});
        return{id:compId,ok:!!ent.jogos.length,cached:true};
      }
    }catch{}
  }
  // Janela ampla: 30 dias atrás + 60 à frente — detecta temporada inativa vs sem jogos próximos
  const from=new Date(Date.now()-30*864e5);const to=new Date(Date.now()+60*864e5);
  const ymd=d=>d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
  const url=`${espnBase(compId)}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=100`;
  const cacheKey=`meridian_espn_${compId}_${ymd(from)}_${ymd(to)}`;
  let sb=null;
  try{sb=await fetchEspn(url,cacheKey,ESPN_TTL);}catch(e){_setCompStatus(compId,{loading:false,checked:true,error:String(e&&e.message||'falha'),soon:false});return{id:compId,ok:false,err:e};}
  // sb null = falha de rede (não é "em breve")
  if(sb==null){
    _setCompStatus(compId,{loading:false,checked:true,error:_espnLastError||'indisponível',soon:false});
    return{id:compId,ok:false};
  }
  const events=(sb&&sb.events)||[];
  const jogos=espnScoreboardToSchedule(sb,compId);
  if(jogos.length)_saveCompSched(compId,jogos);
  else{_schedByComp[compId]=[];try{
    const raw=JSON.parse(localStorage.getItem(COMP_SCHED_STORE)||'{}');
    raw[compId]={fetched_at:Date.now(),jogos:[]};
    localStorage.setItem(COMP_SCHED_STORE,JSON.stringify(raw));
  }catch{}}
  const up=_countUpcoming(jogos);
  // Sem eventos na janela ampla → competição ainda não começou / hiato → "Em breve"
  const soon=!events.length;
  const roundLabel=_inferCompRound(compId);
  _setCompStatus(compId,{loading:false,checked:true,upcoming:up,total:jogos.length,soon,error:'',roundLabel:roundLabel||''});
  // Prewarm classificação da liga (featured stats por compId)
  _loadCompStandings(compId,false).catch(()=>{});
  return{id:compId,ok:!!jogos.length,soon,upcoming:up};
}
async function fetchScheduleFromApi(silent){
  const apiKey=document.getElementById('api-key-input').value.trim();
  if(!getWorkerUrl()&&!apiKey.startsWith('sk-'))return;
  const chips=document.getElementById('ex-chips');
  const _clFallback=compLabel(_activeCompId);
  if(!silent){chips.innerHTML='<span class="ex-loading"><span class="ldot"></span> Buscando agenda de '+esc(_clFallback)+'…</span>';document.getElementById('reload-btn').style.display='none';}
  const today=new Date().toISOString().slice(0,10);
  const in14=new Date(Date.now()+14*864e5).toISOString().slice(0,10);
  // Fallback Haiku se ESPN falhar — usa a liga de ANÁLISE ativa (CompContext), não hardcode Série A
  const SP=`${_clFallback} football schedule. Respond ONLY with valid JSON (no markdown, no extra text): {"jogos":[{"mandante":"nome pt-BR","visitante":"nome pt-BR","fase":"Rodada N ou ${_clFallback}","grupo":null,"data_iso":"YYYY-MM-DD","hora_brt":"HH:MM","sede":"cidade · estádio"}]}. Inclua TODOS os jogos confirmados de ${today} até ${in14}.`;
  const msgs=[{role:'user',content:`Calendário de ${_clFallback} de ${today} a ${in14}. Todos os jogos com times em português, fase/rodada (se disponível), data YYYY-MM-DD e horário BRT. Apenas esta competição.`}];
  try{
    for(let i=0;i<6;i++){
      const res=await fetch(getApiBase()+'/v1/messages',{method:'POST',headers:getReqHeaders(apiKey),body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:2500,system:SP,messages:msgs,tools:[{type:'web_search_20250305',name:'web_search'}]})});
      parseRateLimitHeaders(res);const data=await res.json();if(!res.ok)throw new Error(data.error?.message);
      if(data.stop_reason==='end_turn'){
        const txt=data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
        const m=txt.match(/\{[\s\S]*\}/);
        if(m){let jogos;try{jogos=JSON.parse(m[0]).jogos||[];}catch{jogos=[];}
          jogos=jogos.filter(j=>j.mandante&&j.visitante&&j.data_iso);
          if(jogos.length){_saveSchedCache(jogos);_schedule=jogos;renderScheduleChips(_schedule);if(_currentView==='library')renderLibrary();return;}}
        break;
      }
      if(data.stop_reason==='tool_use'){msgs.push({role:'assistant',content:data.content});msgs.push({role:'user',content:data.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});}else break;
    }
    if(!silent)renderScheduleChips([]);
  }catch(e){if(!silent)chips.innerHTML=`<button class="chip chip-cta" onclick="fetchScheduleFromApi(false)">↻ tentar novamente</button>`;}
}
/** Kickoff ms — delega a _matchKick (fonte única de tempo) */
function _kickMs(j){
  if(typeof _matchKick!=='function'){
    if(!j||!j.data_iso)return Infinity;
    const t=(j.hora_brt&&/^\d{1,2}:\d{2}/.test(j.hora_brt))?j.hora_brt:'12:00';
    const d=new Date(j.data_iso+'T'+t+':00-03:00');
    return isNaN(d.getTime())?Infinity:d.getTime();
  }
  const k=_matchKick(j);
  return k?k.getTime():Infinity;
}
function _chipTimeMeta(j,s){
  if(s&&s.state==='live')return'AO VIVO';
  const day=dateLabelFromISO(j.data_iso);
  const hr=j.hora_brt||'';
  if(day==='hoje'||day==='amanhã')return[day,hr].filter(Boolean).join(' · ');
  return[day&&day!=='outros'?day:(j.data_iso||''),hr].filter(Boolean).join(' · ');
}
/** Ranker canônico: live+upcoming por kickoff. compId null/undefined = todas as ligas. */
function nearestMatches(list,n,compId){
  n=n==null?5:n;
  const rows=[];
  (list||[]).forEach((j,idx)=>{
    if(!j||!j.data_iso)return;
    if(compId!=null&&compId!==''&&(j.comp_id||compId)!==compId)return;
    const s=(typeof _matchState==='function')?_matchState(j):null;
    if(!s||(s.state!=='live'&&s.state!=='upcoming'))return;
    rows.push({j,s,idx,t:s.k?s.k.getTime():_kickMs(j),pri:s.state==='live'?0:1});
  });
  rows.sort((a,b)=>(a.pri-b.pri)||(a.t-b.t));
  return rows.slice(0,n);
}
function renderScheduleChips(jogos){
  jogos=_mergeKnownFixtures(Array.isArray(jogos)?jogos:[]);
  jogos=jogos.slice().sort((a,b)=>{
    const da=_kickMs(a),db=_kickMs(b);
    if(da!==db)return da-db;
    return (a.mandante||'').localeCompare(b.mandante||'');
  });
  _schedule=jogos;
  const chips=document.getElementById('ex-chips');
  if(!chips)return;
  if(!jogos.length){
    chips.innerHTML='<span class="ex-loading">Nenhuma partida encontrada</span>';
    const rb=document.getElementById('reload-btn');if(rb)rb.style.display='inline';
    return;
  }
  const nearest=nearestMatches(jogos,5,null);
  if(!nearest.length){
    chips.innerHTML='<span class="ex-auto-hint">'+t('sched_no_games')+' · <button class="chip chip-cta" onclick="showView(\'library\')">'+t('sched_calendar')+'</button></span>';
    const lbl=document.getElementById('sched-lbl');if(lbl)lbl.textContent=t('sched_lbl');
    const rb=document.getElementById('reload-btn');if(rb)rb.style.display='inline';
    return;
  }
  let html='';
  nearest.forEach(function(row){
    const j=row.j,s=row.s,idx=row.idx;
    const live=s.state==='live';
    const meta=_chipTimeMeta(j,s);
    const title=((j.comp_id?compLabel(j.comp_id)+' · ':'')+(j.mandante||'')+' × '+(j.visitante||''));
    html+='<button type="button" class="chip chip-match'+(live?' chip-live':'')+'" onclick="fillMatch('+idx+')" title="'+esc(title)+'">'
      +'<span class="chip-teams">'+esc(j.mandante||'?')+' × '+esc(j.visitante||'?')+'</span>'
      +'<span class="chip-meta'+(live?' chip-meta-live':'')+'">'+esc(meta)+'</span>'
      +'</button>';
  });
  if(jogos.length>nearest.length){
    html+='<button type="button" class="chip chip-cta" onclick="showView(\'library\')" style="margin-top:4px">'
      +(typeof t('game_all')==='function'?t('game_all')(jogos.length):t('game_all'))
      +'</button>';
  }
  chips.innerHTML=html;
  const rb=document.getElementById('reload-btn');if(rb)rb.style.display='inline';
  const lbl=document.getElementById('sched-lbl');
  if(lbl)lbl.textContent=typeof t('game_upcoming')==='function'?t('game_upcoming')(nearest.length):t('game_upcoming');
  scheduleFeaturedPaint();
}

// ─── Tournament context cache ─────────────────────────────────────────────
function _loadCtxCache(){
  try{const raw=localStorage.getItem(CTX_STORE);if(!raw)return null;const c=JSON.parse(raw);return(c&&c.data)?c:null;}catch{return null;}
}
function _saveCtxCache(data){
  try{localStorage.setItem(CTX_STORE,JSON.stringify({fetched_at:Date.now(),data}));}catch(e){}
}
function getTournamentCtxString(){
  const c=_loadCtxCache();if(!c)return'';
  try{
    const d=c.data;const lines=[];
    if(d.fase_atual)lines.push(`FASE ATUAL: ${d.fase_atual}`);
    if(d.standings&&Object.keys(d.standings).length){
      lines.push('CLASSIFICAÇÃO DOS GRUPOS:');
      Object.entries(d.standings).forEach(([g,rows])=>{lines.push(`  ${g}: ${rows.map(r=>`${r.time}(${r.pts}pts)`).join(' | ')}`);});
    }
    if(d.results&&d.results.length){
      lines.push('RESULTADOS RECENTES:');
      d.results.slice(0,12).forEach(r=>lines.push(`  ${r.data||''} ${r.mandante} ${r.placar||'?-?'} ${r.visitante}`));
    }
    return lines.join('\n');
  }catch{return'';}
}
function loadTournamentCtx(force){
  if(getAfKey()||getFdKey())return; // loadAfData/loadFdData já atualiza CTX_STORE — evita race condition
  if(!force)return; // modo economia: não gasta créditos no automático (force = ação explícita)
  const cache=_loadCtxCache();
  if(cache&&!force){const age=Date.now()-(cache.fetched_at||0);if(age<CTX_TTL)return;}
  fetchTournamentCtxFromApi();
}
async function fetchTournamentCtxFromApi(){
  const apiKey=document.getElementById('api-key-input').value.trim();
  if(!getWorkerUrl()&&!apiKey.startsWith('sk-'))return;
  const today=new Date().toISOString().slice(0,10);
  const _cl=compLabel(_activeCompId);
  const SP=`${_cl} — agente de contexto. Data: ${today}. Pesquise e retorne APENAS JSON válido (sem markdown): {"fase_atual":"string (ex.: Rodada 15 / Fase de grupos)","standings":{"Tabela":[{"time":"","pts":0,"j":0,"v":0,"e":0,"d":0,"gp":0,"gc":0}]},"results":[{"data":"DD/MM","mandante":"","placar":"N-N","visitante":""}]}. Inclua a classificação de ${_cl} e os últimos 12 resultados.`;
  const msgs=[{role:'user',content:`Tabela de classificação e resultados recentes de ${_cl} até ${today}.`}];
  try{
    for(let i=0;i<4;i++){
      const res=await fetch(getApiBase()+'/v1/messages',{method:'POST',headers:getReqHeaders(apiKey),body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:3000,system:SP,messages:msgs,tools:[{type:'web_search_20250305',name:'web_search'}]})});
      parseRateLimitHeaders(res);const data=await res.json();if(!res.ok)return;
      if(data.stop_reason==='end_turn'){
        const txt=data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
        const m=txt.match(/\{[\s\S]*\}/);
        if(m){let d;try{d=JSON.parse(m[0]);}catch{return;}if(d&&(d.results||d.standings)){_saveCtxCache(d);return;}}
        return;
      }
      if(data.stop_reason==='tool_use'){msgs.push({role:'assistant',content:data.content});msgs.push({role:'user',content:data.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:''}))});}else return;
    }
  }catch{}
}
