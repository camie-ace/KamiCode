export interface CollabServerConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly serverToken: string;
  readonly corsOrigin: string;
  readonly runMigrations: boolean;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readPort(): number {
  const raw = process.env.PORT?.trim() || "8787";
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`PORT must be a valid TCP port, received ${raw}.`);
  }
  return value;
}

export function loadConfig(): CollabServerConfig {
  return {
    host: process.env.HOST?.trim() || "0.0.0.0",
    port: readPort(),
    databaseUrl: readRequiredEnv("DATABASE_URL"),
    serverToken: readRequiredEnv("KAMICODE_COLLAB_SERVER_TOKEN"),
    corsOrigin: process.env.KAMICODE_COLLAB_CORS_ORIGIN?.trim() || "*",
    runMigrations: process.env.KAMICODE_COLLAB_RUN_MIGRATIONS !== "0",
  };
}
