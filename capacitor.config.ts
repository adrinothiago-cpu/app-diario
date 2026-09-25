import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.thiago.diario",
  appName: "Diário",
  // Saída do `next build` com output: 'export' — o WebView serve estes arquivos
  // localmente, sem servidor externo.
  webDir: "out",
  android: {
    // Padrão do Capacitor ("production") ainda loga em nível verbose em
    // builds debug — foi assim que a senha do cofre apareceu em texto puro
    // no logcat ao testar o desbloqueio por digital (methodData do plugin
    // call). "none" desliga esse log do bridge nativo em qualquer tipo de
    // build, sem depender de gerar um release assinado.
    loggingBehavior: "none",
  },
};

export default config;
