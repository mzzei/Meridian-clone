/* js/data/football-apis.js — football-data.org + API-Football */
// ─── football-data.org integration ───────────────────────────────────────
let _fdRateLeft=Infinity,_fdRateReset=0; // throttle state (X-RequestsAvailable / X-RequestCounter-Reset)
let _fdLastError='';
function getFdKey(){try{return localStorage.getItem(FD_KEY_STORE)||'';}catch{return'';}}
// ── Modo secret-no-Worker: chave FORA do browser. Com Worker URL configurada, o app
// tenta FD/AF mesmo sem chave local (o Worker injeta a secret). O flag *_remote_ok
// lembra se a última tentativa remota funcionou — evita gastar chamadas de análise
// quando o Worker existe mas a secret não (ex.: worker só de Anthropic). ──
function _remoteOkGet(k){try{return localStorage.getItem(k)==='1';}catch{return false;}}
function _remoteOkSet(k,v){try{if(v)localStorage.setItem(k,'1');else localStorage.removeItem(k);}catch{}}
function fdReady(){return !!getFdKey()||(!!(typeof getWorkerUrl==='function'&&getWorkerUrl())&&_remoteOkGet('meridian_fd_remote_ok'));}
function afReady(){return !!getAfKey()||(!!(typeof getWorkerUrl==='function'&&getWorkerUrl())&&_remoteOkGet('meridian_af_remote_ok'));}
function _parseFdHeaders(res){
  const left=parseInt(res.headers.get('X-RequestsAvailable')||'',10);
  const reset=parseInt(res.headers.get('X-RequestCounter-Reset')||'',10);
  if(!isNaN(left))_fdRateLeft=left;
  if(!isNaN(reset))_fdRateReset=Date.now()+reset*1000;
}
// file:// origin sends Origin:null — most APIs block it. Route via CORS proxy when needed.
const _fdNeedProxy=location.protocol==='file:'||location.origin==='null';
function _fdUrl(path,key){
  const sep=path.includes('?')?'&':'?';
  // 1º: Worker próprio ({worker}/fd/*). Probe 07/2026: as respostas GET da FD NÃO
  // trazem Access-Control-Allow-Origin em NENHUMA origem — browser direto sempre
  // falha ("Failed to fetch"); o Worker é o caminho real, como na AF.
  const w=typeof getWorkerUrl==='function'?getWorkerUrl():'';
  if(w)return `${w.replace(/\/+$/,'')}/fd${path}${sep}token=${encodeURIComponent(key||'')}`;
  const direct=`${FD_BASE}${path}${sep}token=${key}`;
  return _fdNeedProxy?`https://corsproxy.io/?url=${encodeURIComponent(direct)}`:direct;
}
async function fetchFd(path,cacheKey,ttl=FD_TTL){
  try{const c=JSON.parse(localStorage.getItem(cacheKey)||'null');if(c&&(Date.now()-c.ts)<ttl)return c.data;}catch{}
  const key=getFdKey();
  // sem chave local: só prossegue se houver Worker (que pode ter a secret FD_KEY)
  if(!key&&!(typeof getWorkerUrl==='function'&&getWorkerUrl()))return null;
  if(_fdRateLeft<=0&&_fdRateReset>Date.now()){
    const ms=_fdRateReset-Date.now()+300;
    updateFdStatus('','aguardando rate limit…');
    await new Promise(r=>setTimeout(r,ms));
  }
  try{
    const res=await fetch(_fdUrl(path,key));
    _parseFdHeaders(res);
    if(res.status===429){
      const wait=(_fdRateReset>Date.now()?_fdRateReset-Date.now():60000)+300;
      updateFdStatus('err',`rate limit · retry em ${Math.ceil(wait/1000)}s`);
      await new Promise(r=>setTimeout(r,wait));
      const r2=await fetch(_fdUrl(path,key));
      _parseFdHeaders(r2);
      if(!r2.ok){_fdLastError=`Erro ${r2.status}`;return null;}
      const d2=await r2.json();
      try{localStorage.setItem(cacheKey,JSON.stringify({ts:Date.now(),data:d2}));}catch{}
      return d2;
    }
    if(!res.ok){_fdLastError=`Erro ${res.status}`;return null;}
    const data=await res.json();
    try{localStorage.setItem(cacheKey,JSON.stringify({ts:Date.now(),data}));}catch{}
    return data;
  }catch(e){_fdLastError=`rede: ${e?.message||'timeout'}`;return null;}
}
async function getFdStandings(){
  const id=_activeCompId, code=fdCode(id)||'BSA', yr=afSeason(id);
  return fetchFd(`/competitions/${code}/standings?season=${yr}`,'meridian_fd_st_'+id+'_'+yr);
}
async function getFdMatches(){
  // /v4/matches with competition filter + date window — more efficient than full-season endpoint
  const id=_activeCompId, code=fdCode(id)||'BSA';
  const from=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
  const to=new Date(Date.now()+21*864e5).toISOString().slice(0,10);
  return fetchFd(`/matches?competitions=${code}&dateFrom=${from}&dateTo=${to}`,'meridian_fd_fx_'+id,15*60*1000);
}
function formatFdContext(standings,matches){
  const lines=[];
  if(standings?.standings?.length){
    const grpMap={GROUP_A:'A',GROUP_B:'B',GROUP_C:'C',GROUP_D:'D',GROUP_E:'E',GROUP_F:'F',GROUP_G:'G',GROUP_H:'H',GROUP_I:'I',GROUP_J:'J',GROUP_K:'K',GROUP_L:'L'};
    const groups=standings.standings.filter(s=>s.type==='TOTAL'&&s.group);
    if(groups.length){
      lines.push('CLASSIFICAÇÃO DOS GRUPOS:');
      groups.forEach(s=>{
        const g=grpMap[s.group]||s.group;
        lines.push(`  Grupo ${g}: ${s.table.map(r=>`${r.team.shortName||r.team.name}(${r.points}pts/${r.playedGames}j ${r.goalsFor}-${r.goalsAgainst})`).join(' · ')}`);
      });
    }
  }
  if(matches?.matches?.length){
    const finished=matches.matches.filter(m=>m.status==='FINISHED').slice(-15);
    if(finished.length){
      lines.push('RESULTADOS RECENTES:');
      finished.forEach(m=>{
        const d=new Date(m.utcDate);
        const dt=`${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`;
        const s=m.score?.fullTime;
        lines.push(`  ${dt} ${m.homeTeam.name} ${s!=null?s.home+'-'+s.away:'?-?'} ${m.awayTeam.name}`);
      });
    }
    const live=matches.matches.find(m=>['IN_PLAY','PAUSED','HALFTIME'].includes(m.status));
    const phases=[...new Set(matches.matches.filter(m=>m.status!=='FINISHED').map(m=>m.stage))];
    if(live)lines.unshift(`FASE ATUAL: ${live.stage}`);
    else if(phases.length)lines.unshift(`PRÓXIMA FASE: ${phases[0]}`);
  }
  return lines.join('\n');
}
function fdMatchesToSchedule(matches,compId){
  const _cl=compLabel(compId||_activeCompId);
  const phaseMap={REGULAR_SEASON:_cl,GROUP_STAGE:'Fase de Grupos',FINAL:'Final',LAST_16:'Oitavas',QUARTER_FINALS:'Quartas',SEMI_FINALS:'Semifinal',PLAYOFFS:'Playoffs'};
  return(matches.matches||[]).map(m=>{
    const d=new Date(m.utcDate);
    const brt=new Date(d.getTime()-3*3600000);
    const grpLetter=m.group?m.group.replace('GROUP_',''):null;
    return{mandante:m.homeTeam?.name||'',visitante:m.awayTeam?.name||'',fase:phaseMap[m.stage]||m.stage||_cl,grupo:grpLetter?`Grupo ${grpLetter}`:null,data_iso:brt.toISOString().slice(0,10),hora_brt:`${String(brt.getUTCHours()).padStart(2,'0')}:${String(brt.getUTCMinutes()).padStart(2,'0')}`,sede:m.venue||'',comp_id:compId||_activeCompId};
  }).filter(j=>j.mandante&&j.visitante);
}
function updateFdStatus(state,msg){
  const el=document.getElementById('fd-status');if(!el)return;
  el.className='ds-status'+(state==='ok'?' ok':state==='err'?' err':'');
  el.textContent=msg||'';
}
async function loadFdData(){
  const key=getFdKey();
  const hasWorker=typeof getWorkerUrl==='function'&&!!getWorkerUrl();
  if(!key&&!hasWorker){updateFdStatus('','não configurado');return;}
  updateFdStatus('',key?'verificando…':'verificando via Worker (secret)…');
  const[standings,matches]=await Promise.all([getFdStandings(),getFdMatches()]);
  if(!standings&&!matches){
    _remoteOkSet('meridian_fd_remote_ok',false);
    // FD bloqueia CORS no browser (probe 07/2026) — sem Worker, "rede:" é esperado.
    const corsHint=!hasWorker&&/^rede:/.test(_fdLastError||'')?' · CORS da FD bloqueia o navegador — configure Worker URL':'';
    const secretHint=!key&&hasWorker?' · sem chave no app e secret FD_KEY ausente/ inválida no Worker':'';
    const msg=_fdLastError==='Erro 403'?(compLabel(_activeCompId)+' indisponível neste plano FD (403)'):(_fdLastError||'sem resposta')+corsHint+secretHint;
    updateFdStatus('err',msg);return;
  }
  _remoteOkSet('meridian_fd_remote_ok',true);
  // Update tournament context from FD (authoritative source)
  if(standings||matches){
    const ctx={fase_atual:'',standings:{},results:[]};
    if(standings?.standings){
      standings.standings.filter(s=>s.type==='TOTAL'&&s.group).forEach(s=>{
        const g=s.group.replace('GROUP_','Grupo ');
        ctx.standings[g]=s.table.map(r=>({time:r.team.shortName||r.team.name,pts:r.points,j:r.playedGames,v:r.won,e:r.draw,d:r.lost,gp:r.goalsFor,gc:r.goalsAgainst}));
      });
    }
    if(matches?.matches){
      ctx.results=matches.matches.filter(m=>m.status==='FINISHED').slice(-120).map(m=>{
        const d=new Date(m.utcDate);const s=m.score?.fullTime;
        return{data:`${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`,mandante:m.homeTeam.name,placar:s!=null?`${s.home}-${s.away}`:'?-?',visitante:m.awayTeam.name};
      });
      const live=matches.matches.find(m=>['IN_PLAY','PAUSED','HALFTIME'].includes(m.status));
      const nextSched=matches.matches.find(m=>m.status==='SCHEDULED');
      const active=live||nextSched;
      if(active)ctx.fase_atual=active.stage;
    }
    _saveCtxCache(ctx);
    try{_setCompStandings(_activeCompId,{groups:ctx.standings||{},faseAtual:ctx.fase_atual||''});}catch{}
  }
  // Optionally refresh schedule from FD
  if(matches){
    const jogos=fdMatchesToSchedule(matches,_activeCompId);
    if(jogos.length){_saveSchedCache(jogos);_schedule=jogos;renderScheduleChips(_schedule);if(_currentView==='library')renderLibrary();}
  }
  updateFdStatus('ok',`${standings?'classificação':''}${standings&&matches?' · ':''}${matches?`${(matches.matches||[]).length} jogos`:''}`);
}

