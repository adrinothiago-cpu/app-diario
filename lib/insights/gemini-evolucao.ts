/**
 * Seção Evolução: acompanhamento de questões pessoais/profissionais não
 * binárias via Gemini API, em formato de conversa (não um botão de análise
 * em lote). Duas responsabilidades separadas (schemas de saída
 * incompatíveis):
 *
 * 1. Classificação: dado um lote de entradas do diário ainda não
 *    classificadas (ver `selectEntriesForClassification`, o checkpoint
 *    incremental) e a lista de tópicos ativos, decide a qual tópico (ou
 *    nenhum) cada entrada pertence. Roda antes de cada turno de chat — é
 *    assim que "a IA lê o diário" acontece, sem depender de um botão à parte.
 * 2. Turno de chat: dado um tópico (ou `null` na primeira mensagem, quando
 *    o tópico ainda nem existe), o resumo/critérios da última vez, as
 *    entradas novas do diário e o histórico da conversa da sessão atual,
 *    gera uma resposta conversacional e atualiza a memória do tópico
 *    (resumo + critérios). A conversa em si NUNCA é persistida — só a
 *    memória atualizada (`evolucao_rodada_registrada`), o que mantém o
 *    orçamento de armazenamento auto-imposto (~5MB) mesmo com uso intenso.
 *
 * Mesmo tom de análise de `gemini-insights.ts` (sem tabu, sem moralismo,
 * critério binário por efeito real) — ver `ARCHITECTURE.md` sobre a exceção
 * de zero-knowledge.
 */
import { callGeminiInteraction } from "@/lib/gemini/client";
import type {
  DiaryEntryItem,
  EvolucaoClassificacao,
  EvolucaoCriterio,
  EvolucaoTopico,
  MoodTrend,
} from "@/lib/events/types";

export const MAX_ENTRIES_PER_CLASSIFICATION_BATCH = 30;
export const MIN_CRITERIA = 3;
export const MAX_CRITERIA = 6;
/** Teto de segurança do campo `resumo` — bem acima do que um resumo real deve precisar; existe só pra nunca deixar o cofre crescer sem limite. */
export const MAX_RESUMO_CHARS = 1_000_000;

export class EvolucaoError extends Error {}

/** FNV-1a de 32 bits, 8 hex chars — rápido, determinístico, suficiente para detectar mudança no conjunto de tópicos. */
function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Hash do conjunto de tópicos ativos (ordenado, insensível à ordem de criação) — ver `EvolucaoEntradaClassificadaEvent`. */
export function computeVersaoTopicos(topicosAtivos: { id: string }[]): string {
  return fnv1aHex([...topicosAtivos.map((t) => t.id)].sort().join("|"));
}

/**
 * Seleciona entradas do diário ainda pendentes de classificação: nunca
 * classificadas, ou marcadas "sem tópico" sob um conjunto de tópicos ativos
 * diferente do atual (um tópico novo pode agora corresponder a elas).
 * Entradas já vinculadas a um tópico real nunca são reconsideradas.
 */
export function selectEntriesForClassification(params: {
  diaryEntries: DiaryEntryItem[];
  classificacoes: EvolucaoClassificacao[];
  topicosAtivos: EvolucaoTopico[];
  limit?: number;
}): DiaryEntryItem[] {
  const versaoAtual = computeVersaoTopicos(params.topicosAtivos);
  const porEntrada = new Map<string, EvolucaoClassificacao[]>();
  for (const c of params.classificacoes) {
    const list = porEntrada.get(c.entryId);
    if (list) list.push(c);
    else porEntrada.set(c.entryId, [c]);
  }

  return params.diaryEntries
    .filter((e) => e.conteudo.trim() !== "" || (e.transcricao !== null && e.transcricao.trim() !== ""))
    .filter((e) => {
      const prior = porEntrada.get(e.id);
      if (!prior || prior.length === 0) return true;
      if (prior.some((c) => c.topicoId !== null)) return false;
      return !prior.some((c) => c.versaoTopicos === versaoAtual);
    })
    .sort((a, b) => a.criadoEm - b.criadoEm)
    .slice(0, params.limit ?? MAX_ENTRIES_PER_CLASSIFICATION_BATCH);
}

