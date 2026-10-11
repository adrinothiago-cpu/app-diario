/**
 * Seção Treino: duas responsabilidades separadas via Gemini API (schemas de
 * saída incompatíveis, mesma separação de `gemini-evolucao.ts`):
 *
 * 1. Geração do plano: dado um treino (A/B/C) e os grupamentos que ele
 *    cobre (ordem fixa, usada depois pelo rodízio de foco em
 *    `lib/events/treino-store.ts`), monta um banco com pelo menos 2
 *    exercícios por grupamento — qualquer um deles pode ser o foco, e o
 *    foco recebe 2 exercícios na sessão (ver `selecionarExerciciosDaSessao`).
 * 2. Interação durante a sessão: chat curto que acompanha o treino em
 *    andamento (progressão de carga com base no histórico, dúvidas de
 *    execução) — ou, quando `mensagemAtual` é `null`, um parecer final da
 *    sessão (mesma convenção de `generateChatTurn`/`handleUpdateFromDiary`
 *    em `gemini-evolucao.ts`).
 *
 * Nada aqui roda sozinho: cada geração de plano e cada mensagem da sessão é
 * um clique explícito do usuário. Ver `ARCHITECTURE.md` sobre a exceção de
 * zero-knowledge.
 */
import { callGeminiInteraction } from "@/lib/gemini/client";
import type { ExercicioDaSessao, TreinoConversaMensagem, TreinoMemoria } from "@/lib/events/treino-store";
import type { TreinoExercicioPlano, TreinoLetra, TreinoSerieIdentificada } from "@/lib/events/types";

export class TreinoError extends Error {}

function stripJsonFences(raw: string): string {
  const cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    return cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// 1. Geração do plano
// ---------------------------------------------------------------------------

export function buildTreinoPlanoPrompt(params: {
  treino: TreinoLetra;
  grupamentos: string[];
  minutos: number;
}): string {
  const { treino, grupamentos, minutos } = params;
  const listaGrupamentos = grupamentos.map((g, i) => `${i + 1}. ${g}`).join("\n");

  return `Você é um personal trainer pragmático montando um treino de academia curto e eficiente.

Monte o banco de exercícios do "Treino ${treino}", que cobre os grupamentos abaixo, nesta ordem:
${listaGrupamentos}

Como cada sessão funciona (até ${minutos} minutos de musculação; em alguns dias a pessoa ainda faz esteira depois, fora desse tempo):
- RODÍZIO DE FOCO: a cada vez que a pessoa faz o Treino ${treino}, o foco passa para o próximo grupamento da lista, ciclicamente.
- O grupamento em FOCO recebe 2 exercícios; os DEMAIS grupamentos, juntos, recebem 2 exercícios; e um 5º exercício entra só se der tempo.
- TODOS os grupamentos são treinados em toda sessão — o foco muda quantos exercícios cada um recebe, não o número de séries.

REGRAS:
1. Para CADA grupamento, liste 2 ou 3 exercícios (qualquer grupamento pode ser o foco, então todos precisam ter pelo menos 2). Liste-os em ordem de prioridade: o 1º de cada grupamento é o que entra quando ele NÃO é o foco.
2. "series" é a mesma quantidade em toda sessão (ex.: 3) — cabendo 4 a 5 exercícios em ${minutos} minutos.
3. "repeticoes" é uma faixa curta (ex.: "8-12").
4. Priorize exercícios compostos (multiarticulares) antes de isolados.
5. Não inclua aquecimento, alongamento nem cardio — só os exercícios de carga.

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "exercicios": [
    { "grupamento": "...", "nome": "...", "series": 3, "repeticoes": "8-12" }
  ]
}
Use o nome do grupamento exatamente como escrito na lista.`;
}

export function parseTreinoPlanoResponse(raw: string, grupamentos: string[]): TreinoExercicioPlano[] {
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new TreinoError(`Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).exercicios)) {
    throw new TreinoError(`Campo 'exercicios' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  const exercicios = (parsed as { exercicios: unknown[] }).exercicios.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new TreinoError(`Exercício #${idx} não é um objeto: ${raw.slice(0, 300)}`);
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.grupamento !== "string" || obj.grupamento.trim() === "") {
      throw new TreinoError(`Exercício #${idx} sem 'grupamento' válido: ${raw.slice(0, 300)}`);
    }
    if (typeof obj.nome !== "string" || obj.nome.trim() === "") {
      throw new TreinoError(`Exercício #${idx} sem 'nome' válido: ${raw.slice(0, 300)}`);
    }
    if (typeof obj.series !== "number" || obj.series <= 0) {
      throw new TreinoError(`Exercício #${idx} com 'series' inválido: ${raw.slice(0, 300)}`);
    }
    if (typeof obj.repeticoes !== "string" || obj.repeticoes.trim() === "") {
      throw new TreinoError(`Exercício #${idx} sem 'repeticoes' válido: ${raw.slice(0, 300)}`);
    }
    return {
      grupamento: obj.grupamento.trim(),
      nome: obj.nome.trim(),
      series: obj.series,
      repeticoes: obj.repeticoes.trim(),
    };
  });

  const faltando = grupamentos.filter((g) => exercicios.filter((e) => e.grupamento === g).length < 2);
  if (faltando.length > 0) {
    throw new TreinoError(`Plano sem pelo menos 2 exercícios por grupamento. Faltando em: [${faltando.join(", ")}].`);
  }

  return exercicios;
}