// ─── API-Football (v3.football.api-sports.io) ────────────────────────────
let _afLastError='';
function getAfKey(){try{return localStorage.getItem(AF_KEY_STORE)||'';}catch{return'';}}
function updateAfStatus(state,msg){const el=document.getElementById('af-status');if(!el)return;el.className='ds-status'+(state==='ok'?' ok':state==='err'?' err':'');el.textContent=msg||'';}
function _afUrl(path,key){
  const sep=path.includes('?')?'&':'?';
  // 1º: Worker próprio do usuário (resolve CORS de verdade + pode injetar a chave server-side).
  //     Rota {worker}/af/<path>. Enviamos a chave na query como fallback — o Worker prioriza
  //     a AF_KEY do ambiente dele se existir. É o caminho recomendado (a AF direta é bloqueada
  //     por CORS no navegador). Ver worker/README.md.
  const w=getWorkerUrl();
  if(w)return `${w.replace(/\/+$/,'')}/af${path}${sep}x-apisports-key=${encodeURIComponent(key||'')}`;
  // 2º: sem Worker — chave na URL (evita preflight); corsproxy só como último recurso em file://.
  const direct=`${AF_BASE}${path}${sep}x-apisports-key=${encodeURIComponent(key)}`;
  return _fdNeedProxy?`https://corsproxy.io/?url=${encodeURIComponent(direct)}`:direct;
}
// Serializa TODAS as chamadas de rede à AF com um espaçamento mínimo entre elas. O plano
// Free tem um limite baixo de requisições POR MINUTO, e o app dispara várias chamadas em
// paralelo (standings+fixtures, depois técnico×2+escalação) — sem isso, um único carregamento
// já estourava o limite ("Too many requests"). Cada chamada real espera sua vez na fila.
let _afQueue=Promise.resolve();
const AF_MIN_GAP_MS=1100; // ritmo conservador para o limite por minuto do plano Free
function _afThrottled(fn){
  const run=()=>new Promise(res=>setTimeout(()=>res(fn()),AF_MIN_GAP_MS));
  const next=_afQueue.then(run,run);
  _afQueue=next.catch(()=>{});
  return next;
}
// ── Flag por liga: plano Free bloqueou a temporada atual ──
// Evita re-gastar cota em standings/fixtures inúteis na MESMA sessão. `var` de propósito
// (ponte classic↔ESM, inv. 31). sessionStorage: sobrevive a reload, morre com a aba.
var _afSeasonBlockedMem={};
function afSeasonBlocked(compId){
  const id=compId||(typeof _activeCompId!=='undefined'?_activeCompId:'brsa');
  if(_afSeasonBlockedMem[id])return true;
  try{return sessionStorage.getItem('meridian_af_season_blocked_'+id)==='1';}catch{return false;}
}
function _afMarkSeasonBlocked(compId){
  const id=compId||(typeof _activeCompId!=='undefined'?_activeCompId:'brsa');
  _afSeasonBlockedMem[id]=true;
  try{sessionStorage.setItem('meridian_af_season_blocked_'+id,'1');}catch{}
}
async function fetchAf(path,cacheKey,ttl=AF_TTL){
  try{const c=JSON.parse(localStorage.getItem(cacheKey)||'null');if(c&&(Date.now()-c.ts)<ttl)return c.data;}catch{}
  const key=getAfKey();
  // sem chave local: só prossegue se houver Worker (que pode ter a secret AF_KEY)
  if(!key&&!(typeof getWorkerUrl==='function'&&getWorkerUrl()))return null;
  try{
    const res=await _afThrottled(()=>fetch(_afUrl(path,key))); // no custom headers — simple GET, no preflight
    if(!res.ok){_afLastError=`Erro ${res.status}`;return null;}
    const data=await res.json();
    if(data.errors&&Object.keys(data.errors).length){
      _afLastError=String(Object.values(data.errors)[0]);
      // Free sem temporada atual → marca a liga como bloqueada nesta sessão (inv. 11:
      // a chave AUTENTICOU; é limitação de plano, não secret inválida).
      if(/free plans do not have access|not have access to this season/i.test(_afLastError))_afMarkSeasonBlocked();
      return null;
    }
    try{localStorage.setItem(cacheKey,JSON.stringify({ts:Date.now(),data}));}catch{}
    return data;
  }catch(e){_afLastError=`rede: ${e?.message||'timeout'}`;return null;}
}
// /status NÃO conta na cota diária (docs oficiais) — barato p/ validar chave e ler consumo.
async function getAfStatus(){return fetchAf('/status','meridian_af_status_v1',5*60*1000);}
async function getAfStandings(){const id=_activeCompId;return fetchAf(`/standings?league=${afLeague(id)}&season=${afSeason(id)}`,'meridian_af_st_'+id);}
async function getAfFixtures(){
  const from=new Date(Date.now()-7*864e5).toISOString().slice(0,10);
  const to=new Date(Date.now()+21*864e5).toISOString().slice(0,10);
  return fetchAf(`/fixtures?league=${afLeague(_activeCompId)}&season=${afSeason(_activeCompId)}&from=${from}&to=${to}`,'meridian_af_fx_'+_activeCompId,AF_FIX_TTL);
}
// ── Enriquecimento determinístico via API-Football: técnico atual (sempre disponível)
// e escalação CONFIRMADA (só perto do jogo). Tudo defensivo — fetchAf devolve null em
// qualquer erro (CORS, rede, shape inesperado), então nunca quebra o pipeline; se falhar,
// a coleta cai no web_search como antes. Técnico muda raramente → cache de 24h. ──
const AF_COACH_TTL = 24*60*60*1000;
async function getAfCoach(teamId){
  const cid=typeof _activeCompId!=='undefined'?_activeCompId:'brsa';
  const d=await fetchAf(`/coachs?team=${teamId}`,`meridian_af_coach_${cid}_${teamId}`,AF_COACH_TTL);
  if(!d?.response?.length)return null;
  // Técnico atual = quem tem carreira neste time com end===null; senão, o 1º da lista.
  const cur=d.response.find(c=>Array.isArray(c.career)&&c.career.some(k=>k.team?.id===teamId&&!k.end));
  return (cur||d.response[0])?.name||null;
}
async function getAfLineups(fixtureId){
  const cid=typeof _activeCompId!=='undefined'?_activeCompId:'brsa';
  const d=await fetchAf(`/fixtures/lineups?fixture=${fixtureId}`,`meridian_af_lineup_${cid}_${fixtureId}`,AF_FIX_TTL);
  if(!d?.response?.length)return null;
  return d.response.map(t=>({
    team:t.team?.name||'', coach:t.coach?.name||'', formation:t.formation||'',
    xi:(t.startXI||[]).map(e=>`${e.player?.number??''} ${e.player?.name||''}`.trim()).filter(Boolean)
  })).filter(t=>t.team&&t.xi.length);
}
// Resolve os IDs de AF (times + fixture) da partida analisada, casando os nomes dos
// times contra as fixtures já carregadas (normalizado sem acento/caixa). Retorna null
// se não achar (ex.: pergunta livre com nomes fora do calendário) → sem enriquecimento.
function _afMatchIds(query,fData){
  if(!fData?.response?.length||!query)return null;
  const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const q=norm(query);
  for(const f of fData.response){
    const h=norm(f.teams?.home?.name),a=norm(f.teams?.away?.name);
    if(h&&a&&q.includes(h)&&q.includes(a))
      return {homeId:f.teams.home.id,awayId:f.teams.away.id,fixtureId:f.fixture?.id,home:f.teams.home.name,away:f.teams.away.name,date:f.fixture?.date,status:f.fixture?.status?.short};
  }
  // match parcial por times parseados "A x B"
  let teams=[];
  try{if(typeof parseMatchTeamsFromQuery==='function')teams=parseMatchTeamsFromQuery(query)||[];}catch{}
  if(teams.length>=2){
    const t0=norm(teams[0]),t1=norm(teams[1]);
    for(const f of fData.response){
      const h=norm(f.teams?.home?.name),a=norm(f.teams?.away?.name);
      if(!h||!a)continue;
      const hit=(h.includes(t0)||t0.includes(h)||h.includes(t1)||t1.includes(h))
        &&(a.includes(t0)||t0.includes(a)||a.includes(t1)||t1.includes(a));
      if(hit)
        return {homeId:f.teams.home.id,awayId:f.teams.away.id,fixtureId:f.fixture?.id,home:f.teams.home.name,away:f.teams.away.name,date:f.fixture?.date,status:f.fixture?.status?.short};
    }
  }
  return null;
}
function _afLineupWorthFetch(ids){
  if(!ids||!ids.fixtureId)return false;
  const st=String(ids.status||'');
  if(['1H','HT','2H','ET','P','LIVE'].includes(st))return true;
  if(!ids.date)return false;
  const kick=new Date(ids.date).getTime();
  if(!kick)return false;
  // só perto do jogo (36h) — economiza req/dia no free
  return Math.abs(Date.now()-kick)<36*3600*1000;
}
function _afFormatCoachLineup(ids,ch,ca,lu){
  const ex=[];
  if(ch||ca){ex.push('=== TÉCNICOS ATUAIS (API-Football · confirmado, use direto) ===');if(ch)ex.push(`${ids.home}: ${ch}`);if(ca)ex.push(`${ids.away}: ${ca}`);}
  if(lu&&lu.length){ex.push('\n=== ESCALAÇÕES CONFIRMADAS (API-Football) ===');lu.forEach(t=>ex.push(`${t.team}${t.formation?' ('+t.formation+')':''}${t.coach?' — téc. '+t.coach:''}: ${t.xi.join(', ')}`));}
  return ex.length?ex.join('\n'):'';
}
/** Legado: enriquece com fixtures já em memória (cascata AF completa). */
async function afEnrichCoachLineup(query,fData){
  try{
    const ids=_afMatchIds(query,fData);
    if(!ids)return '';
    const wantLu=_afLineupWorthFetch(ids);
    const[ch,ca,lu]=await Promise.all([
      ids.homeId?getAfCoach(ids.homeId):null,
      ids.awayId?getAfCoach(ids.awayId):null,
      wantLu&&ids.fixtureId?getAfLineups(ids.fixtureId):null
    ]);
    const body=_afFormatCoachLineup(ids,ch,ca,lu);
    return body?'\n\n'+body:'';
  }catch{return '';}
}
// Resolve ID de time por nome (/teams?search) — endpoint SEM trava de temporada,
// funciona no plano Free mesmo quando fixtures/standings da temporada atual são
// bloqueados. Cache 7 dias (IDs de time não mudam).
async function _afTeamIdByName(name){
  if(!name)return null;
  const slug=String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').slice(0,40);
  const d=await fetchAf(`/teams?search=${encodeURIComponent(name)}`,`meridian_af_team_${slug}`,7*24*3600*1000);
  return d?.response?.[0]?.team?.id||null;
}
// Fallback do plano Free: sem fixtures da temporada atual, resolve os times da query
// por busca de nome e pega SÓ os técnicos (sem lineup — exige fixture id).
async function _afCoachOnlyFallback(query){
  const empty={text:'',meta:{coaches:false,lineups:false,matched:false}};
  let teams=[];
  try{if(typeof parseMatchTeamsFromQuery==='function')teams=parseMatchTeamsFromQuery(query)||[];}catch{}
  if(teams.length<2)return empty;
  const[idH,idA]=await Promise.all([_afTeamIdByName(teams[0]),_afTeamIdByName(teams[1])]);
  if(!idH&&!idA)return empty;
  const[ch,ca]=await Promise.all([idH?getAfCoach(idH):null,idA?getAfCoach(idA):null]);
  if(!ch&&!ca)return empty;
  const body=_afFormatCoachLineup({home:teams[0],away:teams[1]},ch,ca,null);
  return{text:body,meta:{coaches:!!(ch||ca),lineups:false,matched:true,home:teams[0],away:teams[1],viaTeamSearch:true}};
}
/**
 * Caminho mínimo free-tier: 1× fixtures (cache 15min) + 0–2 coaches (24h) + 0–1 lineup (só perto do jogo).
 * Usado quando a cascata A já veio da ESPN/FD — não gasta AF em standings.
 * Plano Free sem temporada atual: cai no _afCoachOnlyFallback (técnico via /teams+/coachs).
 * @returns {{text:string, meta:{coaches:boolean,lineups:boolean,matched:boolean,home?:string,away?:string}}}
 */
