# app_diário

Diário pessoal e tracker de treino híbrido (PC via PWA + Android via Capacitor).
**100% offline-first, zero-knowledge, sem backend próprio.** Estas regras são
imutáveis; mudanças exigem decisão explícita do dono do projeto registrada no
`PROJECT_HANDOFF.md`.

## Stack

- **Next.js (App Router)** com `output: 'export'` — export estático obrigatório.
  Proibido: SSR, ISR, API routes, Server Actions, `next/image` otimizado ou
  qualquer recurso que exija servidor Next em runtime.
- **React + TypeScript + Tailwind CSS v4** (tokens de tema em `app/globals.css`
  via `@theme inline`).
- **Capacitor** empacota o export estático (`out/`) na APK Android
  (`capacitor.config.ts`, webDir `out`). O diretório `android/` é gerado/gerido
  pelo Capacitor — nunca editar bundles em `android/app/src/main/assets/public`
  (são cópias de build); mudanças manuais legítimas ficam restritas a
  `AndroidManifest.xml`, gradle e recursos nativos (ex: captura de áudio via
  WebView `getUserMedia` exige tanto `RECORD_AUDIO` quanto `MODIFY_AUDIO_SETTINGS`
  declaradas no `AndroidManifest.xml` devido ao `BridgeWebChromeClient` do Capacitor).
- **Persistência local**: IndexedDB via wrapper leve próprio (sem ORM pesado).
- **Remoto**: Google Drive REST API, apenas `/appDataFolder`, apenas payloads
  cifrados. Sem banco relacional hospedado, sem Vercel/Node em produção.
  Implementado em 2026-09-28 (`lib/sync/`, `components/sync-provider.tsx`):
  - Cada evento vira o arquivo `<id>.enc` (o mesmo blob IV||ciphertext do
    IndexedDB); sync = união por id (log append-only, sem conflito).
  - `vault.json` guarda o salt do PBKDF2 (não é segredo). Aparelho com salt
    diferente adota o do Drive: pede a senha daquele cofre, confere
    decifrando um evento remoto, e então **arquiva em quarentena** (store
    `quarantine` no IndexedDB, `lib/db/indexeddb.ts`) os eventos locais —
    saem do log ativo e nunca são enviados ao Drive, mas continuam no
    aparelho, cifrados como estavam (sem recifrar/reescrever). **Revisão
    2026-09-29 (achado do Thiago)**: a versão original recifrava e mesclava
    o que já existia localmente no cofre adotado — ele apontou que isso é
    uma brecha (dado de uma sessão/senha diferente virando parte do cofre
    de verdade sem intenção clara) e que apagar de vez também era
    arriscado; o meio-termo ficou "sai da lista, mas nada é destruído",
    recuperável depois pela senha antiga sem precisar reescrever.
  - Escopo OAuth só `drive.appdata`. Token só em memória. Login: PC via
    janela OAuth (`public/oauth-callback.html` devolve por
    `BroadcastChannel`); Android via `GoogleDriveAuthPlugin.java`
    (`AuthorizationClient` do Play Services — Google bloqueia login em WebView).
  - Clientes OAuth "Web" e "Android" no **mesmo** projeto Google Cloud (a
    `appDataFolder` é por projeto). Client ID web em
    `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` (público por design; sem client secret).
- **Exceção pontual (decisão do Thiago, 2026-09-11)**: auto-update consulta a
  API pública do GitHub (`lib/update/check-update.ts`) para saber a versão
  mais recente e baixar o APK do release — único tráfego de rede do app que
  não é sync com o Drive. GET anônimo, sem autenticação, sem enviar nenhum
  dado do usuário; só pergunta "qual a versão mais nova?". Repositório:
  `github.com/adrinothiago-cpu/app-diario` (público — precisa ser público
  para a checagem funcionar sem token embutido no app).
