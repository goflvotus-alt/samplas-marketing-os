const normalizeHandle = value => String(value || "").trim().replace(/^@+/, "").toLowerCase();

export function taggedPostType(media = {}) {
  const product = String(media.media_product_type || "").toUpperCase();
  const type = String(media.media_type || "").toUpperCase();
  const permalink = String(media.permalink || "");
  return product === "REELS" || type === "REELS" || /\/reel\//i.test(permalink) ? "reel" : "feed";
}

export function seoulDateFromTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function buildTaggedUploadPlans(projectDetails = [], taggedMedia = [], checkedAt = new Date().toISOString()) {
  const candidates = [];
  for (const detail of projectDetails) {
    const project = detail?.project;
    if (!project?.name || !Number.isInteger(project.version)) continue;
    for (const seeding of detail.seedings || []) {
      const handle = normalizeHandle(seeding.instagramId);
      if (
        !handle ||
        seeding.shippingStatus !== "출고 완료" ||
        !seeding.shippedAt ||
        seeding.uploadStatusMode === "manual" ||
        seeding.uploadStatus === "completed" ||
        seeding.uploadStatus === "unavailable" ||
        seeding.postUrl
      ) continue;
      candidates.push({
        projectName: project.name,
        version: project.version,
        seedingId: seeding.id,
        instagramId: handle,
        shippedAt: seeding.shippedAt
      });
    }
  }

  const assigned = new Set();
  const plans = new Map();
  const mediaItems = [...taggedMedia]
    .filter(item => normalizeHandle(item?.username) && item?.permalink && item?.timestamp)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  for (const media of mediaItems) {
    const handle = normalizeHandle(media.username);
    const uploadedAt = seoulDateFromTimestamp(media.timestamp);
    if (!uploadedAt) continue;

    const eligible = candidates
      .filter(candidate =>
        candidate.instagramId === handle &&
        !assigned.has(candidate.seedingId) &&
        candidate.shippedAt <= uploadedAt
      )
      .sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));

    const chosen = eligible[0];
    if (!chosen) continue;

    assigned.add(chosen.seedingId);
    const existing = plans.get(chosen.projectName) || {
      name: chosen.projectName,
      version: chosen.version,
      operations: []
    };

    existing.operations.push({
      type: "update_seeding",
      instagramId: chosen.instagramId,
      patch: {
        uploadStatus: "completed",
        uploadedAt,
        postUrl: media.permalink,
        postType: taggedPostType(media),
        uploadStatusMode: "auto",
        uploadVerifiedBy: "api",
        uploadCheckedAt: checkedAt,
        uploadedRecordedAt: checkedAt,
        uploadCheckSuggestion: {
          source: "instagram_graph_tagged_media",
          mediaId: String(media.id || ""),
          username: handle,
          timestamp: media.timestamp,
          confidence: 1
        }
      }
    });
    plans.set(chosen.projectName, existing);
  }

  return [...plans.values()];
}
