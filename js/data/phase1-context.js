/* js/data/phase1-context.js — orquestra coleta estruturada da Fase 1
 *
 * Camada A (campeonato): FD → ESPN → AF full só se nada mais (economiza free AF).
 * Camada B (time): AF coach+lineup mínimo (cache) quando há chave.
 * Free registry + memória em paralelo.
 * Anti-fantasma + score A/B/C de cobertura.
 */
const PHASE1_CTX_TOTAL = 16000;
const PHASE1_CTX_EACH = 5000;

/**
 * Camada A: tabela/jogos — CASCATA ADAPTATIVA (shell 85 / PARTE IX P0, espírito V1).
 * AF PRIMEIRO quando útil (afReady e temporada não bloqueada nesta sessão): é a única
 * fonte que traz técnico+lineup determinísticos no mesmo caminho (afEnrichCoachLineup).
 * Se o Free bloquear a temporada, fetchAf marca afSeasonBlocked[comp] e as próximas
 * análises da sessão nem tentam — caem direto em FD → ESPN (rede de segurança imutável).
 * A camada B (afEnrichCoachLineupMinimal + _afCoachOnlyFallback) SEMPRE roda quando a
 * cascata não foi AF full — o técnico via /teams+/coachs não tem trava de temporada.
 */
async function _phase1CascadeLayerA(query) {
  let fdCtx = '';
  let source = '';
  let fixturesForEnrich = null;

  // 1) AF full primeiro (V1-style) — só se pronta E temporada não marcada como bloqueada
  try {
    const _afOk = typeof afReady === 'function' ? afReady() : typeof getAfKey === 'function' && getAfKey();
    const _blocked = typeof afSeasonBlocked === 'function' ? afSeasonBlocked() : false;
    if (_afOk && !_blocked) {
      const [standings, fixtures] = await Promise.all([getAfStandings(), getAfFixtures()]);
      fixturesForEnrich = fixtures;
      fdCtx = formatAfContext(standings, fixtures);
      if (fdCtx && typeof afEnrichCoachLineup === 'function') {
        fdCtx += await afEnrichCoachLineup(query, fixtures);
      }
      if (fdCtx) source = 'af';
      // vazio (Free bloqueou / sem dados): fetchAf já marcou afSeasonBlocked — NÃO
      // silenciar: segue para FD/ESPN e a camada B ainda tenta o coach-only fallback.
    }
  } catch {}

  // 2) football-data.org free (chave local OU secret no Worker) — limpo, free forever
  try {
    if (!fdCtx && (typeof fdReady === 'function' ? fdReady() : typeof getFdKey === 'function' && getFdKey())) {
      const [standings, matches] = await Promise.all([getFdStandings(), getFdMatches()]);
      fdCtx = formatFdContext(standings, matches);
      if (fdCtx) source = 'fd';
    }
  } catch {}

  // 3) ESPN — rede de segurança multi-liga, sem chave (NUNCA deixa de ser fallback)
  try {
    if (!fdCtx && typeof getEspnStandings === 'function') {
      const [standings, scoreboard] = await Promise.all([
        getEspnStandings(),
        getEspnScoreboard(),
      ]);
      fdCtx = formatEspnContext(standings, scoreboard);
      if (fdCtx) source = 'espn';
    }
  } catch {}

  const text = fdCtx || '';
  return {
    text,
    source,
    fixturesForEnrich,
    benefits:
      text && typeof detectSourceBenefits === 'function'
        ? detectSourceBenefits(text)
        : text
          ? ['contexto estruturado']
          : [],
  };
}

/**
 * Camada B mínima: AF coaches (+ lineup perto do jogo).
 * Só se há chave AF e a cascata A NÃO foi AF full (já enriqueceu).
 */
async function _phase1AfLayerB(query, cascadeSource) {
  const _ok = typeof afReady === 'function' ? afReady() : typeof getAfKey === 'function' && getAfKey();
  if (!_ok) {
    return { text: '', meta: { coaches: false, lineups: false, matched: false } };
  }
  // se cascata já foi AF, enrich já entrou em formatAfContext path
  if (cascadeSource === 'af') {
    return { text: '', meta: { coaches: false, lineups: false, matched: false, skipped: 'already_in_cascade' } };
  }
  if (typeof afEnrichCoachLineupMinimal !== 'function') {
    return { text: '', meta: { coaches: false, lineups: false, matched: false } };
  }
  try {
    return await afEnrichCoachLineupMinimal(query);
  } catch {
    return { text: '', meta: { coaches: false, lineups: false, matched: false } };
  }
}

/**
 * Coleta completa de contexto estruturado p/ Fase 1.
 */
