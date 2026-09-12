import path from 'node:path';
import { userInfo } from 'node:os';
import type { ApiClient } from '@fib/api-client';
import { FakeApiClient, HttpApiClient } from '@fib/api-client';
import { registry } from '@fib/adapters';
import {
  buildPlan,
  initialSnapshot,
  matchOption,
  reduce,
  resolve,
  IllegalTransition,
  type BrowserDriver,
  type FindPhrase,
  type FormBundle,
  type ResolvedGroup,
  type SessionEvent,
  type SessionSnapshot,
} from '@fib/core';
import { PlaywrightDriver } from '@fib/driver-playwright';
import { A11yFallbackAgent, Executor } from '@fib/fill-engine';
import type {
  DocumentSet,
  ExtractionResult,
  FillEvent,
  FillStep,
  ResolvedField,
  Source,
  WidgetProfiles,
} from '@fib/contracts';

/** Structural slice of Electron's `WebContentsView` the controller needs (keeps the module Electron-free for unit tests). */
export interface FormViewLike {
  webContents: {
    on(event: string, listener: () => void): unknown;
    isLoading(): boolean;
    getURL(): string;
  };
}

/** Structural slice of the panel view: snapshots are pushed main -> renderer here. */
export interface PanelViewLike {
  webContents: { send(channel: string, payload: unknown): void };
}

export interface IngestProgressLike {
  stage: string;
  pct: number;
}

/** `FIB_API=fake` -> FakeApiClient (used by e2e); otherwise HTTP against the service. */
export function createApiClient(env: NodeJS.ProcessEnv = process.env): ApiClient {
  if (env.FIB_API === 'fake') return new FakeApiClient(env.FIB_FAKE_FIXTURES_DIR);
  return new HttpApiClient(env.FIB_SERVICE_URL ?? 'http://localhost:8787');
}

export interface SessionControllerDeps {
  dealId: string;
  bundle: FormBundle;
  formView: FormViewLike;
  panelView: PanelViewLike;
  getCdpUrl(): string | null;
  api: ApiClient;
  ingestFiles(
    paths: string[],
    onProgress: (progress: IngestProgressLike) => void,
  ): Promise<{ documentSet: DocumentSet; mergedPdf: ArrayBuffer }>;
  findPhrase: FindPhrase;
  /** Overridable for unit tests; defaults to the real CDP-backed driver. */
  driver?: BrowserDriver;
}

/** Grid cell address in the panel's field list: `<groupId>[<row>].<colId>` (ticket 26). */
const GRID_CELL = /^(.+)\[(\d+)\]\.(.+)$/;

/** Same convention as the panel's `eventsForField`: the stepId ends with the field id. */
function isEventForField(stepId: string, fieldId: string): boolean {
  return stepId === fieldId || stepId.endsWith(`:${fieldId}`) || stepId.endsWith(`.${fieldId}`);
}

/** Ticket 26: drop the field's previous events so the badge derives from the re-run only. */
function clearEventsForField(snapshot: SessionSnapshot, fieldId: string): SessionSnapshot {
  return {
    ...snapshot,
    fillEvents: snapshot.fillEvents.filter((event) => !isEventForField(event.stepId, fieldId)),
  };
}

/** Section declaring the scalar field, or — for `<group>[<row>].<col>` ids — the field's grid. */
function sectionContainingField(bundle: FormBundle, fieldId: string): string | null {
  const cell = GRID_CELL.exec(fieldId);
  for (const section of bundle.form.sections) {
    if (cell) {
      if (section.grids.some((grid) => grid.groupId === cell[1])) return section.id;
    } else if (section.fields.some((field) => field.fieldId === fieldId)) {
      return section.id;
    }
  }
  return null;
}

/** Grid cell locator convention (ticket 18): row by index, cell by col-id, inside the grid. */
function cellLocator(
  gridLocator: NonNullable<FillStep['locator']>,
  rowIndex: number,
  colId: string,
): NonNullable<FillStep['locator']> {
  return {
    within: gridLocator,
    css: `.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`,
  };
}

