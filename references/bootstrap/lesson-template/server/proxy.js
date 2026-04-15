// Shim: launch the canonical proxy from _lesson-core.
// Run from lesson root: `cd <lesson> && node server/proxy.js`.
// The canonical proxy uses process.cwd() for log/port files so they
// resolve to this lesson's server/ directory.
import "../../../../_lesson-core/server/proxy.js";
