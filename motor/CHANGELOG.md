# Changelog — Motor Meridian

Como saber qual versão você tem:

```js
import { MOTOR_VERSION } from './motor/engine.mjs';
console.log(MOTOR_VERSION);            // "1.0.2"
// ou, em runtime:
const engine = await createEngine({ apiKey });
console.log(engine.version);
```

A versão também aparece no cabeçalho do `motor/MANIFEST.txt` do seu pacote.

**Leia antes de atualizar:** correções marcadas com ⚠ **alteram probabilidades
exibidas ao usuário final**. Se você compara saídas entre versões (testes de
regressão, snapshots), espere diferenças legítimas nesses mercados — os números
antigos estavam errados.

---

## 1.0.2 — 2026-09-10

Só documentação e empacotamento — **nenhuma mudança de comportamento do motor**.

### O contrato agora diz quais modelos você paga

O `model` da configuração controla **só a Fase 2 e o chat**. O motor sempre chamou
outros modelos por conta própria — **Haiku 4.5** na coleta, nos portões, nas
verificações e na resolução de agenda/placar, e **Opus 4.8** no resgate raro da
Fase 2 — e isso não estava escrito em lugar nenhum. Quem estimasse custo pelo
`model` configurado subestimava a conta. Agora existe a seção **"Modelos e custo"**
no `SKILL.md`, com a tabela por etapa e os arquivos onde os modelos fixos estão,
para quem precisar trocá-los.

### Contrato reescrito para quem está de fora

`SKILL.md` e `HANDOFF-ENGENHARIA.md` foram limpos de vocabulário e de história que
só faziam sentido para quem construiu o motor. Em especial saiu um parágrafo que
mandava **não re-testar** um limite de gramática de structured outputs: aquele limite
foi observado num acesso de API específico e não é necessariamente o seu. No lugar
entrou a regra que de fato importa ao trocar o modelo da Fase 2 — **verifique o
comportamento padrão de thinking do modelo novo**, porque um modelo que liga
raciocínio estendido sozinho derruba o parse do relatório.

### Nova seção: como o motor raciocina

O contrato descrevia as etapas, mas não o que cada uma DECIDE — e é isso que se precisa
saber para defender um número diante de quem pergunta "de onde saiu isso?". A seção nova
cobre: o recorte exato de dados da coleta (últimos 5 jogos com placar, agregados de
temporada, estatísticas por jogador) e o que acontece com o que falta; onde entra cada
tipo de informação e qual rastro é obrigatório em cada número; a cadeia de proveniência
da escalação, com o selo por time; a lista ordenada das verificações determinísticas que
separam uma sugestão factível de uma absurda; e a ordem das etapas com o custo de cada
uma.

### Requisitos que faltavam no contrato

O contrato dizia que o motor "roda em Node ou browser" — **não roda em browser**: o
`engine.mjs` usa `node:vm` e `node:fs` para carregar os módulos. Quem planejasse uma
integração web descobriria isso no primeiro `import`. Agora há a seção **"Requisitos e
instalação"**, que também documenta o que faltava: **Node 18+**, **zero dependências
externas**, ausência de `package.json` e — o detalhe que mais quebra na primeira
tentativa — **`motor/` e `js/` precisam ser pastas irmãs**, porque o engine resolve os
módulos como `__dirname/../js/…`.

E as **Garantias** diziam que falha "não quebra". Vale para a coleta; **a Fase 2 lança
exceção** em três casos, agora listados, para o integrador saber onde pôr `try/catch`.

### A suíte do pacote agora passa (antes, não passava)

Se você recebeu uma versão anterior, o passo 1 do checklist —
`node tests/motor.mjs` — **não terminava em `MOTOR ALL PASSED`**, por dois motivos que
só apareciam rodando a partir do pacote:

- a suíte lia `tools/package-motor.mjs`, que **não faz parte da entrega**, e abortava com
  `ENOENT`. Esses asserts existem para validar a nossa ferramenta de build; agora só rodam
  quando o arquivo está presente;
- o passo de sanitização reescrevia **código**, não só texto, e substituiu um dos termos
  proibidos pelo seu substituto neutro **dentro da lista de termos proibidos do próprio
  teste** — e como esse substituto aparece o tempo todo neste changelog (ele é escrito
  para você), o assert passou a reprovar sempre. A sanitização
  passou a valer só para `.md`/`.txt`; o código entregue é o código-fonte, sem reescrita.