/**
 * Entradas de diário pra dar à IA já na primeira mensagem de um tópico novo
 * (antes de o tópico existir, então sem classificação por tópico ainda) —
 * as mais recentes primeiro na seleção, devolvidas mais antigas primeiro
 * (mesma convenção de `formatDiaryContext`).
 */
export function selectEntriesForNewTopic(
  entries: DiaryEntryItem[],
  limit = MAX_ENTRIES_PER_CLASSIFICATION_BATCH,
): DiaryEntryItem[] {
  return entries
    .filter((e) => e.conteudo.trim() !== "" || (e.transcricao !== null && e.transcricao.trim() !== ""))
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, limit)
    .sort((a, b) => a.criadoEm - b.criadoEm);
}

export interface TopicoParaClassificar {
  id: string;
  titulo: string;
  descricao: string | null;
}

export interface ClassificacaoResultado {
  entryId: string;
  topicoId: string | null;
}

export function buildClassificationPrompt(
  entries: DiaryEntryItem[],
  topicos: TopicoParaClassificar[],
): string {
  const formattedTopicos = topicos
    .map(
      (t) =>
        `- id: "${t.id}" | título: "${t.titulo}"${t.descricao ? ` | contexto: "${t.descricao}"` : ""}`,
    )
    .join("\n");

  const formattedEntries = entries
    .map((e) => {
      const parts: string[] = [`id: "${e.id}" | Horário: ${e.horario}`];
      if (e.conteudo.trim() !== "") parts.push(`Texto: ${e.conteudo.trim()}`);
      if (e.transcricao && e.transcricao.trim() !== "") {
        parts.push(`Transcrição do áudio: ${e.transcricao.trim()}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");

  return `Você recebe entradas de um diário pessoal e uma lista de "tópicos de evolução pessoal" que o usuário está acompanhando ao longo do tempo — cada tópico é uma questão pessoal ou profissional em aberto (não uma tarefa que se conclui).

Para CADA entrada abaixo, diga a QUAL tópico (no máximo um) ela pertence, com base no conteúdo real. Só classifique quando houver relação clara (pessoas, situação ou decisão específica do tópico); se nenhum tópico corresponder claramente, use null — não force encaixe.

Tópicos ativos:
${formattedTopicos}

Entradas a classificar:
${formattedEntries}

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "classificacoes": [
    { "entryId": "...", "topicoId": "..." | null }
  ]
}
Inclua exatamente uma saída para cada entrada recebida, na mesma quantidade, usando o "id" de cada entrada como "entryId".`;
}

export function parseClassificationResponse(
  raw: string,
  expectedEntryIds: string[],
  validTopicoIds: string[],
): ClassificacaoResultado[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new EvolucaoError(`Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).classificacoes)) {
    throw new EvolucaoError(`Campo 'classificacoes' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  const validIds = new Set(validTopicoIds);
  const classificacoes = (parsed as { classificacoes: unknown[] }).classificacoes;

  const result: ClassificacaoResultado[] = classificacoes.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new EvolucaoError(`Classificação #${idx} não é um objeto: ${raw.slice(0, 300)}`);
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.entryId !== "string" || obj.entryId.trim() === "") {
      throw new EvolucaoError(`Classificação #${idx} sem 'entryId' válido: ${raw.slice(0, 300)}`);
    }
    if (obj.topicoId !== null && typeof obj.topicoId !== "string") {
      throw new EvolucaoError(`Classificação #${idx} com 'topicoId' inválido: ${raw.slice(0, 300)}`);
    }
    if (obj.topicoId !== null && !validIds.has(obj.topicoId)) {
      throw new EvolucaoError(`Classificação #${idx} referencia um 'topicoId' desconhecido: ${String(obj.topicoId)}`);
    }
    return { entryId: obj.entryId, topicoId: obj.topicoId as string | null };
  });

  const expectedSet = new Set(expectedEntryIds);
  const resultIds = new Set(result.map((r) => r.entryId));
  const faltando = expectedEntryIds.filter((id) => !resultIds.has(id));
  const sobrando = result.filter((r) => !expectedSet.has(r.entryId)).map((r) => r.entryId);
  if (faltando.length > 0 || sobrando.length > 0) {
    throw new EvolucaoError(
      `Cobertura incompleta na classificação. Faltando: [${faltando.join(", ")}]. Inesperado: [${sobrando.join(", ")}].`,
    );
  }

  return result;
}

