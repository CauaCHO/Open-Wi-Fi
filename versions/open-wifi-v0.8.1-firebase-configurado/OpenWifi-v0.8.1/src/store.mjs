import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(filename) {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.data = this.#load();
    this.queue = Promise.resolve();
  }

  #load() {
    if (!fs.existsSync(this.filename)) return { devices: {}, attempts: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      return {
        devices: parsed.devices || {},
        attempts: parsed.attempts || {}
      };
    } catch {
      return { devices: {}, attempts: {} };
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
