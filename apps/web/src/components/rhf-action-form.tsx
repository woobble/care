'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  createElement,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  type FieldValues,
  type Resolver,
} from 'react-hook-form';
import { z } from 'zod';

import { Field, FieldDescription, FieldError, FieldLabel } from '@care/ui/components/field';
import { Input } from '@care/ui/components/input';
import { NativeSelect } from '@care/ui/components/native-select';
import { Textarea } from '@care/ui/components/textarea';

type ServerAction = (
  formData: FormData,
) => void | boolean | string | Promise<void | boolean | string>;
type FormValues = FieldValues;

const permissiveFormSchema = z.record(z.string(), z.unknown());
const confirmedNavigationEvents = new WeakSet<Event>();

type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function buildNativeSchema(
  controls: NativeControl[],
  messages: {
    required: string;
    checked: string;
    selectOne: string;
    selectAtLeastOne: string;
    validEmail: string;
    validUrl: string;
    numberRange: string;
    minLength: (count: number) => string;
    maxLength: (count: number) => string;
  },
) {
  const byName = new Map<string, NativeControl[]>();
  for (const control of controls) {
    if (
      (control instanceof HTMLInputElement && control.type === 'hidden') ||
      (control instanceof HTMLInputElement &&
        ['button', 'reset', 'submit', 'image'].includes(control.type))
    ) {
      continue;
    }
    const group = byName.get(control.name) ?? [];
    group.push(control);
    byName.set(control.name, group);
  }

  const validators = new Map<string, z.ZodType>();
  for (const [name, group] of byName) {
    const first = group[0];
    if (!first) continue;
    const required = group.some((control) => control.required);
    const inputs = group.filter(
      (control): control is HTMLInputElement => control instanceof HTMLInputElement,
    );
    const checkboxGroup =
      inputs.length > 1 && inputs.every((control) => control.type === 'checkbox');
    const radioGroup = inputs.length > 1 && inputs.every((control) => control.type === 'radio');

    if (
      checkboxGroup ||
      (inputs.length === 1 && first instanceof HTMLInputElement && first.type === 'checkbox')
    ) {
      let validator: z.ZodType = checkboxGroup
        ? z.array(z.string())
        : z.union([z.boolean(), z.string()]);
      if (required) {
        validator = checkboxGroup
          ? z.array(z.string()).min(1, { message: messages.checked })
          : validator.refine((value) => value === true || value === 'true' || value === 'on', {
              message: messages.checked,
            });
      } else {
        validator = validator.optional();
      }
      validators.set(name, validator);
      continue;
    }

    if (first instanceof HTMLInputElement && first.type === 'file') {
      validators.set(name, z.unknown());
      continue;
    }
    if (first instanceof HTMLSelectElement && first.multiple) {
      let validator: z.ZodType = z.array(z.string());
      if (required) {
        validator = z.array(z.string()).min(1, { message: messages.selectAtLeastOne });
      } else {
        validator = validator.optional();
      }
      validators.set(name, validator);
      continue;
    }

    let validator = z.string();
    if (required) {
      validator = z.string().refine((value) => value.trim().length > 0, {
        message: messages.required,
      });
    }
    if (first instanceof HTMLInputElement && first.type === 'email') {
      validator = validator.refine(
        (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        { message: messages.validEmail },
      );
    } else if (first instanceof HTMLInputElement && first.type === 'url') {
      validator = validator.refine((value) => value === '' || URL.canParse(value), {
        message: messages.validUrl,
      });
    } else if (first instanceof HTMLInputElement && first.type === 'number') {
      const minimum = first.min === '' ? undefined : Number(first.min);
      const maximum = first.max === '' ? undefined : Number(first.max);
      validator = validator.refine(
        (value) => {
          if (value === '') return true;
          const number = Number(value);
          return (
            Number.isFinite(number) &&
            (minimum === undefined || number >= minimum) &&
            (maximum === undefined || number <= maximum)
          );
        },
        { message: messages.numberRange },
      );
    }

    const minLength = Number(first.getAttribute('minlength'));
    const maxLength = Number(first.getAttribute('maxlength'));
    if (Number.isFinite(minLength) && minLength > 0) {
      validator = validator.refine((value) => value === '' || value.length >= minLength, {
        message: messages.minLength(minLength),
      });
    }
    if (Number.isFinite(maxLength) && maxLength > 0) {
      validator = validator.refine((value) => value.length <= maxLength, {
        message: messages.maxLength(maxLength),
      });
    }
    if (radioGroup && required) {
      validator = z.string().min(1, { message: messages.selectOne });
    }
    validators.set(name, required ? validator : validator.optional());
  }

  return permissiveFormSchema.superRefine((values, context) => {
    for (const [name, validator] of validators) {
      const segments = name.replace(/\[(\d+)\]/g, '.$1').split('.');
      let value: unknown = values;
      for (const segment of segments) {
        if (!value || typeof value !== 'object') {
          value = undefined;
          break;
        }
        value = (value as Record<string, unknown>)[segment];
      }
      const result = validator.safeParse(value);
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({
            code: 'custom',
            path: segments,
            message: issue.message,
          });
        }
      }
    }
  });
}

