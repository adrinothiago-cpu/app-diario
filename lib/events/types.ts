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
  | TodoRestoredEvent;

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

/**
 * Entrada de diário derivada — `diary_entry` não tem eventos de delta (sem
 * editar/apagar ainda), então isso é praticamente o evento decifrado
 * carregando também `id`/`criadoEm` com nomes consistentes com os outros
 * itens derivados (`TodoItem`, `ListItem`).
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
  criadoEm: number;
}
