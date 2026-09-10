/**
 * Catálogo de competições + helpers puros de temporada/API.
 * ESM — importável; também exposto no globalThis para classic.
 */
import { expose } from '../expose.js';

export const COMP_ACTIVE_STORE = 'meridian_active_comp';
export const COMP_SCHED_STORE = 'meridian_sched_by_comp_v2';

export const COMPETITIONS = {
  brsa: {
    id: 'brsa',
    name: 'Brasileirão Série A',
    short: 'Série A',
    country: 'Brasil',
    calendar: 'year',
    kind: 'league',
    espn: 'bra.1',
    af: 71,
    fd: 'BSA',
    tsdb: 4351,
    // openfootball/football.json path stem (season prefix applied at fetch)
    openfootball: 'br.1',
    // Scorebat free feed: competition.name contains any of these (case-insensitive)
    // Scorebat competition.name (ex.: "BRAZIL: Serie A") — NÃO usar "serie a" sozinho (casa Itália)
    scorebat: ['brazil:', 'brasileir', 'brazil: serie'],
    // OpenLigaDB leagueShortcut — null when not in DE coverage
    openliga: null,
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/85.png',
    labelDefault: 'Brasileirão Série A',
  },
  libertadores: {
    id: 'libertadores',
    name: 'CONMEBOL Libertadores',
    short: 'Libertadores',
    country: 'CONMEBOL',
    calendar: 'year',
    kind: 'cup',
    espn: 'conmebol.libertadores',
    af: 13,
    fd: 'CLI',
    tsdb: null, // free TSDB key 123 has no stable Libertadores id
    openfootball: 'copa.l',
    scorebat: ['libertadores', 'conmebol'],
    openliga: null,
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/58.png',
    labelDefault: 'Libertadores',
  },
  epl: {
    id: 'epl',
    name: 'Premier League',
    short: 'EPL',
    country: 'Inglaterra',
    calendar: 'european',
    kind: 'league',
    espn: 'eng.1',
    af: 39,
    fd: 'PL',
    tsdb: 4328,
    openfootball: 'en.1',
    scorebat: ['premier league', 'england: premier'],
    openliga: null,
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
    labelDefault: 'Premier League',
  },
  laliga: {
    id: 'laliga',
    name: 'LaLiga',
    short: 'LaLiga',
    country: 'Espanha',
    calendar: 'european',
    kind: 'league',
    espn: 'esp.1',
    af: 140,
    fd: 'PD',
    tsdb: 4335,
    openfootball: 'es.1',
    scorebat: ['la liga', 'spain: la'],
    openliga: null,
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/15.png',
    labelDefault: 'LaLiga',
  },
  ucl: {
    id: 'ucl',
    name: 'UEFA Champions League',
    short: 'UCL',
    country: 'UEFA',
    calendar: 'european',
    kind: 'cup',
    espn: 'uefa.champions',
    af: 2,
    fd: 'CL',
    tsdb: 4480,
    openfootball: 'uefa.cl',
    scorebat: ['champions league', 'uefa champions'],
    openliga: null,
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
    labelDefault: 'Champions League',
  },
};

export const COMP_ORDER = ['brsa', 'libertadores', 'epl', 'laliga', 'ucl'];