- **Exceção de zero-knowledge (decisão do Thiago, 2026-09-13)**: transcrição
  de áudio via Gemini API (`lib/transcription/gemini.ts`) — manda
  **conteúdo do usuário** (o áudio de uma entrada de diário) para um servidor
  de terceiro. É ação manual, por entrada, nunca automática — sem clicar em
  "Transcrever" o áudio nunca sai do aparelho. Chave usada é do **tier gratuito**
  do Google AI Studio; ciente de que esse tier permite ao Google usar o conteúdo
  enviado para treinar/melhorar produtos deles (diferente do tier pago/Vertex AI,
  que tem garantia contratual de não retenção). A chave de API em si fica cifrada
  localmente com o mesmo AES-GCM 256 do vault (evento `settings_updated`) —
  nunca em texto plano no disco, nunca no código-fonte (o repo é público).
- **Exceção de zero-knowledge ampliada — Insights de Humor (decisão do Thiago, 2026-09-13)**:
  análise evolutiva de humor via Gemini API (`lib/insights/gemini-insights.ts`,
  página `/metricas`). Expande o escopo anterior: em vez de apenas o áudio de uma
  entrada pontual, envia o texto (escrito e/ou transcrito) de até 30 entradas
  recentes de uma vez para extrair padrões de humor, gatilhos positivos/negativos
  e sugestões de melhoria. Assim como a transcrição, é estritamente manual (só roda
  ao clicar em "Atualizar insights") e usa a mesma chave da Gemini API cifrada no
  vault. O resultado é persistido como evento append-only (`mood_insights_updated`)
  e reduzido sempre para a análise mais recente (`lib/events/mood-insights-store.ts`)
  — o log cresce, mas o estado exibido evolui sem acumular listas infinitas.
  **Diretrizes de feedback**: sem filtros moralistas, tabus ou preocupações com
  "politicamente correto". Avaliação binária consequencialista (gerou bem-estar e
  satisfação = ponto positivo com reforço psicológico; causou atrito ou problema =
  ponto negativo objetivo), focada na recompensa e na evolução da pessoa em
  relação a si mesma.
- **Exceção de zero-knowledge ampliada — Sugestão de tarefas via diário (decisão
  do Thiago, 2026-09-24)**: `lib/insights/gemini-task-suggestions.ts`, botão na
  página `/tarefas`. Envia o texto (escrito e/ou transcrito) de até 15 entradas
  recentes do diário à Gemini API para identificar pendências/compromissos
  mencionados e sugeri-los como tarefas. Estritamente manual em duas etapas: abrir
  o painel não envia nada; só o clique em "Gerar sugestões agora" dispara a
  chamada. Nada é persistido automaticamente — o resultado é uma lista efêmera
  (nunca vira evento) que o usuário revisa e marca item a item; só as sugestões
  aceitas viram `todo_created` de verdade. Mesma chave da Gemini API já cifrada
  no vault (evento `settings_updated`), nenhum schema novo de armazenamento.
- **Exceção de zero-knowledge ampliada — Busca de menor preço via Compras
  (decisão do Thiago, 2026-09-28)**: `lib/insights/gemini-price-search.ts`,
  página `/compras`. Envia o nome (e observação opcional) de um item de
  compra à Gemini API com a ferramenta `google_search` habilitada (grounding
  real com busca do Google — sem isso o modelo só alucinaria preços de
  memória). Trigger é opt-in por item: o usuário marca "Varrer" no item (ou
  usa o botão de busca individual) — nunca varre a lista inteira sem marcação
  explícita, já que cada busca é uma chamada real e paga à Gemini API. O
  resultado (lojas + preço + link) é persistido como evento append-only
  (`purchase_price_search_updated`), reduzido sempre pro mais recente por
  item (`lib/events/purchase-store.ts`). Mesma chave da Gemini API já cifrada
  no vault.
  - **Segunda fonte: Buscapé (decisão do Thiago, 2026-09-28)** —
    `lib/prices/buscape.ts`, sem chave de API. Envia só o nome/observação
    do item a `buscape.com.br`. As duas fontes rodam juntas
    (`lib/prices/search.ts`); se a Gemini não tiver chave ou ela for
    inválida, a busca segue só com o Buscapé e o aviso aparece no final
    com link pro Diário — a automação nunca para por falta de chave.
    O Buscapé não libera CORS: no Android o app usa HTTP nativo
    (`CapacitorHttp`, `lib/prices/buscape-in-app.ts`); no PWA de PC usa o
    servidor local de preços (exceção abaixo).
