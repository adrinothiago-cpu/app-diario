/**
 * Schema dos eventos do log append-only. Campos planos (sem aninhamento) —
 * já nascem no formato ideal para render direto em tabela.
 */

export interface WorkoutSetEvent {
  type: "workout_set";
  Data: string;
  Hora_Inicio: string;
  Hora_Fim: string;
  Etapa: string;
  Exercicio: string;
  Series: number;
  Repeticoes: number;
  Carga_kg: number;
  RPE: number;
  Observacoes: string;
  /** Grupamento muscular do exercício (ex.: "Peito") — presente quando lançado pela seção Treino. */
  Grupamento?: string;
  /** Vincula esta série a uma sessão da seção Treino (`treino_sessao_iniciada`/`treino_sessao_finalizada`). */
  SessaoId?: string;
  /** Duração em minutos — usado pela esteira pós-treino (cardio não tem carga/repetições). */
  Duracao_min?: number;
}

/**
 * Entrada de diário. `Conteudo` pode ficar vazio quando a entrada é só voz
 * (áudio abaixo). Áudio é gravado localmente (MediaRecorder), nunca
 * transcrito — evita mandar fala para serviços externos de reconhecimento de
 * voz, o que violaria o zero-knowledge do projeto. O blob vai como base64
 * dentro do próprio evento JSON (mesmo envelope AES-GCM de tudo mais); custa
 * ~33% de overhead sobre o binário bruto, aceitável para os áudios curtos de
 * uma entrada de diário.
 */
export interface DiaryEntryEvent {
  type: "diary_entry";
  Conteudo: string;
  Humor: 1 | 2 | 3 | 4 | 5;
  Horario: string;
  latitude: number | null;
  longitude: number | null;
  precisao: number | null;
  /** Áudio gravado localmente, codificado em base64 (sem prefixo data:). */
  audioBase64?: string;
  /** MIME real do blob gravado (varia por navegador/WebView: audio/webm, audio/mp4, etc.). */
  audioMimeType?: string;
  audioDuracaoSeg?: number;
}

/** Nível de prioridade da tarefa: 0 nenhuma, 1 baixa, 2 média, 3 alta. */
export type TodoPriority = 0 | 1 | 2 | 3;

/**
 * Listas próprias do usuário (equivalente às "Lists" do TickTick). Também
 * são append-only: renomear/recolorir geram eventos de delta, nunca editam
 * o evento de criação.
 */
export interface ListCreatedEvent {
  type: "list_created";
  listaId: string;
  nome: string;
  cor: string; // hex
}

export interface ListRenamedEvent {
  type: "list_renamed";
  listaId: string;
  nome: string;
}

export interface ListRecoloredEvent {
  type: "list_recolored";
  listaId: string;
  cor: string;
}

export interface ListDeletedEvent {
  type: "list_deleted";
  listaId: string;
}

/**
 * Tarefas são mutáveis por natureza (concluir, editar, mover, excluir) — em
 * vez de editar um registro, cada ação vira um evento de delta próprio. O
 * estado atual (lista de tarefas) é derivado reduzindo esses eventos por
 * `todoId`.
 *
 * `prioridade`/`vencimento`/`listaId` são opcionais nos eventos para
 * preservar compatibilidade com eventos antigos gravados antes desses campos
 * existirem. `listaId` ausente/null = Caixa de Entrada (lista padrão).
 */
export interface TodoCreatedEvent {
  type: "todo_created";
  todoId: string;
  texto: string;
  prioridade?: TodoPriority;
  vencimento?: string | null; // data ISO (YYYY-MM-DD) ou null
  listaId?: string | null;
}

export interface TodoToggledEvent {
  type: "todo_toggled";
  todoId: string;
  concluido: boolean;
}

/** Patch parcial: só as chaves presentes são aplicadas (chave ausente = inalterada). */
export interface TodoUpdatedEvent {
  type: "todo_updated";
  todoId: string;
  texto?: string;
  prioridade?: TodoPriority;
  vencimento?: string | null;
  listaId?: string | null;
}

/**
 * Exclusão lógica (soft delete): a tarefa sai das visões normais mas
 * permanece no log e reaparece na Lixeira, podendo ser restaurada. Segue o
 * princípio de log imutável — nada é fisicamente apagado pelo usuário.
 */
