// Run with node tests/id3.cjs [optional MP3 paths]. No user audio is committed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
let saved, renders = 0, updates = 0;
const context = vm.createContext({ Uint8Array, DataView, TextDecoder, Blob, URL,
  dbPut: async track => { saved = { ...track }; }, renderTable: () => renders++, decks: {} });
vm.runInContext(source.slice(source.indexOf('function synchsafeInteger'), source.indexOf('function coverInitials')), context);
const sync = n => Buffer.from([(n >>> 21)&127,(n >>> 14)&127,(n >>> 7)&127,n&127]);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64');
function frame(version, name, body) {
  const header = Buffer.alloc(version === 2 ? 6 : 10); header.write(name);
  if (version === 2) header.writeUIntBE(body.length, 3, 3);
  else if (version === 4) sync(body.length).copy(header,4);
  else header.writeUInt32BE(body.length,4);
  return Buffer.concat([header,body]);
}
function tag(version, frames, extra = false) {
  let body = Buffer.concat(frames);
  if (extra) body = Buffer.concat([version === 4 ? Buffer.from([0,0,0,6,1,0]) : Buffer.from([0,0,0,6,0,0,0,0,0,0]),body]);
  return Buffer.concat([Buffer.from([73,68,51,version,0,extra?64:0]),sync(body.length),body]);
}
const read = bytes => context.readId3Metadata(Uint8Array.from(bytes).buffer);
(async () => {
  let sample;
  for (const version of [2,3,4]) {
    const picture = Buffer.concat([Buffer.from(version===2 ? [0,80,78,71,3,0] : [0,...Buffer.from('image/png'),0,3,0]),png]);
    const frames = [frame(version,version===2?'PIC':'APIC',picture),frame(version,version===2?'TT2':'TIT2',Buffer.from([3,...Buffer.from('Test title')])),frame(version,version===2?'TP1':'TPE1',Buffer.from([3,...Buffer.from('Artist')]))];
    for (const extra of version===2 ? [false] : [false,true]) {
      const bytes = tag(version,frames,extra); const m = read(bytes);
      assert.equal(m.title,'Test title'); assert.equal(m.artist,'Artist'); assert.equal(m.coverBlob.type,'image/png');
      assert.deepEqual(Buffer.from(await m.coverBlob.arrayBuffer()),png);
      if(version===2) sample=bytes;
    }
  }
  assert.equal(read(tag(2,[frame(2,'PIC',Buffer.from([0,80,78,71,3]))])).coverBlob,undefined);
  assert.equal(read(Buffer.from([73,68,51,3,0,64,0,0,0,1,0])).coverBlob,undefined);
  // Do not read a frame whose payload runs past the declared tag boundary.
  const short=Buffer.from(sample); sync(6).copy(short,6); assert.equal(read(short).coverBlob,undefined);
  // Reading only the tag must yield the same artwork as reading the whole file.
  const withAudio=new Blob([sample,Buffer.alloc(50000,0xff)]);
  const tagOnly=await context.readId3TagBuffer(withAudio);
  assert.equal(tagOnly.byteLength,sample.length);
  assert.deepEqual(Buffer.from(await context.readId3Metadata(tagOnly).coverBlob.arrayBuffer()),png);
  assert.equal(await context.readId3TagBuffer(new Blob([Buffer.alloc(100,0xff)])),null);
  assert.equal(await context.readId3TagBuffer(new Blob([Buffer.from('ID3')])),null);
  const track={id:'existing',hotCues:{A:1.25},bpm:123,coverBlob:null,coverUrl:'old fallback',fileHandle:{kind:'file'}};
  context.decks.A={track,updateCoverUi:()=>updates++};
  await context.refreshMissingArtwork(track,Uint8Array.from(sample).buffer);
  assert.equal(track.coverBlob.type,'image/png'); assert.equal(track.coverUrl,null);
  assert.equal(saved.id,'existing'); assert.equal(saved.hotCues.A,1.25); assert.equal(saved.bpm,123); assert.equal(saved.fileHandle,track.fileHandle);
  assert.equal(renders,1); assert.equal(updates,1);
  await context.refreshMissingArtwork(track,Uint8Array.from(sample).buffer); assert.equal(renders,1);
  context.dbPut=async()=>{throw Error('full');};
  const failed={coverBlob:null,coverUrl:'fallback'};
  await assert.rejects(context.refreshMissingArtwork(failed,Uint8Array.from(sample).buffer),/full/);
  assert.equal(failed.coverBlob,null); assert.equal(failed.coverUrl,'fallback');
  for (const filename of process.argv.slice(2)) {
    const bytes=fs.readFileSync(filename),m=read(bytes);
    assert.equal(bytes[3],2); assert.ok(m.title); assert.ok(m.artist); assert.equal(m.coverBlob.type,'image/png');
    // Independently extract the first PIC payload in these Apple Music samples.
    assert.equal(bytes.toString('ascii',10,13),'PIC');
    const payload=bytes.subarray(16,16+bytes.readUIntBE(13,3));
    const image=payload.subarray(payload.indexOf(0,5)+1);
    assert.deepEqual(Buffer.from(await m.coverBlob.arrayBuffer()),image);
    console.log(`PASS real MP3: ${path.basename(filename)} (${m.coverBlob.size} artwork bytes)`);
  }
  console.log('PASS ID3v2.2/2.3/2.4, extended headers, malformed boundaries, exact artwork bytes, cache recovery, preserved cues and storage failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
