import {
  afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef,
  inject, Injector, OnInit, signal, ViewChild
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../auth.service';
import { I18nService, type LocalizedMessage, type TranslationKey } from '../i18n/i18n.service';
import { HeardPerson, HeardPersonInput, HeardPersonsService, MinorityStatus } from './heard-persons.service';

type Field = keyof HeardPersonInput;
interface Editor { id: string | null; version: number | null; }
const statuses: readonly MinorityStatus[] = ['MINOR', 'ADULT', 'UNKNOWN'];
const referenceValidator: ValidatorFn = control => {
  const value: unknown = control.value;
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120
    ? null : { reference: true };
};
const statusValidator: ValidatorFn = control =>
  statuses.includes(control.value as MinorityStatus) ? null : { minorityStatus: true };

@Component({
  selector: 'app-heard-persons',
  imports: [ReactiveFormsModule],
  templateUrl: './heard-persons.component.html',
  styleUrl: './heard-persons.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeardPersonsComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  private readonly api = inject(HeardPersonsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private editorTrigger: HTMLElement | null = null;
  private requestId = 0;
  @ViewChild('editorDialog') private editorDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('referenceInput') private referenceInput?: ElementRef<HTMLInputElement>;
  @ViewChild('errorSummary') private errorSummary?: ElementRef<HTMLElement>;
  @ViewChild('listTitle') private listTitle?: ElementRef<HTMLElement>;
  readonly persons = signal<HeardPerson[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly reloading = signal(false);
  readonly editor = signal<Editor | null>(null);
  readonly conflict = signal(false);
  readonly serverErrors = signal<Partial<Record<Field, TranslationKey>>>({});
  private readonly loadMessage = signal<LocalizedMessage | null>(null);
  private readonly errorMessage = signal<LocalizedMessage | null>(null);
  private readonly statusMessage = signal<LocalizedMessage | null>(null);
  readonly loadError = computed(() => this.i18n.message(this.loadMessage()));
  readonly error = computed(() => this.i18n.message(this.errorMessage()));
  readonly status = computed(() => this.i18n.message(this.statusMessage()));
  readonly form = new FormGroup({
    reference: new FormControl('', { nonNullable: true, validators: [referenceValidator] }),
    minorityStatus: new FormControl<MinorityStatus>('UNKNOWN', { nonNullable: true, validators: [statusValidator] })
  });

  ngOnInit(): void { this.load(); }

  load(): void {
    const requestId = ++this.requestId;
    this.loading.set(true);
    this.loadMessage.set(null);
    this.api.list().pipe(
      finalize(() => { if (requestId === this.requestId) this.loading.set(false); }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: rows => { if (requestId === this.requestId) this.persons.set(rows); },
      error: (failure: unknown) => {
        if (requestId === this.requestId) this.loadMessage.set(this.failureMessage(failure));
      }
    });
  }

  create(event?: Event): void {
    if (!this.auth.hasScope('heard-persons.write') || this.saving() || this.reloading() || this.loading() || this.editor()) return;
    this.captureTrigger(event);
    this.clearFeedback();
    this.editor.set({ id: null, version: null });
    this.form.reset({ reference: '', minorityStatus: 'UNKNOWN' });
    this.focusEditor();
  }

  edit(person: HeardPerson, event?: Event): void {
    if (!this.auth.hasScope('heard-persons.write') || this.saving() || this.reloading() || this.loading() || this.editor()) return;
    this.captureTrigger(event);
    this.clearFeedback();
    this.setEditor(person);
    this.focusEditor();
  }

  cancel(): void {
    if (this.saving() || this.reloading()) return;
    this.closeEditor();
    this.clearFeedback();
  }

  save(): void {
    const editor = this.editor();
    if (!editor || !this.auth.hasScope('heard-persons.write') || this.saving() || this.reloading()
        || this.loading() || this.conflict()) return;
    this.errorMessage.set(null);
    this.statusMessage.set(null);
    this.serverErrors.set({});
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set({ key: 'persons.invalid' });
      this.focusError();
      return;
    }
    const input = this.form.getRawValue();
    this.saving.set(true);
    const operation = editor.id === null ? this.api.create(input)
      : this.api.update(editor.id, input, editor.version!);
    operation.pipe(
      finalize(() => this.saving.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.closeEditor();
        this.conflict.set(false);
        this.statusMessage.set({ key: 'persons.saved' });
        this.load();
      },
      error: (failure: unknown) => {
        if (failure instanceof HttpErrorResponse && failure.status === 409
            && this.problemCode(failure.error) === 'reference_conflict') {
          this.serverErrors.set({ reference: 'persons.referenceConflict' });
          this.errorMessage.set({ key: 'persons.referenceConflict' });
        } else if (failure instanceof HttpErrorResponse && failure.status === 409 && editor.id !== null) {
          this.conflict.set(true);
          this.errorMessage.set({ key: 'persons.conflict' });
        } else {
          this.errorMessage.set(this.failureMessage(failure));
          if (failure instanceof HttpErrorResponse && failure.status === 400) this.mapFieldErrors(failure.error);
        }
        this.focusError();
      }
    });
  }

  reloadVersion(): void {
    const editor = this.editor();
    if (!editor?.id || this.saving() || this.reloading()) return;
    this.reloading.set(true);
    this.errorMessage.set(null);
    this.api.get(editor.id).pipe(
      finalize(() => this.reloading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: person => {
        this.setEditor(person);
        this.clearFeedback();
        this.statusMessage.set({ key: 'persons.reloaded' });
        this.focusEditor();
      },
      error: (failure: unknown) => {
        this.errorMessage.set(this.failureMessage(failure));
        this.focusError();
      }
    });
  }

  minorityLabel(status: MinorityStatus): string {
    const key: TranslationKey = status === 'MINOR' ? 'persons.minor'
      : status === 'ADULT' ? 'persons.adult' : 'persons.unknown';
    return this.i18n.t(key);
  }

  fieldError(field: Field): string {
    const server = this.serverErrors()[field];
    if (server) return this.i18n.t(server);
    const control = this.form.controls[field];
    return control.touched && control.invalid ? this.i18n.t(
      field === 'reference' ? 'persons.field.reference' : 'persons.field.minorityStatus'
    ) : '';
  }

  cancelDialog(event: Event): void { event.preventDefault(); this.cancel(); }

  trapDialogFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !(event.currentTarget instanceof HTMLDialogElement)) return;
    const dialog = event.currentTarget;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex]'
    )).filter(control => {
      const style = getComputedStyle(control);
      return control.tabIndex >= 0 && !control.matches(':disabled')
        && control.closest('[hidden], [inert]') === null
        && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const first = controls[0], last = controls[controls.length - 1];
    const active = dialog.ownerDocument.activeElement;
    if (!first || !last) { event.preventDefault(); dialog.focus(); }
    else if (!controls.some(control => control === active)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  private setEditor(person: HeardPerson): void {
    this.editor.set({ id: person.id, version: person.version });
    this.form.reset({ reference: person.reference, minorityStatus: person.minorityStatus });
  }
  private clearFeedback(): void {
    this.errorMessage.set(null); this.statusMessage.set(null); this.conflict.set(false); this.serverErrors.set({});
  }
  private failureMessage(failure: unknown): LocalizedMessage {
    if (failure instanceof HttpErrorResponse) {
      if (failure.status === 401) return { key: 'persons.unauthorized' };
      if (failure.status === 403) return { key: 'persons.forbidden' };
      if (failure.status === 404) return { key: 'persons.missing' };
      if (failure.status === 400) return { key: 'persons.badRequest' };
      if (failure.status === 0) return { key: 'persons.network' };
    }
    return { key: 'persons.failure' };
  }
  private problemCode(body: unknown): unknown {
    return body && typeof body === 'object' && 'code' in body ? body.code : null;
  }
  private mapFieldErrors(body: unknown): void {
    const errors: Partial<Record<Field, TranslationKey>> = {};
    if (body && typeof body === 'object' && 'errors' in body && Array.isArray(body.errors)) {
      for (const item of body.errors as unknown[]) {
        if (!item || typeof item !== 'object' || !('field' in item)) continue;
        if (item.field === 'reference') errors.reference = 'persons.field.reference';
        if (item.field === 'minorityStatus') errors.minorityStatus = 'persons.field.minorityStatus';
      }
    }
    this.serverErrors.set(errors);
  }
  private captureTrigger(event?: Event): void {
    const active = event?.currentTarget ?? this.listTitle?.nativeElement.ownerDocument.activeElement;
    this.editorTrigger = active instanceof HTMLElement ? active : null;
  }
  private closeEditor(): void {
    this.editorDialog?.nativeElement.close();
    this.editor.set(null);
    const trigger = this.editorTrigger;
    this.editorTrigger = null;
    afterNextRender(() => {
      if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
      else this.listTitle?.nativeElement.focus();
    }, { injector: this.injector });
  }
  private focusEditor(): void {
    afterNextRender(() => {
      const dialog = this.editorDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      this.referenceInput?.nativeElement.focus();
    }, { injector: this.injector });
  }
  private focusError(): void {
    afterNextRender(() => this.errorSummary?.nativeElement.focus(), { injector: this.injector });
  }
}