async function afEnrichCoachLineupMinimal(query){
  const empty={text:'',meta:{coaches:false,lineups:false,matched:false}};
  try{
    if(!afReady())return empty; // chave local OU secret validada no Worker
    const fData=await getAfFixtures();
    if(!fData?.response?.length)return _afCoachOnlyFallback(query);
    const ids=_afMatchIds(query,fData);
    if(!ids)return {...empty,meta:{...empty.meta,matched:false}};
    const wantLu=_afLineupWorthFetch(ids);
    const[ch,ca,lu]=await Promise.all([
      ids.homeId?getAfCoach(ids.homeId):null,
      ids.awayId?getAfCoach(ids.awayId):null,
      wantLu&&ids.fixtureId?getAfLineups(ids.fixtureId):null
    ]);
    const body=_afFormatCoachLineup(ids,ch,ca,lu);
    return{
      text:body,
      meta:{
        coaches:!!(ch||ca),
        lineups:!!(lu&&lu.length),
        matched:true,
        home:ids.home,
        away:ids.away,
        lineupSkipped:!wantLu
      }
    };
  }catch{return empty;}
}
function formatAfContext(sData,fData){
  const lines=[];
  if(sData?.response?.[0]?.league?.standings){
    lines.push('=== CLASSIFICAÇÃO (API-Football) ===');
    sData.response[0].league.standings.forEach(group=>{
      if(!group.length)return;
      const gName=group[0].group||'Grupo';
      lines.push(gName+':');
      group.forEach(r=>lines.push(`  ${r.rank}. ${r.team.name} — Pts:${r.points} J:${r.all.played} V:${r.all.win} E:${r.all.draw} D:${r.all.lose} GP:${r.all.goals.for} GC:${r.all.goals.against}`));
    });
  }
  if(fData?.response?.length){
    const finished=fData.response.filter(f=>f.fixture.status.short==='FT').slice(-15);
    if(finished.length){
      lines.push('\n=== RESULTADOS RECENTES ===');
      finished.forEach(f=>{const d=new Date(f.fixture.date);lines.push(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name}`);});
    }
    const live=fData.response.filter(f=>['1H','HT','2H','ET','P'].includes(f.fixture.status.short));
    if(live.length){lines.push('\n=== AO VIVO ===');live.forEach(f=>lines.push(`${f.teams.home.name} ${f.goals.home??0}-${f.goals.away??0} ${f.teams.away.name} [${f.fixture.status.elapsed}']`));}
    const sched=fData.response.filter(f=>f.fixture.status.short==='NS').slice(0,10);
    if(sched.length){lines.push('\n=== PRÓXIMAS PARTIDAS ===');sched.forEach(f=>{const d=new Date(f.fixture.date);lines.push(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${f.teams.home.name} x ${f.teams.away.name}`);});}
  }
  return lines.join('\n');
}
function afFixturesToSchedule(fData,compId){
  if(!fData?.response?.length)return[];
  const _cid=compId||_activeCompId;
  return fData.response.map(f=>{
    const d=new Date(f.fixture.date);
    const brt=new Date(d.getTime()-3*3600000);
    const round=f.league?.round||'';
    const isGroup=String(round).toLowerCase().includes('group');
    const hLogo=f.teams?.home?.logo||'';const aLogo=f.teams?.away?.logo||'';
    if(f.teams?.home?.name)_registerTeamLogo(f.teams.home.name,hLogo);
    if(f.teams?.away?.name)_registerTeamLogo(f.teams.away.name,aLogo);
    const faseLab=_parseRoundLabel(round)||'';
    // número puro se AF mandar "Regular Season - 12"
    const rn=(String(round).match(/(\d{1,2})\s*$/)||[])[1];
    return{
      mandante:f.teams.home.name,visitante:f.teams.away.name,
      fase:faseLab||(rn?('Rodada '+rn):''),
      rodada:rn?+rn:null,
      grupo:isGroup?(_parseRoundLabel(round)||null):null,
      data_iso:brt.toISOString().slice(0,10),
      hora_brt:`${String(brt.getUTCHours()).padStart(2,'0')}:${String(brt.getUTCMinutes()).padStart(2,'0')}`,
      sede:f.fixture.venue?.city||'',
      mandante_logo:hLogo,visitante_logo:aLogo,
      comp_id:_cid
    };
  }).filter(j=>j.mandante&&j.visitante);
}
async function loadAfData(){
  const key=getAfKey();
  const hasWorker=typeof getWorkerUrl==='function'&&!!getWorkerUrl();
  if(!key&&!hasWorker){updateAfStatus('','não configurado');return;}
  updateAfStatus('',key?'verificando…':'verificando via Worker (secret)…');
  const[standings,fixtures]=await Promise.all([getAfStandings(),getAfFixtures()]);
  if(!standings&&!fixtures){
    // Plano Free da AF NÃO cobre a temporada atual (erro real 07/2026: "Free plans do
    // not have access to this season, try from 2022 to 2024"). A chave AUTENTICOU —
    // não é secret inválida. Tabela/jogos ficam com a ESPN; técnico segue via AF
    // (endpoints /teams e /coachs não são presos à temporada).
    if(/free plans do not have access|not have access to this season/i.test(_afLastError||'')){
      _remoteOkSet('meridian_af_remote_ok',true); // chave OK — mantém camada B (técnico) viva
      updateAfStatus('err','chave OK · plano Free da AF não cobre a temporada atual — tabela/jogos via ESPN; técnico ainda via AF');
      loadEspnData(false);return;
    }
    _remoteOkSet('meridian_af_remote_ok',false);
    // CORS é a causa nº1 de falha AF direta no browser — aponte o caminho (Worker).
    const corsHint=!hasWorker&&/^rede:/.test(_afLastError||'')?' · provável CORS — configure Worker URL (recomendado)':'';
    const secretHint=!key&&hasWorker?' · sem chave no app e secret AF_KEY ausente/inválida no Worker':'';
    updateAfStatus('err',(_afLastError||'sem resposta')+corsHint+secretHint+' — usando ESPN');loadEspnData(false);return;
  }
  _remoteOkSet('meridian_af_remote_ok',true);
  const ctx={fase_atual:'',standings:{},results:[]};
  if(standings?.response?.[0]?.league?.standings){
    standings.response[0].league.standings.forEach(group=>{
      if(!group.length)return;
      const gName=(group[0].group||'Grupo').replace(/Group /i,'Grupo ');
      ctx.standings[gName]=group.map(r=>{
        if(r.team?.name&&r.team?.logo)_registerTeamLogo(r.team.name,r.team.logo);
        return{time:r.team.name,pts:r.points,j:r.all.played,v:r.all.win,e:r.all.draw,d:r.all.lose,gp:r.all.goals.for,gc:r.all.goals.against};
      });
    });
  }
  if(fixtures?.response?.length){
    ctx.results=fixtures.response.filter(f=>f.fixture.status.short==='FT').slice(-120).map(f=>{
      const d=new Date(f.fixture.date);
      return{data:`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`,mandante:f.teams.home.name,placar:`${f.goals.home}-${f.goals.away}`,visitante:f.teams.away.name};
    });
    const live=fixtures.response.find(f=>['1H','HT','2H','ET','P'].includes(f.fixture.status.short));
    const sched=fixtures.response.find(f=>f.fixture.status.short==='NS');
    if(live||sched)ctx.fase_atual=(live||sched).league?.round||'';
  }
  _saveCtxCache(ctx);
  // Espelha no cache por liga (featured stats)
  try{_setCompStandings(_activeCompId,{groups:ctx.standings||{},faseAtual:ctx.fase_atual||''});}catch{}
  if(fixtures?.response?.length){
    const jogos=afFixturesToSchedule(fixtures,_activeCompId);
    if(jogos.length){
      _saveCompSched(_activeCompId,jogos);
      // grava rodada estruturada da AF (ex.: "Regular Season - 15" → Rodada 15)
      const rl=_inferCompRound(_activeCompId);
      if(rl)_setCompStatus(_activeCompId,{roundLabel:rl,checked:true,upcoming:_countUpcoming(jogos),total:jogos.length,soon:false});
      _rebuildUnionSchedule();renderScheduleChips(_schedule);if(_currentView==='library')renderLibrary();
    }
  }
  const liveN=(fixtures?.response||[]).filter(f=>['1H','HT','2H','ET','P'].includes(f.fixture.status.short)).length;
  const schedN=(fixtures?.response||[]).filter(f=>f.fixture.status.short==='NS').length;
  const parts=[];if(standings)parts.push('classificação');if(liveN)parts.push(`${liveN} ao vivo`);if(schedN)parts.push(`${schedN} agendados`);
  updateAfStatus('ok',parts.join(' · ')||'ok');
  // Consumo do plano via /status (não conta na cota diária) — vital no free 100/dia.
  try{
    const st=await getAfStatus();
    const acc=st?.response;
    if(acc&&acc.requests&&acc.requests.limit_day!=null){
      const plan=acc.subscription&&acc.subscription.plan?acc.subscription.plan+' · ':'';
      updateAfStatus('ok',(parts.join(' · ')||'ok')+` · ${plan}${acc.requests.current??'?'}/${acc.requests.limit_day} req hoje`);
    }
  }catch{}
}
