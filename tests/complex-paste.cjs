/* Additional browser regression fixtures. Use a disposable wiki with
 * $wgVisualEditorAllowExternalLinkPaste = true. */
const assert = require( 'node:assert/strict' );

module.exports = async function ( { page, dataUrl, paste, imageCount, data, count } ) {
    await page.keyboard.press( 'Control+End' );
    await paste( '<h2>COMPLEX</h2><p><a href="https://example.org/source">LEFT <b>' +
        `<img src="${dataUrl}" width="20" height="15" alt="diagram"> MIDDLE ` +
        `<img src="${dataUrl}" width="20" height="15"> RIGHT</b></a></p>` +
        `<table><caption>CAPTION</caption><tr><td rowspan="2">CELL<img src="${dataUrl}"></td><td>A</td></tr><tr><td>B</td></tr></table>` );
    await imageCount( count + 3 );
    let result = await data();
    const images = result.filter( n => n.type === 'mwInlineImage' ).slice( -3 );
    assert.equal( images[ 0 ].attributes.width, 20 );
    assert.equal( images[ 0 ].attributes.height, 15 );
    assert.equal( images[ 0 ].attributes.alt, 'diagram' );
    assert.equal( images[ 0 ].attributes.href, 'https://example.org/source' );
    assert.ok( result.some( n => n.type === 'tableCell' && n.attributes.rowspan === 2 ) );
    assert.ok( await page.locator( '.ve-ce-documentNode a' ).evaluateAll( links =>
        [ 'LEFT', 'MIDDLE', 'RIGHT' ].every( word => links.some( a => a.textContent.includes( word ) && a.getAttribute( 'href' ) === 'https://example.org/source' ) ) ) );
    count += 3;
    await page.keyboard.press( 'Control+End' );
    await paste( Array.from( { length: 40 }, ( _, i ) => `<p>ITEM${String( i ).padStart( 2, '0' )}<img src="${dataUrl}" width="20" height="15">END${i}</p>` ).join( '' ) );
    await imageCount( count + 40 );
    result = await data();
    const text = result.map( n => typeof n === 'string' ? n : Array.isArray( n ) ? n[ 0 ] : '' ).join( '' );
    const positions = Array.from( { length: 40 }, ( _, i ) => text.indexOf( 'ITEM' + String( i ).padStart( 2, '0' ) ) );
    assert.ok( positions.every( ( n, i ) => n >= 0 && ( !i || n > positions[ i - 1 ] ) ) );
    await page.keyboard.press( 'Control+Z' );
    await imageCount( count );
    await page.keyboard.press( 'Control+Y' );
    await imageCount( count + 40 );
    console.log( 'PASS: linked siblings, pixel dimensions, merged table, 40-image order and undo/redo' );
    count += 40;
    await page.keyboard.press( 'Control+End' );
    const started = Date.now();
    await paste( '<h2>LARGE DOCUMENT</h2>' + Array.from( { length: 1200 }, ( _, i ) =>
        `<p>LARGE-${String( i ).padStart( 4, '0' )} café 中文 😀 <b>bold</b> <i>italic</i> ${i % 6 === 0 ? `<img src="${dataUrl}" width="20" height="15">` : ''} END-${i}</p>` ).join( '' ) );
    await imageCount( count + 200 );
    const largeData = await data();
    const largeText = largeData.map( n => typeof n === 'string' ? n : Array.isArray( n ) ? n[ 0 ] : '' ).join( '' );
    let previous = -1;
    for ( let i = 0; i < 1200; i++ ) {
        const position = largeText.indexOf( 'LARGE-' + String( i ).padStart( 4, '0' ) );
        assert.ok( position > previous, 'Paragraph ' + i + ' missing or reordered' );
        previous = position;
    }
    console.log( 'PASS: 1200 paragraphs and 200 embedded images in ' + ( Date.now() - started ) + 'ms' );
    return count + 200;
};
