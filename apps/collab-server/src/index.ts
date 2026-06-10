import { loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { createCollabHttpServer } from "./http.ts";
import { runMigrations } from "./migrations.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  const command = process.argv[2];
  if (command === "migrate") {
    await runMigrations(pool);
    await pool.end();
    return;
  }

  if (config.runMigrations) {
    await runMigrations(pool);
  }

  const server = createCollabHttpServer(config, pool);
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });

  console.log(`KamiCode collaboration server listening on ${config.host}:${config.port}`);

  const shutdown = async () => {
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
