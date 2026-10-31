#!/usr/bin/env sh
# The release notes of a LaraPaper release, as the "### LaraPaper <version>" section of a
# trmnl-larapaper/CHANGELOG.md entry (Home Assistant shows it in the update dialog, and
# larapaper-release.yml makes it the GitHub release's notes). An entry is the LaraPaper
# section, on the add-on version that first bundles that release (the same version),
# then "### Home Assistant add-on" with the add-on's own changes.
#
#   sh scripts/larapaper-release-notes.sh 0.44.0                  from GitHub (GH_TOKEN
#                                                                 is used when set)
#   sh scripts/larapaper-release-notes.sh 0.44.0 --body-file f    from a saved release body
#
# The notes are GitHub's: their headings move two levels down, under the section, and
# bare pull request, compare and @user links become Markdown links, which Home
# Assistant's dialog doesn't make by itself.
set -eu
version=${1:?usage: larapaper-release-notes.sh <version> [--body-file <file>]}
repo=https://github.com/usetrmnl/larapaper

if [ "${2:-}" = --body-file ]; then
    body=$(cat "${3:?--body-file needs a file}")
else
    body=$(curl -fsSL ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} \
        "https://api.github.com/repos/usetrmnl/larapaper/releases/tags/$version" | jq -r '.body // ""')
fi
if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
    echo "LaraPaper $version has no release notes on GitHub" >&2
    exit 1
fi

printf '### LaraPaper %s\n\n' "$version"
printf 'From the [LaraPaper %s release](%s/releases/tag/%s):\n\n' "$version" "$repo" "$version"
printf '%s\n' "$body" | tr -d '\r' | awk '
    /^[ \t]*(```|~~~)/ { fence = !fence }
    !fence && /^#{1,4} / { $0 = "##" $0 }
    { print }
' | sed -E \
    -e "s#(^|[[:space:]])($repo/pull/([0-9]+))#\\1[\\#\\3](\\2)#g" \
    -e "s#(^|[[:space:]])($repo/compare/([^[:space:])]+))#\\1[\\3](\\2)#g" \
    -e 's#(^|[[:space:]])@([A-Za-z0-9][A-Za-z0-9-]*)\[bot\]#\1[@\2](https://github.com/apps/\2)#g' \
    -e 's#(^|[[:space:]])@([A-Za-z0-9][A-Za-z0-9-]*)#\1[@\2](https://github.com/\2)#g' \
    | sed -e 's/[[:space:]]*$//' | cat -s | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
