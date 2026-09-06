// What this bundle carries, and where its chat calls go. Both are decided by
// Vite at BUILD time, not at runtime, so a bundle that must not have a tutor
// does not merely hide one -- the JSX and the endpoint literals are dropped.
//
// TUTOR_ENABLED -- the tutor ships when the dev server is running, or when the
// build sets VITE_TUTOR to "1" or "true". Anything else, including unset, is
// off, so a plain `vite build` still ships no tutor: that is what the lessons
// repo's docs/publishing.md promises for Netlify and the tailnet publish, and
// those hosts have no proxy to answer a chat call. Note the question is NOT
// whether the build is a production one any more -- a lesson hosted behind a
// login is a production build that legitimately has a tutor.
//
// API -- every endpoint the chat client calls, resolved against THIS build's
// own base. Vite substitutes BASE_URL at build time and the minifier folds the
// template, so each entry lands in the bundle as a finished literal:
//
//   vite build                                -> "/chat"
//   vite dev                                  -> "/chat"        (base is "/")
//   vite build --base=/math101/derivatives/   -> "/math101/derivatives/chat"
//
// A hosted lesson lives at /<course>/<slug>/ and its backend answers under
// that same prefix, so a root-absolute "/chat" would reach the site root and
// some other lesson's backend, or nothing at all. Add an endpoint here rather
// than writing a path at the call site -- a literal path in a component is a
// call that will not carry the prefix.
//
// The base must END IN "/" and the entries below therefore carry no leading
// slash. Vite does not enforce that: given `--base=/c/s` it normalises its own
// asset URLs to /c/s/assets/... but leaves import.meta.env.BASE_URL as the "/c/s"
// it was handed, and every entry below would read "/c/schat". `build-all.sh`
// and references/phase-5-deploy.md both pass the slash; the guard at the foot
// of this file is for a build run by hand that does not.

export const TUTOR_ENABLED =
  import.meta.env.DEV ||
  import.meta.env.VITE_TUTOR === "1" ||
  import.meta.env.VITE_TUTOR === "true";

// Repeating `import.meta.env.BASE_URL` per entry is deliberate: Vite replaces
// each occurrence with the base literal and esbuild then folds the template
// into one string. Hoisting it to a shared const instead leaves a variable in
// the bundle and the endpoints are concatenated at runtime -- which works, but
// the built output no longer SHOWS the prefixed URL, and tests/hosted-build
// asserts on exactly that.
export const API = {
  chat: `${import.meta.env.BASE_URL}chat`,
  chatCancel: `${import.meta.env.BASE_URL}chat/cancel`,
  commit: `${import.meta.env.BASE_URL}commit`,
  sessions: `${import.meta.env.BASE_URL}sessions`,
  sessionInit: `${import.meta.env.BASE_URL}session/init`,
  sessionOpen: `${import.meta.env.BASE_URL}session/open`,
  sessionClose: `${import.meta.env.BASE_URL}session/close`,
  sessionTransfer: `${import.meta.env.BASE_URL}session/transfer`,
  threadOpen: `${import.meta.env.BASE_URL}thread/open`,
  threadFold: `${import.meta.env.BASE_URL}thread/fold`,
  upload: `${import.meta.env.BASE_URL}upload`,
};

// A base with no trailing slash produces a set of endpoints that 404 on every
// call, with nothing in the network tab to say why -- so name it, once, with
// the command that fixes it. Costs a string comparison at module load in a
// build that has a tutor, and nothing at all in one that does not.
if (TUTOR_ENABLED && !import.meta.env.BASE_URL.endsWith("/")) {
  console.error(
    `[lesson-core] the tutor's endpoints resolved to ${API.chat} and every one of ` +
    `them will 404: this bundle was built with --base=${JSON.stringify(import.meta.env.BASE_URL)}, ` +
    `which has no trailing slash. Rebuild with --base="${import.meta.env.BASE_URL}/".`
  );
}
