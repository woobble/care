import { Button, Input, Label } from '@care/ui';
import { createClientAction } from '../actions';

export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Klienten</p>
        <h1 className="text-3xl font-semibold">Klient anlegen</h1>
      </div>
      {params.error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-red-900">
          Eingaben konnten nicht gespeichert werden.
        </p>
      ) : null}
      <form
        action={createClientAction}
        className="grid gap-5 rounded-lg border bg-white p-5 shadow-sm"
      >
        <div className="grid gap-2">
          <Label htmlFor="firstName">Vorname</Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={120}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lastName">Nachname</Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={120}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="preferredName">Bevorzugter Name</Label>
          <Input id="preferredName" name="preferredName" autoComplete="nickname" maxLength={120} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dateOfBirth">Geburtsdatum</Label>
          <Input id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">E-Mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" maxLength={320} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Telefon</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Klient anlegen</Button>
          <Button asChild variant="secondary">
            <a href="/clients">Abbrechen</a>
          </Button>
        </div>
      </form>
    </div>
  );
}
