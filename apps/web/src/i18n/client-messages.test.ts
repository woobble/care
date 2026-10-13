import { describe, expect, test } from 'bun:test';
import en from '../../messages/en.json';
import de from '../../messages/de.json';
import { getClientMessages } from './client-messages';

describe('client translation messages', () => {
  test('includes translations used by client components in both locales', () => {
    const english = getClientMessages(en);
    const german = getClientMessages(de);

    expect(english.Common.language).toBe(en.Common.language);
    expect(english.Common.formValidation).toEqual(en.Common.formValidation);
    expect(english.Common.entitySelector).toEqual(en.Common.entitySelector);
    expect(english.Navigation).toEqual({
      currentOrganization: en.Navigation.currentOrganization,
      appearance: en.Navigation.appearance,
      light: en.Navigation.light,
      dark: en.Navigation.dark,
      system: en.Navigation.system,
    });
    expect(english.Auth).toEqual({
      signInWithAuthentik: en.Auth.signInWithAuthentik,
      redirecting: en.Auth.redirecting,
      signInFailed: en.Auth.signInFailed,
    });
    expect(english.Caregiver.drafts).toEqual(en.Caregiver.drafts);
    expect(english.ServiceEvidence.care).toEqual(en.ServiceEvidence.care);
    expect(german.Common.language).toBe(de.Common.language);
    expect(german.Caregiver.drafts).toEqual(de.Caregiver.drafts);
    expect(german.ServiceEvidence.care).toEqual(de.ServiceEvidence.care);
  });

  test('keeps the client message payload below one tenth of the full catalog', () => {
    const encoder = new TextEncoder();
    const fullCatalogBytes = encoder.encode(JSON.stringify(en)).byteLength;
    const clientCatalogBytes = encoder.encode(JSON.stringify(getClientMessages(en))).byteLength;

    expect(clientCatalogBytes).toBeLessThan(fullCatalogBytes / 10);
  });
});
