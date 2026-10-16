# SimplePasteImage

Automatically upload images pasted into **MediaWiki VisualEditor**, including screenshots from the clipboard and images embedded in copied HTML. Text, lists and tables surrounding the images are preserved.

[MediaWiki extension page](https://www.mediawiki.org/wiki/Extension:SimplePasteImage)

## Installation

1. Install and enable VisualEditor, and verify that it can edit and save a page.
2. Place this repository in `extensions/SimplePasteImage`.
3. Add to `LocalSettings.php`:

```php
$wgEnableUploads = true;
wfLoadExtension( 'VisualEditor' ); // Omit if already loaded.
wfLoadExtension( 'SimplePasteImage' );
```

For images referenced by an HTTP(S) URL in pasted HTML, also enable server-side copy uploads:

```php
$wgAllowCopyUploads = true;
// Grant only to groups that should be able to import external images:
$wgGroupPermissions['user']['upload_by_url'] = true;
```

The user still needs normal upload permissions, and the wiki must allow the file type. For example, WebP requires `webp` in `$wgFileExtensions` if not already allowed. Screenshots and embedded data images do not require `upload_by_url`.

## Usage

Open a page in VisualEditor and paste normally:

- A screenshot / PNG clipboard image uploads and inserts directly.
- HTML containing images uploads them while retaining surrounding text, lists and tables.
- PNG, JPEG, GIF and WebP are supported by the automatic uploader.
- Repeated identical images reuse a live existing file. Other upload warnings are reported instead of bypassed automatically.
- Existing local MediaWiki images retain their file identity; images copied from another wiki are imported.
- Readable `blob:` URLs are imported. `file:` and `cid:` references are matched only to a uniquely named image file actually present in the clipboard.
- Base64 and percent-encoded image data URIs are supported.
- Failed images in pasted HTML become visible placeholders; the text still pastes and an error is shown.
- Plain-text pastes retain VisualEditor's normal behavior.

Uploaded files receive a page-title prefix and a random suffix. Uploads happen **before saving the page**: undoing a paste or abandoning an edit does not delete files already uploaded.

![SimplePasteImage demo](https://github.com/user-attachments/assets/a2a7d1c9-55e2-42f1-bfa6-73039d3640c5)

## Compatibility and limitations

The version matrix and exact development snapshots are recorded in [tests/COMPATIBILITY.md](tests/COMPATIBILITY.md). The extension supports both the older `ve.ce.Surface` paste API and the newer `ve.ce.ClipboardHandler` API. Unsupported API shapes retain normal paste behavior and log a warning.

- The browser must expose either an image file, embedded image data, or a reachable HTTP(S) image URL. Word and other native apps vary by platform and clipboard format; a `file://` reference requires matching clipboard file bytes. A local path alone cannot be uploaded by the wiki server.
- Remote images must be accessible to the wiki server. Browser-only authentication cookies are not forwarded.
- URL uploads work best with URLs ending in a supported image extension; extensionless endpoints may fail MediaWiki's file-type validation.
- SVG and other file types keep the stock VisualEditor file-paste workflow; this extension does not automatically import them.
- Deleted duplicates and filename collisions are not silently reused or overwritten.

## Development and tests

Node.js 20+ and Docker are sufficient for the local test wiki. The test account and content are disposable; do not run these tests against a production wiki.

```sh
npm ci
npx playwright install chromium
export MW_PASSWORD='choose-a-local-test-password'
bash tests/start-wiki.sh
npm test
npm run test:e2e
```

The test script uses a bind mount, so extension edits are immediately available. Files must be readable by the container's web-server user. The container is called `simplepasteimage-test`, listens on localhost port 8080, and keeps its database/uploads until you remove it:

```sh
docker rm -f simplepasteimage-test
```

`MW_IMAGE`, `MW_CONTAINER`, and `MW_PORT` customize the startup script. For the browser tests, set `MW_URL`, `MW_USER`, and `MW_PASSWORD` for the test wiki. Set `CHROMIUM_PATH` to use an existing Chromium installation. The tests expect the English UI. `MW_ARTIFACT_DIR` selects a separate result/screenshot directory per version. `MW_SOURCE` mounts a prepared MediaWiki source tree (with its matching VisualEditor, skin and Composer dependencies) instead of the image’s bundled wiki; use a disposable tree with files readable by the web-server user.

Optional external-image coverage (requires working outbound HTTPS from the wiki server):

```sh
MW_REMOTE_IMAGE='https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png' npm run test:e2e
```

The browser test uses the native clipboard and Ctrl+V. It verifies mixed HTML/table paste, duplicate reuse, PNG screenshot paste, error recovery, plain text, internal VisualEditor image copy/paste, browser selections, data/blob/file/cid formats, foreign-wiki images, and saved wikitext/images after a reload. A screenshot is written to `tests/artifacts/saved-page.png`.

For environments with an outbound proxy, configure MediaWiki's `$wgHTTPProxy` and the container's CA trust as required by that environment. Keep TLS verification enabled.
