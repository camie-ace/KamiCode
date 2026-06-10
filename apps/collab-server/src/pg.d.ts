declare module "pg" {
  export interface QueryResultRow {
    readonly [column: string]: unknown;
  }

  export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
    readonly rows: T[];
  }

  export interface PoolConfig {
    readonly connectionString?: string;
    readonly max?: number;
    readonly idleTimeoutMillis?: number;
    readonly connectionTimeoutMillis?: number;
  }

  export class Pool {
    constructor(config?: PoolConfig);
    query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }

  export class PoolClient {
    query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>>;
    release(): void;
  }
}
