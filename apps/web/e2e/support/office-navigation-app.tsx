import { NextIntlClientProvider } from 'next-intl';
import { usePathname } from 'next/navigation';
import { createRoot } from 'react-dom/client';
import { createElement, type ReactNode } from 'react';

import de from '../../messages/de.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import { AdministrationNavigationLinks } from '../../src/app/(office)/administration/administration-nav-links';
import { BillingNavigationLinks } from '../../src/app/(office)/billing/billing-nav-links';
import { AsyncEntityCombobox } from '../../src/components/async-entity-combobox';
import { RHFActionForm } from '../../src/components/rhf-action-form';
import { TextField } from '../../src/features/clients/components/client-form-fields';
import { OfficeShell } from '../../src/components/office-shell';

export type NavigationFixtureProps = Omit<
  Parameters<typeof OfficeShell>[0],
  'children' | 'signOut'
> & {
  landingHtml?: string;
  newClient?: {
    redirect: string | null;
    headerHtml?: string;
    actionsHtml?: string;
    errorHtml?: string;
    rootClassName?: string;
    formClassName?: string;
    errorMessage?: string;
    warnOnUnsavedChanges?: boolean;
    firstNameProps?: Parameters<typeof TextField>[0];
  };
  newAdmission?: {
    deniedHtml: string | null;
    headerHtml?: string;
    actionsHtml?: string;
    errorHtml?: string;
    rootClassName?: string;
    formClassName?: string;
    warnOnUnsavedChanges?: boolean;
    firstNameHtml?: string;
    firstNameTree?: NativeFieldTree;
  };
  newCommunication?: {
    deniedHtml?: string | null;
    redirects: string[];
    headerHtml?: string;
    actionsHtml?: string;
    noticeHtml?: string;
    rootClassName?: string;
    formMethod?: string;
    formClassName?: string;
    hiddenInputs?: Array<{ type: 'hidden'; name: string; value: string }>;
    selectorProps?: Parameters<typeof AsyncEntityCombobox>[0];
  };
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
      newClientSubmissions: number;
      newClientRefreshes: number;
      communicationSubmissions: number;
      communicationPayloads: Array<Record<string, string>>;
      navigate: (path: string) => void;
    };
  }
}
const root = createRoot(document.getElementById('root')!);
window.navigationHarness = {
  newClientSubmissions: 0,
  newClientRefreshes: 0,
  communicationSubmissions: 0,
  communicationPayloads: [],
  render(props) {
    const {
      landingHtml,
      billingNavigation,
      administrationNavigation,
      newClient,
      newAdmission,
      newCommunication,
      ...shellProps
    } = props;
    root.render(
      <NextIntlClientProvider locale={props.locale} messages={props.locale === 'en' ? en : de}>
        <OfficeShell
          {...shellProps}
          signOut={
            <button type="button">{(props.locale === 'en' ? en : de).Navigation.signOut}</button>
          }
        >
          {newCommunication ? (
            <NewCommunicationPreview presentation={newCommunication} />
          ) : newAdmission ? (
            <NewAdmissionPreview presentation={newAdmission} />
          ) : newClient ? (
            <NewClientPreview presentation={newClient} />
          ) : administrationNavigation ? (
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

function NewClientPreview({
  presentation,
}: {
  presentation: NonNullable<NavigationFixtureProps['newClient']>;
}) {
  const pathname = usePathname();
  if (presentation.redirect || !presentation.headerHtml || !presentation.firstNameProps)
    return null;
  if (pathname !== '/clients/new') return <h1>Return destination fixture</h1>;
  return (
    <div
      className={presentation.rootClassName}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (
          !target ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        // Document capture runs the real RHF guard first; this is only the Next routing boundary.
        event.preventDefault();
        window.navigationHarness.navigate(target.getAttribute('href')!);
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: presentation.headerHtml }} />
      {presentation.errorHtml ? (
        <div dangerouslySetInnerHTML={{ __html: presentation.errorHtml }} />
      ) : null}
      <RHFActionForm
        action={async () => {
          window.navigationHarness.newClientSubmissions++;
        }}
        warnOnUnsavedChanges={presentation.warnOnUnsavedChanges ?? false}
        {...(presentation.errorMessage !== undefined
          ? { errorMessage: presentation.errorMessage }
          : {})}
        className={presentation.formClassName ?? ''}
      >
        <TextField {...presentation.firstNameProps} />
        <div dangerouslySetInnerHTML={{ __html: presentation.actionsHtml! }} />
      </RHFActionForm>
    </div>
  );
}

function NewAdmissionPreview({
  presentation,
}: {
  presentation: NonNullable<NavigationFixtureProps['newAdmission']>;
}) {
  const pathname = usePathname();
  if (presentation.deniedHtml || !presentation.headerHtml || !presentation.firstNameTree)
    return null;
  if (pathname !== '/admissions/new') return <h1>Return destination fixture</h1>;
  return (
    <div
      className={presentation.rootClassName}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (
          !target ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        // Document capture runs the real RHF guard first; this is only the Next routing boundary.
        event.preventDefault();
        window.navigationHarness.navigate(target.getAttribute('href')!);
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: presentation.headerHtml }} />
      {presentation.errorHtml ? (
        <div dangerouslySetInnerHTML={{ __html: presentation.errorHtml }} />
      ) : null}
      <RHFActionForm
        action={async () => {
          window.navigationHarness.newClientSubmissions++;
        }}
        warnOnUnsavedChanges={presentation.warnOnUnsavedChanges ?? false}
        className={presentation.formClassName ?? ''}
      >
        {renderNativeField(presentation.firstNameTree)}
        <div dangerouslySetInnerHTML={{ __html: presentation.actionsHtml! }} />
      </RHFActionForm>
    </div>
  );
}

// Recreate only the real Field helper's returned native tree, so React owns the
// input and its change events reach the real RHF form. No form/permission logic.
type NativeFieldTree =
  | string
  | {
      type: 'label' | 'input';
      props: Record<string, unknown> & { children?: NativeFieldTree | NativeFieldTree[] };
    };
function renderNativeField(tree: NativeFieldTree): ReactNode {
  if (typeof tree === 'string') return tree;
  const { children, ...props } = tree.props;
  return createElement(
    tree.type,
    props,
    ...(children === undefined
      ? []
      : (Array.isArray(children) ? children : [children]).map(renderNativeField)),
  );
}

function NewCommunicationPreview({
  presentation,
}: {
  presentation: NonNullable<NavigationFixtureProps['newCommunication']>;
}) {
  const pathname = usePathname();
  if (
    presentation.deniedHtml ||
    presentation.redirects.length ||
    !presentation.headerHtml ||
    !presentation.selectorProps
  )
    return null;
  if (pathname !== '/communications/new') return <h1>Return destination fixture</h1>;
  return (
    <div
      className={presentation.rootClassName}
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (
          !target ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        window.navigationHarness.navigate(target.getAttribute('href')!);
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: presentation.headerHtml }} />
      <form
        method={presentation.formMethod}
        className={presentation.formClassName}
        onSubmit={(event) => {
          // Observe native FormData; this bridge models the ensuing GET navigation only.
          event.preventDefault();
          const values = Object.fromEntries(
            Array.from(new FormData(event.currentTarget), ([key, value]) => [key, String(value)]),
          );
          window.navigationHarness.communicationSubmissions++;
          window.navigationHarness.communicationPayloads.push(values);
          window.navigationHarness.navigate(`/communications/new?${new URLSearchParams(values)}`);
        }}
      >
        {presentation.hiddenInputs?.map((props) => (
          <input key={props.name} {...props} />
        ))}
        <AsyncEntityCombobox {...presentation.selectorProps} />
        {presentation.noticeHtml ? (
          <div dangerouslySetInnerHTML={{ __html: presentation.noticeHtml }} />
        ) : null}
        <div dangerouslySetInnerHTML={{ __html: presentation.actionsHtml! }} />
      </form>
    </div>
  );
}