/** Maps DocumentSet pages onto the ExtractionRequest `sources` wire shape, grouped by manifest source. */
export function fromDocumentSet(set: DocumentSet): Source[] {
  const sourceByPage = new Map(set.manifest.map((entry) => [entry.mergedPage, entry.sourceId]));
  const bySource = new Map<string, Source>();
  for (const page of set.pages) {
    const sourceId = sourceByPage.get(page.mergedPage) ?? '';
    let source = bySource.get(sourceId);
    if (!source) {
      source = { sourceId, pages: [] };
      bySource.set(sourceId, source);
    }
    source.pages.push({
      mergedPage: page.mergedPage,
      items: page.items.map((item) => ({ id: item.id, text: item.text })),
    });
  }
  return [...bySource.values()];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function currentUser(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

/**
 * Ticket 25: the first complete fill loop. Owns the `SessionSnapshot` (pure
 * `reduce` + a `session:snapshot` broadcast for every transition) and wires the
 * stages: launch -> formReady -> ingest -> extract -> resolve -> plan -> fill.
 *
 * Grid wiring note: the wire `FillStep` carries no per-cell locator, so before
 * execution each `fillCell` step is bound to the ticket-18 cell locator and the
 * `agGridCell` adapter (inner control from the form's grid column config), and
 * step ids are translated to the panel's documented `fillField:<id>` /
 * `fillCell:<group>[<row>].<col>` convention.
 */
export class SessionController {
  private snapshot: SessionSnapshot = initialSnapshot();
  private readonly driver: BrowserDriver;
  private readonly user = currentUser();
  private readonly pageUrlPrefix: RegExp;
  private logTail: Promise<void> = Promise.resolve();
  private mergedPdf: ArrayBuffer | null = null;
  private runId: string | null = null;
  private driverConnected = false;

  constructor(private readonly deps: SessionControllerDeps) {
    this.driver = deps.driver ?? new PlaywrightDriver();
    const prefix = deps.bundle.urlTemplate.split('{dealId}')[0] ?? deps.bundle.urlTemplate;
    this.pageUrlPrefix = new RegExp(escapeRegExp(prefix));
    this.dispatch({ type: 'launch', dealId: deps.dealId, formId: deps.bundle.formId });
    this.attachFormLoadListener();
  }

  currentSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  // --- IPC entry points -------------------------------------------------------

  filesDropped(paths: string[]): void {
    this.dispatch({ type: 'filesDropped', paths });
  }

  /** The panel renders the viewer itself; main only serves bytes via getMergedPdf. */
  viewerOpen(fieldId: string): void {
    console.log(`[fib] viewer:open ${fieldId}`);
  }

  /**
   * Ticket 26: inline edit. Clears the field's previous fill events (the badge
   * must derive from the new events only), dispatches `userEdit`
   * (review -> filling, value updated), then `onUserEdit` re-runs the
   * single-step plan and returns the session to review via `fillComplete`.
   */
  editField(fieldId: string, value: string): void {
    if (this.snapshot.state !== 'review') {
      console.warn(`[fib] edit ignored: session is ${this.snapshot.state}, not review`);
      return;
    }
    this.snapshot = clearEventsForField(this.snapshot, fieldId);
    this.dispatch({ type: 'userEdit', fieldId, value });
  }

  getMergedPdf(): Uint8Array {
    return this.mergedPdf ? new Uint8Array(this.mergedPdf) : new Uint8Array();
  }

  // --- snapshot plumbing ------------------------------------------------------

  /** Applies the pure reducer, broadcasts the snapshot, then runs the stage's side effects. */
  private dispatch(event: SessionEvent): void {
    let next: SessionSnapshot;
    try {
      next = reduce(this.snapshot, event);
    } catch (err) {
      if (err instanceof IllegalTransition) {
        console.warn(`[fib] ignoring illegal transition: ${err.message}`);
        return;
      }
      throw err;
    }
    this.snapshot = next;
    this.deps.panelView.webContents.send('session:snapshot', next);
    void this.runSideEffects(event);
  }

  private fail(err: unknown): void {
    console.error('[fib] session failed:', err);
    if (this.snapshot.state !== 'failed') {
      this.dispatch({ type: 'fail', reason: messageOf(err) });
    }
  }

  private async runSideEffects(event: SessionEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'formReady':
          await this.onFormReady();
          return;
        case 'filesDropped':
          await this.onFilesDropped(event.paths);
          return;
        case 'ingested':
          await this.onIngested(event.documentSet);
          return;
        case 'extracted':
          await this.onExtracted(event.result);
          return;
        case 'fillEvent':
          this.onFillEvent(event.event);
          return;
        case 'userEdit':
          await this.onUserEdit(event.fieldId);
          return;
        case 'fillComplete':
          await this.log('runFinished', {});
          return;
        default:
          return;
      }
    } catch (err) {
      this.fail(err);
    }
  }

  // --- stages -----------------------------------------------------------------

  private attachFormLoadListener(): void {
    const webContents = this.deps.formView.webContents;
    webContents.on('did-finish-load', () => {
      if (this.snapshot.state !== 'launching') return;
      if (!this.pageUrlPrefix.test(webContents.getURL())) return;
      this.dispatch({ type: 'formReady' });
    });
    // The page may already have finished loading before the listener attached.
    if (
      this.snapshot.state === 'launching' &&
      !webContents.isLoading() &&
      this.pageUrlPrefix.test(webContents.getURL())
    ) {
      this.dispatch({ type: 'formReady' });
    }
  }

  /** The driver attaches once, at formReady, to the desktop's own CDP endpoint. */
  private async onFormReady(): Promise<void> {
    if (this.driverConnected) return;
    const cdpUrl = this.deps.getCdpUrl();
    if (!cdpUrl) throw new Error('CDP endpoint is not available; cannot attach to the form view');
    await this.driver.connect(cdpUrl, this.pageUrlPrefix);
    this.driverConnected = true;
  }

  private async onFilesDropped(paths: string[]): Promise<void> {
    // Drop-anytime rerun (Task 2): drop the previous run's PDF before the new
    // ingest so the viewer can never be served stale citation bytes.
    this.mergedPdf = null;
    // Run log opens with the ingesting stage; log failures are warned, never fatal.
    try {
      const { runId } = await this.deps.api.startRun({
        user: this.user,
        formId: this.deps.bundle.formId,
        dealId: this.deps.dealId,
        sources: paths.map((p) => path.basename(p)),
      });
      this.runId = runId;
    } catch (err) {
      console.warn(`[fib] startRun failed (run log disabled): ${messageOf(err)}`);
    }

    const { documentSet, mergedPdf } = await this.deps.ingestFiles(paths, () => {});
    this.mergedPdf = mergedPdf;
    this.dispatch({ type: 'ingested', documentSet });
  }

  private async onIngested(documentSet: DocumentSet): Promise<void> {
    const result = await this.deps.api.extract({
      formId: this.deps.bundle.formId,
      sources: fromDocumentSet(documentSet),
    });
    this.dispatch({ type: 'extracted', result });
  }

  private async onExtracted(result: ExtractionResult): Promise<void> {
    const set = this.snapshot.documentSet;
    if (!set) throw new Error('resolved without a document set');

    const all = resolve(set, result, this.deps.findPhrase);
    const { snapshotFields, groups } = splitResolved(all, result);

    // Count existing grid rows through the driver before planning (grids in
    // tabbed sections only exist once their tab is active).
    const gridRowCounts: Record<string, number> = {};
    for (const section of this.deps.bundle.form.sections) {
      for (const grid of section.grids) {
        if (section.tab) await this.driver.click(section.tab.locator);
        gridRowCounts[grid.groupId] = await this.driver.count({
          within: grid.locator,
          css: '.ag-row',
        });
      }
    }

    const plan = buildPlan(this.deps.bundle, all.slice(0, result.fields.length), groups, {
      gridRowCounts,
    });
    const { steps, stepIds } = bindPlanSteps(plan.steps, this.deps.bundle);

    this.dispatch({ type: 'resolved', fields: snapshotFields });

    const executor = this.createExecutor();
    const report = await executor.run({ steps }, (fillEvent) =>
      this.dispatch({
        type: 'fillEvent',
        event: { ...fillEvent, stepId: stepIds.get(fillEvent.stepId) ?? fillEvent.stepId },
      }),
    );
    if (report.aborted)
      throw new Error('fill aborted: a protected element was about to be clicked');
    this.dispatch({ type: 'fillComplete' });
  }

  /**
   * Ticket 26: the edit re-push. Builds the single-step plan for the edited
   * `fieldId` — grid cells are addressed `<groupId>[<row>].<colId>` and the
   * planner filter resolves that back to the cell's group/row/column — runs it
   * through the executor, then `fillComplete` returns the session to review.
   */
  private async onUserEdit(fieldId: string): Promise<void> {
    const field = this.snapshot.fields.find((candidate) => candidate.fieldId === fieldId);
    if (!field || field.value === null) {
      throw new Error(`cannot re-push field "${fieldId}": it has no value`);
    }

    const cell = GRID_CELL.exec(fieldId);
    const fields: ResolvedField[] = [];
    const groups: ResolvedGroup[] = [];
    const gridRowCounts: Record<string, number> = {};
    if (cell) {
      const groupId = cell[1] ?? '';
      const rowIndex = Number(cell[2]);
      const colId = cell[3] ?? '';
      // The edited row already exists (the initial fill created it): claim it
      // via gridRowCounts so the plan emits no addRow step.
      gridRowCounts[groupId] = rowIndex + 1;
      groups.push({
        groupId,
        rows: Array.from({ length: rowIndex + 1 }, (_, index) => ({
          cells: index === rowIndex ? [{ ...field, fieldId: colId }] : [],
        })),
      });
    } else {
      fields.push(field);
    }

    const sectionId = sectionContainingField(this.deps.bundle, fieldId);
    if (sectionId === null) {
      throw new Error(`form config does not declare field "${fieldId}"`);
    }

    const plan = buildPlan(this.deps.bundle, fields, groups, { gridRowCounts });
    // Keep the target section's tab navigation and the edited field's single
    // fill step; drop the other sections' navigation and the noValue skips.
    const steps = plan.steps.filter((step) => {
      if (step.kind === 'navigateTab') return step.sectionId === sectionId;
      if (step.kind === 'fillField') return step.fieldId === fieldId;
      if (step.kind === 'fillCell') {
        return (
          cell !== null &&
          step.groupId === cell[1] &&
          step.rowIndex === Number(cell[2]) &&
          step.colId === cell[3]
        );
      }
      return false;
    });

    const { steps: bound, stepIds } = bindPlanSteps(steps, this.deps.bundle);
    const executor = this.createExecutor();
    const report = await executor.run({ steps: bound }, (fillEvent) =>
      this.dispatch({
        type: 'fillEvent',
        event: { ...fillEvent, stepId: stepIds.get(fillEvent.stepId) ?? fillEvent.stepId },
      }),
    );
    if (report.aborted)
      throw new Error('fill aborted: a protected element was about to be clicked');
    this.dispatch({ type: 'fillComplete' });
  }

  /** Executor wired once for the whole session (initial fill and edit re-pushes). */
  private createExecutor(): Executor {
    return new Executor({
      driver: this.driver,
      registry,
      matchOption: async (wanted, options) => {
        const answer = await matchOption(wanted, options, async (w, o) => {
          const llm = await this.deps.api.matchOption({ wanted: w, options: o });
          return { index: llm.index, confidence: llm.confidence };
        });
        // Core's `none` (always index null) has no counterpart in the adapter
        // context's via union; adapters throw on a null index before reading `via`.
        const via = answer.via === 'none' ? 'fuzzy' : answer.via;
        return {
          index: answer.index,
          via,
          confidence: answer.via === 'none' ? 0 : answer.confidence,
        };
      },
      fallback: new A11yFallbackAgent({ api: this.deps.api }),
      neverClick: this.deps.bundle.neverClick,
      profiles: executorProfiles(this.deps.bundle),
    });
  }

  // --- run log ------------------------------------------------------------------

  /** Every FillEvent is logged with a payload restricted to the ticket-09 keys; failures warn, never throw. */
  private onFillEvent(event: FillEvent): void {
    void this.log(event.kind, {
      fieldId: fieldOfStepId(event.stepId),
      status: event.kind,
      ...(event.via !== undefined ? { via: event.via } : {}),
      ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
      ...(event.reason !== undefined ? { reason: event.reason } : {}),
    });
  }

  private log(kind: string, payload: Record<string, unknown>): Promise<void> {
    const enqueue = async (): Promise<void> => {
      if (this.runId === null) return;
      try {
        await this.deps.api.logEvent(this.runId, {
          runId: this.runId,
          ts: new Date().toISOString(),
          user: this.user,
          kind,
          payload,
        });
      } catch (err) {
        console.warn(`[fib] run log: ${kind} failed: ${messageOf(err)}`);
      }
    };
    // Serialise through the queue so events reach the log in fill order.
    this.logTail = this.logTail.then(enqueue, enqueue);
    return this.logTail;
  }
}

