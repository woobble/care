import { NextIntlClientProvider } from 'next-intl';
import { createRoot } from 'react-dom/client';

import de from '../../messages/de.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import { OfficeShell } from '../../src/components/office-shell';

export type NavigationFixtureProps = Omit<
  Parameters<typeof OfficeShell>[0],
  'children' | 'signOut'
> & { landingHtml?: string };
declare global {
  interface Window {
    navigationHarness: {
      render: (props: NavigationFixtureProps) => void;
      navigate: (path: string) => void;
    };
  }
}
const root = createRoot(document.getElementById('root')!);
window.navigationHarness = {
  render(props) {
    const { landingHtml, ...shellProps } = props;
    root.render(
      <NextIntlClientProvider locale={props.locale} messages={props.locale === 'en' ? en : de}>
        <OfficeShell
          {...shellProps}
          signOut={
            <button type="button">{(props.locale === 'en' ? en : de).Navigation.signOut}</button>
          }
        >
          {landingHtml ? (
            <div dangerouslySetInnerHTML={{ __html: landingHtml }} />
          ) : (
            <>
              <h1>Navigation fixture</h1>
              <p>Synthetic route content.</p>
            </>
          )}
        </OfficeShell>
      </NextIntlClientProvider>,
    );
  },
  navigate(path) {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
};
