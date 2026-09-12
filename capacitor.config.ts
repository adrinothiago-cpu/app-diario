import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.thiago.diario",
  appName: "Diário",
  // Saída do `next build` com output: 'export' — o WebView serve estes arquivos
  // localmente, sem servidor externo.
  webDir: "out",
};

export default config;
