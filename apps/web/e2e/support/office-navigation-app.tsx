import { NextIntlClientProvider } from 'next-intl';
import { usePathname } from 'next/navigation';
import { createRoot } from 'react-dom/client';

import de from '../../messages/de.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import { AdministrationNavigationLinks } from '../../src/app/(office)/administration/administration-nav-links';
import { BillingNavigationLinks } from '../../src/app/(office)/billing/billing-nav-links';
import { OfficeShell } from '../../src/components/office-shell';

export type NavigationFixtureProps = Omit<
  Parameters<typeof OfficeShell>[0],
  'children' | 'signOut'
> & {
  landingHtml?: string;
  administrationNavigation?: {
    groups: Parameters<typeof AdministrationNavigationLinks>[0]['groups'];
    label: string;
    className: string;
    html: string;
    beforeHtml?: string;
  };
  billingNavigation?: {
    links: Parameters<typeof BillingNavigationLinks>[0]['links'];
    label: string;
    className: string;
    html: string;
    beforeHtml?: string;
  };
};
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
    const { landingHtml, billingNavigation, administrationNavigation, ...shellProps } = props;
    root.render(
      <NextIntlClientProvider locale={props.locale} messages={props.locale === 'en' ? en : de}>
        <OfficeShell
          {...shellProps}
          signOut={
            <button type="button">{(props.locale === 'en' ? en : de).Navigation.signOut}</button>
          }
        >
          {administrationNavigation ? (
            <AdministrationNavigationPreview navigation={administrationNavigation} />
          ) : billingNavigation ? (
            <div className="grid gap-6">
              <h1>Billing navigation fixture</h1>
              {billingNavigation.beforeHtml ? (
                <div dangerouslySetInnerHTML={{ __html: billingNavigation.beforeHtml }} />
              ) : (
                <div>
                  <nav aria-label={billingNavigation.label} className={billingNavigation.className}>
                    <BillingNavigationLinks links={billingNavigation.links} />
                  </nav>
                </div>
              )}
              <p>Synthetic route content.</p>
              <div style={{ height: 1200 }} aria-hidden="true" />
              <h2 id="worklist">Synthetic worklist</h2>
            </div>
          ) : landingHtml ? (
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

function AdministrationNavigationPreview({
  navigation,
}: {
  navigation: NonNullable<NavigationFixtureProps['administrationNavigation']>;
}) {
  const pathname = usePathname();
  // Match the fixture's lifetime to the real Administration App Router segment.
  if (pathname !== '/administration' && !pathname.startsWith('/administration/'))
    return <h1>External route fixture</h1>;
  return (
    <div className="grid gap-6">
      <h1>Administration navigation fixture</h1>
      {navigation.beforeHtml ? (
        <div dangerouslySetInnerHTML={{ __html: navigation.beforeHtml }} />
      ) : (
        <div>
          <nav aria-label={navigation.label} className={navigation.className}>
            <AdministrationNavigationLinks groups={navigation.groups} />
          </nav>
        </div>
      )}
      <p>Synthetic route content.</p>
      {pathname === '/administration/users' ? (
        <>
          <div style={{ height: 1200 }} aria-hidden="true" />
          <h2 id="invitations-title">Synthetic invitations</h2>
        </>
      ) : null}
    </div>
  );
}
