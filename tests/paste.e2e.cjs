/* Run against a disposable wiki: this test creates pages and uploads images. */
const { chromium } = require( 'playwright' );
const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );

(async () => {
    const base = process.env.MW_URL || 'http://localhost:8080';
    const password = process.env.MW_PASSWORD;
    assert.ok( password, 'Set MW_PASSWORD for a disposable test wiki' );
    const browser = await chromium.launch( {
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: [ '--no-sandbox' ]
    } );
    const context = await browser.newContext( { permissions: [ 'clipboard-read', 'clipboard-write' ] } );
    const page = await context.newPage();
    const errors = [];
    page.on( 'pageerror', error => errors.push( error.message ) );
    page.setDefaultTimeout( 120000 );
    try {
        await page.goto( base + '/index.php?title=Special:UserLogin' );
        await page.locator( '#wpName1' ).fill( process.env.MW_USER || 'Admin' );
        await page.locator( '#wpPassword1' ).fill( password );
        await Promise.all( [ page.waitForURL( url => !url.href.includes( 'UserLogin' ) ), page.locator( '#wpLoginAttempt' ).click() ] );
        const title = 'SimplePasteImageTest-' + Date.now();
        await page.goto( base + '/index.php?title=' + title + '&veaction=edit' );
        await page.waitForFunction( () => window.ve?.init?.target?.getSurface() && mw.loader.getState( 'ext.simplePasteImage.imagePasteProcessor' ) === 'ready' );
        await page.evaluate( () => new Promise( resolve => mw.hook( 've.activationComplete' ).add( resolve ) ) );
        const start = page.getByRole( 'button', { name: 'Start editing', exact: true } );
        if ( await start.isVisible() ) {
            await start.click();
        }
        await page.evaluate( () => Promise.resolve( ve.init.target.welcomeDialogPromise ).catch( () => {} ) );
        await page.evaluate( () => document.addEventListener( 'paste', e => { window.spiClipboard = { html: e.clipboardData.getData( 'text/html' ), files: Array.from( e.clipboardData.files ).map( f => f.name ) }; }, true ) );
        const dataUrl = await page.evaluate( () => {
            const canvas = document.createElement( 'canvas' );
            canvas.width = 40; canvas.height = 30;
            const ctx = canvas.getContext( '2d' );
            ctx.fillStyle = 'red'; ctx.fillRect( 0, 0, 40, 30 );
            return canvas.toDataURL();
        } );
        const data = () => page.evaluate( () => ve.init.target.getSurface().getModel().getDocument().getFullData() );
        const imageCount = count => page.waitForFunction( count => ve.init.target.getSurface().getModel().getDocument().getFullData().filter( n => n.type === 'mwInlineImage' ).length === count, count );
        const textIncludes = text => page.waitForFunction( text => ve.init.target.getSurface().getModel().getDocument().getFullData().map( n => typeof n === 'string' ? n : Array.isArray( n ) ? n[ 0 ] : '' ).join( '' ).includes( text ), text );
        async function paste( html ) {
            await page.waitForFunction( () => !( ve.init.target.getSurface().getView().clipboardHandler || ve.init.target.getSurface().getView() ).pasting );
            await page.evaluate( async html => {
                await navigator.clipboard.write( [ new ClipboardItem( {
                    'text/html': new Blob( [ html ], { type: 'text/html' } ),
                    'text/plain': new Blob( [ 'pasted content' ], { type: 'text/plain' } )
                } ) ] );
                ve.init.target.getSurface().getView().focus();
            }, html );
            await page.keyboard.press( 'Control+V' );
        }

        await paste( `<p>BEFORE <img src="${dataUrl}"> BETWEEN <img src="${dataUrl}"> AFTER</p><table><tbody><tr><td>CELL <img src="${dataUrl}"> END</td></tr></tbody></table>` );
        await imageCount( 3 );
        let result = await data();
        assert.ok( result.some( n => n.type === 'mwTable' ) );
        assert.ok( result.map( n => typeof n === 'string' ? n : Array.isArray( n ) ? n[ 0 ] : '' ).join( '' ).includes( 'BEFORE  BETWEEN  AFTERCELL  END' ) );
        console.log( 'PASS: mixed HTML preserves paragraph, table and three images' );

        await paste( `<p>SECOND <img src="${dataUrl}"> END</p>` );
        await imageCount( 4 );
        result = await data();
        assert.equal( new Set( result.filter( n => n.type === 'mwInlineImage' ).map( n => n.attributes.resource ) ).size, 1 );
        console.log( 'PASS: duplicate image reuses existing file' );

        await page.waitForFunction( () => !( ve.init.target.getSurface().getView().clipboardHandler || ve.init.target.getSurface().getView() ).pasting );
        await page.evaluate( async src => {
            const blob = await ( await fetch( src ) ).blob();
            await navigator.clipboard.write( [ new ClipboardItem( { 'image/png': blob } ) ] );
            ve.init.target.getSurface().getView().focus();
        }, dataUrl );
        await page.keyboard.press( 'Control+V' );
        await imageCount( 5 );
        console.log( 'PASS: native PNG clipboard paste' );

        await paste( '<p>KEEP <img src="file:///missing.png"> TEXT</p>' );
        await textIncludes( 'KEEP [Image upload failed] TEXT' );
        await page.locator( '.mw-notification-content' ).filter( { hasText: /Could not upload 1 image/ } ).last().waitFor();
        console.log( 'PASS: failed upload reports error and preserves text' );

        await page.waitForFunction( () => !( ve.init.target.getSurface().getView().clipboardHandler || ve.init.target.getSurface().getView() ).pasting );
        await page.evaluate( async () => {
            await navigator.clipboard.writeText( 'PLAIN-TEXT' );
            ve.init.target.getSurface().getView().focus();
        } );
        await page.keyboard.press( 'Control+V' );
        await textIncludes( 'PLAIN-TEXT' );
        console.log( 'PASS: plain text after a failed image paste' );

        let expectedImages = 5;
        if ( process.env.MW_REMOTE_IMAGE ) {
            const html = await page.evaluate( src => {
                const p = document.createElement( 'p' );
                p.textContent = 'REMOTE ';
                const img = document.createElement( 'img' ); img.src = src; p.appendChild( img );
                return p.outerHTML;
            }, process.env.MW_REMOTE_IMAGE );
            await paste( html );
            await imageCount( ++expectedImages );
            console.log( 'PASS: HTTP image uploaded by the wiki server' );
        }

        const sourceResults = await require( './clipboard-sources.cjs' )( { page, context, dataUrl, paste, imageCount, textIncludes, data, count: expectedImages } );
        expectedImages = sourceResults.expectedImages;
        expectedImages = await require( './complex-paste.cjs' )( { page, dataUrl, paste, imageCount, data, count: expectedImages } );

        await page.waitForFunction( () => !( ve.init.target.getSurface().getView().clipboardHandler || ve.init.target.getSurface().getView() ).pasting );
        await page.evaluate( () => {
            const surface = ve.init.target.getSurface();
            const offset = surface.getModel().getDocument().getFullData().findIndex( n => n.type === 'mwInlineImage' );
            surface.getModel().setLinearSelection( new ve.Range( offset, offset + 2 ) );
            surface.getView().focus();
        } );
        await page.keyboard.press( 'Control+C' );
        await page.evaluate( () => {
            ve.init.target.getSurface().getModel().setLinearSelection( new ve.Range( 1 ) );
            ve.init.target.getSurface().getView().focus();
        } );
        await page.keyboard.press( 'Control+V' );
        await imageCount( ++expectedImages );
        console.log( 'PASS: internal VisualEditor image copy/paste' );

        await page.getByRole( 'button', { name: /^Save(?: page)?…$/ } ).click();
        await page.getByRole( 'button', { name: 'Save page', exact: true } ).click();
        await page.waitForURL( url => !url.searchParams.has( 'veaction' ), { waitUntil: 'networkidle' } );
        await page.reload();
        assert.equal( await page.locator( '#mw-content-text img' ).count(), expectedImages );
        assert.ok( ( await page.locator( '#mw-content-text' ).innerText() ).includes( 'BEFORE  BETWEEN  AFTER' ) );
        const savedText = await page.locator( '#mw-content-text' ).innerText();
        for ( let i = 0; i < 1200; i++ ) {
            assert.ok( savedText.includes( 'LARGE-' + String( i ).padStart( 4, '0' ) ), 'Saved paragraph missing: ' + i );
        }
        assert.ok( await page.locator( '#mw-content-text img' ).evaluateAll( imgs => imgs.every( img => img.complete && img.naturalWidth > 0 ) ) );
        const wikitext = await page.evaluate( async title => {
            await mw.loader.using( 'mediawiki.api' );
            const response = await new mw.Api().get( { action: 'query', titles: title, prop: 'revisions', rvprop: 'content', rvslots: 'main', formatversion: 2 } );
            return response.query.pages[ 0 ].revisions[ 0 ].slots.main.content;
        }, title );
        assert.equal( ( wikitext.match( /\[\[File:/g ) || [] ).length, expectedImages );
        assert.ok( !/\|link=https?:[^|\]]*\/images\//.test( wikitext ), 'Images must not link to raw upload URLs' );
        console.log( 'PASS: saved wikitext and reloaded page retain all images' );
        assert.deepEqual( errors, [] );
        const artifactDir = process.env.MW_ARTIFACT_DIR || 'tests/artifacts';
        fs.mkdirSync( artifactDir, { recursive: true } );
        const version = await page.evaluate( () => mw.config.get( 'wgVersion' ) );
        fs.writeFileSync( artifactDir + '/result.json', JSON.stringify( { version, base, sources: sourceResults.passed, expectedImages, status: 'passed' }, null, 2 ) );
        await page.screenshot( { path: artifactDir + '/saved-page.png', fullPage: false } );
    } catch ( error ) {
        console.error( ( await page.locator( 'body' ).innerText() ).slice( -2500 ) );
        console.error( await page.evaluate( () => ( { clipboard: window.spiClipboard && { files: window.spiClipboard.files, htmlLength: window.spiClipboard.html.length },
            imageCount: window.ve?.init?.target?.getSurface()?.getModel().getDocument().getFullData().filter( n => n.type === 'mwInlineImage' ).length } ) ) );
        throw error;
    } finally {
        await browser.close();
    }
})().catch( error => { console.error( error ); process.exitCode = 1; } );