export async function generateTreinoPlano(
  apiKey: string,
  params: { treino: TreinoLetra; grupamentos: string[]; minutos?: number },
): Promise<{ exercicios: TreinoExercicioPlano[]; modeloUsado: string }> {
  const minutos = params.minutos ?? 40;
  const prompt = buildTreinoPlanoPrompt({ treino: params.treino, grupamentos: params.grupamentos, minutos });
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  const exercicios = parseTreinoPlanoResponse(result.text, params.grupamentos);
  return { exercicios, modeloUsado: result.modelUsed };
}

// ---------------------------------------------------------------------------
// 2. Interação durante a sessão
// ---------------------------------------------------------------------------

export interface TreinoMensagem {
  autor: "usuario" | "ia";
  texto: string;
}

export interface TreinoHistoricoExercicio {
  exercicio: string;
  series: number;
  repeticoes: number;
  cargaKg: number;
  rpe: number;
}

export interface TreinoSerieDaSessao {
  exercicio: string;
  grupamento: string | null;
  series: number;
  repeticoes: number;
  cargaKg: number;
  rpe: number;
  observacoes: string;
  duracaoMin: number | null;
}

const TREINO_DIRETRIZES = `DIRETRIZES:
1. PROGRESSÃO DE CARGA REAL: compare com o histórico de sessões anteriores do mesmo exercício — se o RPE relatado estiver baixo (fácil) e todas as séries/repetições foram completadas, recomende aumento concreto de carga na próxima vez; se o RPE estiver alto ou houve falha nas repetições, recomende manter ou reduzir.
2. ESTRUTURA DA SESSÃO: até 40 minutos de musculação — 2 exercícios do grupamento em foco + 2 dos demais grupamentos, e um 5º só se der tempo. Em alguns dias há esteira depois do treino, fora desses 40 minutos.
3. Respostas curtas e diretas, sem enrolação, sem moralismo sobre treino "certo" — só o que funciona pro objetivo da pessoa.
4. Nunca invente dado que a pessoa não registrou; se faltar contexto pra responder algo específico, diga isso objetivamente em vez de supor.`;

function formatPlano(exercicios: ExercicioDaSessao[]): string {
  return exercicios
    .map(({ exercicio: e, emFoco, extra }) => {
      const marcas = [emFoco ? "FOCO" : null, extra ? "5º, só se der tempo" : null].filter(Boolean).join(", ");
      return `- ${e.nome} (${e.grupamento}${marcas ? `, ${marcas}` : ""}): ${e.series} séries de ${e.repeticoes} reps`;
    })
    .join("\n");
}

function formatSeriesDaSessao(series: TreinoSerieDaSessao[]): string {
  if (series.length === 0) return "(nada registrado ainda nesta sessão)";
  return series
    .map((s) => {
      const obs = s.observacoes ? ` — obs: ${s.observacoes}` : "";
      if (s.duracaoMin !== null) return `- ${s.exercicio}: ${s.duracaoMin} min, RPE ${s.rpe}${obs}`;
      return `- ${s.exercicio}: ${s.series}x${s.repeticoes} a ${s.cargaKg}kg, RPE ${s.rpe}${obs}`;
    })
    .join("\n");
}