export interface TodoDeletedEvent {
  type: "todo_deleted";
  todoId: string;
}

export interface TodoRestoredEvent {
  type: "todo_restored";
  todoId: string;
}

/**
 * Configurações do app — hoje só a chave de API do Gemini (transcrição de
 * voz, ver `ARCHITECTURE.md` sobre a exceção de zero-knowledge). Igual ao
 * resto do log, é append-only: uma nova chave vira um novo evento, o
 * reducer usa sempre o mais recente. A chave viaja cifrada como qualquer
 * evento (mesmo AES-GCM 256 do vault) — nunca em texto plano no disco.
 */
export interface SettingsUpdatedEvent {
  type: "settings_updated";
  geminiApiKey: string;
}

/**
 * Transcrição de uma entrada de diário com áudio. Evento de delta
 * separado (não edita o `diary_entry` original) — mesma lógica de
 * imutabilidade do log: a entrada original nunca muda, a transcrição é
 * um fato adicional sobre ela.
 */
export interface DiaryTranscriptionAddedEvent {
  type: "diary_transcription_added";
  entryId: string;
  texto: string;
}

export type MoodTrend = "melhorando" | "piorando" | "estavel" | "sem_dados_suficientes";

export interface MoodInsights {
  resumoGeral: string;
  gatilhosPositivos: string[];
  gatilhosNegativos: string[];
  sugestoesMelhoria: string[];
  tendencia: MoodTrend;
  baseadoEmEntradas: number;
  modeloUsado?: string;
}

/**
 * Resumo evolutivo de insights de humor gerado via Gemini API.
 * Append-only como o resto do log: cada nova análise grava um evento
 * completo atualizado, e o reducer usa sempre o mais recente.
 */
export interface MoodInsightsUpdatedEvent {
  type: "mood_insights_updated";
  resumoGeral: string;
  gatilhosPositivos: string[];
  gatilhosNegativos: string[];
  sugestoesMelhoria: string[];
  tendencia: MoodTrend;
  baseadoEmEntradas: number;
  modeloUsado?: string;
}

/**
 * Itens de compra (lista de desejos/compras a fazer). Mesmo padrão de delta
 * das tarefas: criar/editar/marcar/apagar geram eventos próprios, o estado
 * atual é derivado reduzindo por `purchaseId` (ver `lib/events/purchase-store.ts`).
 */
export interface PurchaseCreatedEvent {
  type: "purchase_created";
  purchaseId: string;
  nome: string;
  quantidade?: number | null;
  observacao?: string | null;
  /** Opt-in explícito: só itens marcados entram na varredura em lote (default false — ver `incluirBusca` em `PurchaseItem`). */
  incluirBusca?: boolean;
}

/** Patch parcial: só as chaves presentes são aplicadas (chave ausente = inalterada). */
export interface PurchaseUpdatedEvent {
  type: "purchase_updated";
  purchaseId: string;
  nome?: string;
  quantidade?: number | null;
  observacao?: string | null;
  incluirBusca?: boolean;
}

export interface PurchaseToggledEvent {
  type: "purchase_toggled";
  purchaseId: string;
  comprado: boolean;
}

/** Exclusão lógica (soft delete), igual às tarefas — reaparece na Lixeira. */
export interface PurchaseDeletedEvent {
  type: "purchase_deleted";
  purchaseId: string;
}

export interface PurchaseRestoredEvent {
  type: "purchase_restored";
  purchaseId: string;
}

export interface PurchasePriceResult {
  loja: string;
  preco: number;
  url: string;
  /** Opcional: eventos antigos e resultados da Gemini não trazem. */
  nome?: string;
}

/**
 * Resultado de uma busca de menor preço via Gemini API com grounding de
 * busca do Google (`lib/insights/gemini-price-search.ts`). Append-only como
 * o resto do log: cada nova busca grava um evento completo novo, o reducer
 * usa sempre o mais recente por `purchaseId`.
 */
export interface PurchasePriceSearchUpdatedEvent {
  type: "purchase_price_search_updated";
  purchaseId: string;
  resultados: PurchasePriceResult[];
  modeloUsado?: string;
}

