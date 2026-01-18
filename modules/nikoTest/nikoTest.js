/*
** For now that's an experiment
**
** that patches VE to upload remote images found in pasted content
** and replace them with locally hosted versions.
**
** In other words, it allows to paste images together with text and therefore
** convert nay data source with images into wiki pages with locally hosted images.
**
** Idea is to upload images and adjust the pasted HTML before VE processes it.
*/

( function () {
    'use strict';

	function generateUuid() {
		// RFC4122 v4-ish
		try {
			const arr = new Uint8Array(16);
			crypto.getRandomValues(arr);
			// set version bits
			arr[6] = (arr[6] & 0x0f) | 0x40;
			arr[8] = (arr[8] & 0x3f) | 0x80;
			const hex = Array.from(arr).map(b => ('0' + b.toString(16)).slice(-2)).join('');
			return hex.slice(0,8) + '-' + hex.slice(8,12) + '-' + hex.slice(12,16) + '-' + hex.slice(16,20) + '-' + hex.slice(20);
		} catch (e) {
			// fallback
			return Math.random().toString(16).slice(2) + Date.now().toString(16);
		}
	}

	// TODO: check if image exists and use it instead of uploading a duplicate
	// TODO: check if image already removed -- force reupload if needed
	// TODO: handle errors
	function uploadImageByUrl( src ) {
        if ( typeof mw === 'undefined' || !mw.Api ) {
            return Promise.resolve( null );
        }
        const filenamePart = ( src.split( '?' )[0].split( '/' ).pop() || 'image' ).split( '.' ).pop();
        let ext = ( filenamePart && filenamePart.length <= 6 ) ? filenamePart : 'png';
        if ( !/^[a-z0-9]+$/i.test( ext ) ) ext = 'png';
        const pageName = mw.config && mw.config.get( 'wgTitle' ) ? mw.config.get( 'wgTitle' ) : 'Page';
        const filename = pageName + '-' + generateUuid() + '.' + ext;
        const api = new mw.Api();
        const token = mw.user && mw.user.tokens ? mw.user.tokens.get( 'csrfToken' ) : null;
        if ( !token ) {
            return Promise.resolve( null );
        }

        return api.post( {
            action: 'upload',
            filename: filename,
            url: src,
            ignorewarnings: 1,
            token: token,
            format: 'json'
        } ).then( res => {
            if ( res && res.upload && ( res.upload.result === 'Success' || res.upload.result === 'Warning' ) ) {
                return res.upload.filename || filename;
            }
            return null;
        } ).catch( () => null );
    }

    // Patch afterPasteAddToFragmentFromExternal to break into debugger when
    // pasted content contains both text and images (i.e. "текст с картинками").
    function installPatch() {
        if ( !( window.ve && ve.ce && ve.ce.Surface && ve.sanitizeHtmlToDocument && ve.ui && ve.ui.DataTransferItem ) ) {
            return false;
        }

        const orig = ve.ce.Surface.prototype.afterPasteAddToFragmentFromExternal;

        ve.ce.Surface.prototype.afterPasteAddToFragmentFromExternal = function ( clipboardKey, $clipboardHtml, fragment, targetFragment, isMultiline, forceClipboardData ) {
            var beforePasteData = this.beforePasteData || {};
            // возвращаем jQuery Deferred сразу (VE будет вызывать .always и т.п.)
            var wrapperDfd = $.Deferred();

            // запускаем асинхронную работу в фоне
            ( async () => {
                try {
                    // Prefer clipboard API HTML if present, otherwise use pasteTarget HTML
                    let html = beforePasteData.html || ( this.$pasteTarget && this.$pasteTarget.html() ) || '';
                    if ( html ) {
                        try {
                            var doc = ve.sanitizeHtmlToDocument( html );
                            var $body = $( doc.body );

                            var $images = $body.find( 'img' );
                            const imgCount = $images.length;

                            // Compute text content excluding images
                            const $clone = $body.clone();
                            $clone.find( 'img' ).remove();
                            const textOnly = $clone.text().trim();

                            if ( imgCount > 0 && textOnly.length > 0 ) {
                                const promises = [];
                                $images.each( ( i, img ) => {
                                    const src = img.getAttribute( 'src' ) || '';
                                    if ( src.indexOf( 'data:' ) === 0 ) {
                                        try {
                                            const item = ve.ui.DataTransferItem.static.newFromDataUri( src, img.outerHTML );
                                            promises.push( Promise.resolve( item ) );
                                        } catch ( e ) {
                                            promises.push( Promise.resolve( null ) );
                                        }
                                    } else {
                                        const p = uploadImageByUrl( src ).then( uploadedFilename => {
                                            if ( !uploadedFilename ) {
                                                return null;
                                            }
                                            // получение реального URL и замена элемента (твоя логика)
                                            const api2 = new mw.Api();
                                            return api2.get( {
                                                action: 'query',
                                                titles: 'File:' + uploadedFilename,
                                                prop: 'imageinfo',
                                                iiprop: 'url',
                                                format: 'json'
                                            } ).then( qres => {
                                                let fileHref = null;
                                                try {
                                                    const pages = qres && qres.query && qres.query.pages;
                                                    if ( pages ) {
                                                        const page = pages[ Object.keys( pages )[0] ];
                                                        if ( page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url ) {
                                                            fileHref = page.imageinfo[0].url;
                                                        }
                                                    }
                                                } catch ( e ) {}
                                                if ( !fileHref ) {
                                                    const server = mw.config.get( 'wgServer' ) || '';
                                                    const uploadPath = mw.config.get( 'wgUploadPath' ) || '/images';
                                                    fileHref = ( server.replace( /\/$/, '' ) + '/' + uploadPath.replace( /^\/|\/$/g, '' ) + '/' + encodeURIComponent( uploadedFilename ) ).replace( /\/\//g, '/' );
                                                }
                                                const resourcePath = './File:' + uploadedFilename;
                                                const veWrapper = '<p><span typeof="mw:File" class="ve-pasteProtect" data-ve-attributes=' +
                                                    JSON.stringify( { typeof: 'mw:File' } ) +
                                                    '>' +
                                                        '<a href="' + fileHref + '" class="mw-file-description">' +
                                                            '<img resource="' + resourcePath + '" src="' + fileHref + '" class="mw-file-element" decoding="async" data-file-type="bitmap" data-ve-attributes=\'' +
                                                                JSON.stringify( { resource: resourcePath } ) +
                                                            '\' />' +
                                                        '</a>' +
                                                    '</span></p>';
                                                const $img = $( img );
                                                const $figure = $img.closest( 'figure' );
                                                if ( $figure.length ) {
                                                    $figure.replaceWith( $( veWrapper ) );
                                                } else {
                                                    $img.replaceWith( $( veWrapper ) );
                                                }
                                                return uploadedFilename;
                                            } ).catch( () => null );
                                        }).catch( () => null );
                                        promises.push( p );
                                    }
                                });
                                await Promise.all( promises );
                            }

                            beforePasteData.html = $body[0].innerHTML;
                        } catch ( e ) {
                            // parsing failed — ignore and continue
                        }
                    }
                } catch ( e ) {
                    // общая ошибка обработки — игнорируем чтобы не ломать VE
                }

                // обновляем beforePasteData / pasteTarget / $clipboardHtml
                this.beforePasteData = beforePasteData;
                if ( this.$pasteTarget && typeof this.$pasteTarget.html === 'function' ) {
                    this.$pasteTarget.html( beforePasteData.html || '' );
                }
                if ( $clipboardHtml && $clipboardHtml.length && typeof $clipboardHtml.html === 'function' ) {
                    $clipboardHtml.html( beforePasteData.html || '' );
                }

                // вызвать оригинал и "пробросить" его завершение в наш Deferred
                var origResult = orig.apply( this, arguments );
                if ( origResult && typeof origResult.always === 'function' ) {
                    origResult.always( function() { wrapperDfd.resolve(); } );
                } else if ( origResult && typeof origResult.then === 'function' ) {
                    origResult.then( function() { wrapperDfd.resolve(); }, function() { wrapperDfd.reject(); } );
                } else {
                    wrapperDfd.resolve();
                }
            } )();

            // возвращаем jQuery promise, у которого есть .always
            return wrapperDfd.promise();
        };

        return true;
    }

    // Try install immediately, otherwise poll until VE is ready.
	// TODO: replace to a better soltion -- this one suggested by AI
    if ( !installPatch() ) {
        const timer = setInterval( () => {
            if ( installPatch() ) {
                clearInterval( timer );
            }
        }, 100 );
    }
}() );