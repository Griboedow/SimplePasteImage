#!/usr/bin/env bash
# Disposable local MediaWiki + VisualEditor test environment.
set -euo pipefail
: "${MW_PASSWORD:?Set MW_PASSWORD to a password for the disposable Admin account}"
spi_root="$(cd "$(dirname "$0")/.." && pwd)"
spi_container="${MW_CONTAINER:-simplepasteimage-test}"
spi_port="${MW_PORT:-8080}"
spi_image="${MW_IMAGE:-mediawiki:1.43}"
spi_source_args=()
if [ -n "${MW_SOURCE:-}" ]; then
  spi_source_args+=(--mount "type=bind,src=$MW_SOURCE,dst=/var/www/html")
fi
# Do not replace an existing container or its data.
docker run -d --name "$spi_container" "${spi_source_args[@]}" -p "127.0.0.1:$spi_port:80" \
  --mount "type=bind,src=$spi_root,dst=/var/www/html/extensions/SimplePasteImage,readonly" "$spi_image"
docker exec "$spi_container" php maintenance/install.php \
  --dbtype sqlite --dbpath /var/www/data --server "http://localhost:$spi_port" \
  --scriptpath '' --lang en --pass "$MW_PASSWORD" 'SimplePasteImage Test' Admin
docker exec "$spi_container" chown -R www-data:www-data /var/www/data /var/www/html/images /var/www/html/cache
docker exec -i "$spi_container" sh -c 'cat >> LocalSettings.php' <<'PHP'
$wgEnableUploads = true;
$wgAllowCopyUploads = true;
$wgGroupPermissions['user']['upload_by_url'] = true;
wfLoadExtension( 'VisualEditor' );
wfLoadExtension( 'SimplePasteImage' );
$wgDefaultUserOptions['visualeditor-enable'] = 1;
$wgVirtualRestConfig['modules']['parsoid'] = [ 'url' => 'http://localhost/rest.php', 'domain' => 'localhost' ];
$wgShowExceptionDetails = true;
PHP
printf 'Test wiki: http://localhost:%s (Admin). Remove it with: docker rm -f %s\n' "$spi_port" "$spi_container"