function collectErrorMessages(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if ('message' in value && typeof value.message === 'string') return [value.message];
  return Object.values(value).flatMap(collectErrorMessages);
}

export function RHFActionForm({
  action,
  beforeAction,
  onChange,
  errorMessage,
  warnOnUnsavedChanges = false,
  refreshOnSuccess = false,
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit' | 'onChange'> & {
  action: ServerAction;
  beforeAction?: (form: HTMLFormElement, data: FormData) => boolean | Promise<boolean>;
  onChange?: FormHTMLAttributes<HTMLFormElement>['onChange'];
  errorMessage?: ReactNode;
  warnOnUnsavedChanges?: boolean;
  refreshOnSuccess?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('Common.formValidation');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [actionPending, startActionTransition] = useTransition();
  const [nativeSchema, setNativeSchema] = useState<z.ZodType>(permissiveFormSchema);
  const [actionFailure, setActionFailure] = useState<string | false | null>(null);
  const methods = useForm<FormValues>({
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    resolver: zodResolver(nativeSchema as never) as Resolver<FormValues>,
  });
  const { getValues, register, reset, setValue } = methods;
  const nativeAction = action as (formData: FormData) => void | Promise<void>;

  useEffect(() => {
    if (
      !warnOnUnsavedChanges ||
      !methods.formState.isDirty ||
      methods.formState.isSubmitting ||
      actionPending
    )
      return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmNavigation = (event: MouseEvent) => {
      if (confirmedNavigationEvents.has(event)) return;
      confirmedNavigationEvents.add(event);
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      )
        return;
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      )
        return;
      if (!window.confirm(t('unsavedChanges'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const confirmOtherFormSubmit = (event: SubmitEvent) => {
      if (
        confirmedNavigationEvents.has(event) ||
        !(event.target instanceof HTMLFormElement) ||
        event.target === formRef.current
      )
        return;
      confirmedNavigationEvents.add(event);
      if (!window.confirm(t('unsavedChangesOtherAction'))) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', confirmNavigation, true);
    document.addEventListener('submit', confirmOtherFormSubmit, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', confirmNavigation, true);
      document.removeEventListener('submit', confirmOtherFormSubmit, true);
    };
  }, [
    actionPending,
    methods.formState.isDirty,
    methods.formState.isSubmitting,
    t,
    warnOnUnsavedChanges,
  ]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const controls = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input[name], select[name], textarea[name]',
      ),
    );
    const registeredRefs: Array<
      (element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null) => void
    > = [];
    for (const control of controls) {
      if (control.hasAttribute('data-rhf-controlled')) continue;
      const registration = register(control.name);
      registration.ref(control);
      registeredRefs.push(registration.ref);
    }
    reset(getValues());
    setNativeSchema(
      buildNativeSchema(controls, {
        required: t('required'),
        checked: t('checked'),
        selectOne: t('selectOne'),
        selectAtLeastOne: t('selectAtLeastOne'),
        validEmail: t('validEmail'),
        validUrl: t('validUrl'),
        numberRange: t('numberRange'),
        minLength: (count) => t('minLength', { count }),
        maxLength: (count) => t('maxLength', { count }),
      }),
    );

    return () => {
      for (const ref of registeredRefs) ref(null);
    };
  }, [getValues, register, reset, t]);

  async function submit(data: FormData) {
    const form = formRef.current;
    if (!form) return;
    if (beforeAction && !(await beforeAction(form, data))) return;
    startActionTransition(async () => {
      // Keep redirect signals inside the transition so Next can handle server-action navigation.
      const result = await action(data);
      setActionFailure(result === false || typeof result === 'string' ? result : null);
      if (result !== false && refreshOnSuccess) router.refresh();
    });
  }

  const submitting = methods.formState.isSubmitting || actionPending;

  function handleChange(event: React.ChangeEvent<HTMLFormElement>) {
    setActionFailure(null);
    const control = event.target;
    if (
      !(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      ) ||
      !control.name ||
      control.hasAttribute('data-rhf-controlled')
    ) {
      onChange?.(event);
      return;
    }

    let value: unknown = control.value;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      const group = Array.from(formRef.current?.elements ?? []).filter(
        (element): element is HTMLInputElement =>
          element instanceof HTMLInputElement &&
          element.type === 'checkbox' &&
          element.name === control.name,
      );
      value =
        group.length > 1
          ? group.filter((element) => element.checked).map((element) => element.value)
          : control.checked;
    } else if (control instanceof HTMLInputElement && control.type === 'radio') {
      value = control.checked
        ? control.value
        : (Array.from(formRef.current?.elements ?? []).find(
            (element): element is HTMLInputElement =>
              element instanceof HTMLInputElement &&
              element.type === 'radio' &&
              element.name === control.name &&
              element.checked,
          )?.value ?? '');
    } else if (control instanceof HTMLSelectElement && control.multiple) {
      value = Array.from(control.selectedOptions, (option) => option.value);
    }

    setValue(control.name, value, { shouldDirty: true, shouldValidate: true });
    onChange?.(event);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data =
      submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
        ? new FormData(event.currentTarget, submitter)
        : new FormData(event.currentTarget);
    return methods.handleSubmit(() => submit(data))(event);
  }

  return (
    <FormProvider {...methods}>
      <form
        {...props}
        ref={formRef}
        action={nativeAction}
        aria-busy={submitting}
        onChange={handleChange}
        onSubmit={handleSubmit}
      >
        <fieldset disabled={submitting} className="contents">
          {children}
        </fieldset>
        {submitting ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {t('saving')}
          </p>
        ) : null}
        {actionFailure !== null ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3"
          >
            {errorMessage ?? t('actionFailed')}
          </div>
        ) : null}
        {collectErrorMessages(methods.formState.errors).length ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3"
          >
            <FieldError
              errors={collectErrorMessages(methods.formState.errors).map((message) => ({
                message,
              }))}
            />
          </div>
        ) : null}
      </form>
    </FormProvider>
  );
}

