/*
** Image handling utilities for SimplePasteImage extension
**
** Handles image UUID generation, uploading remote images to the wiki,
** retrieving image URLs, and building VE-compatible HTML
*/

( function () {
    'use strict';

    /**
     * Generate a UUID v4 (RFC4122 v4-ish)
     * @return {string} UUID string
     */
    function generateUuid() {
        try {
            const arr = new Uint8Array( 16 );
            crypto.getRandomValues( arr );
            // set version bits
            arr[6] = ( arr[6] & 0x0f ) | 0x40;
            arr[8] = ( arr[8] & 0x3f ) | 0x80;
            const hex = Array.from( arr ).map( b => ( '0' + b.toString( 16 ) ).slice( -2 ) ).join( '' );
            return hex.slice( 0, 8 ) + '-' + hex.slice( 8, 12 ) + '-' + hex.slice( 12, 16 ) + '-' + hex.slice( 16, 20 ) + '-' + hex.slice( 20 );
        } catch ( e ) {
            // fallback
            return Math.random().toString( 16 ).slice( 2 ) + Date.now().toString( 16 );
        }
    }

    /**
     * Generate a filename for an uploaded image based on page title and extension
     * @param {string} ext File extension (e.g., "png", "jpg")
     * @return {string} Generated filename
     */
    function generateFilename( ext ) {
        const pagenamePart = mw.config.get( 'wgTitle' ).replace( /\//g, '_' );
        return pagenamePart + '-' + generateUuid() + '.' + ext;
    }

    /**
     * Parse upload response warnings to check for duplicate files
     * @param {Object} uploadResponse The response from the upload API
     * @return {Object|null} { isDuplicate: boolean, filename: string|null }
     */
    function parseUploadWarnings( uploadResponse ) {
        if ( !uploadResponse || !uploadResponse.upload || !uploadResponse.upload.warnings ) {
            return null;
        }

        const warnings = uploadResponse.upload.warnings;

        // Check for 'exists' warning - file already exists
        if ( warnings.exists ) {
            return {
                isDuplicate: true,
                filename: warnings.exists
            };
        }

        // Check for 'duplicate' warning - exact duplicate found
        if ( warnings.duplicate && Array.isArray( warnings.duplicate ) && warnings.duplicate.length > 0 ) {
            return {
                isDuplicate: true,
                filename: warnings.duplicate[0]
            };
        }

        // Check for 'duplicate-archive' warning
        if ( warnings['duplicate-archive'] && Array.isArray( warnings['duplicate-archive'] ) && warnings['duplicate-archive'].length > 0 ) {
            return {
                isDuplicate: true,
                filename: warnings['duplicate-archive'][0]
            };
        }

        return null;
    }

    /**
     * Upload an image from a URL to the wiki
     * @param {string} src The image URL
     * @return {Promise<string|null>} The filename if successful, null on failure
     */
    function uploadImageByUrl( src , ignorewarnings = false ) {
        if ( typeof mw === 'undefined' || !mw.Api ) {
            return Promise.resolve( null );
        }

        const filenamePart = ( src.split( '?' )[0].split( '/' ).pop() || 'image' ).split( '.' ).pop();
        let ext = ( filenamePart && filenamePart.length <= 6 ) ? filenamePart : 'png';
        if ( !/^[a-z0-9]+$/i.test( ext ) ) { ext = 'png'; }

        const filename = generateFilename( ext );
        const token = mw.user && mw.user.tokens ? mw.user.tokens.get( 'csrfToken' ) : null;
        if ( !token ) {
            return Promise.resolve( null );
        }
  
        const uploadParams = {
            action: 'upload',
            filename: filename,
            url: src,
            format: 'json',
            token: token,
        };
        if ( ignorewarnings ) {
            uploadParams.ignorewarnings = 1;
        }

        const api = new mw.Api();
        return api.post( uploadParams )
            .then( res => {
                // Check for success
                if ( res && res.upload && res.upload.result === 'Success' ) {
                    return res.upload.filename || uploadParams.filename;
                }

                // Handle warnings
                if ( res && res.upload ) {
                    const warningInfo = parseUploadWarnings( res );

                    // If it's a duplicate, return the existing filename
                    if ( warningInfo && warningInfo.isDuplicate && warningInfo.filename ) {
                        return warningInfo.filename;
                    }

                    // If there were other warnings, retry with ignorewarnings
                    if ( res.upload.warnings ) {
                        return uploadImageByUrl( src, true )
                            .then( retryRes => {
                                if ( retryRes && retryRes.upload && ( retryRes.upload.result === 'Success' || retryRes.upload.result === 'Warning' ) ) {
                                    return retryRes.upload.filename || uploadParams.filename;
                                }
                                return null;
                            } )
                            .catch( () => null );
                    }
                }

                return null;
            } )
            .catch( () => null );
    }

    /**
     * Get the URL of an uploaded file from the wiki
     * @param {string} filename The filename (e.g. "Example.jpg")
     * @return {Promise<string|null>} The file URL or null if not found
     */
    function getImageUrl( filename ) {
        if ( typeof mw === 'undefined' || !mw.Api ) {
            return Promise.resolve( null );
        }

        const api = new mw.Api();
        return api.get( {
            action: 'query',
            titles: 'File:' + filename,
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

            return fileHref;
        } ).catch( () => null );
    }

    /**
     * Build a VE-compatible HTML wrapper for an image
     * @param {string} fileHref The image URL
     * @param {string} filename The uploaded filename (without File: prefix)
     * @return {string} HTML string ready for insertion into the document
     */
    function buildVeImageWrapper( fileHref, filename ) {
        const resourcePath = './File:' + filename;
        return '<p><span typeof="mw:File" class="ve-pasteProtect" data-ve-attributes=' +
            JSON.stringify( { typeof: 'mw:File' } ) +
            '>' +
                '<a href="' + fileHref + '" class="mw-file-description">' +
                    '<img resource="' + resourcePath + '" src="' + fileHref + '" class="mw-file-element" decoding="async" data-file-type="bitmap" data-ve-attributes=\'' +
                        JSON.stringify( { resource: resourcePath } ) +
                    '\' />' +
                '</a>' +
            '</span></p>';
    }

    /**
     * Process and upload a remote image, then get its URL and build VE HTML
     * @param {string} src The image URL or data URI to upload
     * @return {Promise<{filename: string, fileHref: string, veHtml: string}|null>} Image data or null on failure
     */
    function processRemoteImage( src ) {
        // Determine upload function based on source type
        const uploadPromise = src.indexOf( 'data:' ) === 0 
            ? uploadImageFromDataUri( src )
            : uploadImageByUrl( src );

        return uploadPromise.then( uploadedFilename => {
            if ( !uploadedFilename ) { return null; }

            return getImageUrl( uploadedFilename ).then( fileHref => {
                if ( !fileHref ) { return null; }

                return {
                    filename: uploadedFilename,
                    fileHref: fileHref,
                    veHtml: buildVeImageWrapper( fileHref, uploadedFilename )
                };
            } );
        } ).catch( () => null );
    }

    /**
     * Upload an image from a data URI (base64 encoded)
     * @param {string} dataUri The data URI (e.g. "data:image/png;base64,...")
     * @return {Promise<string|null>} The filename if successful, null on failure
     */
    function uploadImageFromDataUri( dataUri ) {
        if ( typeof mw === 'undefined' || !mw.Api ) {
            return Promise.resolve( null );
        }

        // Parse data URI: "data:image/png;base64,iVBORw0KGgo..."
        const matches = dataUri.match( /^data:([^;]+);base64,(.+)$/ );
        if ( !matches ) {
            return Promise.resolve( null );
        }

        const mimeType = matches[1]; // e.g., 'image/png'
        const base64Data = matches[2];

        // Extract extension from MIME type
        const ext = mimeType.split( '/' )[1] || 'png';

        const filename = generateFilename( ext );

        // Convert base64 to Blob
        let binaryString;
        try {
            binaryString = atob( base64Data );
        } catch ( e ) {
            return Promise.resolve( null );
        }

        const bytes = new Uint8Array( binaryString.length );
        for ( let i = 0; i < binaryString.length; i++ ) {
            bytes[i] = binaryString.charCodeAt( i );
        }
        const blob = new Blob( [bytes], { type: mimeType } );

        const api = new mw.Api();
        const token = mw.user && mw.user.tokens ? mw.user.tokens.get( 'csrfToken' ) : null;

        if ( !token ) {
            return Promise.resolve( null );
        }

        const uploadParams = {
            action: 'upload',
            format: 'json',
            filename: filename,
            file: blob,
            token: token
        };

        return api.upload( blob, uploadParams )
            .then( res => {
                // Check for success
                if ( res && res.upload && res.upload.result === 'Success' ) {
                    return res.upload.filename || filename;
                }

                return null;
            } )
            .catch( (...result) => {
                let res = result[1];
                // Handle warnings
                if ( res && res.upload ) {
                    const warningInfo = parseUploadWarnings( res );

                    // If it's a duplicate, return the existing filename
                    if ( warningInfo && warningInfo.isDuplicate && warningInfo.filename ) {
                        return warningInfo.filename;
                    }

                    // If there were other warnings, retry with ignorewarnings
                    if ( res.upload.warnings ) {
                        uploadParams.append( 'ignorewarnings', 1 );
                        return api.upload( blob, uploadParams )
                            .then( retryRes => {
                                if ( retryRes && retryRes.upload && ( retryRes.upload.result === 'Success' || retryRes.upload.result === 'Warning' ) ) {
                                    return retryRes.upload.filename || filename;
                                }
                                return null;
                            } )
                            .catch( () => null );
                    }
                }

            } );
    }

    // Export functions via module pattern compatible with MW
    module.exports = {
        generateUuid: generateUuid,
        uploadImageByUrl: uploadImageByUrl,
        parseUploadWarnings: parseUploadWarnings,
        getImageUrl: getImageUrl,
        buildVeImageWrapper: buildVeImageWrapper,
        processRemoteImage: processRemoteImage,
        uploadImageFromDataUri: uploadImageFromDataUri
    };

}() );