function formatHistorico(historico: TreinoHistoricoExercicio[]): string {
  if (historico.length === 0) return "(sem sessões anteriores registradas para estes exercícios)";
  return historico.map((h) => `- ${h.exercicio}: ${h.series}x${h.repeticoes} a ${h.cargaKg}kg, RPE ${h.rpe}`).join("\n");
}

function formatConversa(historico: TreinoMensagem[]): string {
  if (historico.length === 0) return "(nenhuma mensagem anterior nesta sessão)";
  return historico.map((m) => `${m.autor === "usuario" ? "Usuário" : "Você"}: ${m.texto}`).join("\n");
}

export function buildTreinoInteracaoPrompt(params: {
  treino: TreinoLetra;
  grupamentoFoco: string;
  exerciciosDoDia: ExercicioDaSessao[];
  seriesDaSessao: TreinoSerieDaSessao[];
  historicoRecente: TreinoHistoricoExercicio[];
  historicoConversa: TreinoMensagem[];
  mensagemAtual: string | null;
}): string {
  const { treino, grupamentoFoco, exerciciosDoDia, seriesDaSessao, historicoRecente, historicoConversa, mensagemAtual } = params;

  const mensagemSection =
    mensagemAtual !== null
      ? `Nova mensagem do usuário: "${mensagemAtual}"`
      : "O usuário está finalizando a sessão e quer um PARECER FINAL — avalie o que foi feito hoje e dê uma recomendação concreta para a próxima vez que este treino (mesmo foco ou não) for repetido.";

  return `Você é um personal trainer pragmático acompanhando ao vivo uma sessão do "Treino ${treino}", em foco hoje no grupamento "${grupamentoFoco}".

${TREINO_DIRETRIZES}

Exercícios de hoje (já escolhidos pelo foco do dia):
${formatPlano(exerciciosDoDia)}

Já registrado nesta sessão até agora:
${formatSeriesDaSessao(seriesDaSessao)}

Histórico recente destes exercícios (sessões anteriores):
${formatHistorico(historicoRecente)}

Histórico desta conversa (sessão atual):
${formatConversa(historicoConversa)}

${mensagemSection}

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "resposta": "..."
}`;
}

