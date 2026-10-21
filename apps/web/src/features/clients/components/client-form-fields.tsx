import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';

export function TextField({
  id,
  name,
  label,
  type = 'text',
  autoComplete,
  defaultValue,
  required = false,
  maxLength,
  min,
  max,
  step,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        min={min === undefined ? undefined : Number(min)}
        max={max === undefined ? undefined : Number(max)}
        step={step}
      />
    </div>
  );
}

export function SelectField({
  id,
  name,
  label,
  value = '',
  required = false,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      <NativeSelect
        id={id}
        name={name}
        selectClassName="h-10 rounded-md border bg-card px-3"
        defaultValue={value}
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}