/**
 * Evolução: tópicos pessoais/profissionais não binários (ex.: "avaliar a
 * relação com fulano e decidir como agir") acompanhados ao longo do tempo
 * via Gemini API, em vez de forçados numa tarefa de concluir/não concluir.
 * Ver `ARCHITECTURE.md` sobre a exceção de zero-knowledge.
 */
export interface EvolucaoTopicoCriadoEvent {
  type: "evolucao_topico_criado";
  topicoId: string;
  titulo: string;
  descricao?: string;
}

/** Patch parcial: só as chaves presentes são aplicadas. */
export interface EvolucaoTopicoRenomeadoEvent {
  type: "evolucao_topico_renomeado";
  topicoId: string;
  titulo?: string;
  descricao?: string;
}

/** Soft close — tópico sai da lista ativa mas continua no log, pode ser reaberto. */
export interface EvolucaoTopicoArquivadoEvent {
  type: "evolucao_topico_arquivado";
  topicoId: string;
}

export interface EvolucaoTopicoReabertoEvent {
  type: "evolucao_topico_reaberto";
  topicoId: string;
}

/**
 * Fato imutável por entrada de diário: a Gemini classificou UMA entrada como
 * pertencente a no máximo um tópico de Evolução (ou nenhum). `versaoTopicos`
 * é um hash curto do conjunto de tópicos ativos considerado nesta rodada de
 * classificação — permite reconsiderar entradas marcadas `null` quando um
 * tópico novo é criado depois, sem nunca reprocessar entradas já vinculadas
 * a um tópico real. Ver `selectEntriesForClassification` em
 * `lib/insights/gemini-evolucao.ts`.
 */
export interface EvolucaoEntradaClassificadaEvent {
  type: "evolucao_entrada_classificada";
  entryId: string;
  topicoId: string | null;
  versaoTopicos: string;
}

/** Um critério binário dentro de uma rodada de análise — texto curto + valor atual. */
export interface EvolucaoCriterio {
  texto: string;
  valor: boolean;
}

/**
 * Uma rodada de análise de um tópico de Evolução. Ao contrário do padrão
 * "singleton por sobrescrita" de `MoodInsightsUpdatedEvent`, aqui o reducer
 * ACUMULA todas as rodadas por `topicoId` (queremos a linha do tempo
 * completa, não só a mais recente). Cada rodada é gravada uma vez e nunca
 * editada — log continua append-only puro. Os `criterios` da 2ª rodada em
 * diante têm o MESMO `texto`, na mesma ordem, que a rodada anterior do mesmo
 * tópico — só `valor` muda; é isso que permite medir evolução real.
 */
export interface EvolucaoRodadaRegistradaEvent {
  type: "evolucao_rodada_registrada";
  topicoId: string;
  criterios: EvolucaoCriterio[];
  resumo: string;
  tendencia: MoodTrend;
  baseadoEmEntradas: number;
  modeloUsado?: string;
}

/**
 * Uma mensagem do chat de um tópico de Evolução, persistida por opção
 * explícita do usuário (trade-off dele: mais espaço no cofre em troca de
 * poder reabrir um tópico e ver o que já foi dito, em vez de só o resumo).
 * Acumula por `topicoId`, igual às rodadas — nunca editada.
 */
export interface EvolucaoMensagemRegistradaEvent {
  type: "evolucao_mensagem_registrada";
  topicoId: string;
  autor: "usuario" | "ia";
  texto: string;
}

/** As três letras fixas do rodízio ABC da seção Treino (ver `ARCHITECTURE.md`). */
export type TreinoLetra = "A" | "B" | "C";

/**
 * Um exercício do banco de um treino. O foco não muda séries: muda QUANTOS
 * exercícios de cada grupamento entram na sessão (2 do foco + 2 dos demais,
 * 5º opcional — ver `selecionarExerciciosDaSessao` em `lib/events/treino-store.ts`).
 */
export interface TreinoExercicioPlano {
  grupamento: string;
  nome: string;
  series: number;
  repeticoes: string;
}

/**
 * Plano de exercícios de um treino (A/B/C). Padrão "singleton por
 * sobrescrita" igual a `MoodInsightsUpdatedEvent`: cada geração (via IA ou
 * edição manual) grava um evento completo novo, o reducer usa sempre o mais
 * recente por `treino` (`lib/events/treino-store.ts`). `grupamentos` é a
 * ordem fixa usada pelo rodízio de foco — cada sessão concluída deste treino
 * avança o foco pro próximo grupamento da lista, ciclicamente.
 */
