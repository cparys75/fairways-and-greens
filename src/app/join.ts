/** A league invite code, kept in this tab while someone signs up or signs in from the invite link. */
const JOIN_KEY = 'golf-league.join';

/** The invite code from a league's link, kept while someone signs up or signs in. */
export function savedJoinCode(): string | null {
  try {
    return sessionStorage.getItem(JOIN_KEY);
  } catch {
    return null;
  }
}

export function saveJoinCode(code: string | null) {
  try {
    if (code) sessionStorage.setItem(JOIN_KEY, code);
    else sessionStorage.removeItem(JOIN_KEY);
  } catch {
    /* private mode */
  }
}
