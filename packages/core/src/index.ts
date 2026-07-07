// ponytail: stub export until real code lands (P1-T09 wants one symbol + one test per package)
export const PACKAGE_NAME = '@graphloom/core';

// ponytail: exists only so tools/check-treeshake.mjs can prove unused exports
// get dropped from consumer bundles; delete when real exports outnumber it.
export const TREESHAKE_CANARY = 'CORE_TREESHAKE_CANARY';
