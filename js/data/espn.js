/* js/data/espn.js — ESPN unofficial API helpers */
// ─── ESPN unofficial API (gratuito · sem key · Brasileirão bra.1) ────────
var _espnLastError='';
// (review local): chaves de cache DATADAS ('meridian_results_<id>_<ymd>' e
// 'meridian_espn_<comp>_<from>_<to>') nasciam novas a cada dia/liga e NUNCA eram
// removidas — localStorage crescia até setItem falhar por quota (silenciado nos
// try/catch, degradando todos os caches). Varredura no boot: mantém só as de hoje.
(function _pruneDatedEspnCaches(){
  try{
    const ymd=(d)=>String(d.getFullYear())+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
    const today=ymd(new Date());
    // a janela do loadEspnComp é hoje−30/hoje+60 — a chave VIVA termina em hoje+60
    const to60=ymd(new Date(Date.now()+60*864e5));
    const dead=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);if(!k)continue;
      const m1=k.match(/^meridian_results_.+_(\d{8})$/);
      const m2=k.match(/^meridian_espn_.+_\d{8}_(\d{8})$/);
      if((m1&&m1[1]!==today)||(m2&&m2[1]!==to60))dead.push(k);
    }
    dead.forEach(k=>{try{localStorage.removeItem(k);}catch{}});
  }catch{}
})();
async function fetchEspn(path,cacheKey,ttl=ESPN_TTL){
  let stale=null;
  try{const c=JSON.parse(localStorage.getItem(cacheKey)||'null');if(c){if((Date.now()-c.ts)<ttl)return c.data;stale=c.data;}}catch{}
  const direct=path.startsWith('http')?path:`${ESPN_BASE}${path}`;
  // Em http(s) tenta direto; se direto falhar, tenta proxies CORS como rede de segurança (não só em file://)
  const proxies=[direct,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(direct)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(direct)}`];
  for(const url of proxies){
    const ctl=new AbortController();const tid=setTimeout(()=>ctl.abort(),8000); // não trava pra sempre
    try{
      const res=await fetch(url,{signal:ctl.signal});
      clearTimeout(tid);
      if(!res.ok){_espnLastError=`HTTP ${res.status}`;continue;}
      const data=await res.json();
      try{localStorage.setItem(cacheKey,JSON.stringify({ts:Date.now(),data}));}catch{globalThis.meridianFail?.('cache-write');} // quota estourada deixa rastro
      return data;
    }catch(e){clearTimeout(tid);_espnLastError=e?.name==='AbortError'?'timeout (8s)':`rede: ${e?.message||'falha'}`;}
  }
  return stale; // rede falhou: usa cache antigo (se houver) em vez de deixar travado em "Carregando…"
}
async function getEspnStandings(compId){
  const id=compId||_activeCompId;
  return fetchEspn(espnStandingsUrl(id),'meridian_espn_st_'+id);
}
async function getEspnScoreboard(compId){
  const id=compId||_activeCompId;
  const from=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const to=new Date(Date.now()+14*864e5).toISOString().slice(0,10).replace(/-/g,'');
  return fetchEspn(`${espnBase(id)}/scoreboard?dates=${from}-${to}&limit=50`,'meridian_espn_sb_'+id,ESPN_TTL);
}
function formatEspnContext(sData,sbData){
  const lines=[];
  // Standings: payload atual da ESPN usa children[].standings.entries
  // (o path antigo standings[0].entries ficou morto → classificação NUNCA ia pro agente).
  // Reusa o parser canônico da UI (_parseEspnStandingsPayload) quando existir.
  let groups=null;
  try{
    if(typeof _parseEspnStandingsPayload==='function'){
      const parsed=_parseEspnStandingsPayload(sData,sbData);
      if(parsed&&parsed.groups&&Object.keys(parsed.groups).length)groups=parsed.groups;
    }
  }catch{}
  if(!groups&&sData?.standings?.[0]?.entries?.length){
    groups={Grupo:sData.standings[0].entries.map(e=>{
      const stats=Object.fromEntries((e.stats||[]).map(s=>[s.name,s.value]));
      return{time:e.team?.displayName,pts:stats.points,j:stats.gamesPlayed,v:stats.wins,e:stats.ties,d:stats.losses,gp:stats.pointsFor,gc:stats.pointsAgainst};
    })};
  }
  if(!groups&&sData?.children?.[0]?.standings?.entries?.length){
    groups={Grupo:sData.children[0].standings.entries.map(e=>{
      const stats=Object.fromEntries((e.stats||[]).map(s=>[s.name,s.value]));
      return{time:e.team?.displayName,pts:stats.points,j:stats.gamesPlayed,v:stats.wins,e:stats.ties,d:stats.losses,gp:stats.pointsFor,gc:stats.pointsAgainst};
    })};
  }
  if(groups&&Object.keys(groups).length){
    lines.push('=== CLASSIFICAÇÃO (ESPN) ===');
    Object.entries(groups).forEach(([g,rows])=>{
      if(!Array.isArray(rows)||!rows.length)return;
      lines.push(g+':');
      rows.forEach(r=>{
        const name=r.time||r.team||r.nome||'?';
        lines.push(`  ${name} — Pts:${r.pts??'?'} J:${r.j??'?'} V:${r.v??'?'} E:${r.e??'?'} D:${r.d??'?'} GP:${r.gp??'?'} GC:${r.gc??'?'}`);
      });
    });
  }
  // Scoreboard
  if(sbData?.events?.length){
    const finished=sbData.events.filter(e=>e.status?.type?.completed);
    if(finished.length){
      lines.push('\n=== RESULTADOS RECENTES ===');
      finished.slice(-15).forEach(e=>{
        const c=e.competitions?.[0];const comps=c?.competitors||[];
        const home=comps.find(x=>x.homeAway==='home');const away=comps.find(x=>x.homeAway==='away');
        if(home&&away)lines.push(`${e.shortName||''} ${home?.team?.displayName} ${home?.score}-${away?.score} ${away?.team?.displayName}`);
      });
    }
    const live=sbData.events.filter(e=>e.status?.type?.state==='in');
    if(live.length){
      lines.push('\n=== AO VIVO ===');
      live.forEach(e=>{
        const c=e.competitions?.[0];const comps=c?.competitors||[];
        const home=comps.find(x=>x.homeAway==='home');const away=comps.find(x=>x.homeAway==='away');
        if(home&&away)lines.push(`${home?.team?.displayName} ${home?.score||0}-${away?.score||0} ${away?.team?.displayName} [${c?.status?.displayClock}]`);
      });
    }
    const sched=sbData.events.filter(e=>e.status?.type?.state==='pre').slice(0,10);
    if(sched.length){
      lines.push('\n=== PRÓXIMAS PARTIDAS ===');
      sched.forEach(e=>{
        const d=new Date(e.date);const brt=new Date(d.getTime()-3*3600000);
        const c=e.competitions?.[0];const comps=c?.competitors||[];
        const home=comps.find(x=>x.homeAway==='home');const away=comps.find(x=>x.homeAway==='away');
        if(home&&away)lines.push(`${String(brt.getUTCDate()).padStart(2,'0')}/${String(brt.getUTCMonth()+1).padStart(2,'0')} ${home?.team?.displayName} x ${away?.team?.displayName}`);
      });
    }
  }
  return lines.join('\n');
}
// ─── TheSportsDB (grátis · CORS aberto · multi-liga via COMPETITIONS.tsdb) ─
// 2ª fonte ESTRUTURADA e independente da ESPN: placares confirmados, rodada e
// próximos jogos. Free key 123; IDs por competição em competitions.js (brsa 4351,
// epl 4328, laliga 4335, ucl 4480; libertadores sem id estável no free tier).
// Access-Control-Allow-Origin:* — chamada direta do navegador.
const TSDB_BASE='https://www.thesportsdb.com/api/v1/json/123';
const TSDB_TTL=15*60*1000;
async function fetchTsdb(path,cacheKey){
  const url=TSDB_BASE+path;
  if(typeof cachedJsonFetch==='function'){
    return cachedJsonFetch(url,cacheKey,{ttl:TSDB_TTL,timeout:8000});
  }
  try{
    const res=await fetch(url);
    if(!res.ok)return null;
    return await res.json();
  }catch{return null;}
}
function _tsdbLine(e){
  const sc=(e.intHomeScore!=null&&e.intAwayScore!=null)?`${e.intHomeScore}x${e.intAwayScore}`:'—';
  const rd=e.intRound?` (rodada ${e.intRound})`:'';
  return `${e.dateEvent||''} · ${e.strHomeTeam} ${sc} ${e.strAwayTeam}${rd}`;
}
function _tsdbLeagueId(compId){
  const id=compId||(typeof _activeCompId!=='undefined'?_activeCompId:'brsa');
  if(typeof tsdbLeague==='function'){const v=tsdbLeague(id);if(v!=null)return v;}
  if(typeof getComp==='function'){const c=getComp(id);if(c&&c.tsdb!=null)return c.tsdb;}
  return null;
}
async function getTsdbContext(compId){
  const leagueId=_tsdbLeagueId(compId);
  if(leagueId==null)return '';
  const cid=compId||(typeof _activeCompId!=='undefined'?_activeCompId:'brsa');
  // Free key 123: eventspast/next costumam devolver 1 jogo só (quase fantasma).
  // eventsseason + lookuptable dão repertório real no free tier.
  const seasonY=(typeof seasonYearFor==='function'?seasonYearFor(cid):new Date().getFullYear());
  const[past,next,season,table]=await Promise.all([
    fetchTsdb('/eventspastleague.php?id='+leagueId,'tsdb_past_'+cid+'_'+leagueId),
    fetchTsdb('/eventsnextleague.php?id='+leagueId,'tsdb_next_'+cid+'_'+leagueId),
    fetchTsdb('/eventsseason.php?id='+leagueId+'&s='+seasonY,'tsdb_season_'+cid+'_'+leagueId+'_'+seasonY),
    fetchTsdb('/lookuptable.php?l='+leagueId+'&s='+seasonY,'tsdb_table_'+cid+'_'+leagueId+'_'+seasonY)
  ]);
  const L=[];
  const label=typeof compLabel==='function'?compLabel(cid):cid;
  // tabela (free truncada, mas melhor que nada)
  if(table?.table?.length){
    L.push('=== CLASSIFICAÇÃO (TheSportsDB · '+label+' · free tier pode vir truncada) ===');
    table.table.slice(0,20).forEach(r=>{
      L.push('  '+(r.intRank||'?')+'. '+(r.strTeam||'?')+' — Pts:'+(r.intPoints??'?')+' J:'+(r.intPlayed??'?')+' V:'+(r.intWin??'?')+' E:'+(r.intDraw??'?')+' D:'+(r.intLoss??'?')+' GP:'+(r.intGoalsFor??'?')+' GC:'+(r.intGoalsAgainst??'?'));
    });
  }
  // resultados: preferir season se past for magro (<5)
  let pastEv=past?.events||[];
  if((!pastEv.length||pastEv.length<5)&&season?.events?.length){
    pastEv=season.events.filter(e=>e.intHomeScore!=null&&e.intAwayScore!=null).slice(-20);
  }else{
    pastEv=pastEv.slice(0,15);
  }
  if(pastEv.length){
    L.push('=== RESULTADOS CONFIRMADOS (TheSportsDB · '+label+' · liga '+leagueId+') ===');
    pastEv.forEach(e=>L.push(_tsdbLine(e)));
  }
  if(next?.events?.length){
    L.push('=== PRÓXIMOS JOGOS (TheSportsDB · '+label+') ===');
    next.events.slice(0,10).forEach(e=>L.push(_tsdbLine(e)));
  }
  return L.join('\n');
}

// Nomes de confronto "a definir" que a ESPN publica em inglês para o mata-mata
// (ex.: "Semifinal 1 Loser"). Traduz pra pt-BR — sem isso, "Semifinal 1 Loser ×
// Semifinal 2 Loser" (que é só a disputa de 3º lugar) parece uma losers bracket,
// que NÃO existe no Brasileirão (mata-mata é eliminação simples + 1 jogo de 3º lugar).
function _ptPlaceholderTeam(n){
  let s=String(n||'').trim();
  if(!s)return s;
  const round=r=>r.replace(/round of 16/i,'Oitavas').replace(/round of 32/i,'32-avos')
    .replace(/quarter-?final/i,'Quartas').replace(/semi-?final/i,'Semifinal').replace(/\bfinal\b/i,'Final');
  // "Group A Winner" / "Group A Runner-up"
  let m=s.match(/^group\s+([a-l])\s+(winner|runner-?up)$/i);
  if(m)return (/winner/i.test(m[2])?'1º ':'2º ')+'Grupo '+m[1].toUpperCase();
  // "<Fase> <n> Winner|Loser"  (formato do print) e "Winner|Loser <Fase> <n>"
  m=s.match(/^(.*?)\s*(\d+)\s+(winner|loser)$/i)||s.match(/^(winner|loser)\s+(.*?)\s*(\d+)$/i);
  if(m){
    const wl=/winner/i.test(s)?'Vencedor':'Perdedor';
    const parts=[m[1],m[2],m[3]].filter(x=>x&&!/^(winner|loser)$/i.test(x));
    return wl+' '+round(parts[0])+' '+parts[1];
  }
  return s;
}
function espnScoreboardToSchedule(sbData,compId){
  if(!sbData?.events?.length)return[];
  const _cid=compId||_activeCompId;
  return sbData.events.map(e=>{
    const c=e.competitions?.[0];const comps=c?.competitors||[];
    const home=comps.find(x=>x.homeAway==='home');const away=comps.find(x=>x.homeAway==='away');
    if(!home||!away)return null;
    const d=new Date(e.date);const brt=new Date(d.getTime()-3*3600000);
    // Rodada: NUNCA usar e.name ("Santos at Botafogo") — só notes/type/week estruturados
    let roundRaw=(c?.notes||[]).map(n=>n.headline||n.text||'').find(t=>t&&!/\bat\b|\bvs\.?\b|×|@/i.test(t))
      ||(c?.type&&(c.type.detail||c.type.text))||e.week||'';
    if(roundRaw&&(/\bat\b|\bvs\.?\b|×|@/i.test(String(roundRaw))||String(roundRaw)===e.name))roundRaw='';
    const hn=home.team.displayName,an=away.team.displayName;
    // Captura brasões (scoreboard: team.logo · standings: team.logos[])
    const hLogo=home.team.logo||home.team.logos?.[0]?.href||(home.team.id?_ESPN_CREST(home.team.id):'');
    const aLogo=away.team.logo||away.team.logos?.[0]?.href||(away.team.id?_ESPN_CREST(away.team.id):'');
    _registerTeamLogo(hn,hLogo);_registerTeamLogo(an,aLogo);
    const semiLoser=x=>/semi-?final/i.test(x)&&/loser/i.test(x);
    const semiWinner=x=>/semi-?final/i.test(x)&&/winner/i.test(x);
    let round=roundRaw||'';
    if(semiLoser(hn)&&semiLoser(an))round='Disputa de 3º lugar';
    else if(semiWinner(hn)&&semiWinner(an))round='Final';
    const faseLab=_parseRoundLabel(round)||''; // só "Rodada N" / fases; vazio se não houver
    const isGroup=/group/i.test(String(round))||/grupo/i.test(String(round));
    return{
      mandante:_ptPlaceholderTeam(hn),visitante:_ptPlaceholderTeam(an),
      fase:faseLab, // vazio se ESPN não trouxe rodada (não grava nome do jogo)
      grupo:isGroup&&faseLab?faseLab:null,
      data_iso:brt.toISOString().slice(0,10),
      hora_brt:`${String(brt.getUTCHours()).padStart(2,'0')}:${String(brt.getUTCMinutes()).padStart(2,'0')}`,
      sede:c?.venue?.fullName||'',
      mandante_logo:hLogo||'',visitante_logo:aLogo||'',
      comp_id:_cid
    };
  }).filter(Boolean);
}
async function loadEspnData(force){
  if(force){try{['brsa_espn_standings_v1','brsa_espn_standings_v2','brsa_espn_scores_v1','brsa_espn_scores_v2'].forEach(k=>localStorage.removeItem(k));}catch{}}
  // Stale-while-revalidate: pinta a última agenda salva IMEDIATAMENTE, depois atualiza com dados frescos
  if(!force&&!_schedule.length){try{const sc=_loadSchedCache();if(sc?.jogos?.length){_schedule=sc.jogos;renderScheduleChips(_schedule);if(_currentView==='library')renderLibrary();}}catch{}}
  const espnEl=document.getElementById('espn-status');
  // Dispara as duas chamadas em paralelo, mas renderiza a AGENDA assim que o scoreboard chega —
  // sem bloquear no /standings (que vem vazio e lento). Standings só alimenta o contexto.
  const scoreboardP=getEspnScoreboard(),standingsP=getEspnStandings();
  const scoreboard=await scoreboardP;
  const sbOk=!!(scoreboard?.events?.length);
  if(sbOk){
    const jogos=espnScoreboardToSchedule(scoreboard);
    if(jogos.length){_saveSchedCache(jogos);_schedule=jogos;renderScheduleChips(_schedule);if(_currentView==='library')renderLibrary();}
  }
  // Status reflete a REALIDADE do scoreboard (não um "ativo" fixo)
  if(espnEl){espnEl.textContent=sbOk?'ativo':(_espnLastError||'indisponível');espnEl.className='ds-status '+(sbOk?'ok':'err');}
  const standings=await standingsP;
  // Se a agenda continua vazia, NUNCA deixa travado em "Carregando…": mostra o erro real + tentar de novo
  if(!_schedule.length){
    const ch=document.getElementById('ex-chips');
    if(ch)ch.innerHTML=`<span class="ex-auto-hint">Não foi possível carregar a agenda${_espnLastError?` (${esc(_espnLastError)})`:''} · <button class="chip chip-cta" onclick="loadSchedule(true)">↻ tentar de novo</button> <button class="chip chip-cta" onclick="fetchScheduleFromApi(false)">buscar via IA →</button></span>`;
    if(typeof renderLibrary==='function'&&_currentView==='library')renderLibrary();
    return;
  }
  // Contexto do torneio p/ o AGENTE (análise) — separado do seletor de Estatísticas
  const ctx={fase_atual:'',standings:{},results:[]};
  const parsed=_parseEspnStandingsPayload(standings,scoreboard);
  if(parsed.groups&&Object.keys(parsed.groups).length)ctx.standings=parsed.groups;
  if(parsed.faseAtual)ctx.fase_atual=parsed.faseAtual;
  if(scoreboard?.events){
    ctx.results=scoreboard.events.filter(e=>e.status?.type?.completed).slice(-120).map(e=>{
      const c=e.competitions?.[0];const comps=c?.competitors||[];
      const home=comps.find(x=>x.homeAway==='home');const away=comps.find(x=>x.homeAway==='away');
      const d=new Date(e.date);
      return{data:`${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`,mandante:home?.team?.displayName||'',placar:`${home?.score||0}-${away?.score||0}`,visitante:away?.team?.displayName||''};
    });
    if(!ctx.fase_atual){
      const live=scoreboard.events.find(e=>e.status?.type?.state==='in');
      const next=scoreboard.events.find(e=>e.status?.type?.state==='pre');
      if(live||next)ctx.fase_atual=(live||next).competitions?.[0]?.notes?.[0]?.headline||'';
    }
  }
  _saveCtxCache(ctx);
  // Também grava no cache por liga (featured stats usa isto, não o ctx de análise)
  _setCompStandings(_activeCompId,{groups:ctx.standings,faseAtual:ctx.fase_atual});
  scheduleFeaturedPaint();
}


/* ── standings / results / news / chat scoreboards (moved from app.js) ── */
// Resultados finalizados por campeonato (cache em memória)
var _compResults={},_compResultsAt={};
/** Classificação + fase por liga (seletor de Estatísticas). Nunca misturar com ctx de análise. */
var _compStandings={},_compStandingsAt={};
const COPA_RESULTS_TTL=5*60*1000;
const COMP_STANDINGS_TTL=15*60*1000;
function _ymd(dt){return dt.getFullYear()+String(dt.getMonth()+1).padStart(2,'0')+String(dt.getDate()).padStart(2,'0');}

/** Parse ESPN standings → { groups: {name:[{time,pts,j,v,e,d,gp,gc,sg,rank}]}, faseAtual } */
function _parseEspnStandingsPayload(raw,scoreboard){
  const groups={};
  let faseAtual='';
  const grpNodes=raw?.children?.length?raw.children
    :(raw?.standings?(Array.isArray(raw.standings)?raw.standings:[raw.standings]):[]);
  if(grpNodes.length){
    grpNodes.forEach(node=>{
      const gname=node.name||node.displayName||'Grupo';
      const entries=node.standings?.entries||node.entries||[];
      if(!entries.length)return;
      groups[gname]=entries.map(e=>{
        const st=Object.fromEntries((e.stats||[]).map(s=>[s.name,s.value]));
        const tname=e.team?.displayName||'';
        const tlogo=e.team?.logo||e.team?.logos?.[0]?.href||(e.team?.id?_ESPN_CREST(e.team.id):'');
        if(tname&&tlogo)_registerTeamLogo(tname,tlogo);
        return{
          time:tname,pts:st.points??0,j:st.gamesPlayed??0,v:st.wins??0,e:st.ties??0,d:st.losses??0,
          gp:st.pointsFor??0,gc:st.pointsAgainst??0,
          sg:st.pointDifferential??((st.pointsFor??0)-(st.pointsAgainst??0)),
          rank:st.rank??0
        };
      }).sort((a,b)=>(a.rank||99)-(b.rank||99)||b.pts-a.pts||b.sg-a.sg);
    });
  }
  // fallback: estrutura flat entries
  if(!Object.keys(groups).length&&raw?.standings?.[0]?.entries?.length){
    const rows=raw.standings[0].entries.map(e=>{
      const st=Object.fromEntries((e.stats||[]).map(s=>[s.name,s.value]));
      const tname=e.team?.displayName||'';
      const tlogo=e.team?.logo||e.team?.logos?.[0]?.href||'';
      if(tname&&tlogo)_registerTeamLogo(tname,tlogo);
      return{
        time:tname,pts:st.points??0,j:st.gamesPlayed??0,v:st.wins??0,e:st.ties??0,d:st.losses??0,
        gp:st.pointsFor??0,gc:st.pointsAgainst??0,
        sg:st.pointDifferential??((st.pointsFor??0)-(st.pointsAgainst??0)),
        rank:st.rank??0
      };
    }).sort((a,b)=>(a.rank||99)-(b.rank||99)||b.pts-a.pts);
    if(rows.length)groups['Tabela']=rows;
  }
  if(scoreboard?.events?.length){
    const live=scoreboard.events.find(e=>e.status?.type?.state==='in');
    const next=scoreboard.events.find(e=>e.status?.type?.state==='pre');
    if(live||next)faseAtual=(live||next).competitions?.[0]?.notes?.[0]?.headline||'';
  }
  return{groups,faseAtual};
}
function _setCompStandings(compId,payload){
  if(!compId)return;
  const groups=(payload&&payload.groups)||payload?.standings||{};
  const faseAtual=(payload&&payload.faseAtual)||payload?.fase_atual||'';
  _compStandings[compId]={standings:groups,faseAtual:faseAtual||''};
  _compStandingsAt[compId]=Date.now();
}
function _getCompStandings(compId){
  const id=compId||_statsCompId||_activeCompId;
  return _compStandings[id]||null;
}
/** Carrega classificação ESPN da liga (cache memória + fetch por compId). */
async function _loadCompStandings(compId,force){
  const id=compId||_statsCompId||_activeCompId;
  if(!force&&_compStandings[id]&&Date.now()-(_compStandingsAt[id]||0)<COMP_STANDINGS_TTL){
    return _compStandings[id];
  }
  try{
    const raw=await getEspnStandings(id);
    // scoreboard curto só para “fase” (ao vivo / próximo) — não bloqueia se falhar
    let sb=null;
    try{sb=await getEspnScoreboard(id);}catch{}
    const parsed=_parseEspnStandingsPayload(raw,sb);
    // fase fallback: rodada inferida da agenda da liga
    if(!parsed.faseAtual){
      const rl=(typeof _inferCompRound==='function')?_inferCompRound(id):'';
      if(rl)parsed.faseAtual=rl;
      else if(_compStatus[id]?.roundLabel)parsed.faseAtual=_compStatus[id].roundLabel;
    }
    _setCompStandings(id,parsed);
  }catch(e){
    if(!_compStandings[id])_setCompStandings(id,{groups:{},faseAtual:''});
  }
  return _compStandings[id];
}
async function _loadCompResults(compId){
  const id=compId||_statsCompId||_activeCompId;
  if(_compResults[id]&&Date.now()-(_compResultsAt[id]||0)<COPA_RESULTS_TTL)return _compResults[id];
  // Temporada: ~8 meses atrás até hoje (cobre ligas europeias e BR)
  const startD=new Date(Date.now()-240*864e5);
  const start=_ymd(startD);const end=_ymd(new Date());
  try{
    const r=await fetchEspn(`${espnBase(id)}/scoreboard?dates=${start}-${end}&limit=100`,'meridian_results_'+id+'_'+end,COPA_RESULTS_TTL);
    const events=(r&&r.events)||[];
    _compResults[id]=events.filter(e=>e.status&&e.status.type&&e.status.type.completed).map(e=>{
      const c=e.competitions&&e.competitions[0];const comps=(c&&c.competitors)||[];
      const h=comps.find(x=>x.homeAway==='home')||comps[0];
      const a=comps.find(x=>x.homeAway==='away')||comps[1];
      const dt=new Date(e.date);
      // captura brasões se vierem
      if(h&&h.team){const logo=h.team.logo||h.team.logos?.[0]?.href;if(logo)_registerTeamLogo(h.team.displayName,logo);}
      if(a&&a.team){const logo=a.team.logo||a.team.logos?.[0]?.href;if(logo)_registerTeamLogo(a.team.displayName,logo);}
      return{
        data:`${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`,
        mandante:(h&&h.team&&h.team.displayName)||'',
        visitante:(a&&a.team&&a.team.displayName)||'',
        placar:`${(h&&h.score!=null?h.score:'?')}-${(a&&a.score!=null?a.score:'?')}`,
        comp_id:id
      };
    });
    _compResultsAt[id]=Date.now();
  }catch(e){if(!_compResults[id])_compResults[id]=[];}
  return _compResults[id];
}
// legado: mantém alias
async function _loadCopaResults(){return _loadCompResults(_statsCompId||_activeCompId);}

// ─── News ticker ─────────────────────────────────────────────────────────
const NEWS_TTL=10*60*1000;
async function loadNews(){
  try{
    const newsPath=currentLang==='pt'?'/news?limit=20&lang=pt&region=br':'/news?limit=20';
    const data=await fetchEspn(newsPath,'brsa_espn_news_v1',NEWS_TTL);
    const arts=(data?.articles||[]).filter(a=>a.headline);
    if(!arts.length)return;
    const el=document.getElementById('ntick-inner');if(!el)return;
    const items=arts.map(a=>`<span class="ntick-item">${esc(a.headline)}</span>`).join('');
    el.innerHTML=items+items;
    const estPx=arts.reduce((s,a)=>s+a.headline.length*7+44,0);
    el.style.animationDuration=Math.max(25,Math.round(estPx/80))+'s';
    document.getElementById('ntick').style.display='flex';
  }catch{}
}
setInterval(loadNews,NEWS_TTL);

/** Lista estruturada de partidas ESPN recentes (para opções do popup). */
async function listRecentEspnMatches(compIds,limit){
  limit=limit||10;
  const out=[];
  const seen=new Set();
  const push=(m,label)=>{
    if(!m||!m.home||!m.away)return;
    const k=(m.home+'|'+m.away+'|'+(m.date||'')).toLowerCase();
    if(seen.has(k))return;seen.add(k);
    out.push({
      home:m.home,away:m.away,score:m.score||'',status:m.status||'',
      date:m.date||'',detail:m.detail||'',label:label||m.path||'',
      clock:m.clock||''
    });
  };
  try{
    let ids=(Array.isArray(compIds)&&compIds.length)?compIds.slice():COMP_ORDER.slice();
    ids=ids.filter(id=>COMPETITIONS[id]);
    if(!ids.length)ids=COMP_ORDER.slice();
    await Promise.all(ids.map(async(id)=>{
      try{
        const live=await fetchEspnScoreboardPath(getComp(id).espn).catch(()=>[]);
        (live||[]).forEach(m=>push(m,compLabel(id)));
      }catch{}
    }));
    await Promise.all(ESPN_EXTRA_SCOREBOARDS.map(async(path)=>{
      try{
        const live=await fetchEspnScoreboardPath(path).catch(()=>[]);
        (live||[]).forEach(m=>push(m,path));
      }catch{}
    }));
  }catch{}
  // prioriza LIVE → FT de hoje → resto
  const today=new Date().toISOString().slice(0,10);
  out.sort((a,b)=>{
    const rank=m=>{
      if(m.status==='LIVE')return 0;
      if(m.status==='FT'&&m.date===today)return 1;
      if(m.date===today)return 2;
      if(m.status==='FT')return 3;
      return 4;
    };
    return rank(a)-rank(b);
  });
  return out.slice(0,limit);
}

function matchOptionLabel(m){
  // Sem fonte/competição (fifa.world, Brasileirão…) — só times + placar + status
  const sc=m.score&&m.score!=='?-?'?` ${m.score}`:'';
  const st=m.status?` [${m.status}]`:'';
  return sanitizeMatchOptionLabel(`${m.home} x ${m.away}${sc}${st}`).slice(0,88);
}

/**
 * Abre popup de escolha de jogo (2 opções + Outro) SEM chamar o LLM.
 * Usado quando a pergunta é ambígua — evita suposição/alucinação de partida.
 */
async function openMatchPickerPopup(pendingQuery,compIds){
  const q=pendingQuery||'';
  let opts=[];
  try{
    const list=await listRecentEspnMatches(compIds,8);
    opts=list.slice(0,2).map((m,i)=>({id:'m'+i,label:matchOptionLabel(m)}));
  }catch{}
  while(opts.length<2){
    if(opts.length===0)opts.push({id:'club',label:'Jogo de clube de hoje (informo times/liga)'});
    else opts.push({id:'nt',label:'Jogo de seleção / copa de hoje (informo times)'});
  }
  openContextPromptPopup({
    question:'Qual jogo você quer analisar ou comentar?',
    options:opts.slice(0,2)
  },q);
}

/**
 * Remove raciocínio interno, planos de tool, scripts e meta-texto do modelo.
 * Nunca deve vazar thinking / web_search plans / monólogo de ferramenta no chat.
 */
function stripInternalReasoning(text){
  if(!text)return'';
  let t=String(text);
  // blocos explícitos de thinking / reasoning
  t=t.replace(/<thinking>[\s\S]*?<\/thinking>/gi,'');
  t=t.replace(/<\/?thinking>/gi,'');
  t=t.replace(/<antthinking>[\s\S]*?<\/antthinking>/gi,'');
  t=t.replace(/```(?:thinking|reasoning|plan|tool|bash|shell|javascript|js|python|json)?\s*[\s\S]*?```/gi,(block)=>{
    // preserva fence json se for o card/context_prompt
    if(/"card"\s*:|"context_prompt"\s*:/.test(block))return block;
    return'';
  });
  // monólogo típico de tool-use / planejamento
  t=t.replace(/^(?:I(?:'ll| will)|Vou|Deixa eu|Deixe-me|Let me|First,|Primeiro,|Passo\s*\d+|Step\s*\d+)[^\n]{0,200}\n/gim,'');
  t=t.replace(/(?:^|\n)\s*(?:web_search|tool_use|function_call|invoke\s+tool|Searching for|Buscando em|Vou buscar|I'll search)[^\n]*/gi,'');
  t=t.replace(/(?:^|\n)\s*(?:query|comando|command|script)\s*[:=]\s*[^\n]+/gi,'');
  // se sobrar JSON estruturado no meio de prosa, isola o JSON
  const jsonHit=t.match(/\{[\s\S]*"(?:card|context_prompt)"\s*:[\s\S]*\}/);
  if(jsonHit){
    const st=t.indexOf(jsonHit[0][0]==='{'?jsonHit[0]:'{');
    // tenta achar o maior objeto JSON válido
    const from=t.search(/\{[\s\S]*"(?:card|context_prompt)"\s*:/);
    if(from>=0){
      const slice=t.slice(from);
      const end=slice.lastIndexOf('}');
      if(end>0){
        const cand=slice.slice(0,end+1);
        try{JSON.parse(cand);return cand;}catch{
          try{JSON.parse(repairJson(cand));return repairJson(cand);}catch{}
        }
      }
    }
  }
  return t.trim();
}

/** Texto do stream é "lixo interno" (raciocínio/tool) e não deve pintar a bolha. */
function isInternalModelNoise(text){
  const t=String(text||'').trim();
  if(!t)return true;
  if(/<thinking>|<\/thinking>|<antthinking>/i.test(t))return true;
  if(/^\s*\{[\s\S]*"(?:card|context_prompt)"\s*:/.test(t))return false;
  // planos de busca / scripts no começo
  if(/^(?:I need to|I'll |I will |Let me |Vou |Primeiro |First |Step \d|Passo \d|web_search|tool_use|function_call|```(?:bash|shell|python|js|javascript))/i.test(t))return true;
  if(/(?:web_search|tool_use|function_call|max_uses|budget_tokens)/i.test(t)&&!/"card"|"context_prompt"/.test(t)&&t.length<2000)return true;
  return false;
}

