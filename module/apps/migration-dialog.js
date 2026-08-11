import {
  MIGRATIONS,
  getPendingWorldMigrations,
  runWorldMigrations,
  skipWorldMigration,
} from "../migration.js";

const migrationTitles = new Map(MIGRATIONS.map((migration) => [migration.id, migration.title]));

const affectedRows = function(data = {}) {
  return Object.entries(data.affected?.byType ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([type, count]) => `${type}: ${count}`);
};

export class MigrationDialog extends Application {
  constructor({ state, pending, readOnly = false } = {}, options = {}) {
    super(options);
    this.state = state;
    this.pending = pending ?? getPendingWorldMigrations(state);
    this.readOnly = readOnly;
    this.status = {};
    this.error = null;
    this.running = false;
    this.complete = false;
    this.selected = Object.fromEntries(this.pending.map((migration) => [migration.id, true]));
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["D35E", "dialog", "migration-dialog"],
      id: "d35e-migration-dialog",
      title: "D35E.MigrationTitle",
      template: "systems/warcraftrpg2e/templates/apps/migration-dialog.html",
      width: 620,
      height: "auto",
      resizable: false,
    });
  }

  getData() {
    const completed = this.state?.completed ?? {};
    const skipped = this.state?.skipped ?? {};
    const completedRows = Object.entries(completed)
      .map(([id, data]) => ({
        id,
        title: game.i18n.localize(migrationTitles.get(id) ?? id),
        version: data.version,
        completedAt: data.completedAt,
        affectedTotal: data.affected?.total ?? 0,
        affectedRows: affectedRows(data),
        hasAffected: (data.affected?.total ?? 0) > 0,
      }))
      .sort((a, b) => a.version.localeCompare(b.version) || a.id.localeCompare(b.id));
    const skippedRows = Object.entries(skipped)
      .map(([id, data]) => ({
        id,
        title: game.i18n.localize(migrationTitles.get(id) ?? id),
        version: data.version,
        skippedAt: data.skippedAt,
        reason: data.reason,
      }))
      .sort((a, b) => a.version.localeCompare(b.version) || a.id.localeCompare(b.id));

    const pendingRows = this.pending.map((migration) => ({
      id: migration.id,
      title: game.i18n.localize(migration.title),
      description: game.i18n.localize(migration.description),
      version: migration.version,
      optional: !!migration.optional,
      selected: this.selected[migration.id] !== false,
      status: this.status[migration.id] ?? "pending",
      statusLabel: game.i18n.localize(`D35E.MigrationStatus.${this.status[migration.id] ?? "pending"}`),
    }));

    return {
      state: this.state,
      completedRows,
      skippedRows,
      pendingRows,
      hasCompleted: completedRows.length > 0,
      hasSkipped: skippedRows.length > 0,
      hasPending: pendingRows.length > 0,
      readOnly: this.readOnly,
      running: this.running,
      complete: this.complete,
      error: this.error,
      currentVersion: game.system.version,
      baselineVersion: this.state?.lastSuccessVersion ?? this.state?.baselineVersion ?? "0.0.0",
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    root.querySelector("[data-action='run-migrations']")?.addEventListener("click", () => this._runMigrations());
    root.querySelectorAll("[data-action='toggle-migration']").forEach((input) => {
      input.addEventListener("change", () => {
        this.selected[input.dataset.migrationId] = input.checked;
      });
    });
    root.querySelector("[data-action='confirm-complete']")?.addEventListener("click", () => this._confirmComplete());
    root.querySelector("[data-action='shutdown']")?.addEventListener("click", () => game.shutDown());
    root.querySelector("[data-action='logout']")?.addEventListener("click", () => game.logOut());
  }

  async _runMigrations() {
    if (this.running || this.readOnly || this.complete) return;
    this.running = true;
    this.error = null;
    this.render(false);

    try {
      const skippedIds = new Set();
      for (const migration of this.pending.filter((migration) => migration.optional && this.selected[migration.id] === false)) {
        this.state = await skipWorldMigration(migration.id);
        skippedIds.add(migration.id);
      }
      const migrationsToRun = this.pending.filter((migration) =>
        !skippedIds.has(migration.id) && (!migration.optional || this.selected[migration.id] !== false)
      );

      this.state = await runWorldMigrations(migrationsToRun, {
        onStatus: (migration, status, err) => {
          this.status[migration.id] = status;
          if (err) this.error = err.message ?? String(err);
          this.render(false);
        },
      });
      this.pending = getPendingWorldMigrations(this.state);
      this.complete = !this.pending.length;
    } catch (err) {
      this.error = err.message ?? String(err);
    } finally {
      this.running = false;
      this.render(false);
    }
  }

  async _confirmComplete() {
    await this.close();
    const element = this.element?.nodeType === 1 ? this.element : this.element?.[0];
    element?.remove();
  }
}
