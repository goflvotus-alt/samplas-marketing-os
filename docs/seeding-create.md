# SEEDING project creation — local implementation, deployment pending

POST /api/ai-audit/seeding/projects uses the existing internal-token auth guard.
Required: name, brand, productName, publicFormUrl, responseSheetUrl,
responseSheetName, startDate. Optional: editFormUrl, endDate, targetCount
(positive integer, at most 100000), responseSheetGid (non-negative safe integer).
The spreadsheet ID is derived from the Google Sheet URL; responseSheetGid is
only tab metadata, never a replacement for the spreadsheet ID or tab title.
Existing response sync continues to use spreadsheet ID + exact tab title.
Creation registers links; it does not create or modify a Google Form or Sheet.
Google access and exact tab existence must be verified through the existing
read-only sync separately after deployment approval.

201 returns existing detail shape, version 1 and ETag. GET by exact normalized
name verifies the creation. No recipients, seedings, fixture data or defaults
from another project are copied. A clone of the existing document is written
using its Dropbox rev (update mode, never overwrite/add mode).
409 duplicate_project_name refuses normalized case-insensitive duplicates.
409 version_conflict refuses concurrent writes. No automatic retries occur.
A timeout/502 may mean the write committed: GET by name before a user retries.
Missing/unreadable canonical storage is not initialized by this endpoint.

Frontend + NEW PROJECT uses the localhost POST proxy, disables concurrent
submission, and installs the project only after successful GET verification.
Failures retain the last canonical cache and stop further writes until reload.
The new targetCount appears in the selector and project detail header.

Optional record fields fulfillmentMethod=pickup and pickedUpAt=YYYY-MM-DD
represent direct receipt separately from parcel shipment fields. Parcel fields
cannot be supplied for pickup. Pickup date drives the existing +7 day upload
deadline; it does not invent a tracking number or parcel deliveredAt date.

The Render MCP adds createSeedingProject; existing list/get/update contracts
remain compatible. The deployed Private Site statically lists three tools and
has deliberately NOT been changed. Its new-tool schema update and deployment
require a separate approval. Neither Render nor localhost services were
restarted/deployed by this implementation. No real project was created.