- **Exceção de backend — servidor local de preços, só pra Compras (decisão
  do Thiago, 2026-09-28)**: única exceção à regra "sem backend próprio".
  `scripts/servidor-precos.ts` (`npm run servidor-precos`, ou
  `npm run dev:compras` junto do Next) existe só pra contornar o CORS do
  Buscapé no PWA de PC. Limites que mantêm a exceção pequena:
  - roda **só na máquina do Thiago**, escuta só em `127.0.0.1` (nunca na
    rede, nunca hospedado), não guarda nada;
  - só aceita como origem o próprio app local (`localhost:3000`) — outra
    origem recebe 403 antes de qualquer busca;
  - uma rota só, `GET /buscape?q=`, que faz busca + ranking e devolve os
    resultados — **não** é proxy genérico de URL;
  - recebe só o nome/observação do item; nenhum dado do cofre passa por ele.
  Se não estiver rodando, a busca no PC segue só com a Gemini e a linha do
  item diz como subir o servidor. Qualquer outro uso de backend continua
  proibido.
  - **CLI**: `npm run buscar-preco -- "produto"` (`scripts/buscar-preco.ts`,
    Node puro com type stripping, zero dependência nova, fora do build) usa
    as mesmas fontes. Chave da Gemini lida de `GEMINI_API_KEY` em
    `.env.local` na raiz (ignorado pelo git) — arquivo em texto plano, não
    deve entrar em backup/sync em nuvem sem cifrar.

## Desbloqueio por biometria (Android, opcional — decisão do Thiago, 2026-09-24)

- **Escopo**: só Android nativo (Capacitor). No PWA de PC o desbloqueio
  continua exclusivamente por senha.
- **Mecanismo**: plugin nativo próprio `BiometricPlugin.java` (mesmo padrão
  de `MicrophonePlugin`/`UpdaterPlugin`, sem dependência de terceiro). A
  senha do cofre — não a chave AES derivada, que nunca é extraível — fica
  cifrada em `SharedPreferences` privado do app, usando uma chave AES-GCM
  que existe só dentro do **Android Keystore** com
  `setUserAuthenticationRequired(true)`: o sistema operacional só libera
  essa chave para cifrar/decifrar depois de um `BiometricPrompt`
  bem-sucedido, e ela nunca sai do hardware seguro do aparelho (TEE/
  StrongBox), nem com root. `setInvalidatedByBiometricEnrollment(true)`
  derruba a chave se uma digital nova for cadastrada no aparelho, forçando
  reativação manual com a senha.
- **Mudança de modelo de ameaça, aceita conscientemente**: até aqui a senha
  nunca persistia em lugar nenhum (só a chave derivada, em memória, durante
  a sessão). Ativar esta opção passa a manter a senha cifrada em disco,
  protegida só pelo Keystore do aparelho. É opt-in (desativado por padrão),
  reversível a qualquer momento (`components/biometric-unlock-settings.tsx`,
  botão "Desativar" apaga o segredo e a chave do Keystore), e ativar exige
  confirmar a senha atual antes de cadastrar.
- `android:allowBackup="false"` já era a configuração do app — o segredo
  cifrado nunca é incluído em backup automático do Android/Google.

## Segurança (inegociável)

- Chave mestre derivada da senha via **PBKDF2** (Web Crypto), salt único por
  usuário, **mínimo 600.000 iterações**.
- Todo dado persistido (IndexedDB ou Drive) é cifrado com **AES-GCM 256** antes
  de sair da RAM. O Drive só vê blobs opacos.
- Token de sessão assinado com **HMAC-SHA256** contendo expiração interna.
- Comparações de segredos sempre em **tempo constante**.
- **Rate-limit de login**: máx. 5 tentativas por janela de 15 minutos.
- Nunca logar senha, chave, plaintext de entradas ou coordenadas em console,
  arquivos ou telemetria.
