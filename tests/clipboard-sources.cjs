const assert = require( 'node:assert/strict' );
// Browser fixtures model formats, not certification of specific Office/Docs versions.
module.exports = async ( { page, context, dataUrl, paste, imageCount, textIncludes, data, count } ) => {
    let expected = count;
    const passed = [];
    async function check( name, html, marker, increment = 1 ) {
        await paste( html ); await textIncludes( marker ); await imageCount( expected += increment );
        passed.push( name ); console.log( 'PASS source: ' + name );
    }
    await context.route( 'http://clipboard-source.test/**', route => route.fulfill( {
        contentType: 'text/html', body: `<main id="copy"><p>BROWSER-BEFORE <img src="${dataUrl}"> BROWSER-AFTER</p><ul><li>LIST <b>bold</b></li></ul><table><tr><td>TABLE <img src="${dataUrl}"></td></tr></table></main>`
    } ) );
    const source = await context.newPage();
    await source.goto( 'http://clipboard-source.test/selection' ); await source.bringToFront();
    await source.locator( '#copy' ).evaluate( element => {
        const range = document.createRange(); range.selectNodeContents( element );
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange( range );
    } );
    await source.keyboard.press( 'Control+C' ); await page.bringToFront();
    await page.evaluate( () => ve.init.target.getSurface().getView().focus() );
    await page.keyboard.press( 'Control+V' ); await imageCount( expected += 2 );
    await textIncludes( 'BROWSER-BEFORE ' ); await textIncludes( ' BROWSER-AFTER' );
    assert.ok( ( await data() ).some( n => n.type === 'list' ) ); await source.close();
    passed.push( 'native browser selection: paragraph/list/table/base64' );
    console.log( 'PASS source: native browser Ctrl+C selection' );
    const variants = await page.evaluate( () => {
        const c = document.createElement( 'canvas' ); c.width = 28; c.height = 20;
        c.getContext( '2d' ).fillRect( 0, 0, 28, 20 );
        return { jpeg: c.toDataURL( 'image/jpeg' ), webp: c.toDataURL( 'image/webp' ) };
    } );
    variants.gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    variants.percent = 'data:image/png,' + Array.from( Buffer.from( dataUrl.split( ',' )[ 1 ], 'base64' ), n => '%' + n.toString( 16 ).padStart( 2, '0' ) ).join( '' );
    for ( const [ type, uri ] of Object.entries( variants ) ) {
        await check( type + ' data URI', `<p>FORMAT-${type} <img src="${uri}"></p>`, 'FORMAT-' + type );
    }
    await check( 'Office-style HTML/base64', `<html><body><!--StartFragment--><p class="MsoNormal">OFFICE-BEFORE <span><img src="${dataUrl}"></span> OFFICE-AFTER</p><!--EndFragment--></body></html>`, 'OFFICE-BEFORE ' );
    await textIncludes( ' OFFICE-AFTER' );
    const blobUrl = await page.evaluate( async src => URL.createObjectURL( await ( await fetch( src ) ).blob() ), dataUrl );
    await check( 'readable blob URL', `<p>BLOB <img src="${blobUrl}"></p>`, 'BLOB' );
    await page.evaluate( url => URL.revokeObjectURL( url ), blobUrl );
    for ( const scheme of [ 'file:///tmp/', 'cid:' ] ) {
        await page.waitForFunction( () => !( ve.init.target.getSurface().getView().clipboardHandler || ve.init.target.getSurface().getView() ).pasting );
        await page.evaluate( async ( { dataUrl, scheme } ) => {
            await navigator.clipboard.write( [ new ClipboardItem( {
                'text/html': new Blob( [ `<p>ATTACH-${scheme} <img src="${scheme}image.png"> END-ATTACH</p>` ], { type: 'text/html' } ),
                'image/png': await ( await fetch( dataUrl ) ).blob()
            } ) ] ); ve.init.target.getSurface().getView().focus();
        }, { dataUrl, scheme } );
        await page.keyboard.press( 'Control+V' ); await textIncludes( 'ATTACH-' + scheme ); await imageCount( ++expected );
        passed.push( scheme + ' with matching clipboard file' ); console.log( 'PASS source: ' + scheme + ' plus binary clipboard file' );
    }
    await check( 'foreign wiki Parsoid image', `<p>FOREIGN <span typeof="mw:File"><a href="https://other-wiki.example/File:Foreign.png"><img resource="./File:Foreign.png" class="mw-file-element" src="${dataUrl}"></a></span></p>`, 'FOREIGN' );
    assert.ok( !( await data() ).some( n => n.type === 'mwInlineImage' && n.attributes.resource === './File:Foreign.png' ) );
    const local = ( await data() ).find( n => n.type === 'mwInlineImage' ).attributes;
    await check( 'wiki read-mode image without Parsoid metadata', `<p>LOCAL-READ <img src="${local.src}"></p>`, 'LOCAL-READ' );
    for ( const [ name, src ] of [ [ 'missing-cid', 'cid:missing.png' ], [ 'revoked-blob', blobUrl ], [ 'invalid-base64', 'data:image/png;base64,!!!' ] ] ) {
        await check( name + ' preserves text', `<p>FAIL-${name} <img src="${src}"> END-FAIL</p>`, 'FAIL-' + name + ' [Image upload failed] END-FAIL', 0 );
    }
    return { expectedImages: expected, passed };
};
