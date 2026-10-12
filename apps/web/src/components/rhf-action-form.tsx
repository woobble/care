'use client';

import {
  createElement,
  useEffect,
  useId,
  useRef,
  useState,
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
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  NativeSelect,
  Textarea,
} from '@care/ui';

type ServerAction = (formData: FormData) => void | Promise<void>;
type FormValues = FieldValues;

const permissiveFormSchema = z.record(z.string(), z.unknown());

type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function buildNativeSchema(controls: NativeControl[]) {
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
      let validator: z.ZodType = checkboxGroup ? z.array(z.string()) : z.boolean();
      if (group.some((control) => control.required)) {
        validator = checkboxGroup
          ? z.array(z.string()).min(1)
          : z.boolean().refine(Boolean, { message: 'Select this option.' });
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
      if (group.some((control) => control.required)) {
        validator = z.array(z.string()).min(1, { message: 'Select at least one option.' });
      }
      validators.set(name, validator);
      continue;
    }

    let validator = z.string();
    if (group.some((control) => control.required)) {
      validator = z.string().refine((value) => value.trim().length > 0, {
        message: 'This field is required.',
      });
    }
    if (first instanceof HTMLInputElement && first.type === 'email') {
      validator = validator.refine(
        (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        { message: 'Enter a valid email address.' },
      );
    } else if (first instanceof HTMLInputElement && first.type === 'url') {
      validator = validator.refine((value) => value === '' || URL.canParse(value), {
        message: 'Enter a valid URL.',
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
        { message: 'Enter a number within the allowed range.' },
      );
    }

    const minLength = Number(first.getAttribute('minlength'));
    const maxLength = Number(first.getAttribute('maxlength'));
    if (Number.isFinite(minLength) && minLength > 0) {
      validator = validator.refine((value) => value === '' || value.length >= minLength, {
        message: `Use at least ${minLength} characters.`,
      });
    }
    if (Number.isFinite(maxLength) && maxLength > 0) {
      validator = validator.refine((value) => value.length <= maxLength, {
        message: `Use no more than ${maxLength} characters.`,
      });
    }
    if (radioGroup && group.some((control) => control.required)) {
      validator = z.string().min(1, { message: 'Select an option.' });
    }
    validators.set(name, validator);
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
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit' | 'onChange'> & {
  action: ServerAction;
  beforeAction?: (form: HTMLFormElement, data: FormData) => boolean | Promise<boolean>;
  onChange?: FormHTMLAttributes<HTMLFormElement>['onChange'];
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [nativeSchema, setNativeSchema] = useState<z.ZodType>(permissiveFormSchema);
  const methods = useForm<FormValues>({
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    resolver: zodResolver(nativeSchema as never) as Resolver<FormValues>,
  });
  const { register, setValue } = methods;

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
    setNativeSchema(buildNativeSchema(controls));

    return () => {
      for (const ref of registeredRefs) ref(null);
    };
  }, [register]);

  async function submit(_values: FormValues, event?: { nativeEvent?: unknown }) {
    const form = formRef.current;
    if (!form) return;

    const nativeEvent = event?.nativeEvent as SubmitEvent | undefined;
    const submitter = nativeEvent?.submitter ?? null;
    const data =
      submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
        ? new FormData(form, submitter)
        : new FormData(form);

    if (beforeAction && !(await beforeAction(form, data))) return;
    await action(data);
  }

  function handleChange(event: React.ChangeEvent<HTMLFormElement>) {
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
    return methods.handleSubmit(submit)(event);
  }

  return (
    <FormProvider {...methods}>
      <form
        {...props}
        ref={formRef}
        action={action}
        aria-busy={methods.formState.isSubmitting}
        onChange={handleChange}
        onSubmit={handleSubmit}
      >
        {children}
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