// --- module helpers -----------------------------------------------------------

/** Allowed payload keys per ticket 09: fieldId, status, via, confidence, quote, reason, attempt, sourceId, mergedPage. */
function fieldOfStepId(stepId: string): string | null {
  const at = Math.max(stepId.lastIndexOf(':'), stepId.lastIndexOf('.'));
  return at === -1 ? null : stepId.slice(at + 1);
}

/**
 * Splits the flat `resolve` output back into section fields (bare ids, used for
 * planning) and per-group cells, and prefixes cell ids `group[row].col` for the
 * panel's grid grouping (ticket 23/26 convention).
 */
function splitResolved(
  all: ResolvedField[],
  result: ExtractionResult,
): { snapshotFields: ResolvedField[]; groups: ResolvedGroup[] } {
  const fields = all.slice(0, result.fields.length);
  const cells = all.slice(result.fields.length);
  const snapshotFields = [...fields];
  const groups: ResolvedGroup[] = [];
  let index = 0;
  for (const group of result.groups) {
    const rows = group.rows.map((row, rowIndex) => ({
      cells: row.cells.map((cell) => {
        const resolvedCell = cells[index++];
        if (!resolvedCell) {
          throw new Error(
            `extraction group "${group.groupId}" row ${rowIndex} cell "${cell.fieldId}" was not resolved`,
          );
        }
        snapshotFields.push({
          ...resolvedCell,
          fieldId: `${group.groupId}[${rowIndex}].${resolvedCell.fieldId}`,
        });
        return resolvedCell;
      }),
    }));
    groups.push({ groupId: group.groupId, rows });
  }
  return { snapshotFields, groups };
}

