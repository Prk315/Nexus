import Database from "@tauri-apps/plugin-sql";
import type { App } from "@nexus/core";

export type { App };

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:nexus.db");
  }
  return _db;
}

export async function getApps(): Promise<App[]> {
  const db = await getDb();
  return db.select<App[]>("SELECT * FROM apps ORDER BY name ASC");
}

export async function addApp(name: string, path: string, icon?: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO apps (name, path, icon) VALUES ($1, $2, $3)",
    [name, path, icon ?? null]
  );
}

export async function removeApp(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM apps WHERE id = $1", [id]);
}

export async function updateLastLaunched(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE apps SET last_launched = datetime('now') WHERE id = $1",
    [id]
  );
}
