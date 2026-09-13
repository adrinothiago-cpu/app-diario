# PROJECT_HANDOFF.md — Histórico de Sessões

Log narrativo de decisões e estado do projeto. Cada sessão adiciona uma seção
no topo. Regras permanentes ficam no `ARCHITECTURE.md`; aqui fica o "porquê" e o
"quando".

---

## Sessão 2026-09-13 — Transcrição de voz via Gemini API

### O que foi feito

Depois de confirmar a gravação de voz funcionando (sessão anterior), o
Thiago pediu transcrição. Isso reabriu a decisão de "não transcrever" da
sessão de bootstrap da feature — dessa vez ele decidiu abrir a exceção
conscientemente, depois de eu apontar os dois custos reais: (1) quebra do
zero-knowledge (o áudio sai do aparelho) e (2) o tier gratuito do Google AI
Studio permite ao Google usar o conteúdo enviado para treinar produtos
deles (diferente do tier pago/Vertex AI). Decisão registrada em
`ARCHITECTURE.md`.

- **Segurança da chave**: ele perguntou se colar a chave de API no chat
  configurava risco — sim, e por isso ela nunca transitou por mim. Um
  campo de configuração dentro do próprio app (link "Configurar
  transcrição" no Diário) é onde ele cola a chave; fica cifrada com o
  mesmo AES-GCM 256 do vault (evento `settings_updated`, append-only —
  trocar a chave é só gravar um evento novo), nunca em texto plano, nunca
  no código-fonte do repositório (que é público).
- **Descoberta de API muito recente**: a doc pública (`ai.google.dev`) já
  não usa mais o formato antigo `generateContent`/`candidates` que eu
  conhecia — é uma API nova chamada "Interactions"
  (`/v1beta/interactions`, payload `{model, input: [{type, text|data}]}`).
  Como um `WebFetch` inicial trouxe detalhes estranhos (nome de modelo e
  endpoint que pareciam errados), não confiei cegamente: baixei o HTML
  bruto da doc e extraí os exemplos de código reais via grep/python antes
  de implementar, em vez de confiar no resumo de um modelo pequeno sobre
  uma API lançada depois do meu treinamento.
- **Schema novo**: `SettingsUpdatedEvent` (chave de API) e
  `DiaryTranscriptionAddedEvent` (delta sobre uma entrada existente, por
  `entryId` — não edita o evento `diary_entry` original, mesmo princípio
  de imutabilidade do log). `lib/transcription/gemini.ts` faz a chamada
  HTTP; parsing da resposta é deliberadamente tolerante (tenta
  `output_text`, senão varre `steps[].content[]`) porque a doc pública não
  expõe o schema de resposta completo — **ainda não testado com uma chave
  real**, então o formato de parsing pode precisar de ajuste no primeiro
  uso de verdade.
- UI: botão "Transcrever" aparece só em entradas com áudio, sem
  transcrição ainda, e com chave configurada. Corrigido durante o teste
  visual um bug de layout (botões "Salvar"/"Cancelar" cortados em tela
  estreita — iam na mesma linha do input, agora ficam embaixo).

### Estado de verificação

- `npm run lint`/`test` (89/89, 13 novos)/`build`: ✅.
- **Validado visualmente no emulador**: campo de configuração aparece,
  layout correto, botão "Transcrever" ausente corretamente quando não há
  chave configurada.
- **Não validado**: a chamada real à Gemini API — não tenho a chave (por
  desenho, ela nunca deveria passar por mim) e não configurei uma real no
  emulador para testar de ponta a ponta. Isso é a pendência mais
  importante: o parsing de resposta em `extractOutputText` pode falhar no
  primeiro teste real, precisa de olho no `transcribeError` mostrado na UI
  se isso acontecer.
- `versionCode 11` / `versionName "1.5"`, release `v11` publicado no
  GitHub e copiado para o Drive.

### Pendências

1. Thiago colar a chave real no app, testar "Transcrever" numa entrada com
   áudio, e reportar se `extractOutputText` conseguiu extrair o texto ou
   se o formato de resposta real da Interactions API é diferente do
   esperado (nesse caso, preciso ver o corpo bruto da resposta — a
   mensagem de erro na UI inclui um trecho do JSON recebido para isso).
2. Pendências antigas seguem abertas: responsividade da guia Tarefas,
   tela de login, OAuth do Drive, assinatura de release, geolocalização
   das entradas de diário.

---

## Sessão 2026-09-12 — Causa raiz do bug do microfone: MODIFY_AUDIO_SETTINGS

### O que foi feito

Depois de mais uma rodada de testes sem sucesso via `adb`/emulador, o
Thiago abriu o projeto no **Android Studio** com o S25 Ultra físico
conectado via USB e Logcat ao vivo, e pediu ajuda à IA integrada
(Gemini). Com acesso ao dispositivo real (que eu não tinha), ela achou a
causa raiz de verdade.

**O bug**: o `BridgeWebChromeClient` padrão do Capacitor (código-fonte em
`node_modules/@capacitor/android`, não customizado por nós) trata o
`AUDIO_CAPTURE` que o WebView pede internamente durante `getUserMedia`
solicitando **duas** permissões juntas: `RECORD_AUDIO` **e**
`MODIFY_AUDIO_SETTINGS`. Meu `MicrophonePlugin` só pedia `RECORD_AUDIO`
— por isso `dumpsys` sempre mostrava ela `granted=true`, mascarando o
problema real. Como `MODIFY_AUDIO_SETTINGS` nunca estava declarada no
`AndroidManifest.xml`, o sistema nunca conseguia concedê-la de verdade; o
Capacitor trata "nem tudo da lista foi concedido" como negação total e
chama `request.deny()`, resultando no `NotAllowedError` persistente — em
todas as sessões anteriores, no emulador e no celular físico, sempre pela
mesma causa que nenhuma das correções anteriores (user-gesture, cache do
WebView, desinstalação completa) sequer tocava.

**Correção**: uma linha — `<uses-permission
android:name="android.permission.MODIFY_AUDIO_SETTINGS" />` no manifest.
É permissão "normal" (não perigosa): concedida automaticamente na
instalação assim que declarada, não precisa de request em runtime (por
isso o `MicrophonePlugin` não precisou mudar).

### Estado de verificação

- `npm run lint`/`test` (77/77)/`build`: ✅.
- **Confirmado funcionando de verdade no emulador**: fluxo "Permitir
  microfone" → "Gravar áudio" → indicador nativo do microfone (ícone
  verde) aparece na barra de status → grava → player de áudio funcional
  com a entrada salva na lista, tocando o áudio de volta.
- `versionCode 10` / `versionName "1.4"`, release `v10` publicado, APK
  copiado para o Drive.
- Corrigido também um deslize: um commit anterior acidentalmente subiu a
  pasta `.idea/` do Android Studio pro repositório — removida do controle
  de versão e adicionada ao `.gitignore`.
- **Confirmado e validado com sucesso no celular físico do Thiago (Samsung Galaxy S25 Ultra)**: A gravação de voz com `getUserMedia` + `MediaRecorder` funcionou perfeitamente no dispositivo real após a inclusão de `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />` no `AndroidManifest.xml`. O indicador de microfone verde do Android acende, o áudio é gravado sem `NotAllowedError` e o player reproduz a entrada do diário perfeitamente. Bug definitivamente resolvido!

### Pendências

