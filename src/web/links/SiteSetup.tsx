import { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, LogIn } from 'lucide-react';
import { callAction } from '../api';
import { Button } from '../components/Button';
import { accountStatus } from '../makerworld/makerworld';
import { useCurrentUser } from '../session';
import { navigate } from '../shell/routes';

/** A link to another site, opened in a new tab. */
function Site({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="jp-site-setup__link">
      {children}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

/** What to do once for MakerWorld downloads. */
export function MakerWorldSteps() {
  return (
    <ol className="jp-site-setup__steps">
      <li>
        You need a Bambu Lab account: it is the account you use on MakerWorld. No account yet? Sign up free at{' '}
        <Site href="https://makerworld.com/en">makerworld.com</Site> (Sign In, then Sign Up).
      </li>
      <li>
        In JusttPrint, open <strong>Settings → Integrations → MakerWorld</strong> and click <strong>Sign In…</strong>
      </li>
      <li>Enter the email and password of that account.</li>
      <li>If Bambu Lab emails you a code, enter it. That is all: JusttPrint keeps the sign-in for everyone and does not keep your password.</li>
    </ol>
  );
}

/** What to do once for a Google Cloud Translation API key (Settings → MakerWorld). */
export function GoogleTranslateSteps() {
  return (
    <ol className="jp-site-setup__steps" id="google-translate-steps">
      <li>
        <strong>Create a project.</strong> Go to <Site href="https://console.cloud.google.com">console.cloud.google.com</Site> and sign in. In the project
        picker at the top choose <strong>New Project</strong>, name it (for example <em>JusttPrint</em>) and click <strong>Create</strong>; make sure it is
        selected in the top bar.
      </li>
      <li>
        <strong>Turn on billing.</strong> Open <strong>Billing</strong> in the left menu and link a billing account (a card). Google asks for it for Translation
        even within the 500,000 free characters a month; new accounts often get trial credit too.
      </li>
      <li>
        <strong>Turn on the Translation API.</strong> In <strong>APIs &amp; Services → Library</strong>, search for <strong>Cloud Translation API</strong>, open
        it and click <strong>Enable</strong>.
      </li>
      <li>
        <strong>Create the key.</strong> In <strong>APIs &amp; Services → Credentials</strong> choose <strong>Create credentials → API key</strong> and copy it
        (it starts with <code>AIza</code>).
      </li>
      <li>
        <strong>Restrict the key</strong> (recommended). Click <strong>Edit API key</strong>: under <strong>API restrictions</strong> choose{' '}
        <strong>Restrict key</strong>, tick only <strong>Cloud Translation API</strong> and save, so a leaked key cannot be used for anything else. Under{' '}
        <strong>Application restrictions</strong> you can also allow only your server's public IP address, if it does not change.
      </li>
      <li>
        <strong>Safety nets on Google's side</strong> (optional). In <strong>Billing → Budgets &amp; alerts</strong> create a budget of, say, $1, and Google
        emails you if anything is ever charged. In <strong>APIs &amp; Services → Cloud Translation API → Quotas</strong> you can lower the characters per day to
        about 16,000 (500,000 ÷ 31): Google then refuses more by itself.
      </li>
      <li>
        <strong>Add it here.</strong> Paste the key below and click <strong>Check and Save Key</strong>, then <strong>Save</strong>. JusttPrint tests it with a
        few characters, puts Google first in the list of translators, and counts what it sends.
      </li>
    </ol>
  );
}

/** What to do once for Thingiverse downloads. */
export function ThingiverseSteps() {
  return (
    <ol className="jp-site-setup__steps">
      <li>
        Sign in to Thingiverse, or make a free account, at <Site href="https://www.thingiverse.com">thingiverse.com</Site>.
      </li>
      <li>
        Create an app at <Site href="https://www.thingiverse.com/apps/create">thingiverse.com/apps/create</Site> (more about it on{' '}
        <Site href="https://www.thingiverse.com/developers">thingiverse.com/developers</Site>). Any name works, for example <em>JusttPrint</em>; a{' '}
        <strong>Desktop app</strong> is enough.
      </li>
      <li>
        Open the app and copy its <strong>App Token</strong>.
      </li>
      <li>
        In JusttPrint, open <strong>Settings → Integrations → Thingiverse</strong>, paste the token and click <strong>Save Token</strong>.
      </li>
    </ol>
  );
}

/** Open one settings form (Settings → Integrations), scrolled to and shown for a moment. */
export function openSetting(id: 'makerworld' | 'thingiverse', before?: () => void) {
  before?.();
  navigate('settings', id);
}

/**
 * Add Links: when the pasted links include MakerWorld or Thingiverse and that site is not set up
 * yet, say that downloading needs a sign-in, what to do, and a button to the place in Settings.
 * Thingiverse's token is for admins to set: others are told to ask one.
 */
export function SiteSetupNotice({ sites, onLeave }: { sites: string[]; onLeave: () => void }) {
  const user = useCurrentUser();
  const isAdmin = user?.role === 'admin';
  const [makerWorldReady, setMakerWorldReady] = useState<boolean | null>(null);
  const [thingiverseReady, setThingiverseReady] = useState<boolean | null>(null);
  const wantsMakerWorld = sites.includes('makerworld');
  const wantsThingiverse = sites.includes('thingiverse');

  useEffect(() => {
    if (wantsMakerWorld)
      accountStatus().then(
        (s) => setMakerWorldReady(s.signedIn),
        () => setMakerWorldReady(null)
      );
    if (wantsThingiverse)
      callAction<{ hasToken: boolean }>('thingiverse-token-status').then(
        (s) => setThingiverseReady(s.hasToken),
        () => setThingiverseReady(null)
      );
  }, [wantsMakerWorld, wantsThingiverse]);

  const needMakerWorld = wantsMakerWorld && makerWorldReady === false;
  const needThingiverse = wantsThingiverse && thingiverseReady === false;
  if (!needMakerWorld && !needThingiverse) return null;
  const which = needMakerWorld && needThingiverse ? 'MakerWorld and Thingiverse' : needMakerWorld ? 'MakerWorld' : 'Thingiverse';

  return (
    <div className="jp-site-setup" role="note" id="jp-site-setup">
      <p className="jp-site-setup__title">
        To download models from {which}, you need to sign in{needMakerWorld && needThingiverse ? ' to each' : ''} first.
      </p>
      <p className="jp-meta">
        Until then, those links are added as online models (name, designer, license, picture and link), and you can download the files later by adding the same
        links again.
      </p>
      {needMakerWorld && (
        <section className="jp-site-setup__site" aria-labelledby="jp-site-setup-makerworld">
          <h4 id="jp-site-setup-makerworld">MakerWorld</h4>
          <MakerWorldSteps />
          {isAdmin && (
            <Button size="sm" icon={LogIn} id="jp-site-setup-open-makerworld" onClick={() => openSetting('makerworld', onLeave)}>
              Open MakerWorld Settings
            </Button>
          )}
          <span className="jp-meta">
            {isAdmin ? ' or ' : ''}
            {isAdmin ? 'sign in' : 'Sign in'} when JusttPrint asks, after you click Add.
          </span>
        </section>
      )}
      {needThingiverse && (
        <section className="jp-site-setup__site" aria-labelledby="jp-site-setup-thingiverse">
          <h4 id="jp-site-setup-thingiverse">Thingiverse</h4>
          <ThingiverseSteps />
          {isAdmin ? (
            <Button size="sm" icon={KeyRound} id="jp-site-setup-open-thingiverse" onClick={() => openSetting('thingiverse', onLeave)}>
              Open Thingiverse Settings
            </Button>
          ) : (
            <p className="jp-meta">Only an admin can add the token: ask yours to do step 4 (or all of them).</p>
          )}
        </section>
      )}
    </div>
  );
}
