#!/usr/bin/env bash
set -euo pipefail

if (( $# < 2 )); then
  echo 'Usage: check-container-image-findings.sh IMAGE REPORT [REPORT ...]' >&2
  exit 2
fi

image_name="$1"
shift
reports=("$@")
exception_file=.github/security/container-image-exceptions.json

for report in "${reports[@]}"; do
  if [[ ! -s "$report" ]]; then
    echo "Missing or empty Trivy report: $report" >&2
    exit 2
  fi
done

jq -e '
  .schemaVersion == 1 and
  (.approval | type == "object") and
  (.approval.approver | type == "string" and length > 0) and
  (.approval.approvedOn | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) and
  (.approval.evidenceWorkflowRun | type == "number" and . > 0) and
  (.approval.expiresOn == null or (.approval.expiresOn | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))) and
  (.exceptions | type == "object" and (keys | all(. == "authentik" or . == "grafana"))) and
  all(.exceptions[]; type == "array" and length > 0 and length == (unique | length) and all(.[]; test("^CVE-[0-9]{4}-[0-9]+$")))
' "$exception_file" >/dev/null

approved_on="$(jq -r '.approval.approvedOn' "$exception_file")"
expires_on="$(jq -r '.approval.expiresOn // empty' "$exception_file")"
today="$(date -u +%F)"
if [[ "$(date -u -d "$approved_on" +%F)" != "$approved_on" || "$today" < "$approved_on" ]]; then
  echo 'The image exception approval date is invalid or in the future.' >&2
  exit 2
fi
if [[ -n "$expires_on" ]]; then
  if [[ "$(date -u -d "$expires_on" +%F)" != "$expires_on" || "$today" > "$expires_on" ]]; then
    echo 'The image exception has expired or has an invalid expiry date.' >&2
    exit 2
  fi
fi

allowed_ids="$(jq -c --arg image "$image_name" '.exceptions[$image] // []' "$exception_file")"
findings="$(jq -s '
  [ .[] | .Results[]? | .Vulnerabilities[]? |
    select(.Severity == "CRITICAL" or .Severity == "HIGH") |
    {id: .VulnerabilityID, severity: .Severity}
  ]
  | group_by(.id)
  | map({id: .[0].id, severity: (if any(.[]; .severity == "CRITICAL") then "CRITICAL" else "HIGH" end)})
  | sort_by(.id)
' "${reports[@]}")"
blocked_ids="$(jq -cn --argjson findings "$findings" --argjson allowed "$allowed_ids" \
  '$findings | map(select(. as $finding | ($allowed | index($finding.id)) == null) | .id) | unique')"
accepted_ids="$(jq -cn --argjson findings "$findings" --argjson allowed "$allowed_ids" \
  '[$findings[].id as $id | select($allowed | index($id)) | $id] | unique')"
critical_ids="$(jq -c '[.[] | select(.severity == "CRITICAL") | .id]' <<< "$findings")"
high_ids="$(jq -c '[.[] | select(.severity == "HIGH") | .id]' <<< "$findings")"
critical_count="$(jq 'length' <<< "$critical_ids")"
high_count="$(jq 'length' <<< "$high_ids")"
blocked_count="$(jq 'length' <<< "$blocked_ids")"
accepted_count="$(jq 'length' <<< "$accepted_ids")"
if (( accepted_count > 0 )); then
  approval="$(jq -c '.approval' "$exception_file")"
else
  approval=null
fi

result="$(jq -cn \
  --argjson critical "$critical_count" \
  --argjson high "$high_count" \
  --argjson criticalIds "$critical_ids" \
  --argjson highIds "$high_ids" \
  --argjson acceptedIds "$accepted_ids" \
  --argjson blockedIds "$blocked_ids" \
  --argjson approval "$approval" \
  '{critical:$critical,high:$high,criticalIds:$criticalIds,highIds:$highIds,acceptedIds:$acceptedIds,blockedIds:$blockedIds,approval:$approval}')"

{
  echo "## $image_name vulnerability disposition"
  echo
  echo "- Trivy reports: ${reports[*]}"
  echo "- Critical vulnerability IDs: $critical_count"
  echo "- High vulnerability IDs: $high_count"
  echo "- Approved exception IDs present: $(jq -r 'if length == 0 then "none" else join(", ") end' <<< "$accepted_ids")"
  echo "- Unexcepted Critical/High IDs: $(jq -r 'if length == 0 then "none" else join(", ") end' <<< "$blocked_ids")"
  if (( accepted_count > 0 )); then
    echo "- Exception approval: $(jq -r '.approval.approver' "$exception_file") on $approved_on"
    if [[ -n "$expires_on" ]]; then
      echo "- Exception expiry: $expires_on"
    else
      echo '- Exception expiry: not specified by approver'
    fi
  fi
} >> "$GITHUB_STEP_SUMMARY"

printf '%s\n' "$result"
if (( blocked_count > 0 )); then
  echo "Unapproved critical/high findings remain in $image_name; publication is blocked." >&2
  exit 1
fi