/**
 * Binds the plan to the live page: fillCell steps get their ticket-18 cell
 * locator + the `agGridCell` adapter with the column's inner control, and every
 * step id is translated to the panel's step-id convention.
 */
function bindPlanSteps(
  steps: FillStep[],
  bundle: FormBundle,
): { steps: FillStep[]; stepIds: Map<string, string> } {
  const gridByGroupId = new Map<
    string,
    { locator: NonNullable<FillStep['locator']>; columns: { colId: string; control: string }[] }
  >();
  for (const section of bundle.form.sections) {
    for (const grid of section.grids) {
      gridByGroupId.set(grid.groupId, { locator: grid.locator, columns: grid.columns });
    }
  }

  const stepIds = new Map<string, string>();
  const bound = steps.map((step) => {
    if (step.kind === 'fillField' && step.fieldId !== undefined) {
      stepIds.set(step.stepId, `fillField:${step.fieldId}`);
      return step;
    }
    if (
      step.kind === 'fillCell' &&
      step.groupId !== undefined &&
      step.colId !== undefined &&
      step.rowIndex !== undefined
    ) {
      stepIds.set(step.stepId, `fillCell:${step.groupId}[${step.rowIndex}].${step.colId}`);
      const grid = gridByGroupId.get(step.groupId);
      if (!grid?.locator) {
        throw new Error(
          `plan references grid "${step.groupId}" which the form config does not declare`,
        );
      }
      const column = grid.columns.find((candidate) => candidate.colId === step.colId);
      if (!column) {
        throw new Error(`grid "${step.groupId}" has no column "${step.colId}"`);
      }
      return {
        ...step,
        control: 'agGridCell',
        profile: `cell:${column.control}`,
        locator: cellLocator(grid.locator, step.rowIndex, step.colId),
      };
    }
    return step;
  });
  return { steps: bound, stepIds };
}

/** Form profiles plus the synthetic per-inner-control profiles bindPlanSteps references. */
function executorProfiles(bundle: FormBundle): WidgetProfiles {
  const profiles: WidgetProfiles = { ...bundle.profiles };
  for (const control of ['text', 'select', 'searchSelect'] as const) {
    profiles[`cell:${control}`] = { innerControl: control };
  }
  return profiles;
}