1. Pendências antigas seguem abertas: responsividade da guia Tarefas,
   tela de login, OAuth do Drive, assinatura de release, geolocalização
   das entradas de diário.

---

## Sessão 2026-09-11 (parte 5) — Auto-update funcionando de ponta a ponta

### O que foi feito

Thiago testou o auto-update pela primeira vez em produção: banner apareceu
("Nova versão disponível: 1.2") corretamente, mas o download falhou
("Falha ao baixar"). Investigação revelou **4 bugs sucessivos**, cada um
escondendo o próximo até ser corrigido — todos encontrados testando o
ciclo completo no emulador (instalar versão N, publicar release N+1,
clicar Atualizar, repetir):

1. **CORS no fetch**: a URL de um asset do GitHub Release redireciona para
   o Azure Blob Storage, que não envia `Access-Control-Allow-Origin`. O
   `fetch()` original (rodando no WebView) sempre falhava — confirmado no
   `logcat`: "blocked by CORS policy". Corrigido movendo o download inteiro
   para `DownloadManager` nativo do Android (fora do WebView, não sujeito a
   CORS). `@capacitor/filesystem` não é mais necessário, removido.
2. **Crash por `VISIBILITY_HIDDEN`**: essa opção do `DownloadManager`
   exige a permissão especial `DOWNLOAD_WITHOUT_NOTIFICATION` (não
   declarada) — lançava `SecurityException` e derrubava o app inteiro
   (o "Chrome apareceu do nada" no teste era só a activity anterior na
   pilha, depois do crash). Trocado para `VISIBILITY_VISIBLE_NOTIFY_COMPLETED`
   + `try/catch` para nunca mais crashar por erro deste plugin.
3. **`RECEIVER_NOT_EXPORTED` bloqueando o broadcast**: o
   `ACTION_DOWNLOAD_COMPLETE` vem do processo do sistema
   (`DownloadManager`), não do próprio app — com `NOT_EXPORTED` o
   broadcast nunca chegava. O sintoma era sutil: o arquivo já estava
   baixado com sucesso no disco, mas a Promise do JS ficava pendente para
   sempre ("Baixando…" eterno). Corrigido para `RECEIVER_EXPORTED`.
4. **Race condition**: mesmo com `EXPORTED`, o receiver era registrado
   *depois* de `downloadManager.enqueue()` — em downloads rápidos (APK
   pequeno, rede boa) o evento disparava e se perdia antes do registro
   completar. Corrigido invertendo a ordem.

**Confirmado funcionando de ponta a ponta no emulador**: banner → baixa
(notificação de progresso visível) → detecta que falta permissão de
"instalar apps desconhecidos" → abre a tela de Ajustes → após habilitar,
clique em Atualizar de novo → instalador do sistema → "App installed."

### Estado de verificação

- `npm run lint`/`test` (77/77)/`build`: ✅ em cada uma das 4 correções.
- Ciclo completo validado no emulador (não só componentes isolados como
  na sessão anterior).
- **versionCode 9 / versionName "1.3"** — esta build tem tanto a correção
  do auto-update quanto a correção do microfone da sessão anterior
  (user-gesture). Copiada para o Drive — Thiago precisa instalar
  manualmente esta *uma última vez*; a partir dela, o próprio app se
  atualiza sozinho.
- Releases `v2` a `v8` no GitHub são builds intermediários de depuração
  (não removidos, mas irrelevantes) — só `v9` em diante importa.
- **Ainda não confirmado no celular físico** — nem o auto-update nem a
  correção do microfone foram testados fora do emulador nesta sessão.

### Pendências

1. Thiago instalar a v9 manualmente e confirmar: (a) microfone grava de
   verdade, (b) o próprio app se atualiza sozinho a partir daqui.
2. Pendências antigas seguem abertas: responsividade da guia Tarefas,
   tela de login, OAuth do Drive, assinatura de release, geolocalização
   das entradas de diário.

---

## Sessão 2026-09-11 (parte 4) — Consulta ao Gemini, causa raiz do bug de microfone isolada

### O que foi feito

Thiago pediu para consultar o Gemini (`~/projetos/24-gemini-terminal/gemini.py`)
sobre o `NotAllowedError` persistente. Resposta apontou 4 hipóteses; duas se
mostraram relevantes:

1. **User gesture do Chromium**: `getUserMedia` precisa ser a primeira
   coisa chamada a partir do clique que o originou. O código da sessão
   anterior fazia `await ensureMicrophonePermission()` (pedido nativo,
   pode envolver diálogo do sistema) *antes* de `getUserMedia` — esse
   `await` quebra a "user activation" do clique, e o Chromium passa a
   tratar a chamada seguinte como não iniciada por gesto do usuário,
   rejeitando com `NotAllowedError` **mesmo com a permissão concedida**.
2. **Cache de permissão do WebView por origem**: cogitado que uma negação
   antiga (antes de qualquer plugin nativo existir) poderia ter ficado
   persistida para a origem `https://localhost`, ignorando o estado atual.

**Correção aplicada** (ambas eliminadas como causa):
- `MicrophonePlugin.java` ganhou `checkMicrophonePermission` (lê sem
  pedir) separado de `requestMicrophonePermission` (pede, pode mostrar
  diálogo).
- `app/diario/page.tsx`: UI virou dois passos — botão "Permitir
  microfone" (chama só o pedido nativo, pode demorar/mostrar diálogo) e,
  só depois de concedida, o botão normal "Gravar áudio" que chama
  `getUserMedia` **diretamente**, primeira linha do handler, sem nenhum
  `await` antes.
- Testado no emulador com **desinstalação completa** (`adb uninstall`,
  não só `-r`) para eliminar cache de permissão do WebView como variável.

**Resultado**: mesmo com as duas causas eliminadas, o emulador reproduziu
o **exato mesmo erro**. Isso muda a conclusão — não é mais só suspeita, é
a evidência mais forte até agora de que **o emulador realmente não tem
microfone funcional disponível para o Chromium**, e não um bug de código.
O Thiago **nunca testou esta versão corrigida no celular físico** (só
tinha testado a versão anterior, com o bug do user-gesture) — esse é o
teste que decide se a causa era mesmo só o emulador ou se ainda falta algo.

Corrigido, versionado (`v3` / `versionCode 3` / `versionName "1.2"`),
publicado no GitHub Release e copiado pro Drive. O Thiago foi dormir antes
de testar — pendência nº 1 para quando ele acordar.

### Estado de verificação

- `npm run lint`/`test` (77/77)/`build`: ✅.
- `./gradlew assembleDebug`: ✅.
- Release `v3` publicado; APK também no Drive.
- **Ainda não confirmado em hardware real** — é literalmente a única coisa
  que falta pra fechar esse bug.

---

## Sessão 2026-09-11 (parte 3) — Repositório GitHub, auto-update, bug do microfone segue aberto

### O que foi feito

- **Projeto virou repositório git** (não existia antes). Push para
  `github.com/adrinothiago-cpu/app-diario`, **público** — necessário para o
  auto-update funcionar sem token embutido no app. Remote em HTTPS, e-mail
  de commit `adrinothiago@gmail.com`, ambos conforme regra global.
  `.gitignore` ganhou entradas para `android/build`, `.gradle`,
  `local.properties`, `assets/public` (cópia gerada pelo `cap sync`) e
  `*.apk`/`*.aab`.
