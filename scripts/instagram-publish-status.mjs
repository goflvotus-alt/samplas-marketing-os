// Read-only publish check for the Mac archive runner (READY -> UPLOADED). It answers with the Render Graph token,
// so no Meta token has to live on the Mac. It never writes the record and never calls a Graph write.
// The check is the tag runner's own findPublishedMedia (account @samplaskr, exactly one recent post with the
// registered caption hash, live at or after the slot, slide count equal to the record). captionSha256 and
// slideCount in the answer are the registered values that the Graph post matched.
import { findPublishedMedia } from "./instagram-product-tag-runner.mjs";
import { SAMPLAS_META } from "./instagram-product-tags.mjs";

export async function publishStatus({ record, graph, now = Date.now(), expected = SAMPLAS_META }) {
  const found = await findPublishedMedia(graph, record, { now, expected });
  const published = found.state === "PUBLISHED";
  return {
    account: expected.username,
    folderName: record.folderName,
    state: found.state,
    reason: found.reason ?? null,
    slotIso: record.slotIso,
    captionSha256: record.captionSha256,
    slideCount: record.slideCount,
    mediaId: published ? found.mediaId : null,
    permalink: published ? found.permalink : null,
    timestamp: published ? found.timestamp : null,
    checkedAt: new Date(now).toISOString()
  };
}