type RHFFieldProps = {
  name: string;
  label: ReactNode;
  description?: ReactNode;
  required?: boolean;
};

type RHFInputFieldProps = RHFFieldProps &
  Omit<React.ComponentProps<typeof Input>, 'name' | 'value'>;

export function RHFInputField({
  name,
  label,
  description,
  required,
  id,
  ...inputProps
}: RHFInputFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const { control } = useFormContext<FormValues>();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={inputId}>
            {label}
            {required ? <span aria-hidden="true"> *</span> : null}
          </FieldLabel>
          <Input
            {...inputProps}
            id={inputId}
            name={field.name}
            ref={field.ref}
            value={
              typeof field.value === 'string' || typeof field.value === 'number' ? field.value : ''
            }
            onBlur={field.onBlur}
            onChange={field.onChange}
            required={required}
            aria-invalid={fieldState.invalid}
            data-rhf-controlled="true"
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  );
}

type RHFTextareaFieldProps = RHFFieldProps &
  Omit<React.ComponentProps<typeof Textarea>, 'name' | 'value'>;

export function RHFTextareaField({
  name,
  label,
  description,
  required,
  id,
  ...textareaProps
}: RHFTextareaFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const { control } = useFormContext<FormValues>();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={inputId}>
            {label}
            {required ? <span aria-hidden="true"> *</span> : null}
          </FieldLabel>
          <Textarea
            {...textareaProps}
            id={inputId}
            name={field.name}
            ref={field.ref}
            value={typeof field.value === 'string' ? field.value : ''}
            onBlur={field.onBlur}
            onChange={field.onChange}
            required={required}
            aria-invalid={fieldState.invalid}
            data-rhf-controlled="true"
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  );
}

type RHFSelectFieldProps = RHFFieldProps &
  Omit<React.ComponentProps<'select'>, 'name' | 'value' | 'children' | 'size'> & {
    children: ReactNode;
  };

export function RHFSelectField({
  name,
  label,
  description,
  required,
  id,
  children,
  ...selectProps
}: RHFSelectFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const { control } = useFormContext<FormValues>();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={inputId}>
            {label}
            {required ? <span aria-hidden="true"> *</span> : null}
          </FieldLabel>
          {createElement(
            NativeSelect,
            {
              ...selectProps,
              id: inputId,
              name: field.name,
              ref: field.ref,
              value: typeof field.value === 'string' ? field.value : '',
              onBlur: field.onBlur,
              onChange: field.onChange,
              required,
              'aria-invalid': fieldState.invalid,
              'data-rhf-controlled': 'true',
              className: 'w-full',
            } as React.ComponentProps<typeof NativeSelect> & { 'data-rhf-controlled': string },
            children,
          )}
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  );
}