- **Auto-update via GitHub Releases** (`lib/update/check-update.ts` +
  `lib/native/updater.ts` + `UpdaterPlugin.java` +
  `components/update-banner.tsx`): o app consulta
  `api.github.com/repos/.../releases/latest` (GET público, sem token, sem
  enviar dado nenhum do usuário — registrado como exceção pontual no
  `ARCHITECTURE.md`), compara a tag (`vN`) com o `versionCode` local via
  `App.getInfo()`, e se houver mais nova mostra um banner fixo no topo com
  botão "Atualizar". Botão baixa o APK (`fetch` + `@capacitor/filesystem`
  salvando em `Directory.Cache`) e aciona `UpdaterPlugin.installApk`, que
  abre o instalador do sistema via `FileProvider` — ou, se o Android ainda
  não autorizou "instalar apps desconhecidos" para o Diário, abre a tela de
  Ajustes correspondente (não dá pra pular essa etapa manual, é permissão
  especial do Android, só concedida por interação direta do usuário).
- **Convenção de release**: tag do GitHub = `v<versionCode>` (ex: `v2`),
  sempre com o `.apk` de `assembleDebug` anexado como asset. `versionCode`
  bumpado para `2` / `versionName "1.1"` nesta sessão — é o primeiro
  release (`v2`) que existe no repositório.
- `@capacitor/filesystem` instalado (necessário para salvar o APK baixado
  antes de instalar).

### Bug do microfone — ainda não resolvido

Criei `MicrophonePlugin.java` (pede `RECORD_AUDIO` nativamente, via o
mesmo mecanismo que `@capacitor/geolocation` já usa) para rodar **antes**
de `getUserMedia`, eliminando qualquer dúvida sobre timing/canal de
permissão. Testado no emulador: `dumpsys` confirma
`RECORD_AUDIO: granted=true` no momento exato da falha, e mesmo assim
`getUserMedia` segue rejeitando com `NotAllowedError: Permission denied`.

**Isso também reproduziu no celular físico do Thiago (Samsung S25 Ultra)**
antes desta correção — ainda não confirmado se a versão com
`MicrophonePlugin` resolve lá (hardware moderno, WebView atualizado via
Play Store, não deveria ter limitação de microfone real como o emulador
tinha). É o teste pendente mais importante da próxima sessão. Se persistir
mesmo com permissão nativa garantida e microfone real, a causa é mais
estrutural — candidatos a investigar a seguir: `WebSettings` do
`MainActivity` (falta alguma flag explícita de mídia?), versão mínima do
Android System WebView no aparelho, ou o esquema `https://localhost` que o
Capacitor usa por padrão para servir os assets.

### Estado de verificação

- `npm run lint`/`test` (77/77)/`build`: ✅ todos zerados.
- `./gradlew assembleDebug`: ✅ `BUILD SUCCESSFUL`.
- Release `v2` publicado em
  `github.com/adrinothiago-cpu/app-diario/releases/tag/v2` com o APK
  anexado; API pública confirmada respondendo (`curl` manual).
- APK enviada também para o Drive (ainda manual desta vez — o celular do
  Thiago está na v1, sem o mecanismo de auto-update; a promessa de
  "atualiza sozinho" só vale a partir da próxima versão).
- **Não validado**: o banner de update em si nunca foi visto rodando (nem
  emulador nem celular) — só os componentes individuais (API do GitHub,
  build) foram conferidos separadamente.

### Pendências

1. **Bug do microfone no celular físico** — prioridade máxima.
2. Validar o fluxo completo de auto-update na prática (banner aparecendo,
   download, tela de "permitir fontes desconhecidas", instalação).
3. Pendências antigas: responsividade da guia Tarefas, tela de login, OAuth
   do Drive, assinatura de release, geolocalização das entradas de diário.

---

## Sessão 2026-09-11 (parte 2) — Módulo Diário: entradas com voz (áudio bruto, sem transcrição)

### O que foi feito

Primeira implementação do módulo Diário (antes só existia o tipo de evento
`DiaryEntryEvent` e um placeholder "em breve" na home).

- **Decisão de arquitetura (Thiago)**: registrar voz sem transcrever. A
  opção óbvia (Web Speech API) manda o áudio da fala pros servidores do
  Google pra virar texto — quebraria o zero-knowledge do `ARCHITECTURE.md`.
  Reconhecimento on-device (`RecognizerIntent.EXTRA_PREFER_OFFLINE`) foi
  cogitado e descartado por depender do pacote de idioma PT-BR offline
  estar baixado no aparelho do usuário, fora do nosso controle. Ficou:
  grava o áudio com `MediaRecorder`, cifra e guarda como mais um campo do
  evento — você ouve de volta, nunca vira texto pesquisável.
- **Schema**: `DiaryEntryEvent` (`lib/events/types.ts`) ganhou
  `audioBase64?`, `audioMimeType?`, `audioDuracaoSeg?` opcionais;
  `Conteudo` pode ficar `""` quando a entrada é só áudio. O blob vai em
  base64 dentro do próprio JSON cifrado (mesmo envelope AES-GCM de todo
  evento) — ~33% de overhead sobre o binário bruto, aceitável para áudios
  curtos de diário; evita ter que criar um segundo canal de
  armazenamento/sync só para binário.
- **`lib/audio/encoding.ts`**: `arrayBufferToBase64`/`base64ToBlob` puras
  (sem depender de `MediaRecorder`/DOM), testadas incluindo round-trip com
  buffers maiores que o tamanho de bloco interno (evita estourar
  `String.fromCharCode(...bytes)` em áudios grandes).
- **`lib/events/diary-store.ts`**: deriva a lista de entradas — sem eventos
  de delta ainda (não dá pra editar/apagar uma entrada), então é só
  mapear + ordenar mais recente primeiro, ao contrário do reduce mais
  complexo das tarefas.