A partir desta versão o build **roda a suíte com os arquivos do pacote** antes de gerar o
zip e **falha** se ela não passar — o que você roda é o que foi verificado.

### Comentários do código sem numeração de processo

Os comentários explicam POR QUE o código é como é — isso vale para quem mantém o motor e
continua no pacote. O que saiu foi a numeração do nosso processo de desenvolvimento
(referências a números internos de iteração), que não diz nada a quem está de fora. O corte é feito
no empacotamento, é ciente de sintaxe e só toca COMENTÁRIO: strings, templates e regex
ficam intactos — há pontos no código onde essa mesma palavra aparece em texto de prompt,
em um regex e no rodapé de diagnóstico, e mexer ali mudaria comportamento. Depois do
corte o build roda `node --check` em cada arquivo e a suíte completa; qualquer uma das
duas falhando aborta o pacote.

### O zip extrai corretamente fora do Windows

As entradas do pacote eram gravadas com barra invertida como separador de caminho. A
especificação ZIP exige barra normal, e a diferença tem efeito prático: o `unzip` do
Linux avisa e se recupera, mas o `zipfile` do Python, o Archive Utility do macOS e várias
bibliotecas de Node criam arquivos planos com a barra no nome, em vez da árvore de
pastas. Como o motor exige que `motor/` e `js/` sejam pastas irmãs, o pacote simplesmente
não carregaria. Os nomes agora saem conforme a especificação — e se você extraiu uma
versão anterior num Mac ou Linux e viu arquivos com nomes estranhos, era isto.

### Contrato de engenharia alinhado ao contrato de uso

O `HANDOFF-ENGENHARIA.md` ainda mantinha um parágrafo que já havia saído do `SKILL.md`:
a história de um limite de gramática observado num acesso de API específico, com a
instrução de não voltar a testar aquilo. No lugar entrou a regra que serve a você — ao
trocar o modelo da Fase 2, verificar o comportamento padrão de thinking do modelo novo,
porque ele muda entre gerações e um modelo que liga raciocínio sozinho derruba o parse do
relatório.

O documento também passou a descrever o que o motor faz hoje: a sequência determinística
completa da normalização (a que separa uma sugestão factível de uma absurda), o escopo do
recálculo por Poisson (dirigido pelo descritor de mercado; mercado por time usa a linha;
mercado de período fica com o modelo), o aviso de que um id de liga desconhecido cai no
padrão sem lançar, e onde vive a versão do motor.

### O exemplo agora salva a resposta em disco

`motor/exemplo-integracao.mjs` continua imprimindo o resumo, mas passa a gravar tambem
`motor-amostra/analysis.json`, `rawFacts.json` e `usage.json` — exatamente o que
`analyzeMatch` devolve. E o caminho mais rapido para conhecer o contrato de saida: em vez
de ler a descricao dos campos, voce roda uma partida real com a sua chave e modela em cima
do JSON que de fato chega.

### Empacotamento

O empacotador passa a auditar os documentos com uma régua mais dura que a do código e
**aborta o build** se um `.md` do pacote voltar a citar processo interno.

---

## 1.0.1 — 2026-09-10

Correções de **contrato** (o `SKILL.md` descrevia o motor de forma que levava a
integração errada). Nenhum número de probabilidade muda nesta versão.

### Corrigido no contrato

- **Id da Premier League estava errado no SKILL.md.** O contrato listava
  `premier`; o id real é **`epl`**. Isso importa mais do que parece: um id
  desconhecido **não gera erro** — `getComp()` resolve
  `COMPETITIONS[id] || COMPETITIONS.brsa`, então uma integração de Premier League
  com `'premier'` recebia análise inteira com endpoint, rótulo, regras de ticket e
  tabela do **Brasileirão**, sem nenhum sinal de que algo estava errado.
  Ids válidos: `brsa`, `libertadores`, `epl`, `laliga`, `ucl`.
- **`routeIntent` aceita um 2º parâmetro** que o contrato não mencionava:
  `routeIntent(msg, { hasAttachments })`. Com `true`, força `'chat'` — anexo nunca
  dispara o relatório. Quem processa anexos precisa passar isso.
- **`chat()` pode devolver `reason: 'empty'`** (mensagem vazia), além de
  `'vague_query'` e `'presupposed_match'`. Um `switch` sobre `reason` sem esse
  caso caía no default.
