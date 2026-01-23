/*
** Image paste processor for SimplePasteImage extension
**
** Patches VE to upload remote images found in pasted content
** and replace them with locally hosted versions.
**
** In other words, it allows to paste images together with text and therefore
** convert any data source with images into wiki pages with locally hosted images.
**
** Idea is to upload images and adjust the pasted HTML before VE processes it.
*/

( function () {
    'use strict';

    const imageHandler = mw.loader.require( 'ext.simplePasteImage.imageHandler' );

    /**
     * Replace an image element with VE-compatible HTML wrapper
     * @param {HTMLElement} img The original img element
     * @param {HTMLElement} doc The document context
     * @param {string} veHtml The VE HTML wrapper
     */
    function replaceImageInDoc( img, doc, veHtml ) {
        const $img = $( img );
        // find an ancestor that is a direct child of body
        const $topAncestor = $img.parents().filter( function() {
            return this.parentNode === doc.body;
        } ).first();

        if ( $topAncestor.length ) {
            $topAncestor.replaceWith( $( veHtml ) );
        } else if ( img.parentNode === doc.body ) {
            $img.replaceWith( $( veHtml ) );
        } else {
            $( doc.body ).append( $img );
            $img.replaceWith( $( veHtml ) );
        }
    }

    // Patch afterPasteAddToFragmentFromExternal to process images in pasted content
    function installPatch() {
        if ( !( window.ve && ve.ce && ve.ce.Surface && ve.sanitizeHtmlToDocument && ve.ui && ve.ui.DataTransferItem ) ) {
            return false;
        }

        const orig = ve.ce.Surface.prototype.afterPasteAddToFragmentFromExternal;

        ve.ce.Surface.prototype.afterPasteAddToFragmentFromExternal = function ( _clipboardKey, $clipboardHtml, _fragment, _targetFragment, _isMultiline, _forceClipboardData ) {
            var beforePasteData = this.beforePasteData || {};
            var wrapperDfd = $.Deferred();

            // run async work in background
            ( async () => {
                try {
                    // Prefer clipboard API HTML if present, otherwise use pasteTarget HTML
                    let html = beforePasteData.html || ( this.$pasteTarget && this.$pasteTarget.html() ) || '';
                    if ( !html ) { return; }

                    var doc = ve.sanitizeHtmlToDocument( html );
                    var $body = $( doc.body );

                    const promises = [];
                    
                    // TODO: show errors later
                    const imageErrors = [];

                    var $images = $body.find( 'img' );
                    $images.each( ( _i, img ) => {
                        const src = img.getAttribute( 'src' ) || '';
                        // Upload from base64 data URI
                        promises.push( imageHandler.processRemoteImage( src ).then( imageData => {
                            if ( !imageData ) { 
                                imageErrors.push( new Error( 'Failed to process remote image: ' + src ) );
                                return; 
                            }
                        
                            replaceImageInDoc( img, doc, imageData.veHtml );
                            return;
                        }));
                    });

                    await Promise.all( promises );
                                    
                    beforePasteData.html = $body[0].innerHTML;
                } catch ( e ) { }
    

                // update beforePasteData / pasteTarget / $clipboardHtml
                this.beforePasteData = beforePasteData;
                if ( this.$pasteTarget && typeof this.$pasteTarget.html === 'function' ) {
                    this.$pasteTarget.html( beforePasteData.html || '' );
                }
                if ( $clipboardHtml && $clipboardHtml.length && typeof $clipboardHtml.html === 'function' ) {
                    $clipboardHtml.html( beforePasteData.html || '' );
                }

                // call original and "propagate" its completion into our Deferred
                var origResult = orig.apply( this, arguments );
                if ( origResult && typeof origResult.always === 'function' ) {
                    origResult.always( function() { wrapperDfd.resolve(); } );
                } else if ( origResult && typeof origResult.then === 'function' ) {
                    origResult.then( function() { wrapperDfd.resolve(); }, function() { wrapperDfd.reject(); } );
                } else {
                    wrapperDfd.resolve();
                }
            } )();

            // return a jQuery promise that has .always
            return wrapperDfd.promise();
        };

        return true;
    }

    // Try install immediately, otherwise poll until VE is ready.
    if ( !installPatch() ) {
        const timer = setInterval( () => {
            if ( installPatch() ) {
                clearInterval( timer );
            }
        }, 100 );
    }
}() );
