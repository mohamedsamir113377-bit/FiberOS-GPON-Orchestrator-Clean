#!/usr/bin/env bash
# Run by the REPO OWNER with a NEW token (after rotating the exposed ones):
#   GH_TOKEN=<new> OWNER=codespine78-web REPO=FiberNexus-1 CHECK_NAME="<CI job name>" ./scripts/protect-main.sh
#
# NOTE (verified 2026-10-13): GitHub returns HTTP 403 for this endpoint while the repo is
# private on a free plan. Make the repo public or move to a paid plan first.
set -euo pipefail
: "${GH_TOKEN:?}"; : "${OWNER:?}"; : "${REPO:?}"; : "${CHECK_NAME:?}"
curl -fsS -X PUT "https://api.github.com/repos/$OWNER/$REPO/branches/main/protection" \
  -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  -d "{
    \"required_status_checks\": {\"strict\": true, \"contexts\": [\"$CHECK_NAME\"]},
    \"enforce_admins\": true,
    \"required_pull_request_reviews\": {\"required_approving_review_count\": 0, \"dismiss_stale_reviews\": true},
    \"restrictions\": null,
    \"required_linear_history\": true,
    \"allow_force_pushes\": false,
    \"allow_deletions\": false,
    \"required_conversation_resolution\": true
  }" >/dev/null
curl -fsS "https://api.github.com/repos/$OWNER/$REPO/branches/main" -H "Authorization: Bearer $GH_TOKEN" | grep -o '"protected":[a-z]*'
