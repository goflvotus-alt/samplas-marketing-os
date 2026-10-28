// Called by the existing Claude scheduler only AFTER calendar + image-order verification.
// No browser, scheduling, publishing, or Dropbox operations belong here.
import { newPostRecord } from './instagram-product-tag-runner.mjs';

export async function registerScheduledPost({ receipt, baseUrl, authorization, autoTag, acceptUnverifiedVariantApproval = false, fetchImpl = fetch }) {
  if (receipt?.account !== 'samplaskr' || receipt?.state !== 'SCHEDULED' ||
      !['caption', 'slot', 'slides', 'order', 'dimensions'].every(k => receipt?.verified?.[k] === true)) throw new Error('schedule_success_not_verified');
  if (typeof receipt.slotIso !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(receipt.slotIso)) throw new Error('schedule_timezone_required');
  const input = { folderName: receipt.folderName, slotIso: receipt.slotIso, caption: receipt.caption,
    captionSha256: receipt.captionSha256, slideCount: receipt.slideCount, autoTag, acceptUnverifiedVariantApproval };
  const made = newPostRecord(input);
  if (!made.ok) throw new Error(`invalid_registration:${made.problems.join(',')}`);
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || !authorization) throw new Error('registration_https_auth_required');
  let response;
  try {
    response = await fetchImpl(new URL('/api/instagram-product-tags/posts', base).href, { method: 'POST', redirect: 'error',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
  } catch { return { ok: false, error: 'registration_outcome_unknown', action: 'retry_same_receipt_only_never_reschedule' }; }
  const out = await response.json().catch(() => null);
  return response.ok && out?.ok === true ? out : { ok: false, error: out?.error || 'registration_failed', problems: out?.problems };
}
