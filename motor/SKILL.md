# SKILL — Motor Meridian de Análise de Futebol

**O que é:** motor headless de análise pré/pós-jogo de futebol multi-liga (Brasileirão, Libertadores, Premier League, LaLiga, Champions) **+ chat calibrado do usuário final**. Pipeline em duas fases com portões anti-alucinação por código; o chat usa a mesma persona e as mesmas fontes verificadas. Roda em **Node** (o `engine.mjs` carrega os módulos com `node:vm` + `node:fs`), sem UI própria — o integrador constrói a apresentação.

**O que NÃO é:** não inclui frontend, proxy/Worker, hosting nem chave de API. A chave Anthropic é sempre do integrador/usuário final.

---

## Requisitos e instalação

- **Node 18+** (ou runtime que implemente as builtins `node:*`). **Não roda em browser**:
  o `engine.mjs` usa `node:vm` e `node:fs` para carregar os módulos de domínio. Para uma
  UI web, exponha o motor atrás de um endpoint seu.
- **Zero dependências externas** — só builtins (`node:fs`, `node:path`, `node:vm`, `node:url`).
  Não há `package.json` no pacote; `engine.mjs` é ESM pela extensão `.mjs`, então funciona
  tanto em projeto ESM quanto CommonJS (via `await import()`).
- **A estrutura de pastas é obrigatória.** O engine resolve os módulos como
  `__dirname/../js/…`, ou seja **`motor/` e `js/` precisam ser irmãos**. Copiar só o
  `engine.mjs` para dentro do seu projeto quebra o carregamento. Descompacte o pacote
  inteiro numa pasta e importe de lá.

## Arquitetura (o valor está aqui)

```
query ancorada ("PARTIDA: A x B")
  │
  ├─ FASE 1 — coleta estruturada (Haiku + web_search)
  │    · cascata de fontes: API-Football → football-data → ESPN (a ESPN é o último
  │      recurso e nunca é desligada, para a coleta nunca ficar sem chão)
  │    · cobertura A/B/C declarada (o modelo sabe o que tem e o que falta)
  │    · structured outputs quando a API aceita; se ela recusar (400), o mesmo
  │      run cai para o caminho por prompt-contrato, sem quebrar
  │    · memória local de fatos por time (não re-paga o que já coletou)
  │
  ├─ PORTÕES (código, não prompt)
  │    · fillDataGaps: xG, escanteios/jogo, placar exato dos últimos 5, tabela,
  │      stats de titulares, escalação completa (11+banco+técnico) — 1 passagem
  │      barata dirigida SÓ ao que faltou; custo zero se a coleta veio completa
  │    · verifyLineupNames: cada nome da escalação cruzado com busca fresca —
  │      jogador comprovadamente fora do elenco é REMOVIDO antes da Fase 2
  │
  ├─ FASE 2 — análise (modelo escolhido, sem tools quando a coleta bastou)
  │    · JSON por prompt-contrato + parseAnalysisJson (fences + repair de truncado)
  │    · escada de recuperação: retry de forma → resgate em Opus 4.8 (o resgate
  │      não é configurável — ver "Modelos e custo")
  │    · prefill '{' só nos modelos que o aceitam; nos que recusam, o run se ajusta
  │
  └─ NORMALIZAÇÃO
       · proveniência de escalação por time: api > pesquisa > modelo > inferida
       · pads determinísticos de eventos; lambdas p/ Poisson (cálculo local)
       · lacunas DECLARADAS no resultado — o motor diz o que não sabe
```

## Como o motor raciocina

O diagrama acima mostra as etapas. Esta seção explica **o que cada uma decide** — é o
que responde "de onde saiu esse número" quando alguém perguntar.

### O recorte de dados é fixo e conhecido

Toda análise parte do mesmo formulário de fatos, não de uma coleta livre. Para cada time:

- os **últimos 5 jogos com placar exato e mando** (não apenas "V-V-D": forma qualitativa
  sem placar é tratada como lacuna e dispara uma busca dirigida);