export function parseTreinoInteracaoResponse(raw: string): { resposta: string } {
  const cleaned = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new TreinoError(`Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }

  if (!parsed || typeof parsed !== "object" || typeof (parsed as Record<string, unknown>).resposta !== "string") {
    throw new TreinoError(`Campo 'resposta' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  const resposta = (parsed as { resposta: string }).resposta.trim();
  if (resposta === "") {
    throw new TreinoError(`Campo 'resposta' veio vazio: ${raw.slice(0, 300)}`);
  }
  return { resposta };
}

export async function generateTreinoInteracao(
  apiKey: string,
  params: {
    treino: TreinoLetra;
    grupamentoFoco: string;
    exerciciosDoDia: ExercicioDaSessao[];
    seriesDaSessao: TreinoSerieDaSessao[];
    historicoRecente: TreinoHistoricoExercicio[];
    historicoConversa: TreinoMensagem[];
    mensagemAtual: string | null;
  },
): Promise<{ resposta: string; modeloUsado: string }> {
  const prompt = buildTreinoInteracaoPrompt(params);
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  const parsed = parseTreinoInteracaoResponse(result.text);
  return { ...parsed, modeloUsado: result.modelUsed };
}

// ---------------------------------------------------------------------------
// 3. Dúvidas gerais (sem sessão ativa) — caixa de chat sempre visível na página
// ---------------------------------------------------------------------------

export interface TreinoPlanoResumo {
  treino: TreinoLetra;
  grupamentos: string[];
  exercicios: TreinoExercicioPlano[];
}

export interface TreinoSessaoResumo {
  treino: TreinoLetra;
  grupamentoFoco: string;
  concluidaEm: number;
  feedbackIa: string | null;
}

function formatPlanosGerais(planos: TreinoPlanoResumo[]): string {
  if (planos.length === 0) return "Nenhum plano cadastrado ainda.";
  return planos
    .map(
      (p) =>
        `Treino ${p.treino} (${p.grupamentos.join(", ")}):\n` +
        p.exercicios.map((e) => `  - ${e.nome} (${e.grupamento}): ${e.series} séries de ${e.repeticoes}`).join("\n"),
    )
    .join("\n\n");
}

function formatSessoesRecentes(sessoes: TreinoSessaoResumo[]): string {
  if (sessoes.length === 0) return "Nenhuma sessão concluída ainda.";
  return sessoes
    .map(
      (s) =>
        `- Treino ${s.treino} (foco: ${s.grupamentoFoco}), ${new Date(s.concluidaEm).toLocaleDateString("pt-BR")}${
          s.feedbackIa ? ` — parecer da vez: ${s.feedbackIa}` : ""
        }`,
    )
    .join("\n");
}

export function buildTreinoDuvidaPrompt(params: {
  planos: TreinoPlanoResumo[];
  sessoesRecentes: TreinoSessaoResumo[];
  historicoConversa: TreinoMensagem[];
  mensagemAtual: string;
}): string {
  return `Você é um personal trainer pragmático tirando dúvidas gerais sobre o treino desta pessoa — um rodízio ABC, sempre treinando todos os grupamentos de cada treino, revezando qual deles é o foco a cada vez.

${TREINO_DIRETRIZES}

Planos cadastrados:
${formatPlanosGerais(params.planos)}

Sessões concluídas recentemente:
${formatSessoesRecentes(params.sessoesRecentes)}

Histórico desta conversa:
${formatConversa(params.historicoConversa)}

Pergunta do usuário: "${params.mensagemAtual}"

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "resposta": "..."
}`;
}

export async function generateTreinoDuvida(
  apiKey: string,
  params: {
    planos: TreinoPlanoResumo[];
    sessoesRecentes: TreinoSessaoResumo[];
    historicoConversa: TreinoMensagem[];
    mensagemAtual: string;
  },
): Promise<{ resposta: string; modeloUsado: string }> {
  const prompt = buildTreinoDuvidaPrompt(params);
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  const parsed = parseTreinoInteracaoResponse(result.text);
  return { ...parsed, modeloUsado: result.modelUsed };
}

// ---------------------------------------------------------------------------
// 4. Fala → campos do exercício (botão 🎙️ ao lado de cada exercício na sessão)
// ---------------------------------------------------------------------------

export interface RegistroFalado {
  series: number | null;
  repeticoes: number | null;
  cargaKg: number | null;
  rpe: number | null;
  observacoes: string | null;
}

export function buildInterpretacaoFalaPrompt(exercicio: TreinoExercicioPlano): string {
  return `Você está ajudando a registrar uma série de academia. O áudio anexo é a pessoa falando, em português, o que acabou de fazer no exercício "${exercicio.nome}" (${exercicio.grupamento}; alvo: ${exercicio.series} séries de ${exercicio.repeticoes} repetições).

Extraia do áudio SOMENTE o que a pessoa disse:
- "series": quantas séries fez (número inteiro).
- "repeticoes": repetições por série (número inteiro). Se variou entre as séries (ex.: "10, 10 e 8"), use a MENOR e descreva a variação em "observacoes".
- "cargaKg": carga em kg (número; aceite "quilos", "kg", "kilo"; "meio" = 0.5). Se a pessoa falar a carga por lado da barra/halter, converta só se ela disser o total; senão use o número dito e explique em "observacoes".
- "rpe": esforço percebido de 0 a 10, se ela disser (ou expressões claras como "no limite" = 10, "tranquilo" = 6).
- "observacoes": qualquer outra coisa relevante (dor, técnica, ajuste de máquina, variação de reps), curta e em terceira pessoa neutra. Sem inventar.

Qualquer campo que a pessoa NÃO mencionou deve ser null — não chute a partir do alvo.

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{ "series": 3 | null, "repeticoes": 10 | null, "cargaKg": 40 | null, "rpe": 8 | null, "observacoes": "..." | null }`;
}

function numeroOuNull(value: unknown, campo: string, raw: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TreinoError(`Campo '${campo}' inválido no JSON: ${raw.slice(0, 300)}`);
  }
  return value;
}

