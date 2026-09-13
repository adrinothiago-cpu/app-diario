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
