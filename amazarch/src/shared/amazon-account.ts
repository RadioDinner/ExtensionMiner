// Read which Amazon account is signed in, from the nav greeting. Amazon renders
// "Hello, <Name>" in #nav-link-accountList-nav-line-1 on every order page; a
// signed-out page shows "Hello, sign in" (or "Hello, Identify yourself"). We use
// the name as a stable-enough per-account key for multi-account support (D11) —
// Amazon keeps only ONE active session at a time (SPEC.md §R1), so the extension
// tags data by the active account and asks the user to switch accounts to sync
// the other one. Pure + tested.

// Greeting prefixes across Amazon's locales ("Hello", "Hola", …). We only need
// to strip the leading greeting word; whatever follows is the account name.
const GREETING_RE = /^(?:hello|hi|hey|hola|bonjour|hallo|ciao|olá|ola)[,!\s]+/i;

// Signed-out / placeholder names that must NOT be treated as an account.
const NOT_A_NAME_RE =
  /^(sign\s?in|identify yourself|account|your account|accounts?\s*&\s*lists?)$/i;

/** Parse the account name from a nav greeting like "Hello, Derrick".
 *  Returns null for signed-out/placeholder greetings or empty input. */
export function parseAmazonAccountLabel(greeting: string | null | undefined): string | null {
  if (!greeting) return null;
  const t = greeting.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const name = t.replace(GREETING_RE, "").trim();
  if (!name) return null; // greeting word only, no name
  if (NOT_A_NAME_RE.test(name)) return null;
  return name.slice(0, 40);
}
