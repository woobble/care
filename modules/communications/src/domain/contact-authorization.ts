export type ContactAuthorizationBasis =
  | 'legal_representative'
  | 'authorized_contact'
  | 'not_confirmed'
  | 'not_applicable';

export function contactAuthorizationFor(input: {
  roles: readonly string[];
  representationType: string | null;
  validFrom: string | null;
  validUntil: string | null;
  today: string;
}): ContactAuthorizationBasis {
  const representationIsCurrent =
    input.representationType !== null &&
    (!input.validFrom || input.validFrom <= input.today) &&
    (!input.validUntil || input.validUntil >= input.today);
  if (input.roles.includes('legal_representative') && representationIsCurrent) {
    return 'legal_representative';
  }
  if (input.roles.includes('authorized_contact')) return 'authorized_contact';
  return 'not_confirmed';
}