/** Faixas de sanity-check anti-alucinação por competição. */
export const COMP_SANITY = {
  brsa: {
    kind: 'league',
    teams: 20,
    leagueGames: 38,
    maxPlayerLeagueGames: 38,
    maxPlayerAllComps: 55,
    goalsTopMin: 10,
    goalsTopMax: 25,
    goalsAbsurd: 40,
    format: 'pontos corridos · 20 clubes · 38 rodadas (turno e returno)',
    extraTimeDefault: false,
  },
  epl: {
    kind: 'league',
    teams: 20,
    leagueGames: 38,
    maxPlayerLeagueGames: 38,
    maxPlayerAllComps: 55,
    goalsTopMin: 10,
    goalsTopMax: 25,
    goalsAbsurd: 40,
    format: 'pontos corridos · 20 clubes · 38 rodadas',
    extraTimeDefault: false,
  },
  laliga: {
    kind: 'league',
    teams: 20,
    leagueGames: 38,
    maxPlayerLeagueGames: 38,
    maxPlayerAllComps: 55,
    goalsTopMin: 10,
    goalsTopMax: 30,
    goalsAbsurd: 45,
    format: 'pontos corridos · 20 clubes · 38 rodadas',
    extraTimeDefault: false,
  },
  libertadores: {
    kind: 'cup',
    teams: null,
    leagueGames: null,
    maxPlayerCompGames: 17,
    maxPlayerAllComps: 60,
    goalsTopMin: 5,
    goalsTopMax: 15,
    goalsAbsurd: 25,
    format: 'grupos + mata-mata (ida/volta em várias fases) · ~6–17 jogos por clube no torneio',
    extraTimeDefault: true,
  },
  ucl: {
    kind: 'cup',
    teams: null,
    leagueGames: null,
    maxPlayerCompGames: 17,
    maxPlayerAllComps: 60,
    goalsTopMin: 5,
    goalsTopMax: 15,
    goalsAbsurd: 25,
    format: 'fase liga/grupos + mata-mata · ~6–17 jogos por clube na UCL da temporada',
    extraTimeDefault: true,
  },
};

function activeId() {
  return globalThis._activeCompId || 'brsa';
}

export function getComp(id) {
  return COMPETITIONS[id || activeId()] || COMPETITIONS.brsa;
}

export function compSanity(id) {
  return COMP_SANITY[id || activeId()] || COMP_SANITY.brsa;
}

export function compLabel(id) {
  const c = getComp(id);
  return c.labelDefault || c.name;
}

export function espnBase(id) {
  return 'https://site.api.espn.com/apis/site/v2/sports/soccer/' + getComp(id).espn;
}

export function espnStandingsUrl(id) {
  return 'https://site.api.espn.com/apis/v2/sports/soccer/' + getComp(id).espn + '/standings';
}

export function afLeague(id) {
  return getComp(id).af;
}

export function fdCode(id) {
  return getComp(id).fd;
}

export function tsdbLeague(id) {
  const v = getComp(id).tsdb;
  return v != null ? v : null;
}

export function openfootballStem(id) {
  return getComp(id).openfootball || null;
}

export function scorebatKeys(id) {
  const k = getComp(id).scorebat;
  return Array.isArray(k) ? k : [];
}

export function openligaShortcut(id) {
  return getComp(id).openliga || null;
}

export function seasonYearCalendar(d) {
  d = d || new Date();
  return d.getFullYear();
}

export function seasonYearEuropean(d) {
  d = d || new Date();
  const y = d.getFullYear(),
    m = d.getMonth() + 1;
  return m >= 8 ? y : y - 1;
}

export function seasonYearFor(id, d) {
  const c = getComp(id);
  return c.calendar === 'european' ? seasonYearEuropean(d) : seasonYearCalendar(d);
}

export function compSeasonLabel(id, d) {
  const c = getComp(id);
  if (c.calendar === 'european') {
    const y = seasonYearEuropean(d);
    return y + '/' + String(y + 1).slice(-2);
  }
  return String(seasonYearCalendar(d));
}

export function afSeason(id) {
  return seasonYearFor(id);
}

export function readStoredActiveCompId() {
  try {
    const v = localStorage.getItem(COMP_ACTIVE_STORE);
    return v && COMPETITIONS[v] ? v : 'brsa';
  } catch {
    return 'brsa';
  }
}

expose({
  COMPETITIONS,
  COMP_ORDER,
  COMP_SANITY,
  COMP_ACTIVE_STORE,
  COMP_SCHED_STORE,
  getComp,
  compSanity,
  compLabel,
  espnBase,
  espnStandingsUrl,
  afLeague,
  fdCode,
  tsdbLeague,
  openfootballStem,
  scorebatKeys,
  openligaShortcut,
  seasonYearCalendar,
  seasonYearEuropean,
  seasonYearFor,
  compSeasonLabel,
  afSeason,
});
