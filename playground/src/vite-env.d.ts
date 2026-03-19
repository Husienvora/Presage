/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREDICT_API_KEY: string;
  readonly VITE_BNB_RPC_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