- **Dois campos de saída não estavam documentados**, ambos usados para montar a UI:
  `mercado` (descritor estruturado de cada evento/ticket — é dele que o código
  recalcula a probabilidade por Poisson) e `_obvio` (marca **mercado-âncora**:
  probabilidade ≥0,80 ou estrutura trivial). Rotule os `_obvio` como âncora de odd
  baixa; apresentá-los como o diferencial da análise frustra quem opera o agente.

### Novo comportamento

- O motor agora **avisa pelo `log`** quando recebe um id de competição fora da
  lista, em `createEngine()` e em `setCompetition()`. É aviso, não exceção — não
  quebra integração existente. Trate esse aviso como erro de integração.

---

## 1.0.0 — 2026-07-31

Primeira versão com carimbo. Pacotes entregues **antes** desta não têm
`MOTOR_VERSION` — se o seu `engine.mjs` não exporta essa constante, você está
numa cópia anterior e deve atualizar: as correções abaixo já estão inclusas.

### ⚠ Probabilidades (números mudam)

- **Mercados de cartão por time saíam com probabilidade de gols.** "Mais de 4.5
  cartões do [time]" era recalculado pela distribuição de gols e chegava ao
  usuário em torno de 2%, carimbado como valor calculado. Mercados disciplinares
  agora ficam fora desse recálculo.
- **"[Time] não marca" vinha invertido.** O mercado devolvia a probabilidade de o
  time marcar, não de não marcar — com média de 1,2 gol, exibia ~70% onde o
  correto é ~30%. Diferença de cerca de 40 pontos percentuais.
- **Mercados de estatística de time eram tratados como gols.** "Chutes ao gol do
  [time] mais de 5.5", "impedimentos", "finalizações de [jogador]" caíam no
  cálculo de gols e saíam próximos de zero. Agora só mercados de gol entram nesse
  recálculo; os demais mantêm a estimativa do modelo.
- **Faixa de probabilidade invertida no empate e no visitante.** A faixa
  "mínimo–máximo" do resultado aparecia com o maior valor primeiro nessas duas
  linhas.
- **Coerência de dupla chance** e **reconciliação por distribuição de Poisson**
  agora usam um descritor estruturado do mercado (tipo, time, linha, direção,
  negação, período) que a análise emite junto do texto, em vez de interpretar a
  descrição escrita. Isso torna o recálculo previsível e elimina a classe de erro
  dos três itens acima.

### Texto e conteúdo da análise

- **Tags de citação da busca não vazam mais para o texto.** Trechos como
  `<cite index="2-5">` apareciam dentro de nomes de jogadores, técnicos e
  estatísticas. Removidas em duas camadas: ao interpretar a resposta do modelo e
  no ponto de exibição.
- **Notas de ajuste automático saem separadas do texto.** Marcações do tipo
  "[probabilidade recalculada…]" ficavam misturadas ao texto de fundamento; agora
  vêm em campo próprio, para você exibir (ou não) como preferir.
- **Técnico de cada time é buscado ativamente.** Quando a coleta inicial não
  retorna o treinador, uma busca dedicada é feita antes de declarar o dado como
  ausente.
- **Mercados quase certos são identificados.** Mercados com probabilidade a partir
  de 80% ou de estrutura trivial ("ambos os times batem ao menos 1 escanteio")
  recebem a marca `_obvio: true` nos itens da análise, e a orientação de geração
  limita quantos desses entram e exige que o fundamento reconheça o baixo valor
  informativo. Use a marca para rotular esses mercados na sua interface.

### Coleta de dados

- **Cobertura de busca não se declara mais coberta sem o dado.** Quando apenas a
  classificação era obtida, resultados e forma recente eram considerados cobertos
  e não eram buscados — a análise seguia sem eles.
- **Placares com separadores variados são reconhecidos** ("3x0", "3X0", "3–0",
  "3:0"), evitando buscas repetidas por dados já disponíveis.
- **Jogadores com nome de prefixo comum não são mais confundidos.** Uma ausência
  de "Silva Jr" marcava "Silva" como indefinido na escalação.

### Integração

- **Respostas de chat não são mais truncadas.** Em conexões que fragmentam a
  transmissão, trechos da resposta podiam ser descartados silenciosamente, e
  acentos partidos entre pacotes viravam caracteres inválidos. Afeta o método
  `chat()`.
- **Texto anterior a uma continuação do modelo era perdido.** Quando a resposta
  passava por continuação de ferramenta, o texto emitido antes dela não entrava no
  retorno de `chat()`.
- `createEngine()` agora devolve também `version`.