export async function classifyDiaryEntries(
  apiKey: string,
  entries: DiaryEntryItem[],
  topicos: TopicoParaClassificar[],
): Promise<ClassificacaoResultado[]> {
  if (entries.length === 0) return [];
  const prompt = buildClassificationPrompt(entries, topicos);
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  return parseClassificationResponse(
    result.text,
    entries.map((e) => e.id),
    topicos.map((t) => t.id),
  );
}

/** Calculado em código (não pedido ao modelo): compara a contagem de critérios `true` entre rodadas. */
export function computeTendencia(anterior: EvolucaoCriterio[] | null, atual: EvolucaoCriterio[]): MoodTrend {
  if (!anterior) return "sem_dados_suficientes";
  const antes = anterior.filter((c) => c.valor).length;
  const depois = atual.filter((c) => c.valor).length;
  if (depois > antes) return "melhorando";
  if (depois < antes) return "piorando";
  return "estavel";
}

export interface ChatMensagem {
  autor: "usuario" | "ia";
  texto: string;
}

const CHAT_DIRETRIZES = `DIRETRIZES OBRIGATÓRIAS:
1. SEM TABUS OU MORALISMO: julgue só pela experiência e pelos resultados reais da pessoa — elimine qualquer viés de "politicamente correto", moral de terceiros ou convenção social.
2. CRITÉRIO BINÁRIO POR EFEITO REAL: cada critério deve ser uma pergunta objetiva, respondível como verdadeiro ou falso, sobre algo concreto e observável (gerou bem-estar/resultado real = tende a true; gerou atrito/problema real = tende a false). Nunca perguntas vagas de sentimento ("está se sentindo bem?") — prefira efeito observável (ex.: "as interações geram resultado profissional real?", "há reciprocidade nas combinações feitas?").
3. Foco em ajudar a DECIDIR e EVOLUIR — nunca em validação emocional vaga.
4. RECOMENDAÇÃO BASEADA NO QUE FUNCIONA: quando fizer sentido, recomende ações concretas apoiadas nos critérios que já estão \`true\` (o que historicamente gerou resultado real) — nunca um conselho genérico solto, sempre ancorado no que os dados já mostraram.
5. TRADE-OFF SAÚDE x QUALIDADE DE VIDA: quando um hábito (bebida, substância, o que for) tiver custo real de saúde mas também sustentar estabilidade emocional real (ex.: alívio de um sofrimento antigo), não simplifique para "isso é errado" nem finja que não há custo. Avalie friamente os dois lados pelo efeito real na vida da pessoa, mas a recomendação final deve tender pro caminho que constrói mais qualidade de vida e estabilidade DURADOURA — não abstinência automática por princípio, nem permissividade automática por conforto.
6. MUDANÇA É CONSTRUÇÃO, NÃO INTERRUPTOR: nunca prescreva a solução como um corte binário e imediato ("pare hoje", "teto inegociável a partir de agora", "essa é a regra e ponto"). Comportamento humano enraizado muda por CONSTRUÇÃO gradual — passos pequenos e testáveis, um de cada vez, com espaço real para recaída sem que isso vire fracasso. Proponha o PRÓXIMO passo incremental a partir de onde a pessoa já está, nunca o estado final ideal como exigência imediata.`;

