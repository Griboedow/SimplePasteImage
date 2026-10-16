/* Preserve VisualEditor's paste pipeline while importing embedded images. */
( function () {
    'use strict';
    const imageHandler = require( 'ext.simplePasteImage.imageHandler' );
    const clipboardHtml = require( './clipboardHtml.js' );

    function notifyError( count ) {
        mw.notify( mw.message( 'simplepasteimage-upload-error', count ).text(), { type: 'error', autoHide: false } );
    }

    function showProgress( total ) {
        const label = document.createElement( 'span' );
        const update = completed => {
            label.textContent = total ? mw.msg( 'simplepasteimage-progress', completed, total ) : mw.msg( 'simplepasteimage-uploading' );
        };
        update( 0 );
        const notification = mw.notify( label, { tag: 'simplepasteimage', autoHide: false } );
        return { update, close: () => Promise.resolve( notification ).then( item => item.close() ).catch( () => {} ) };
    }

    function installHtmlPaste() {
    const pastePrototype = ve.ce.ClipboardHandler ? ve.ce.ClipboardHandler.prototype : ve.ce.Surface.prototype;
    const original = pastePrototype.afterPasteAddToFragmentFromExternal;
    const originalBeforePaste = pastePrototype.beforePaste;
    // The hook is internal to VE: fail closed on versions with a different API.
    if ( typeof original !== 'function' || ![ 6, 7 ].includes( original.length ) || typeof originalBeforePaste !== 'function' ) {
        mw.log.warn( 'SimplePasteImage: unsupported VisualEditor paste API' );
        return;
    }

    pastePrototype.beforePaste = function ( event ) {
        const clipboard = event.originalEvent && event.originalEvent.clipboardData;
        const files = clipboard ? Array.from( clipboard.files || [] ) : [];
        const hasImages = clipboard && typeof clipboard.getData === 'function' && /<img\b/i.test( clipboard.getData( 'text/html' ) );
        if ( hasImages ) {
            // Keep fast consecutive rich pastes out of the same undo batch.
            this.getSurface().getModel().breakpoint();
        }
        const result = originalBeforePaste.apply( this, arguments );
        if ( this.beforePasteData ) {
            this.beforePasteData.simplePasteImageFiles = files;
        }
        return result;
    };

    pastePrototype.afterPasteAddToFragmentFromExternal = function () {
        const args = Array.from( arguments );
        const beforePasteData = this.beforePasteData || {};
        const html = beforePasteData.html || ( this.$pasteTarget || this.$element ).html() || '';
        // Let VE handle internal clipboard slices, plain text and normal paste.
        if ( !/<img\b/i.test( html ) ) {
            return original.apply( this, args );
        }
        // DOMPurify removes blob/file/cid src attributes. Preserve these references
        // as inert data until the uploader validates them; never relax sanitization.
        const raw = new DOMParser().parseFromString( html, 'text/html' );
        raw.querySelectorAll( 'img' ).forEach( img => {
            img.removeAttribute( 'data-simplepasteimage-source' );
            const src = img.getAttribute( 'src' ) || '';
            if ( /^(blob:|file:|cid:)/i.test( src ) ) {
                img.setAttribute( 'data-simplepasteimage-source', src );
            }
        } );
        const doc = ve.sanitizeHtmlToDocument( raw.body.innerHTML );
        // Same origin alone does not identify this wiki (several wikis may share
        // one host). Verify the actual file URL and resource name before reuse.
        const images = Array.from( doc.body.querySelectorAll( 'img' ) );
        if ( !images.length ) {
            return original.apply( this, args );
        }

        const deferred = $.Deferred();
        const cache = new Map();
        let failures = 0;
        let completed = 0;
        const progress = showProgress( images.length );
        deferred.always( progress.close );
        const work = clipboardHtml.forEachLimited( images, 4, async img => {
            const src = img.getAttribute( 'data-simplepasteimage-source' ) || img.getAttribute( 'src' ) || '';
            img.removeAttribute( 'data-simplepasteimage-source' );
            try {
                if ( !cache.has( src ) ) {
                    cache.set( src, imageHandler.processRemoteImage( src, beforePasteData.simplePasteImageFiles || [] ) );
                }
                const data = await cache.get( src );
                if ( clipboardHtml.matchesLocalResource( img, data ) ) { return; }
                const holder = doc.createElement( 'div' );
                holder.innerHTML = data.veHtml;
                const replacement = holder.firstElementChild;
                clipboardHtml.replaceImage( img, replacement );
            } catch ( error ) {
                failures++;
                // Keep an explicit placeholder instead of silently losing the image.
                const alt = img.getAttribute( 'alt' );
                img.replaceWith( doc.createTextNode( '[' + mw.msg( 'simplepasteimage-image-failed' ) + ( alt ? ': ' + alt : '' ) + ']' ) );
            } finally {
                progress.update( ++completed );
                // Cached/repeated images can otherwise monopolize the microtask
                // queue on large pastes, preventing the progress UI from painting.
                if ( completed % 16 === 0 ) {
                    await new Promise( resolve => setTimeout( resolve, 0 ) );
                }
            }
        } );
        work.then( () => {
            beforePasteData.html = doc.body.innerHTML;
            this.beforePasteData = beforePasteData;
            args[ 1 ] = $( doc.body ).contents();
            args[ original.length - 1 ] = true; // Use the transformed clipboard HTML, without browser paste context.
            if ( failures ) {
                notifyError( failures );
            }
            // Adopt success AND failure so VE always releases its paste state.
            $.when( original.apply( this, args ) ).then( value => {
                this.getSurface().getModel().breakpoint();
                return value;
            } ).then( deferred.resolve, deferred.reject );
        } ).catch( deferred.reject );
        return deferred.promise();
    };
    }
    installHtmlPaste();

    // Screenshots arrive as File objects, without HTML. Use VE's supported
    // transfer-handler API rather than synthesizing a second clipboard event.
    function ImageTransferHandler() {
        ImageTransferHandler.super.apply( this, arguments );
    }
    OO.inheritClass( ImageTransferHandler, ve.ui.DataTransferHandler );
    ImageTransferHandler.static.name = 'simplePasteImage';
    ImageTransferHandler.static.kinds = [ 'file' ];
    ImageTransferHandler.static.types = [ 'image/png', 'image/jpeg', 'image/gif', 'image/webp' ];
    ImageTransferHandler.prototype.process = function () {
        const progress = showProgress();
        this.insertableDataDeferred.always( progress.close );
        Promise.resolve().then( () => imageHandler.uploadImageFile( this.item.getAsFile() ) )
            .then( imageHandler.imageData )
            .then( data => {
                this.resolve( this.surface.getModel().getDocument().newFromHtml( '<p>' + data.veHtml + '</p>' ) );
            } ).catch( () => {
                notifyError( 1 );
                this.abort();
            } );
    };
    ve.ui.dataTransferHandlerFactory.register( ImageTransferHandler );
}() );
