const { test } = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const { JSDOM } = require( 'jsdom' );
const { replaceImage, matchesLocalResource, forEachLimited } = require( '../modules/imagePasteProcessor/clipboardHtml.js' );

function fixture( html ) {
    const doc = new JSDOM( html ).window.document;
    const replacement = () => {
        const holder = doc.createElement( 'div' );
        holder.innerHTML = '<span typeof="mw:File"><a href="./File:Local.png"><img resource="./File:Local.png" src="/images/Local.png" width="160" height="100"></a></span>';
        return holder.firstElementChild;
    };
    return { doc, replacement };
}

test( 'linked text and multiple nested images retain links and order, even with reverse upload completion', () => {
    const { doc, replacement } = fixture( '<p>START <a href="https://example.org/source"><b>BEFORE <img src="a" alt="A"> BETWEEN <span><img src="b" alt="B"> AFTER</span></b></a> END</p>' );
    const images = Array.from( doc.querySelectorAll( 'img' ) );
    images.reverse().forEach( img => replaceImage( img, replacement() ) );
    assert.equal( doc.body.textContent, 'START BEFORE  BETWEEN  AFTER END' );
    assert.deepEqual( Array.from( doc.querySelectorAll( 'img' ), img => img.alt ), [ 'A', 'B' ] );
    assert.equal( doc.querySelectorAll( 'a a' ).length, 0 );
    assert.ok( Array.from( doc.querySelectorAll( 'a' ) ).every( a => a.getAttribute( 'href' ) === 'https://example.org/source' ) );
    for ( const word of [ 'BEFORE', 'BETWEEN', 'AFTER' ] ) {
        assert.ok( Array.from( doc.querySelectorAll( 'a b' ) ).some( b => b.textContent.includes( word ) ) );
    }
} );

test( 'preserve requested image dimensions, alt and title; infer a missing dimension', () => {
    for ( const [ attrs, expected ] of [
        [ 'width="80" height="50"', [ 80, 50 ] ],
        [ 'style="width: 40px"', [ 40, 25 ] ],
        [ 'height="25"', [ 40, 25 ] ]
    ] ) {
        const { doc, replacement } = fixture( `<p>X<img src="a" alt="diagram" title="details" ${attrs}>Y</p>` );
        replaceImage( doc.querySelector( 'img' ), replacement() );
        const img = doc.querySelector( 'img' );
        assert.deepEqual( [ img.width, img.height ], expected );
        assert.equal( img.alt, 'diagram' );
        assert.equal( img.title, 'details' );
        assert.equal( doc.body.textContent, 'XY' );
    }
} );

test( 'table captions, merged cells and nested list text survive image replacement', () => {
    const { doc, replacement } = fixture( '<table><caption>CAPTION</caption><tr><td rowspan="2">A<img src="a">Z<ul><li>ONE<img src="b">TWO</li></ul></td><td>B</td></tr><tr><td>C</td></tr></table>' );
    const text = doc.body.textContent;
    Array.from( doc.querySelectorAll( 'img' ) ).forEach( img => replaceImage( img, replacement() ) );
    assert.equal( doc.body.textContent, text );
    assert.equal( doc.querySelector( 'td' ).rowSpan, 2 );
    assert.equal( doc.querySelectorAll( 'table' ).length, 1 );
    assert.equal( doc.querySelectorAll( 'li img' ).length, 1 );
} );

test( 'resource identity requires verified local bytes and a matching filename, not just a shared host', () => {
    const { doc } = fixture( '<span typeof="mw:File"><img class="mw-file-element" resource="./File:Correct_name.png"></span>' );
    const img = doc.querySelector( 'img' );
    assert.equal( matchesLocalResource( img, { isLocal: true, filename: 'Correct name.png' } ), true );
    assert.equal( matchesLocalResource( img, { isLocal: true, filename: 'Wrong.png' } ), false );
    assert.equal( matchesLocalResource( img, { filename: 'Correct_name.png' } ), false );
    img.setAttribute( 'resource', './File:%broken' );
    assert.equal( matchesLocalResource( img, { isLocal: true, filename: 'Correct_name.png' } ), false );
    img.setAttribute( 'resource', './File:Correct_name.png' );
    img.removeAttribute( 'class' );
    assert.equal( matchesLocalResource( img, { isLocal: true, filename: 'Correct_name.png' } ), false );
} );

test( 'large pastes bound simultaneous work and process every image once', async () => {
    let active = 0, peak = 0;
    const seen = [];
    await forEachLimited( Array.from( { length: 37 }, ( _, i ) => i ), 4, async i => {
        peak = Math.max( peak, ++active );
        await new Promise( resolve => setTimeout( resolve, i % 3 ) );
        seen.push( i ); active--;
    } );
    assert.equal( peak, 4 );
    assert.deepEqual( seen.sort( ( a, b ) => a - b ), Array.from( { length: 37 }, ( _, i ) => i ) );
} );
