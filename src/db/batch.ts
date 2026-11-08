import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./index";

export type SqlParam = string | number | null;

/**
 * Collects statements and runs them all in ONE transaction on the Rust side
 * (src-tauri/src/batch.rs). Either every statement is saved or none is.
 *
 *   const b = new Batch();
 *   b.add("INSERT OR IGNORE INTO companies(name) VALUES ($1)", ["Cipla"]);
 *   await b.run();
 *
 * Parameters use $1, $2 … like the rest of the app.
 */
export class Batch {
  private sqls: string[] = [];
  private index = new Map<string, number>();
  private steps: [number, SqlParam[]][] = [];

  add(sql: string, params: SqlParam[] = []): this {
    let i = this.index.get(sql);
    if (i === undefined) {
      i = this.sqls.length;
      this.sqls.push(sql);
      this.index.set(sql, i);
    }
    this.steps.push([i, params]);
    return this;
  }

  get size(): number {
    return this.steps.length;
  }

  /** For tests: the statements in order, with their parameters. */
  toList(): { sql: string; params: SqlParam[] }[] {
    return this.steps.map(([i, params]) => ({ sql: this.sqls[i], params }));
  }

  async run(): Promise<{ rows_affected: number[]; last_ids: number[] }> {
    if (this.steps.length === 0) return { rows_affected: [], last_ids: [] };
    await getDb(); // make sure migrations have run before the Rust side opens the file
    return invoke("run_batch", { req: { sqls: this.sqls, steps: this.steps } });
  }
}