- agregados da temporada: xG marcado e sofrido, escanteios por jogo e sofridos;
- posição e contexto na tabela ou na fase da competição;
- técnico, formação, escalação provável, banco e desfalques;
- por jogador de destaque, cerca de 15 estatísticas: jogos, minutos, gols, assistências,
  finalizações por jogo, finalizações no gol, grandes chances, cartões amarelos e
  vermelhos, se está a um amarelo da suspensão, faltas cometidas e sofridas, desarmes,
  se cobra pênaltis ou faltas, e rating médio.

O que não foi encontrado **não vira silêncio**: entra em `lacunas` na resposta, e a
`confianca_geral` cai junto. Uma análise mal servida de dados se declara como tal — é
por isso que `lacunas` e `_lineupsFonte` juntos dizem a verdade sobre a qualidade de
uma análise específica.

### Onde entra cada tipo de informação

Os fatos estruturados acima e o material textual encontrado na busca (notícia de lesão,
declaração de técnico, contexto de rodada) chegam **juntos** ao passo de análise, e são
ponderados ali, de uma vez, ao escrever os lambdas, os fundamentos e a leitura tática.

O que o motor garante nesse passo não é um peso fixo por tipo de informação — é o
**rastro**:

- toda probabilidade vem acompanhada de `fundamento`, e o fundamento cita o dado;
- toda cifra **estimada** tem de declarar o proxy de onde saiu (ex.: "xG estimado por
  finalizações e grandes chances"), e o rótulo se repete em cada evento que a usa;
- campo numérico de xG é reservado a **valor medido de fonte**; estimativa vive nos
  lambdas e no racional, nunca no campo, para não ser lida depois como medição.

### Escalação: proveniência, com selo

A escalação entregue carrega **de onde ela veio**, da fonte mais confiável para a menos:

| Selo | Origem |
|---|---|
| `api` | provedor de dados |
| `pesquisa` | escalação provável publicada, encontrada na coleta |
| `modelo` | onze montado a partir do elenco e do contexto |
| `inferida` | apenas geometria de campo, quando não há nada melhor |

O selo por time fica em `_lineupsFonte`. Uma formação de origem `modelo` nunca é
apresentada como confirmada, e o motor não espelha a mesma formação nos dois times sem
lastro próprio de cada um.

Antes da análise, cada nome do onze é **cruzado com busca fresca**: jogador
comprovadamente fora do elenco é removido, o que evita o erro clássico de escalar quem
foi vendido, está lesionado ou suspenso. E um mesmo jogador nunca aparece ao mesmo tempo
entre os desfalques e no onze — quando a coleta traz o conflito, ele é resolvido e o
resíduo vira item de incerteza declarada.

### O que separa uma sugestão factível de uma absurda

Essa fronteira **não é julgamento em linguagem natural — é código**, aplicado depois que
o modelo responde e antes de a análise ser entregue, sempre na mesma ordem:

1. xG implausível (fora de 0–4, ou zero) vira "sem dado" — zero seria lido como medição;
2. **mercados de gols são recalculados por Poisson** a partir dos lambdas declarados; se
   o texto trouxe 85% onde a distribuição dá 57%, o valor entregue é 57%, com a correção
   anotada no fundamento;
3. dupla chance é reconciliada com seus componentes (1X tem de bater com vitória + empate);
4. a confiança é rebaixada quando falta o dado que sustentaria aquele mercado — mercado
   sem lastro coletado não recebe confiança alta, por melhor que soe o argumento;
5. mercado quase certo (probabilidade ≥ 0,80 ou estrutura trivial, tipo "ao menos um")
   é marcado com `_obvio`, para a interface rotulá-lo como âncora de odd baixa em vez de
   vendê-lo como o achado da análise;
6. em prévia, nenhum texto pode afirmar que a partida analisada já aconteceu.

Há ainda faixas de plausibilidade travadas na verificação final: xG entre 0 e 4, rating
entre 4 e 10, probabilidade entre 1% e 95%, e no máximo cerca de 45 jogos de liga por
jogador na temporada.

O princípio que amarra tudo: **o modelo estima parâmetros; o código calcula
probabilidade.** Quando os dois discordam sobre aritmética, o código vence.

### A ordem das etapas, e o que cada uma custa

1. **Coleta** — modelo rápido com busca, preenche o formulário de fatos e declara a
   própria cobertura (o que conseguiu, o que faltou).
2. **Portões** — passagem barata dirigida **só ao que faltou**; se a coleta veio completa,
   não custa nada. É aqui que os nomes da escalação são verificados.
3. **Análise** — o modelo escolhido recebe os fatos e produz, **em uma passagem**, a
   análise inteira: lambdas com racional declarado, mercados, leitura tática, tendências,
   incertezas e lacunas.
4. **Normalização** — as verificações determinísticas acima, na ordem descrita.
5. **Auditoria** — um verificador independente relê a análise pronta procurando
   incoerência objetiva; o que sobrevive entra como incerteza declarada no resultado.

A ponderação do jogo acontece na etapa 3, de uma vez. O que é encadeado e verificável
são as **garantias** em volta dela: cobertura declarada na 1, lacuna dirigida na 2,
aritmética e plausibilidade travadas na 4, revisão adversarial na 5.

**Como a Fase 2 é chamada, e por quê:** o relatório é pedido por prompt-contrato e
lido com `parseAnalysisJson`, **sem extended thinking** — raciocínio estendido junto
com saída JSON longa derruba a taxa de parse, então o motor o mantém desligado
explicitamente nos modelos que o ligariam por padrão. Prefill de assistant (`{`) é
usado só nos modelos que o aceitam; as famílias Sonnet/Opus atuais respondem 400 e o
motor já contorna. **Ao trocar o modelo da Fase 2, verifique esses dois pontos no
modelo novo** — o comportamento padrão de thinking muda entre gerações, e um modelo
que liga thinking sozinho quebra o parse do relatório.

## INPUT — contrato de entrada

```js
import { createEngine } from './motor/engine.mjs';

const engine = await createEngine({
  apiKey: 'sk-ant-…',        // OBRIGATÓRIA (ou workerUrl com secret ANTHROPIC_KEY)
  workerUrl: '',             // opcional: proxy próprio p/ guardar a chave fora do cliente
  model: 'claude-sonnet-5',  // modelo da Fase 2 e do chat — NÃO é o único que roda (ver "Modelos e custo")
  competition: 'brsa',       // ids EXATOS: brsa | libertadores | epl | laliga | ucl
  searches: 2,               // teto de buscas da Fase 1 (1–3)
  dataKeys: { af: '', fd: '' }, // opcionais: API-Football / football-data (melhora a camada A)
  storage: null,             // {getItem,setItem,removeItem} — default: memória do processo
  onProgress: (u) => {},     // {status, phase: 1|2, inTokens, outTokens} — streaming de progresso
  log: (msg) => {},          // avisos não-fatais
});
// engine.version → versão do motor (ver motor/CHANGELOG.md)
```

**ID DE COMPETIÇÃO É EXATO — id desconhecido vira Brasileirão, sem erro.** `getComp()`
resolve `COMPETITIONS[id] || COMPETITIONS.brsa`, então um id inválido (`'premier'`,
`'championsleague'`) NÃO lança exceção: a análise sai inteira, mas com o endpoint, o
rótulo, as regras de ticket e a tabela do **Brasileirão**. Premier League é **`epl`**.
Desde a 1.0.1 o motor avisa pelo `log` quando recebe um id fora da lista — trate esse
aviso como erro de integração.

**UMA INSTÂNCIA POR PROCESSO.** `createEngine()` carrega os módulos de domínio num
contexto compartilhado; uma segunda chamada no mesmo processo falha com
`SyntaxError: Identifier '…' has already been declared`. Crie o motor uma vez e
reutilize — para trocar de campeonato use `engine.setCompetition(id)`, não um novo
motor. Em servidor, guarde a instância em módulo/singleton; para paralelismo real,
use processos separados.

```js

const { analysis, rawFacts, usage } =
  await engine.analyzeMatch('PARTIDA: Flamengo x Palmeiras', { signal });

// ── Chat do usuário final (mesma persona/calibração da análise) ──
const reply = await engine.chat('Flamengo x Palmeiras: qual mercado tem melhor valor?', {
  signal,
  history: [],               // turnos anteriores {role:'user'|'assistant', content}
  context: {                 // opcional — o host injeta o que tiver:
    placaresVerificados: '', //   bloco "=== PLACARES VERIFICADOS ===" (autoridade máxima de placar)
    scoreboard: '',          //   jogos do dia (desambiguação); sem ele o motor consulta a ESPN sozinho
    attachmentsNote: '',     //   resumo de anexo processado pelo host
  },
});
// reply.type === 'text'         → { text, usage }
// reply.type === 'need_context' → { question, reason } — pergunta vaga sem âncora
//   ('vague_query': NENHUM token foi gasto) ou resposta que pressupôs partida
//   ('presupposed_match'), ou mensagem vazia ('empty'). O host pergunta ao
//   usuário e chama chat() de novo.

// ── Roteamento de intenção ──
engine.routeIntent(userMessage, { hasAttachments: false })
// → { mode:'analysis'|'chat'|'need_teams', reason }
// hasAttachments:true FORÇA 'chat' — anexo nunca dispara o relatório, por construção.
// Padrão de uso: routeIntent decide; 'analysis' → analyzeMatch; 'chat' → chat;
// 'need_teams' → peça os times ao usuário antes de qualquer chamada.
```

**Regras de entrada:**
- A query deve estar **ancorada** (dois times definidos). O prefixo `PARTIDA:` declara isso. Resolver ambiguidade ("o jogo de hoje") é responsabilidade do integrador — o motor não adivinha partida (princípio: zero suposição).
- Pós-jogo: incluir `[Contexto confirmado: pós-jogo]` na query → o motor verifica o placar oficial via busca ANTES da análise (placar nunca é inferido pelo modelo).
- `signal` (AbortController) cancela no meio de qualquer fase.

## Modelos e custo (leia antes de estimar preço)

O `model` da config controla **só a Fase 2 e o chat**. O motor chama outros modelos
por conta própria, e todos entram na sua fatura:

| Etapa | Modelo | Configurável? |
|---|---|---|
| Fase 1 (coleta), `fillDataGaps`, `verifyLineupNames`, verificação da análise, resolução de agenda/placar | **Haiku 4.5** | não |
| Fase 2 (o relatório) e `chat()` | o `model` que você passar | sim |
| Resgate — só quando a Fase 2 insiste em responder em prosa; caminho raro | **Opus 4.8** | não |

Os modelos fixos estão hardcoded no pacote (`js/analysis/pipeline-facts.js`,
`js/analysis/pipeline-run.js`, `js/data/schedule.js`); se a sua política de custo
exigir outros, é ali que se troca — e o `tests/motor.mjs` deve continuar passando.

Outros fatores: `searches` (1–3) multiplica as buscas da Fase 1, que é a etapa com
mais chamadas; o `web_search` da Anthropic é cobrado por busca, à parte dos tokens.
Use o `usage` devolvido por `analyzeMatch`/`chat` para medir de verdade em vez de
estimar.

## OUTPUT — contrato de saída

`analysis` = JSON estruturado com os campos:

| Campo | Conteúdo |
|---|---|
| `contexto_analise` | `previa` \| `pos_jogo` |
| `partida`, `fase`, `data_hora`, `sede`, `contexto_fase` | identificação |
| `confianca_geral` | `alto` \| `medio` \| `baixo` — honesto, função da cobertura |
| `mandante`/`visitante` | nome, forma, xG marcado/sofrido, desfalques, escalação+status, jogadores-chave |
| `tecnico_mandante`/`tecnico_visitante` | formação, filosofia, ajustes, impacto em mercados |
| `lambda` | gols esperados (low/mid/high por lado + racional) — insumo p/ Poisson local |
| `eventos_provaveis` | eventos com probabilidade E fundamento (cada item traz `mercado` e pode trazer `_obvio` — ver abaixo) |
| `sugestoes_ticket` | sugestões com probabilidade, fundamento e confiança (idem `mercado` / `_obvio`) |
| `confronto_tatico` | ataque×defesa dos dois lados, duelos-chave, conclusão |
| `cartoes_faltas`, `escanteios` | mercados secundários com a mesma estrutura |
| `tendencias`, `fatores_decisivos`, `incerteza` | leitura qualitativa |
| `lacunas` | **o que o motor NÃO conseguiu apurar** — sempre declarado |
| `…[].mercado` | descritor estruturado do mercado: `{tipo, time, linha, direcao, negacao, periodo}`. `tipo` ∈ `total_gols`, `gols_time`, `ambas_marcam`, `resultado`, `escanteios`, `cartoes`, `jogador`, `outro`. É dele que o código recalcula a probabilidade por Poisson |
| `…[]._obvio` | `true` = **mercado-âncora** (probabilidade ≥0,80 ou estrutura trivial tipo "ao menos 1"). Rotule na UI como âncora de odd baixa — **não** apresente como o diferencial da análise |
| `_lineups`, `_lineupsFonte` | escalações derivadas + proveniência (`api`>`pesquisa`>`modelo`>`inferida`) |
| `_coletaOk` | a Fase 1 trouxe fatos? (false = análise direta, confiança menor) |

`rawFacts` = fatos brutos da Fase 1 (auditável). `usage` = tokens por fase.

**Garantias:** todo número de probabilidade vem com fundamento; escalação sem fonte é
rotulada, nunca vendida como confirmada; falha na **coleta** degrada em vez de quebrar
(a análise sai com `_coletaOk:false` e as lacunas declaradas).

**O que LANÇA exceção (envolva em `try/catch`):** `createEngine()` sem `apiKey` nem
`workerUrl`; erro de API na Fase 2 que sobrevive ao retry; e
`"motor: a Fase 2 não devolveu JSON estruturado (após retry e resgate)"` quando a escada
de recuperação inteira falha. Abortar pelo `signal` também rejeita, com `AbortError` —
trate esse caso separadamente do erro real.

## Arquivos do pacote

- `motor/engine.mjs` — composição headless (este contrato)
- `js/analysis/` — prompts, pipeline F1/F2, normalização, escalação (menos `render.js`)
- `js/data/` — fontes, cascata, memória de fatos, cobertura, telemetria
- `js/lib/intent.js`, `js/comp/competitions.js`, `js/state.js`, `js/expose.js`, `js/runtime.js`
- `tests/motor.mjs` — prova de integração headless (`node tests/motor.mjs`)
- `motor/HANDOFF-ENGENHARIA.md` — arquitetura e regras de funcionamento

## Checklist de integração (self-service)

O pacote é entregue como arquivos e o caminho abaixo é autossuficiente — dá para integrar sem nenhum contato adicional:

1. `node tests/motor.mjs` → deve terminar em `MOTOR ALL PASSED` (sem chave nenhuma; tudo roda com stubs).
2. Rode `node motor/exemplo-integracao.mjs "PARTIDA: Time A x Time B"` com a sua chave via variável de ambiente `ANTHROPIC_KEY`, num jogo real da rodada → inspecione `analysis.lacunas` e `analysis._lineupsFonte` juntos (os dois dizem a verdade sobre a qualidade daquela análise).
3. Leia este SKILL.md por inteiro — é o contrato de uso (INPUT/OUTPUT/garantias).
4. Leia o `HANDOFF-ENGENHARIA.md` — em especial a seção 3 (regras de funcionamento que não devem ser violadas na manutenção).