export function parseInterpretacaoFalaResponse(raw: string): RegistroFalado {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new TreinoError(`Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new TreinoError(`Resposta JSON não é um objeto: ${raw.slice(0, 300)}`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.observacoes !== null && obj.observacoes !== undefined && typeof obj.observacoes !== "string") {
    throw new TreinoError(`Campo 'observacoes' inválido no JSON: ${raw.slice(0, 300)}`);
  }
  const observacoes = typeof obj.observacoes === "string" && obj.observacoes.trim() !== "" ? obj.observacoes.trim() : null;
  return {
    series: numeroOuNull(obj.series, "series", raw),
    repeticoes: numeroOuNull(obj.repeticoes, "repeticoes", raw),
    cargaKg: numeroOuNull(obj.cargaKg, "cargaKg", raw),
    rpe: numeroOuNull(obj.rpe, "rpe", raw),
    observacoes,
  };
}

/** Manda o áudio daquele exercício à Gemini — só roda quando a pessoa grava pelo botão 🎙️ do exercício. */
export async function interpretarFalaDoExercicio(
  apiKey: string,
  params: { exercicio: TreinoExercicioPlano; audioBase64: string; mimeType: string },
): Promise<RegistroFalado & { modeloUsado: string }> {
  const result = await callGeminiInteraction(apiKey, [
    { type: "text", text: buildInterpretacaoFalaPrompt(params.exercicio) },
    { type: "audio", data: params.audioBase64, mime_type: params.mimeType },
  ]);
  return { ...parseInterpretacaoFalaResponse(result.text), modeloUsado: result.modelUsed };
}

// ---------------------------------------------------------------------------
// 5. Treinador com Memória (conversação, interpretação de fala/texto e memória contínua)
// ---------------------------------------------------------------------------

export interface TreinadorTurnoResultado {
  resposta: string;
  seriesParaRegistrar: TreinoSerieIdentificada[];
  planoParaPreencher?: {
    treino: TreinoLetra;
    exercicios: TreinoExercicioPlano[];
  };
  memoriaAtualizada: {
    resumo: string;
    ultimoTreinoFeito?: TreinoLetra;
    ultimoFocoFeito?: string;
    proximoTreinoSugerido?: TreinoLetra;
    proximoFocoSugerido?: string;
    cargasChave?: Record<string, { cargaKg: number; repeticoes: number; data: string }>;
    observacoesGerais?: string;
  };
  modeloUsado: string;
}

export function buildTreinadorPrompt(params: {
  memoria: TreinoMemoria | null;
  historicoExercicios: { exercicio: string; series: number; repeticoes: number; cargaKg: number; rpe: number; data: string }[];
  mensagensRecentes: TreinoConversaMensagem[];
  mensagemTexto?: string;
  temAudio: boolean;
  temImagem?: boolean;
}): string {
  const { memoria, historicoExercicios, mensagensRecentes, mensagemTexto, temAudio, temImagem } = params;

  const historicoTexto = historicoExercicios.length === 0
    ? "(nenhum exercício registrado ainda no histórico)"
    : historicoExercicios
        .slice(0, 15)
        .map((h) => `- ${h.data}: ${h.exercicio} — ${h.series}x${h.repeticoes} com ${h.cargaKg}kg (RPE ${h.rpe})`)
        .join("\n");

  const conversaTexto = mensagensRecentes.length === 0
    ? "(início da conversa)"
    : mensagensRecentes
        .slice(-10)
        .map((m) => `${m.autor === "usuario" ? "Aluno" : "Treinador"}: ${m.texto}`)
        .join("\n");

  const memoriaTexto = memoria
    ? `Resumo da memória: ${memoria.resumo}
Último treino: ${memoria.ultimoTreinoFeito ?? "indefinido"} (foco: ${memoria.ultimoFocoFeito ?? "indefinido"})
Próximo sugerido: ${memoria.proximoTreinoSugerido ?? "A"} (foco: ${memoria.proximoFocoSugerido ?? "Peito"})
Cargas chave: ${JSON.stringify(memoria.cargasChave)}
Observações gerais: ${memoria.observacoesGerais ?? "nenhuma"}`
    : "(primeira interação — sem memória prévia)";

  let entradaTexto = "";
  if (params.temImagem && params.temAudio) {
    entradaTexto = `O aluno enviou uma FOTO de um aparelho/máquina de academia e um ÁUDIO de voz${mensagemTexto ? ` acompanhado do texto: "${mensagemTexto}"` : ""}. Identifique o aparelho na foto, diga qual exercício é feito nele, para quais grupamentos serve e processe a pergunta/relato dele.`;
  } else if (params.temImagem) {
    entradaTexto = `O aluno enviou uma FOTO de um aparelho/máquina ou acessório da academia${mensagemTexto ? ` com a mensagem: "${mensagemTexto}"` : ""}. Identifique com precisão o aparelho na imagem, o nome comum do exercício realizado nele, os músculos trabalhados e como executar corretamente. Se ele perguntar se deve fazer ou como incluir no treino, responda de forma prática!`;
  } else if (params.temAudio) {
    entradaTexto = `O aluno enviou uma gravação de voz (áudio em anexo)${mensagemTexto ? ` acompanhada do texto: "${mensagemTexto}"` : ""}. Ouça o áudio com atenção.`;
  } else {
    entradaTexto = `O aluno enviou a mensagem: "${mensagemTexto ?? ""}"`;
  }

  return `Você é o personal trainer pessoal do Thiago, um treinador experiente, parceiro, atencioso e com MEMÓRIA contínua.

Sua filosofia e regras de treino:
- Rodízio ABC de até 40 minutos por sessão:
  * Treino A: Peito, Ombro, Tríceps
  * Treino B: Anterior (coxa), Posterior (coxa/glúteo)
  * Treino C: Costas, Bíceps, Antebraço
- Em cada sessão, todos os 3 grupamentos do dia são estimulados, mas sempre há 1 grupamento em FOCO principal (rodízio cíclico a cada repetição do treino).
- Você acompanha as cargas de cada exercício com precisão. Quando o aluno progride (aumenta carga ou repetições), você reconhece e incentiva. Se relata dor ou cansaço excessivo, adapta.

MEMÓRIA ATUAL DO TREINADOR:
${memoriaTexto}

EXERCÍCIOS RECENTES NO BANCO DE DADOS:
${historicoTexto}

HISTÓRICO RECENTE DO CHAT:
${conversaTexto}

ENTRADA DO ALUNO:
${entradaTexto}

INSTRUÇÕES OBRIGATÓRIAS:
1. Se o aluno pedir ou mandar PREENCHER/MONTAR o plano de um treino (ex.: "preencher o treino A", "monte o treino A", "crie a ficha B"):
   - Você DEVE retornar "planoParaPreencher" com o treino ("A", "B" ou "C") e pelo menos 2 exercícios por grupamento daquele treino, com "series" (ex.: 3) e "repeticoes" (ex.: "8-12").
   - Diga na "resposta" que o Plano foi montado e já está preenchido na seção de Planos ABC do app!
   - Se ele NÃO disser que realizou hoje, deixe "seriesParaRegistrar": [].
2. Se o aluno estiver relatando exercícios que fez (hoje ou no treino recém-terminado):
   - Extraia TODOS os exercícios executados em "seriesParaRegistrar".
   - Padronize os nomes dos exercícios (ex.: "Supino Reto", "Desenvolvimento", "Tríceps Corda", "Agachamento Livre", "Puxada Frontal", etc.).
   - "cargaKg": se o aluno falar a carga de cada lado (ex.: "20kg de cada lado no supino"), converta para a carga total levantada (ex.: 40kg ou 40kg + barra se especificado), e se for halteres, registre o peso do halter individual ou anote em observações.
   - Compare com a carga anterior do mesmo exercício no histórico e comente sobre o progresso na "resposta".
3. Se o aluno apenas pedir o treino do dia ou sugestão sem mandar preencher a ficha:
   - Diga qual é o treino da vez (A, B ou C), qual o foco, e liste 4 a 5 exercícios sugeridos com faixas de repetições e cargas sugeridas com base no histórico dele.
   - Deixe "seriesParaRegistrar" como lista vazia [].
4. Atualize sempre a "memoriaAtualizada":
   - Mantenha o resumo acumulado atualizado (incluindo marcos de força, preferências, restrições e o andamento do rodízio ABC).
   - "ultimoTreinoFeito" e "ultimoFocoFeito" se ele realizou um treino, e aponte "proximoTreinoSugerido" e "proximoFocoSugerido".
   - Atualize "cargasChave" com a maior carga ou carga recente dos exercícios principais.

Responda OBRIGATORIAMENTE em JSON estrito (sem cercas de markdown, sem formatação externa):
{
  "resposta": "sua mensagem para o aluno em tom profissional, motivador e direto",
  "planoParaPreencher": {
    "treino": "A",
    "exercicios": [
      { "grupamento": "Peito", "nome": "Supino Reto", "series": 3, "repeticoes": "8-12" },
      { "grupamento": "Peito", "nome": "Supino Inclinado com Halteres", "series": 3, "repeticoes": "8-12" },
      { "grupamento": "Ombro", "nome": "Desenvolvimento com Halteres", "series": 3, "repeticoes": "8-12" },
      { "grupamento": "Ombro", "nome": "Elevação Lateral", "series": 3, "repeticoes": "10-15" },
      { "grupamento": "Tríceps", "nome": "Tríceps Corda", "series": 3, "repeticoes": "10-12" },
      { "grupamento": "Tríceps", "nome": "Tríceps Testa", "series": 3, "repeticoes": "8-12" }
    ]
  },
  "seriesParaRegistrar": [
    {
      "exercicio": "Nome do exercício",
      "grupamento": "Peito",
      "series": 3,
      "repeticoes": 10,
      "cargaKg": 40,
      "rpe": 8,
      "observacoes": "..."
    }
  ],
  "memoriaAtualizada": {
    "resumo": "...",
    "ultimoTreinoFeito": "A",
    "ultimoFocoFeito": "Peito",
    "proximoTreinoSugerido": "B",
    "proximoFocoSugerido": "Anterior",
    "cargasChave": { "Supino Reto": { "cargaKg": 50, "repeticoes": 10, "data": "2026-10-11" } },
    "observacoesGerais": "..."
  }
}`;
}

export function parseTreinadorResponse(raw: string): Omit<TreinadorTurnoResultado, "modeloUsado"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(raw));
  } catch {
    throw new TreinoError(`Resposta do treinador não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new TreinoError(`Resposta JSON do treinador não é um objeto: ${raw.slice(0, 300)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const resposta = typeof obj.resposta === "string" ? obj.resposta.trim() : "";
  if (!resposta) {
    throw new TreinoError(`Campo 'resposta' ausente ou vazio na resposta do treinador: ${raw.slice(0, 300)}`);
  }

  const seriesParaRegistrar: TreinoSerieIdentificada[] = [];
  if (Array.isArray(obj.seriesParaRegistrar)) {
    for (const item of obj.seriesParaRegistrar) {
      if (item && typeof item === "object") {
        const s = item as Record<string, unknown>;
        const exercicio = typeof s.exercicio === "string" ? s.exercicio.trim() : "";
        if (exercicio) {
          seriesParaRegistrar.push({
            exercicio,
            grupamento: typeof s.grupamento === "string" ? s.grupamento.trim() : undefined,
            series: typeof s.series === "number" && s.series > 0 ? s.series : 3,
            repeticoes: typeof s.repeticoes === "number" && s.repeticoes > 0 ? s.repeticoes : 10,
            cargaKg: typeof s.cargaKg === "number" && s.cargaKg >= 0 ? s.cargaKg : 0,
            rpe: typeof s.rpe === "number" ? s.rpe : undefined,
            observacoes: typeof s.observacoes === "string" ? s.observacoes.trim() : undefined,
          });
        }
      }
    }
  }

  let planoParaPreencher: TreinadorTurnoResultado["planoParaPreencher"] = undefined;
  if (obj.planoParaPreencher && typeof obj.planoParaPreencher === "object") {
    const p = obj.planoParaPreencher as Record<string, unknown>;
    const rawTreino = typeof p.treino === "string" ? p.treino.toUpperCase().replace(/[^ABC]/g, "") : "";
    const t = rawTreino === "A" || rawTreino === "B" || rawTreino === "C" ? rawTreino : undefined;
    if (t && Array.isArray(p.exercicios)) {
      const exs: TreinoExercicioPlano[] = [];
      for (const item of p.exercicios) {
        if (item && typeof item === "object") {
          const e = item as Record<string, unknown>;
          const grupamento = typeof e.grupamento === "string" ? e.grupamento.trim() : "";
          const nome = typeof e.nome === "string" ? e.nome.trim() : "";
          const series = typeof e.series === "number" && e.series > 0 ? e.series : 3;
          const repeticoes = typeof e.repeticoes === "string" && e.repeticoes.trim() !== "" ? e.repeticoes.trim() : "8-12";
          if (grupamento && nome) {
            exs.push({ grupamento, nome, series, repeticoes });
          }
        }
      }
      if (exs.length > 0) {
        planoParaPreencher = { treino: t, exercicios: exs };
      }
    }
  }

  const memRaw = (obj.memoriaAtualizada && typeof obj.memoriaAtualizada === "object")
    ? (obj.memoriaAtualizada as Record<string, unknown>)
    : {};

  const memoriaAtualizada: TreinadorTurnoResultado["memoriaAtualizada"] = {
    resumo: typeof memRaw.resumo === "string" ? memRaw.resumo.trim() : "Treinador ativo",
    ultimoTreinoFeito: (memRaw.ultimoTreinoFeito === "A" || memRaw.ultimoTreinoFeito === "B" || memRaw.ultimoTreinoFeito === "C") ? memRaw.ultimoTreinoFeito : undefined,
    ultimoFocoFeito: typeof memRaw.ultimoFocoFeito === "string" ? memRaw.ultimoFocoFeito : undefined,
    proximoTreinoSugerido: (memRaw.proximoTreinoSugerido === "A" || memRaw.proximoTreinoSugerido === "B" || memRaw.proximoTreinoSugerido === "C") ? memRaw.proximoTreinoSugerido : undefined,
    proximoFocoSugerido: typeof memRaw.proximoFocoSugerido === "string" ? memRaw.proximoFocoSugerido : undefined,
    cargasChave: (memRaw.cargasChave && typeof memRaw.cargasChave === "object") ? (memRaw.cargasChave as Record<string, { cargaKg: number; repeticoes: number; data: string }>) : undefined,
    observacoesGerais: typeof memRaw.observacoesGerais === "string" ? memRaw.observacoesGerais : undefined,
  };

  return {
    resposta,
    seriesParaRegistrar,
    planoParaPreencher,
    memoriaAtualizada,
  };
}

export async function processarTurnoTreinador(
  apiKey: string,
  params: {
    memoria: TreinoMemoria | null;
    historicoExercicios: { exercicio: string; series: number; repeticoes: number; cargaKg: number; rpe: number; data: string }[];
    mensagensRecentes: TreinoConversaMensagem[];
    mensagemTexto?: string;
    audio?: { audioBase64: string; mimeType: string };
    imagem?: { imagemBase64: string; mimeType: string };
  },
): Promise<TreinadorTurnoResultado> {
  const prompt = buildTreinadorPrompt({
    memoria: params.memoria,
    historicoExercicios: params.historicoExercicios,
    mensagensRecentes: params.mensagensRecentes,
    mensagemTexto: params.mensagemTexto,
    temAudio: !!params.audio,
    temImagem: !!params.imagem,
  });

  const parts: Parameters<typeof callGeminiInteraction>[1] = [
    { type: "text", text: prompt },
  ];

  if (params.imagem) {
    parts.push({
      type: "image",
      data: params.imagem.imagemBase64,
      mime_type: params.imagem.mimeType,
    });
  }

  if (params.audio) {
    parts.push({
      type: "audio",
      data: params.audio.audioBase64,
      mime_type: params.audio.mimeType,
    });
  }

  const result = await callGeminiInteraction(apiKey, parts);
  const parsed = parseTreinadorResponse(result.text);
  return { ...parsed, modeloUsado: result.modelUsed };
}
