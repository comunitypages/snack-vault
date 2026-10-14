export function creatorStateCookie(state) {
  return typeof state === 'string' && /^svcreator_[0-9a-f]{64}$/.test(state)
    ? `sv_oauth_${state.slice(10)}` : null;
}
