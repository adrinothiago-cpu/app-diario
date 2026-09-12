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
  `AndroidManifest.xml`, gradle e recursos nativos.
- **Persistência local**: IndexedDB via wrapper leve próprio (sem ORM pesado).
- **Remoto**: Google Drive REST API, apenas `/appDataFolder`, apenas payloads
  cifrados. Sem banco relacional hospedado, sem Vercel/Node em produção.

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

## Comandos

- `npm run dev` — servidor de desenvolvimento.
- `npm run build` — export estático em `out/`.
- `npm run lint` — ESLint (ignora `.next/`, `out/`, `android/`).
- `npx cap sync android` — copia `out/` + plugins para o projeto Android
  (exige `npm run build` antes).
- Build da APK: `cd android && ./gradlew assembleDebug` (exige Android SDK;
  ver pendências no `PROJECT_HANDOFF.md`).
