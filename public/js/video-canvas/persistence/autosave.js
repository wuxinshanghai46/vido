export class RevisionAutosave {
  constructor({ save, delay = 1200, onState }) {
    Object.assign(this, { save, delay, onState });
    this.timer = null;
    this.pending = false;
    this.running = null;
  }

  schedule() {
    this.pending = true;
    clearTimeout(this.timer);
    this.onState?.('有未保存修改');
    this.timer = setTimeout(() => this.flush().catch(() => {}), this.delay);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (!this.pending) return;
    }
    this.running = this.performSave();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  async performSave() {
    try {
      while (this.pending) {
        this.pending = false;
        this.onState?.('正在保存…');
        await this.save();
        this.onState?.('已保存');
      }
    } catch (error) {
      this.pending = true;
      this.onState?.('保存失败');
      throw error;
    }
  }
}