/**
 * Se o usuário foi vago e a RESPOSTA pressupõe uma partida específica, isso é
 * suposição inadmissível (invariante 18) — converte para popup de confirmação.
 * Aceita card estruturado OU prosa (shell 89: o chat virou texto no 88 e o gate
 * havia ficado sem chamador — dead code + brecha de suposição no caminho de prosa).
 * Em prosa o critério é ESTRITO: só dispara se o texto nomear um confronto/placar
 * explícito ("A x B", "A 2-1 B"); frase genérica NÃO vira popup.
 */
function cardPresupposedVagueMatch(cardOrText,userQuery){
  if(!cardOrText||!isVagueMatchQuery(userQuery))return null;
  const isText=typeof cardOrText==='string';
  const card=isText?null:cardOrText;
  const title=isText?'':String(card.titulo||card.subtitulo||'').trim();
  const sub=isText?'':String(card.subtitulo||'').trim();
  const blob=isText
    ?String(cardOrText).slice(0,600)
    :(title+' '+sub+' '+JSON.stringify(card).slice(0,400));
  // extrai "Time A x Time B" ou placar "A 1-2 B"
  let label='';
  const vs=blob.match(/([A-ZÁÉÍÓÚÂÊÔÃÕÀ][\wÁÉÍÓÚÂÊÔÃÕÀáéíóúâêôãõàü.'-]{1,28}(?:\s+[\wÁÉÍÓÚÂÊÔÃÕÀáéíóúâêôãõàü.'-]{1,20}){0,2})\s+(?:x|vs\.?|×)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÀ][\wÁÉÍÓÚÂÊÔÃÕÀáéíóúâêôãõàü.'-]{1,28}(?:\s+[\wÁÉÍÓÚÂÊÔÃÕÀáéíóúâêôãõàü.'-]{1,20}){0,2})/i);
  if(vs)label=`${vs[1].trim()} x ${vs[2].trim()}`;
  else{
    const sc=blob.match(/([A-ZÁÉÍÓÚÂÊÔÃÕÀ][\wÁÉÍÓÚÂÊÔÃÕÀáéíóúâêôãõàü.'-]{2,24})\s+\d+\s*[-x×]\s*\d+\s+([A-ZÁÉÍÓÚÂÊÔÃÕÀ][\wÁÉÍÓÚÂÊÔÃÕÀáéíóúâêôãõàü.'-]{2,24})/i);
    if(sc)label=`${sc[1].trim()} x ${sc[2].trim()}`;
  }
  if(!label&&title)label=title.slice(0,72);
  // Prosa sem confronto/placar explícito NÃO é suposição — não abrir popup (evita
  // transformar "acha que vai ser jogo duro?" em pergunta de contexto).
  if(!label&&isText)return null;
  if(!label)label='o jogo que o agente escolheu sozinho';
  return{
    question:'Não ficou claro qual jogo você quis dizer. Confirma?',
    options:[
      {id:'yes',label:`Sim: ${label}`.slice(0,88)},
      {id:'no',label:'Não — quero outro jogo (descrevo em Outro…)'}
    ]
  };
}
/** Infere IDs de COMPETITIONS a partir do texto (pergunta + trechos recentes do chat). */
function inferCompIdsFromText(q){
  const raw=String(q||'');
  const t=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const hits=[];
  const add=id=>{if(COMPETITIONS[id]&&!hits.includes(id))hits.push(id);};
  if(/\b(serie\s*a|brasileir|brsa|brasileirao|brasileiro)\b/.test(t))add('brsa');
  if(/\b(libertadores|liberta|conmebol)\b/.test(t))add('libertadores');
  if(/\b(premier(\s*league)?|epl|premier)\b/.test(t)||/\binglaterra\b/.test(t)&&/\b(liga|league|campeonato)\b/.test(t))add('epl');
  if(/\b(laliga|la\s*liga)\b/.test(t)||/\bespanha\b/.test(t)&&/\b(liga|campeonato)\b/.test(t))add('laliga');
  if(/\b(champions(\s*league)?|ucl|liga\s*dos\s*campeoes|uefa\s*champions)\b/.test(t))add('ucl');
  COMP_ORDER.forEach(id=>{
    const c=getComp(id);
    const keys=[c.name,c.short,c.labelDefault].filter(Boolean).map(s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
    if(keys.some(k=>k&&t.includes(k)))add(id);
  });
  // Sem palavra de competi\u00e7\u00e3o: infere pela CAMADA DE CLUBES ("Flamengo x Palmeiras"
  // deve cair no Brasileir\u00e3o mesmo com a UI em outra liga \u2014 shell 74). Liga nacional
  // primeiro (Libertadores/UCL s\u00f3 por keyword acima, clubes s\u00e3o amb\u00edguos).
  // Camada de CLUBES — DECISÃO revista anterior. Antes, qualquer clube
  // reconhecido forçava a liga NACIONAL dele: "Real Madrid x Internazionale" caía em
  // "laliga" e o pipeline colava a tabela da LaLiga num jogo de Champions. O modelo via o
  // descompasso e NARRAVA isso no Resumo (caso real observado). Clubes de ligas nacionais
  // DIFERENTES só se enfrentam em competição CONTINENTAL; e confronto com só UM lado
  // reconhecido = adversário estrangeiro/desconhecido — melhor NÃO inferir do que colar
  // a tabela errada. As listas são as mesmas do 74; o que mudou é como se decide.
  if(!hits.length){
    const CLUBES={
      brsa:/\b(flamengo|palmeiras|corinthians|sao\s*paulo|santos|vasco|fluminense|botafogo|gremio|internacional|cruzeiro|atletico[\s-]?mg|athletico|bahia|fortaleza|bragantino|mirassol|vitoria|juventude|sport\s*recife|ceara|cuiaba|goias)\b/g,
      epl:/\b(arsenal|chelsea|liverpool|man(chester)?\s*(city|united)|tottenham|spurs|newcastle|aston\s*villa|everton|west\s*ham|brighton|fulham|brentford|wolves|bournemouth|nottingham|crystal\s*palace|leicester|leeds)\b/g,
      laliga:/\b(real\s*madrid|barcelona|atletico\s*(de\s*)?madrid|sevilla|betis|villarreal|athletic\s*(club|bilbao)|valencia|girona|real\s*sociedad|celta|osasuna|mallorca|getafe|espanyol)\b/g,
    };
    const achados={};
    for(const id of Object.keys(CLUBES)){
      const m=t.match(CLUBES[id]);
      if(m&&m.length)achados[id]=new Set(m.map(x=>x.trim())).size;
    }
    const ligas=Object.keys(achados);
    const temConfronto=/(^|\s)(x|vs|versus|×|contra)(\s|$)/i.test(t);
    if(ligas.length>=2){
      // duas ligas nacionais no mesmo texto = torneio continental. Europa -> ucl;
      // com um lado brasileiro é intercontinental (Mundial/amistoso): não chuta.
      if(!ligas.includes("brsa"))add("ucl");
    }else if(ligas.length===1){
      // 2+ clubes da MESMA liga = confronto doméstico (preserva o fix anterior).
      // 1 clube só + padrão de confronto = adversário de fora: não força liga nacional.
      if(achados[ligas[0]]>=2||!temConfronto)add(ligas[0]);
    }
  }
  return hits;
}

// Scoreboards ESPN extras (seleções / competições fora do COMP_ORDER do app)
const ESPN_EXTRA_SCOREBOARDS=[
  'fifa.world','fifa.friendly','uefa.euro','uefa.nations','conmebol.america',
  'caf.nations','afc.asian.cup','concacaf.gold','olympics.soccer.men'
];

/** Scoreboard ESPN genérico por path (ex.: eng.1, fifa.world). */
async function fetchEspnScoreboardPath(espnPath){
  const from=new Date(Date.now()-3*864e5).toISOString().slice(0,10).replace(/-/g,'');
  const to=new Date(Date.now()+1*864e5).toISOString().slice(0,10).replace(/-/g,'');
  const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnPath}/scoreboard?dates=${from}-${to}&limit=50`;
  try{
    const r=await fetchEspn(url,'espn_sb_live_'+espnPath,5*60*1000);
    const events=(r&&r.events)||[];
    return events.map(ev=>{
      const comp=ev.competitions&&ev.competitions[0];
      if(!comp)return null;
      const home=(comp.competitors||[]).find(c=>c.homeAway==='home');
      const away=(comp.competitors||[]).find(c=>c.homeAway==='away');
      const hs=home&&home.score!=null?String(home.score):'?';
      const as=away&&away.score!=null?String(away.score):'?';
      const st=(comp.status&&comp.status.type)||{};
      const state=st.state||''; // pre|in|post
      const detail=st.detail||st.description||st.shortDetail||'';
      const clock=(comp.status&&comp.status.displayClock)||'';
      return{
        path:espnPath,
        home:(home&&home.team&&(home.team.displayName||home.team.name))||'?',
        away:(away&&away.team&&(away.team.displayName||away.team.name))||'?',
        score:`${hs}-${as}`,
        status:state==='post'?'FT':(state==='in'?'LIVE':(state==='pre'?'NS':state)),
        detail,clock,
        date:(ev.date||'').slice(0,10)
      };
    }).filter(Boolean);
  }catch{return[];}
}

/** Coleta ESPN multi-liga do app + scoreboards de seleções/copa. */
async function gatherEspnForChat(compIds){
  try{
    let ids=(Array.isArray(compIds)&&compIds.length)?compIds.slice():COMP_ORDER.slice();
    ids=ids.filter(id=>COMPETITIONS[id]);
    if(!ids.length)ids=COMP_ORDER.slice();
    const L=[];
    await Promise.all(ids.map(async(id)=>{
      try{
        const [results,standings,live]=await Promise.all([
          _loadCompResults(id).catch(()=>null),
          _loadCompStandings(id,false).catch(()=>null),
          fetchEspnScoreboardPath(getComp(id).espn).catch(()=>[])
        ]);
        const label=compLabel(id);
        const block=[];
        if(live&&live.length){
          block.push(`--- ${label} · scoreboard ESPN (hoje/recente) ---`);
          live.forEach(m=>block.push(`${m.date||''} [${m.status}${m.clock?' '+m.clock:''}] ${m.home} ${m.score} ${m.away} · ${m.detail||''}`));
        }
        if(results&&results.length){
          block.push(`--- ${label} · resultados recentes (ESPN) ---`);
          results.slice(-40).forEach(r=>block.push(`${r.data||''}  ${r.mandante} ${r.placar} ${r.visitante}`));
        }
        try{
          if(standings){
            const g=standings.groups||standings;
            if(g&&typeof g==='object'&&!Array.isArray(g)){
              const lines=[];
              Object.entries(g).forEach(([gn,rows])=>{
                if(!Array.isArray(rows))return;
                lines.push(`${gn}: `+rows.slice(0,8).map(r=>`${r.time||r.team||r.nome||'?'}(${r.pts??r.points??'?'}pts)`).join(' | '));
              });
              if(lines.length){block.push(`--- ${label} · classificação ---`);lines.forEach(x=>block.push(x));}
            }
          }
        }catch{}
        const sched=_schedByComp[id]||[];
        if(sched.length){
          const up=nearestMatches(sched,10,id);
          if(up.length){
            block.push(`--- ${label} · próximos / recentes (cache) ---`);
            up.forEach(j=>block.push(`${j.data_iso||''} ${j.hora_brt||''} ${j.mandante} x ${j.visitante}${j.fase?' · '+j.fase:''}`));
          }
        }
        if(block.length)L.push(block.join('\n'));
      }catch{}
    }));
    // Seleções / amistosos / copas continentais (ex.: Argentina)
    const extraLines=[];
    await Promise.all(ESPN_EXTRA_SCOREBOARDS.map(async(path)=>{
      try{
        const live=await fetchEspnScoreboardPath(path);
        if(live&&live.length){
          live.forEach(m=>extraLines.push(`${m.date||''} [${m.status}${m.clock?' '+m.clock:''}] ${m.home} ${m.score} ${m.away} · ${path} · ${m.detail||''}`));
        }
      }catch{}
    }));
    if(extraLines.length){
      L.push('--- Seleções / copas / amistosos (ESPN scoreboard) ---\n'+extraLines.join('\n'));
    }
    return L.join('\n\n').trim();
  }catch(e){return '';}
}