function formatDiaryContext(entries: DiaryEntryItem[]): string {
  return entries
    .map((e) => {
      const parts: string[] = [`Horário: ${e.horario}`];
      if (e.conteudo.trim() !== "") parts.push(`Texto: ${e.conteudo.trim()}`);
      if (e.transcricao && e.transcricao.trim() !== "") {
        parts.push(`Transcrição do áudio: ${e.transcricao.trim()}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

function formatHistorico(historico: ChatMensagem[]): string {
  if (historico.length === 0) return "(nenhuma mensagem anterior nesta sessão)";
  return historico.map((m) => `${m.autor === "usuario" ? "Usuário" : "Você"}: ${m.texto}`).join("\n");
}

export function buildChatTurnPrompt(params: {
  topico: { titulo: string } | null;
  criteriosAnteriores: EvolucaoCriterio[] | null;
  resumoAnterior: string | null;
  diaryContext: DiaryEntryItem[];
  historicoConversa: ChatMensagem[];
  mensagemAtual: string | null;
}): string {
  const { topico, criteriosAnteriores, resumoAnterior, diaryContext, historicoConversa, mensagemAtual } = params;

  const diarySection =
    diaryContext.length > 0
      ? topico === null
        ? `Entradas recentes do diário do usuário, pra você já ter contexto real sobre a vida dele antes de responder (mais antigas primeiro):\n${formatDiaryContext(diaryContext)}`
        : `Entradas novas do diário desde a última vez (mais antigas primeiro):\n${formatDiaryContext(diaryContext)}`
      : topico === null
        ? "Nenhuma entrada de diário disponível."
        : "Nenhuma entrada nova do diário desde a última vez.";

  const mensagemSection =
    mensagemAtual !== null
      ? `Nova mensagem do usuário: "${mensagemAtual}"`
      : "O usuário não mandou mensagem nova agora — ele só quer que você releia o diário e atualize seu entendimento, sem uma pergunta específica para responder.";

  if (topico === null) {
    return `Você é um mentor pragmático de evolução pessoal, conversando diretamente com a pessoa sobre uma questão pessoal ou profissional em aberto — não uma tarefa que se conclui, algo que evolui com o tempo.

${CHAT_DIRETRIZES}

Esta é uma CONVERSA NOVA — ainda não existe um tópico registrado. A partir da mensagem do usuário e das entradas do diário abaixo, você vai: (a) propor um título curto (3 a 6 palavras) que nomeie a questão, (b) definir de ${MIN_CRITERIA} a ${MAX_CRITERIA} critérios binários concretos que serão reavaliados ao longo do tempo, com o valor atual (true/false) de cada um, (c) escrever um resumo do estado atual — sem limite fixo de frases, preservando os fatos concretos que já aparecem no diário (não um resumo genérico raso), e (d) responder à pessoa na conversa — com empatia real, mas sem meias-palavras. Use o diário pra já entender o contexto real da vida dela, não só a mensagem isolada.

${diarySection}

${mensagemSection}

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "titulo": "...",
  "resposta": "...",
  "criterios": [ { "texto": "...", "valor": true } ],
  "resumo": "..."
}`;
  }

  const criteriosSection =
    criteriosAnteriores === null
      ? `Este tópico ("${topico.titulo}") ainda não tem critérios definidos. Defina de ${MIN_CRITERIA} a ${MAX_CRITERIA} critérios binários concretos agora, com o valor atual (true/false) de cada um.`
      : `Critérios já definidos para este tópico (nesta ordem — responda nesta mesma ordem, sem incluir o texto, só o valor atualizado):\n${criteriosAnteriores
          .map((c, i) => `${i + 1}. "${c.texto}" — valor anterior: ${c.valor}`)
          .join(
            "\n",
          )}\n\nREAVALIE EXATAMENTE OS MESMOS critérios (não crie novos, não reescreva o texto) — atualize o valor com base na conversa e nas entradas novas do diário. Se nada for relevante para um critério, mantenha o valor anterior dele.`;

  const resumoSection = resumoAnterior
    ? `Resumo do que você entende até agora: "${resumoAnterior}"`
    : "Ainda não há resumo anterior deste tópico.";

  return `Você é um mentor pragmático de evolução pessoal, em uma conversa contínua sobre o tópico "${topico.titulo}" — uma questão pessoal ou profissional em aberto, não uma tarefa que se conclui.

${CHAT_DIRETRIZES}

${resumoSection}

${criteriosSection}

${diarySection}

Histórico desta conversa (sessão atual):
${formatHistorico(historicoConversa)}

${mensagemSection}

Escreva um resumo atualizado que CONDENSA o resumo anterior com o que mudou nesta conversa — preserve todos os fatos e padrões importantes já identificados ao longo do acompanhamento (nunca descarte histórico relevante só pra economizar espaço), evitando só repetição redundante. Sem limite fixo de frases. Depois responda à pessoa na conversa.

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "resposta": "...",
  "criterios": [ { "valor": true } ],
  "resumo": "..."
}`;
}

/** Teto de segurança — nunca deve ser atingido na prática (ver `MAX_RESUMO_CHARS`), só evita crescimento sem limite do cofre. */
function clampResumo(resumo: string): string {
  return resumo.length <= MAX_RESUMO_CHARS ? resumo : resumo.slice(0, MAX_RESUMO_CHARS);
}

export function parseChatTurnResponse(
  raw: string,
  criteriosAnteriores: EvolucaoCriterio[] | null,
): { titulo?: string; resposta: string; criterios: EvolucaoCriterio[]; resumo: string } {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new EvolucaoError(`Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new EvolucaoError(`Resposta JSON não é um objeto. Conteúdo: ${raw.slice(0, 300)}`);
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.resposta !== "string" || obj.resposta.trim() === "") {
    throw new EvolucaoError(`Campo 'resposta' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }
  if (typeof obj.resumo !== "string" || obj.resumo.trim() === "") {
    throw new EvolucaoError(`Campo 'resumo' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }
  if (!Array.isArray(obj.criterios)) {
    throw new EvolucaoError(`Campo 'criterios' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  if (criteriosAnteriores === null) {
    if (typeof obj.titulo !== "string" || obj.titulo.trim() === "") {
      throw new EvolucaoError(
        `Campo 'titulo' ausente ou inválido no JSON (obrigatório na primeira conversa de um tópico): ${raw.slice(0, 300)}`,
      );
    }
    if (obj.criterios.length < MIN_CRITERIA || obj.criterios.length > MAX_CRITERIA) {
      throw new EvolucaoError(
        `Esperado entre ${MIN_CRITERIA} e ${MAX_CRITERIA} critérios na primeira conversa, recebi ${obj.criterios.length}.`,
      );
    }
    const criterios = obj.criterios.map((item, idx) => {
      if (!item || typeof item !== "object") {
        throw new EvolucaoError(`Critério #${idx} não é um objeto: ${raw.slice(0, 300)}`);
      }
      const c = item as Record<string, unknown>;
      if (typeof c.texto !== "string" || c.texto.trim() === "") {
        throw new EvolucaoError(`Critério #${idx} sem 'texto' válido: ${raw.slice(0, 300)}`);
      }
      if (typeof c.valor !== "boolean") {
        throw new EvolucaoError(`Critério #${idx} sem 'valor' booleano: ${raw.slice(0, 300)}`);
      }
      return { texto: c.texto.trim(), valor: c.valor };
    });
    return { titulo: obj.titulo.trim(), resposta: obj.resposta.trim(), criterios, resumo: clampResumo(obj.resumo.trim()) };
  }

  if (obj.criterios.length !== criteriosAnteriores.length) {
    throw new EvolucaoError(
      `Esperado ${criteriosAnteriores.length} critérios (mesma quantidade da conversa anterior), recebi ${obj.criterios.length}.`,
    );
  }
  const criterios = obj.criterios.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new EvolucaoError(`Critério #${idx} não é um objeto: ${raw.slice(0, 300)}`);
    }
    const c = item as Record<string, unknown>;
    if (typeof c.valor !== "boolean") {
      throw new EvolucaoError(`Critério #${idx} sem 'valor' booleano: ${raw.slice(0, 300)}`);
    }
    return { texto: criteriosAnteriores[idx].texto, valor: c.valor };
  });
  return { resposta: obj.resposta.trim(), criterios, resumo: clampResumo(obj.resumo.trim()) };
}

/** Orquestra: monta o prompt do turno -> chama Gemini -> valida JSON -> calcula tendência em código. */
export async function generateChatTurn(
  apiKey: string,
  params: {
    topico: { titulo: string } | null;
    criteriosAnteriores: EvolucaoCriterio[] | null;
    resumoAnterior: string | null;
    diaryContext: DiaryEntryItem[];
    historicoConversa: ChatMensagem[];
    mensagemAtual: string | null;
  },
): Promise<{
  titulo?: string;
  resposta: string;
  criterios: EvolucaoCriterio[];
  resumo: string;
  tendencia: MoodTrend;
  modeloUsado?: string;
}> {
  if (params.topico === null && params.mensagemAtual === null) {
    throw new EvolucaoError("A primeira mensagem de um tópico novo não pode ficar vazia.");
  }
  const prompt = buildChatTurnPrompt(params);
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  const parsed = parseChatTurnResponse(result.text, params.criteriosAnteriores);
  return {
    ...parsed,
    tendencia: computeTendencia(params.criteriosAnteriores, parsed.criterios),
    modeloUsado: result.modelUsed,
  };
}
