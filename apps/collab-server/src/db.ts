import { Pool, type PoolClient } from "pg";

export type DbClient = Pool | PoolClient;

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export async function query<T>(
  client: DbClient,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query(sql, [...values]);
  return result.rows as T[];
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