- **`android.loggingBehavior: "none"`** em `capacitor.config.ts` (decisão do
  Thiago, 2026-09-24, achado durante depuração real do desbloqueio por
  digital via `adb logcat`): o padrão do Capacitor (`"production"`) ainda
  loga em nível verbose os argumentos de toda chamada de plugin em builds
  *debug* — foi assim que a senha do cofre apareceu em texto puro no logcat
  ao ativar o desbloqueio por digital. `"none"` desliga esse log do bridge
  nativo em qualquer tipo de build. Nunca reverter para o padrão sem
  substituir por outra forma de evitar logar argumentos sensíveis de plugin.

## Arquitetura de dados (event store local-first)

- **Log append-only**: cada ação gera um evento imutável
  `evt_{timestamp}_{uuid}.enc`. Eventos nunca são editados ou apagados para
  corrigir estado; correções geram novos eventos.
- **Sync por evento individual** no `appDataFolder` do Drive (proibido JSON
  monolítico). O estado consolidado é reconstruído no IndexedDB a partir do log.
- **Bruto vs. derivado**: dado bruto é definitivo; gráficos/médias/estatísticas
  são derivados em memória com cache invalidável — nunca persistidos como fonte
  de verdade.
- **Registro local é imediato**; sync com o Drive roda em segundo plano quando
  houver conectividade. A UI nunca bloqueia esperando rede.

## UI e convenções

- **Tema único dark**, definido em `app/globals.css`. Proibido usar variantes
  `dark:` condicionais ou `@media (prefers-color-scheme)` — não existe troca de
  tema.
- **Modo Privacidade** ("esconder dados sensíveis"): estado em `localStorage`
  lido via `useSyncExternalStore`; o snapshot de servidor/prerender retorna
  sempre `false` (fallback seguro, sem hydration mismatch).
- **DevTag** (`components/dev-tag.tsx`): seções principais renderizam
  `<DevTag id="caminho/arquivo.tsx#Componente" />` — visível apenas em
  `NODE_ENV=development`, texto `select-all`.
- Idioma da UI e da documentação: **português (pt-BR)**.

## Qualidade e processo

- `npm run build` e `npm run lint` **zerados** são o mínimo antes de encerrar
  qualquer sessão de trabalho.
- Toda mudança de UI deve declarar explicitamente: **validada visualmente**
  (navegador/dispositivo) ou **apenas compilada**.
- Cada sessão de trabalho registra decisões e estado no `PROJECT_HANDOFF.md`.

> Regras de git/commit, modelo por tarefa e estilo de resposta agora vivem em
> `~/.claude/CLAUDE.md` (regra global, vale pra todos os projetos).

## Comandos e Processo de Release

- `npm run dev` — servidor de desenvolvimento.
- `npm run build` — export estático em `out/`.
- `npm run lint` — ESLint (ignora `.next/`, `out/`, `android/`).
- `npm test` — testes unitários via Vitest.
- `npx cap sync android` — copia `out/` + plugins para o projeto Android (exige `npm run build` antes).
- Build da APK: `./gradlew assembleDebug` dentro da pasta `android/`.
- **Publicação e Atualizações (Decisão do Thiago, 2026-09-13)**: o processo de release e atualização é **exclusivamente via GitHub Releases** (`gh release create v<versionCode> android/app/build/outputs/apk/debug/app-debug.apk --title "<versionName>" --notes "..."`). Não subir mais APK no Google Drive: o próprio app possui auto-update (`components/update-banner.tsx`) que detecta novas tags no GitHub e baixa/instala o APK de forma assistida.
- **Identificação de versão na UI**: o componente `AppVersion` (`components/app-version.tsx`) consulta `App.getInfo()` no Android e renderiza `v<versionName> (<versionCode>)` no topo em `TopTabs` e no rodapé da página inicial, permitindo ao usuário conferir a versão ativa em tempo real.
