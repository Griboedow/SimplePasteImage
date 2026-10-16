# Compatibility results

Tested on 2026-10-16 with PHP 8.3.35, SQLite and Chromium 154.0.8037.57 on Linux. Each wiki used the VisualEditor distributed with its release or matching development branch. These are observed results for the listed builds, not a guarantee for future master changes or every historical patch release.

| MediaWiki branch | Tested version | Browser scenarios | Saved images after reload |
| --- | --- | --- | --- |
| REL1_43 | 1.43.11 | 22 passed | 19 |
| REL1_44 | 1.44.6 | 22 passed | 19 |
| REL1_45 | 1.45.6 | 22 passed | 19 |
| REL1_46 | 1.46.2 | 22 passed | 19 |
| REL1_47 | 1.47.0-beta | 22 passed | 19 |
| master | 1.48.0-alpha | 22 passed | 19 |

Five additional Node.js unit tests passed for upload results, duplicate handling, rejected schemes and clipboard-file matching. Machine-readable run results are in [compatibility-results.json](compatibility-results.json).

## Development snapshots

| Branch | MediaWiki commit | VisualEditor extension commit |
| --- | --- | --- |
| REL1_47 | `8f8fc14977acaf6eac2693925ceda8a21ee06859` | `e7384005ac633b2be0083844396e7b04bec641df` |
| master | `0fd5e04a84b9a6c664e6feda690d5cd646627511` | `29772805b63061c8a430108df00ac60f3d0c1f97` |

Both development builds used their checked-out VisualEditor library submodule, `53d34384f0e57e90a6e9c0dc4ee408203f4ba68a`. Stable 1.43, 1.45 and 1.46 used official Docker images; 1.44.6 used the official release tarball on the same PHP runtime. Development trees included Composer dependencies and the matching Vector skin.

## Clipboard coverage

The suite drives the native browser clipboard and Ctrl+V, including a real Ctrl+C selection from a browser page containing paragraphs, a list, a table and images. Other cases write controlled HTML/binary clipboard fixtures before pasting:

- Mixed HTML and table cells with several images; repeated identical image reuse.
- Native PNG clipboard file (screenshot-style payload).
- HTTP(S) image imported by the wiki server.
- PNG, JPEG, GIF and WebP data URIs; base64 and percent encoding.
- Office-style HTML with embedded base64 data.
- Readable blob URL; file and cid references with a uniquely matching binary clipboard file.
- Foreign-wiki Parsoid HTML; local read-mode images; internal VisualEditor copy/paste.
- Missing file/cid bytes, revoked blob URL and invalid base64: visible errors, preserved text, subsequent plain-text paste still works.
- Save and reload: all 19 expected images load, and wikitext retains file references without unintended raw-image links.

Word, Excel, LibreOffice and Google Docs were **not** exercised as live source applications. Office-style HTML is a fixture, not proof of every native application's clipboard behavior. Firefox and Safari were not tested. RTF-only images, local paths without file bytes, inaccessible blob URLs and URLs requiring browser-only authentication cannot be imported by this implementation. File/cid matching deliberately requires a unique filename rather than guessing from clipboard order. Extensionless non-PNG HTTP endpoints can fail MediaWiki MIME validation.

## Reproduce

Follow the setup in the [README](../README.md), using a disposable wiki with uploads, VisualEditor and SimplePasteImage enabled. Run once per version:

```sh
npm ci
npm test
MW_URL=http://localhost:8080 \
MW_PASSWORD="$MW_PASSWORD" \
CHROMIUM_PATH=/usr/bin/chromium \
MW_REMOTE_IMAGE=https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png \
MW_ARTIFACT_DIR=tests/artifacts/1.43 \
node tests/paste.e2e.cjs
```

Set `MW_IMAGE`, `MW_CONTAINER` and `MW_PORT` for `tests/start-wiki.sh`. For development branches or release tarballs, set `MW_SOURCE` to a prepared disposable source tree with no LocalSettings.php, matching extensions/skin and installed Composer dependencies. The script uses SQLite; the source tree must be readable by the container web server. Configure the environment's HTTPS proxy and CA trust if required. Keep TLS verification enabled. Each successful browser run writes a JSON result and a screenshot to its artifact directory.