export interface TreinoPlanoAtualizadoEvent {
  type: "treino_plano_atualizado";
  treino: TreinoLetra;
  grupamentos: string[];
  exercicios: TreinoExercicioPlano[];
  modeloUsado?: string;
}

/**
 * Início de uma sessão de treino — grava o grupamento em foco (já calculado
 * pelo rodízio no momento do clique) pra não mudar se o plano for
 * regenerado no meio do caminho. Os exercícios executados nela viram
 * eventos `workout_set` com o mesmo `SessaoId`.
 */
export interface TreinoSessaoIniciadaEvent {
  type: "treino_sessao_iniciada";
  sessaoId: string;
  treino: TreinoLetra;
  grupamentoFoco: string;
}

/** Fim de uma sessão. `feedbackIa` só existe quando o usuário pediu o parecer da IA antes de finalizar (ação manual separada). */
export interface TreinoSessaoFinalizadaEvent {
  type: "treino_sessao_finalizada";
  sessaoId: string;
  feedbackIa?: string;
  modeloUsado?: string;
}

export interface TreinoSerieIdentificada {
  exercicio: string;
  grupamento?: string;
  series: number;
  repeticoes: number;
  cargaKg: number;
  rpe?: number;
  observacoes?: string;
}

/** Mensagem no histórico do Treinador com memória (áudio ou texto). */
export interface TreinoMensagemRegistradaEvent {
  type: "treino_mensagem_registrada";
  mensagemId: string;
  autor: "usuario" | "treinador";
  texto: string;
  seriesRegistradas?: TreinoSerieIdentificada[];
}

/** Memória acumulada do treinador (cargas, dores, progresso, rodízio ABC). */
export interface TreinoMemoriaAtualizadaEvent {
  type: "treino_memoria_atualizada";
  resumo: string;
  ultimoTreinoFeito?: TreinoLetra;
  ultimoFocoFeito?: string;
  proximoTreinoSugerido?: TreinoLetra;
  proximoFocoSugerido?: string;
  cargasChave?: Record<string, { cargaKg: number; repeticoes: number; data: string }>;
  observacoesGerais?: string;
  modeloUsado?: string;
}

export type AppEvent =
  | WorkoutSetEvent
  | DiaryEntryEvent
  | ListCreatedEvent
  | ListRenamedEvent
  | ListRecoloredEvent
  | ListDeletedEvent
  | TodoCreatedEvent
  | TodoToggledEvent
  | TodoUpdatedEvent
  | TodoDeletedEvent
  | TodoRestoredEvent
  | SettingsUpdatedEvent
  | DiaryTranscriptionAddedEvent
  | MoodInsightsUpdatedEvent
  | PurchaseCreatedEvent
  | PurchaseUpdatedEvent
  | PurchaseToggledEvent
  | PurchaseDeletedEvent
  | PurchaseRestoredEvent
  | PurchasePriceSearchUpdatedEvent
  | EvolucaoTopicoCriadoEvent
  | EvolucaoTopicoRenomeadoEvent
  | EvolucaoTopicoArquivadoEvent
  | EvolucaoTopicoReabertoEvent
  | EvolucaoEntradaClassificadaEvent
  | EvolucaoRodadaRegistradaEvent
  | EvolucaoMensagemRegistradaEvent
  | TreinoPlanoAtualizadoEvent
  | TreinoSessaoIniciadaEvent
  | TreinoSessaoFinalizadaEvent
  | TreinoMensagemRegistradaEvent
  | TreinoMemoriaAtualizadaEvent;

/** Registro persistido no IndexedDB: envelope binário opaco (id em texto, resto é ciphertext). */
export interface StoredEvent {
  id: string;
  createdAt: number;
  blob: ArrayBuffer;
}

export type DecryptedEvent = AppEvent & { id: string; createdAt: number };