- **`app/diario/page.tsx`**: formulário (texto opcional + seletor de humor
  em emoji + gravador) e feed de entradas com player de áudio. O hook
  `useAudioRecorder` encapsula `MediaRecorder`: cronômetro em segundos
  enquanto grava, e some as tracks do stream do microfone assim que a
  gravação para ou é descartada (não deixa o indicador de "microfone em
  uso" do Android aceso à toa).
- **`AndroidManifest.xml`**: `RECORD_AUDIO` + `uses-feature
  android.hardware.microphone` (`required=false`).
- Aba "Diário" adicionada ao `top-tabs.tsx`; card da home linkado.

### Descoberta relevante

O `BridgeWebChromeClient` do Capacitor (Android) já implementa
`onPermissionRequest` mapeando `AUDIO_CAPTURE` do WebView para
`RECORD_AUDIO` nativo automaticamente — confirmado ao vivo no emulador: o
diálogo nativo "Allow Diário to record audio?" apareceu ao clicar em
"Gravar áudio", sem nenhum código extra do nosso lado além da permissão no
manifest. Não precisa de plugin dedicado para isso.

### Estado de verificação

- `npm run lint`/`test` (71/71)/`build`: ✅ todos zerados.
- `npx cap sync android` → `./gradlew assembleDebug`: ✅ `BUILD SUCCESSFUL`.
- **Validado ao vivo no emulador**: navegação até `/diario`, desbloqueio do
  cofre, formulário renderizando (textarea, 5 emojis de humor, botão
  gravar, "Salvar entrada" corretamente desabilitado sem conteúdo), clique
  em "Gravar áudio" disparando o diálogo nativo de permissão, permissão
  concedida e registrada (`dumpsys package` confirma `RECORD_AUDIO:
  granted=true`).
- **Não validado**: a gravação em si falha no emulador com `NotAllowedError:
  Permission denied` do `getUserMedia` mesmo com a permissão Android
  concedida — tudo indica ser limitação do emulador (o AVD não tem acesso
  configurado ao microfone real do host; a opção "Virtual microphone uses
  host audio input" só é ajustável pela GUI das Extended Controls, que não
  temos nesta sessão sem interface gráfica) e não um bug do código. **Fica
  pendente confirmar no celular físico do Thiago** — é o teste que
  realmente importa, já que o emulador nunca teve microfone real de
  qualquer forma.
- APK final copiada para a mesma pasta do Google Drive de antes
  (`gio copy`), pronta para reinstalar (`adb install -r` substitui,
  precisa desinstalar/reinstalar como sideload manual normal).

### Pendências

1. **Confirmar gravação de áudio real num Android físico** — prioridade
   imediata da próxima sessão.
2. Auto-update do APK via GitHub — Thiago decidiu que pode ser um
   repositório/link público (não precisa ser Gist secreto). Repositório
   Git deste projeto ainda nem existe (`git init` pendente). Vai precisar
   de um plugin Android nativo customizado para baixar+instalar o APK
   (`FileProvider` já existe no manifest, reaproveitável).
3. Geolocalização das entradas (`latitude`/`longitude`/`precisao`) segue
   sempre `null` — `@capacitor/geolocation` já está instalado mas não foi
   integrado nesta rodada (fora do pedido desta sessão).
4. Pendências antigas seguem abertas: responsividade da guia Tarefas em
   tela estreita real, tela de login, OAuth do Drive, assinatura de
   release.

---

## Sessão 2026-09-11 — Ambiente Android SDK resolvido, primeira APK debug compilada

### O que foi feito

Fechada a pendência aberta desde o bootstrap (2026-07-23): "Instalar Android
SDK / definir `ANDROID_HOME` para compilar a APK debug". Nada de código do
app mudou — só ambiente da máquina de desenvolvimento.

- **Android Studio** instalado via snap (`sudo snap install android-studio
  --classic`, versão `2026.1.4.7`). Setup Wizard (modo "Standard") baixou o
  SDK para `~/Android/Sdk`: `platforms/android-37.0`, `build-tools/36.0.0`,
  `platform-tools`, `emulator`, licença `android-sdk-license` já aceita.
- **`ANDROID_HOME`/`ANDROID_SDK_ROOT`** adicionados permanentemente ao
  `~/.bashrc` (mais `platform-tools`/`emulator` no `PATH`).
- **JDK completo instalado**: a máquina só tinha `openjdk-21-jre` (runtime,
  sem `javac`). O Gradle falhava com `Toolchain installation
  '.../java-21-openjdk-amd64' does not provide the required capabilities:
  [JAVA_COMPILER]`. Resolvido com `sudo apt install openjdk-21-jdk-headless`.
- **Gotcha do Gradle Daemon**: mesmo após instalar o JDK, o primeiro rebuild
  falhou com o mesmo erro de toolchain — o daemon iniciado na tentativa
  anterior (antes do JDK existir) ficou residente em memória com a detecção
  antiga. `./gradlew --stop` + rebuild com `JAVA_HOME` explícito resolveu.
  Vale lembrar disso se o erro de toolchain voltar a aparecer depois de
  qualquer mudança de JDK no sistema.
- `npm run build` → `npx cap sync android` → `./gradlew assembleDebug`
  rodaram limpos em sequência. Primeira APK debug do projeto gerada em
  `android/app/build/outputs/apk/debug/app-debug.apk` (5,1 MB), enviada ao
  Thiago para instalar no celular.
- **Disco cheio bloqueou o passo seguinte**: `/` estava com 2,5GB livres de
  230GB (99% uso) — insuficiente pra baixar a system image do emulador
  (~1,1GB comprimida). Limpar revisões antigas de snap (`snap remove
  --revision`) liberou só ~900MB, não bastou. Identificado com o Thiago que
  `~/VirtualBox VMs` tinha 46GB em VMs não usadas (`win ltsc` 40GB,
  `risk_tst` 6,5GB, + 2 tinycore residuais); ele confirmou apagar as 4,
  removidas via `VBoxManage unregistervm --delete` (não só `rm -rf`, pra não
  deixar a instalação do VirtualBox com entradas órfãs) — liberou ~46GB,
  disco foi de 99% para 78% de uso (50GB livres).
- **Emulador criado e testado de ponta a ponta**: `cmdline-tools` baixadas à
  parte (o Setup Wizard do Android Studio não instala isso por padrão),
  `sdkmanager` baixou `system-images;android-34;google_apis;x86_64`,
  `avdmanager` criou o AVD `Pixel6_API34` (Android 14 "UpsideDownCake",
  device `pixel_6`). Emulador ligado via `emulator -avd Pixel6_API34
  -gpu swiftshader_indirect`; primeiro boot demora (~1-2min, sem snapshot
  ainda). APK instalada com `adb install` e aberta com `adb shell monkey`.

### Estado de verificação

- `npm run build`: ✅ zerado. `npx cap sync android`: ✅.
- `./gradlew assembleDebug`: ✅ `BUILD SUCCESSFUL` (154 tasks, 1m52s).
- APK: **compilada, entregue ao Thiago, e também validada visualmente de
  verdade no emulador** (`adb screencap`) — a tela Início renderizou
  corretamente: tema dark aplicado, abas Início/Tarefas/Auditoria, layout em
  coluna única sem cortes na largura de um Pixel 6 (1080px). Só a tela
  Início foi conferida nesta sessão; Tarefas/Auditoria não foram clicadas no
  emulador ainda — a pendência de responsividade da guia Tarefas (layout
  largo pensado pra desktop) segue sem confirmação visual.

### Pendências que continuam abertas (não tocadas nesta sessão)

1. Layout responsivo em tela estreita real (rail + sidebar + painel são
   fixos/largos, pensados pra desktop) — só a guia Tarefas recebeu ajuste
   pontual de hover→touch, nada validado num aparelho real.
2. Tela de login real.
3. OAuth PKCE do Google Drive (`appDataFolder`) sem backend.
4. Assinatura de release (keystore) para gerar APK/AAB de produção — hoje só
   existe o fluxo debug.

---

## Sessão 2026-07-24 — Paridade TickTick, Estágio 4 (menu de ordenação real)

### O que foi feito

- **`lib/todos/view.ts`**: `SortMode` (`prioridade`/`vencimento`/`criacao`/
  `titulo`), `SortDirection` (`asc`/`desc`), `sortItems` e
  `applySortToSections` — funções puras e testadas (6 testes novos). Todos os
  comparadores representam ordem **ascendente natural**; a inversão para
  `desc` é feita uniformemente por `sortItems`, não em cada comparador
  (um bug nesse ponto — o comparador de prioridade já vinha invertido e
  `sortItems` invertia de novo, cancelando o efeito — foi pego pelo próprio
  teste antes de chegar na UI, exatamente o motivo de testar a lib pura
  separado da UI).
- **Botão "Ordenar" do cabeçalho** (`app/tarefas/page.tsx`) agora é
  funcional: abre um dropdown flutuante (âncora `absolute right-0 top-full`,
  a primeira vez que uso popover flutuante nesta guia — os menus anteriores
  usavam painel inline para evitar a complexidade de fechar-ao-clicar-fora;
  aqui isso foi justamente implementado com um listener de `pointerdown` no
  `document` via `useRef` + `useEffect`, então valeu a pena) com as 4 opções.
  Clicar numa opção já selecionada inverte a direção; clicar em outra aplica
  a direção padrão sensata daquele modo (prioridade→desc, vencimento→asc,
  criação→asc, título→asc). "Padrão (por seção)" reseta para o agrupamento
  original (Atrasadas por prioridade, Próximas por data, etc.).
- Ícone "Ordenar" fica com a cor accent (`text-accent`) quando há uma
  ordenação ativa — sinal visual de que o padrão foi sobrescrito.

### Verificado ao vivo no navegador

Na Caixa de Entrada (3 tarefas ativas + 2 concluídas), testei: abrir o menu,
ordenar por "Título" (ordem alfabética correta), clicar de novo para
inverter a direção (setas ↑/↓ mudaram corretamente), clicar fora da área do
menu para fechar (funcionou — o listener de `pointerdown` fecha
corretamente), reabrir e clicar "Padrão" (voltou ao agrupamento por seção
original). Confirmei a cor do ícone via `getComputedStyle` (não só
visualmente — o zoom da screenshot comprimida em JPEG não deixava claro se
era accent ou texto normal; `rgb(110, 168, 254)` bateu exatamente com nosso
`#6ea8fe`). Sem erros no console.

### Estado de verificação

- `npm run build`/`lint`/`test`: ✅ (64 testes — 6 novos de `sortItems`/
  `applySortToSections`, mais o bug do comparador de prioridade corrigido
  antes de qualquer verificação manual).
- UI: validada ao vivo, incluindo o comportamento de fechar-ao-clicar-fora
  (não só visualmente — também confirmado o estado computado via JS).

### Pendências (inalteradas)

Etiquetas, painel de detalhe da tarefa, drag-and-drop, menu de contexto
(botão direito), busca. Confirmação visual real da responsividade mobile do
Estágio 3 (pedida ao Thiago — o ambiente de automação não conseguiu simular
um viewport estreito de verdade). Ver `memory/tarefas-ticktick-parity.md`.

---

## Sessão 2026-07-24 — Paridade TickTick, Estágio 3 (responsividade mobile)

Mudei de prioridade nesta etapa: em vez de mais um recurso de paridade
visual com o TickTick, fechei uma lacuna funcional real. O layout de 3
colunas (rail + sidebar + painel) que construí nos Estágios 1-2 é fixo e
largo — e o `ARCHITECTURE.md` deste projeto exige que o app funcione também no
Android via Capacitor. Sem responsividade, a guia Tarefas ficaria
inutilizável num celular. Isso valia mais do que continuar empilhando
features desktop-only.

### O que foi feito

- **Barra lateral como drawer em telas estreitas**: `Sidebar` fica escondida
  por padrão abaixo do breakpoint `md` (768px) e vira um painel fixo
  (`fixed inset-y-0 left-0 z-30`) com um backdrop escurecido que fecha ao
  tocar fora. Em telas `md+` continua exatamente como antes (coluna estática).
- **`Rail` escondido em mobile** (`hidden md:flex`) — só a guia "Tarefas" era
  funcional nele mesmo, não fazia sentido gastar espaço de tela no celular.
- **Botão hambúrguer** no cabeçalho do painel principal (`md:hidden`, usa o
  `MenuIcon` que já existia mas não estava conectado a nada desde o Estágio
  1) abre o drawer. Selecionar qualquer view no drawer fecha ele
  automaticamente (`selectView` em `app/tarefas/page.tsx` envolve o
  `setView` original).
- **Correção de acessibilidade a toque**: as ações de cada tarefa (excluir,
  ciclar prioridade, reagendar) só apareciam no `:hover` do mouse — em uma
  tela sensível ao toque isso **nunca dispara**, deixando essas ações
  inacessíveis no Android real (não é só estética, é funcionalidade morta no
  alvo principal do app). Adicionei a variante `[@media(hover:none)]:opacity-100`
  nesses elementos (`app/tarefas/page.tsx` e `components/tarefas/sidebar.tsx`,
  no botão "⋯" de cada lista) para que fiquem sempre visíveis em dispositivos
  sem capacidade de hover, e continuem só-no-hover em mouse/trackpad.

### Verificação — limitação honesta do ambiente

Tentei confirmar visualmente redimensionando a janela do Chrome
(`resize_window` para 390×844, depois testei até 1200×800) e via zoom do
navegador — **nenhum dos dois funcionou neste ambiente** (o gerenciador de
janelas do Linux/sandbox ignora o resize; atalhos de zoom do teclado são
bloqueados pela ferramenta de automação; a propriedade CSS `zoom` não afeta
`window.innerWidth`/`matchMedia`, só o rendering). Não forcei mais tentativas
depois da segunda falha, para não ficar girando em círculo.

Como alternativa, verifiquei o que dava para verificar sem ver o viewport
estreito de verdade:
- **Classes Tailwind corretas no DOM** (inspecionei via JS): `Rail` tem
  `hidden ... md:flex`, o wrapper da `Sidebar` tem
  `fixed inset-y-0 left-0 z-30 md:static md:z-auto hidden md:flex`, o
  hambúrguer tem `md:hidden`.
- **Lógica de estado funcional de verdade**: disparei o clique do hambúrguer
  via `element.click()` (um clique sintético do DOM, não apenas visual) e
  confirmei que `sidebarOpen` liga/desliga corretamente — a classe do
  wrapper muda de `hidden md:flex` para `flex`, e o backdrop passa a existir
  no DOM.
- **Sem regressão no desktop**: com o drawer "aberto" por baixo dos panos,
  tirei um screenshot em viewport largo — nada quebrou visualmente (o
  drawer/backdrop são inertes em `md+` por design).
- Sem erros no console em nenhum passo.

**O que isso NÃO prova**: como o drawer realmente fica na tela pequena de
verdade (largura do texto, se o backdrop cobre certinho, se o toque fecha
como esperado) — só a lógica de classes/estado foi confirmada, não a
renderização visual real num viewport estreito. **Peço para o Thiago
confirmar isso pessoalmente** — no celular/emulador Android, ou encolhendo
a janela do navegador manualmente (o resize automatizado não funciona neste
ambiente, mas deve funcionar numa janela normal do sistema dele).

### Estado de verificação

- `npm run build`/`lint`/`test`: ✅ (57 testes, sem novos — mudança é só de
  CSS/layout responsivo, sem lógica nova testável em `lib/`).
- UI: parcialmente validada (ver acima) — desktop 100% confirmado ao vivo;
  mobile confirmado só em nível de classe/estado, **não visualmente**.

### Pendências (inalteradas)

Etiquetas, painel de detalhe da tarefa, menu de ordenação real,
drag-and-drop, menu de contexto (botão direito), busca. Ver
`memory/tarefas-ticktick-parity.md`.

---

## Sessão 2026-07-24 — Paridade TickTick, Estágio 2 (gerenciar listas)

Continuação direta do Estágio 1, mesma sessão autônoma noturna.

### O que foi feito

- **`components/tarefas/sidebar.tsx`**: cada lista própria agora tem um
  botão "⋯" (aparece no hover, sempre visível se o menu estiver aberto) que
  expande um painel inline (não popover flutuante — decisão deliberada para
  evitar a complexidade de fechar-ao-clicar-fora/Esc/posicionamento perto da
  borda da tela, que não valia o esforço nesta etapa) com:
  - **Renomear**: vira um input inline, salva com Enter.
  - **Cor**: paleta de 6 swatches (as mesmas cores usadas na criação),
    aplica imediatamente ao clicar, com check na cor atual.
  - **Excluir lista**: pede confirmação explícita ("Excluir "X"? As tarefas
    voltam para a Caixa de Entrada.") antes de apagar.
- **`app/tarefas/page.tsx`**: `renameList`/`recolorList` (um `appendEvent`
  cada) e `deleteList` — que **reatribui as tarefas da lista para a Caixa de
  Entrada antes de apagar a lista** (um `todo_updated{listaId: null}` por
  tarefa afetada, depois o `list_deleted`), resolvendo o edge case de tarefas
  órfãs identificado no handoff do Estágio 1. Se a lista excluída era a view
  atual, volta para "Caixa de Entrada" automaticamente.

### Verificado ao vivo no navegador

Recolori a lista de teste "Trabalho" (vermelho → azul, aplicado na hora),
renomeei para "Trabalho (Grendene)" (atualizou em todo lugar), e excluí a
lista com uma tarefa concluída dentro ("Revisar contrato") — confirmei que
ela **não sumiu**: reapareceu na Caixa de Entrada, seção Concluído, junto
com "teste". Sem erros no console em nenhum passo.

### Estado de verificação

- `npm run build`/`lint`/`test`: ✅ (57 testes — a lógica de reatribuição de
  órfãos vive na página, não em `lib/`, então não ganhou teste unitário
  dedicado; foi validada por interação real no navegador, seguindo a mesma
  estratégia usada no resto do projeto: lib pura → Vitest, orquestração de
  UI → verificação manual/browser).
- UI: validada ao vivo (não só compilada) — ver acima.

### Pendências (inalteradas, ver Estágio 1 e `memory/tarefas-ticktick-parity.md`)

Etiquetas, painel de detalhe da tarefa, menu de ordenação real, drag-and-drop,
menu de contexto (botão direito), busca, responsividade mobile.

---

## Sessão 2026-07-24 — Paridade TickTick, Estágio 1 (trabalho autônomo noturno)

O Thiago pediu paridade completa com o TickTick real (layout, menus,
classificações, todas as interações) preservando só a nossa paleta de cores,
e autorizou trabalho autônomo durante a madrugada ("não precisa me pedir
confirmações, faça como você entender"). Usei `systemd-inhibit` para impedir
suspensão da máquina e o TickTick real (aberto pelo Thiago no navegador) como
referência viva de interação, além do print em `images/`.

### O que foi feito

- **Modelo de Listas** (`lib/events/types.ts`, `lib/events/lists-store.ts`):
  eventos `list_created`/`list_renamed`/`list_recolored`/`list_deleted`,
  append-only como o resto do event store. `TodoCreatedEvent`/`TodoUpdatedEvent`
  ganharam `listaId?` (null/ausente = Caixa de Entrada).
- **Soft delete de tarefas**: `todo_deleted` agora só marca `apagadoEm`
  (não remove do projetado) e há um novo `todo_restored` para desfazer —
  vira a base da Lixeira, mantendo a disciplina de log imutável do
  `ARCHITECTURE.md` (nada é fisicamente apagado pelo usuário).
- **`concluidoEm`** passou a ser rastreado no `TodoItem` (timestamp do último
  `todo_toggled(true)`), usado para ordenar a seção "Concluído".
- **`lib/todos/view.ts`** ganhou o sistema de *views* da barra lateral:
  `TarefasView` (hoje/amanhã/próximos7/inbox/lista/concluído/lixeira),
  `sectionsForView`, `flatForView`, `completedForView` (seção "Concluído"
  **por lista**, replicando exatamente o padrão da imagem de referência —
  não é a mesma coisa que a view global "Concluído" da barra lateral, as
  duas coexistem), `countForView`, `viewTitle`/`viewKey`.
- **Barra lateral estilo TickTick** (`components/tarefas/`): `rail.tsx`
  (coluna de ícones — só "Tarefas" é funcional; calendário/hábitos/busca
  ficam desabilitados com dica "Em breve" em vez de simular algo que não
  existe), `sidebar.tsx` (Hoje/Amanhã/Próximos 7 dias/Caixa de Entrada com
  contadores, Listas com criação inline, "Filtros" com o texto estático real
  do TickTick quando vazio, Concluído, Lixeira), `mini-calendar.tsx` (tira da
  semana atual com hoje destacado e pontos nos dias com pendência).
- **`app/tarefas/page.tsx` reescrita** como layout de três colunas (rail +
  sidebar + painel principal) roteando por `TarefasView`; a barra
  "Adicionar tarefa" herda lista/data padrão da view atual (ex.: criar em
  "Hoje" já vem com vencimento hoje).
- **`components/vault-gate.tsx`**: extraído `VaultUnlockForm` do `VaultGate`
  para a página de tarefas controlar o layout da tela de senha (formulário
  centrado) separado do layout de app cheio (three-pane) — antes só existia
  o wrapper que não dava esse controle.
- Ícones novos em `components/todo-icons.tsx` (Sun/Sunrise/Layers/Inbox/
  CheckCircle/Trash/Undo/Menu/Sort/More/Search/Pomodoro/Habit) — todos SVG
  inline, sem dependência externa.

### Bug encontrado e corrigido só por observar de verdade

Depois do build/lint/test zerarem, abri a página no Chrome (a mesma aba que
já tinha o TickTick real) e o mini-calendário **não aparecia** — sumia da
tela. Causa: `<aside>` da barra lateral era `flex-col` sem altura limitada,
e o `mt-auto` do calendário esticava o container inteiro (936px) em vez de
fixar o calendário no rodapé *visível*. Corrigido dando altura fixa ao layout
de 3 colunas (`h-[calc(100dvh-56px)]`, medi a altura real do `TopTabs` via
JS: 56px) com `overflow-y-auto` em cada coluna — sidebar e painel principal
agora rolam de forma independente, como no TickTick real. **Isso reforça a
regra: só "compilar e passar nos testes" não prova que a UI funciona — só
abrir e olhar prova.**

### Verificado ao vivo no navegador (não só compilado)

Com a senha de teste `123`, testei manualmente: desbloqueio → troca entre
Hoje/Caixa de Entrada (seções Atrasadas/Próximas/Concluído batendo com a
imagem de referência) → criar lista "Trabalho" → criar tarefa nela → ciclar
prioridade (flag cinza→vermelho→âmbar) → concluir (some da lista, aparece em
"Concluído" com contador global atualizado) → excluir (soft delete, some da
lista) → Lixeira mostra o item riscado com botão "Restaurar" → restaurar
devolve à lista original. Sem erros no console. Ficaram na base local de
teste: lista "Trabalho" e a tarefa "Revisar contrato" (concluída) — são
artefato da minha verificação, o Thiago pode apagar ou manter.

### Estado de verificação

- `npm run build`/`lint`/`test`: ✅ (57 testes). `npx cap sync android`: ✅.
- UI: **validada visualmente de verdade no Chrome**, não só compilada — ver
  acima. Layout ainda não testado em telas estreitas/mobile (a stack real do
  app é PWA desktop + Android via Capacitor — responsividade da guia Tarefas
  fica pendente).

### Limitações conhecidas / pendências (Estágio 2+)

1. **Gerenciar listas**: hoje só dá para criar; falta renomear/recolorir/
   excluir pela UI (eventos já existem no modelo). Excluir uma lista hoje
   deixaria tarefas "órfãs" (`listaId` apontando pra lista inexistente,
   inacessível em qualquer view) — precisa reatribuir para a Caixa de
   Entrada antes de apagar a lista.
2. **Etiquetas (tags)**: não implementado — decisão consciente para não
   construir uma feature pela metade; fica pra um estágio dedicado.
3. **Painel de detalhe da tarefa** (notas, subtarefas, mover de lista): não
   implementado.
4. **Ordenar/Mais opções** no cabeçalho: botões decorativos ("Em breve") —
   não implementei um menu de ordenação real ainda.
5. **Arrastar-e-soltar, menu de contexto (botão direito), busca**: não
   implementados.
6. Ver `memory/tarefas-ticktick-parity.md` para o checklist completo de
   paridade e o que já foi coberto.

---

## Sessão 2026-07-23 (parte 4) — Guia Tarefas no estilo TickTick

### O que foi feito

- Modelo de to-do estendido (`lib/events/types.ts`): `TodoPriority` (0–3),
  campos opcionais `prioridade`/`vencimento` em `TodoCreatedEvent`, e novo
  `TodoUpdatedEvent` (patch parcial — só as chaves presentes são aplicadas,
  permitindo mudar prioridade e reagendar data sem reescrever o resto). Campos
  `prioridade`/`vencimento` adicionados ao `TodoItem` derivado.
- Reducer (`lib/events/todo-store.ts`) trata `todo_updated` com defaults
  retrocompatíveis (`prioridade ?? 0`, `vencimento ?? null`) — eventos antigos
  sem esses campos continuam válidos. `"vencimento" in event` distingue
  "não mexer" de "limpar para null".
- `lib/todos/view.ts` (helpers puros, testáveis sem DOM): `PRIORITIES` (cores),
  `todayISO`, `formatDue` (Hoje/Amanhã/Ontem/"1 ago"), `dueColor` (vermelho se
  atrasada, accent se hoje/futuro), `groupActive` (seções inteligentes
  Atrasadas/Hoje/Próximas/Sem data, ordenadas por prioridade/data).
- `components/todo-icons.tsx`: ícones SVG inline (check, chevron, flag,
  calendar, plus) — sem lib de ícones.
- `app/tarefas/page.tsx` redesenhada replicando o layout do TickTick a partir
  da referência em `images/`: barra "Adicionar tarefa" com flag de prioridade
  e seletor de data, seções recolhíveis com chevron + contador, checkbox
  quadrado-arredondado com anel na cor da prioridade (check fantasma no hover),
  data de vencimento colorida à direita (clicável para reagendar via input date
  oculto), flag/excluir aparecendo no hover da linha, seção "Concluído" ao
  fundo. Tudo na paleta dark existente.

### Decisões e justificativas

- **Cores de prioridade** (alta=vermelho, média=âmbar, baixa=accent azul,
  nenhuma=cinza-azulado) são tratadas como **cores de dado/sinal**, não como
  troca de tema — a paleta dark (background/surface/border/foreground/muted)
  foi preservada conforme pedido. Baixa prioridade reusa o accent `#6ea8fe` do
  próprio esquema.
- Estilo TickTick baseado na imagem `images/Captura de tela ...png` (tema claro
  do TickTick); replicada a **estrutura/linguagem visual**, não as cores.
- Helpers de apresentação isolados em `lib/todos/view.ts` para manter o reducer
  puro e permitir testar o agrupamento sem montar React.

### Estado de verificação

- `npm run lint`: ✅ zerado. `npm run test`: ✅ 30/30 (8 novos: reducer com
  prioridade/vencimento/update + helpers de view). `npm run build`: ✅ zerado.
  `npx cap sync android`: ✅.
- UI da `/tarefas`: **compilada, testada (lógica) e renderiza sem erro de
  runtime no dev** (curl confirma h1 + VaultGate). O visual TickTick e o fluxo
  interativo (desbloquear → adicionar com prioridade/data → concluir → ciclar
  prioridade → reagendar → excluir → recolher seções) **não foram clicados** —
  validação visual/funcional fica com o Thiago (ele verifica pelo próprio app).
- Dev server mantido rodando em background em http://localhost:3001 (preferência
  registrada em memória).

### Pendências / próximos passos sugeridos

1. Validar visualmente a `/tarefas` (comparar com a referência TickTick).
2. Possíveis extensões TickTick futuras: listas/projetos, etiquetas (pílula
   "Iniciada"), subtarefas, recorrência, notas — hoje fora de escopo.
3. Itens ainda abertos das sessões anteriores: tela de login real, Android SDK
   para APK, OAuth do Google Drive (`appDataFolder`).

---

## Sessão 2026-07-23 (parte 3) — Guias fixas, vault compartilhado e to-do list

### O que foi feito

- Guias fixas no topo (`components/top-tabs.tsx`): `sticky top-0`, mesmo fundo
  do body, sem borda/sombra (sem separador visível); guia ativa destacada via
  `usePathname`. Montadas no `app/layout.tsx`.
- Vault compartilhado por Context (`components/vault-provider.tsx` +
  `vault-gate.tsx`): a chave derivada vive só em memória e sobrevive à navegação
  entre rotas; refresh completo do navegador reexige a senha (zero-knowledge).
  `/auditoria` refatorada para consumir o contexto.
- Nova guia "Tarefas" (`app/tarefas/page.tsx`) — versão inicial simples de
  to-do list. Eventos append-only `todo_created`/`todo_toggled`/`todo_deleted`
  (`lib/events/types.ts`) reduzidos em memória por `reduceTodos`
  (`lib/events/todo-store.ts`). (Redesenhada no estilo TickTick na parte 4.)
- Removido da home o card-link duplicado de Auditoria (agora só via guias).

### Decisões e justificativas

- Lint `react-hooks/set-state-in-effect`: efeitos que carregam dados usam
  `listDecryptedEvents(key).then(...)` inline — único padrão aceito pela regra
  (chamar função async que faz setState do corpo do efeito é barrado).

### Estado de verificação

- `npm run build`/`lint`/`test`: ✅ (22 testes na parte 3). `cap sync`: ✅.
- UI **não validada visualmente** nesta parte (só curl + testes).

---

## Sessão 2026-07-23 (parte 2) — Criptografia, event store e auditoria em tabela

### O que foi feito

- **`lib/crypto/keys.ts`**: `deriveMasterKeyBits` (PBKDF2-SHA256, 600.000
  iterações, `deriveBits` — nunca extrai a chave final diretamente) +
  `deriveSubkey` (HKDF-SHA256) para separar o material mestre em duas
  subchaves isoladas por finalidade (`event-encryption` → AES-GCM,
  `session-hmac` → HMAC), evitando reuso de bits brutos entre algoritmos.
- **`lib/crypto/cipher.ts`**: `encryptEvent`/`decryptEvent`. Formato de
  payload = **JSON serializado nativamente (V8) empacotado em blob binário
  puro** (`IV de 12 bytes || ciphertext+tag AES-GCM`), sem base64. Decisão do
  Thiago: "use o formato mais otimizado possível" + verificação será feita
  pelo próprio app (não por arquivo exportado) — então o formato de
  serialização em disco é irrelevante para auditoria humana (é sempre
  ciphertext opaco); o que importa é velocidade de parse/gravação, e
  IndexedDB armazena `ArrayBuffer` nativamente via structured clone, sem
  overhead de texto.
- **`lib/crypto/session-token.ts`**: token de sessão HMAC-SHA256 com
  `issuedAt`/`expiresAt`, também em binário puro (payload + assinatura como
  `ArrayBuffer`) — nunca circula como string, só entre memória/IndexedDB.
- **`lib/crypto/constant-time.ts`**: `constantTimeEqual` para comparações de
  bytes fora do `crypto.subtle.verify` (que já é constant-time nativamente).
- **`lib/crypto/rate-limit.ts`**: lógica pura (sem I/O) de rate-limit — máx.
  5 tentativas / 15 min — testável isoladamente.
- **`lib/db/indexeddb.ts`**: wrapper Promise sobre IndexedDB nativa (stores
  `events`, `meta`), sem ORM.
- **`lib/db/auth-store.ts`**: persiste o salt (`getOrCreateSalt`) e as
  tentativas de login (`checkAndRecordLoginAttempt`) na store `meta`.
- **`lib/events/types.ts`** e **`lib/events/event-store.ts`**: schema plano
  de `WorkoutSetEvent`/`DiaryEntryEvent` (campos já no formato tabular do
  prompt original) + `appendEvent`/`listDecryptedEvents`. Só existem
  operações de criação e leitura — nenhuma função de update/delete, por
  design (log imutável).
- **`app/auditoria/page.tsx`**: seção nova no app (`"use client"`) com tela
  de desbloqueio por senha (deriva chave, decripta o cofre existente — senha
  errada = falha de decrypt do AEAD, sem hash de senha separado armazenado),
  botões para gerar eventos de exemplo e **duas tabelas** (Treino / Diário)
  renderizando os eventos decriptados linha a linha, com scroll horizontal
  próprio. Linkada a partir da home (`app/page.tsx`).
- **Vitest** instalado (`vitest.config.ts`, ambiente Node — Web Crypto é
  nativo no Node 24, sem jsdom): 17 testes cobrindo round-trip de
  derivação/cifra, rejeição de chave errada, detecção de blob adulterado,
  expiração/adulteração de token de sessão, e limites do rate-limit.

### Decisões e justificativas

- Duas subchaves via **HKDF** (não reuso direto dos bits do PBKDF2) para
  isolar criptograficamente a chave de cifra de eventos da chave de HMAC de
  sessão — mesmo que ambas venham da mesma senha.
- **Sem verificador de senha separado**: a "senha correta" é confirmada
  tentando decifrar os eventos existentes; se não houver eventos ainda
  (cofre novo), a primeira senha usada define o cofre — não há como validar
  antes de haver pelo menos um evento gravado.
- `eslint.config.mjs` já ignorava `android/**`; nenhum ajuste adicional
  necessário para os novos arquivos.

### Estado de verificação

- `npm run build`: ✅ zerado.
- `npm run lint`: ✅ zerado.
- `npm run test` (Vitest): ✅ 17/17 testes passando.
- `npx cap sync android`: ✅ ok.
- UI da página `/auditoria`: **apenas compilada/testada automaticamente** —
  o fluxo interativo completo (desbloquear, criar evento, ver tabela
  populada) depende de IndexedDB/Web Crypto do navegador e **não foi clicado
  manualmente** nesta sessão. Verificação visual/funcional fica para o
  Thiago, conforme combinado.

### Pendências / próximos passos sugeridos

1. Validar manualmente o fluxo de `/auditoria` no navegador (desbloquear →
   criar eventos → conferir tabela).
2. Tela de login real (hoje a derivação de chave só existe dentro da página
   de auditoria).
3. Instalar Android SDK / definir `ANDROID_HOME` para compilar a APK debug.
4. Decidir fluxo OAuth do Google Drive sem backend (PKCE em app nativo +
   desktop) — pesquisar limitações do `appDataFolder` com chave de API
   pública, e como o mesmo blob binário `.enc` seria enviado via multipart
   upload sem reencodar para base64.

---

## Sessão 2026-07-23 — Bootstrap do projeto (Next.js + Capacitor)

### O que foi feito

- Scaffold do zero com `create-next-app` (Next 16.2.11, React 19, TypeScript,
  Tailwind v4, App Router, ESLint 9 flat config). Nome do pacote npm:
  `app-diario` (o diretório `app_diário` tem acento, inválido como nome npm).
- `next.config.ts`: `output: 'export'` + `images.unoptimized` — base estática
  sem servidor, conforme arquitetura offline-first.
- Capacitor 8 instalado e configurado (`capacitor.config.ts`: appId
  `com.thiago.diario`, appName `Diário`, webDir `out`). Plataforma `android/`
  adicionada com plugins `@capacitor/app` e `@capacitor/geolocation`;
  `npx cap sync android` funcionando.
- `AndroidManifest.xml`: permissões `ACCESS_COARSE_LOCATION` /
  `ACCESS_FINE_LOCATION` + `uses-feature` GPS (`required=false`) para a captura
  de localização do diário; `allowBackup="false"` (privacidade: nada do WebView
  vai para o backup automático do Android — os dados vivem cifrados no Drive).
- Tema único dark aplicado em `app/globals.css` (tokens: background, surface,
  border, foreground, muted, accent). Removidos o `prefers-color-scheme` e o
  boilerplate do scaffold. `app/page.tsx` é um placeholder dark com as três
  seções futuras (Treino, Diário, Métricas). Criado `components/dev-tag.tsx`.
- `eslint.config.mjs`: `android/**` adicionado aos ignores (o cap sync copia
  bundles compilados para `android/app/src/main/assets/public`, que poluíam o
  lint).
- Criados `ARCHITECTURE.md` (regras permanentes) e este arquivo.

### Decisões e justificativas

- **Ordem de implementação** (decisão do Thiago): scaffold Next+Capacitor
  primeiro; utilitários de criptografia Web Crypto na próxima etapa, já com
  build/lint verificáveis.
- **`npm audit` acusa 3 vulnerabilidades high** em `sharp`/`postcss` via
  `next` — afetam apenas o otimizador de imagens do build, que está desativado
  (`images.unoptimized` + export estático). NÃO rodar `npm audit fix --force`
  (faria downgrade do Next para v9).
- Git **não** inicializado ainda — aguardando solicitação explícita (o `.git`
  criado pelo create-next-app foi descartado de propósito).

### Estado de verificação

- `npm run build`: ✅ zerado (export estático gerado em `out/`).
- `npm run lint`: ✅ zerado.
- `npx cap sync android`: ✅ ok, 2 plugins detectados.
- UI: **apenas compilada** — a página placeholder NÃO foi validada
  visualmente em navegador nem dispositivo nesta sessão.
- APK: **não compilada** — Android SDK ausente na máquina (`ANDROID_HOME`
  vazio). Java 21 e Node 24 disponíveis.

### Pendências / próximos passos sugeridos

1. Utilitários de criptografia (PBKDF2 600k, AES-GCM 256, HMAC-SHA256,
   comparação em tempo constante) com testes — definir test runner (sugestão:
   Vitest).
2. Wrapper leve de IndexedDB + event store append-only.
3. Instalar Android SDK / definir `ANDROID_HOME` para compilar a APK debug.
4. Decidir fluxo OAuth do Google Drive sem backend (PKCE em app nativo +
   desktop) — pesquisar limitações do `appDataFolder` com chave de API pública.
5. Validar visualmente a página placeholder (`npm run dev`).
