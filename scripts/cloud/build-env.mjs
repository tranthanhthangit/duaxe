/** Build-process diagnostics: fixed names and booleans only, never values/keys. */
const names = [
  'NODE_VERSION', 'VITE_AUTH_DRIVER', 'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_PUBLIC_APP_URL',
  'VITE_SELF_SIGNUP_ENABLED', 'VITE_TURNSTILE_SITE_KEY', 'VITE_SERVER_URL',
];
const variables = Object.fromEntries(names.map(name => {
  const value = process.env[name];
  return [name, {
    state: value === undefined ? 'missing' : value === '' ? 'empty' : 'present',
    surroundingWhitespace: value !== undefined && value !== value.trim(),
  }];
}));
console.log(JSON.stringify({
  diagnostic: 'pages-build-env-v1',
  node: process.version,
  cloudflarePages: process.env.CF_PAGES === '1',
  branchMetadataPresent: !!process.env.CF_PAGES_BRANCH,
  commitMetadataPresent: !!process.env.CF_PAGES_COMMIT_SHA,
  authDriverExactlySupabase: process.env.VITE_AUTH_DRIVER === 'supabase',
  selfSignupExactlyTrue: process.env.VITE_SELF_SIGNUP_ENABLED === 'true',
  configuredNodeVersionIs24: process.env.NODE_VERSION === '24',
  variables,
  note: 'Diagnostic only; does not load .env or Wrangler bindings, change variables, or bypass validation.',
}, null, 2));
