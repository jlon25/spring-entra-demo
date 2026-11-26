import {
  afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef,
  inject, Injector, OnInit, signal, ViewChild
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../auth.service';
import { I18nService, type LocalizedMessage, type TranslationKey } from '../i18n/i18n.service';
import { HearingType, HearingTypeInput, HearingTypesService } from './hearing-types.service';

type Field = keyof HearingTypeInput;
interface Editor { id: string | null; version: number | null; }
const fields: readonly Field[] = ['label', 'durationMinutes', 'pauseMinutes', 'defenderRequired'];

const normalizedLabel: ValidatorFn = (control: AbstractControl) => {
  const value: unknown = control.value;
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120
    ? null : { label: true };
};

function integer(minimum: number): ValidatorFn {
  return (control: AbstractControl) => {
    const value: unknown = control.value;
    if (value === null || value === '') return null; // Required is reported separately.
    return typeof value === 'number' && Number.isInteger(value)
      && value >= minimum && value <= 2_147_483_647 ? null : { integer: true };
  };
}

@Component({
  selector: 'app-hearing-types',
  imports: [ReactiveFormsModule],
  templateUrl: './hearing-types.component.html',
  styleUrl: './hearing-types.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HearingTypesComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  private readonly api = inject(HearingTypesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  @ViewChild('editorDialog') private editorDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('deleteDialog') private deleteDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('deleteCancel') private deleteCancel?: ElementRef<HTMLButtonElement>;
  private editorTrigger: HTMLElement | null = null;
  private deletionTrigger: HTMLElement | null = null;
  @ViewChild('deleteTitle') private deleteTitle?: ElementRef<HTMLElement>;
  @ViewChild('listTitle') private listTitle?: ElementRef<HTMLElement>;
  @ViewChild('editorInput') private editorInput?: ElementRef<HTMLInputElement>;
  @ViewChild('errorSummary') private errorSummary?: ElementRef<HTMLElement>;
  readonly types = signal<HearingType[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly reloading = signal(false);
  readonly deleting = signal(false);
  readonly deletion = signal<HearingType | null>(null);
  private readonly deleteErrorMessage = signal<LocalizedMessage | null>(null);
  readonly deleteError = computed(() => this.i18n.message(this.deleteErrorMessage()));
  readonly deleteBlocked = signal(false);
  private readonly loadErrorMessage = signal<LocalizedMessage | null>(null);
  readonly loadError = computed(() => this.i18n.message(this.loadErrorMessage()));
  private readonly errorMessage = signal<LocalizedMessage | null>(null);
  readonly error = computed(() => this.i18n.message(this.errorMessage()));
  private readonly statusMessage = signal<LocalizedMessage | null>(null);
  readonly status = computed(() => this.i18n.message(this.statusMessage()));
  readonly conflict = signal(false);
  readonly editor = signal<Editor | null>(null);
  readonly serverErrors = signal<Partial<Record<Field, TranslationKey>>>({});
  readonly form = new FormGroup({
    label: new FormControl('', { nonNullable: true, validators: [normalizedLabel] }),
    durationMinutes: new FormControl<number | null>(null, [Validators.required, integer(1)]),
    pauseMinutes: new FormControl<number | null>(null, [Validators.required, integer(0)]),
    defenderRequired: new FormControl(false, { nonNullable: true })
  });

  ngOnInit(): void { this.load(); }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadErrorMessage.set(null);
    this.api.list().pipe(
      finalize(() => this.loading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: rows => this.types.set(rows),
      error: (failure: unknown) => this.loadErrorMessage.set(this.failureMessage(failure, 'load'))
    });
  }

  create(event?: Event): void {
    if (!this.auth.hasScope('hearing-types.write') || this.saving() || this.reloading() || this.loading() || this.deleting() || this.deletion() !== null) return;
    this.editorTrigger = this.activeElement(event);
    this.clearFeedback();
    this.editor.set({ id: null, version: null });
    this.form.reset({ label: '', durationMinutes: null, pauseMinutes: null, defenderRequired: false });
    this.focusEditor();
  }

  edit(type: HearingType, event?: Event): void {
    if (!this.auth.hasScope('hearing-types.write') || this.saving() || this.reloading() || this.deleting() || this.deletion() !== null) return;
    this.editorTrigger = this.activeElement(event);
    this.clearFeedback();
    this.setEditor(type);
    this.focusEditor();
  }

  cancel(): void {
    if (this.saving() || this.reloading() || this.deleting() || this.deletion() !== null) return;
    this.closeEditor();
    this.clearFeedback();
  }

  save(): void {
    const editor = this.editor();
    if (!editor || !this.auth.hasScope('hearing-types.write') || this.saving() || this.reloading() || this.loading() || this.conflict() || this.deleting() || this.deletion() !== null) return;
    this.errorMessage.set(null);
    this.serverErrors.set({});
    this.statusMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set({ key: 'hearing.invalid' });
      this.focusError();
      return;
    }
    const values = this.form.getRawValue();
    // Validation above guarantees numbers; do not coerce strings or invent defaults.
    if (values.durationMinutes === null || values.pauseMinutes === null) return;
    const input: HearingTypeInput = {
      label: values.label.trim(), durationMinutes: values.durationMinutes,
      pauseMinutes: values.pauseMinutes, defenderRequired: values.defenderRequired
    };
    this.saving.set(true);
    const operation = editor.id === null
      ? this.api.create(input)
      : this.api.update(editor.id, input, editor.version!);
    operation.pipe(
      finalize(() => this.saving.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: saved => {
        this.closeEditor();
        this.conflict.set(false);
        this.statusMessage.set({ key: 'hearing.saved', params: { label: saved.label } });
        this.load();
      },
      error: (failure: unknown) => {
        if (failure instanceof HttpErrorResponse && failure.status === 409) {
          this.conflict.set(true);
          this.errorMessage.set({ key: 'hearing.conflict' });
        } else {
          this.errorMessage.set(this.failureMessage(failure, 'save'));
          if (failure instanceof HttpErrorResponse && failure.status === 400) {
            this.serverErrors.set(this.readFieldErrors(failure.error));
          }
        }
        this.focusError();
      }
    });
  }

  reloadVersion(): void {
    const editor = this.editor();
    if (!editor?.id || this.saving() || this.reloading() || this.deleting() || this.deletion() !== null) return;
    this.reloading.set(true);
    this.errorMessage.set(null);
    this.api.get(editor.id).pipe(
      finalize(() => this.reloading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: current => {
        this.setEditor(current);
        this.clearFeedback();
        this.statusMessage.set({ key: 'hearing.reloaded' });
        this.focusEditor();
      },
      error: (failure: unknown) => {
        this.errorMessage.set(this.failureMessage(failure, 'reload'));
        this.focusError();
      }
    });
  }

  requestDeletion(type: HearingType, event?: Event): void {
    if (!this.auth.hasScope('hearing-types.write') || this.deleting() || this.deletion()
        || this.saving() || this.reloading() || this.loading()) return;
    this.deletionTrigger = this.activeElement(event);
    this.deleteErrorMessage.set(null);
    this.deleteBlocked.set(false);
    this.deletion.set({ ...type });
    afterNextRender(() => {
      const dialog = this.deleteDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      this.deleteCancel?.nativeElement.focus();
    }, { injector: this.injector });
  }

  cancelDeletion(): void {
    if (this.deleting()) return;
    this.closeDeletion();
    this.deleteErrorMessage.set(null);
    this.deleteBlocked.set(false);
  }

  confirmDeletion(): void {
    const target = this.deletion();
    if (!target || !this.auth.hasScope('hearing-types.write') || this.deleting()
        || this.deleteBlocked() || this.saving() || this.reloading() || this.loading()) return;
    this.deleting.set(true);
    this.deleteErrorMessage.set(null);
    this.api.remove(target.id, target.version).pipe(
      finalize(() => this.deleting.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.closeDeletion();
        if (this.editor()?.id === target.id) {
          this.closeEditor();
          this.clearFeedback();
        }
        this.statusMessage.set({ key: 'hearing.deleted', params: { label: target.label } });
        this.load();
      },
      error: (failure: unknown) => {
        if (failure instanceof HttpErrorResponse && (failure.status === 409 || failure.status === 404)) {
          this.deleteBlocked.set(true);
          this.deleteErrorMessage.set({ key: failure.status === 409 ? 'hearing.deleteConflict' : 'hearing.deleteMissing' });
        } else {
          this.deleteErrorMessage.set(this.failureMessage(failure, 'delete'));
        }
        afterNextRender(() => this.deleteTitle?.nativeElement.focus(), { injector: this.injector });
      }
    });
  }

  reloadForDeletion(): void {
    if (this.deleting()) return;
    this.cancelDeletion();
    this.load();
  }

  fieldError(field: Field): string {
    const server = this.serverErrors()[field];
    if (server) return this.i18n.t(server);
    const control = this.form.controls[field];
    if (!control.touched || !control.invalid) return '';
    if (field === 'label') return this.i18n.t('hearing.field.label');
    if (field === 'durationMinutes') return this.i18n.t('hearing.field.durationMinutes');
    return this.i18n.t('hearing.field.pauseMinutes');
  }

  private setEditor(type: HearingType): void {
    this.editor.set({ id: type.id, version: type.version });
    this.form.reset({
      label: type.label, durationMinutes: type.durationMinutes,
      pauseMinutes: type.pauseMinutes, defenderRequired: type.defenderRequired
    });
  }

  private clearFeedback(): void {
    this.errorMessage.set(null);
    this.statusMessage.set(null);
    this.conflict.set(false);
    this.serverErrors.set({});
  }

  private failureMessage(failure: unknown, action: 'load' | 'save' | 'reload' | 'delete'): LocalizedMessage {
    if (failure instanceof HttpErrorResponse) {
      if (failure.status === 401) return { key: 'hearing.unauthorized' };
      if (failure.status === 403) return { key: `hearing.forbidden.${action}` };
      if (failure.status === 404) return { key: 'hearing.missing' };
      if (failure.status === 400) return { key: 'hearing.badRequest' };
      if (failure.status === 0) return { key: 'hearing.network' };
    }
    return { key: `hearing.failure.${action}` };
  }

  private readFieldErrors(body: unknown): Partial<Record<Field, TranslationKey>> {
    const result: Partial<Record<Field, TranslationKey>> = {};
    if (!body || typeof body !== 'object' || !('errors' in body) || !Array.isArray(body.errors)) return result;
    const items: readonly unknown[] = body.errors;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !('field' in item) || !('message' in item)) continue;
      const field: unknown = item.field;
      const message: unknown = item.message;
      if (typeof field === 'string' && fields.includes(field as Field)
          && typeof message === 'string' && message.length <= 500) {
        // The field identifies a localizable client message; never render server prose.
        result[field as Field] = `hearing.field.${field as Field}`;
      }
    }
    return result;
  }

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
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = dialog.ownerDocument.activeElement;
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (!controls.some(control => control === active)) {
      // Error summaries and the dialog itself receive programmatic focus.
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  cancelEditorDialog(event: Event): void {
    event.preventDefault();
    this.cancel();
  }

  cancelDeleteDialog(event: Event): void {
    event.preventDefault();
    this.cancelDeletion();
  }

  private activeElement(event?: Event): HTMLElement | null {
    if (event?.currentTarget instanceof HTMLElement) return event.currentTarget;
    const active = this.listTitle?.nativeElement.ownerDocument.activeElement;
    return active instanceof HTMLElement ? active : null;
  }

  private restoreFocus(trigger: HTMLElement | null): void {
    afterNextRender(() => {
      if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
      else this.listTitle?.nativeElement.focus();
    }, { injector: this.injector });
  }

  private closeEditor(): void {
    this.editorDialog?.nativeElement.close();
    this.editor.set(null);
    this.restoreFocus(this.editorTrigger);
    this.editorTrigger = null;
  }

  private closeDeletion(): void {
    this.deleteDialog?.nativeElement.close();
    this.deletion.set(null);
    this.restoreFocus(this.deletionTrigger);
    this.deletionTrigger = null;
  }

  private focusEditor(): void {
    afterNextRender(() => {
      const dialog = this.editorDialog?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
      this.editorInput?.nativeElement.focus();
    }, { injector: this.injector });
  }

  private focusError(): void {
    afterNextRender(() => this.errorSummary?.nativeElement.focus(), { injector: this.injector });
  }
}
