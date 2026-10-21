import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createStore(dataDirectory) {
  if (dataDirectory !== ':memory:') mkdirSync(dataDirectory, { recursive: true });
  const db = new DatabaseSync(dataDirectory === ':memory:' ? ':memory:' : join(dataDirectory, 'office.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS office_state (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL)');
  const read = db.prepare('SELECT payload FROM office_state WHERE id = 1');
  const write = db.prepare('INSERT INTO office_state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload');
  return {
    load() {
      const record = read.get();
      return record ? JSON.parse(record.payload) : null;
    },
    save(state) {
      write.run(JSON.stringify(state));
    },
    close() {
      db.close();
    },
  };
}
