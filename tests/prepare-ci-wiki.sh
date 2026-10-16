#!/usr/bin/env bash
set -euo pipefail
version="${1:?Specify a release version, REL1_47 or master}"
target="${RUNNER_TEMP:?This helper uses a CI temporary directory}/spi-wiki"
mkdir -p "$target"
if [[ "$version" =~ ^1\.(43|44|45|46)\.[0-9]+$ ]]; then
  minor="${version%.*}"
  curl --fail --retry 3 -L "https://releases.wikimedia.org/mediawiki/$minor/mediawiki-$version.tar.gz" |
    tar -xz --strip-components=1 -C "$target"
elif [[ "$version" == REL1_47 || "$version" == master ]]; then
  git clone --depth 1 --branch "$version" https://github.com/wikimedia/mediawiki.git "$target"
  git clone --depth 1 --branch "$version" --recurse-submodules --shallow-submodules \
    https://github.com/wikimedia/mediawiki-extensions-VisualEditor.git "$target/extensions/VisualEditor"
  git clone --depth 1 --branch "$version" https://github.com/wikimedia/mediawiki-skins-Vector.git "$target/skins/Vector"
  curl --fail --retry 3 -L https://getcomposer.org/composer-stable.phar -o "$RUNNER_TEMP/composer.phar"
  docker run --rm --entrypoint php -v "$target:/var/www/html" -v "$RUNNER_TEMP/composer.phar:/tmp/composer.phar:ro" \
    -e COMPOSER_ALLOW_SUPERUSER=1 mediawiki:1.46 /tmp/composer.phar install --no-dev --no-interaction --prefer-dist
else
  echo "Unsupported test target: $version" >&2
  exit 1
fi
# Docker's web user needs write access to uploads and its local configuration.
chmod -R a+rX "$target"
mkdir -p "$target/images" "$target/cache"
chmod a+rwx "$target/images" "$target/cache"