async function collectPhase1Context(compId, query) {
  const id = compId || (typeof _activeCompId !== 'undefined' ? _activeCompId : 'brsa');
  const teams =
    typeof parseMatchTeamsFromQuery === 'function' ? parseMatchTeamsFromQuery(query) : [];

  const freeP =
    typeof getFreeSourcesBundle === 'function'
      ? getFreeSourcesBundle(id, teams, query).catch(() => ({ text: '', active: [], silent: [] }))
      : Promise.resolve({ text: '', active: [], silent: [] });

  // AF layer B em paralelo com free (depois da cascade A sequencial — precisa saber source)
  const cascade = await _phase1CascadeLayerA(query);
  const afBP = _phase1AfLayerB(query, cascade.source);

  let freeBundle = { text: '', active: [], silent: [] };
  try {
    freeBundle = (await freeP) || freeBundle;
  } catch {
    freeBundle = { text: '', active: [], silent: [] };
  }

  let afB = { text: '', meta: {} };
  try {
    afB = (await afBP) || afB;
  } catch {
    afB = { text: '', meta: {} };
  }

  // apiText = A + free + B (AF coach) — sem memória
  const apiParts = [cascade.text, freeBundle.text, afB.text].filter(
    (t) => t && String(t).trim()
  );
  const apiText =
    typeof joinContextBlocks === 'function'
      ? joinContextBlocks(apiParts, {
          maxTotal: PHASE1_CTX_TOTAL - 2800,
          maxEach: PHASE1_CTX_EACH,
        })
      : apiParts.join('\n\n');

  try {
    if (apiText && typeof factsMemIngestStructured === 'function') {
      factsMemIngestStructured(id, apiText);
    }
  } catch {}

  let memoryText = '';
  try {
    if (typeof factsMemBuildKnownBlock === 'function') {
      memoryText = factsMemBuildKnownBlock(id, teams) || '';
    }
  } catch {
    memoryText = '';
  }

  const active = [];
  if (cascade.text && cascade.source) {
    active.push({
      id: cascade.source,
      text: cascade.text,
      chars: cascade.text.length,
      benefits: cascade.benefits || [],
    });
  }
  (freeBundle.active || []).forEach((a) => {
    if (a && a.chars > 0) active.push(a);
  });
  if (afB.text && String(afB.text).trim()) {
    active.push({
      id: 'af_b',
      text: afB.text,
      chars: afB.text.length,
      benefits:
        typeof detectSourceBenefits === 'function'
          ? detectSourceBenefits(afB.text)
          : ['técnico API'],
    });
  }
  if (memoryText && memoryText.trim()) {
    active.push({
      id: 'memory',
      text: memoryText,
      chars: memoryText.length,
      benefits:
        typeof detectSourceBenefits === 'function'
          ? detectSourceBenefits(memoryText)
          : ['cache local'],
    });
  }

  // Se cascade foi AF full, detectar coaches no texto para meta B
  let afMeta = afB.meta || {};
  if (cascade.source === 'af' && cascade.text) {
    afMeta = {
      coaches: /TÉCNICOS ATUAIS/i.test(cascade.text),
      lineups: /ESCALAÇÕES CONFIRMADAS/i.test(cascade.text),
      matched: true,
      fromCascade: true,
    };
  }

  const coverage =
    typeof computeCoverageScore === 'function'
      ? computeCoverageScore({
          active,
          apiText,
          memoryText,
          afMeta,
          afText: afB.text || '',
        })
      : null;

  const agentLine =
    typeof buildAgentSourceLine === 'function' ? buildAgentSourceLine(active) : '';
  const covBlock = (coverage && coverage.agentBlock) || '';

  const bodyParts = [agentLine, covBlock, apiText, memoryText].filter(
    (t) => t && String(t).trim()
  );
  const fdCtx =
    typeof joinContextBlocks === 'function'
      ? joinContextBlocks(bodyParts, {
          maxTotal: PHASE1_CTX_TOTAL,
          maxEach: PHASE1_CTX_EACH,
        })
      : bodyParts.join('\n\n');

  const hasFd = !!(cascade.text || freeBundle.text || afB.text);

  const statusParts = [];
  if (typeof formatSourcesStatusHuman === 'function') {
    const s = formatSourcesStatusHuman(active);
    if (s) statusParts.push(s);
  }
  if (coverage && coverage.summaryHuman) statusParts.push(coverage.summaryHuman);

  const telemetry =
    typeof recordPhase1Telemetry === 'function'
      ? recordPhase1Telemetry({
          compId: id,
          cascade: cascade.source || null,
          active,
          silent: freeBundle.silent || [],
          freeChars: (freeBundle.text || '').length,
          apiChars: (apiText || '').length,
          memoryChars: (memoryText || '').length,
          teams,
          agentLine,
          apiText,
          memoryText,
          afMeta,
          afText: afB.text || '',
          coverage,
        })
      : { active, silent: freeBundle.silent || [], cascade: cascade.source || null, coverage };

  return {
    apiText,
    memoryText,
    fdCtx,
    hasFd,
    teams,
    agentLine,
    coverage,
    sources: telemetry,
    statusHuman: statusParts.join(' · ') || '',
  };
}

function phase1FilterTopics(topics, compId, hasStructured, teams) {
  let out = { topics: topics || [], skippedDims: [] };
  try {
    if (typeof factsMemFilterTopics === 'function') {
      const f = factsMemFilterTopics(topics, compId, hasStructured, teams);
      if (f && Array.isArray(f.topics) && f.topics.length) out = f;
    }
  } catch {}
  let skipNote = '';
  if (out.skippedDims && out.skippedDims.length) {
    skipNote =
      '\nECONOMIA DE BUSCA (memória local fresca p/ os times deste jogo): dimensões não re-buscadas: ' +
      out.skippedDims.join(', ') +
      '. Use REPERTOIRE / COBERTURA / DADOS DA API; só busque o que a cobertura marcar como BAIXA.\n';
  }
  return {
    topics: out.topics || topics || [],
    skipNote,
    skippedDims: out.skippedDims || [],
  };
}
