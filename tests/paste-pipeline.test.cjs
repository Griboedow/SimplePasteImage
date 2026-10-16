const { test } = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const vm = require( 'node:vm' );
const { JSDOM } = require( 'jsdom' );
const clipboardHtml = require( '../modules/imagePasteProcessor/clipboardHtml.js' );

function harness( { modern = false, arity = 6, rejectOriginal = false } = {} ) {
    const window = new JSDOM( '', { url: 'https://wiki.example/index.php' } ).window;
    const $ = require( 'jquery' )( window );
    const calls = [], notifications = [], registered = [];
    let active = 0, peak = 0, originalCalls = 0, received;
    function done( self, args ) {
        originalCalls++;
        received = { args: Array.from( args ), html: self.beforePasteData.html };
        if ( rejectOriginal ) { return $.Deferred().reject( new Error( 'VE rejected paste' ) ).promise(); }
        return $.Deferred().resolve( 'inserted' ).promise();
    }
    const original = arity === 7 ? function ( key, html, plain, fragment, target, multiline, force ) { return done( this, arguments ); } :
        arity === 6 ? function ( key, html, fragment, target, multiline, force ) { return done( this, arguments ); } :
            function ( changed, api ) { return done( this, arguments ); };
    function Surface() {}
    function ClipboardHandler() {}
    const prototype = ( modern ? ClipboardHandler : Surface ).prototype;
    prototype.beforePaste = function ( event ) { this.beforePasteData = { html: event.html }; return 'before'; };
    prototype.afterPasteAddToFragmentFromExternal = original;
    function Transfer() {}
    Transfer.static = {};
    const imageHandler = {
        async processRemoteImage( src, files ) {
            calls.push( { src, files } );
            peak = Math.max( peak, ++active );
            await new Promise( resolve => setTimeout( resolve, src.length % 3 ) );
            active--;
            if ( src.includes( 'bad' ) ) { throw new Error( 'missing bytes' ); }
            return { filename: 'Local.png', veHtml: '<span typeof="mw:File"><a href="./File:Local.png"><img class="mw-file-element" resource="./File:Local.png" src="/images/Local.png" width="100" height="50"></a></span>' };
        }
    };
    const context = {
        document: window.document, DOMParser: window.DOMParser, setTimeout, Promise, $, console,
        require: name => name === './clipboardHtml.js' ? clipboardHtml : imageHandler,
        mw: {
            log: { warn() {} },
            msg: ( key, ...args ) => [ key, ...args ].join( ':' ),
            message: key => ( { text: () => key } ),
            notify: label => { const notification = { label, closed: false, close() { this.closed = true; } }; notifications.push( notification ); return Promise.resolve( notification ); }
        },
        ve: { ce: { Surface, ...( modern ? { ClipboardHandler } : {} ) }, sanitizeHtmlToDocument: html => new window.DOMParser().parseFromString( html, 'text/html' ), ui: { DataTransferHandler: Transfer, dataTransferHandlerFactory: { register: type => registered.push( type ) } } },
        OO: { inheritClass: ( Child, Parent ) => { Child.super = Parent; Child.prototype = Object.create( Parent.prototype ); Child.static = {}; } }
    };
    vm.runInNewContext( fs.readFileSync( require.resolve( '../modules/imagePasteProcessor/imagePasteProcessor.js' ), 'utf8' ), context );
    const instance = Object.create( prototype );
    return { window, calls, notifications, registered, prototype, original,
        stats: () => ( { peak, originalCalls, received } ),
        async paste( html, files = [] ) {
            instance.beforePaste( { html, originalEvent: { clipboardData: { files } } } );
            const args = arity === 7 ? [ 'key', null, 'plain clipboard', 'fragment', 'target', true ] : [ 'key', null, 'fragment', 'target', true ];
            return instance.afterPasteAddToFragmentFromExternal( ...args );
        }
    };
}

for ( const [ version, modern, arity ] of [ [ '1.43 Surface', false, 6 ], [ '1.45–1.46 ClipboardHandler', true, 6 ], [ '1.47/master ClipboardHandler', true, 7 ] ] ) {
    test( version + ': large paste preserves all paragraphs, image order and hook arguments with partial failures', async () => {
        const h = harness( { modern, arity } );
        const html = Array.from( { length: 1200 }, ( _, i ) => `<p>SECTION${i} café 中文 ${i % 6 === 0 ? `<img src="${i % 60 === 0 ? 'file:///bad.png' : 'data:image/png,source' + ( i % 120 )}" alt="ALT${i}" width="20">` : ''} END${i}</p>` ).join( '' );
        assert.equal( await h.paste( html, [ { name: 'clipboard.png' } ] ), 'inserted' );
        const stats = h.stats();
        const doc = new h.window.DOMParser().parseFromString( stats.received.html, 'text/html' );
        assert.equal( doc.querySelectorAll( 'p' ).length, 1200 );
        assert.equal( doc.querySelectorAll( 'img' ).length, 180 );
        assert.equal( ( doc.body.textContent.match( /simplepasteimage-image-failed/g ) || [] ).length, 20 );
        assert.ok( doc.body.textContent.includes( 'ALT0' ) );
        Array.from( doc.querySelectorAll( 'p' ) ).forEach( ( p, i ) => {
            assert.ok( p.textContent.startsWith( 'SECTION' + i + ' café 中文 ' ) );
            assert.ok( p.textContent.endsWith( ' END' + i ) );
        } );
        assert.ok( Array.from( doc.querySelectorAll( 'img' ) ).every( i => i.width === 20 && i.height === 10 ) );
        assert.equal( stats.originalCalls, 1 );
        assert.equal( stats.received.args[ arity - 1 ], true );
        assert.equal( stats.received.args[ arity === 7 ? 3 : 2 ], 'fragment' );
        if ( arity === 7 ) { assert.equal( stats.received.args[ 2 ], 'plain clipboard' ); }
        assert.ok( stats.peak <= 4 );
        assert.equal( h.calls.length, 19 ); // 18 good sources plus one repeated failure.
        assert.ok( h.calls.every( call => call.files[ 0 ].name === 'clipboard.png' ) );
        assert.equal( h.notifications[ 0 ].label.textContent, 'simplepasteimage-progress:200:200' );
        assert.equal( h.notifications[ 0 ].closed, true );
        assert.equal( await h.paste( '<p>AFTER FAILURE</p>' ), 'inserted' );
    } );
}

test( 'a rejected VE insertion settles and closes upload progress', async () => {
    const h = harness( { rejectOriginal: true } );
    await assert.rejects( h.paste( '<p>A<img src="data:image/png,ok">B</p>' ), /VE rejected paste/ );
    assert.equal( h.notifications[ 0 ].closed, true );
} );

test( 'unknown HTML hook signatures keep stock paste and still register screenshot support', () => {
    const h = harness( { arity: 2 } );
    assert.equal( h.prototype.afterPasteAddToFragmentFromExternal, h.original );
    assert.equal( h.registered.length, 1 );
} );