/** Estado derivado (não persistido) de uma tarefa, reconstruído a partir dos eventos de delta. */
export interface TodoItem {
  id: string;
  texto: string;
  concluido: boolean;
  prioridade: TodoPriority;
  vencimento: string | null;
  /** null = Caixa de Entrada (lista padrão, sem lista própria atribuída). */
  listaId: string | null;
  /** Timestamp do último todo_toggled(true); null quando não concluída. */
  concluidoEm: number | null;
  /** Timestamp do todo_deleted mais recente; null quando ativa (não está na lixeira). */
  apagadoEm: number | null;
  criadoEm: number;
}

/** Estado derivado de uma lista própria do usuário. */
export interface ListItem {
  id: string;
  nome: string;
  cor: string;
  criadoEm: number;
}

/** Estado derivado de um item de compra, reconstruído a partir dos eventos de delta. */
export interface PurchaseItem {
  id: string;
  nome: string;
  quantidade: number | null;
  observacao: string | null;
  comprado: boolean;
  compradoEm: number | null;
  apagadoEm: number | null;
  criadoEm: number;
  /** Opt-in: só true quando o usuário marcou este item explicitamente — a varredura em lote nunca pega itens não marcados. */
  incluirBusca: boolean;
  /** Resultados da última busca de preço (menor primeiro); vazio quando nunca buscado. */
  precos: PurchasePriceResult[];
  precosModeloUsado: string | null;
  /** Timestamp (createdAt do evento) da última busca de preço; null quando nunca buscado. */
  precosBuscadoEm: number | null;
}

/**
 * Entrada de diário derivada — `diary_entry` em si não tem eventos de
 * delta (sem editar/apagar ainda), mas `transcricao` é aplicada por cima
 * via `diary_transcription_added` (ver `lib/events/diary-store.ts`).
 */
export interface DiaryEntryItem {
  id: string;
  conteudo: string;
  humor: 1 | 2 | 3 | 4 | 5;
  horario: string;
  latitude: number | null;
  longitude: number | null;
  precisao: number | null;
  audioBase64: string | null;
  audioMimeType: string | null;
  audioDuracaoSeg: number | null;
  /** Preenchida via transcrição do áudio (Gemini API) — null enquanto não transcrito. */
  transcricao: string | null;
  criadoEm: number;
}

/** Estado derivado de um tópico de Evolução, com a linha do tempo completa de rodadas. */
export interface EvolucaoTopico {
  id: string;
  titulo: string;
  descricao: string | null;
  criadoEm: number;
  arquivadoEm: number | null;
  /** Cronológico, mais antiga primeiro. */
  rodadas: EvolucaoRodada[];
  /** Cronológico, mais antiga primeiro — histórico do chat, ver `EvolucaoMensagemRegistradaEvent`. */
  mensagens: EvolucaoMensagem[];
}

export interface EvolucaoMensagem {
  autor: "usuario" | "ia";
  texto: string;
  criadoEm: number;
}

export interface EvolucaoRodada {
  criterios: EvolucaoCriterio[];
  resumo: string;
  tendencia: MoodTrend;
  baseadoEmEntradas: number;
  modeloUsado?: string;
  criadoEm: number;
}

/** Estado derivado de uma classificação de entrada — usado como checkpoint incremental. */
export interface EvolucaoClassificacao {
  entryId: string;
  topicoId: string | null;
  versaoTopicos: string;
  criadoEm: number;
}

/** Estado derivado do plano de um treino (A/B/C) — sempre o `treino_plano_atualizado` mais recente daquela letra. */
export interface TreinoPlano {
  treino: TreinoLetra;
  grupamentos: string[];
  exercicios: TreinoExercicioPlano[];
  modeloUsado: string | null;
  atualizadoEm: number;
}

/** Um exercício executado dentro de uma sessão (`workout_set` vinculado por `SessaoId`). */
export interface TreinoSerieRegistrada {
  exercicio: string;
  grupamento: string | null;
  series: number;
  repeticoes: number;
  cargaKg: number;
  rpe: number;
  observacoes: string;
  duracaoMin: number | null;
  criadoEm: number;
}

/** Estado derivado de uma sessão de treino, com as séries executadas nela. */
export interface TreinoSessao {
  id: string;
  treino: TreinoLetra;
  grupamentoFoco: string;
  iniciadoEm: number;
  finalizadoEm: number | null;
  feedbackIa: string | null;
  modeloUsado: string | null;
  /** Cronológico, mais antiga primeiro. */
  series: TreinoSerieRegistrada[];
}
