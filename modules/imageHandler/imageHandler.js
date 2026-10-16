/* Image uploads and Parsoid-compatible inline image markup. */
( function () {
    'use strict';

    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

    function generateUuid() {
        const bytes = new Uint8Array( 16 );
        crypto.getRandomValues( bytes );
        return Array.from( bytes, b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );
    }

    function generateFilename( ext ) {
        const title = ( mw.config.get( 'wgTitle' ) || 'Image' ).replace( /[\\/#<>\[\]|{}:]/g, '_' ).slice( 0, 80 );
        return title + '-' + generateUuid() + '.' + ext;
    }

    // Only a live, byte-identical duplicate is safe to reuse. A name collision or
    // duplicate-archive warning does NOT identify an existing usable image.
    function parseUploadWarnings( response ) {
        const duplicates = response && response.upload && response.upload.warnings && response.upload.warnings.duplicate;
        return Array.isArray( duplicates ) && duplicates.length ? { isDuplicate: true, filename: duplicates[ 0 ] } : null;
    }

    function uploadResult( response ) {
        if ( response && response.upload && response.upload.result === 'Success' ) {
            return response.upload.filename;
        }
        const duplicate = parseUploadWarnings( response );
        if ( duplicate ) {
            return duplicate.filename;
        }
        throw new Error( 'upload-warning' );
    }

    // mw.Api.upload rejects warnings, whereas postWithToken resolves them.
    function uploadFailure( code, response ) {
        const duplicate = parseUploadWarnings( response );
        if ( duplicate ) {
            return duplicate.filename;
        }
        throw new Error( typeof code === 'string' ? code : 'upload-failed' );
    }

    function uploadImageFile( blob ) {
        const ext = blob && extensions[ blob.type.split( ';' )[ 0 ].toLowerCase() ];
        if ( !ext ) {
            return Promise.reject( new Error( 'unsupported-image-type' ) );
        }
        return new mw.Api().upload( blob, {
            filename: generateFilename( ext ),
            comment: 'Uploaded with SimplePasteImage'
        } ).then( uploadResult, uploadFailure );
    }

    function uploadImageByUrl( src ) {
        const url = new URL( src, document.baseURI );
        if ( !/^https?:$/.test( url.protocol ) ) {
            return Promise.reject( new Error( 'unsupported-image-url' ) );
        }
        const match = url.pathname.match( /\.(png|jpe?g|gif|webp)$/i );
        const ext = match ? match[ 1 ].toLowerCase() : 'png';
        return new mw.Api().postWithToken( 'csrf', {
            action: 'upload', filename: generateFilename( ext ), url: url.href,
            comment: 'Uploaded with SimplePasteImage'
        } ).then( uploadResult, uploadFailure );
    }

    async function uploadImageFromDataUri( src ) {
        if ( !/^data:image\/(png|jpeg|gif|webp)(?:;[^,]*)?,/i.test( src ) ) {
            throw new Error( 'unsupported-image-type' );
        }
        const response = await fetch( src );
        return uploadImageFile( await response.blob() );
    }

    async function getImageInfo( filename ) {
        const response = await new mw.Api().get( {
            action: 'query', titles: 'File:' + filename, prop: 'imageinfo', iiprop: 'url|size', formatversion: 2
        } );
        const page = response.query.pages[ 0 ];
        if ( !page.imageinfo || !page.imageinfo[ 0 ] ) {
            throw new Error( 'image-not-found' );
        }
        return page.imageinfo[ 0 ];
    }

    function buildVeImageWrapper( fileHref, filename, info = {} ) {
        const wrapper = document.createElement( 'span' );
        wrapper.setAttribute( 'typeof', 'mw:File' );
        const link = document.createElement( 'a' );
        // Link to the file page, not the raw image (which creates an external link).
        link.setAttribute( 'href', './File:' + filename );
        const img = document.createElement( 'img' );
        img.setAttribute( 'resource', './File:' + filename );
        img.setAttribute( 'src', fileHref );
        img.className = 'mw-file-element';
        if ( info.width && info.height ) {
            img.width = info.width;
            img.height = info.height;
        }
        link.appendChild( img );
        wrapper.appendChild( link );
        return wrapper.outerHTML;
    }

    async function imageData( filename ) {
        const info = await getImageInfo( filename );
        return { filename, fileHref: info.url, veHtml: buildVeImageWrapper( info.url, filename, info ) };
    }

    function matchClipboardFile( src, files ) {
        if ( !/^(file:|cid:)/i.test( src ) ) {
            return null;
        }
        let name;
        try {
            name = decodeURIComponent( src.replace( /^cid:/i, '' ).split( /[\\/]/ ).pop() );
        } catch ( error ) {
            return null;
        }
        const matches = files.filter( file => file.name === name );
        // Never guess by position: Office may provide a screenshot of the entire
        // selection as a fallback, not the bytes of an individual embedded image.
        return matches.length === 1 ? matches[ 0 ] : null;
    }

    async function processRemoteImage( src, files = [] ) {
        const sourceUrl = new URL( src, document.baseURI );
        if ( /^https?:$/.test( sourceUrl.protocol ) && sourceUrl.origin === new URL( document.baseURI ).origin ) {
            const parts = sourceUrl.pathname.split( '/' );
            const candidate = decodeURIComponent( parts[ parts.length - ( parts.includes( 'thumb' ) ? 2 : 1 ) ] );
            try {
                const info = await getImageInfo( candidate );
                const originalUrl = new URL( info.url );
                const uploadPath = mw.config.get( 'wgUploadPath' );
                const thumbPrefix = uploadPath && originalUrl.pathname.replace( uploadPath + '/', uploadPath + '/thumb/' ) + '/';
                if ( sourceUrl.href === info.url || ( thumbPrefix && sourceUrl.pathname.startsWith( thumbPrefix ) ) ) {
                    return { filename: candidate, fileHref: info.url, veHtml: buildVeImageWrapper( info.url, candidate, info ) };
                }
            } catch ( error ) {
                // Not an existing local file: continue with the normal upload path.
            }
        }
        const file = matchClipboardFile( src, files );
        let filename;
        if ( file ) {
            filename = await uploadImageFile( file );
        } else if ( /^data:/i.test( src ) ) {
            filename = await uploadImageFromDataUri( src );
        } else if ( /^blob:/i.test( src ) ) {
            // Only readable blob URLs work. Cross-origin or revoked blob URLs
            // need actual clipboard file bytes; never send blob URLs to the server.
            const response = await fetch( src );
            filename = await uploadImageFile( await response.blob() );
        } else {
            filename = await uploadImageByUrl( src );
        }
        return imageData( filename );
    }

    module.exports = {
        generateUuid, parseUploadWarnings, uploadImageByUrl, uploadImageFromDataUri,
        uploadImageFile, matchClipboardFile, getImageInfo, buildVeImageWrapper, processRemoteImage, imageData
    };
}() );
