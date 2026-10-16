const { test } = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const vm = require( 'node:vm' );
const { webcrypto } = require( 'node:crypto' );

function handler( upload ) {
    const context = {
        module: { exports: {} }, crypto: webcrypto, URL, Blob, fetch,
        document: { baseURI: 'https://wiki.example/' },
        mw: { config: { get: () => 'Test' }, Api: function () {
            this.upload = upload;
            this.postWithToken = upload;
        } }
    };
    vm.runInNewContext( fs.readFileSync( require.resolve( '../modules/imageHandler/imageHandler.js' ), 'utf8' ), context );
    return context.module.exports;
}

test( 'reuse a live duplicate from a resolved URL-upload warning', async () => {
    const api = handler( () => Promise.resolve( { upload: { result: 'Warning', warnings: { duplicate: [ 'Existing.png' ] } } } ) );
    assert.equal( await api.uploadImageByUrl( 'https://example.org/image.png' ), 'Existing.png' );
} );

test( 'reuse a live duplicate from mw.Api.upload rejection (two jQuery arguments)', async () => {
    const api = handler( () => ( { then: ( success, failure ) => failure( 'upload-warning', {
        upload: { warnings: { duplicate: [ 'Existing.png' ] } }
    } ) } ) );
    assert.equal( await api.uploadImageFile( new Blob( [ 'test' ], { type: 'image/png' } ) ), 'Existing.png' );
} );

test( 'never reuse a filename collision or deleted duplicate, or ignore warnings', async () => {
    for ( const warnings of [ { exists: 'Different.png' }, { 'duplicate-archive': [ 'Deleted.png' ] } ] ) {
        let calls = 0;
        const api = handler( () => { calls++; return Promise.resolve( { upload: { result: 'Warning', warnings } } ); } );
        await assert.rejects( api.uploadImageByUrl( 'https://example.org/image.png' ), /upload-warning/ );
        assert.equal( calls, 1 );
    }
} );

test( 'unsupported schemes and non-image data never reach the upload API', async () => {
    let calls = 0;
    const api = handler( () => { calls++; } );
    await assert.rejects( api.uploadImageByUrl( 'file:///private.png' ), /unsupported-image-url/ );
    await assert.rejects( api.uploadImageFromDataUri( 'data:text/html;base64,SGVsbG8=' ), /unsupported-image-type/ );
    assert.equal( calls, 0 );
} );
