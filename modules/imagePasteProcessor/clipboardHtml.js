/* Transform only the imported image, retaining the surrounding document. */
'use strict';

function replaceImage( img, replacement ) {
    const newImg = replacement.querySelector( 'img' );
    for ( const name of [ 'alt', 'title' ] ) {
        if ( img.hasAttribute( name ) ) {
            newImg.setAttribute( name, img.getAttribute( name ) );
        }
    }
    const dimension = name => {
        const value = img.style[ name ] || img.getAttribute( name ) || '';
        return /^\d+(?:\.\d+)?(?:px)?$/.test( value ) && parseFloat( value ) > 0 ?
            Math.min( 10000, Math.round( parseFloat( value ) ) ) : null;
    };
    let width = dimension( 'width' ), height = dimension( 'height' );
    if ( width && !height && newImg.width && newImg.height ) {
        height = Math.max( 1, Math.round( width * newImg.height / newImg.width ) );
    } else if ( height && !width && newImg.width && newImg.height ) {
        width = Math.max( 1, Math.round( height * newImg.width / newImg.height ) );
    }
    if ( width ) { newImg.width = width; }
    if ( height ) { newImg.height = height; }

    const link = img.closest( 'a' );
    if ( !link ) {
        img.replaceWith( replacement );
        return;
    }
    // Generic linked pictures should keep their destination. Parsoid's default
    // file-page links instead follow the imported local file identity.
    if ( !img.closest( '[typeof~="mw:File"], [typeof~="mw:File/Thumb"], [typeof~="mw:File/Frameless"]' ) && link.hasAttribute( 'href' ) ) {
        replacement.querySelector( 'a' ).setAttribute( 'href', link.getAttribute( 'href' ) );
    }
    // Split the anchor around the image (including nested spans/bold text).
    // extractContents moves other image nodes, keeping pending work references valid.
    const before = link.cloneNode( false ), after = link.cloneNode( false );
    const range = img.ownerDocument.createRange();
    range.selectNodeContents( link );
    range.setEndBefore( img );
    before.appendChild( range.extractContents() );
    range.selectNodeContents( link );
    range.setStartAfter( img );
    after.appendChild( range.extractContents() );
    const nodes = [];
    if ( before.hasChildNodes() ) { nodes.push( before ); }
    nodes.push( replacement );
    if ( after.hasChildNodes() ) { nodes.push( after ); }
    link.replaceWith( ...nodes );
}

function matchesLocalResource( img, data ) {
    if ( !data.isLocal ) { return false; }
    // Partial/older Parsoid markup is not a usable VE image, even when the file
    // exists. Normalize it instead of letting VE silently discard the node.
    if ( !img.classList.contains( 'mw-file-element' ) ||
        !img.closest( '[typeof~="mw:File"], [typeof~="mw:File/Thumb"], [typeof~="mw:File/Frameless"]' ) ) {
        return false;
    }
    const resource = img.getAttribute( 'resource' ) || '';
    if ( !/^(?:\.\/)?File:/.test( resource ) ) { return false; }
    try {
        return decodeURIComponent( resource.replace( /^(?:\.\/)?File:/, '' ) ).replace( / /g, '_' ) === data.filename.replace( / /g, '_' );
    } catch ( error ) { return false; }
}

async function forEachLimited( items, limit, callback ) {
    let index = 0;
    await Promise.all( Array.from( { length: Math.min( limit, items.length ) }, async () => {
        while ( index < items.length ) {
            const item = items[ index++ ];
            await callback( item );
        }
    } ) );
}

module.exports = { replaceImage, matchesLocalResource, forEachLimited };
