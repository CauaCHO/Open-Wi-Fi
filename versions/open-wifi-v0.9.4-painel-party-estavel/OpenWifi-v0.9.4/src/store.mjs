import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(filename) {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.data = this.#load();
    this.queue = Promise.resolve();
  }

  #empty() {
    return { devices: {}, identities: {}, attempts: {}, settings: { mode: 'standard', currentEvent: null }, combos: {}, events: {} };
  }

  #load() {
    if (!fs.existsSync(this.filename)) return this.#empty();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      return {
        devices: parsed.devices || {},
        identities: parsed.identities || {},
        attempts: parsed.attempts || {},
        settings: parsed.settings || { mode: 'standard', currentEvent: null },
        combos: parsed.combos || {},
        events: parsed.events || {}
      };
    } catch {
      return this.#empty();
    }
  }

  async mutate(fn) {
    const job = this.queue.then(async () => {
      const result = await fn(this.data);
      const tmp = `${this.filename}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.filename);
      return result;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  read(fn) {
    return fn(this.data);
  }
}
